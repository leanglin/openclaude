import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  androidInputText,
  androidVisibleTextFromTree,
  buildAndroidMidscenePreflight,
  buildMidsceneAgentOptions,
  chooseAndroidUiTree,
  canUseVisualSelfHealingRepair,
  coerceCodexActionSteps,
  coerceFinalAssertions,
  coerceMidsceneFinalAssertions,
  coerceMidsceneStructuredActionSteps,
  coerceTestSteps,
  applyVisualPathMemoryToAction,
  createVisualPathMemoryState,
  createVisualSelfHealingState,
  evaluateCodexAssertion,
  executeAndroidCodexAction,
  executeCodexStep,
  findAndroidPopupGuardAction,
  formatActionGoal,
  formatAndroidPreflightFailure,
  formatCodexFallbackInstruction,
  formatMidsceneAssertionText,
  formatMidsceneStepInstruction,
  inferCodexTargetTextsFromInstruction,
  isEmptyAndroidUiTree,
  isWeakAlreadyVisibleStepAssertion,
  launchAndroidAppWithOptionalReset,
  parseAdbDevices,
  parseAndroidScreenSize,
  parseMidsceneScreenshot,
  prepareMidsceneAiDispatch,
  resolveCodexFallbackTimeoutMs,
  renderReport,
  resolveObservationHeartbeatMs,
  resolveReplanningCycleLimit,
  runCodexPopupGuard,
  runMidsceneAiStructuredFlow,
  shouldForceStopBeforeLaunch,
  noteVisualSelfHealingRepair,
  rememberVisualPathReflection,
  visualFailureSignature,
  visualPathMemorySnapshot,
  writeReport,
  writeAndroidScreenshot,
  type RuntimeHandle,
} from './cli';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(TEST_DIR, '..');
const SOURCE_PATH = join(TEST_DIR, 'cli.ts');
const DIST_CLI_PATH = join(PACKAGE_ROOT, 'dist', 'cli.js');

function tempTraceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'midscene-runner-test-'));
  mkdirSync(join(dir, 'screenshots'), { recursive: true });
  return dir;
}

function completeMidsceneEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MIDSCENE_MODEL_NAME: 'doubao-vision-pro',
    MIDSCENE_MODEL_BASE_URL: 'https://vision.example.test/v1',
    MIDSCENE_MODEL_API_KEY: 'test-key',
    MIDSCENE_MODEL_FAMILY: 'doubao-vision',
    ...extra,
  };
}

function writeSessionCommand(proc: ChildProcessWithoutNullStreams, payload: Record<string, unknown>): void {
  proc.stdin.write(`${JSON.stringify(payload)}\n`);
}

async function readSessionResponse(iterator: AsyncIterator<string>, requestId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const next = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<string>>((resolve) => setTimeout(() => resolve({ done: false, value: '' }), remaining)),
    ]);
    if (next.done) break;
    if (!next.value) continue;
    const payload = JSON.parse(String(next.value));
    if (payload.type === 'session_response' && payload.request_id === requestId) return payload;
  }
  throw new Error(`timed out waiting for session response ${requestId}`);
}

test('parses Midscene PNG data URL screenshots', () => {
  const parsed = parseMidsceneScreenshot(`data:image/png;base64,${PNG_BASE64}`);

  assert.equal(parsed.mime, 'image/png');
  assert.equal(parsed.extension, 'png');
  assert.deepEqual([...parsed.buffer.subarray(0, 8)], PNG_HEADER);
});

test('parses connected and unauthorized ADB devices', () => {
  assert.deepEqual(
    parseAdbDevices('List of devices attached\nAREMUT5226001251\tdevice\nemulator-5554 unauthorized\nlegacy offline\n'),
    {
      connected_devices: ['AREMUT5226001251'],
      unauthorized_devices: ['emulator-5554'],
      offline_devices: ['legacy'],
    },
  );
});

test('preflight keeps connected ADB evidence when Android SDK env is missing', () => {
  const preflight = buildAndroidMidscenePreflight({
    env: completeMidsceneEnv(),
    execFile(_file, args) {
      if (args?.[0] === 'version') return 'Android Debug Bridge version 1.0.41';
      if (args?.[0] === 'devices') return 'List of devices attached\nAREMUT5226001251\tdevice\n';
      return '';
    },
  });

  assert.equal(preflight.adb_available, true);
  assert.deepEqual(preflight.connected_devices, ['AREMUT5226001251']);
  assert.equal(preflight.target_device_connected, true);
  assert.equal(preflight.android_sdk_configured, false);
  assert.deepEqual(preflight.missing_android_env_keys, ['ANDROID_HOME', 'ANDROID_SDK_ROOT']);
  assert.equal(formatAndroidPreflightFailure(preflight), null);
});

test('preflight reports missing Midscene model config without claiming device loss', () => {
  const preflight = buildAndroidMidscenePreflight({
    env: completeMidsceneEnv({ MIDSCENE_MODEL_NAME: undefined }),
    execFile(_file, args) {
      if (args?.[0] === 'version') return 'Android Debug Bridge version 1.0.41';
      if (args?.[0] === 'devices') return 'List of devices attached\nAREMUT5226001251\tdevice\n';
      return '';
    },
  });
  const failure = formatAndroidPreflightFailure(preflight);

  assert.match(String(failure), /Midscene model configuration is incomplete/);
  assert.match(String(failure), /MIDSCENE_MODEL_NAME/);
  assert.doesNotMatch(String(failure), /No connected Android device/i);
});

test('preflight reports ADB availability failures distinctly', () => {
  const preflight = buildAndroidMidscenePreflight({
    env: completeMidsceneEnv(),
    execFile() {
      throw new Error('spawn adb ENOENT');
    },
  });
  const failure = formatAndroidPreflightFailure(preflight);

  assert.equal(preflight.adb_available, false);
  assert.match(String(failure), /ADB is not available/);
  assert.match(String(failure), /spawn adb ENOENT/);
});

test('parses Midscene JPEG data URL screenshots', () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(40, 0),
    Buffer.from([0xff, 0xd9]),
  ]);
  const parsed = parseMidsceneScreenshot(`data:image/jpeg;base64,${jpeg.toString('base64')}`);

  assert.equal(parsed.mime, 'image/jpeg');
  assert.equal(parsed.extension, 'jpg');
  assert.equal(parsed.buffer[0], 0xff);
  assert.equal(parsed.buffer[1], 0xd8);
});

test('keeps compatibility with pure base64 PNG screenshots', () => {
  const parsed = parseMidsceneScreenshot(PNG_BASE64);

  assert.equal(parsed.mime, 'image/png');
  assert.equal(parsed.extension, 'png');
});

