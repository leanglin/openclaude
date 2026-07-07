import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { collectAssertions, collectScreenshots, redactAndTrim } from './artifacts.js'
import type { AppTestEvent, AppTestPlatform } from './types.js'

export type JsonObject = Record<string, unknown>

export type AppTestSessionArtifactInput = {
  cwd?: string
  session_id: string
  platform?: AppTestPlatform
  app_package?: string
  package_name?: string
  start_url?: string
  device_id?: string
  test_goal?: string
  trace_dir?: string
  mock_mode?: boolean
  execution_plan_path?: string
  route_memory_path?: string
  reflection_report_path?: string
  execution_report_path?: string
  batch_id?: string
  case_id?: string
}

export type AppTestSessionArtifactContext = {
  cwd: string
  paths: {
    execution_plan_path?: string
    route_memory_path?: string
    reflection_report_path?: string
    execution_report_path?: string
  }
  batch_id?: string
  case_id?: string
  shared_navigation_steps: unknown[]
  case_specific_steps: unknown[]
  slots: JsonObject
  warnings: string[]
}

export type AppTestSessionArtifactMergeInput = {
  session_id: string
  platform?: AppTestPlatform
  success: boolean
  summary?: string
  test_goal?: string
  response?: JsonObject
  events: AppTestEvent[]
}

export type AppTestSessionArtifactMergeResult = {
  artifact_warnings: string[]
  route_memory_path?: string
  reflection_report_path?: string
  execution_report_path?: string
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function clip(value: unknown, limit = 1200): string {
  const text = asText(value).trim()
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}...`
}

function resolveOptionalPath(
  value: string | undefined,
  cwd = process.cwd(),
): string | undefined {
  const text = value?.trim()
  if (!text) return undefined
  return isAbsolute(text) ? text : resolve(cwd, text)
}

function readJson(path: string | undefined, label: string, warnings: string[]): unknown {
  if (!path) return undefined
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    warnings.push(
      `${label} is not valid JSON and was not overwritten: ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return undefined
  }
}

function toList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordList(value: unknown): JsonObject[] {
  return toList(value).filter((item): item is JsonObject => isRecord(item))
}

function idOf(value: JsonObject): string {
  return asText(value.id || value.case_id || value.caseId || value.batch_id || value.batchId)
}

function findById(list: unknown, id: string | undefined): JsonObject | undefined {
  if (!id) return undefined
  return recordList(list).find(item => idOf(item) === id)
}

function firstConfigured(...values: unknown[]): unknown {
  return values.find(value => {
    if (value === undefined || value === null) return false
    if (typeof value === 'string') return value.trim().length > 0
    if (Array.isArray(value)) return value.length > 0
    if (isRecord(value)) return Object.keys(value).length > 0
    return true
  })
}

function stepText(step: unknown): string {
  if (typeof step === 'string') return step.trim()
  if (!isRecord(step)) return ''
  const direct = firstConfigured(
    step.instruction,
    step.action_text,
    step.step,
    step.description,
    step.title,
    step.name,
  )
  if (direct) return asText(direct).trim()
  const action = asText(firstConfigured(step.action, step.type)).trim()
  const target = asText(firstConfigured(step.target_text, step.target, step.selector)).trim()
  const value = asText(firstConfigured(step.value, step.text, step.input)).trim()
  return [action, target, value].filter(Boolean).join(' ').trim()
}

function stepTexts(steps: unknown[]): string[] {
  return steps.map(stepText).filter(Boolean)
}

function findBatch(plan: unknown, batchId: string | undefined): JsonObject {
  if (!isRecord(plan)) return {}
  const direct =
    findById(plan.batches, batchId) ||
    findById(plan.test_batches, batchId) ||
    findById(plan.groups, batchId)
  if (direct) return direct
  if (batchId && isRecord(plan[batchId])) return plan[batchId] as JsonObject
  if (!batchId && idOf(plan)) return plan
  return {}
}

function findCase(
  plan: unknown,
  batch: JsonObject,
  caseId: string | undefined,
): JsonObject {
  if (!caseId) return {}
  const caseSpecific = firstConfigured(batch.case_specific_steps, isRecord(plan) ? plan.case_specific_steps : undefined)
  if (isRecord(caseSpecific)) {
    const direct = caseSpecific[caseId]
    if (Array.isArray(direct)) return { case_id: caseId, case_specific_steps: direct }
    if (isRecord(direct)) return direct
  }
  return (
    findById(batch.cases, caseId) ||
    findById(batch.test_cases, caseId) ||
    findById(isRecord(plan) ? plan.cases : undefined, caseId) ||
    findById(isRecord(plan) ? plan.test_cases : undefined, caseId) ||
    {}
  )
}

