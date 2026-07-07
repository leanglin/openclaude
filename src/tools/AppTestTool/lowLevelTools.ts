import { z } from 'zod/v4'
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  finishAppTestSession,
  isAllowedAppTestAdbArgs,
  normalizeAdbArgs,
  observeAppTestSession,
  runAppTestSessionAction,
  runAppTestSessionAdb,
  runAppTestSessionAiAct,
  runAppTestSessionAssert,
  startAppTestSession,
  type AppTestSessionActionInput,
  type AppTestSessionAdbInput,
  type AppTestSessionAiActInput,
  type AppTestSessionAssertInput,
  type AppTestSessionFinishInput,
  type AppTestSessionObserveInput,
  type AppTestSessionResult,
  type AppTestSessionStartInput,
} from '../../services/appTest/sessionClient.js'
import { isHighRiskAppTestInput } from '../../services/appTest/risk.js'

export const OPENCAT_MIDSCENE_START_TOOL_NAME = 'opencat_midscene_start'
export const OPENCAT_MIDSCENE_OBSERVE_TOOL_NAME = 'opencat_midscene_observe'
export const OPENCAT_MIDSCENE_ACTION_TOOL_NAME = 'opencat_midscene_action'
export const OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME = 'opencat_midscene_ai_act'
export const OPENCAT_MIDSCENE_ASSERT_TOOL_NAME = 'opencat_midscene_assert'
export const OPENCAT_ANDROID_ADB_TOOL_NAME = 'opencat_android_adb'
export const OPENCAT_MIDSCENE_FINISH_TOOL_NAME = 'opencat_midscene_finish'

const targetSchema = lazySchema(() =>
  z.union([z.string(), z.record(z.string(), z.unknown())]),
)

const resultSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    session_id: z.string(),
    platform: z.enum(['android', 'web']).optional(),
    trace_dir: z.string().optional(),
    response: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())),
    artifact_warnings: z.array(z.string()).optional(),
    route_memory_path: z.string().optional(),
    reflection_report_path: z.string().optional(),
    execution_report_path: z.string().optional(),
  }),
)
type ResultSchema = ReturnType<typeof resultSchema>

const startInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string().optional(),
    platform: z.enum(['android', 'web']).default('android').optional(),
    app_package: z.string().optional(),
    package_name: z.string().optional(),
    start_url: z.string().optional(),
    device_id: z.string().optional(),
    test_goal: z.string().optional(),
    trace_dir: z.string().optional(),
    mock_mode: z.boolean().optional(),
    execution_plan_path: z.string().optional(),
    route_memory_path: z.string().optional(),
    reflection_report_path: z.string().optional(),
    execution_report_path: z.string().optional(),
    batch_id: z.string().optional(),
    case_id: z.string().optional(),
  }),
)
type StartInputSchema = ReturnType<typeof startInputSchema>

const observeInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    source: z.string().optional(),
  }),
)
type ObserveInputSchema = ReturnType<typeof observeInputSchema>

const actionInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    action: z.string(),
    intent: z.string().optional(),
    target: targetSchema().optional(),
    value: z.string().optional(),
    assert_after: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
    observe_after: z.boolean().optional(),
  }),
)
type ActionInputSchema = ReturnType<typeof actionInputSchema>

const aiActInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    instruction: z.string(),
    observe_after: z.boolean().optional(),
  }),
)
type AiActInputSchema = ReturnType<typeof aiActInputSchema>

const assertInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    assertion: z.string().optional(),
    expected: z.string().optional(),
    mock_pass: z.boolean().optional(),
  }),
)
type AssertInputSchema = ReturnType<typeof assertInputSchema>

const adbInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    args: z.array(z.string()).optional(),
    adb_args: z.array(z.string()).optional(),
    command: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  }),
)
type AdbInputSchema = ReturnType<typeof adbInputSchema>

const finishInputSchema = lazySchema(() =>
  z.strictObject({
    session_id: z.string(),
    success: z.boolean().optional(),
    summary: z.string().optional(),
  }),
)
type FinishInputSchema = ReturnType<typeof finishInputSchema>

function appTestPermissionMessage(name: string, input: unknown): string {
  const target = JSON.stringify(input ?? {})
  return `${PRODUCT_DISPLAY_NAME} wants to run ${name} for an App/Web test: ${target}`
}

