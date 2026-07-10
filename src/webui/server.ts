import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { getCommands, isBridgeSafeCommand } from '../commands.js'
import { PRODUCT_PROJECT_CONFIG_DIR_NAME } from '../constants/product.js'
import { openBrowser as openSystemBrowser } from '../utils/browser.js'
import { getClaudeConfigHomeDir, parseEnvVars } from '../utils/envUtils.js'
import { PERMISSION_MODES } from '../utils/permissions/PermissionMode.js'
import type { ProfileFileLocation } from '../utils/providerProfile.js'
import { generateCommandSuggestions } from '../utils/suggestions/commandSuggestions.js'
import { getCommandName, type Command } from '../types/command.js'
import { CliChatSession, type SpawnFactory } from './chatSession.js'
import {
  buildBootstrapState,
  buildWebSessionEnv,
  saveProviderProfileFromPayload,
} from './providerProfile.js'
import {
  clearMemoryKnowledgeGraph,
  createMemoryFile,
  deleteMemoryFile,
  getMemoryFile,
  getMemoryKnowledgeGraph,
  getMemoryStatus,
  listMemoryFiles,
  saveMemoryFile,
  searchMemoryFiles,
  updateKnowledgeGraphEnabled,
} from '../services/webMemory/memoryStore.js'
import {
  createKnowledgeAsset,
  createSkillAsset,
  deleteKnowledgeAsset,
  deleteSkillAsset,
  getAssetDetail,
  getAssetRoots,
  importHubKnowledgeAsset,
  importHubSkillAsset,
  importKnowledgeAsset,
  importSkillAsset,
  listAssets,
  reloadAssets,
  updateKnowledgeAsset,
  updateSkillAsset,
} from '../services/webAssets/assetStore.js'
import {
  clearPlatformAuthSession,
  getPlatformAuthStatus,
  getPlatformCaptcha,
  loadPlatformAuthSession,
  loginPlatformPassword,
  loginPlatformSso,
  sendPlatformSsoCode,
} from '../services/platformAuth/index.js'
import {
  collectPlatformUsageSummary,
  reportPlatformUsage,
} from '../services/platformUsage/index.js'
import {
  downloadAssetHubAsset,
  getAssetHubAsset,
  listAssetHubAssets,
  previewAssetHubAsset,
  uploadAssetToHub,
  voteAssetHubAsset,
} from '../services/platformAssetHub/index.js'
import {
  addMcpConfig,
  getMcpConfigsByScope,
  removeMcpConfig,
} from '../services/mcp/config.js'
import type {
  McpServerConfig,
  ScopedMcpServerConfig,
} from '../services/mcp/types.js'
import {
  describeMcpConfigFilePath,
  ensureTransport,
  parseHeaders,
} from '../services/mcp/utils.js'
import { runWithCwdOverride } from '../utils/cwd.js'
import { clearAllCaches } from '../utils/plugins/cacheUtils.js'
import { getInstallCounts } from '../utils/plugins/installCounts.js'
import {
  isInstallationRelevantToCurrentProject,
  isPluginInstalled,
  loadInstalledPluginsV2,
} from '../utils/plugins/installedPluginsManager.js'
import {
  createPluginId,
  getMarketplaceSourceDisplay,
  loadMarketplacesWithGracefulDegradation,
} from '../utils/plugins/marketplaceHelpers.js'
import {
  addMarketplaceSource,
  getPluginById,
  loadKnownMarketplacesConfig,
  saveMarketplaceToSettings,
} from '../utils/plugins/marketplaceManager.js'
import { getUnconfiguredChannels } from '../utils/plugins/mcpPluginIntegration.js'
import { parseMarketplaceInput } from '../utils/plugins/parseMarketplaceInput.js'
import { installPluginFromMarketplace } from '../utils/plugins/pluginInstallationHelpers.js'
import { parsePluginIdentifier } from '../utils/plugins/pluginIdentifier.js'
import { loadAllPlugins } from '../utils/plugins/pluginLoader.js'
import { getUnconfiguredOptions } from '../utils/plugins/pluginOptionsStorage.js'
import { isPluginBlockedByPolicy } from '../utils/plugins/pluginPolicy.js'
import type { PluginMarketplaceEntry } from '../utils/plugins/schemas.js'
import type { PluginScope } from '../utils/plugins/schemas.js'
import {
  isPluginEnabledAtProjectScope,
  uninstallPluginOp,
} from '../services/plugins/pluginOperations.js'
import { renderWebUiPage } from './page.js'
import {
  attachmentTitleFallback,
  prependAttachmentReferences,
  stageWebMessageAttachments,
} from './attachments.js'
import {
  createWebChatSession,
  deleteWebChatSession,
  getWebChatSession,
  hasWebChatTranscriptMessages,
  listWebChatSessions,
  loadWebChatMessages,
  migrateWebChatSessionsToCwd,
  touchWebChatSessionWithUserMessage,
  type WebChatSessionStoreLocation,
} from './sessionStore.js'
import type {
  BootstrapState,
  ClientMessage,
  ProviderProfilePayload,
  ServerEvent,
  WebMcpServerAddResult,
  WebMcpServerScope,
  WebMcpServerSummary,
  WebPluginInstallResult,
  WebPluginInstalledScope,
  WebPluginMarketplaceSummary,
  WebPluginScope,
  WebPluginSummary,
  WebPluginUninstallResult,
  WebCommandSuggestion,
  WebUiPermissionMode,
} from './types.js'

type WebUiServerOptions = {
  host?: string
  port?: number | string
  cwd?: string
  permissionMode?: string
  openBrowser?: boolean
  spawnFactory?: SpawnFactory
  profileLocation?: ProfileFileLocation
  sessionStoreLocation?: WebChatSessionStoreLocation
  legacyCwds?: readonly string[]
  bootstrapUserDirs?: boolean
}

type WebUiAppOptions = {
  cwd: string
  permissionMode: string
  token: string
  spawnFactory?: SpawnFactory
  profileLocation?: ProfileFileLocation
  sessionStoreLocation?: WebChatSessionStoreLocation
  legacyCwds?: readonly string[]
  bootstrapUserDirs?: boolean
}

type WebUiApp = {
  handler: (request: IncomingMessage, response: ServerResponse) => void
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  close: () => void
}

