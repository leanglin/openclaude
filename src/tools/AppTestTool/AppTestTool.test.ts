import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../../tools.js'
import { AppTestTool } from './AppTestTool.js'
import { APP_TEST_TOOL_NAME } from './constants.js'
import {
  AppTestLowLevelTools,
  OPENCAT_ANDROID_ADB_TOOL_NAME,
  OPENCAT_MIDSCENE_ACTION_TOOL_NAME,
  OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME,
  OPENCAT_MIDSCENE_ASSERT_TOOL_NAME,
  OPENCAT_MIDSCENE_FINISH_TOOL_NAME,
  OPENCAT_MIDSCENE_OBSERVE_TOOL_NAME,
  OPENCAT_MIDSCENE_START_TOOL_NAME,
  OpencatAndroidAdbTool,
  OpencatMidsceneActionTool,
} from './lowLevelTools.js'
import { getAppTestPrompt } from './prompt.js'

describe('AppTestTool', () => {
  test('is registered as a single top-level tool', () => {
    expect(getAllBaseTools().some(tool => tool.name === APP_TEST_TOOL_NAME)).toBe(
      true,
    )
  })

  test('registers low-level AppTest session tools', () => {
    const names = new Set(getAllBaseTools().map(tool => tool.name))
    expect(names.has(OPENCAT_MIDSCENE_START_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_MIDSCENE_OBSERVE_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_MIDSCENE_ACTION_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_MIDSCENE_ASSERT_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_ANDROID_ADB_TOOL_NAME)).toBe(true)
    expect(names.has(OPENCAT_MIDSCENE_FINISH_TOOL_NAME)).toBe(true)
  })

  test('low-level tool schemas validate expected inputs', () => {
    const byName = new Map(AppTestLowLevelTools.map(tool => [tool.name, tool]))

    expect(() =>
      byName.get(OPENCAT_MIDSCENE_START_TOOL_NAME)?.inputSchema.parse({
        platform: 'android',
        mock_mode: true,
        test_goal: 'open app',
        execution_plan_path: 'execution_plan.json',
        route_memory_path: 'route_memory.json',
        reflection_report_path: 'reflection_report.json',
        execution_report_path: 'execution_report.json',
        batch_id: 'batch-1',
        case_id: 'case-1',
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_MIDSCENE_OBSERVE_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_MIDSCENE_ACTION_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
        action: 'tap',
        target: { text: 'Login' },
        assert_after: ['Home visible'],
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_MIDSCENE_AI_ACT_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
        instruction: 'tap Login',
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_MIDSCENE_ASSERT_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
        expected: 'Home visible',
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_ANDROID_ADB_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
        args: ['shell', 'wm', 'size'],
      }),
    ).not.toThrow()
    expect(() =>
      byName.get(OPENCAT_MIDSCENE_FINISH_TOOL_NAME)?.inputSchema.parse({
        session_id: 'session-1',
        success: true,
        summary: 'done',
      }),
    ).not.toThrow()
  })

  test('allows mock mode without prompting', async () => {
    const decision = await AppTestTool.checkPermissions(
      {
        platform: 'android',
        mock_mode: true,
        test_goal: 'mock android test',
      },
    )

    expect(decision.behavior).toBe('allow')
  })

  test('blocks high-risk input when risk_mode is block', async () => {
    const decision = await AppTestTool.checkPermissions(
      {
        platform: 'web',
        start_url: 'https://example.com',
        test_goal: 'click purchase and pay',
        risk_mode: 'block',
      },
    )

    expect(decision.behavior).toBe('deny')
  })

  test('low-level high-risk action requires approval', async () => {
    const decision = await OpencatMidsceneActionTool.checkPermissions({
      session_id: 'session-1',
      action: 'tap',
      intent: 'delete account and pay',
    })

    expect(decision.behavior).toBe('ask')
    if (decision.behavior !== 'ask') throw new Error('expected ask decision')
    expect(decision.message).toContain('high-risk')
  })

  test('low-level adb tool only allows safe commands', async () => {
    const allowed = await OpencatAndroidAdbTool.validateInput?.({
      session_id: 'session-1',
      args: ['shell', 'wm', 'size'],
    })
    const denied = await OpencatAndroidAdbTool.validateInput?.({
      session_id: 'session-1',
      args: ['shell', 'rm', '-rf', '/sdcard'],
    })

    expect(allowed).toEqual({ result: true })
    expect(denied).toEqual({
      result: false,
      message:
        'opencat_android_adb only allows safe adb commands. Rejected: shell rm -rf /sdcard',
      errorCode: 1,
    })
  })

  test('requires start_url or open_url for non-mock Web tests', async () => {
    const validation = await AppTestTool.validateInput?.(
      {
        platform: 'web',
        test_goal: 'open a page',
      },
    )

    expect(validation).toEqual({
      result: false,
      message:
        'AppTest requires start_url for non-mock Web tests unless action_steps include open_url.',
      errorCode: 1,
    })
  })

  test('prompt tells models to read existing report files before updating them', () => {
    const prompt = getAppTestPrompt()

    expect(prompt).toContain('reflection_report.json')
    expect(prompt).toContain('execution_report.json')
    expect(prompt).toContain('call Read on that exact file path first')
    expect(prompt).toContain('timestamped filename')
    expect(prompt).toContain('opencat_midscene_start')
    expect(prompt).toContain('structured tap/type/swipe/back/wait/open_url')
  })
})
