import { spawn, type SpawnOptions } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import treeKill from 'tree-kill'
import {
  extractClaudeCodeHints,
  type ClaudeCodeHint,
} from '../utils/claudeCodeHints.js'
import { resolvePluginHint } from '../utils/plugins/hintRecommendation.js'
import {
  buildControlResponse,
  buildPermissionControlResult,
  buildUserMessage,
  getStreamTextDelta,
  getTextContent,
  getToolDisplayName,
  getToolResultBlocks,
  getToolUseBlocks,
  parseStdoutLine,
  serializeStdinMessage,
  type CliMessage,
} from './protocol.js'
import {
  collectKnownSecrets,
  redactSensitiveText,
  redactServerEvent,
} from './redaction.js'
import type {
  ActivityKind,
  ClientMessage,
  PermissionRequestEvent,
  ServerEvent,
} from './types.js'

type ChildLike = {
  pid?: number
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed?: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: string, listener: (...args: unknown[]) => void): ChildLike
}

export type SpawnFactory = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildLike

export type CliChatSessionOptions = {
  cwd: string
  permissionMode: string
  send: (event: ServerEvent) => void
  spawnFactory?: SpawnFactory
  cliCommand?: string
  env?: NodeJS.ProcessEnv
  replaceEnv?: boolean
  secrets?: readonly string[]
  sessionId?: string
  resumeSession?: boolean
}

type PendingPermission = PermissionRequestEvent
type CliLaunch = {
  command: string
  args: string[]
  shell: false
}

const ABORT_FORCE_KILL_DELAY_MS = 2_000
const MIDSCENE_MODEL_ENV_KEYS = [
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const
const MIDSCENE_CONFIG_SOURCE_ENV = 'OPENCAT_APP_TEST_MIDSCENE_CONFIG_SOURCE'

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function killChild(child: ChildLike, signal: NodeJS.Signals): void {
  if (typeof child.pid === 'number' && child.pid > 0) {
    treeKill(child.pid, signal, () => {})
    return
  }
  try {
    child.kill(signal)
  } catch {
    // Best-effort cleanup only; the caller may already be tearing down.
  }
}

export function resolveCliLaunch(options: {
  streamArgs: string[]
  cliCommand?: string
  argv?: readonly string[]
  execPath?: string
}): CliLaunch {
  const streamArgs = [...options.streamArgs]
  if (options.cliCommand) {
    return {
      command: options.cliCommand,
      args: streamArgs,
      shell: false,
    }
  }

  const execPath = options.execPath || process.execPath || 'opencat'
  const entrypoint = (options.argv ?? process.argv)[1]
  return {
    command: execPath,
    args: entrypoint ? [entrypoint, ...streamArgs] : streamArgs,
    shell: false,
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function configured(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
}

function formatMidsceneConfigSource(source: unknown): string | undefined {
  const text = firstString(source)
  switch (text) {
    case 'saved-profile':
      return 'saved profile'
    case 'process-env':
      return 'process env'
    case 'legacy-env':
      return 'legacy env'
    case 'missing':
      return 'missing configuration'
    default:
      return text
  }
}

function formatCliLaunchDetail(launch: CliLaunch, cwd: string): string {
  const entrypoint = launch.args[0] || '(direct executable)'
  return `command=${launch.command}; entrypoint=${entrypoint}; cwd=${cwd}`
}

function formatMidsceneEnvDiagnostic(env: NodeJS.ProcessEnv | undefined): string {
  const missing = MIDSCENE_MODEL_ENV_KEYS.filter(key => !configured(env?.[key]))
  const source = formatMidsceneConfigSource(env?.[MIDSCENE_CONFIG_SOURCE_ENV])
  if (missing.length === 0) {
    return `Midscene env: configured from ${source || 'process env'}`
  }
  return `Midscene env: missing ${missing.join(', ')}${source ? ` (source: ${source})` : ''}`
}

function toOpenCatVisibleText(value: string | undefined): string | undefined {
  return value
    ?.replace(/\bOpen Claude\b/g, 'OpenCat')
    .replace(/\bOpenClaude\b/g, 'OpenCat')
    .replace(/\bopenclaude\b/g, 'opencat')
}

function normalizePermissionRequest(message: CliMessage): PermissionRequestEvent {
  const request = asObject(message.request)
  const input = asObject(request.input)
  const requestId =
    firstString(message.request_id, request.request_id) ?? nextId('permission')
  const rawToolName = firstString(
    request.name,
    request.tool_name,
    request.display_name,
    request.title,
  )
  const toolName = getToolDisplayName(rawToolName)
  const prompt = toOpenCatVisibleText(firstString(
    request.prompt,
    request.description,
    request.title,
    request.display_name,
  ))

  return {
    requestId,
    toolName,
    toolUseId: firstString(request.tool_use_id, input.tool_use_id),
    input,
    permissionSuggestions: Array.isArray(request.permission_suggestions)
      ? request.permission_suggestions
      : undefined,
    prompt,
  }
}

function stringifyToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  try {
    return JSON.stringify(input)
  } catch {
    return undefined
  }
}

function activityKindForTool(toolName: string): ActivityKind {
  const normalized = toolName.toLowerCase()
  if (normalized.includes('read')) return 'read'
  if (normalized.includes('grep') || normalized.includes('glob')) return 'grep'
  if (normalized.includes('edit') || normalized.includes('write')) return 'edit'
  return 'status'
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
}

function formatPreflightActivityDetail(payload: Record<string, unknown>): string | undefined {
  if (payload.platform !== 'android') return undefined

  const devices = stringList(payload.connected_devices)
  const missingMidscene = stringList(payload.missing_midscene_env_keys)
  const missingAndroid = stringList(payload.missing_android_env_keys)
  const adbReady = payload.adb_available === true
  const androidSdkConfigured = payload.android_sdk_configured === true
  const midsceneConfigured = payload.midscene_model_configured === true
  const adbStatus = adbReady
    ? `ADB: ready${devices.length ? ` / device ${devices.join(', ')}` : ''}`
    : `ADB: unavailable${typeof payload.adb_error === 'string' ? ` (${payload.adb_error})` : ''}`
  const sdkStatus = androidSdkConfigured
    ? 'Android SDK env: configured'
    : `Android SDK env: unset${missingAndroid.length ? ` (${missingAndroid.join(', ')})` : ''}`
  const midsceneSource = formatMidsceneConfigSource(payload.midscene_config_source)
  const midsceneStatus = midsceneConfigured
    ? `Midscene model: configured${midsceneSource ? ` from ${midsceneSource}` : ''}`
    : `Midscene model: missing ${missingMidscene.length ? missingMidscene.join(', ') : 'configuration'}${midsceneSource ? ` (source: ${midsceneSource})` : ''}`

  return `${adbStatus} / ${sdkStatus} / ${midsceneStatus}`
}

function extractPreflightActivityDetail(content: string | undefined): string | undefined {
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content)
    const events = Array.isArray(parsed?.events) ? parsed.events : []
    const event = events.find((item: unknown) => {
      const record = asObject(item)
      return record.event_type === 'visual_preflight_checked'
    })
    const payload = asObject(asObject(event).payload)
    return formatPreflightActivityDetail(payload)
  } catch {
    return undefined
  }
}