function askPermission(name: string, input: unknown): PermissionDecision {
  return {
    behavior: 'ask',
    message: isHighRiskAppTestInput(input)
      ? `${appTestPermissionMessage(name, input)}. The request includes high-risk action text and needs explicit confirmation.`
      : appTestPermissionMessage(name, input),
    suggestions: [
      {
        type: 'addRules',
        destination: 'localSettings',
        rules: [{ toolName: name }],
        behavior: 'allow',
      },
    ],
  }
}

function renderUse(input: { session_id?: string } | undefined, action: string): string {
  return input?.session_id ? `${action} ${input.session_id}` : action
}

function renderResult(output: AppTestSessionResult): string {
  return `AppTest session ${output.session_id}: ${output.success ? 'ok' : 'failed'} - ${output.message}`
}

function mapResult(content: AppTestSessionResult, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: JSON.stringify(content, null, 2),
  }
}

export const OpencatMidsceneStartTool = buildTool({
  name: OPENCAT_MIDSCENE_START_TOOL_NAME,
  searchHint: 'start structured AppTest Midscene session',
  maxResultSizeChars: 100_000,
  async description(input) {
    return appTestPermissionMessage(OPENCAT_MIDSCENE_START_TOOL_NAME, input)
  },
  async prompt() {
    return 'Start a low-level AppTest Midscene session for structured Android or Web UI execution.'
  },
  get inputSchema(): StartInputSchema {
    return startInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  isReadOnly(input) {
    return input.mock_mode === true
  },
  isDestructive(input) {
    return isHighRiskAppTestInput(input)
  },
  isOpenWorld(input) {
    return input.platform === 'web' || Boolean(input.start_url)
  },
  toAutoClassifierInput(input) {
    return input
  },
  async validateInput(input) {
    const typed = input as AppTestSessionStartInput
    if (typed.mock_mode === true) return { result: true }
    const platform = typed.platform === 'web' || typed.start_url ? 'web' : 'android'
    if (platform === 'android' && !typed.app_package && !typed.package_name) {
      return {
        result: false,
        message: 'opencat_midscene_start requires app_package or package_name for non-mock Android sessions.',
        errorCode: 1,
      }
    }
    if (platform === 'web' && !typed.start_url) {
      return {
        result: false,
        message: 'opencat_midscene_start requires start_url for non-mock Web sessions.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    if ((input as AppTestSessionStartInput).mock_mode === true) {
      return { behavior: 'allow', updatedInput: input }
    }
    return askPermission(OPENCAT_MIDSCENE_START_TOOL_NAME, input)
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Start AppTest session')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await startAppTestSession(input as AppTestSessionStartInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<StartInputSchema, AppTestSessionResult>)

export const OpencatMidsceneObserveTool = buildTool({
  name: OPENCAT_MIDSCENE_OBSERVE_TOOL_NAME,
  searchHint: 'observe current AppTest Midscene screen',
  maxResultSizeChars: 100_000,
  async description(input) {
    return `Observe AppTest session ${(input as AppTestSessionObserveInput).session_id}.`
  },
  async prompt() {
    return 'Observe the current Android or Web UI state in a low-level AppTest session.'
  },
  get inputSchema(): ObserveInputSchema {
    return observeInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Observe AppTest session')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await observeAppTestSession(input as AppTestSessionObserveInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<ObserveInputSchema, AppTestSessionResult>)

export const OpencatMidsceneActionTool = buildTool({
  name: OPENCAT_MIDSCENE_ACTION_TOOL_NAME,
  searchHint: 'run deterministic AppTest tap type swipe action',
  maxResultSizeChars: 100_000,
  async description(input) {
    return appTestPermissionMessage(OPENCAT_MIDSCENE_ACTION_TOOL_NAME, input)
  },
  async prompt() {
    return 'Run one deterministic low-level AppTest action such as tap, type, swipe, back, wait, or open_url.'
  },
  get inputSchema(): ActionInputSchema {
    return actionInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  isDestructive(input) {
    return isHighRiskAppTestInput(input)
  },
  toAutoClassifierInput(input) {
    return input
  },
  async validateInput(input) {
    if (!(input as AppTestSessionActionInput).action.trim()) {
      return { result: false, message: 'opencat_midscene_action requires action.', errorCode: 1 }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return askPermission(OPENCAT_MIDSCENE_ACTION_TOOL_NAME, input)
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Run AppTest action')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await runAppTestSessionAction(input as AppTestSessionActionInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<ActionInputSchema, AppTestSessionResult>)

export const OpencatMidsceneAiActTool = buildTool({
  name: OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME,
  searchHint: 'run semantic Midscene AI action',
  maxResultSizeChars: 100_000,
  async description(input) {
    return appTestPermissionMessage(OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME, input)
  },
  async prompt() {
    return 'Run one semantic visual AppTest action through Midscene aiAct.'
  },
  get inputSchema(): AiActInputSchema {
    return aiActInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  isDestructive(input) {
    return isHighRiskAppTestInput(input)
  },
  toAutoClassifierInput(input) {
    return input
  },
  async validateInput(input) {
    if (!(input as AppTestSessionAiActInput).instruction.trim()) {
      return { result: false, message: 'opencat_midscene_ai_act requires instruction.', errorCode: 1 }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return askPermission(OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME, input)
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Run AppTest aiAct')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await runAppTestSessionAiAct(input as AppTestSessionAiActInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<AiActInputSchema, AppTestSessionResult>)

export const OpencatMidsceneAssertTool = buildTool({
  name: OPENCAT_MIDSCENE_ASSERT_TOOL_NAME,
  searchHint: 'assert current AppTest Midscene UI',
  maxResultSizeChars: 100_000,
  async description(input) {
    return `Assert AppTest session ${(input as AppTestSessionAssertInput).session_id}.`
  },
  async prompt() {
    return 'Run one low-level visual assertion in an AppTest Midscene session.'
  },
  get inputSchema(): AssertInputSchema {
    return assertInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  isReadOnly() {
    return true
  },
  async validateInput(input) {
    const typed = input as AppTestSessionAssertInput
    if (!typed.assertion?.trim() && !typed.expected?.trim()) {
      return { result: false, message: 'opencat_midscene_assert requires assertion or expected.', errorCode: 1 }
    }
    return { result: true }
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Assert AppTest session')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await runAppTestSessionAssert(input as AppTestSessionAssertInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<AssertInputSchema, AppTestSessionResult>)

export const OpencatAndroidAdbTool = buildTool({
  name: OPENCAT_ANDROID_ADB_TOOL_NAME,
  searchHint: 'run safe allowlisted adb command',
  maxResultSizeChars: 100_000,
  async description(input) {
    return appTestPermissionMessage(OPENCAT_ANDROID_ADB_TOOL_NAME, input)
  },
  async prompt() {
    return 'Run a safe allowlisted adb command inside an AppTest session.'
  },
  get inputSchema(): AdbInputSchema {
    return adbInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  toAutoClassifierInput(input) {
    return input
  },
  async validateInput(input) {
    const args = normalizeAdbArgs(input as AppTestSessionAdbInput)
    if (!isAllowedAppTestAdbArgs(args)) {
      return {
        result: false,
        message: `opencat_android_adb only allows safe adb commands. Rejected: ${args.join(' ') || '<empty>'}`,
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return askPermission(OPENCAT_ANDROID_ADB_TOOL_NAME, input)
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Run AppTest adb')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await runAppTestSessionAdb(input as AppTestSessionAdbInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<AdbInputSchema, AppTestSessionResult>)

export const OpencatMidsceneFinishTool = buildTool({
  name: OPENCAT_MIDSCENE_FINISH_TOOL_NAME,
  searchHint: 'finish AppTest Midscene session and write artifacts',
  maxResultSizeChars: 100_000,
  async description(input) {
    return `Finish AppTest session ${(input as AppTestSessionFinishInput).session_id}.`
  },
  async prompt() {
    return 'Finish a low-level AppTest Midscene session, write trace/report, and merge configured artifacts.'
  },
  get inputSchema(): FinishInputSchema {
    return finishInputSchema()
  },
  get outputSchema(): ResultSchema {
    return resultSchema()
  },
  renderToolUseMessage(input) {
    return renderUse(input, 'Finish AppTest session')
  },
  renderToolResultMessage(output) {
    return renderResult(output)
  },
  async call(input, { abortController }) {
    return { data: await finishAppTestSession(input as AppTestSessionFinishInput, abortController.signal) }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<FinishInputSchema, AppTestSessionResult>)

export const AppTestLowLevelTools = [
  OpencatMidsceneStartTool,
  OpencatMidsceneObserveTool,
  OpencatMidsceneActionTool,
  OpencatMidsceneAiActTool,
  OpencatMidsceneAssertTool,
  OpencatAndroidAdbTool,
  OpencatMidsceneFinishTool,
] as const
