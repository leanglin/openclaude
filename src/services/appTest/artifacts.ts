import { isAbsolute, resolve } from 'node:path'
import type { AppTestEvent } from './types.js'

const SENSITIVE_KEY_RE =
  /password|secret|token|api[_-]?key|access[_-]?key|authorization|cookie/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

export function redactAndTrim(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]'
  if (typeof value === 'string') return clip(value, 2000)
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    return value.slice(0, 30).map(item => redactAndTrim(item, depth + 1))
  }
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_RE.test(key)
      ? '[redacted]'
      : redactAndTrim(item, depth + 1)
  }
  return output
}

export function truncateEvents(
  events: AppTestEvent[],
  maxEvents = 40,
): AppTestEvent[] {
  return events.slice(-maxEvents).map(event => redactAndTrim(event) as AppTestEvent)
}

export function collectScreenshots(
  events: AppTestEvent[],
): Array<Record<string, unknown>> {
  const screenshots: Array<Record<string, unknown>> = []
  for (const event of events) {
    const payload = isRecord(event.payload) ? event.payload : event
    const list = payload.screenshots
    if (Array.isArray(list)) {
      for (const item of list) {
        if (isRecord(item)) screenshots.push(redactAndTrim(item) as Record<string, unknown>)
      }
    }
    if (payload.screenshot_artifact_path) {
      screenshots.push(
        redactAndTrim({
          step_index: payload.step_index,
          artifact_path: payload.screenshot_artifact_path,
          source: payload.screenshot_source,
        }) as Record<string, unknown>,
      )
    }
  }
  return screenshots
}

export function collectAssertions(
  events: AppTestEvent[],
): Array<Record<string, unknown>> {
  return events
    .filter(event => event.event_type === 'visual_assertion_result')
    .map(event => redactAndTrim(event.payload ?? event) as Record<string, unknown>)
}

function resolveArtifact(traceDir: string | undefined, value: unknown): string | undefined {
  const text = asText(value).trim()
  if (!text) return undefined
  if (!traceDir || isAbsolute(text)) return text
  return resolve(traceDir, text)
}

export function extractTracePath(
  events: AppTestEvent[],
  traceDir?: string,
): string | undefined {
  for (const event of [...events].reverse()) {
    const payload = isRecord(event.payload) ? event.payload : {}
    const trace = resolveArtifact(traceDir, payload.visual_trace)
    if (trace) return trace
  }
  return undefined
}

export function extractReportPath(
  events: AppTestEvent[],
  rawResult?: Record<string, unknown>,
  traceDir?: string,
): string | undefined {
  const direct = resolveArtifact(traceDir, rawResult?.midscene_report)
  if (direct) return direct
  for (const event of [...events].reverse()) {
    const payload = isRecord(event.payload) ? event.payload : {}
    const report = resolveArtifact(traceDir, payload.midscene_report)
    if (report) return report
  }
  return undefined
}
