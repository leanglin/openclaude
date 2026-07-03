import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAppTest } from './runner.js'

const originalOpenCatRunner = process.env.OPENCAT_APP_TEST_RUNNER
const originalOpenCatNode = process.env.OPENCAT_APP_TEST_NODE
const originalLegacyRunner = process.env.OPENCLAUDE_APP_TEST_RUNNER
const originalLegacyNode = process.env.OPENCLAUDE_APP_TEST_NODE
let tempDir = ''

function writeMockRunner(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'opencat-app-test-'))
  const runnerPath = join(tempDir, 'runner.js')
  writeFileSync(
    runnerPath,
    `
let raw = '';
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const request = JSON.parse(raw || '{}');
  process.stdout.write(JSON.stringify({
    type: 'event',
    event_type: 'visual_preflight_checked',
    payload: {
      platform: 'android',
      adb_available: true,
      adb_path: 'adb',
      connected_devices: ['device-1'],
      unauthorized_devices: [],
      offline_devices: [],
      target_device_connected: true,
      android_sdk_configured: false,
      missing_android_env_keys: ['ANDROID_HOME', 'ANDROID_SDK_ROOT'],
      midscene_model_configured: false,
      midscene_config_source: 'missing',
      configured_midscene_env_keys: [],
      missing_midscene_env_keys: ['MIDSCENE_MODEL_NAME'],
      midscene_api_key: 'super-secret-key'
    }
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'event',
    event_type: 'visual_observed',
    payload: {
      platform: request.platform,
      screenshot_artifact_path: 'screenshots/step_001.png',
      visible_text: 'mock Midscene screen'
    }
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'event',
    event_type: 'visual_assertion_result',
    payload: { step_index: 1, assertion: 'mock Midscene screen', success: true }
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'event',
    event_type: 'visual_trace_saved',
    payload: {
      visual_trace: 'trace.json',
      midscene_report: 'midscene_report.html',
      screenshots: [{ step_index: 1, artifact_path: 'screenshots/step_001.png' }]
    }
  }) + '\\n');
  process.stdout.write(JSON.stringify({
    type: 'result',
    success: true,
    message: 'mock completed',
    execution_mode: request.slots.execution_mode,
    midscene_report: 'midscene_report.html'
  }) + '\\n');
});
`,
    'utf8',
  )
  return runnerPath
}

beforeEach(() => {
  process.env.OPENCAT_APP_TEST_RUNNER = writeMockRunner()
  process.env.OPENCAT_APP_TEST_NODE = process.execPath
  delete process.env.OPENCLAUDE_APP_TEST_RUNNER
  delete process.env.OPENCLAUDE_APP_TEST_NODE
})

afterEach(() => {
  if (originalOpenCatRunner === undefined) delete process.env.OPENCAT_APP_TEST_RUNNER
  else process.env.OPENCAT_APP_TEST_RUNNER = originalOpenCatRunner
  if (originalOpenCatNode === undefined) delete process.env.OPENCAT_APP_TEST_NODE
  else process.env.OPENCAT_APP_TEST_NODE = originalOpenCatNode
  if (originalLegacyRunner === undefined) delete process.env.OPENCLAUDE_APP_TEST_RUNNER
  else process.env.OPENCLAUDE_APP_TEST_RUNNER = originalLegacyRunner
  if (originalLegacyNode === undefined) delete process.env.OPENCLAUDE_APP_TEST_NODE
  else process.env.OPENCLAUDE_APP_TEST_NODE = originalLegacyNode
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('runAppTest', () => {
  test('parses Android JSONL events and result', async () => {
    const result = await runAppTest({
      platform: 'android',
      mock_mode: true,
      app_package: 'com.example.demo',
      test_goal: 'mock android test',
      assertions: ['mock Midscene screen'],
      trace_dir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.platform).toBe('android')
    expect(result.screenshots.length).toBeGreaterThan(0)
    expect(result.assertions).toHaveLength(1)
    expect(result.trace_path).toBe(join(tempDir, 'trace.json'))
    expect(result.report_path).toBe(join(tempDir, 'midscene_report.html'))
    expect(result.post_run_guidance).toContain('call Read on that exact file path')
    expect(result.post_run_guidance).toContain('reflection_report.json')
  })

  test('parses Web JSONL events and result', async () => {
    const result = await runAppTest({
      platform: 'web',
      mock_mode: true,
      start_url: 'https://example.com',
      test_goal: 'mock web test',
      assertions: ['mock Midscene screen'],
      trace_dir: tempDir,
    })

    expect(result.success).toBe(true)
    expect(result.platform).toBe('web')
    expect(result.events.some(event => event.event_type === 'visual_trace_saved')).toBe(
      true,
    )
  })

  test('preserves preflight events without leaking API key values', async () => {
    const result = await runAppTest({
      platform: 'android',
      mock_mode: true,
      app_package: 'com.example.demo',
      test_goal: 'mock android test',
      trace_dir: tempDir,
    })
    const preflight = result.events.find(event =>
      event.event_type === 'visual_preflight_checked',
    )

    expect(preflight?.payload).toMatchObject({
      platform: 'android',
      adb_available: true,
      connected_devices: ['device-1'],
      midscene_config_source: 'missing',
      configured_midscene_env_keys: [],
      missing_midscene_env_keys: ['MIDSCENE_MODEL_NAME'],
      midscene_api_key: '[redacted]',
    })
    expect(JSON.stringify(result)).not.toContain('super-secret-key')
  })
})