function parsePort(value: number | string | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '0', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizePermissionMode(mode: string | undefined): WebUiPermissionMode {
  const candidate = mode || 'acceptEdits'
  return (PERMISSION_MODES as readonly string[]).includes(candidate)
    ? candidate as WebUiPermissionMode
    : 'acceptEdits'
}

export type WebUiBootstrapDirs = {
  configDir: string
  workspaceDir: string
  userSkillsDir: string
  projectsDir: string
  webuiDir: string
  projectSkillsDir: string
}

export function ensureWebUiBootstrapDirs(cwd: string): WebUiBootstrapDirs {
  const configDir = resolve(getClaudeConfigHomeDir())
  const workspaceDir = resolve(cwd)
  const dirs: WebUiBootstrapDirs = {
    configDir,
    workspaceDir,
    userSkillsDir: join(configDir, 'skills'),
    projectsDir: join(configDir, 'projects'),
    webuiDir: join(configDir, 'webui'),
    projectSkillsDir: join(
      workspaceDir,
      PRODUCT_PROJECT_CONFIG_DIR_NAME,
      'skills',
    ),
  }

  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true })
  }

  return dirs
}

function parseLegacyCwdEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(delimiter)
    .map(part => part.trim())
    .filter(Boolean)
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
  const authorization = request.headers.authorization
  if (authorization === `Bearer ${token}`) return true
  if (request.headers['x-opencat-token'] === token) return true
  return url.searchParams.get('token') === token
}

async function readJsonBody<T>(request: IncomingMessage, limitBytes = 1_000_000): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > limitBytes) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw || '{}') as T
}

function normalizePluginScope(value: unknown): WebPluginScope {
  return value === 'project' || value === 'local' ? value : 'user'
}

const WEB_PLUGIN_SCOPE_ORDER: readonly PluginScope[] = [
  'user',
  'project',
  'local',
  'managed',
]

function getInstalledScopes(
  pluginId: string,
  currentProjectOnly: boolean,
): WebPluginInstalledScope[] {
  const scopes = new Set(
    (loadInstalledPluginsV2().plugins[pluginId] ?? [])
      .filter(
        entry =>
          !currentProjectOnly || isInstallationRelevantToCurrentProject(entry),
      )
      .map(entry => entry.scope),
  )
  return WEB_PLUGIN_SCOPE_ORDER.filter(scope => scopes.has(scope))
}

function pluginEntryNeedsConfiguration(entry: PluginMarketplaceEntry): boolean {
  const userConfig = entry.userConfig
  if (userConfig && Object.keys(userConfig).length > 0) return true
  return Boolean(
    entry.channels?.some(
      channel => channel.userConfig && Object.keys(channel.userConfig).length > 0,
    ),
  )
}

async function loadPluginConfigurationNeeds(
  pluginIds: Set<string>,
): Promise<Map<string, boolean>> {
  const needs = new Map<string, boolean>()
  if (pluginIds.size === 0) return needs
  try {
    const result = await loadAllPlugins()
    for (const plugin of [...result.enabled, ...result.disabled]) {
      const pluginId = plugin.repository || plugin.source
      if (!pluginIds.has(pluginId)) continue
      const hasUserOptions = Object.keys(getUnconfiguredOptions(plugin)).length > 0
      const hasChannelOptions = getUnconfiguredChannels(plugin).length > 0
      needs.set(pluginId, hasUserOptions || hasChannelOptions)
    }
  } catch {
    return needs
  }
  return needs
}

async function pluginNeedsConfiguration(
  pluginId: string,
  entry: PluginMarketplaceEntry,
): Promise<boolean> {
  const needs = await loadPluginConfigurationNeeds(new Set([pluginId]))
  return needs.get(pluginId) ?? pluginEntryNeedsConfiguration(entry)
}

function matchesPluginQuery(plugin: WebPluginSummary, query: string): boolean {
  if (!query) return true
  const haystack = [
    plugin.pluginId,
    plugin.name,
    plugin.marketplaceName,
    plugin.description,
    plugin.category,
    ...plugin.tags,
    ...plugin.keywords,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

async function listWebPlugins(params: {
  q?: string
  marketplace?: string
  status?: string
}): Promise<{
  plugins: WebPluginSummary[]
  marketplaces: WebPluginMarketplaceSummary[]
  failures: Array<{ name: string; error: string }>
}> {
  const config = await loadKnownMarketplacesConfig()
  const { marketplaces, failures } = await loadMarketplacesWithGracefulDegradation(config)
  const installCounts = await getInstallCounts().catch(() => null)
  const summaries: WebPluginSummary[] = []
  const installedPluginIds = new Set<string>()
  const marketplaceSummaries: WebPluginMarketplaceSummary[] = []

  for (const marketplace of marketplaces) {
    const pluginCount = marketplace.data?.plugins.length ?? 0
    let installedCount = 0
    for (const entry of marketplace.data?.plugins ?? []) {
      const pluginId = createPluginId(entry.name, marketplace.name)
      if (isPluginInstalled(pluginId)) installedCount += 1
    }
    marketplaceSummaries.push({
      name: marketplace.name,
      source: getMarketplaceSourceDisplay(marketplace.config.source),
      pluginCount,
      installedCount,
    })
  }

  for (const marketplace of marketplaces) {
    if (params.marketplace && marketplace.name !== params.marketplace) continue
    for (const entry of marketplace.data?.plugins ?? []) {
      const pluginId = createPluginId(entry.name, marketplace.name)
      const installed = isPluginInstalled(pluginId)
      const installedScopes = getInstalledScopes(pluginId, true)
      if (installed) installedPluginIds.add(pluginId)
      const summary: WebPluginSummary = {
        pluginId,
        name: entry.name,
        marketplaceName: marketplace.name,
        description: entry.description,
        category: entry.category,
        tags: entry.tags ?? [],
        keywords: entry.keywords ?? [],
        version: entry.version,
        installed,
        userInstalled: installedScopes.includes('user'),
        projectEnabled: isPluginEnabledAtProjectScope(pluginId),
        installedScopes,
        blocked: isPluginBlockedByPolicy(pluginId),
        installCount: installCounts?.get(pluginId),
        needsConfiguration: pluginEntryNeedsConfiguration(entry),
      }
      if (!matchesPluginQuery(summary, params.q?.trim() ?? '')) continue
      if (params.status === 'installed' && !summary.installed) continue
      if (params.status === 'available' && summary.installed) continue
      summaries.push(summary)
    }
  }

  const configNeeds = await loadPluginConfigurationNeeds(installedPluginIds)
  for (const summary of summaries) {
    if (configNeeds.has(summary.pluginId)) {
      summary.needsConfiguration = Boolean(configNeeds.get(summary.pluginId))
    }
  }

  summaries.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1
    const countDelta = (b.installCount ?? -1) - (a.installCount ?? -1)
    if (countDelta !== 0) return countDelta
    return a.name.localeCompare(b.name)
  })

  return { plugins: summaries, marketplaces: marketplaceSummaries, failures }
}

