import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { PRODUCT_VERSION } from '../../constants/product.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  aggregateClaudeCodeStats,
  type ClaudeCodeStats,
} from '../../utils/stats.js'
import { authorizationHeader } from '../platformAuth/index.js'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const USAGE_REPORT_TIMEOUT_MS = 8_000

export type PlatformUsageEventType =
  | 'case_generated'
  | 'case_adopted'
  | 'case_executed'

export type PlatformUsageEvent = {
  eventType: PlatformUsageEventType
  caseId: string
  at: string
  platform?: string
  executionMode?: string
  success?: boolean
  durationSeconds?: number
}

export type PlatformUsageCounts = {
  generatedWeek: number
  generatedTotal: number
  adoptedWeek: number
  adoptedTotal: number
  executedWeek: number
  executedTotal: number
  durationSecondsWeek: number
  durationSecondsTotal: number
}

export type PlatformUsageSnapshot = {
  payload_version: 2
  report_mode: 'snapshot'
  client_instance_id: string
  week_start_at: string
  timezone: 'Asia/Shanghai'
  generated_case_count_week: number
  generated_case_count_total: number
  adopted_case_count_week: number
  adopted_case_count_total: number
  case_adoption_rate_week: number
  case_adoption_rate_total: number
  executed_case_count_week: number
  executed_case_count_total: number
  task_execution_duration_seconds_week: number
  task_execution_duration_seconds_total: number
  token_usage_week: number
  token_usage_total: number
  client_version: string
  reported_at: string
}

export type PlatformUsageSummary = {
  counts: PlatformUsageCounts
  tokenUsageWeek: number
  tokenUsageTotal: number
  clientInstanceId: string
  weekStartAt: string
  payload: PlatformUsageSnapshot
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function getPlatformUsageEventsPath(configDir = getClaudeConfigHomeDir()): string {
  return join(configDir, 'webui', 'platform-usage-events.jsonl')
}

export function getPlatformIdentityPath(configDir = getClaudeConfigHomeDir()): string {
  return join(configDir, 'identity.json')
}

function writeJsonAtomic(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(tempPath, path)
}

function parseJsonLine(line: string): PlatformUsageEvent | null {
  try {
    const payload = JSON.parse(line) as Partial<PlatformUsageEvent>
    if (
      payload.eventType !== 'case_generated' &&
      payload.eventType !== 'case_adopted' &&
      payload.eventType !== 'case_executed'
    ) {
      return null
    }
    if (!payload.caseId || !payload.at) return null
    return {
      eventType: payload.eventType,
      caseId: String(payload.caseId),
      at: String(payload.at),
      platform: typeof payload.platform === 'string' ? payload.platform : undefined,
      executionMode: typeof payload.executionMode === 'string' ? payload.executionMode : undefined,
      success: typeof payload.success === 'boolean' ? payload.success : undefined,
      durationSeconds:
        typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds)
          ? Math.max(0, payload.durationSeconds)
          : undefined,
    }
  } catch {
    return null
  }
}

export function readPlatformUsageEvents(options: {
  configDir?: string
} = {}): PlatformUsageEvent[] {
  const path = getPlatformUsageEventsPath(options.configDir)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseJsonLine)
    .filter((event): event is PlatformUsageEvent => Boolean(event))
}

