import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'path'
import { getSkillDirCommands, getDynamicSkills } from '../../skills/loadSkillsDir.js'
import { getBundledSkills } from '../../skills/bundledSkills.js'
import { initBundledSkills } from '../../skills/bundled/index.js'
import { getBuiltinPluginSkillCommands } from '../../plugins/builtinPlugins.js'
import { initBuiltinPlugins } from '../../plugins/bundled/index.js'
import { PRODUCT_PROJECT_CONFIG_DIR_NAME } from '../../constants/product.js'
import {
  getPluginCommands,
  getPluginSkills,
} from '../../utils/plugins/loadPluginCommands.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getManagedFilePath } from '../../utils/settings/managedPath.js'
import { clearCommandsCache } from '../../commands.js'
import {
  clearAgentDefinitionsCache,
  getAgentDefinitionsWithOverrides,
} from '../../tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../../types/command.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type {
  AssetDetail,
  AssetKind,
  AssetSource,
  AssetSummary,
  CreateSkillInput,
  ImportSkillInput,
  UpdateSkillInput,
} from './types.js'

const MAX_SKILL_FILE_BYTES = 1 * 1024 * 1024

type AssetFilters = {
  kind?: string | null
  source?: string | null
  q?: string | null
}

function encodeAssetId(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realpathIfExists(path: string): string {
  return existsSync(path) ? realpathSync(path) : realpathSync(dirname(path))
}

function getUserSkillsRoot(): string {
  return resolve(getClaudeConfigHomeDir(), 'skills')
}

function getProjectSkillsRoot(cwd: string): string {
  return resolve(cwd, PRODUCT_PROJECT_CONFIG_DIR_NAME, 'skills')
}

function sourceFromCommand(command: Command): AssetSource {
  const source = 'source' in command ? command.source : undefined
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'policySettings':
      return 'managed'
    case 'plugin':
      return 'plugin'
    case 'mcp':
      return 'mcp'
    case 'bundled':
      return 'bundled'
    default:
      return 'bundled'
  }
}

function kindFromCommand(command: Command, fallbackKind?: AssetKind): AssetKind {
  if (fallbackKind) return fallbackKind
  if (command.loadedFrom === 'plugin') return 'plugin-skill'
  if (command.loadedFrom === 'managed') return 'managed-skill'
  if (command.loadedFrom === 'bundled') return 'bundled-skill'
  if (command.loadedFrom === 'mcp') return 'mcp-skill'
  return 'skill'
}

function commandSkillFilePath(command: Command): string | undefined {
  if (command.type !== 'prompt' || !command.skillRoot) return undefined
  const skillPath = join(command.skillRoot, 'SKILL.md')
  return existsSync(skillPath) ? resolve(skillPath) : undefined
}

function canEditSkillPath(path: string | undefined, source: AssetSource, cwd: string): boolean {
  if (!path || basename(path).toLowerCase() !== 'skill.md') return false
  if (source !== 'user' && source !== 'project') return false

  const root = source === 'user' ? getUserSkillsRoot() : getProjectSkillsRoot(cwd)
  try {
    return isWithin(realpathIfExists(root), realpathIfExists(path))
  } catch {
    return false
  }
}

function commandToAsset(
  command: Command,
  cwd: string,
  fallbackKind?: AssetKind,
): AssetSummary {
  const source = sourceFromCommand(command)
  const kind = kindFromCommand(command, fallbackKind)
  const path = commandSkillFilePath(command)
  const enabled = command.isEnabled ? command.isEnabled() : true
  const readonly = kind !== 'skill' || !canEditSkillPath(path, source, cwd)
  const pluginInfo = 'pluginInfo' in command ? command.pluginInfo : undefined
  const key = [
    kind,
    source,
    path ?? pluginInfo?.repository ?? command.name,
  ].join(':')
  const displayName = command.userFacingName?.()

  return {
    id: encodeAssetId(key),
    name: command.name,
    displayName,
    kind,
    source,
    description: command.description,
    whenToUse: command.whenToUse,
    allowedTools: command.type === 'prompt' ? command.allowedTools : undefined,
    model: command.type === 'prompt' ? command.model : undefined,
    context: command.type === 'prompt' ? command.context : undefined,
    path,
    readonly,
    enabled,
    tags: command.loadedFrom ? [command.loadedFrom] : undefined,
  }
}

function agentToAsset(agent: AgentDefinition): AssetSummary | null {
  if (agent.source !== 'plugin') return null
  const key = ['plugin-agent', 'plugin', agent.plugin, agent.agentType].join(':')
  return {
    id: encodeAssetId(key),
    name: agent.agentType,
    displayName: agent.agentType,
    kind: 'plugin-agent',
    source: 'plugin',
    description: agent.whenToUse,
    readonly: true,
    enabled: true,
    tags: [agent.plugin],
  }
}

function mcpPlaceholderAsset(): AssetSummary {
  return {
    id: encodeAssetId('mcp-skill:mcp:runtime-placeholder'),
    name: 'mcp-runtime-skills',
    displayName: 'MCP runtime skills',
    kind: 'mcp-skill',
    source: 'mcp',
    description: 'MCP skills are available only during an active runtime session.',
    readonly: true,
    enabled: false,
    tags: ['runtime'],
  }
}

