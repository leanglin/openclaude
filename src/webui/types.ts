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
}

export type ActivityKind =
  | 'thinking'
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
  | {
      type: 'permission_response'
      requestId: string
      action: PermissionAction
    }
  | { type: 'abort' }
  | { type: 'new_session' }

export type ServerEvent =
  | { type: 'ready'; bootstrap: BootstrapState }
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
