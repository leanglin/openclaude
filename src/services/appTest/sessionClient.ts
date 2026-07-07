import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface, type Interface } from 'node:readline'
import {
  buildAppTestRunnerEnv,
  formatMissingRunnerMessage,
  resolveAppTestNodePath,
  resolveAppTestRunnerPath,
} from './config.js'
import { truncateEvents } from './artifacts.js'
import {
  buildSessionArtifactContext,
  createDefaultTraceDir,
  mergeSessionArtifacts,
  type AppTestSessionArtifactContext,
  type JsonObject,
} from './sessionArtifacts.js'
import type { AppTestEvent, AppTestPlatform } from './types.js'

export type AppTestSessionStartInput = {
  session_id?: string
  platform?: AppTestPlatform
  app_package?: string
  package_name?: string
  start_url?: string
  device_id?: string
  test_goal?: string
  trace_dir?: string
  mock_mode?: boolean
  execution_plan_path?: string
  route_memory_path?: string
  reflection_report_path?: string
  execution_report_path?: string
  batch_id?: string
  case_id?: string
}

export type AppTestSessionObserveInput = {
  session_id: string
  source?: string
}

export type AppTestSessionActionInput = {
  session_id: string
  action: string
  intent?: string
  target?: string | JsonObject
  value?: string
  assert_after?: Array<string | JsonObject>
  observe_after?: boolean
}

export type AppTestSessionAiActInput = {
  session_id: string
  instruction: string
  observe_after?: boolean
}

export type AppTestSessionAssertInput = {
  session_id: string
  assertion?: string
  expected?: string
  mock_pass?: boolean
}

export type AppTestSessionAdbInput = {
  session_id: string
  args?: string[]
  adb_args?: string[]
  command?: string
  timeout_ms?: number
}

export type AppTestSessionFinishInput = {
  session_id: string
  success?: boolean
  summary?: string
}

export type AppTestSessionResult = {
  success: boolean
  message: string
  session_id: string
  platform?: AppTestPlatform
  trace_dir?: string
  response: JsonObject
  events: AppTestEvent[]
  artifact_warnings?: string[]
  route_memory_path?: string
  reflection_report_path?: string
  execution_report_path?: string
}