function ensureBundledRegistries(): void {
  if (getBundledSkills().length === 0) {
    initBundledSkills()
  }
  initBuiltinPlugins()
}

function matchesFilters(asset: AssetSummary, filters: AssetFilters): boolean {
  if (filters.kind && asset.kind !== filters.kind) return false
  if (filters.source && asset.source !== filters.source) return false
  const q = filters.q?.trim().toLowerCase()
  if (!q) return true
  return [
    asset.name,
    asset.displayName,
    asset.description,
    asset.whenToUse,
    asset.path,
    asset.kind,
    asset.source,
  ]
    .filter(Boolean)
    .some(value => String(value).toLowerCase().includes(q))
}

export async function listAssets(
  cwd: string,
  filters: AssetFilters = {},
): Promise<AssetSummary[]> {
  ensureBundledRegistries()
  const [
    skillDirCommands,
    pluginSkills,
    pluginCommands,
    pluginAgents,
  ] = await Promise.all([
    getSkillDirCommands(cwd).catch(() => [] as Command[]),
    getPluginSkills().catch(() => [] as Command[]),
    getPluginCommands().catch(() => [] as Command[]),
    getAgentDefinitionsWithOverrides(cwd)
      .then(agents => agents.map(agentToAsset).filter((asset): asset is AssetSummary => asset !== null))
      .catch(() => [] as AssetSummary[]),
  ])

  const assets = [
    ...skillDirCommands.map(command => commandToAsset(command, cwd)),
    ...getDynamicSkills().map(command => ({
      ...commandToAsset(command, cwd, 'dynamic-skill'),
      source: 'dynamic' as const,
      readonly: true,
    })),
    ...getBundledSkills().map(command => commandToAsset(command, cwd, 'bundled-skill')),
    ...getBuiltinPluginSkillCommands().map(command => commandToAsset(command, cwd, 'bundled-skill')),
    ...pluginSkills.map(command => commandToAsset(command, cwd, 'plugin-skill')),
    ...pluginCommands.map(command => commandToAsset(command, cwd, 'plugin-command')),
    ...pluginAgents,
    mcpPlaceholderAsset(),
  ]

  const deduped = new Map<string, AssetSummary>()
  for (const asset of assets) {
    deduped.set(asset.id, asset)
  }

  return Array.from(deduped.values())
    .filter(asset => matchesFilters(asset, filters))
    .sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source)
      if (sourceCompare !== 0) return sourceCompare
      return a.name.localeCompare(b.name)
    })
}

async function findAsset(cwd: string, assetId: string): Promise<AssetSummary> {
  const asset = (await listAssets(cwd)).find(candidate => candidate.id === assetId)
  if (!asset) {
    throw new Error('Asset was not found.')
  }
  return asset
}

function readAssetContent(asset: AssetSummary): Pick<AssetDetail, 'content' | 'frontmatter' | 'warnings'> {
  if (!asset.path) return { warnings: [] }
  const warnings: string[] = []
  const stats = statSync(asset.path)
  if (stats.size > MAX_SKILL_FILE_BYTES) {
    warnings.push('This asset file is larger than 1 MB and is read-only.')
    return { content: '', frontmatter: {}, warnings }
  }
  const content = readFileSync(asset.path, 'utf8')
  const { frontmatter } = parseFrontmatter(content, asset.path)
  return { content, frontmatter, warnings }
}

export async function getAssetDetail(cwd: string, assetId: string): Promise<AssetDetail> {
  const asset = await findAsset(cwd, assetId)
  if (asset.path && existsSync(asset.path)) {
    return { ...asset, ...readAssetContent(asset) }
  }
  return { ...asset, warnings: [] }
}

export function toSafeSkillName(name: string): string {
  const safe = name
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (!safe) {
    throw new Error('Skill name is required.')
  }
  return safe
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function normalizeAllowedTools(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function buildSkillMarkdown(input: CreateSkillInput): string {
  const name = input.name?.trim()
  if (!name) throw new Error('Skill name is required.')
  const description = input.description?.trim()
  if (!description) throw new Error('Skill description is required.')

  const lines = [
    '---',
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
  ]
  if (input.whenToUse?.trim()) {
    lines.push(`when_to_use: ${yamlString(input.whenToUse.trim())}`)
  }
  const allowedTools = normalizeAllowedTools(input.allowedTools)
  if (allowedTools.length > 0) {
    lines.push('allowed-tools:')
    for (const tool of allowedTools) {
      lines.push(`  - ${yamlString(tool)}`)
    }
  }
  if (input.context === 'inline' || input.context === 'fork') {
    lines.push(`context: ${input.context}`)
  }
  if (input.model?.trim() && input.model.trim() !== 'inherit') {
    lines.push(`model: ${yamlString(input.model.trim())}`)
  }
  lines.push('---', '')

  const body = input.content?.trim() ?? ''
  if (!body.startsWith('#')) {
    lines.push(`# ${name}`, '')
  }
  if (body) lines.push(body, '')
  return lines.join('\n')
}

function getSkillRootForScope(cwd: string, scope: 'user' | 'project'): string {
  return scope === 'user' ? getUserSkillsRoot() : getProjectSkillsRoot(cwd)
}

function writeSkillFile(filePath: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) {
    throw new Error('Skill content exceeds the 1 MB limit.')
  }
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, content, 'utf8')
  renameSync(tempPath, filePath)
}

