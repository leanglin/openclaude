import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAppTest } from './runner.js'
import {
  cleanupAppTestSessionsForTesting,
  finishAppTestSession,
  observeAppTestSession,
  runAppTestSessionAdb,
  runAppTestSessionAction,
  runAppTestSessionAssert,
  startAppTestSession,
} from './sessionClient.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import {
  collectPlatformUsageSummary,
  readPlatformUsageEvents,
} from '../platformUsage/index.js'

const originalOpenCatRunner = process.env.OPENCAT_APP_TEST_RUNNER
const originalOpenCatNode = process.env.OPENCAT_APP_TEST_NODE
const originalLegacyRunner = process.env.OPENCLAUDE_APP_TEST_RUNNER
const originalLegacyNode = process.env.OPENCLAUDE_APP_TEST_NODE
let tempDir = ''
let previousConfigHome: string | undefined

function writeMockRunner(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'opencat-app-test-'))
  const runnerPath = join(tempDir, 'runner.js')
  writeFileSync(
    runnerPath,
    `
const readline = require('node:readline');
if (process.argv.includes('session')) {
  let active = null;
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  function emit(payload) {
    process.stdout.write(JSON.stringify(payload) + '\\n');
  }
  rl.on('line', line => {
    const command = JSON.parse(line || '{}');
    const requestId = command.request_id;
    const action = command.action || command.command || command.tool;
    if (action === 'start') {
      active = {
        session_id: command.session_id,
        trace_dir: command.trace_dir,
        platform: command.platform,
        slots: command.slots || {},
      };
      emit({
        type: 'session_response',
        request_id: requestId,
        success: true,
        message: 'mock session started',
        session_id: active.session_id,
        trace_dir: active.trace_dir,
        platform: active.platform,
        mock_mode: true,
        received_slots: active.slots,
      });
      return;
    }
    if (!active) {
      emit({ type: 'session_response', request_id: requestId, success: false, message: 'not started' });
      return;
    }
    if (action === 'observe') {
      const observation = {
        step_index: 1,
        current_ref: 'mock://home',
        visible_text: 'mock Midscene screen ready',
        screenshot_artifact_path: 'screenshots/step_001.png',
      };
      emit({ type: 'event', event_type: 'visual_observed', payload: observation });
      emit({ type: 'session_response', request_id: requestId, success: true, message: 'observed', session_id: active.session_id, observation });
      return;
    }
    if (action === 'action') {
      const payload = { step_index: 2, action: command.step_action || command.type || 'tap', success: true, message: command.intent || 'mock action completed' };
      emit({ type: 'event', event_type: 'visual_action_planned', payload: { step_index: 2, action: payload.action } });
      emit({ type: 'event', event_type: 'visual_action_executed', payload });
      emit({ type: 'event', event_type: 'visual_observed', payload: { step_index: 3, current_ref: 'mock://detail', visible_text: 'mock detail screen', screenshot_artifact_path: 'screenshots/step_003.png' } });
      emit({ type: 'session_response', request_id: requestId, success: true, message: 'action completed', session_id: active.session_id, result: payload });
      return;
    }
    if (action === 'assert') {
      const payload = { step_index: 4, assertion: command.assertion || command.expected, success: command.mock_pass !== false, message: 'assertion passed' };
      emit({ type: 'event', event_type: 'visual_assertion_result', payload });
      emit({ type: 'session_response', request_id: requestId, success: payload.success, message: payload.message, session_id: active.session_id, result: payload });
      return;
    }
    if (action === 'android_adb') {
      emit({ type: 'session_response', request_id: requestId, success: true, message: 'ADB command completed', session_id: active.session_id, output: 'device' });
      return;
    }
    if (action === 'finish') {
      const success = command.success !== false;
      emit({ type: 'event', event_type: 'visual_trace_saved', payload: { visual_trace: 'trace.json', midscene_report: 'midscene_report.html', screenshots: [{ artifact_path: 'screenshots/step_003.png' }] } });
      emit({ type: 'session_response', request_id: requestId, success, status: success ? 'completed' : 'failed', message: command.summary || 'done', summary: command.summary || 'done', session_id: active.session_id, visual_trace: 'trace.json', midscene_report: 'midscene_report.html', screenshots: [{ artifact_path: 'screenshots/step_003.png' }] });
      process.exit(0);
      return;
    }
    emit({ type: 'session_response', request_id: requestId, success: false, message: 'unknown action ' + action });
  });
} else {
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
}
`,
    'utf8',
  )
  return runnerPath
}

beforeEach(() => {
  previousConfigHome = getClaudeConfigHomeDirOverrideForTesting()
  process.env.OPENCAT_APP_TEST_RUNNER = writeMockRunner()
  process.env.OPENCAT_APP_TEST_NODE = process.execPath
  delete process.env.OPENCLAUDE_APP_TEST_RUNNER
  delete process.env.OPENCLAUDE_APP_TEST_NODE
  const configDir = join(tempDir, 'config')
  mkdirSync(configDir, { recursive: true })
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
})