export class CliChatSession {
  private child: ChildLike | null = null
  private stdoutBuffer = ''
  private pendingPermissions = new Map<string, PendingPermission>()
  private currentMessageId: string | null = null
  private currentMessageContent = ''
  private readonly secrets: string[]
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null
  private shownPluginRecommendations = new Set<string>()

  constructor(private readonly options: CliChatSessionOptions) {
    const effectiveEnv = options.replaceEnv
      ? options.env ?? {}
      : { ...process.env, ...(options.env ?? {}) }
    this.secrets = [
      ...collectKnownSecrets(effectiveEnv),
      ...(options.secrets ?? []),
    ]
  }

  get running(): boolean {
    return this.child !== null && !this.child.killed
  }

  start(): void {
    if (this.child) return
    const streamArgs = [
      '--print',
      '--verbose',
      '--input-format=stream-json',
      '--output-format=stream-json',
      '--include-partial-messages',
      '--permission-prompt-tool',
      'stdio',
      '--permission-mode',
      this.options.permissionMode || 'acceptEdits',
    ]
    if (this.options.sessionId) {
      if (this.options.resumeSession) {
        streamArgs.push('--resume', this.options.sessionId)
      } else {
        streamArgs.push('--session-id', this.options.sessionId)
      }
    }
    const launch = resolveCliLaunch({
      streamArgs,
      cliCommand: this.options.cliCommand,
    })
    const spawnFactory = this.options.spawnFactory ?? (spawn as unknown as SpawnFactory)
    const childEnv = this.options.replaceEnv
      ? { ...(this.options.env ?? {}) }
      : { ...process.env, ...(this.options.env ?? {}) }
    const spawnOptions: SpawnOptions = {
      cwd: this.options.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: launch.shell,
      windowsHide: true,
    }
    const child = spawnFactory(launch.command, launch.args, spawnOptions)
    this.child = child
    this.sendActivity('status', 'CLI launch', formatCliLaunchDetail(launch, this.options.cwd))
    this.sendActivity('status', 'Midscene config', formatMidsceneEnvDiagnostic(spawnOptions.env))
    child.stdout.setEncoding?.('utf8')
    child.stderr.setEncoding?.('utf8')
    child.stdout.on('data', chunk => this.handleStdout(String(chunk)))
    child.stderr.on('data', chunk => this.handleStderr(String(chunk)))
    child.on('error', error => {
      this.send({
        type: 'error',
        message: redactSensitiveText(String(error), this.secrets),
      })
    })
    child.on('close', (code, signal) => {
      if (this.child === child) {
        this.child = null
      }
      this.clearForceKillTimer()
      this.pendingPermissions.clear()
      this.sendActivity('status', 'Session ended', `code=${String(code)} signal=${String(signal)}`)
      this.send({ type: 'status', status: 'Ready', detail: 'Session ended' })
    })
    this.send({ type: 'status', status: 'Running', detail: 'Chat session started' })
  }