test('invalid screenshots write a placeholder instead of a corrupt PNG', () => {
  const dir = tempTraceDir();
  try {
    const result = writeAndroidScreenshot(dir, 1, 'not-base64', '');
    const file = readFileSync(result.path);

    assert.equal(result.source, 'placeholder');
    assert.equal(result.mime, 'image/png');
    assert.match(result.error || '', /Midscene screenshot parse failed/);
    assert.deepEqual([...file.subarray(0, 8)], PNG_HEADER);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renders Midscene reports with inline screenshots by default', () => {
  const receivedOptions: unknown[] = [];
  const html = renderReport({
    reportHTMLString(options: unknown) {
      receivedOptions.push(options);
      return '<html>ok</html>';
    },
  });

  assert.equal(html, '<html>ok</html>');
  assert.deepEqual(receivedOptions, [{ inlineScreenshots: true }]);
});

test('renders generated Midscene report file when inline report generation fails', () => {
  const dir = tempTraceDir();
  try {
    const reportPath = join(dir, 'sdk-report.html');
    writeFileSync(reportPath, '<html>from file</html>', 'utf8');
    const calls: unknown[] = [];

    const html = renderReport({
      reportFile: reportPath,
      reportHTMLString(options: unknown) {
        calls.push(options);
        throw new Error('inline failed');
      },
    });

    assert.equal(html, '<html>from file</html>');
    assert.deepEqual(calls, [{ inlineScreenshots: true }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to non-inline Midscene report when inline generation fails without a report file', () => {
  const calls: unknown[] = [];
  const html = renderReport({
    reportHTMLString(options: unknown) {
      calls.push(options);
      if ((options as { inlineScreenshots?: boolean }).inlineScreenshots) {
        throw new Error('inline failed');
      }
      return '<html>legacy</html>';
    },
  });

  assert.equal(html, '<html>legacy</html>');
  assert.deepEqual(calls, [{ inlineScreenshots: true }, { inlineScreenshots: false }]);
});

test('writes lightweight report when Midscene HTML exceeds size limit', () => {
  const dir = tempTraceDir();
  const previous = process.env.MIDSCENE_REPORT_MAX_BYTES;
  try {
    process.env.MIDSCENE_REPORT_MAX_BYTES = String(1024 * 1024);
    const report = writeReport(
      dir,
      `<!doctype html><html><body>${'x'.repeat(2 * 1024 * 1024)}</body></html>`,
      { screenshot_count: 320 },
    );
    const saved = readFileSync(report.path, 'utf8');

    assert.equal(report.truncated, true);
    assert.equal(report.screenshotCount, 320);
    assert.ok(report.originalSizeBytes > report.writtenSizeBytes);
    assert.match(saved, /report_exceeded_size_limit/);
    assert.match(saved, /screenshot_count/);
  } finally {
    if (previous === undefined) {
      delete process.env.MIDSCENE_REPORT_MAX_BYTES;
    } else {
      process.env.MIDSCENE_REPORT_MAX_BYTES = previous;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses hidden child process options for ADB and playground subprocesses', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const hiddenUses = source.match(/\.\.\.hiddenChildProcessOptions\(\)/g) || [];

  assert.match(source, /function hiddenChildProcessOptions\(\): \{ windowsHide\?: boolean \} \{[\s\S]*windowsHide: true/);
  assert.ok(hiddenUses.length >= 4);
  assert.match(source, /execFileSync\(adbPath[\s\S]*\.\.\.hiddenChildProcessOptions\(\)/);
  assert.match(source, /spawn\(process\.execPath,[\s\S]*\.\.\.hiddenChildProcessOptions\(\)/);
});

test('session command runs low-level mock flow over JSONL', async () => {
  const traceDir = tempTraceDir();
  const child = spawn(process.execPath, [DIST_CLI_PATH, 'session'], {
    env: {
      ...process.env,
      MIDSCENE_RUNNER_MOCK: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rl: Interface = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  try {
    writeSessionCommand(child, {
      request_id: 'start-1',
      action: 'start',
      session_id: 'mock-session',
      trace_dir: traceDir,
      platform: 'android',
      app_package: 'com.example.app',
      slots: { mock_observations: [{ visible_text: 'mock Midscene screen ready' }] },
    });
    const started = await readSessionResponse(iterator, 'start-1');
    assert.equal(started.success, true);
    assert.equal(started.session_id, 'mock-session');

    writeSessionCommand(child, { request_id: 'observe-1', action: 'observe', session_id: 'mock-session' });
    const observed = await readSessionResponse(iterator, 'observe-1');
    assert.equal(observed.success, true);
    assert.match(JSON.stringify(observed.observation), /mock Midscene screen ready/);

    writeSessionCommand(child, { request_id: 'act-1', action: 'ai_act', session_id: 'mock-session', instruction: 'tap a mock button' });
    const acted = await readSessionResponse(iterator, 'act-1');
    assert.equal(acted.success, true);

    writeSessionCommand(child, { request_id: 'assert-1', action: 'assert', session_id: 'mock-session', assertion: 'mock Midscene screen' });
    const asserted = await readSessionResponse(iterator, 'assert-1');
    assert.equal(asserted.success, true);

    writeSessionCommand(child, { request_id: 'finish-1', action: 'finish', session_id: 'mock-session', success: true, summary: 'done' });
    const finished = await readSessionResponse(iterator, 'finish-1');
    assert.equal(finished.success, true);
    assert.equal(finished.status, 'completed');
    assert.match(String(finished.midscene_report || ''), /midscene_report\.html/);
  } finally {
    rl.close();
    child.kill();
    rmSync(traceDir, { recursive: true, force: true });
  }
});

test('resolves replanning cycle limit from slots', () => {
    assert.equal(resolveReplanningCycleLimit({ max_steps: 10000 }), 10000);
    assert.equal(resolveReplanningCycleLimit({ replanning_cycle_limit: 20000 }), 10000);
    assert.equal(resolveReplanningCycleLimit({ replanning_cycle_limit: 0 }), 1);
    assert.equal(resolveReplanningCycleLimit({ replanning_cycle_limit: 'bad', max_steps: 10000 }), 9999);
    assert.equal(resolveReplanningCycleLimit({}), 9999);
    assert.equal(resolveReplanningCycleLimit({ execution_mode: 'codex_guided', max_steps: 10000 }), 2);
    assert.equal(resolveReplanningCycleLimit({ execution_mode: 'codex_guided', replanning_cycle_limit: 7, max_steps: 10000 }), 7);
  });

test('resolves Android force-stop launch flag from canonical and alias slots', () => {
  assert.equal(shouldForceStopBeforeLaunch({}), false);
  assert.equal(shouldForceStopBeforeLaunch({ force_stop_before_launch: true }), true);
  assert.equal(shouldForceStopBeforeLaunch({ force_stop_before_launch: 'false' }), false);
  assert.equal(shouldForceStopBeforeLaunch({ android_force_stop_before_launch: 'on' }), true);
});

test('force-stops Android package before launch when enabled', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const agent = {
    async launch(packageName: string) {
      calls.push(`launch:${packageName}`);
    },
  };

  await launchAndroidAppWithOptionalReset(
    agent,
    'device-1',
    'com.example.app',
    { force_stop_before_launch: true },
    {
      adbText(deviceId, args, timeout) {
        calls.push(`adb:${deviceId}:${args.join(' ')}:${timeout}`);
        return '';
      },
      emitEvent(eventType, payload) {
        events.push({ eventType, payload });
      },
    },
  );

  assert.deepEqual(calls, [
    'adb:device-1:shell am force-stop com.example.app:20000',
    'launch:com.example.app',
  ]);
  assert.deepEqual(events, [
    {
      eventType: 'android_app_force_stopped',
      payload: {
        app_package: 'com.example.app',
        device_id: 'device-1',
        force_stop_before_launch: true,
      },
    },
  ]);
});

test('launches Android package without force-stop when disabled', async () => {
  const calls: string[] = [];
  const agent = {
    async launch(packageName: string) {
      calls.push(`launch:${packageName}`);
    },
  };

  await launchAndroidAppWithOptionalReset(
    agent,
    'device-1',
    'com.example.app',
    { force_stop_before_launch: false },
    {
      adbText(deviceId, args, timeout) {
        calls.push(`adb:${deviceId}:${args.join(' ')}:${timeout}`);
        return '';
      },
    },
  );

  assert.deepEqual(calls, ['launch:com.example.app']);
});

test('parses Android wm size output for observation screen size', () => {
  assert.deepEqual(parseAndroidScreenSize('Physical size: 720x1520\n'), { width: 720, height: 1520 });
  assert.deepEqual(
    parseAndroidScreenSize('Physical size: 1080x2400\nOverride size: 720x1600\n'),
    { width: 720, height: 1600 },
  );
});

test('uses uiautomator XML when Midscene Android node tree is empty', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><hierarchy><node text="Share" content-desc="" bounds="[0,0][10,10]" /></hierarchy>';

  assert.equal(isEmptyAndroidUiTree('{"node":null,"children":[]}'), true);
  assert.equal(chooseAndroidUiTree('{"node":null,"children":[]}', xml), xml);
});

test('extracts Android visible text from XML text and content-desc', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hierarchy>',
    '<node text="Share permissions" content-desc="" bounds="[0,0][10,10]" />',
    '<node text="" content-desc="Back" bounds="[10,10][20,20]" />',
    '<node text="Share permissions" content-desc="" bounds="[20,20][30,30]" />',
    '</hierarchy>',
  ].join('');

  assert.equal(androidVisibleTextFromTree(xml), 'Share permissions\nBack');
});

test('Android type prefers Midscene Input and verifies text before legacy adb input', async () => {
  const value = "书房 HDC-52's & ready";
  const before = '<hierarchy><node text="" resource-id="com.example:id/name" class="android.widget.EditText" enabled="true" focused="false" password="false" bounds="[10,20][210,80]" /></hierarchy>';
  const after = `<hierarchy><node text="${value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" resource-id="com.example:id/name" class="android.widget.EditText" enabled="true" focused="true" password="false" bounds="[10,20][210,80]" /></hierarchy>`;
  const calls: string[] = [];
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const agent = {
    async callActionInActionSpace(type: string, payload: Record<string, unknown>) {
      calls.push(`midscene:${type}:${payload.value}`);
    },
  };

  const result = await executeAndroidCodexAction(
    'device-1',
    { ui_tree: before, screen_size: { width: 300, height: 600 } },
    { step_index: 2, action: 'type', target: { resource_id: 'com.example:id/name' }, value },
    agent,
    {
      adbText(_deviceId, args) {
        calls.push(`adb:${args.join(' ')}`);
        return args[0] === 'exec-out' ? after : '';
      },
      emitEvent(eventType, payload) {
        events.push({ eventType, payload });
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.input_method, 'midscene_input');
  assert.ok(calls.includes(`midscene:Input:${value}`));
  assert.equal(calls.some((item) => item.includes('shell input text')), false);
  assert.deepEqual(events.map((item) => item.eventType), [
    'visual_android_input_attempt',
    'visual_android_input_verified',
  ]);
});

test('Android type falls back through ATX clipboard before legacy adb input', async () => {
  const before = '<hierarchy><node text="" resource-id="com.example:id/search" class="android.widget.EditText" enabled="true" focused="false" password="false" bounds="[10,20][210,80]" /></hierarchy>';
  const after = '<hierarchy><node text="hello" resource-id="com.example:id/search" class="android.widget.EditText" enabled="true" focused="true" password="false" bounds="[10,20][210,80]" /></hierarchy>';
  const calls: string[] = [];
  const events: string[] = [];
  const fetchBodies: unknown[] = [];
  const agent = {
    async callActionInActionSpace() {
      throw new Error('midscene input unavailable');
    },
  };

  const result = await executeAndroidCodexAction(
    'device-1',
    { ui_tree: before, screen_size: { width: 300, height: 600 } },
    { step_index: 1, action: 'input', target: { resource_id: 'com.example:id/search' }, value: 'hello' },
    agent,
    {
      adbText(_deviceId, args) {
        calls.push(`adb:${args.join(' ')}`);
        return args[0] === 'exec-out' ? after : '';
      },
      async fetch(_url, init) {
        fetchBodies.push(JSON.parse(String(init?.body || '{}')));
        return {
          ok: true,
          status: 200,
          async json() {
            return { jsonrpc: '2.0', id: 1, result: true };
          },
        };
      },
      emitEvent(eventType) {
        events.push(eventType);
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.input_method, 'atx_jsonrpc_clipboard_paste');
  assert.ok(calls.some((item) => item.includes('forward tcp:7912 tcp:7912')));
  assert.ok(calls.some((item) => item.includes('shell input keyevent 279')));
  assert.equal(calls.some((item) => item.includes('shell input text')), false);
  assert.equal((fetchBodies[0] as Record<string, unknown>).method, 'setClipboard');
  assert.deepEqual(events, [
    'visual_android_input_attempt',
    'visual_android_input_fallback',
    'visual_android_input_verified',
  ]);
});

test('Android type uses legacy adb only after Midscene and ATX fail', async () => {
  const before = '<hierarchy><node text="" resource-id="com.example:id/search" class="android.widget.EditText" enabled="true" focused="false" password="false" bounds="[10,20][210,80]" /></hierarchy>';
  const after = '<hierarchy><node text="hello" resource-id="com.example:id/search" class="android.widget.EditText" enabled="true" focused="true" password="false" bounds="[10,20][210,80]" /></hierarchy>';
  const calls: string[] = [];
  const events: string[] = [];
  const agent = {
    async callActionInActionSpace() {
      throw new Error('midscene input unavailable');
    },
  };

  const result = await executeAndroidCodexAction(
    'device-1',
    { ui_tree: before, screen_size: { width: 300, height: 600 } },
    { step_index: 1, action: 'fill', target: { resource_id: 'com.example:id/search' }, value: 'hello' },
    agent,
    {
      adbText(_deviceId, args) {
        calls.push(`adb:${args.join(' ')}`);
        return args[0] === 'exec-out' ? after : '';
      },
      async fetch() {
        return {
          ok: true,
          status: 200,
          async json() {
            return { jsonrpc: '2.0', id: 1, error: { message: 'missing method' } };
          },
        };
      },
      emitEvent(eventType) {
        events.push(eventType);
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.input_method, 'legacy_adb_input');
  assert.ok(calls.some((item) => item.includes('shell input text hello')));
  assert.ok(events.includes('visual_android_input_fallback'));
  assert.ok(events.includes('visual_android_input_verified'));
});

test('legacy Android input escaping preserves non-ascii and special characters', () => {
  const escaped = androidInputText("书房 HDC-52's & $ready");
  assert.match(escaped, /书房/);
  assert.match(escaped, /HDC-52/);
  assert.match(escaped, /%s/);
  assert.match(escaped, /\\'/);
  assert.match(escaped, /\\&/);
  assert.match(escaped, /\\\$/);
});

test('keeps Android observation fallbacks when ADB values are unavailable', () => {
  assert.deepEqual(parseAndroidScreenSize(''), { width: 1, height: 1 });
  assert.equal(chooseAndroidUiTree('{"node":null,"children":[]}', ''), '');
  assert.equal(androidVisibleTextFromTree(''), '');
});

test('resolves Codex fallback timeout from slots and env', () => {
  const previous = process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS;
  try {
    delete process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS;
    assert.equal(resolveCodexFallbackTimeoutMs({}), 45000);
    assert.equal(resolveCodexFallbackTimeoutMs({ codex_midscene_fallback_timeout_ms: 2500 }), 2500);
    assert.equal(resolveCodexFallbackTimeoutMs({ midscene_fallback_timeout_ms: 10 }), 1000);
    process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS = '3000';
    assert.equal(resolveCodexFallbackTimeoutMs({}), 3000);
  } finally {
    if (previous === undefined) {
      delete process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS;
    } else {
      process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS = previous;
    }
  }
});

test('times out Codex Guided Midscene fallback actions', async () => {
  const previous = process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS;
  try {
    process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS = '5';
    const result = await executeCodexStep(
      {
        agent: { aiAct: () => new Promise(() => undefined) },
        free: async () => undefined,
        observe: async () => ({}),
      },
      { job_id: 'job-timeout', slots: { execution_mode: 'codex_guided' } },
      { action: 'aiAct', intent: '再次点击全屏切换按钮', allow_midscene_fallback: true },
      {},
    );

    assert.equal(result.success, false);
    assert.equal(result.midscene_fallback_used, true);
    assert.equal(result.codex_midscene_fallback_timeout, true);
    assert.match(String(result.message), /timed out/);
  } finally {
    if (previous === undefined) {
      delete process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS;
    } else {
      process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS = previous;
    }
  }
});

test('resolves observation heartbeat interval from slots and env', () => {
  const previous = process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS;
  try {
    delete process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS;
    assert.equal(resolveObservationHeartbeatMs({}), 5000);
    assert.equal(resolveObservationHeartbeatMs({ observation_heartbeat_ms: 1250 }), 1250);
    assert.equal(resolveObservationHeartbeatMs({ visual_observation_heartbeat_ms: '0' }), 0);
    assert.equal(resolveObservationHeartbeatMs({ observation_heartbeat_ms: 999999 }), 60000);

    process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS = '3000';
    assert.equal(resolveObservationHeartbeatMs({}), 3000);
  } finally {
    if (previous === undefined) {
      delete process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS;
    } else {
      process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS = previous;
    }
  }
});

test('builds Midscene agent options with replanning cycle limit env fallback', () => {
  const previous = process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT;
  const previousIme = process.env.MIDSCENE_ANDROID_IME_STRATEGY;
  try {
    delete process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT;
    delete process.env.MIDSCENE_ANDROID_IME_STRATEGY;

    const options = buildMidsceneAgentOptions({
      job_id: 'job-123',
      slots: { max_steps: 10000 },
    });

    assert.equal(options.generateReport, true);
    assert.equal(options.reportFileName, 'midscene-job-123');
    assert.equal(options.replanningCycleLimit, 10000);
    assert.equal(options.imeStrategy, 'always-yadb');
    assert.equal(process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT, '10000');
    assert.equal(process.env.MIDSCENE_ANDROID_IME_STRATEGY, 'always-yadb');
  } finally {
    if (previous === undefined) {
      delete process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT;
    } else {
      process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT = previous;
    }
    if (previousIme === undefined) {
      delete process.env.MIDSCENE_ANDROID_IME_STRATEGY;
    } else {
      process.env.MIDSCENE_ANDROID_IME_STRATEGY = previousIme;
    }
  }
});

test('formats action goal with test steps and expected result', () => {
  const steps = coerceTestSteps([
    'open live page',
    { action: 'tap record' },
    'check timer',
    'check timer',
  ]);

  assert.deepEqual(steps, ['open live page', 'tap record', 'check timer']);
  assert.equal(
    formatActionGoal('verify recording', steps, 'recording timer is visible'),
    'verify recording\n\nTest steps:\n1. open live page\n2. tap record\n3. check timer\n\nExpected result: recording timer is visible',
  );
});

test('formats navigation and skill context outside executable test steps', () => {
  const dispatch = prepareMidsceneAiDispatch({
    test_goal: 'verify permission page',
    test_steps: ['tap permission'],
    workspace_skill_guidance_context: 'Use loaded Skill path map.',
    visual_navigation_context: 'Known route ended at SharePermissionsActivity.',
    route_reuse: { enabled: true, route_id: 'route-1' },
  });
  const actionGoal = formatActionGoal(
    dispatch.goal,
    dispatch.testSteps,
    '',
    formatCodexFallbackInstruction(
      { action: 'tap', intent: 'tap permission' },
      {
        job_id: 'job-context',
        slots: {
          test_goal: 'verify permission page',
          test_steps: ['tap permission'],
          workspace_skill_guidance_context: 'Use loaded Skill path map.',
          visual_navigation_context: 'Known route ended at SharePermissionsActivity.',
          route_reuse: { enabled: true, route_id: 'route-1' },
        },
      },
    ),
  );

  assert.deepEqual(dispatch.testSteps, ['tap permission']);
  assert.match(actionGoal, /not an executable UI step/);
  assert.match(actionGoal, /Known route ended at SharePermissionsActivity/);
});

test('visual self-healing ignores continue reflections with passive observation suggestions', () => {
  const state = createVisualSelfHealingState({});
  const decision = canUseVisualSelfHealingRepair(
    state,
    1,
    {
      verdict: 'continue',
      risk_level: 'low',
      correction_actions: [{ type: 'reobserve', risk_level: 'low' }],
    },
    {
      phase: 'post_action',
      action: { action: 'tap', intent: 'open settings' },
      result: { success: true, message: 'ok' },
      observation: { current_ref: 'com.example/.MainActivity' },
    },
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'reflection_continue_does_not_request_repair');
  assert.equal(state.caseRepairCount, 0);
});

test('visual self-healing enforces per-step case and repeated-failure budgets', () => {
  const state = createVisualSelfHealingState({
    max_visual_repairs_per_step: 2,
    max_visual_repairs_per_case: 10,
    visual_repeated_failure_limit: 10,
  });
  const reflection = {
    verdict: 'retry',
    risk_level: 'medium',
    correction_actions: [{ type: 'reobserve', risk_level: 'low' }],
  };
  const failure = {
    phase: 'post_action',
    action: { action: 'tap', intent: 'open settings' },
    result: { success: false, message: 'button not found' },
    observation: { current_ref: 'com.example/.MainActivity' },
  };

  const first = canUseVisualSelfHealingRepair(state, 1, reflection, failure);
  assert.equal(first.allowed, true);
  noteVisualSelfHealingRepair(state, 1, first);
  const second = canUseVisualSelfHealingRepair(state, 1, reflection, failure);
  assert.equal(second.allowed, true);
  noteVisualSelfHealingRepair(state, 1, second);
  const repeated = canUseVisualSelfHealingRepair(state, 1, reflection, failure);

  assert.equal(repeated.allowed, false);
  assert.equal(repeated.reason, 'step_repair_budget_exhausted');
  assert.equal(state.caseRepairCount, 2);
  assert.equal(state.failureEvents.length, 2);

  const caseBudgetState = createVisualSelfHealingState({
    max_visual_repairs_per_step: 10,
    max_visual_repairs_per_case: 1,
    visual_repeated_failure_limit: 10,
  });
  const caseFirst = canUseVisualSelfHealingRepair(caseBudgetState, 1, reflection, failure);
  assert.equal(caseFirst.allowed, true);
  noteVisualSelfHealingRepair(caseBudgetState, 1, caseFirst);
  const caseSecond = canUseVisualSelfHealingRepair(caseBudgetState, 2, reflection, {
    ...failure,
    result: { success: false, message: 'second button not found' },
  });
  assert.equal(caseSecond.allowed, false);
  assert.equal(caseSecond.reason, 'case_repair_budget_exhausted');

  const repeatedState = createVisualSelfHealingState({
    max_visual_repairs_per_step: 10,
    max_visual_repairs_per_case: 10,
    visual_repeated_failure_limit: 2,
  });
  const repeatedFirst = canUseVisualSelfHealingRepair(repeatedState, 1, reflection, failure);
  assert.equal(repeatedFirst.allowed, true);
  noteVisualSelfHealingRepair(repeatedState, 1, repeatedFirst);
  const repeatedSecond = canUseVisualSelfHealingRepair(repeatedState, 2, reflection, failure);
  assert.equal(repeatedSecond.allowed, true);
  noteVisualSelfHealingRepair(repeatedState, 2, repeatedSecond);
  const repeatedThird = canUseVisualSelfHealingRepair(repeatedState, 3, reflection, failure);
  assert.equal(repeatedThird.allowed, false);
  assert.equal(repeatedThird.reason, 'repeated_failure_limit_reached');
});

test('visual self-healing signatures are stable for matching failures', () => {
  const first = visualFailureSignature({
    phase: 'assertion',
    action: { action: 'assert', assertion: 'Home visible' },
    result: { success: false, message: 'Home not visible' },
    observation: { current_ref: 'com.example/.MainActivity' },
  });
  const second = visualFailureSignature({
    phase: 'assertion',
    action: { action: 'assert', assertion: 'Home visible' },
    result: { success: false, message: 'Home not visible' },
    observation: { current_ref: 'com.example/.MainActivity' },
  });

  assert.equal(first, second);
  assert.match(first, /home not visible/);
});

test('visual path memory is injected and updated from step reflection', () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const state = createVisualPathMemoryState({
    visual_execution_memory: {
      known_routes: [{ to_ref: 'DetailActivity', action_text: 'open detail' }],
      avoid_actions: [{ action_text: 'tap banner', reason: 'opened wrong page' }],
    },
  });

  const action = applyVisualPathMemoryToAction(
    { action: 'tap', reason: 'open playback' },
    state,
    2,
    (eventType, payload) => events.push({ eventType, payload: payload as Record<string, unknown> }),
  );

  assert.match(String(action.reason), /Runtime path memory/);
  assert.equal(events[0].eventType, 'visual_path_memory_applied');

  rememberVisualPathReflection(
    state,
    2,
    {
      verdict: 'retry',
      risk_level: 'medium',
      user_visible_summary: 'wrong entrance',
      path_memory_delta: {
        step_index: 2,
        outcome: 'failure',
        avoid: true,
        action_text: 'tap banner',
        reason: 'wrong entrance',
      },
      temporary_memory: [{ step_index: 2, outcome: 'failure', last_action: 'tap banner' }],
    },
    (eventType, payload) => events.push({ eventType, payload: payload as Record<string, unknown> }),
  );

  assert.equal(state.avoidActions[state.avoidActions.length - 1]?.action_text, 'tap banner');
  assert.equal((visualPathMemorySnapshot(state).temporary_memory as unknown[]).length, 1);
  assert.ok(events.some((event) => event.eventType === 'visual_path_memory_delta'));
  assert.ok(events.some((event) => event.eventType === 'visual_temp_memory_snapshot'));
  assert.ok(events.some((event) => event.eventType === 'visual_step_replan'));
});

test('coerces codex guided action steps with locators', () => {
  const steps = coerceCodexActionSteps({
    action_steps: [
      {
        action: 'click',
        intent: 'open login',
        preferred_locator: { selector: '#login' },
        assert_after: [{ kind: 'text_visible', expected: 'Welcome' }],
      },
    ],
  });

  assert.equal(steps.length, 1);
  assert.equal(steps[0].action, 'tap');
  assert.equal((steps[0].target as Record<string, unknown>).selector, '#login');
  assert.equal((steps[0].assert_after as unknown[]).length, 1);
  assert.equal(steps[0].allow_midscene_fallback, true);
});

test('infers Codex Guided Android tap targets from Chinese step text', () => {
  assert.deepEqual(inferCodexTargetTextsFromInstruction('\u70b9\u51fb\u667a\u80fd\u6444\u50cf\u593420'), ['\u667a\u80fd\u6444\u50cf\u593420']);
  assert.deepEqual(
    inferCodexTargetTextsFromInstruction('\u6253\u5f00\u667a\u80fd\u6444\u50cf\u593420\u7684\u76f4\u64ad\u753b\u9762'),
    ['\u667a\u80fd\u6444\u50cf\u593420'],
  );
  assert.deepEqual(inferCodexTargetTextsFromInstruction('\u70b9\u51fb\u667a\u80fd'), []);

  assert.deepEqual(inferCodexTargetTextsFromInstruction('在首页点击【餐厅-LYC30】摄像头'), ['餐厅-LYC30']);
  assert.deepEqual(inferCodexTargetTextsFromInstruction('点击“回看”按钮'), ['回看']);

  const deviceSteps = coerceCodexActionSteps({
    test_steps: ['在首页点击【餐厅-LYC30】摄像头'],
  });
  const playbackSteps = coerceCodexActionSteps({
    test_steps: ['点击“回看”按钮'],
  });

  assert.equal(deviceSteps[0].action, 'tap');
  assert.equal((deviceSteps[0].target as Record<string, unknown>).text, '餐厅-LYC30');
  assert.deepEqual((deviceSteps[0].target as Record<string, unknown>).text_candidates, ['餐厅-LYC30']);
  assert.equal(deviceSteps[0].target_inferred_from_intent, true);
  assert.equal(playbackSteps[0].action, 'tap');
  const smartCameraSteps = coerceCodexActionSteps({
    test_steps: ['\u70b9\u51fb\u667a\u80fd\u6444\u50cf\u593420'],
  });
  assert.equal(smartCameraSteps[0].action, 'tap');
  assert.equal((smartCameraSteps[0].target as Record<string, unknown>).text, '\u667a\u80fd\u6444\u50cf\u593420');
  assert.equal((playbackSteps[0].target as Record<string, unknown>).text, '回看');

  const goalFallbackSteps = coerceCodexActionSteps({
    test_goal: '\u6253\u5f00\u667a\u80fd\u6444\u50cf\u593420\u7684\u76f4\u64ad\u753b\u9762',
  });
  assert.equal(goalFallbackSteps.length, 1);
  assert.equal(goalFallbackSteps[0].action, 'aiAct');
  assert.equal(goalFallbackSteps[0].source, 'test_goal');
  assert.equal((goalFallbackSteps[0].target as Record<string, unknown>).text, undefined);
  assert.equal(goalFallbackSteps[0].target_inferred_from_intent, undefined);
  assert.equal(goalFallbackSteps[0].action_inferred_from_intent, undefined);
});

test('keeps explicit Codex Guided locators when inferring click intent', () => {
  const steps = coerceCodexActionSteps({
    action_steps: [
      {
        intent: '点击【餐厅-LYC30】摄像头',
        preferred_locator: { resource_id: 'com.example:id/device_card' },
      },
    ],
  });

  assert.equal(steps[0].action, 'tap');
  assert.equal((steps[0].target as Record<string, unknown>).resource_id, 'com.example:id/device_card');
  assert.equal((steps[0].target as Record<string, unknown>).text, undefined);
  assert.deepEqual(steps[0].target_candidates, ['餐厅-LYC30']);
});

test('coerces step-local assertions from expected and checks aliases', () => {
  const steps = coerceCodexActionSteps({
    test_steps: [
      { action: 'tap', intent: 'open detail', expected_result: 'Detail page is visible' },
      { step: 'start playback', checks: ['Play button changes to pause', { kind: 'text_visible', expected: '00:01' }] },
    ],
  });

  assert.equal(steps.length, 2);
  assert.equal((steps[0].assert_after as unknown[])[0], 'Detail page is visible');
  assert.equal((steps[1].assert_after as unknown[]).length, 2);
});

test('skips top-level assertions when step-local assertions exist unless final assertions are explicit', () => {
  const actionSteps = coerceCodexActionSteps({
    action_steps: [{ action: 'tap', intent: 'open detail', assert_after: ['Detail page is visible'] }],
  });

  assert.deepEqual(coerceFinalAssertions({ assertions: ['Only after all steps'] }, actionSteps), []);
  assert.equal(
    coerceFinalAssertions({ final_assertions: ['Final success'], assertions: ['Only after all steps'] }, actionSteps)[0].expected,
    'Final success',
  );
  assert.equal(coerceFinalAssertions({ assertions: ['Legacy final assertion'] }, [])[0].expected, 'Legacy final assertion');
});

test('Codex Guided inferred taps use deterministic executor before Midscene fallback', async () => {
  const calls: string[] = [];
  const [action] = coerceCodexActionSteps({
    test_steps: ['在首页点击【餐厅-LYC30】摄像头'],
  });
  const result = await executeCodexStep(
    {
      agent: {
        async aiAct() {
          throw new Error('fallback should not be called');
        },
      },
      free: async () => undefined,
      observe: async () => ({}),
      executeCodexAction: async (executedAction) => {
        calls.push(`${executedAction.action}:${JSON.stringify(executedAction.target)}`);
        return { success: true, message: 'deterministic tap ok' };
      },
    },
    { job_id: 'job-inferred-tap', slots: { test_goal: 'verify playback page' } },
    action,
    { visible_text: '餐厅-LYC30' },
  );

  assert.equal(result.success, true);
  assert.equal(result.midscene_fallback_used, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^tap:/);
  assert.ok(calls[0].includes('餐厅-LYC30'));
});

test('Codex Guided fallback instruction forces current action execution', async () => {
  const instructions: string[] = [];
  const [action] = coerceCodexActionSteps({
    test_steps: ['点击“回看”按钮'],
  });
  const request = {
    job_id: 'job-fallback-instruction',
    slots: {
      test_goal: '进入餐厅-LYC30回看页',
      test_steps: ['点击【餐厅-LYC30】摄像头', '点击“回看”按钮'],
      expected_result: '回看页时间轴可见',
    },
  };

  const formatted = formatCodexFallbackInstruction(action, request);
  assert.ok(formatted.includes('Overall test goal:\n进入餐厅-LYC30回看页'));
  assert.ok(formatted.includes('Target candidates:\n- 回看'));
  assert.ok(formatted.includes('Execute the current UI action now.'));
  assert.ok(formatted.includes('Do not only observe or describe the screen.'));

  const result = await executeCodexStep(
    {
      agent: {
        async aiAct(instruction: string) {
          instructions.push(instruction);
          return 'fallback acted';
        },
      },
      free: async () => undefined,
      observe: async () => ({}),
      executeCodexAction: async () => ({ success: false, message: 'not found' }),
    },
    request,
    action,
    {},
  );

  assert.equal(result.success, true);
  assert.equal(result.midscene_fallback_used, true);
  assert.equal(instructions.length, 1);
  assert.ok(instructions[0].includes('Execute the current UI action now.'));
  assert.ok(instructions[0].includes('点击“回看”按钮'));
});

test('detects weak step assertions that were already visible before action', () => {
  const [action] = coerceCodexActionSteps({
    test_steps: ['在首页点击【餐厅-LYC30】摄像头'],
  });

  assert.equal(
    isWeakAlreadyVisibleStepAssertion('【餐厅-LYC30】', action, { visible_text: '首页\n餐厅-LYC30' }),
    true,
  );
  assert.equal(
    isWeakAlreadyVisibleStepAssertion('回看页时间轴可见', action, { visible_text: '首页\n餐厅-LYC30' }),
    false,
  );
});

test('detects Android permission popups for Codex Guided guard', () => {
  const decision = findAndroidPopupGuardAction(`
    <node text="仅在使用中允许" resource-id="com.android.permissioncontroller:id/permission_allow_foreground_only_button" content-desc="" clickable="true" enabled="true" bounds="[10,20][310,120]" />
  `);

  assert.equal(decision.detected, true);
  assert.equal(decision.action_type, 'allow_permission');
  assert.equal(decision.matched_text, '允许');
  assert.deepEqual(decision.point, { x: 160, y: 70 });
});

test('detects Android ad and activity dismiss buttons for Codex Guided guard', () => {
  const decision = findAndroidPopupGuardAction(`
    <node text="新人活动" resource-id="com.example:id/title" clickable="false" enabled="true" bounds="[0,0][500,100]" />
    <node text="跳过" resource-id="com.example:id/skip_ad" clickable="true" enabled="true" bounds="[800,40][1000,140]" />
  `);

  assert.equal(decision.detected, true);
  assert.equal(decision.action_type, 'dismiss_popup');
  assert.equal(decision.matched_text, '跳过');
  assert.deepEqual(decision.point, { x: 900, y: 90 });
});

test('skips high-risk business popups instead of auto-confirming', () => {
  const decision = findAndroidPopupGuardAction(`
    <node text="请阅读用户协议和隐私政策" resource-id="com.example:id/privacy" clickable="false" enabled="true" bounds="[0,0][900,300]" />
    <node text="同意" resource-id="com.example:id/agree" clickable="true" enabled="true" bounds="[600,500][900,620]" />
  `);

  assert.equal(decision.detected, true);
  assert.equal(decision.skipped, true);
  assert.equal(decision.action_type, 'skip_high_risk_popup');
  assert.equal(decision.reason, 'high_risk_popup_text');
});

test('Codex popup guard refreshes after dismissing and caps attempts', async () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const screenshots: Record<string, unknown>[] = [];
  let dismissCalls = 0;
  let observeCalls = 0;
  const runtime: RuntimeHandle = {
    agent: {},
    free: async () => undefined,
    observe: async () => ({}),
    dismissAndroidPopup: async () => {
      dismissCalls += 1;
      return {
        detected: true,
        dismissed: true,
        action_type: dismissCalls === 1 ? 'dismiss_popup' : 'allow_permission',
        matched_text: dismissCalls === 1 ? '关闭' : '允许',
        point: { x: 20, y: 30 },
      };
    },
  };

  const result = await runCodexPopupGuard(
    runtime,
    { job_id: 'job-popup-guard', platform: 'android', slots: { execution_mode: 'codex_guided' } },
    { visible_text: 'before popup' },
    7,
    screenshots,
    {
      maxAttempts: 2,
      emitEvent: (eventType, payload) => events.push({ eventType, payload: payload as Record<string, unknown> }),
      observeAndEmit: async (_runtime, stepIndex, shots) => {
        observeCalls += 1;
        const observation = { step_index: stepIndex, visible_text: `after popup ${observeCalls}` };
        shots.push({ step_index: stepIndex, artifact_path: `screenshots/${observeCalls}.png` });
        return observation;
      },
    },
  );

  assert.equal(dismissCalls, 2);
  assert.equal(observeCalls, 2);
  assert.equal(result.visible_text, 'after popup 2');
  assert.equal(screenshots.length, 2);
  assert.equal(events.filter((event) => event.eventType === 'visual_popup_guard_detected').length, 2);
  assert.equal(events.filter((event) => event.eventType === 'visual_popup_guard_dismissed').length, 2);
  assert.equal(events.filter((event) => event.eventType === 'visual_popup_guard_skipped').length, 0);
});

test('Codex popup guard emits skipped for high-risk decisions and can be disabled', async () => {
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  let dismissCalls = 0;
  let observeCalls = 0;
  const runtime: RuntimeHandle = {
    agent: {},
    free: async () => undefined,
    observe: async () => ({}),
    dismissAndroidPopup: async () => {
      dismissCalls += 1;
      return {
        detected: true,
        skipped: true,
        action_type: 'skip_high_risk_popup',
        matched_text: '用户协议',
        reason: 'high_risk_popup_text',
      };
    },
  };

  const skipped = await runCodexPopupGuard(
    runtime,
    { job_id: 'job-popup-skip', platform: 'android', slots: { execution_mode: 'codex_guided' } },
    { visible_text: 'privacy popup' },
    3,
    [],
    {
      emitEvent: (eventType, payload) => events.push({ eventType, payload: payload as Record<string, unknown> }),
      observeAndEmit: async () => {
        observeCalls += 1;
        return {};
      },
    },
  );
  assert.equal(skipped.visible_text, 'privacy popup');
  assert.equal(dismissCalls, 1);
  assert.equal(observeCalls, 0);
  assert.equal(events.filter((event) => event.eventType === 'visual_popup_guard_skipped').length, 1);

  const disabled = await runCodexPopupGuard(
    runtime,
    { job_id: 'job-popup-disabled', platform: 'android', slots: { codex_popup_guard_enabled: false } },
    { visible_text: 'disabled' },
    4,
    [],
    {
      observeAndEmit: async () => {
        observeCalls += 1;
        return {};
      },
    },
  );
  assert.equal(disabled.visible_text, 'disabled');
  assert.equal(dismissCalls, 1);
});

test('formats Midscene AI structured step instructions and assertion objects', () => {
  assert.equal(
    formatMidsceneStepInstruction({
      action: 'tap',
      intent: 'Open device detail',
      target: { text: 'Device A' },
      wait_for: 'detail page',
    }),
    'Open device detail\nAction: tap\nTarget: {"text":"Device A"}\nWait for: detail page',
  );
  assert.equal(
    formatMidsceneAssertionText({ kind: 'text_visible', expected: 'Detail page' }),
    'Verify the following text is visible: Detail page',
  );
  assert.equal(
    formatMidsceneAssertionText({ kind: 'url_contains', expected: '/detail' }),
    'Verify the current URL contains: /detail',
  );
  assert.equal(formatMidsceneAssertionText('Final page is visible'), 'Final page is visible');
});

test('coerces valid Midscene AI steps from explicit steps and test steps', () => {
  const steps = coerceMidsceneStructuredActionSteps({
    structured_steps: [{ action: 'tap', intent: 'open detail', assert_after: ['Detail page is visible'] }],
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].intent, 'open detail');
  assert.equal(coerceMidsceneStructuredActionSteps({ test_steps: ['open detail'] })[0].intent, 'open detail');
  assert.equal(coerceMidsceneStructuredActionSteps({ action_steps: [{ action: 'aiAct', intent: '' }], test_goal: 'open home' }).length, 0);
  assert.equal(coerceMidsceneStructuredActionSteps({ action_steps: [{ action: 'aiAct', intent: '' }] }).length, 0);
  assert.deepEqual(coerceMidsceneFinalAssertions({
    assertions: ['Legacy final assertion'],
    structured_assertions: [{ kind: 'text_visible', expected: 'Ready' }],
  }), ['Verify the following text is visible: Ready', 'Legacy final assertion']);
});

test('keeps goal-only Midscene AI dispatch as a single natural-language goal', () => {
  const dispatch = prepareMidsceneAiDispatch({
    test_goal: '\u6253\u5f00\u667a\u80fd\u6444\u50cf\u593420\u7684\u76f4\u64ad\u753b\u9762\uff0c\u786e\u8ba4\u64ad\u653e\u6d41\u7545\u65e0\u5361\u987f',
  });

  assert.equal(dispatch.dispatchStrategy, 'midscene_ai_single_goal');
  assert.equal(dispatch.actionSteps.length, 0);
  assert.equal(dispatch.eventPayload.action_step_count, 0);
  assert.deepEqual(dispatch.eventPayload.action_summaries, []);
  assert.ok(!JSON.stringify(dispatch.eventPayload).includes('"text":"\u667a\u80fd"'));
});

test('prepares Midscene AI dispatch after filtering empty action shells', () => {
  const dispatch = prepareMidsceneAiDispatch({
    test_goal: 'verify playback',
    test_steps: ['open camera', 'tap playback'],
    action_steps: [{ action: 'aiAct', intent: '', assert_after: ['Do not lose this assertion'] }],
    assertions: ['Playback timeline visible'],
  });

  assert.equal(dispatch.dispatchStrategy, 'midscene_ai_structured');
  assert.equal(dispatch.actionSteps.length, 2);
  assert.equal(dispatch.finalAssertions[0], 'Do not lose this assertion');
  assert.equal(dispatch.finalAssertions[1], 'Playback timeline visible');
  assert.equal(dispatch.eventPayload.execution_mode, 'midscene_ai');
  assert.equal(dispatch.eventPayload.action_step_count, 2);
  assert.ok(JSON.stringify(dispatch.eventPayload).includes('open camera'));
  assert.ok(!JSON.stringify(dispatch.eventPayload).includes('codex_guided'));
});

test('Web sidecar setup reports initialization phases', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');
  for (const token of [
    'visual_web_sidecar_init_started',
    'visual_web_sidecar_init_step',
    'visual_web_sidecar_init_failed',
    'playwright_import',
    'midscene_playwright_import',
    'chromium_launch',
    'page_create',
    'start_url_open',
    'playwright_agent_create',
    'ai_context_set',
  ]) {
    assert.ok(source.includes(token), `expected ${token} in Web initialization instrumentation`);
  }
});

function structuredFlowTestDeps(events: unknown[]) {
  return {
    observeAndEmit: async (
      runtime: RuntimeHandle,
      stepIndex: number,
      screenshots: Record<string, unknown>[],
      source: 'pre_action' | 'heartbeat' | 'post_action',
    ) => {
      const observed = await runtime.observe(stepIndex) as Record<string, unknown>;
      const observation: Record<string, unknown> = { ...observed, observation_source: source };
      screenshots.push({
        step_index: stepIndex,
        artifact_path: observation.screenshot_artifact_path,
        observation_source: source,
      });
      events.push({ eventType: 'visual_observed', payload: observation });
      return observation;
    },
    emitEvent: (eventType: string, payload: Record<string, unknown>) => {
      events.push({ eventType, payload });
    },
    waitIfPaused: async () => undefined,
    startObservationHeartbeat: () => async () => undefined,
  };
}

test('runs Midscene AI structured steps with step-local and final assertions', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const runtime: RuntimeHandle = {
    agent: {
      async aiAct(instruction: string) {
        calls.push(`act:${instruction}`);
        return `acted:${instruction}`;
      },
      async aiAssert(assertion: string) {
        calls.push(`assert:${assertion}`);
        return { pass: true, message: `ok:${assertion}` };
      },
    },
    free: async () => undefined,
    observe: async (step: number) => ({
      step_index: step,
      screenshot_artifact_path: `screenshots/step_${step}.png`,
      visible_text: `screen ${step}`,
    }),
  };
  const steps: Record<string, unknown>[] = [];
  const screenshots: Record<string, unknown>[] = [];
  let nextStep = 1;
  const actionSteps = coerceMidsceneStructuredActionSteps({
    action_steps: [
      { action: 'tap', intent: 'Open detail', assert_after: [{ kind: 'text_visible', expected: 'Detail page' }] },
      { action: 'swipe', intent: 'Scroll list', assert_after: ['More items visible'] },
    ],
  });

  const result = await runMidsceneAiStructuredFlow(
    runtime,
    { job_id: 'job-structured', slots: { max_steps: 10, observation_heartbeat_ms: 0 } },
    actionSteps,
    ['Final page is visible'],
    steps,
    screenshots,
    () => nextStep++,
    structuredFlowTestDeps(events),
  );

  assert.equal(result.success, true);
  assert.deepEqual(calls, [
    'act:Current step 1/2:\nOpen detail\nAction: tap\n\nFinal success criteria:\n- Final page is visible',
    'assert:Verify the following text is visible: Detail page',
    'act:Current step 2/2:\nScroll list\nAction: swipe\n\nFinal success criteria:\n- Final page is visible',
    'assert:More items visible',
    'assert:Final page is visible',
  ]);
  assert.equal(events.filter((event) => (event as Record<string, unknown>).eventType === 'visual_action_planned').length, 2);
  assert.equal(events.filter((event) => (event as Record<string, unknown>).eventType === 'visual_assertion_result').length, 3);
  assert.equal(steps.length, 5);
  assert.equal(screenshots.length, 4);
  assert.ok(!JSON.stringify(events).includes('codex_guided'));
});

test('stops Midscene AI structured flow on step-local assertion failure', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const runtime: RuntimeHandle = {
    agent: {
      async aiAct(instruction: string) {
        calls.push(`act:${instruction}`);
        return `acted:${instruction}`;
      },
      async aiAssert(assertion: string) {
        calls.push(`assert:${assertion}`);
        return { pass: false, message: `failed:${assertion}` };
      },
    },
    free: async () => undefined,
    observe: async (step: number) => ({
      step_index: step,
      screenshot_artifact_path: `screenshots/step_${step}.png`,
      visible_text: `screen ${step}`,
    }),
  };
  const steps: Record<string, unknown>[] = [];
  const screenshots: Record<string, unknown>[] = [];
  let nextStep = 1;
  const actionSteps = coerceMidsceneStructuredActionSteps({
    action_steps: [
      { action: 'tap', intent: 'Open detail', assert_after: [{ kind: 'text_visible', expected: 'Detail page' }] },
      { action: 'tap', intent: 'Open settings', assert_after: ['Settings visible'] },
    ],
  });

  const result = await runMidsceneAiStructuredFlow(
    runtime,
    { job_id: 'job-failing-structured', slots: { observation_heartbeat_ms: 0 } },
    actionSteps,
    ['Final page is visible'],
    steps,
    screenshots,
    () => nextStep++,
    structuredFlowTestDeps(events),
  );

  assert.equal(result.success, false);
  assert.deepEqual(calls, [
    'act:Current step 1/2:\nOpen detail\nAction: tap\n\nFinal success criteria:\n- Final page is visible',
    'assert:Verify the following text is visible: Detail page',
  ]);
  const assertionEvents = events.filter((event) => (event as Record<string, unknown>).eventType === 'visual_assertion_result');
  assert.equal(assertionEvents.length, 1);
  assert.equal(((assertionEvents[0] as Record<string, unknown>).payload as Record<string, unknown>).success, false);
});

test('Midscene AI structured instruction includes overall goal and current step', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  const runtime: RuntimeHandle = {
    agent: {
      async aiAct(instruction: string) {
        calls.push(instruction);
        return 'acted';
      },
      async aiAssert() {
        return { pass: true, message: 'ok' };
      },
    },
    free: async () => undefined,
    observe: async (step: number) => ({
      step_index: step,
      screenshot_artifact_path: `screenshots/step_${step}.png`,
      visible_text: `screen ${step}`,
    }),
  };
  const steps: Record<string, unknown>[] = [];
  const screenshots: Record<string, unknown>[] = [];
  let nextStep = 1;
  const actionSteps = coerceMidsceneStructuredActionSteps({
    test_steps: ['open camera detail'],
  });

  await runMidsceneAiStructuredFlow(
    runtime,
    {
      job_id: 'job-goal-context',
      slots: {
        test_goal: 'verify playback page',
        expected_result: 'timeline is visible',
        observation_heartbeat_ms: 0,
      },
    },
    actionSteps,
    ['timeline is visible'],
    steps,
    screenshots,
    () => nextStep++,
    structuredFlowTestDeps(events),
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('Overall test goal:\nverify playback page'));
  assert.ok(calls[0].includes('Current step 1/1:\nopen camera detail'));
  assert.ok(calls[0].includes('Expected result:\ntimeline is visible'));
});

test('evaluates codex guided deterministic assertions', () => {
  const pass = evaluateCodexAssertion(
    { kind: 'text_visible', expected: '订单入口' },
    { visible_text: '首页\n订单入口', current_ref: 'https://example.test/home' },
  );
  const urlPass = evaluateCodexAssertion(
    { kind: 'url_contains', expected: '/home' },
    { visible_text: '', current_ref: 'https://example.test/home' },
  );
  const fail = evaluateCodexAssertion(
    { kind: 'text_visible', expected: '设置入口' },
    { visible_text: '首页\n订单入口', current_ref: 'https://example.test/home' },
  );

  assert.equal(pass.success, true);
  assert.equal(urlPass.success, true);
  assert.equal(fail.success, false);
});