afterEach(() => {
  cleanupAppTestSessionsForTesting()
  if (originalOpenCatRunner === undefined) delete process.env.OPENCAT_APP_TEST_RUNNER
  else process.env.OPENCAT_APP_TEST_RUNNER = originalOpenCatRunner
  if (originalOpenCatNode === undefined) delete process.env.OPENCAT_APP_TEST_NODE
  else process.env.OPENCAT_APP_TEST_NODE = originalOpenCatNode
  if (originalLegacyRunner === undefined) delete process.env.OPENCLAUDE_APP_TEST_RUNNER
  else process.env.OPENCLAUDE_APP_TEST_RUNNER = originalLegacyRunner
  if (originalLegacyNode === undefined) delete process.env.OPENCLAUDE_APP_TEST_NODE
  else process.env.OPENCLAUDE_APP_TEST_NODE = originalLegacyNode
  setClaudeConfigHomeDirForTesting(previousConfigHome)
  getClaudeConfigHomeDir.cache?.clear?.()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
  previousConfigHome = undefined
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
    expect(readPlatformUsageEvents()).toEqual([
      expect.objectContaining({ eventType: 'case_generated', platform: 'android' }),
      expect.objectContaining({ eventType: 'case_adopted', platform: 'android' }),
      expect.objectContaining({ eventType: 'case_executed', platform: 'android', success: true }),
    ])
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

describe('AppTest low-level session client', () => {
  test('starts a mock runner session and reuses it for low-level calls', async () => {
    const started = await startAppTestSession({
      session_id: 'mock-session-client',
      platform: 'android',
      mock_mode: true,
      app_package: 'com.example.demo',
      test_goal: 'mock session flow',
      trace_dir: tempDir,
    })

    expect(started.success).toBe(true)
    expect(started.session_id).toBe('mock-session-client')
    expect(readPlatformUsageEvents()).toEqual([
      expect.objectContaining({
        eventType: 'case_generated',
        caseId: 'mock-session-client',
        platform: 'android',
        executionMode: 'low_level_session',
      }),
      expect.objectContaining({
        eventType: 'case_adopted',
        caseId: 'mock-session-client',
        platform: 'android',
        executionMode: 'low_level_session',
      }),
    ])

    const observed = await observeAppTestSession({
      session_id: 'mock-session-client',
    })
    expect(observed.success).toBe(true)
    expect(JSON.stringify(observed.response)).toContain('mock Midscene screen ready')

    const acted = await runAppTestSessionAction({
      session_id: 'mock-session-client',
      action: 'tap',
      intent: 'open detail',
    })
    expect(acted.success).toBe(true)

    const asserted = await runAppTestSessionAssert({
      session_id: 'mock-session-client',
      assertion: 'mock detail screen',
      mock_pass: true,
    })
    expect(asserted.success).toBe(true)

    const adb = await runAppTestSessionAdb({
      session_id: 'mock-session-client',
      args: ['devices'],
    })
    expect(adb.success).toBe(true)
    expect(readPlatformUsageEvents()).toHaveLength(2)

    const finished = await finishAppTestSession({
      session_id: 'mock-session-client',
      success: true,
      summary: 'done',
    })
    expect(finished.success).toBe(true)
    expect(finished.response.midscene_report).toBe('midscene_report.html')
    const usageEvents = readPlatformUsageEvents()
    expect(usageEvents).toHaveLength(3)
    expect(usageEvents.filter(event => event.eventType === 'case_executed')).toEqual([
      expect.objectContaining({
        caseId: 'mock-session-client',
        platform: 'android',
        executionMode: 'low_level_session',
        success: true,
        durationSeconds: expect.any(Number),
      }),
    ])
    const summary = await collectPlatformUsageSummary({
      statsLoader: async () => ({
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
      }),
    })
    expect(summary.payload.generated_case_count_total).toBe(1)
    expect(summary.payload.executed_case_count_total).toBe(1)

    await expect(
      observeAppTestSession({ session_id: 'mock-session-client' }),
    ).rejects.toThrow('has not been started')
  })

  test('rejects low-level calls without a started session', async () => {
    await expect(
      observeAppTestSession({ session_id: 'missing-session' }),
    ).rejects.toThrow('has not been started')
  })

  test('injects execution plan and route memory, then merges finish artifacts', async () => {
    const executionPlanPath = join(tempDir, 'execution_plan.json')
    const routeMemoryPath = join(tempDir, 'route_memory.json')
    const reflectionReportPath = join(tempDir, 'reflection_report.json')
    const executionReportPath = join(tempDir, 'execution_report.json')
    writeFileSync(
      executionPlanPath,
      JSON.stringify({
        batches: [
          {
            batch_id: 'batch-1',
            shared_navigation_steps: ['open home', 'open devices'],
            case_specific_steps: {
              'case-1': ['open camera', 'assert live view'],
            },
          },
        ],
      }),
      'utf8',
    )
    writeFileSync(
      routeMemoryPath,
      JSON.stringify({
        current_page: { current_ref: 'mock://home', summary: 'home' },
        successful_routes: [
          { route_id: 'route-1', to_ref: 'mock://devices', action_text: 'open devices' },
        ],
        failed_routes: [
          { route_id: 'bad-route', action_text: 'tap banner', reason: 'wrong page' },
        ],
      }),
      'utf8',
    )
    writeFileSync(reflectionReportPath, JSON.stringify({ reflections: [] }), 'utf8')
    writeFileSync(executionReportPath, JSON.stringify({ previous: true }), 'utf8')

    const started = await startAppTestSession({
      session_id: 'artifact-session',
      platform: 'android',
      mock_mode: true,
      app_package: 'com.example.demo',
      test_goal: 'execute structured case',
      trace_dir: tempDir,
      execution_plan_path: executionPlanPath,
      route_memory_path: routeMemoryPath,
      reflection_report_path: reflectionReportPath,
      execution_report_path: executionReportPath,
      batch_id: 'batch-1',
      case_id: 'case-1',
    })
    const receivedSlots = started.response.received_slots as Record<string, unknown>
    expect(receivedSlots.shared_navigation_steps).toEqual(['open home', 'open devices'])
    expect(receivedSlots.case_specific_steps).toEqual(['open camera', 'assert live view'])
    expect(receivedSlots.visual_execution_memory).toBeDefined()
    expect(receivedSlots.route_reuse).toBeDefined()
    expect(receivedSlots.current_page_reuse).toBeDefined()

    await observeAppTestSession({ session_id: 'artifact-session' })
    await runAppTestSessionAction({
      session_id: 'artifact-session',
      action: 'tap',
      intent: 'open camera',
    })
    await runAppTestSessionAssert({
      session_id: 'artifact-session',
      assertion: 'camera live view',
      mock_pass: false,
    })
    const finished = await finishAppTestSession({
      session_id: 'artifact-session',
      success: false,
      summary: 'camera live view missing',
    })

    expect(finished.success).toBe(false)
    expect(finished.route_memory_path).toBe(routeMemoryPath)
    expect(finished.reflection_report_path).toBe(reflectionReportPath)
    expect(finished.execution_report_path).toBe(executionReportPath)

    const routeMemory = JSON.parse(readFileSync(routeMemoryPath, 'utf8')) as Record<string, unknown>
    expect((routeMemory.failed_routes as unknown[]).length).toBeGreaterThan(1)
    expect((routeMemory.case_results as Record<string, unknown>)['case-1']).toMatchObject({
      status: 'failed',
    })
    expect((routeMemory.batch_results as Record<string, unknown>)['batch-1']).toMatchObject({
      failed_runs: 1,
    })

    const reflection = JSON.parse(readFileSync(reflectionReportPath, 'utf8')) as Record<string, unknown>
    expect((reflection.reflections as unknown[]).length).toBe(1)

    const execution = JSON.parse(readFileSync(executionReportPath, 'utf8')) as Record<string, unknown>
    expect(execution).toMatchObject({
      session_id: 'artifact-session',
      case_id: 'case-1',
      success: false,
    })
    expect(readPlatformUsageEvents()).toEqual([
      expect.objectContaining({
        eventType: 'case_generated',
        caseId: 'batch-1:case-1',
        executionMode: 'low_level_session',
      }),
      expect.objectContaining({
        eventType: 'case_adopted',
        caseId: 'batch-1:case-1',
        executionMode: 'low_level_session',
      }),
      expect.objectContaining({
        eventType: 'case_executed',
        caseId: 'batch-1:case-1',
        executionMode: 'low_level_session',
        success: false,
      }),
    ])
  })

  test('does not silently overwrite an invalid execution report', async () => {
    const executionReportPath = join(tempDir, 'bad_execution_report.json')
    writeFileSync(executionReportPath, '{bad json', 'utf8')

    await startAppTestSession({
      session_id: 'invalid-report-session',
      platform: 'android',
      mock_mode: true,
      app_package: 'com.example.demo',
      test_goal: 'finish with invalid prior report',
      trace_dir: tempDir,
      execution_report_path: executionReportPath,
    })
    const finished = await finishAppTestSession({
      session_id: 'invalid-report-session',
      success: true,
      summary: 'done',
    })

    expect(finished.execution_report_path).not.toBe(executionReportPath)
    expect(finished.execution_report_path).toContain('generated')
    expect(finished.artifact_warnings?.join('\n')).toContain('invalid JSON')
    expect(readFileSync(executionReportPath, 'utf8')).toBe('{bad json')
    expect(() => JSON.parse(readFileSync(String(finished.execution_report_path), 'utf8'))).not.toThrow()
  })
})
