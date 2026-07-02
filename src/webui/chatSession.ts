import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
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
  secrets?: readonly string[]
}

type PendingPermission = PermissionRequestEvent
type CliLaunch = {
  command: string
  args: string[]
  shell: false
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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

  const execPath = options.execPath || process.execPath || 'openclaude'
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

export class CliChatSession {
  private child: ChildLike | null = null
  private stdoutBuffer = ''
  private pendingPermissions = new Map<string, PendingPermission>()
  private currentMessageId: string | null = null
  private currentMessageContent = ''
  private readonly secrets: string[]

  constructor(private readonly options: CliChatSessionOptions) {
    this.secrets = [
      ...collectKnownSecrets(options.env ?? process.env),
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
      '--permission-mode',
      this.options.permissionMode || 'acceptEdits',
    ]
    const launch = resolveCliLaunch({
      streamArgs,
      cliCommand: this.options.cliCommand,
    })
    const spawnFactory = this.options.spawnFactory ?? (spawn as unknown as SpawnFactory)
    const spawnOptions: SpawnOptions = {
      cwd: this.options.cwd,
      env: { ...process.env, ...(this.options.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: launch.shell,
      windowsHide: true,
    }
    this.child = spawnFactory(launch.command, launch.args, spawnOptions)
    this.child.stdout.setEncoding?.('utf8')
    this.child.stderr.setEncoding?.('utf8')
    this.child.stdout.on('data', chunk => this.handleStdout(String(chunk)))
    this.child.stderr.on('data', chunk => this.handleStderr(String(chunk)))
    this.child.on('error', error => {
      this.send({
        type: 'error',
        message: redactSensitiveText(String(error), this.secrets),
      })
    })
    this.child.on('close', (code, signal) => {
      this.child = null
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
    if (!this.child) return
    this.child.kill('SIGINT')
    this.sendActivity('status', 'Abort requested', 'Sent interrupt to session')
  }

  dispose(): void {
    if (this.child) {
      this.child.kill('SIGTERM')
      this.child = null
    }
    this.pendingPermissions.clear()
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
    const trimmed = chunk.trim()
    if (!trimmed) return
    if (/^\(node:\d+\)|^DeprecationWarning|^ExperimentalWarning/i.test(trimmed)) {
      return
    }
    this.sendActivity('error', 'CLI stderr', redactSensitiveText(trimmed, this.secrets))
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
    }
  }

  private handleResultMessage(message: CliMessage): void {
    const detail = this.extractStatusDetail(message)
    this.sendActivity('result', 'Result ready', detail)
    this.send({ type: 'status', status: 'Ready', detail })
  }

  private handleControlRequest(message: CliMessage): void {
    const request = asObject(message.request)
    const requestId =
      typeof message.request_id === 'string'
        ? message.request_id
        : typeof request.request_id === 'string'
          ? request.request_id
          : nextId('permission')
    const input = asObject(request.input)
    const permission: PermissionRequestEvent = {
      requestId,
      toolName: getToolDisplayName(request.name ?? request.tool_name),
      toolUseId:
        typeof request.tool_use_id === 'string'
          ? request.tool_use_id
          : typeof input.tool_use_id === 'string'
            ? input.tool_use_id
            : undefined,
      input,
      permissionSuggestions: Array.isArray(request.permission_suggestions)
        ? request.permission_suggestions
        : undefined,
      prompt: typeof request.prompt === 'string' ? request.prompt : undefined,
    }
    this.pendingPermissions.set(requestId, permission)
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
