import type { ProfileFileLocation, ProviderProfile } from '../utils/providerProfile.js'

export type WebUiPermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'
  | 'fullAccess'
  | 'plan'

export type PrimaryMenuId =
  | 'chat'
  | 'memory'
  | 'assets'
  | 'providers'
  | 'sessions'
  | 'tools'
  | 'settings'

export type ProviderProfileKind =
  | 'openai-compatible'
  | 'ollama'
  | 'gemini'
  | 'mistral'

export type ProviderProfilePayload = {
  provider: ProviderProfileKind
  baseUrl?: string
  model?: string
  apiKey?: string
  midscene?: MidsceneProfilePayload
}

export type ProviderProfileSummary = {
  provider: ProviderProfile
  displayName: string
  model?: string
  baseUrl?: string
  credentialConfigured: boolean
  credentialKeys: string[]
  filePath?: string
  createdAt?: string
}

export type MidsceneProfilePayload = {
  model?: string
  baseUrl?: string
  apiKey?: string
  modelFamily?: string
}

export type MidsceneProfileSummary = {
  model?: string
  baseUrl?: string
  modelFamily?: string
  credentialConfigured: boolean
  credentialKeys: string[]
}

export type ProviderOption = {
  id: ProviderProfileKind
  label: string
  description: string
  defaultBaseUrl?: string
  defaultModel: string
  requiresApiKey: boolean
  localKeyOptional?: boolean
}

export type PrimaryMenuOption = {
  id: PrimaryMenuId
  label: string
  icon: string
}

export type BootstrapState = {
  cwd: string
  permissionMode: string
  profile: ProviderProfileSummary | null
  midsceneProfile: MidsceneProfileSummary | null
  chatSessions: WebChatSessionSummary[]
  activeChatSessionId?: string
  providers: ProviderOption[]
  primaryMenus: PrimaryMenuOption[]
  redaction: {
    profile: 'default'
    protectedKeys: string[]
  }
}

export type BootstrapOptions = {
  cwd: string
  permissionMode: string
  profileLocation?: ProfileFileLocation
  chatSessions?: WebChatSessionSummary[]
  activeChatSessionId?: string
}

export type WebChatSessionSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type WebChatMessage = {
  messageId: string
  role: 'assistant' | 'user' | 'system'
  content: string
}

export type ActivityKind =
  | 'thinking'
  | 'preflight'
  | 'read'
  | 'grep'
  | 'edit'
  | 'permission'
  | 'result'
  | 'status'
  | 'error'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  title: string
  detail?: string
  at: number
}

export type PermissionRequestEvent = {
  requestId: string
  toolName: string
  toolUseId?: string
  input?: Record<string, unknown>
  permissionSuggestions?: unknown[]
  prompt?: string
}

export type PermissionAction = 'allow' | 'deny' | 'allow-session'

export type ClientMessage =
  | { type: 'start_session' }
  | { type: 'send_message'; text: string }
  | { type: 'select_session'; sessionId: string }
  | { type: 'delete_session'; sessionId: string }
  | {
      type: 'permission_response'
      requestId: string
      action: PermissionAction
    }
  | { type: 'abort' }
  | { type: 'new_session' }
  | { type: 'refresh_session' }

export type ServerEvent =
  | { type: 'ready'; bootstrap: BootstrapState }
  | {
      type: 'sessions_updated'
      sessions: WebChatSessionSummary[]
      activeSessionId?: string
    }
  | {
      type: 'session_loaded'
      sessionId?: string
      messages: WebChatMessage[]
    }
  | { type: 'status'; status: string; detail?: string }
  | { type: 'activity'; activity: ActivityItem }
  | { type: 'stream_start'; messageId: string }
  | { type: 'stream_delta'; messageId: string; delta: string }
  | { type: 'stream_end'; messageId: string; content?: string }
  | {
      type: 'chat_message'
      messageId: string
      role: 'assistant' | 'user' | 'system'
      content: string
      final?: boolean
    }
  | {
      type: 'tool'
      id: string
      name: string
      input?: unknown
      status: 'started' | 'progress' | 'completed'
      summary?: string
    }
  | { type: 'permission_request'; request: PermissionRequestEvent }
  | { type: 'error'; message: string }