function assertEditableSkill(asset: AssetSummary, cwd: string): string {
  if (asset.readonly || asset.kind !== 'skill') {
    throw new Error('Only user and project skills can be modified.')
  }
  if (!canEditSkillPath(asset.path, asset.source, cwd) || !asset.path) {
    throw new Error('Skill path is not editable.')
  }
  return asset.path
}

export async function createSkillAsset(
  cwd: string,
  input: CreateSkillInput,
): Promise<AssetDetail> {
  const scope = input.scope === 'user' ? 'user' : 'project'
  const safeName = toSafeSkillName(input.name ?? '')
  const skillDir = resolve(getSkillRootForScope(cwd, scope), safeName)
  const skillPath = join(skillDir, 'SKILL.md')
  const root = getSkillRootForScope(cwd, scope)

  if (!isWithin(resolve(root), skillPath)) {
    throw new Error('Skill path escapes the skill directory.')
  }
  if (existsSync(skillPath)) {
    throw new Error('Skill already exists.')
  }

  writeSkillFile(skillPath, buildSkillMarkdown(input))
  clearCommandsCache()
  clearAgentDefinitionsCache()
  const created = (await listAssets(cwd)).find(asset => asset.path === resolve(skillPath))
  if (!created) {
    return {
      id: encodeAssetId(['skill', scope, skillPath].join(':')),
      name: safeName,
      kind: 'skill',
      source: scope,
      path: resolve(skillPath),
      readonly: false,
      enabled: true,
      content: readFileSync(skillPath, 'utf8'),
      warnings: [],
    }
  }
  return getAssetDetail(cwd, created.id)
}

export async function updateSkillAsset(
  cwd: string,
  assetId: string,
  input: UpdateSkillInput,
): Promise<AssetDetail> {
  if (typeof input.content !== 'string') {
    throw new Error('Skill content must be a string.')
  }
  const asset = await findAsset(cwd, assetId)
  const skillPath = assertEditableSkill(asset, cwd)
  writeSkillFile(skillPath, input.content)
  clearCommandsCache()
  clearAgentDefinitionsCache()
  return getAssetDetail(cwd, assetId)
}

export async function deleteSkillAsset(
  cwd: string,
  assetId: string,
  confirm: unknown,
): Promise<void> {
  if (confirm !== true) {
    throw new Error('Deleting a skill requires confirm=true.')
  }
  const asset = await findAsset(cwd, assetId)
  const skillPath = assertEditableSkill(asset, cwd)
  unlinkSync(skillPath)
  const dir = dirname(skillPath)
  if (readdirSync(dir).length === 0) {
    rmdirSync(dir)
  }
  clearCommandsCache()
  clearAgentDefinitionsCache()
}

export async function importSkillAsset(
  cwd: string,
  input: ImportSkillInput,
): Promise<AssetDetail> {
  const content = input.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Imported SKILL.md content is required.')
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_FILE_BYTES) {
    throw new Error('Imported SKILL.md exceeds the 1 MB limit.')
  }
  const parsed = parseFrontmatter(content)
  const frontmatterName =
    typeof parsed.frontmatter.name === 'string'
      ? parsed.frontmatter.name
      : undefined
  const description =
    input.description?.trim() ||
    (typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description
      : undefined)
  if (!description) {
    throw new Error('Imported SKILL.md must include a description.')
  }

  const scope = input.scope === 'user' ? 'user' : 'project'
  const safeName = toSafeSkillName(input.name ?? frontmatterName ?? '')
  const skillDir = resolve(getSkillRootForScope(cwd, scope), safeName)
  const skillPath = join(skillDir, 'SKILL.md')
  if (existsSync(skillPath)) {
    throw new Error('Skill already exists.')
  }
  writeSkillFile(skillPath, content.endsWith('\n') ? content : `${content}\n`)
  clearCommandsCache()
  clearAgentDefinitionsCache()
  const created = (await listAssets(cwd)).find(asset => asset.path === resolve(skillPath))
  if (!created) throw new Error('Imported skill could not be reloaded.')
  return getAssetDetail(cwd, created.id)
}

export async function reloadAssets(cwd: string): Promise<{ count: number }> {
  clearCommandsCache()
  clearAgentDefinitionsCache()
  return { count: (await listAssets(cwd)).length }
}

export function getAssetRoots(cwd: string): {
  userSkillsDir: string
  projectSkillsDir: string
  managedSkillsDir: string
} {
  return {
    userSkillsDir: getUserSkillsRoot(),
    projectSkillsDir: getProjectSkillsRoot(cwd),
    managedSkillsDir: resolve(getManagedFilePath(), '.claude', 'skills'),
  }
}