  handleClientMessage(message: ClientMessage): void {
    switch (message.type) {
      case 'start_session':
        this.start()
        break
      case 'send_message':
        this.sendUserMessage(message.text)
        break
      case 'permission_response':
        this.sendPermissionResponse(message.requestId, message.action)
        break
      case 'abort':
        this.abort()
        break
      case 'new_session':
        this.dispose()
        this.start()
        break
      case 'refresh_session':
        this.dispose()
        break
      case 'select_session':
      case 'delete_session':
        break
    }
  }

  sendUserMessage(text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.start()
    this.write(buildUserMessage(trimmed))
    this.sendActivity('status', 'User message', 'Sent to local CLI')
  }

  sendPermissionResponse(requestId: string, action: 'allow' | 'deny' | 'allow-session'): void {
    const request = this.pendingPermissions.get(requestId)
    if (!request) {
      this.send({ type: 'error', message: 'Permission request is no longer pending.' })
      return
    }
    this.pendingPermissions.delete(requestId)
    const result = buildPermissionControlResult(action, {
      input: request.input,
      toolUseId: request.toolUseId,
      permissionSuggestions: request.permissionSuggestions,
    })
    this.write(buildControlResponse(requestId, result))
    this.sendActivity('permission', 'Permission response', action)
  }

  abort(): void {
    const child = this.child
    this.pendingPermissions.clear()
    if (!child) {
      this.send({ type: 'status', status: 'Ready', detail: 'No running session' })
      return
    }
    this.send({ type: 'status', status: 'Stopping', detail: 'Interrupting session' })
    this.sendActivity('status', 'Abort requested', 'Sent interrupt to session')
    this.clearForceKillTimer()
    try {
      child.kill('SIGINT')
    } catch {
      killChild(child, 'SIGTERM')
    }
    if (this.child !== child) return
    this.forceKillTimer = setTimeout(() => {
      if (this.child === child) {
        killChild(child, 'SIGTERM')
      }
    }, ABORT_FORCE_KILL_DELAY_MS)
    this.forceKillTimer.unref?.()
  }

  dispose(): void {
    this.clearForceKillTimer()
    const child = this.child
    if (child) {
      this.child = null
      killChild(child, 'SIGTERM')
    }
    this.pendingPermissions.clear()
  }

  private clearForceKillTimer(): void {
    if (!this.forceKillTimer) return
    clearTimeout(this.forceKillTimer)
    this.forceKillTimer = null
  }

