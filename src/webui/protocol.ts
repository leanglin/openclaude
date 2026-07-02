import type { PermissionAction } from './types.js'

export type CliMessage = Record<string, unknown> & {
  type?: string
  session_id?: string
  message?: {
    content?: unknown
  }
  event?: Record<string, unknown>
  request_id?: string
  request?: Record<string, unknown>
}

export type PermissionControlContext = {
  input?: Record<string, unknown> | null
  toolUseId?: string | null
  permissionSuggestions?: unknown[] | null
}

export function parseStdoutLine(line: string): CliMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function serializeStdinMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

export function buildUserMessage(text: string): Record<string, unknown> {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: text,
    },
    parent_tool_use_id: null,
  }
}

export function buildControlResponse(
  requestId: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: result || {},
    },
  }
}

export function buildPermissionControlResult(
  action: PermissionAction,
  context: PermissionControlContext = {},
): Record<string, unknown> {
  const toolUseID = context.toolUseId || undefined
  const input =
    context.input && typeof context.input === 'object' && !Array.isArray(context.input)
      ? context.input
      : {}

  if (action === 'deny') {
    return {
      behavior: 'deny',
      message: 'User denied permission',
      toolUseID,
    }
  }

  const result: Record<string, unknown> = {
    behavior: 'allow',
    updatedInput: input,
    toolUseID,
  }

  if (action === 'allow-session') {
    const suggestions = Array.isArray(context.permissionSuggestions)
      ? context.permissionSuggestions
      : []
    if (suggestions.length > 0) {
      result.updatedPermissions = suggestions
    }
  }

  return result
}

function asContentArray(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content)
    ? content.filter(item => item && typeof item === 'object') as Record<string, unknown>[]
    : []
}

export function getTextContent(message: { content?: unknown } | undefined): string {
  if (!message) return ''
  return asContentArray(message.content)
    .filter(block => block.type === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .join('')
}

export function getToolUseBlocks(
  message: { content?: unknown } | undefined,
): Record<string, unknown>[] {
  if (!message) return []
  return asContentArray(message.content).filter(block => block.type === 'tool_use')
}

export function getToolResultBlocks(
  message: { content?: unknown } | undefined,
): Record<string, unknown>[] {
  if (!message) return []
  return asContentArray(message.content).filter(block => block.type === 'tool_result')
}

export function getStreamTextDelta(event: Record<string, unknown> | undefined): string {
  const delta = event?.delta
  if (!delta || typeof delta !== 'object') return ''
  const typedDelta = delta as Record<string, unknown>
  if (typeof typedDelta.text === 'string') return typedDelta.text
  if (typeof typedDelta.thinking === 'string') return typedDelta.thinking
  return ''
}

export function getToolDisplayName(name: unknown): string {
  return typeof name === 'string' && name.trim() ? name.trim() : 'Tool'
}