function extractStepsFromCase(casePlan: JsonObject): unknown[] {
  return toList(
    firstConfigured(
      casePlan.case_specific_steps,
      casePlan.steps,
      casePlan.test_steps,
      casePlan.action_steps,
      casePlan.actions,
    ),
  )
}

function routeMemoryToSlots(routeMemory: unknown): JsonObject {
  if (!isRecord(routeMemory)) return {}
  const successfulRoutes = recordList(routeMemory.successful_routes).slice(-12)
  const failedRoutes = recordList(routeMemory.failed_routes).slice(-12)
  const currentPage = isRecord(routeMemory.current_page)
    ? routeMemory.current_page
    : undefined
  const visualExecutionMemory: JsonObject = {
    known_routes: successfulRoutes,
    avoid_actions: failedRoutes.map(route => ({ ...route, avoid: true })),
    recent_mistakes: failedRoutes,
    temporary_memory: currentPage ? [currentPage] : [],
  }
  const slots: JsonObject = {
    visual_execution_memory: visualExecutionMemory,
    visual_navigation_context: {
      current_page: currentPage,
      successful_route_count: successfulRoutes.length,
      failed_route_count: failedRoutes.length,
    },
  }
  if (currentPage) slots.current_page_reuse = currentPage
  const reusableRoute = [...successfulRoutes].reverse().find(route => Object.keys(route).length)
  if (reusableRoute) {
    slots.route_reuse = {
      enabled: true,
      route_id: reusableRoute.route_id || reusableRoute.id,
      from_case_id: reusableRoute.case_id,
      to_ref: reusableRoute.to_ref || reusableRoute.current_ref,
      action_text: reusableRoute.action_text || reusableRoute.summary,
      confidence: reusableRoute.confidence,
    }
    slots.used_navigation_routes = successfulRoutes.slice(-5)
  }
  return slots
}

export function buildSessionArtifactContext(
  input: AppTestSessionArtifactInput,
): AppTestSessionArtifactContext {
  const cwd = input.cwd || process.cwd()
  const warnings: string[] = []
  const paths = {
    execution_plan_path: resolveOptionalPath(input.execution_plan_path, cwd),
    route_memory_path: resolveOptionalPath(input.route_memory_path, cwd),
    reflection_report_path: resolveOptionalPath(input.reflection_report_path, cwd),
    execution_report_path: resolveOptionalPath(input.execution_report_path, cwd),
  }
  const executionPlan = readJson(
    paths.execution_plan_path,
    'execution_plan',
    warnings,
  )
  const routeMemory = readJson(paths.route_memory_path, 'route_memory', warnings)
  const batch = findBatch(executionPlan, input.batch_id)
  const casePlan = findCase(executionPlan, batch, input.case_id)
  const sharedNavigationSteps = toList(
    firstConfigured(
      batch.shared_navigation_steps,
      batch.shared_steps,
      batch.navigation_steps,
      isRecord(executionPlan)
        ? firstConfigured(
            executionPlan.shared_navigation_steps,
            executionPlan.shared_steps,
            executionPlan.navigation_steps,
          )
        : undefined,
    ),
  )
  const caseSpecificSteps = extractStepsFromCase(casePlan)
  const testSteps = [
    ...stepTexts(sharedNavigationSteps),
    ...stepTexts(caseSpecificSteps),
  ]
  const slots: JsonObject = {
    shared_navigation_steps: sharedNavigationSteps,
    case_specific_steps: caseSpecificSteps,
    structured_case_steps: {
      shared_navigation_steps: sharedNavigationSteps,
      case_specific_steps: caseSpecificSteps,
    },
    visual_navigation_context: {
      batch_id: input.batch_id,
      case_id: input.case_id,
      shared_navigation_step_count: sharedNavigationSteps.length,
      case_specific_step_count: caseSpecificSteps.length,
    },
  }
  if (testSteps.length) slots.test_steps = testSteps
  Object.assign(slots, routeMemoryToSlots(routeMemory))
  if (isRecord(slots.visual_navigation_context)) {
    slots.visual_navigation_context = {
      ...slots.visual_navigation_context,
      batch_id: input.batch_id,
      case_id: input.case_id,
      shared_navigation_steps: stepTexts(sharedNavigationSteps).slice(0, 12),
      case_specific_steps: stepTexts(caseSpecificSteps).slice(0, 12),
    }
  }
  return {
    cwd,
    paths,
    batch_id: input.batch_id,
    case_id: input.case_id,
    shared_navigation_steps: sharedNavigationSteps,
    case_specific_steps: caseSpecificSteps,
    slots,
    warnings,
  }
}