type PendingResponse = {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

type AppTestSessionRecord = {
  sessionId: string
  platform?: AppTestPlatform
  child: ChildProcessWithoutNullStreams
  stdout: Interface
  stderr: Interface
  pending: Map<string, PendingResponse>
  events: AppTestEvent[]
  stderrLines: string[]
  artifacts: AppTestSessionArtifactContext
  testGoal?: string
  traceDir?: string
  closed: boolean
  finished: boolean
}

const sessions = new Map<string, AppTestSessionRecord>()

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function platformOf(input: AppTestSessionStartInput): AppTestPlatform {
  return input.platform === 'web' || input.start_url ? 'web' : 'android'
}

function sessionTimeoutMs(): number {
  const value = Number(process.env.OPENCAT_APP_TEST_SESSION_TIMEOUT_MS || '')
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 120_000
}

function rejectPending(record: AppTestSessionRecord, error: Error): void {
  for (const pending of record.pending.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  record.pending.clear()
}

function cleanupRecord(record: AppTestSessionRecord): void {
  sessions.delete(record.sessionId)
  record.finished = true
  try {
    record.stdout.close()
  } catch {}
  try {
    record.stderr.close()
  } catch {}
  if (!record.child.killed && record.child.exitCode == null) {
    try {
      record.child.stdin.end()
    } catch {}
    setTimeout(() => {
      if (!record.child.killed && record.child.exitCode == null) {
        record.child.kill()
      }
    }, 1000).unref()
  }
}

function createSessionRecord(
  sessionId: string,
  input: AppTestSessionStartInput,
  artifacts: AppTestSessionArtifactContext,
): AppTestSessionRecord {
  const runnerPath = resolveAppTestRunnerPath()
  if (!runnerPath) {
    throw new Error(formatMissingRunnerMessage())
  }
  const child = spawn(resolveAppTestNodePath(), [runnerPath, 'session'], {
    cwd: artifacts.cwd,
    env: buildAppTestRunnerEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const record: AppTestSessionRecord = {
    sessionId,
    platform: platformOf(input),
    child,
    stdout: createInterface({ input: child.stdout, crlfDelay: Infinity }),
    stderr: createInterface({ input: child.stderr, crlfDelay: Infinity }),
    pending: new Map(),
    events: [],
    stderrLines: [],
    artifacts,
    testGoal: input.test_goal,
    traceDir: input.trace_dir,
    closed: false,
    finished: false,
  }
  record.stdout.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: JsonObject
    try {
      parsed = JSON.parse(trimmed) as JsonObject
    } catch {
      record.events.push({ type: 'log', message: trimmed })
      return
    }
    if (parsed.type === 'session_response') {
      const requestId = asText(parsed.request_id)
      const pending = record.pending.get(requestId)
      if (pending) {
        record.pending.delete(requestId)
        clearTimeout(pending.timeout)
        pending.resolve(parsed)
      } else {
        record.events.push(parsed as AppTestEvent)
      }
      return
    }
    record.events.push(parsed as AppTestEvent)
  })
  record.stderr.on('line', line => {
    const trimmed = line.trim()
    if (trimmed) record.stderrLines.push(trimmed)
  })
  child.on('error', error => {
    rejectPending(record, error instanceof Error ? error : new Error(String(error)))
  })
  child.on('close', () => {
    record.closed = true
    if (record.stderrLines.length) {
      record.events.push({
        type: 'log',
        stream: 'stderr',
        message: record.stderrLines.slice(-20).join('\n'),
      })
    }
    rejectPending(record, new Error('AppTest session runner exited before responding.'))
    if (!record.finished) sessions.delete(record.sessionId)
  })
  sessions.set(sessionId, record)
  return record
}

function getRecord(sessionId: string): AppTestSessionRecord {
  const record = sessions.get(sessionId)
  if (!record || record.closed || record.finished) {
    throw new Error(`AppTest session has not been started: ${sessionId}`)
  }
  return record
}

async function sendCommand(
  record: AppTestSessionRecord,
  command: JsonObject,
  signal?: AbortSignal,
): Promise<JsonObject> {
  const requestId = `app-test-${randomUUID()}`
  const payload = {
    ...command,
    request_id: requestId,
    session_id: record.sessionId,
  }
  if (signal?.aborted) {
    throw new Error('AppTest session command was canceled.')
  }
  const responsePromise = new Promise<JsonObject>((resolveResponse, reject) => {
    const timeout = setTimeout(() => {
      record.pending.delete(requestId)
      reject(new Error(`AppTest session command timed out: ${asText(command.command || command.tool || command.action)}`))
    }, sessionTimeoutMs())
    const onAbort = () => {
      clearTimeout(timeout)
      record.pending.delete(requestId)
      reject(new Error('AppTest session command was canceled.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    record.pending.set(requestId, {
      resolve: value => {
        signal?.removeEventListener('abort', onAbort)
        resolveResponse(value)
      },
      reject: error => {
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
      timeout,
    })
  })
  record.child.stdin.write(`${JSON.stringify(payload)}\n`)
  return responsePromise
}

function resultFromResponse(
  record: AppTestSessionRecord,
  response: JsonObject,
  extra: Partial<AppTestSessionResult> = {},
): AppTestSessionResult {
  return {
    success: response.success !== false,
    message: asText(response.message || (response.success === false ? 'failed' : 'ok')),
    session_id: record.sessionId,
    platform: record.platform,
    trace_dir: asText(response.trace_dir || record.traceDir) || undefined,
    response,
    events: truncateEvents(record.events),
    ...extra,
  }
}

export async function startAppTestSession(
  input: AppTestSessionStartInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const sessionId = input.session_id?.trim() || `midscene-session-${randomUUID()}`
  if (sessions.has(sessionId)) {
    throw new Error(`AppTest session already exists: ${sessionId}`)
  }
  const traceDir = input.trace_dir || createDefaultTraceDir(sessionId)
  const artifacts = buildSessionArtifactContext({
    ...input,
    session_id: sessionId,
  })
  const record = createSessionRecord(sessionId, { ...input, trace_dir: traceDir }, artifacts)
  const platform = platformOf(input)
  const appPackage = input.app_package || input.package_name
  const slots: JsonObject = {
    ...artifacts.slots,
    platform,
    app_package: appPackage,
    package_name: input.package_name,
    start_url: input.start_url,
    device_id: input.device_id,
    test_goal: input.test_goal,
    trace_dir: traceDir,
    mock_mode: input.mock_mode,
    execution_plan_path: artifacts.paths.execution_plan_path,
    route_memory_path: artifacts.paths.route_memory_path,
    reflection_report_path: artifacts.paths.reflection_report_path,
    execution_report_path: artifacts.paths.execution_report_path,
    batch_id: input.batch_id,
    case_id: input.case_id,
  }
  try {
    const response = await sendCommand(
      record,
      {
        command: 'start',
        platform,
        app_package: appPackage,
        package_name: input.package_name,
        start_url: input.start_url,
        device_id: input.device_id,
        test_goal: input.test_goal,
        trace_dir: traceDir,
        mock_mode: input.mock_mode,
        slots,
      },
      signal,
    )
    if (response.success === false) {
      cleanupRecord(record)
    }
    return resultFromResponse(record, response, {
      artifact_warnings: artifacts.warnings,
    })
  } catch (error) {
    cleanupRecord(record)
    throw error
  }
}

export async function observeAppTestSession(
  input: AppTestSessionObserveInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  const response = await sendCommand(
    record,
    { command: 'observe', source: input.source },
    signal,
  )
  return resultFromResponse(record, response)
}

export async function runAppTestSessionAction(
  input: AppTestSessionActionInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  const response = await sendCommand(
    record,
    {
      command: 'action',
      step_action: input.action,
      intent: input.intent,
      target: input.target,
      value: input.value,
      assert_after: input.assert_after,
      observe_after: input.observe_after,
    },
    signal,
  )
  return resultFromResponse(record, response)
}

export async function runAppTestSessionAiAct(
  input: AppTestSessionAiActInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  const response = await sendCommand(
    record,
    {
      command: 'ai_act',
      instruction: input.instruction,
      observe_after: input.observe_after,
    },
    signal,
  )
  return resultFromResponse(record, response)
}

export async function runAppTestSessionAssert(
  input: AppTestSessionAssertInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  const response = await sendCommand(
    record,
    {
      command: 'assert',
      assertion: input.assertion,
      expected: input.expected,
      mock_pass: input.mock_pass,
    },
    signal,
  )
  return resultFromResponse(record, response)
}

export function normalizeAdbArgs(input: AppTestSessionAdbInput): string[] {
  if (Array.isArray(input.args)) return input.args.map(asText).filter(Boolean)
  if (Array.isArray(input.adb_args)) return input.adb_args.map(asText).filter(Boolean)
  const command = input.command?.trim()
  return command ? command.split(/\s+/).filter(Boolean) : []
}

export function isAllowedAppTestAdbArgs(args: string[]): boolean {
  if (!args.length) return false
  if (args[0] === 'shell') {
    const shell = args.slice(1)
    if (!shell.length) return false
    if (shell[0] === 'am' && shell[1] === 'force-stop' && shell.length === 3) return true
    if (shell[0] === 'monkey' && shell.includes('-p') && shell.includes('android.intent.category.LAUNCHER')) return true
    if (shell[0] === 'input' && ['tap', 'swipe', 'keyevent', 'text'].includes(shell[1] || '')) return true
    if (shell[0] === 'wm' && ['size', 'density'].includes(shell[1] || '')) return true
    if (shell[0] === 'dumpsys' && ['window', 'activity', 'package', 'input_method'].includes(shell[1] || '')) return true
    if (shell[0] === 'uiautomator' && shell[1] === 'dump') return true
    if (shell[0] === 'screencap') return true
    return false
  }
  return ['devices', 'get-state'].includes(args[0] || '')
}

export async function runAppTestSessionAdb(
  input: AppTestSessionAdbInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  const args = normalizeAdbArgs(input)
  const response = await sendCommand(
    record,
    {
      tool: 'android_adb',
      adb_args: args,
      timeout_ms: input.timeout_ms,
    },
    signal,
  )
  return resultFromResponse(record, response)
}

export async function finishAppTestSession(
  input: AppTestSessionFinishInput,
  signal?: AbortSignal,
): Promise<AppTestSessionResult> {
  const record = getRecord(input.session_id)
  try {
    const response = await sendCommand(
      record,
      {
        command: 'finish',
        success: input.success,
        summary: input.summary,
      },
      signal,
    )
    const success =
      input.success === undefined ? response.success !== false : input.success !== false
    const artifacts = mergeSessionArtifacts(record.artifacts, {
      session_id: record.sessionId,
      platform: record.platform,
      success,
      summary: input.summary || asText(response.summary || response.message),
      test_goal: record.testGoal,
      response,
      events: record.events,
    })
    return resultFromResponse(record, response, artifacts)
  } finally {
    cleanupRecord(record)
  }
}

export function cleanupAppTestSessionsForTesting(): void {
  for (const record of sessions.values()) {
    cleanupRecord(record)
  }
}
