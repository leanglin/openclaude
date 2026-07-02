import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import {
  buildAppTestRunnerEnv,
  formatMissingRunnerMessage,
  resolveAppTestNodePath,
  resolveAppTestRunnerPath,
} from './config.js'
import {
  collectAssertions,
  collectScreenshots,
  extractReportPath,
  extractTracePath,
  redactAndTrim,
  truncateEvents,
} from './artifacts.js'
import type {
  AppTestEvent,
  AppTestInput,
  AppTestPlatform,
  AppTestResult,
  AppTestRunnerRequest,
} from './types.js'

function platformOf(input: AppTestInput): AppTestPlatform {
  return input.platform === 'web' ? 'web' : 'android'
}

function executionModeOf(input: AppTestInput): string {
  return input.execution_mode || 'midscene_ai'
}

export function buildAppTestRunnerRequest(
  input: AppTestInput,
): AppTestRunnerRequest {
  const platform = platformOf(input)
  const appPackage = input.app_package || input.package_name
  const slots: Record<string, unknown> = {
    platform,
    app_package: appPackage,
    package_name: input.package_name,
    start_url: input.start_url,
    device_id: input.device_id,
    test_goal: input.test_goal,
    test_steps: input.test_steps,
    assertions: input.assertions,
    action_steps: input.action_steps,
    structured_action_steps: input.action_steps,
    execution_mode: executionModeOf(input),
    yaml_script: input.yaml_script,
    max_steps: input.max_steps,
    risk_mode: input.risk_mode,
    force_stop_before_launch: input.force_stop_before_launch,
    headed: input.headed,
    viewport_width: input.viewport_width,
    viewport_height: input.viewport_height,
    mock_mode: input.mock_mode,
  }

  return {
    job_id: `openclaude-${randomUUID()}`,
    platform,
    slots,
    trace_dir: input.trace_dir,
    yaml_script: input.yaml_script,
    mock_mode: input.mock_mode,
  }
}

function normalizePlaywrightMessage(message: string): string {
  if (
    /executable doesn't exist|browser.*not.*found|chromium.*not.*installed|playwright install/i.test(
      message,
    )
  ) {
    return 'Chromium is not installed.\nRun:\n  npx playwright install chromium'
  }
  return message
}

export const APP_TEST_POST_RUN_GUIDANCE =
  'AppTest already returned trace_path/report_path when available. You may update reflection_report.json or execution_report.json, but if the target report file already exists, call Read on that exact file path before using Write/Edit.'

function failureResult(
  input: AppTestInput,
  message: string,
  rawResult?: Record<string, unknown>,
): AppTestResult {
  return {
    success: false,
    message,
    platform: platformOf(input),
    execution_mode: executionModeOf(input),
    events: [],
    screenshots: [],
    assertions: [],
    trace_dir: input.trace_dir,
    post_run_guidance: APP_TEST_POST_RUN_GUIDANCE,
    raw_result: rawResult,
  }
}

export async function runAppTest(
  input: AppTestInput,
  signal?: AbortSignal,
): Promise<AppTestResult> {
  const runnerPath = resolveAppTestRunnerPath()
  if (!runnerPath) {
    return failureResult(input, formatMissingRunnerMessage())
  }

  const request = buildAppTestRunnerRequest(input)
  const command = input.execution_mode === 'yaml' ? 'run-yaml' : 'run-test'
  const events: AppTestEvent[] = []
  const stderrLines: string[] = []
  let rawResult: Record<string, unknown> | undefined

  const child = spawn(resolveAppTestNodePath(), [runnerPath, command], {
    cwd: process.cwd(),
    env: buildAppTestRunnerEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const onAbort = () => {
    child.kill()
  }
  if (signal?.aborted) onAbort()
  signal?.addEventListener('abort', onAbort, { once: true })

  const stdoutDone = new Promise<void>(resolve => {
    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity })
    stdout.on('line', line => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const parsed = JSON.parse(trimmed) as AppTestEvent
        if (parsed.type === 'result') {
          rawResult = redactAndTrim(parsed) as Record<string, unknown>
        } else {
          events.push(parsed)
        }
      } catch {
        events.push({ type: 'log', message: trimmed })
      }
    })
    stdout.on('close', resolve)
  })

  const stderrDone = new Promise<void>(resolve => {
    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity })
    stderr.on('line', line => {
      const trimmed = line.trim()
      if (trimmed) stderrLines.push(trimmed)
    })
    stderr.on('close', resolve)
  })

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, childSignal) =>
        resolve({ code, signal: childSignal }),
      )
    },
  ).finally(() => {
    signal?.removeEventListener('abort', onAbort)
  })

  child.stdin.end(JSON.stringify(request))
  const exit = await exitPromise
  await Promise.all([stdoutDone, stderrDone])

  if (stderrLines.length) {
    events.push({
      type: 'log',
      stream: 'stderr',
      message: stderrLines.slice(-20).join('\n'),
    })
  }

  const success = rawResult?.success === true
  const message = normalizePlaywrightMessage(
    String(
      rawResult?.message ||
        (signal?.aborted
          ? 'App/Web test was canceled.'
          : exit.signal
            ? `App/Web test exited by signal ${exit.signal}.`
            : `App/Web test exited with code ${exit.code ?? 'unknown'}.`),
    ),
  )
  const traceDir = input.trace_dir
  const compactEvents = truncateEvents(events)

  return {
    success,
    message,
    platform: platformOf(input),
    execution_mode: String(rawResult?.execution_mode || executionModeOf(input)),
    events: compactEvents,
    screenshots: collectScreenshots(events),
    assertions: collectAssertions(events),
    trace_path: extractTracePath(events, traceDir),
    trace_dir: traceDir,
    report_path: extractReportPath(events, rawResult, traceDir),
    post_run_guidance: APP_TEST_POST_RUN_GUIDANCE,
    raw_result: rawResult,
  }
}