function generatedPath(path: string): string {
  const extension = extname(path) || '.json'
  const stem = path.slice(0, path.length - extension.length)
  return `${stem}.generated-${Date.now()}${extension}`
}

function writeJsonArtifact(
  path: string | undefined,
  label: string,
  value: JsonObject,
  warnings: string[],
): string | undefined {
  if (!path) return undefined
  let target = path
  if (existsSync(path)) {
    try {
      JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch {
      target = generatedPath(path)
      warnings.push(`${label} already contains invalid JSON; wrote ${target} instead of overwriting ${path}.`)
    }
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return target
}

function latestPayload(events: AppTestEvent[], eventType: string): JsonObject {
  for (const event of [...events].reverse()) {
    if (event.event_type === eventType && isRecord(event.payload)) {
      return event.payload
    }
  }
  return {}
}

function compactObservation(observation: JsonObject): JsonObject {
  return {
    current_ref: observation.current_ref,
    visible_text: clip(observation.visible_text || observation.summary, 500),
    summary: clip(observation.summary || observation.visible_text, 500),
    screenshot_artifact_path: observation.screenshot_artifact_path,
    screen_size: observation.screen_size,
    observed_at: new Date().toISOString(),
  }
}

function compactActionEvents(events: AppTestEvent[]): JsonObject[] {
  return events
    .filter(event => event.event_type === 'visual_action_executed')
    .map(event => (isRecord(event.payload) ? event.payload : event))
    .slice(-20)
    .map(event =>
      redactAndTrim({
        step_index: event.step_index,
        action: event.action,
        success: event.success,
        message: event.message,
      }) as JsonObject,
    )
}

function readBaseObject(path: string | undefined, label: string, warnings: string[]): JsonObject {
  const existing = readJson(path, label, warnings)
  return isRecord(existing) ? { ...existing } : {}
}

function updateBatchResult(memory: JsonObject, batchId: string | undefined, success: boolean): void {
  if (!batchId) return
  const batchResults = isRecord(memory.batch_results)
    ? { ...memory.batch_results }
    : {}
  const previous = isRecord(batchResults[batchId])
    ? batchResults[batchId] as JsonObject
    : {}
  const total = Number(previous.total_runs || 0) + 1
  const passed = Number(previous.passed_runs || 0) + (success ? 1 : 0)
  batchResults[batchId] = {
    ...previous,
    batch_id: batchId,
    total_runs: total,
    passed_runs: passed,
    failed_runs: total - passed,
    last_status: success ? 'passed' : 'failed',
    updated_at: new Date().toISOString(),
  }
  memory.batch_results = batchResults
}

function mergeRouteMemory(
  context: AppTestSessionArtifactContext,
  input: AppTestSessionArtifactMergeInput,
  warnings: string[],
): string | undefined {
  const path = context.paths.route_memory_path
  if (!path) return undefined
  const memory = readBaseObject(path, 'route_memory', warnings)
  const observation = latestPayload(input.events, 'visual_observed')
  const traceEvent = latestPayload(input.events, 'visual_trace_saved')
  const route = {
    route_id: `${context.batch_id || 'batch'}:${context.case_id || input.session_id}:${Date.now()}`,
    batch_id: context.batch_id,
    case_id: context.case_id,
    session_id: input.session_id,
    success: input.success,
    summary: clip(input.summary || input.response?.message || ''),
    test_goal: input.test_goal,
    current_ref: observation.current_ref,
    to_ref: observation.current_ref,
    action_text: compactActionEvents(input.events)
      .map(action => asText(action.action || action.message))
      .filter(Boolean)
      .join(' | '),
    actions: compactActionEvents(input.events),
    visual_trace: input.response?.visual_trace || traceEvent.visual_trace,
    midscene_report: input.response?.midscene_report || traceEvent.midscene_report,
    updated_at: new Date().toISOString(),
  }
  const successfulRoutes = recordList(memory.successful_routes)
  const failedRoutes = recordList(memory.failed_routes)
  if (input.success) {
    memory.successful_routes = [...successfulRoutes, route].slice(-50)
  } else {
    memory.failed_routes = [
      ...failedRoutes,
      { ...route, avoid: true, reason: route.summary || 'session failed' },
    ].slice(-50)
  }
  memory.current_page = {
    ...compactObservation(observation),
    batch_id: context.batch_id,
    case_id: context.case_id,
    session_id: input.session_id,
  }
  if (context.case_id) {
    const caseResults = isRecord(memory.case_results)
      ? { ...memory.case_results }
      : {}
    caseResults[context.case_id] = {
      case_id: context.case_id,
      batch_id: context.batch_id,
      session_id: input.session_id,
      status: input.success ? 'passed' : 'failed',
      summary: input.summary,
      visual_trace: route.visual_trace,
      updated_at: new Date().toISOString(),
    }
    memory.case_results = caseResults
  }
  updateBatchResult(memory, context.batch_id, input.success)
  return writeJsonArtifact(path, 'route_memory', memory, warnings)
}

function mergeReflectionReport(
  context: AppTestSessionArtifactContext,
  input: AppTestSessionArtifactMergeInput,
  warnings: string[],
): string | undefined {
  const path = context.paths.reflection_report_path
  if (!path) return undefined
  const report = readBaseObject(path, 'reflection_report', warnings)
  const repairEvents = input.events.filter(event =>
    /reflection|repair|self_healing|path_memory_delta/.test(asText(event.event_type)),
  )
  const failedAssertions = collectAssertions(input.events).filter(
    assertion => assertion.success === false || assertion.pass === false,
  )
  if (!input.success || repairEvents.length || failedAssertions.length) {
    const reflections = recordList(report.reflections)
    report.reflections = [
      ...reflections,
      {
        session_id: input.session_id,
        batch_id: context.batch_id,
        case_id: context.case_id,
        status: input.success ? 'completed_with_repair' : 'failed',
        summary: input.summary,
        failed_assertions: failedAssertions,
        repair_events: repairEvents.map(event => redactAndTrim(event) as JsonObject),
        visual_trace: input.response?.visual_trace,
        created_at: new Date().toISOString(),
      },
    ].slice(-100)
  }
  report.last_run = {
    session_id: input.session_id,
    batch_id: context.batch_id,
    case_id: context.case_id,
    status: input.success ? 'passed' : 'failed',
    updated_at: new Date().toISOString(),
  }
  return writeJsonArtifact(path, 'reflection_report', report, warnings)
}

function writeExecutionReport(
  context: AppTestSessionArtifactContext,
  input: AppTestSessionArtifactMergeInput,
  warnings: string[],
): string | undefined {
  const path = context.paths.execution_report_path
  if (!path) return undefined
  const report = {
    schema_version: 1,
    session_id: input.session_id,
    batch_id: context.batch_id,
    case_id: context.case_id,
    platform: input.platform,
    success: input.success,
    status: input.success ? 'passed' : 'failed',
    summary: input.summary || input.response?.message,
    test_goal: input.test_goal,
    finished_at: new Date().toISOString(),
    screenshots: collectScreenshots(input.events),
    assertions: collectAssertions(input.events),
    events: input.events.slice(-80).map(event => redactAndTrim(event)),
    artifacts: {
      visual_trace: input.response?.visual_trace,
      midscene_report: input.response?.midscene_report,
      route_memory_path: context.paths.route_memory_path,
      reflection_report_path: context.paths.reflection_report_path,
    },
  }
  return writeJsonArtifact(path, 'execution_report', report, warnings)
}

export function mergeSessionArtifacts(
  context: AppTestSessionArtifactContext,
  input: AppTestSessionArtifactMergeInput,
): AppTestSessionArtifactMergeResult {
  const warnings = [...context.warnings]
  const routeMemoryPath = mergeRouteMemory(context, input, warnings)
  const reflectionReportPath = mergeReflectionReport(context, input, warnings)
  const executionReportPath = writeExecutionReport(context, input, warnings)
  return {
    artifact_warnings: warnings,
    route_memory_path: routeMemoryPath,
    reflection_report_path: reflectionReportPath,
    execution_report_path: executionReportPath,
  }
}

export function createDefaultTraceDir(sessionId: string, cwd = process.cwd()): string {
  return join(cwd, 'midscene_trace', sessionId)
}
