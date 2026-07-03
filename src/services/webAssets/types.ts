export type AssetKind =
  | 'skill'
  | 'plugin-skill'
  | 'plugin-command'
  | 'plugin-agent'
  | 'mcp-skill'
  | 'bundled-skill'
  | 'managed-skill'
  | 'dynamic-skill'

export type AssetSource =
  | 'user'
  | 'project'
  | 'managed'
  | 'plugin'
  | 'mcp'
  | 'bundled'
  | 'dynamic'

export type AssetSummary = {
  id: string
  name: string
  displayName?: string
  kind: AssetKind
  source: AssetSource
  description?: string
  whenToUse?: string
  allowedTools?: string[]
  model?: string
  context?: 'inline' | 'fork'
  path?: string
  readonly: boolean
  enabled: boolean
  updatedAt?: string
  tags?: string[]
}

export type AssetDetail = AssetSummary & {
  content?: string
  frontmatter?: Record<string, unknown>
  plugin?: {
    name: string
    marketplace?: string
    version?: string
    manifestPath?: string
  }
  mcp?: {
    serverName?: string
    toolName?: string
  }
  warnings?: string[]
}

export type CreateSkillInput = {
  scope?: 'user' | 'project'
  name?: string
  description?: string
  whenToUse?: string
  allowedTools?: string[]
  context?: 'inline' | 'fork' | ''
  model?: string
  content?: string
}

export type UpdateSkillInput = {
  content?: string
}

export type ImportSkillInput = {
  scope?: 'user' | 'project'
  name?: string
  description?: string
  content?: string
}
