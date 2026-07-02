import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../../tools.js'
import { AppTestTool } from './AppTestTool.js'
import { APP_TEST_TOOL_NAME } from './constants.js'
import { getAppTestPrompt } from './prompt.js'

describe('AppTestTool', () => {
  test('is registered as a single top-level tool', () => {
    expect(getAllBaseTools().some(tool => tool.name === APP_TEST_TOOL_NAME)).toBe(
      true,
    )
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
  })
})
