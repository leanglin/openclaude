import { z } from 'zod/v4'
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runAppTest } from '../../services/appTest/runner.js'
import { isHighRiskAppTestInput } from '../../services/appTest/risk.js'
import type { AppTestInput, AppTestResult } from '../../services/appTest/types.js'
import { APP_TEST_TOOL_NAME } from './constants.js'
import { getAppTestPrompt } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const actionStepSchema = lazySchema(() =>
  z.record(z.string(), z.unknown()) as z.ZodType<Record<string, unknown>>,
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    platform: z.enum(['android', 'web']).default('android').optional(),
    app_package: z.string().optional(),
    package_name: z.string().optional(),
    start_url: z.string().optional(),
    device_id: z.string().optional(),
    test_goal: z.string(),
    test_steps: z.array(z.string()).optional(),
    assertions: z.array(z.string()).optional(),
    action_steps: z.array(actionStepSchema()).optional(),
    execution_mode: z
      .enum(['midscene_ai', 'codex_guided', 'mcp_tool_loop', 'yaml'])
      .optional(),
    yaml_script: z.string().optional(),
    max_steps: z.number().int().positive().optional(),
    risk_mode: z.enum(['confirm', 'block']).optional(),
    force_stop_before_launch: z.boolean().optional(),
    headed: z.boolean().optional(),
    viewport_width: z.number().int().positive().optional(),
    viewport_height: z.number().int().positive().optional(),
    mock_mode: z.boolean().optional(),
    trace_dir: z.string().optional(),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    message: z.string(),
    platform: z.enum(['android', 'web']),
    execution_mode: z.string().optional(),
    events: z.array(z.record(z.string(), z.unknown())),
    screenshots: z.array(z.record(z.string(), z.unknown())),
    assertions: z.array(z.record(z.string(), z.unknown())),
    trace_path: z.string().optional(),
    trace_dir: z.string().optional(),
    report_path: z.string().optional(),
    post_run_guidance: z.string().optional(),
    raw_result: z.record(z.string(), z.unknown()).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

function platformOf(input: AppTestInput): 'android' | 'web' {
  return input.platform === 'web' ? 'web' : 'android'
}

function hasOpenUrlAction(input: AppTestInput): boolean {
  return Boolean(
    input.action_steps?.some(
      step => String(step.action || '').trim().toLowerCase() === 'open_url',
    ),
  )
}

function buildPermissionMessage(input: AppTestInput): string {
  const platform = platformOf(input)
  if (platform === 'web') {
    const target = input.start_url || 'a web page'
    return `${PRODUCT_DISPLAY_NAME} wants to run a Web UI test against ${target}.`
  }
  const target = input.app_package || input.package_name || 'an Android app'
  return `${PRODUCT_DISPLAY_NAME} wants to run an Android App test against ${target}.`
}

function summarizeForClassifier(input: AppTestInput): unknown {
  return {
    platform: platformOf(input),
    target:
      input.platform === 'web'
        ? input.start_url
        : input.app_package || input.package_name,
    test_goal: input.test_goal,
    test_steps: input.test_steps,
    assertions: input.assertions,
    action_steps: input.action_steps,
    execution_mode: input.execution_mode || 'midscene_ai',
    mock_mode: input.mock_mode === true,
  }
}

export const AppTestTool = buildTool({
  name: APP_TEST_TOOL_NAME,
  searchHint: 'run Android app or web UI tests',
  maxResultSizeChars: 100_000,
  async description(input) {
    return buildPermissionMessage(input as AppTestInput)
  },
  async prompt() {
    return getAppTestPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return APP_TEST_TOOL_NAME
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Running ${summary}` : 'Running App/Web test'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    return input.mock_mode === true
  },
  isDestructive(input) {
    return isHighRiskAppTestInput(input)
  },
  interruptBehavior() {
    return 'cancel'
  },
  isOpenWorld(input) {
    return platformOf(input as AppTestInput) === 'web'
  },
  toAutoClassifierInput(input) {
    return summarizeForClassifier(input as AppTestInput)
  },
  async validateInput(input) {
    const typed = input as AppTestInput
    if (!typed.test_goal.trim()) {
      return {
        result: false,
        message: 'AppTest requires a non-empty test_goal.',
        errorCode: 1,
      }
    }
    if (typed.mock_mode === true) return { result: true }

    if (platformOf(typed) === 'android' && !typed.app_package && !typed.package_name) {
      return {
        result: false,
        message:
          'AppTest requires app_package or package_name for non-mock Android tests.',
        errorCode: 1,
      }
    }
    if (platformOf(typed) === 'web' && !typed.start_url && !hasOpenUrlAction(typed)) {
      return {
        result: false,
        message:
          'AppTest requires start_url for non-mock Web tests unless action_steps include open_url.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    const typed = input as AppTestInput
    if (typed.mock_mode === true) {
      return { behavior: 'allow', updatedInput: input }
    }

    const highRisk = isHighRiskAppTestInput(typed)
    if (highRisk && typed.risk_mode === 'block') {
      return {
        behavior: 'deny',
        message:
          'AppTest blocked a high-risk App/Web test request before running real actions.',
        decisionReason: {
          type: 'safetyCheck',
          reason: 'AppTest high-risk operation blocked by risk_mode=block',
          classifierApprovable: false,
        },
      }
    }

    return {
      behavior: 'ask',
      message: highRisk
        ? `${buildPermissionMessage(typed)} The request includes high-risk action text and needs explicit confirmation.`
        : buildPermissionMessage(typed),
      suggestions: [
        {
          type: 'addRules',
          destination: 'localSettings',
          rules: [{ toolName: APP_TEST_TOOL_NAME }],
          behavior: 'allow',
        },
      ],
    }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const result = await runAppTest(input as AppTestInput, abortController.signal)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const result = content as AppTestResult
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(result, null, 2),
    }
  },
} satisfies ToolDef<InputSchema, AppTestResult>)