  private write(message: unknown): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('Chat session is not running.')
    }
    this.child.stdin.write(serializeStdinMessage(message))
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const message = parseStdoutLine(line)
      if (message) this.handleCliMessage(message)
    }
  }

  private handleStderr(chunk: string): void {
    const { hints, stripped } = extractClaudeCodeHints(chunk, 'web-cli-stderr')
    for (const hint of hints) {
      this.emitPluginRecommendationFromHint(hint)
    }
    const trimmed = stripped.trim()
    if (!trimmed) return
    if (/^\(node:\d+\)|^DeprecationWarning|^ExperimentalWarning/i.test(trimmed)) {
      return
    }
    this.sendActivity('error', 'CLI stderr', redactSensitiveText(trimmed, this.secrets))
  }

  private emitPluginRecommendationFromHint(hint: ClaudeCodeHint): void {
    if (this.shownPluginRecommendations.has(hint.value)) return
    this.shownPluginRecommendations.add(hint.value)
    void resolvePluginHint(hint)
      .then(recommendation => {
        if (!recommendation) return
        this.send({
          type: 'plugin_recommendation',
          recommendation: {
            pluginId: recommendation.pluginId,
            pluginName: recommendation.pluginName,
            marketplaceName: recommendation.marketplaceName,
            description: recommendation.pluginDescription,
            reason: 'Existing hint protocol reported this plugin for the current tool output.',
            source: recommendation.sourceCommand,
          },
        })
      })
      .catch(() => {})
  }

  private handleCliMessage(message: CliMessage): void {
    switch (message.type) {
      case 'system':
        this.sendActivity('status', 'System ready', this.extractSystemDetail(message))
        break
      case 'stream_event':
        this.handleStreamEvent(message)
        break
      case 'partial':
      case 'assistant':
        this.handleAssistantMessage(message)
        break
      case 'user':
        this.handleUserEcho(message)
        break
      case 'result':
        this.handleResultMessage(message)
        break
      case 'control_request':
        this.handleControlRequest(message)
        break
      case 'tool_progress':
      case 'status':
      case 'rate_limit':
        this.sendActivity('status', getToolDisplayName(message.type), this.extractStatusDetail(message))
        break
      default:
        this.sendActivity('status', getToolDisplayName(message.type), this.extractStatusDetail(message))
        break
    }
  }

  private handleStreamEvent(message: CliMessage): void {
    const event = message.event ?? {}
    const eventType = event.type
    if (eventType === 'message_start') {
      this.currentMessageId = nextId('assistant')
      this.currentMessageContent = ''
      this.send({ type: 'stream_start', messageId: this.currentMessageId })
      this.sendActivity('thinking', 'Thinking', 'Assistant is preparing a response')
      return
    }

    if (eventType === 'content_block_start') {
      const block = asObject(event.content_block)
      if (block.type === 'tool_use') {
        const id = typeof block.id === 'string' ? block.id : nextId('tool')
        const name = getToolDisplayName(block.name)
        this.send({
          type: 'tool',
          id,
          name,
          input: block.input,
          status: 'started',
          summary: stringifyToolInput(block.input),
        })
        this.sendActivity(activityKindForTool(name), name, stringifyToolInput(block.input))
      }
      return
    }

    if (eventType === 'content_block_delta') {
      const delta = getStreamTextDelta(event)
      if (!delta || !this.currentMessageId) return
      this.currentMessageContent += delta
      this.send({
        type: 'stream_delta',
        messageId: this.currentMessageId,
        delta,
      })
      return
    }

    if (eventType === 'message_stop' && this.currentMessageId) {
      this.send({
        type: 'stream_end',
        messageId: this.currentMessageId,
        content: this.currentMessageContent,
      })
      this.currentMessageId = null
      this.currentMessageContent = ''
    }
  }

  private handleAssistantMessage(message: CliMessage): void {
    const assistantMessage = message.message
    const content = getTextContent(assistantMessage)
    if (content) {
      const messageId = this.currentMessageId ?? nextId('assistant')
      this.send({
        type: 'chat_message',
        role: 'assistant',
        messageId,
        content,
        final: message.type === 'assistant',
      })
      if (message.type === 'assistant') {
        this.currentMessageId = null
        this.currentMessageContent = ''
      }
    }
    for (const block of getToolUseBlocks(assistantMessage)) {
      const id = typeof block.id === 'string' ? block.id : nextId('tool')
      const name = getToolDisplayName(block.name)
      this.send({
        type: 'tool',
        id,
        name,
        input: block.input,
        status: 'started',
        summary: stringifyToolInput(block.input),
      })
      this.sendActivity(activityKindForTool(name), name, stringifyToolInput(block.input))
    }
  }

  private handleUserEcho(message: CliMessage): void {
    for (const block of getToolResultBlocks(message.message)) {
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : nextId('tool')
      const content =
        typeof block.content === 'string'
          ? block.content
          : stringifyToolInput(block.content)
      this.send({
        type: 'tool',
        id,
        name: 'Tool result',
        status: 'completed',
        summary: content,
      })
      this.sendActivity('result', 'Result ready', content)
      const preflightDetail = extractPreflightActivityDetail(content)
      if (preflightDetail) this.sendActivity('preflight', 'Preflight', preflightDetail)
    }
  }

  private handleResultMessage(message: CliMessage): void {
    const detail = this.extractStatusDetail(message)
    this.sendActivity('result', 'Result ready', detail)
    this.send({ type: 'status', status: 'Ready', detail })
  }

  private handleControlRequest(message: CliMessage): void {
    const permission = normalizePermissionRequest(message)
    this.pendingPermissions.set(permission.requestId, permission)
    this.send({ type: 'permission_request', request: permission })
    this.sendActivity('permission', 'Permission requested', permission.toolName)
  }

  private extractSystemDetail(message: CliMessage): string | undefined {
    if (typeof message.session_id === 'string') return `session ${message.session_id}`
    return this.extractStatusDetail(message)
  }

  private extractStatusDetail(message: CliMessage): string | undefined {
    const candidates = [
      message.message,
      message.result,
      message.error,
      message.status,
      message.subtype,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return undefined
  }

  private sendActivity(kind: ActivityKind, title: string, detail?: string): void {
    this.send({
      type: 'activity',
      activity: {
        id: nextId('activity'),
        kind,
        title,
        detail,
        at: Date.now(),
      },
    })
  }

  private send(event: ServerEvent): void {
    this.options.send(redactServerEvent(event, this.secrets))
  }
}