function normalizeWebMcpScope(value: unknown): WebMcpServerScope {
  if (value === 'project' || value === 'local') return value
  return 'user'
}

function ensureWritableMcpScope(value: unknown): WebMcpServerScope {
  const scope = normalizeWebMcpScope(value)
  if (value !== undefined && value !== null && value !== scope) {
    throw new Error('Invalid MCP scope. Use user, project, or local.')
  }
  return scope
}

function stringFromPayload(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitCommandArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (char === '\\' && quote !== "'") {
      index += 1
      if (index < input.length) current += input[index]
      else current += char
      continue
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (quote) throw new Error('Arguments contain an unterminated quote.')
  if (current) args.push(current)
  return args
}

function parseStringArrayPayload(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') return splitCommandArgs(value.trim())
  return []
}

function parseStringRecordPayload(
  value: unknown,
  fieldName: string,
): Record<string, string> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') {
    const lines = value
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return undefined
    if (fieldName === 'headers') return parseHeaders(lines)
    return parseEnvVars(lines)
  }
  if (Array.isArray(value)) {
    const lines = value
      .map(item => String(item).trim())
      .filter(Boolean)
    if (lines.length === 0) return undefined
    if (fieldName === 'headers') return parseHeaders(lines)
    return parseEnvVars(lines)
  }
  if (typeof value === 'object') {
    const record: Record<string, string> = {}
    for (const [key, raw] of Object.entries(value)) {
      const normalizedKey = key.trim()
      if (!normalizedKey) {
        throw new Error(`Invalid ${fieldName}: key cannot be empty.`)
      }
      if (raw === undefined || raw === null) continue
      record[normalizedKey] = String(raw)
    }
    return Object.keys(record).length > 0 ? record : undefined
  }
  throw new Error(`Invalid ${fieldName} format.`)
}

function getMcpRegistryInputHint(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  const path = parsed.pathname.replace(/\/+$/, '')
  if (host === 'glama.ai' && path === '/mcp/servers') {
    return 'https://glama.ai/mcp/servers 是 MCP Registry 列表页，不能直接添加。请打开具体 server 详情，填写其中的 stdio command/args 或 HTTP/SSE endpoint。'
  }
  if (host === 'glama.ai' && path.startsWith('/mcp/servers/')) {
    return '这是 Glama 的 MCP Registry 详情页，不是 MCP endpoint。请复制详情页提供的 command/args 或 HTTP/SSE URL 后再添加。'
  }
  if (host === 'github.com' && path.startsWith('/mcp/')) {
    return '这是 GitHub MCP Registry 条目页，不是 marketplace 或 MCP endpoint。请复制条目里的 stdio command/args 或 HTTP/SSE URL 后再添加。'
  }
  return null
}

function assertNotMcpRegistryInput(value: string): void {
  const hint = getMcpRegistryInputHint(value.trim())
  if (hint) throw new Error(hint)
}

function buildWebMcpConfig(payload: {
  transport?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  url?: unknown
  headers?: unknown
}): McpServerConfig {
  const transport = ensureTransport(stringFromPayload(payload.transport))
  if (transport === 'stdio') {
    const command = stringFromPayload(payload.command)
    if (!command) throw new Error('Command is required for stdio MCP servers.')
    assertNotMcpRegistryInput(command)
    const env = parseStringRecordPayload(payload.env, 'env')
    return {
      type: 'stdio',
      command,
      args: parseStringArrayPayload(payload.args),
      ...(env ? { env } : {}),
    }
  }

  const url = stringFromPayload(payload.url)
  if (!url) throw new Error('URL is required for HTTP/SSE MCP servers.')
  assertNotMcpRegistryInput(url)
  const headers = parseStringRecordPayload(payload.headers, 'headers')
  return {
    type: transport,
    url,
    ...(headers ? { headers } : {}),
  }
}

function summarizeWebMcpServer(
  name: string,
  config: ScopedMcpServerConfig,
): WebMcpServerSummary {
  const transport = config.type ?? 'stdio'
  const isWritable =
    config.scope === 'user' ||
    config.scope === 'project' ||
    config.scope === 'local'
  const summary: WebMcpServerSummary = {
    name,
    scope: config.scope === 'enterprise' ? 'enterprise' : normalizeWebMcpScope(config.scope),
    transport,
    envKeys: [],
    headerKeys: [],
    configPath: describeMcpConfigFilePath(config.scope),
    readonly: !isWritable,
  }
  if (transport === 'stdio') {
    const stdio = config as ScopedMcpServerConfig & {
      command: string
      args?: string[]
      env?: Record<string, string>
    }
    summary.command = stdio.command
    summary.args = stdio.args ?? []
    summary.envKeys = Object.keys(stdio.env ?? {})
  } else if ('url' in config) {
    summary.url = config.url
    if ('headers' in config) {
      summary.headerKeys = Object.keys(config.headers ?? {})
    }
  }
  return summary
}

function listWebMcpServers(): {
  servers: WebMcpServerSummary[]
  errors: Array<{ scope: string; message: string }>
} {
  const servers: WebMcpServerSummary[] = []
  const errors: Array<{ scope: string; message: string }> = []
  for (const scope of ['user', 'project', 'local', 'enterprise'] as const) {
    const result = getMcpConfigsByScope(scope)
    for (const [name, config] of Object.entries(result.servers)) {
      servers.push(summarizeWebMcpServer(name, config))
    }
    for (const error of result.errors) {
      errors.push({ scope, message: error.message })
    }
  }
  servers.sort((a, b) => {
    const scopeOrder = ['user', 'project', 'local', 'enterprise']
    const scopeDelta = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope)
    if (scopeDelta !== 0) return scopeDelta
    return a.name.localeCompare(b.name)
  })
  return { servers, errors }
}

