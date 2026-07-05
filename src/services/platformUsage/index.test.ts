import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import type { ClaudeCodeStats } from '../../utils/stats.js'
import {
  aggregatePlatformUsageEvents,
  appendPlatformUsageEvent,
  collectPlatformUsageSummary,
  readPlatformUsageEvents,
  recordAppTestUsageExecuted,
  recordAppTestUsageStart,
  reportPlatformUsage,
  shanghaiWeekStartUtc,
} from './index.js'

let tempDir = ''

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'opencat-platform-usage-'))
  return tempDir
}

function emptyStats(partial: Partial<ClaudeCodeStats> = {}): ClaudeCodeStats {
  return {
    totalSessions: 0,
    totalMessages: 0,
    totalDays: 0,
    activeDays: 0,
    streaks: {
      currentStreak: 0,
      longestStreak: 0,
      currentStreakStart: null,
      longestStreakStart: null,
      longestStreakEnd: null,
    },
    dailyActivity: [],
    dailyModelTokens: [],
    longestSession: null,
    modelUsage: {},
    firstSessionDate: null,
    lastSessionDate: null,
    peakActivityDay: null,
    peakActivityHour: null,
    totalSpeculationTimeSavedMs: 0,
    ...partial,
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('platform usage service', () => {
  test('computes Shanghai week start in UTC', () => {
    expect(shanghaiWeekStartUtc(new Date('2026-07-08T12:00:00.000Z')).toISOString()).toBe(
      '2026-07-05T16:00:00.000Z',
    )
  })

  test('records one AppTest call as generated, adopted, and executed case', () => {
    const configDir = makeTempDir()
    recordAppTestUsageStart({
      caseId: 'case-1',
      platform: 'android',
      executionMode: 'midscene_ai',
      at: new Date('2026-07-08T01:00:00.000Z'),
      configDir,
    })
    recordAppTestUsageExecuted({
      caseId: 'case-1',
      platform: 'android',
      executionMode: 'midscene_ai',
      success: true,
      durationMs: 3000,
      at: new Date('2026-07-08T01:02:00.000Z'),
      configDir,
    })

    const counts = aggregatePlatformUsageEvents(
      readPlatformUsageEvents({ configDir }),
      new Date('2026-07-08T12:00:00.000Z'),
    )

    expect(counts).toMatchObject({
      generatedWeek: 1,
      generatedTotal: 1,
      adoptedWeek: 1,
      adoptedTotal: 1,
      executedWeek: 1,
      executedTotal: 1,
      durationSecondsWeek: 3,
      durationSecondsTotal: 3,
    })
  })

  test('builds old payload v2 shape with case and token counts', async () => {
    const configDir = makeTempDir()
    appendPlatformUsageEvent({
      eventType: 'case_generated',
      caseId: 'case-1',
      at: '2026-07-08T01:00:00.000Z',
    }, { configDir })
    appendPlatformUsageEvent({
      eventType: 'case_adopted',
      caseId: 'case-1',
      at: '2026-07-08T01:00:00.000Z',
    }, { configDir })
    appendPlatformUsageEvent({
      eventType: 'case_executed',
      caseId: 'case-1',
      at: '2026-07-08T01:02:00.000Z',
      durationSeconds: 3,
    }, { configDir })

    const summary = await collectPlatformUsageSummary({
      configDir,
      now: new Date('2026-07-08T12:00:00.000Z'),
      statsLoader: async () => emptyStats({
        dailyModelTokens: [
          { date: '2026-07-08', tokensByModel: { model: 42 } },
        ],
        modelUsage: {
          model: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadInputTokens: 5,
            cacheCreationInputTokens: 7,
            webSearchRequests: 0,
            costUSD: 0,
            contextWindow: 0,
            maxOutputTokens: 0,
          },
        },
      }),
    })

    expect(summary.payload).toMatchObject({
      payload_version: 2,
      report_mode: 'snapshot',
      timezone: 'Asia/Shanghai',
      generated_case_count_week: 1,
      adopted_case_count_week: 1,
      case_adoption_rate_week: 100,
      executed_case_count_week: 1,
      task_execution_duration_seconds_week: 3,
      token_usage_week: 42,
      token_usage_total: 132,
      client_version: '7.0.0',
    })
    expect(summary.payload.client_instance_id).toBeTruthy()
  })

  test('reports snapshot to the old platform endpoint with JWT authorization', async () => {
    const configDir = makeTempDir()
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = []
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body || '{}')),
        auth: new Headers(init?.headers).get('authorization'),
      })
      return jsonResponse({ success: true })
    }

    const result = await reportPlatformUsage({
      baseUrl: 'http://platform.example.test',
      accessToken: 'access-token',
      configDir,
      fetcher,
      statsLoader: async () => emptyStats(),
    })

    expect(result.success).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://platform.example.test/api/system/agent_usage_data/report/')
    expect(calls[0]?.auth).toBe('JWT access-token')
    expect(calls[0]?.body).toMatchObject({ payload_version: 2 })
  })
})
