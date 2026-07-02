export type AppTestPlatform = 'android' | 'web'

export type AppTestExecutionMode =
  | 'midscene_ai'
  | 'codex_guided'
  | 'mcp_tool_loop'
  | 'yaml'

export type AppTestActionStep = {
  step_index?: number
  action?: string
  intent?: string
  instruction?: string
  target?: Record<string, unknown> | string
  value?: string
  assert_after?: Array<string | Record<string, unknown>>
  [key: string]: unknown
}

export type AppTestInput = {
  platform?: AppTestPlatform
  app_package?: string
  package_name?: string
  start_url?: string
  device_id?: string
  test_goal: string
  test_steps?: string[]
  assertions?: string[]
  action_steps?: AppTestActionStep[]
  execution_mode?: AppTestExecutionMode
  yaml_script?: string
  max_steps?: number
  risk_mode?: 'confirm' | 'block'
  force_stop_before_launch?: boolean
  headed?: boolean
  viewport_width?: number
  viewport_height?: number
  mock_mode?: boolean
  trace_dir?: string
}

export type AppTestEvent = {
  type?: string
  event_type?: string
  payload?: Record<string, unknown>
  message?: string
  [key: string]: unknown
}

export type AppTestResult = {
  success: boolean
  message: string
  platform: AppTestPlatform
  execution_mode?: string
  events: AppTestEvent[]
  screenshots: Array<Record<string, unknown>>
  assertions: Array<Record<string, unknown>>
  trace_path?: string
  trace_dir?: string
  report_path?: string
  post_run_guidance?: string
  raw_result?: Record<string, unknown>
}

export type AppTestRunnerRequest = {
  job_id?: string
  platform?: AppTestPlatform
  slots?: Record<string, unknown>
  trace_dir?: string
  yaml_script?: string
  mock_mode?: boolean
}