function resolveIconPath(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, 'assets', 'opencat.ico'),
    join(moduleDir, '..', 'src', 'webui', 'assets', 'opencat.ico'),
    join(process.cwd(), 'src', 'webui', 'assets', 'opencat.ico'),
  ]
  return candidates.find(existsSync) ?? null
}

function bootstrap(options: WebUiAppOptions): BootstrapState {
  const chatSessions = listWebChatSessions(
    options.cwd,
    options.sessionStoreLocation,
  )
  return buildBootstrapState({
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    profileLocation: options.profileLocation,
    chatSessions,
    activeChatSessionId: chatSessions[0]?.id,
  })
}

const MAX_COMMAND_SUGGESTION_INPUT_LENGTH = 200
const MAX_WEB_COMMAND_SUGGESTIONS = 50

function commandNameFromSuggestionDisplay(displayText: string): string {
  return displayText.match(/^\/([^\s(]+)/)?.[1] ?? ''
}

function commandNameFromSuggestionMetadata(metadata: unknown): string | null {
  try {
    return metadata ? getCommandName(metadata as Command) : null
  } catch {
    return null
  }
}

function toWebCommandSuggestion(suggestion: {
  id: string
  displayText: string
  tag?: string
  description?: string
  metadata?: unknown
}): WebCommandSuggestion {
  const commandName =
    commandNameFromSuggestionMetadata(suggestion.metadata) ??
    commandNameFromSuggestionDisplay(suggestion.displayText)
  return {
    id: suggestion.id,
    commandName,
    displayText: suggestion.displayText,
    description: suggestion.description,
    tag: suggestion.tag,
  }
}

async function getWebCommandSuggestions(
  cwd: string,
  rawInput: string | null,
): Promise<{ suggestions: WebCommandSuggestion[] }> {
  const input = (rawInput ?? '').slice(0, MAX_COMMAND_SUGGESTION_INPUT_LENGTH)
  const commands = (await getCommands(cwd)).filter(isBridgeSafeCommand)
  const suggestions = generateCommandSuggestions(input, commands)
    .slice(0, MAX_WEB_COMMAND_SUGGESTIONS)
    .map(toWebCommandSuggestion)
  return { suggestions }
}

async function handleMemoryApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/memory')) return false

  const parts = url.pathname.split('/').filter(Boolean)

  if (request.method === 'GET' && url.pathname === '/api/memory/status') {
    sendJson(response, 200, await getMemoryStatus(options.cwd))
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/files') {
    sendJson(response, 200, { files: listMemoryFiles(options.cwd) })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/files') {
    const payload = await readJsonBody<Parameters<typeof createMemoryFile>[0]>(request)
    sendJson(response, 200, { file: createMemoryFile(payload, options.cwd) })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/search') {
    sendJson(response, 200, {
      results: searchMemoryFiles(url.searchParams.get('q') ?? '', options.cwd),
    })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/knowledge-graph') {
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/knowledge-graph/enable') {
    const payload = await readJsonBody<{ enabled?: unknown }>(request)
    updateKnowledgeGraphEnabled(payload.enabled)
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/knowledge-graph/clear') {
    const payload = await readJsonBody<{ confirm?: unknown }>(request)
    await clearMemoryKnowledgeGraph(options.cwd, payload.confirm)
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (parts[0] === 'api' && parts[1] === 'memory' && parts[2] === 'files' && parts[3]) {
    const fileId = decodeURIComponent(parts[3])
    if (request.method === 'GET') {
      const file = getMemoryFile(fileId, options.cwd)
      sendJson(response, 200, { file, content: file.content })
      return true
    }
    if (request.method === 'PUT') {
      const payload = await readJsonBody<{ content?: unknown }>(request)
      const file = saveMemoryFile(fileId, payload.content, options.cwd)
      sendJson(response, 200, { file, content: file.content })
      return true
    }
    if (request.method === 'DELETE') {
      const payload = await readJsonBody<{ confirm?: unknown }>(request)
      deleteMemoryFile(fileId, payload.confirm, options.cwd)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  sendJson(response, 404, { error: 'Memory API route was not found.' })
  return true
}

async function handleAssetsApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/assets')) return false

  const parts = url.pathname.split('/').filter(Boolean)

  if (request.method === 'GET' && url.pathname === '/api/assets') {
    sendJson(response, 200, {
      assets: await listAssets(options.cwd, {
        kind: url.searchParams.get('kind'),
        source: url.searchParams.get('source'),
        q: url.searchParams.get('q'),
      }),
      roots: getAssetRoots(options.cwd),
    })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/reload') {
    sendJson(response, 200, await reloadAssets(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/skills') {
    const payload = await readJsonBody<Parameters<typeof createSkillAsset>[1]>(request)
    sendJson(response, 200, { asset: await createSkillAsset(options.cwd, payload) })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/skills/import') {
    const payload = await readJsonBody<Parameters<typeof importSkillAsset>[1]>(request)
    sendJson(response, 200, { asset: await importSkillAsset(options.cwd, payload) })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/knowledge') {
    const payload = await readJsonBody<Parameters<typeof createKnowledgeAsset>[1]>(request)
    sendJson(response, 200, { asset: await createKnowledgeAsset(options.cwd, payload) })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/knowledge/import') {
    const payload = await readJsonBody<Parameters<typeof importKnowledgeAsset>[1]>(request)
    sendJson(response, 200, { asset: await importKnowledgeAsset(options.cwd, payload) })
    return true
  }

  if (parts[0] === 'api' && parts[1] === 'assets' && parts[2] === 'skills' && parts[3]) {
    const assetId = decodeURIComponent(parts[3])
    if (request.method === 'PUT') {
      const payload = await readJsonBody<Parameters<typeof updateSkillAsset>[2]>(request)
      sendJson(response, 200, { asset: await updateSkillAsset(options.cwd, assetId, payload) })
      return true
    }
    if (request.method === 'DELETE') {
      const payload = await readJsonBody<{ confirm?: unknown }>(request)
      await deleteSkillAsset(options.cwd, assetId, payload.confirm)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  if (parts[0] === 'api' && parts[1] === 'assets' && parts[2] === 'knowledge' && parts[3]) {
    const assetId = decodeURIComponent(parts[3])
    if (request.method === 'PUT') {
      const payload = await readJsonBody<Parameters<typeof updateKnowledgeAsset>[2]>(request)
      sendJson(response, 200, { asset: await updateKnowledgeAsset(options.cwd, assetId, payload) })
      return true
    }
    if (request.method === 'DELETE') {
      const payload = await readJsonBody<{ confirm?: unknown }>(request)
      await deleteKnowledgeAsset(options.cwd, assetId, payload.confirm)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'assets' && parts[2]) {
    const assetId = decodeURIComponent(parts[2])
    sendJson(response, 200, { asset: await getAssetDetail(options.cwd, assetId) })
    return true
  }

  sendJson(response, 404, { error: 'Assets API route was not found.' })
  return true
}

function requirePlatformAuthSession(response: ServerResponse): ReturnType<typeof loadPlatformAuthSession> {
  const session = loadPlatformAuthSession()
  if (!session) {
    sendJson(response, 401, { error: 'Platform authentication is required.' })
    return null
  }
  return session
}

function recordValue(value: unknown, key: string): string {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? String((value as Record<string, unknown>)[key] ?? '').trim()
    : ''
}

function normalizeHubAssetType(value: unknown): 'skill' | 'knowledge' {
  const text = String(value || '').trim().toLowerCase()
  return text === 'skill' ? 'skill' : 'knowledge'
}

async function handleAssetHubApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/asset-hub')) return false

  const session = requirePlatformAuthSession(response)
  if (!session) return true
  const parts = url.pathname.split('/').filter(Boolean)

  if (request.method === 'GET' && url.pathname === '/api/asset-hub/assets') {
    sendJson(response, 200, await listAssetHubAssets({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      search: url.searchParams.get('search') || '',
      assetType: url.searchParams.get('asset_type') || '',
      ordering: url.searchParams.get('ordering') || '',
      page: Number(url.searchParams.get('page') || 1),
      limit: Number(url.searchParams.get('limit') || 10),
    }))
    return true
  }

  if (parts[0] === 'api' && parts[1] === 'asset-hub' && parts[2] === 'assets' && parts[3]) {
    const hubAssetId = decodeURIComponent(parts[3])
    if (request.method === 'GET' && parts.length === 4) {
      const [item, preview] = await Promise.all([
        getAssetHubAsset({
          baseUrl: session.baseUrl,
          accessToken: session.accessToken,
          assetId: hubAssetId,
        }),
        previewAssetHubAsset({
          baseUrl: session.baseUrl,
          accessToken: session.accessToken,
          assetId: hubAssetId,
        }),
      ])
      sendJson(response, 200, { item, markdown: preview.markdown || '' })
      return true
    }

    if (request.method === 'POST' && parts[4] === 'vote') {
      const payload = await readJsonBody<{ vote?: unknown }>(request)
      sendJson(response, 200, await voteAssetHubAsset({
        baseUrl: session.baseUrl,
        accessToken: session.accessToken,
        assetId: hubAssetId,
        vote: typeof payload.vote === 'string' ? payload.vote : 'none',
      }))
      return true
    }

    if (request.method === 'POST' && parts[4] === 'download') {
      const payload = await readJsonBody<{ assetSnapshot?: unknown }>(request)
      const snapshot = payload.assetSnapshot
      const item = await getAssetHubAsset({
        baseUrl: session.baseUrl,
        accessToken: session.accessToken,
        assetId: hubAssetId,
      }).catch(() => snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {})
      const downloaded = await downloadAssetHubAsset({
        baseUrl: session.baseUrl,
        accessToken: session.accessToken,
        assetId: hubAssetId,
      })
      const markdown = String(downloaded.markdown || '')
      if (!markdown.trim()) throw new Error('Hub asset markdown is empty.')
      const assetType = normalizeHubAssetType(
        downloaded.asset_type || recordValue(item, 'asset_type') || recordValue(snapshot, 'asset_type'),
      )
      const title =
        recordValue(item, 'title') ||
        recordValue(snapshot, 'title') ||
        hubAssetId
      const fileName =
        String(downloaded.file_name || '').trim() ||
        recordValue(item, 'file_name') ||
        title
      const asset = assetType === 'skill'
        ? await importHubSkillAsset(options.cwd, { name: title, content: markdown })
        : await importHubKnowledgeAsset(options.cwd, { filename: fileName, title, content: markdown })
      sendJson(response, 200, { item, download: downloaded, asset })
      return true
    }
  }

  if (
    request.method === 'POST' &&
    parts[0] === 'api' &&
    parts[1] === 'asset-hub' &&
    parts[2] === 'local-assets' &&
    parts[3] &&
    parts[4] === 'upload'
  ) {
    const assetId = decodeURIComponent(parts[3])
    const asset = await getAssetDetail(options.cwd, assetId)
    if (asset.source !== 'user' || (asset.kind !== 'skill' && asset.kind !== 'knowledge') || asset.readonly) {
      sendJson(response, 403, { error: 'Only user Skill and Knowledge assets can be uploaded to Hub.' })
      return true
    }
    if (!asset.content?.trim()) {
      throw new Error('Asset markdown source is empty.')
    }
    const payload = await readJsonBody<{
      title?: unknown
      version?: unknown
      applicableRoles?: unknown
      applicable_roles?: unknown
      applicableBusiness?: unknown
      applicable_business?: unknown
      description?: unknown
    }>(request)
    const title = String(payload.title || asset.displayName || asset.name || '').trim()
    const version = String(payload.version || 'v1').trim()
    const applicableRoles = String(payload.applicableRoles || payload.applicable_roles || '').trim()
    const applicableBusiness = String(payload.applicableBusiness || payload.applicable_business || '').trim()
    const description = String(payload.description || asset.description || '').trim()
    if (!title || !version || !applicableRoles || !applicableBusiness || !description) {
      sendJson(response, 400, { error: 'Title, version, applicable roles, applicable business, and description are required.' })
      return true
    }
    const result = await uploadAssetToHub({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
      metadata: {
        title,
        version,
        applicableRoles,
        applicableBusiness,
        description,
        assetType: asset.kind === 'skill' ? 'skill' : 'knowledge',
        sourceAssetId: asset.id,
        sourceAssetVersion: version,
      },
      filename: asset.kind === 'skill' ? 'SKILL.md' : basename(asset.path || `${asset.name}.md`),
      markdown: asset.content,
    })
    sendJson(response, 200, result)
    return true
  }

  sendJson(response, 404, { error: 'Asset Hub API route was not found.' })
  return true
}

async function handlePluginsApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/plugins')) return false

  if (request.method === 'GET' && url.pathname === '/api/plugins/marketplaces') {
    const { marketplaces, failures } = await listWebPlugins({ status: 'all' })
    sendJson(response, 200, { marketplaces, failures })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/plugins/marketplaces') {
    const payload = await readJsonBody<{ source?: unknown }>(request)
    const source = typeof payload.source === 'string' ? payload.source.trim() : ''
    if (!source) throw new Error('Marketplace source is required.')
    assertNotMcpRegistryInput(source)

    const parsed = await parseMarketplaceInput(source)
    if (!parsed) {
      throw new Error('Invalid marketplace source format. Try owner/repo, https://..., or ./path.')
    }
    if ('error' in parsed) throw new Error(parsed.error)

    const { name, alreadyMaterialized, resolvedSource } =
      await addMarketplaceSource(parsed)
    saveMarketplaceToSettings(name, { source: resolvedSource })
    clearAllCaches()

    sendJson(response, 200, {
      marketplace: {
        name,
        source: getMarketplaceSourceDisplay(resolvedSource),
        alreadyMaterialized,
      },
    })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/plugins') {
    const status = url.searchParams.get('status') || 'all'
    const marketplace = url.searchParams.get('marketplace') || ''
    sendJson(
      response,
      200,
      await listWebPlugins({
        q: url.searchParams.get('q') || '',
        marketplace,
        status,
      }),
    )
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/plugins/install') {
    const payload = await readJsonBody<{ pluginId?: unknown; scope?: unknown }>(request)
    const pluginId = typeof payload.pluginId === 'string' ? payload.pluginId.trim() : ''
    if (!pluginId) throw new Error('Plugin ID is required.')

    const pluginData = await getPluginById(pluginId)
    if (!pluginData) {
      sendJson(response, 404, {
        ok: false,
        pluginId,
        error: `Plugin "${pluginId}" was not found in configured marketplaces.`,
      } satisfies WebPluginInstallResult)
      return true
    }

    const { marketplace: marketplaceName } = parsePluginIdentifier(pluginId)
    if (!marketplaceName) throw new Error('Plugin ID must use plugin@marketplace format.')

    const result = await installPluginFromMarketplace({
      pluginId,
      entry: pluginData.entry,
      marketplaceName,
      scope: normalizePluginScope(payload.scope),
      trigger: 'user',
    })

    if ('error' in result) {
      sendJson(response, 400, {
        ok: false,
        pluginId,
        error: result.error,
      } satisfies WebPluginInstallResult)
      return true
    }

    sendJson(response, 200, {
      ok: true,
      pluginId,
      message: result.message,
      needsConfiguration: await pluginNeedsConfiguration(pluginId, pluginData.entry),
    } satisfies WebPluginInstallResult)
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/plugins/uninstall') {
    const payload = await readJsonBody<{
      pluginId?: unknown
      deleteDataDir?: unknown
    }>(request)
    const pluginId = typeof payload.pluginId === 'string' ? payload.pluginId.trim() : ''
    if (!pluginId) throw new Error('Plugin ID is required.')
    if (!parsePluginIdentifier(pluginId).marketplace) {
      throw new Error('Plugin ID must use plugin@marketplace format.')
    }
    if (typeof payload.deleteDataDir !== 'boolean') {
      throw new Error('deleteDataDir must be a boolean.')
    }

    const result = await uninstallPluginOp(pluginId, 'user', payload.deleteDataDir)
    if (!result.success) {
      sendJson(response, 400, {
        ok: false,
        pluginId,
        error: result.message,
      } satisfies WebPluginUninstallResult)
      return true
    }

    const uninstalledPluginId = result.pluginId ?? pluginId
    sendJson(response, 200, {
      ok: true,
      pluginId: uninstalledPluginId,
      scope: 'user',
      remainingScopes: getInstalledScopes(uninstalledPluginId, false),
      reverseDependents: result.reverseDependents ?? [],
      message: result.message,
    } satisfies WebPluginUninstallResult)
    return true
  }

  sendJson(response, 404, { error: 'Plugins API route was not found.' })
  return true
}

async function handleMcpApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/mcp')) return false

  return runWithCwdOverride(options.cwd, async () => {
    if (request.method === 'GET' && url.pathname === '/api/mcp/servers') {
      sendJson(response, 200, listWebMcpServers())
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/mcp/servers') {
      const payload = await readJsonBody<{
        name?: unknown
        scope?: unknown
        transport?: unknown
        command?: unknown
        args?: unknown
        env?: unknown
        url?: unknown
        headers?: unknown
      }>(request)
      const name = stringFromPayload(payload.name)
      if (!name) throw new Error('MCP server name is required.')
      const scope = ensureWritableMcpScope(payload.scope)
      const config = buildWebMcpConfig(payload)
      await addMcpConfig(name, config, scope)
      const saved = getMcpConfigsByScope(scope).servers[name]
      sendJson(response, 200, {
        ok: true,
        server: saved
          ? summarizeWebMcpServer(name, saved)
          : summarizeWebMcpServer(name, { ...config, scope }),
        message: 'MCP server added. Refresh the session to load it.',
      } satisfies WebMcpServerAddResult)
      return true
    }

    const deletePrefix = '/api/mcp/servers/'
    if (request.method === 'DELETE' && url.pathname.startsWith(deletePrefix)) {
      const name = decodeURIComponent(url.pathname.slice(deletePrefix.length)).trim()
      if (!name) throw new Error('MCP server name is required.')
      const scope = ensureWritableMcpScope(url.searchParams.get('scope') || 'user')
      await removeMcpConfig(name, scope)
      sendJson(response, 200, { ok: true, name, scope })
      return true
    }

    sendJson(response, 404, { error: 'MCP API route was not found.' })
    return true
  })
}

async function handlePlatformAuthApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/platform-auth')) return false

  if (request.method === 'GET' && url.pathname === '/api/platform-auth/status') {
    sendJson(response, 200, await getPlatformAuthStatus({
      forceValidate: url.searchParams.get('force_validate') === 'true',
    }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-auth/captcha') {
    const payload = await readJsonBody<{ baseUrl?: unknown }>(request)
    sendJson(response, 200, await getPlatformCaptcha({
      baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
    }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-auth/login/password') {
    const payload = await readJsonBody<{
      baseUrl?: unknown
      username?: unknown
      password?: unknown
      captcha?: unknown
      captchaKey?: unknown
    }>(request)
    sendJson(response, 200, await loginPlatformPassword({
      baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
      username: typeof payload.username === 'string' ? payload.username : '',
      password: typeof payload.password === 'string' ? payload.password : '',
      captcha: typeof payload.captcha === 'string' ? payload.captcha : '',
      captchaKey: typeof payload.captchaKey === 'string' ? payload.captchaKey : '',
    }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-auth/sso/send-code') {
    const payload = await readJsonBody<{
      baseUrl?: unknown
      account?: unknown
    }>(request)
    sendJson(response, 200, await sendPlatformSsoCode({
      baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
      account: typeof payload.account === 'string' ? payload.account : '',
    }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-auth/sso/login') {
    const payload = await readJsonBody<{
      baseUrl?: unknown
      account?: unknown
      code?: unknown
      uuid?: unknown
    }>(request)
    sendJson(response, 200, await loginPlatformSso({
      baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : '',
      account: typeof payload.account === 'string' ? payload.account : '',
      code: typeof payload.code === 'string' ? payload.code : '',
      uuid: typeof payload.uuid === 'string' ? payload.uuid : '',
    }))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-auth/logout') {
    clearPlatformAuthSession()
    sendJson(response, 200, await getPlatformAuthStatus())
    return true
  }

  sendJson(response, 404, { error: 'Platform auth API route was not found.' })
  return true
}

async function handlePlatformUsageApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/platform-usage')) return false

  if (request.method === 'GET' && url.pathname === '/api/platform-usage/summary') {
    sendJson(response, 200, await collectPlatformUsageSummary())
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-usage/report') {
    const session = loadPlatformAuthSession()
    if (!session) {
      sendJson(response, 401, { error: 'Platform authentication is required.' })
      return true
    }
    sendJson(response, 200, await reportPlatformUsage({
      baseUrl: session.baseUrl,
      accessToken: session.accessToken,
    }))
    return true
  }

  sendJson(response, 404, { error: 'Platform usage API route was not found.' })
  return true
}

function sendWs(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event))
  }
}

function parseClientMessage(data: RawData): ClientMessage {
  const parsed = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('Invalid client message.')
  }
  return parsed as ClientMessage
}

function createStatusActivity(title: string, detail?: string): ServerEvent {
  return {
    type: 'activity',
    activity: {
      id: `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'status',
      title,
      detail,
      at: Date.now(),
    },
  }
}

function formatWebRuntimeDetail(chatCwd: string): string {
  return `webProcessCwd=${process.cwd()}; cliBundle=${process.argv[1] || '(unknown)'}; chatCwd=${chatCwd}`
}

export function createWebUiApp(options: WebUiAppOptions): WebUiApp {
  if (options.bootstrapUserDirs) {
    ensureWebUiBootstrapDirs(options.cwd)
  }
  if (options.legacyCwds?.length) {
    migrateWebChatSessionsToCwd(
      options.cwd,
      options.legacyCwds,
      options.sessionStoreLocation,
    )
  }

  const wss = new WebSocketServer({ noServer: true })
  const iconPath = resolveIconPath()

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      try {
        if (request.method === 'GET' && url.pathname === '/') {
          sendText(response, 200, 'text/html; charset=utf-8', renderWebUiPage())
          return
        }

        if (request.method === 'GET' && url.pathname === '/assets/opencat.ico') {
          if (!iconPath) {
            sendJson(response, 404, { error: 'Icon asset is missing.' })
            return
          }
          sendText(response, 200, 'image/x-icon', readFileSync(iconPath))
          return
        }

        if (!isAuthorized(request, url, options.token)) {
          sendJson(response, 401, { error: 'Unauthorized.' })
          return
        }

        if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
          sendJson(response, 200, bootstrap(options))
          return
        }

        if (request.method === 'GET' && url.pathname === '/api/command-suggestions') {
          sendJson(
            response,
            200,
            await getWebCommandSuggestions(options.cwd, url.searchParams.get('input')),
          )
          return
        }

        if (await handleMemoryApi(request, response, url, options)) {
          return
        }

        if (await handleAssetsApi(request, response, url, options)) {
          return
        }

        if (await handleAssetHubApi(request, response, url, options)) {
          return
        }

        if (await handlePluginsApi(request, response, url)) {
          return
        }

        if (await handleMcpApi(request, response, url, options)) {
          return
        }

        if (await handlePlatformAuthApi(request, response, url)) {
          return
        }

        if (await handlePlatformUsageApi(request, response, url)) {
          return
        }

        if (request.method === 'POST' && url.pathname === '/api/provider-profile') {
          const payload = await readJsonBody<ProviderProfilePayload>(request)
          const profile = saveProviderProfileFromPayload(
            payload,
            options.profileLocation,
          )
          sendJson(response, 200, { profile, bootstrap: bootstrap(options) })
          return
        }

        sendJson(response, 404, { error: 'Not found.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(response, 400, { error: message })
      }
    })()
  }

  wss.on('connection', ws => {
    let session: CliChatSession | null = null
    let activeSessionId = bootstrap(options).activeChatSessionId
    const send = (event: ServerEvent): void => sendWs(ws, event)
    send({ type: 'ready', bootstrap: bootstrap(options) })
    send(createStatusActivity('Web runtime', formatWebRuntimeDetail(options.cwd)))

    if (activeSessionId) {
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: loadWebChatMessages(options.cwd, activeSessionId),
      })
    } else {
      send({ type: 'session_loaded', messages: [] })
    }

    function disposeSession(): void {
      session?.dispose()
      session = null
    }

    function sendSessionsUpdated(): void {
      send({
        type: 'sessions_updated',
        sessions: listWebChatSessions(options.cwd, options.sessionStoreLocation),
        activeSessionId,
      })
    }

    function loadActiveSession(sessionId: string | undefined): void {
      activeSessionId = sessionId
      disposeSession()
      send({ type: 'status', status: 'Ready', detail: 'Session selected' })
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: activeSessionId
          ? loadWebChatMessages(options.cwd, activeSessionId)
          : [],
      })
    }

    function createAndSelectSession(): void {
      const record = createWebChatSession(
        options.cwd,
        options.sessionStoreLocation,
      )
      activeSessionId = record.id
      disposeSession()
      sendSessionsUpdated()
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: [],
      })
      send({ type: 'status', status: 'Ready', detail: 'New chat created' })
    }

    function ensureActiveSessionId(): string {
      if (!activeSessionId) {
        activeSessionId = createWebChatSession(
          options.cwd,
          options.sessionStoreLocation,
        ).id
        sendSessionsUpdated()
      }
      return activeSessionId
    }

    function ensureActiveSessionForMessage(text: string): string {
      const sessionId = ensureActiveSessionId()
      touchWebChatSessionWithUserMessage(
        options.cwd,
        sessionId,
        text,
        options.sessionStoreLocation,
      )
      sendSessionsUpdated()
      return sessionId
    }

    async function ensureSession(): Promise<CliChatSession> {
      const sessionId = ensureActiveSessionId()
      if (!session) {
        const sessionEnv = await buildWebSessionEnv(options.profileLocation)
        session = new CliChatSession({
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          send,
          env: sessionEnv.env,
          replaceEnv: sessionEnv.replaceEnv,
          spawnFactory: options.spawnFactory,
          sessionId,
          resumeSession: hasWebChatTranscriptMessages(options.cwd, sessionId),
        })
      }
      return session
    }

    ws.on('message', data => {
      void (async () => {
        try {
          const message = parseClientMessage(data)
          if (message.type === 'new_session') {
            createAndSelectSession()
            return
          }
          if (message.type === 'refresh_session') {
            disposeSession()
            send({ type: 'status', status: 'Ready', detail: 'Session refreshed' })
            send({ type: 'ready', bootstrap: bootstrap(options) })
            return
          }
          if (message.type === 'select_session') {
            if (!getWebChatSession(options.cwd, message.sessionId, options.sessionStoreLocation)) {
              send({ type: 'error', message: 'Chat session was not found.' })
              return
            }
            loadActiveSession(message.sessionId)
            sendSessionsUpdated()
            return
          }
          if (message.type === 'delete_session') {
            const deleted = deleteWebChatSession(
              options.cwd,
              message.sessionId,
              options.sessionStoreLocation,
            )
            if (!deleted) {
              send({ type: 'error', message: 'Chat session was not found.' })
              return
            }
            const remaining = listWebChatSessions(
              options.cwd,
              options.sessionStoreLocation,
            )
            if (message.sessionId === activeSessionId) {
              loadActiveSession(remaining[0]?.id)
            }
            sendSessionsUpdated()
            return
          }
          if (message.type === 'send_message') {
            const sessionId = ensureActiveSessionId()
            const staged = await stageWebMessageAttachments({
              cwd: options.cwd,
              sessionId,
              attachments: message.attachments,
            })
            const titleText = attachmentTitleFallback(message.text, message.attachments)
            ensureActiveSessionForMessage(titleText)
            const activeSession = await ensureSession()
            activeSession.handleClientMessage({
              ...message,
              text: prependAttachmentReferences(message.text, staged),
              attachments: undefined,
            })
            return
          }
          if (message.type === 'permission_response') {
            if (!session) {
              send({ type: 'error', message: 'Permission request is no longer pending.' })
              return
            }
            session.handleClientMessage(message)
            return
          }
          if (message.type === 'abort') {
            if (!session) {
              send({ type: 'status', status: 'Ready', detail: 'No running session' })
              return
            }
            session.handleClientMessage(message)
            return
          }
          const activeSession = await ensureSession()
          activeSession.handleClientMessage(message)
        } catch (error) {
          send({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    })

    ws.on('close', () => {
      session?.dispose()
      session = null
    })
  })

  const handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws' || !isAuthorized(request, url, options.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request)
    })
  }

  return {
    handler,
    handleUpgrade,
    close: () => {
      wss.clients.forEach(client => client.terminate())
      wss.close(() => {})
    },
  }
}

function formatBrowserHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`
  return host
}

export async function startWebUi(rawOptions: WebUiServerOptions = {}): Promise<void> {
  const host = rawOptions.host || '127.0.0.1'
  const cwd = resolve(rawOptions.cwd ?? process.cwd())
  const permissionMode = normalizePermissionMode(rawOptions.permissionMode)
  const token = randomBytes(24).toString('base64url')
  const legacyCwds = [
    ...(rawOptions.legacyCwds ?? []),
    ...parseLegacyCwdEnv(process.env.OPENCAT_LEGACY_WEB_CWD),
  ]
  const bootstrapUserDirs =
    rawOptions.bootstrapUserDirs ??
    process.env.OPENCAT_BOOTSTRAP_WEB_DIRS === '1'
  const app = createWebUiApp({
    cwd,
    permissionMode,
    token,
    spawnFactory: rawOptions.spawnFactory,
    profileLocation: rawOptions.profileLocation,
    sessionStoreLocation: rawOptions.sessionStoreLocation,
    legacyCwds,
    bootstrapUserDirs,
  })
  const server = createServer(app.handler)
  server.on('upgrade', app.handleUpgrade)

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(parsePort(rawOptions.port), host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address() as AddressInfo
  const url = `http://${formatBrowserHost(host)}:${address.port}/#token=${token}`
  process.stdout.write(`OpenCat Web: ${url}\n`)

  if (rawOptions.openBrowser !== false) {
    void openSystemBrowser(url)
  }

  await new Promise<void>(resolveClose => {
    let closing = false
    const close = (): void => {
      if (closing) return
      closing = true
      app.close()
      server.close(() => resolveClose())
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    server.once('close', resolveClose)
  })
}