export function appendPlatformUsageEvent(
  event: PlatformUsageEvent,
  options: { configDir?: string } = {},
): void {
  const path = getPlatformUsageEventsPath(options.configDir)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`, { encoding: 'utf8' })
}

export function recordAppTestUsageStart(options: {
  caseId: string
  platform: string
  executionMode: string
  at?: Date
  configDir?: string
}): void {
  const at = (options.at ?? new Date()).toISOString()
  try {
    appendPlatformUsageEvent({
      eventType: 'case_generated',
      caseId: options.caseId,
      at,
      platform: options.platform,
      executionMode: options.executionMode,
    }, { configDir: options.configDir })
    appendPlatformUsageEvent({
      eventType: 'case_adopted',
      caseId: options.caseId,
      at,
      platform: options.platform,
      executionMode: options.executionMode,
    }, { configDir: options.configDir })
  } catch {
    // Usage recording must never break the AppTest execution path.
  }
}

export function recordAppTestUsageExecuted(options: {
  caseId: string
  platform: string
  executionMode: string
  success: boolean
  durationMs: number
  at?: Date
  configDir?: string
}): void {
  try {
    appendPlatformUsageEvent({
      eventType: 'case_executed',
      caseId: options.caseId,
      at: (options.at ?? new Date()).toISOString(),
      platform: options.platform,
      executionMode: options.executionMode,
      success: options.success,
      durationSeconds: Math.max(0, Math.round(options.durationMs / 1000)),
    }, { configDir: options.configDir })
  } catch {
    // Usage recording must never break the AppTest execution path.
  }
}

export function shanghaiWeekStartUtc(now = new Date()): Date {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  const day = local.getUTCDay()
  const daysSinceMonday = (day + 6) % 7
  const localWeekStart = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0,
  )
  return new Date(localWeekStart - SHANGHAI_OFFSET_MS)
}

function shanghaiDateString(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function ratePercent(adopted: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((Math.max(0, adopted) / total) * 10_000) / 100
}

export function aggregatePlatformUsageEvents(
  events: PlatformUsageEvent[],
  now = new Date(),
): PlatformUsageCounts {
  const weekStart = shanghaiWeekStartUtc(now).getTime()
  const generated = new Set<string>()
  const generatedWeek = new Set<string>()
  const adopted = new Set<string>()
  const adoptedWeek = new Set<string>()
  const executed = new Set<string>()
  const executedWeek = new Set<string>()
  let durationSecondsTotal = 0
  let durationSecondsWeek = 0

  for (const event of events) {
    const eventTime = Date.parse(event.at)
    if (!Number.isFinite(eventTime)) continue
    const inWeek = eventTime >= weekStart
    if (event.eventType === 'case_generated') {
      generated.add(event.caseId)
      if (inWeek) generatedWeek.add(event.caseId)
    } else if (event.eventType === 'case_adopted') {
      adopted.add(event.caseId)
      if (inWeek) adoptedWeek.add(event.caseId)
    } else if (event.eventType === 'case_executed') {
      const alreadyExecuted = executed.has(event.caseId)
      executed.add(event.caseId)
      if (inWeek) executedWeek.add(event.caseId)
      if (!alreadyExecuted) {
        durationSecondsTotal += Math.max(0, Math.round(event.durationSeconds || 0))
      }
      if (inWeek) {
        durationSecondsWeek += Math.max(0, Math.round(event.durationSeconds || 0))
      }
    }
  }

  return {
    generatedWeek: generatedWeek.size,
    generatedTotal: generated.size,
    adoptedWeek: adoptedWeek.size,
    adoptedTotal: adopted.size,
    executedWeek: executedWeek.size,
    executedTotal: executed.size,
    durationSecondsWeek,
    durationSecondsTotal,
  }
}

function sumModelUsageTokens(stats: ClaudeCodeStats): number {
  return Object.values(stats.modelUsage).reduce(
    (total, usage) =>
      total +
      (usage.inputTokens || 0) +
      (usage.outputTokens || 0) +
      (usage.cacheReadInputTokens || 0) +
      (usage.cacheCreationInputTokens || 0),
    0,
  )
}

function sumWeekTokens(stats: ClaudeCodeStats, weekStart: Date): number {
  const weekStartDay = shanghaiDateString(weekStart)
  return stats.dailyModelTokens
    .filter(day => day.date >= weekStartDay)
    .reduce(
      (total, day) =>
        total + Object.values(day.tokensByModel).reduce((sum, value) => sum + value, 0),
      0,
    )
}

function loadOrCreateClientInstanceId(configDir = getClaudeConfigHomeDir()): string {
  const path = getPlatformIdentityPath(configDir)
  if (existsSync(path)) {
    try {
      const payload = JSON.parse(readFileSync(path, 'utf8')) as { client_instance_id?: unknown }
      const existing = typeof payload.client_instance_id === 'string'
        ? payload.client_instance_id.trim()
        : ''
      if (existing) return existing.slice(0, 128)
    } catch {
      // Fall through and create a fresh identifier.
    }
  }
  const clientInstanceId = randomUUID()
  writeJsonAtomic(path, {
    client_instance_id: clientInstanceId,
    created_by: 'OpenCat',
    updated_at: new Date().toISOString(),
  })
  return clientInstanceId
}

export async function collectPlatformUsageSummary(options: {
  now?: Date
  configDir?: string
  statsLoader?: () => Promise<ClaudeCodeStats>
} = {}): Promise<PlatformUsageSummary> {
  const now = options.now ?? new Date()
  const weekStart = shanghaiWeekStartUtc(now)
  const counts = aggregatePlatformUsageEvents(
    readPlatformUsageEvents({ configDir: options.configDir }),
    now,
  )
  const stats = await (options.statsLoader ?? aggregateClaudeCodeStats)()
  const tokenUsageWeek = sumWeekTokens(stats, weekStart)
  const tokenUsageTotal = sumModelUsageTokens(stats)
  const clientInstanceId = loadOrCreateClientInstanceId(options.configDir)
  const payload: PlatformUsageSnapshot = {
    payload_version: 2,
    report_mode: 'snapshot',
    client_instance_id: clientInstanceId,
    week_start_at: weekStart.toISOString(),
    timezone: 'Asia/Shanghai',
    generated_case_count_week: counts.generatedWeek,
    generated_case_count_total: counts.generatedTotal,
    adopted_case_count_week: counts.adoptedWeek,
    adopted_case_count_total: counts.adoptedTotal,
    case_adoption_rate_week: ratePercent(counts.adoptedWeek, counts.generatedWeek),
    case_adoption_rate_total: ratePercent(counts.adoptedTotal, counts.generatedTotal),
    executed_case_count_week: counts.executedWeek,
    executed_case_count_total: counts.executedTotal,
    task_execution_duration_seconds_week: counts.durationSecondsWeek,
    task_execution_duration_seconds_total: counts.durationSecondsTotal,
    token_usage_week: tokenUsageWeek,
    token_usage_total: tokenUsageTotal,
    client_version: PRODUCT_VERSION,
    reported_at: now.toISOString(),
  }
  return {
    counts,
    tokenUsageWeek,
    tokenUsageTotal,
    clientInstanceId,
    weekStartAt: weekStart.toISOString(),
    payload,
  }
}

async function postJson(
  url: string,
  payload: unknown,
  accessToken: string,
  fetcher: FetchLike,
): Promise<{ statusCode: number; response: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), USAGE_REPORT_TIMEOUT_MS)
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: authorizationHeader(accessToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await response.text()
    let body: unknown = {}
    try {
      body = text.trim() ? JSON.parse(text) : {}
    } catch {
      body = { text }
    }
    if (!response.ok) {
      throw new Error(`Usage report failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
    }
    return { statusCode: response.status, response: body }
  } finally {
    clearTimeout(timer)
  }
}

export async function reportPlatformUsage(options: {
  baseUrl: string
  accessToken: string
  fetcher?: FetchLike
  configDir?: string
  statsLoader?: () => Promise<ClaudeCodeStats>
}): Promise<{
  success: boolean
  statusCode: number
  payload: PlatformUsageSnapshot
  response: unknown
}> {
  const summary = await collectPlatformUsageSummary({
    configDir: options.configDir,
    statsLoader: options.statsLoader,
  })
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  const result = await postJson(
    `${baseUrl}/api/system/agent_usage_data/report/`,
    summary.payload,
    options.accessToken,
    options.fetcher ?? fetch,
  )
  return {
    success: true,
    statusCode: result.statusCode,
    payload: summary.payload,
    response: result.response,
  }
}
