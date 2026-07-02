#!/usr/bin/env node

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline';

type JsonObject = Record<string, unknown>;

export type RunnerRequest = {
  job_id?: string;
  platform?: 'web' | 'android';
  slots?: JsonObject;
  trace_dir?: string;
  control_file?: string;
  asset_context?: JsonObject;
  yaml_script?: string;
  mock_mode?: boolean;
  mcp_tool_name?: string;
  mcp_arguments?: JsonObject;
  playground?: {
    port?: number;
    host?: string;
  };
};

export type RuntimeHandle = {
  agent: any;
  free: () => Promise<void>;
  observe: (step: number) => Promise<JsonObject>;
  executeCodexAction?: (action: JsonObject, observation: JsonObject) => Promise<JsonObject>;
  dismissAndroidPopup?: (observation: JsonObject, stepIndex: number) => Promise<JsonObject>;
};

type InternalMcpTool = {
  name: string;
  description: string;
  schema: unknown;
  call?: (args: JsonObject) => Promise<unknown> | unknown;
};

type McpDecision = {
  decision?: string;
  mcp_tool_name?: string;
  mcp_arguments?: JsonObject;
  assertion?: string;
  message?: string;
  reason?: string;
  terminal_status?: string;
};

type MidsceneSessionState = {
  sessionId: string;
  request: RunnerRequest;
  runtime: RuntimeHandle | null;
  traceDir: string;
  steps: JsonObject[];
  screenshots: JsonObject[];
  assertions: JsonObject[];
  history: JsonObject[];
  stepIndex: number;
  latestObservation: JsonObject | null;
  mockMode: boolean;
  finished: boolean;
};

type ReflectionDecision = JsonObject & {
  phase?: string;
  source_step_id?: string;
  repair_attempt?: number;
  visible?: boolean;
  verdict?: string;
  confidence?: number;
  risk_level?: string;
  user_visible_summary?: string;
  correction_actions?: JsonObject[];
};

export type VisualSelfHealingState = {
  enabled: boolean;
  maxRepairsPerStep: number;
  maxRepairsPerCase: number;
  repeatedFailureLimit: number;
  autoRiskPolicy: string;
  caseRepairCount: number;
  repairsByStep: Record<string, number>;
  failureCounts: Record<string, number>;
  failureEvents: JsonObject[];
  stoppedReason: string;
};

export type VisualPathMemoryState = {
  knownRoutes: JsonObject[];
  avoidActions: JsonObject[];
  recentMistakes: JsonObject[];
  temporaryMemory: JsonObject[];
  pathMemoryDeltas: JsonObject[];
  appliedSteps: Record<string, boolean>;
};

type ParsedScreenshot = {
  buffer: Buffer;
  mime: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
};

type ScreenshotWriteResult = ParsedScreenshot & {
  path: string;
  source: 'midscene_android' | 'adb_exec_out' | 'placeholder';
  error?: string;
};

type AndroidScreenSize = {
  width: number;
  height: number;
};

type AndroidRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type AndroidMidscenePreflight = {
  platform: 'android';
  adb_available: boolean;
  adb_path: string;
  adb_error?: string;
  connected_devices: string[];
  unauthorized_devices: string[];
  offline_devices: string[];
  target_device_id?: string;
  target_device_connected: boolean;
  android_sdk_configured: boolean;
  missing_android_env_keys: string[];
  midscene_model_configured: boolean;
  missing_midscene_env_keys: string[];
};

const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const MIN_SCREENSHOT_BYTES = 32;
const FALLBACK_ANDROID_SCREEN_SIZE: AndroidScreenSize = { width: 1, height: 1 };
const MAX_STEPS_PER_JOB = 10000;
const DEFAULT_MAX_STEPS = 9999;
const DEFAULT_OBSERVATION_HEARTBEAT_MS = 5000;
const DEFAULT_CODEX_REPLANNING_CYCLE_LIMIT = 2;
const DEFAULT_CODEX_FALLBACK_TIMEOUT_MS = 45_000;
const DEFAULT_CODEX_MIDSCENE_FALLBACK_MAX_COUNT = 1;
const ANDROID_SDK_ENV_KEYS = ['ANDROID_HOME', 'ANDROID_SDK_ROOT'] as const;
const MIDSCENE_MODEL_ENV_KEYS = [
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const;

const HIGH_RISK_TOKENS = [
  'pay',
  'payment',
  'purchase',
  'delete',
  'remove',
  'production',
  'submit production',
  'transfer',
  'checkout',
  '\u652f\u4ed8',
  '\u4ed8\u6b3e',
  '\u5220\u9664',
  '\u79fb\u9664',
  '\u63d0\u4ea4\u751f\u4ea7',
  '\u751f\u4ea7\u6570\u636e',
  '\u8f6c\u8d26',
  '\u4e0b\u5355',
  '\u8d2d\u4e70',
];

const requireFromHere = createRequire(__filename);
let inputInterface: Interface | null = null;
let inputIterator: AsyncIterator<string> | null = null;

function emit(item: JsonObject): void {
  process.stdout.write(`${JSON.stringify(item)}\n`);
}

function emitEvent(eventType: string, payload: JsonObject): void {
  emit({ type: 'event', event_type: eventType, payload });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function clipText(value: unknown, limit: number): string {
  const text = asText(value).trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function coerceBooleanSlot(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = asText(value).trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function clampStepLimit(value: unknown, fallback = DEFAULT_MAX_STEPS): number {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(1, Math.min(MAX_STEPS_PER_JOB, safeValue));
}

function clampRepairLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  const safeValue = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(0, Math.min(MAX_STEPS_PER_JOB, safeValue));
}

function firstConfiguredValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' && !value.trim()) continue;
    return value;
  }
  return undefined;
}

function hiddenChildProcessOptions(): { windowsHide?: boolean } {
  return process.platform === 'win32' ? { windowsHide: true } : {};
}

type ExecFileSyncLike = (
  file: string,
  args?: readonly string[],
  options?: Record<string, unknown>,
) => Buffer | string;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configured(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value);
}

export function parseAdbDevices(output: string): {
  connected_devices: string[];
  unauthorized_devices: string[];
  offline_devices: string[];
} {
  const connected_devices: string[] = [];
  const unauthorized_devices: string[] = [];
  const offline_devices: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^list of devices attached$/i.test(line)) continue;
    const [serial, state] = line.split(/\s+/);
    if (!serial || !state) continue;
    if (state === 'device') connected_devices.push(serial);
    else if (state === 'unauthorized') unauthorized_devices.push(serial);
    else if (state === 'offline') offline_devices.push(serial);
  }
  return { connected_devices, unauthorized_devices, offline_devices };
}

export function buildAndroidMidscenePreflight(options: {
  deviceId?: string;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFileSyncLike;
} = {}): AndroidMidscenePreflight {
  let env = options.env ?? process.env;
  // If ANDROID_HOME/ANDROID_SDK_ROOT are not set but we know this specific environment, set them
  if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
    // Check if adb is in the known location
    const knownSdkRoot = 'E:/04 Coding/platform-tools-latest-windows';
    if (env.ANDROID_HOME === undefined) {
      env = { ...env, ANDROID_HOME: knownSdkRoot };
    }
    if (env.ANDROID_SDK_ROOT === undefined) {
      env = { ...env, ANDROID_SDK_ROOT: knownSdkRoot };
    }
  }
  // Set ADB path if not already set
  if (!env.ADB_PATH && env.ANDROID_HOME) {
    env = { ...env, ADB_PATH: `${env.ANDROID_HOME}/platform-tools/adb.exe` };
  }
  const execFile = options.execFile ?? (execFileSync as ExecFileSyncLike);
  const adbPath = asText(env.ADB_PATH).trim() || 'adb';
  const targetDeviceId = asText(options.deviceId).trim() || undefined;
  let adbAvailable = false;
  let adbError = '';
  let devicesText = '';

  try {
    execFile(adbPath, ['version'], {
      encoding: 'utf8',
      timeout: 5000,
      ...hiddenChildProcessOptions(),
    });
    adbAvailable = true;
  } catch (error) {
    adbError = errorMessage(error);
  }

  if (adbAvailable) {
    try {
      devicesText = String(execFile(adbPath, ['devices'], {
        encoding: 'utf8',
        timeout: 5000,
        ...hiddenChildProcessOptions(),
      }));
    } catch (error) {
      adbError = `adb devices failed: ${errorMessage(error)}`;
    }
  }

  const devices = parseAdbDevices(devicesText);
  const androidSdkConfigured = ANDROID_SDK_ENV_KEYS.some(key => configured(env[key]));
  const missingMidsceneEnvKeys = MIDSCENE_MODEL_ENV_KEYS.filter(key => !configured(env[key]));
  const targetDeviceConnected = targetDeviceId
    ? devices.connected_devices.includes(targetDeviceId)
    : devices.connected_devices.length > 0;

  return {
    platform: 'android',
    adb_available: adbAvailable,
    adb_path: adbPath,
    ...(adbError ? { adb_error: clipText(adbError, 1000) } : {}),
    ...devices,
    ...(targetDeviceId ? { target_device_id: targetDeviceId } : {}),
    target_device_connected: targetDeviceConnected,
    android_sdk_configured: androidSdkConfigured,
    missing_android_env_keys: androidSdkConfigured ? [] : [...ANDROID_SDK_ENV_KEYS],
    midscene_model_configured: missingMidsceneEnvKeys.length === 0,
    missing_midscene_env_keys: missingMidsceneEnvKeys,
  };
}

export function formatAndroidPreflightFailure(
  preflight: AndroidMidscenePreflight,
): string | null {
  if (!preflight.adb_available) {
    return `ADB is not available: ${preflight.adb_error || `unable to run ${preflight.adb_path}`}.`;
  }

  if (preflight.target_device_id && !preflight.target_device_connected) {
    const connected = preflight.connected_devices.length
      ? `Connected devices: ${preflight.connected_devices.join(', ')}.`
      : 'No connected Android device found.';
    return `Android device ${preflight.target_device_id} is not connected or authorized. ${connected}`;
  }

  if (!preflight.target_device_id && preflight.connected_devices.length === 0) {
    const unauthorized = preflight.unauthorized_devices.length
      ? ` Unauthorized devices: ${preflight.unauthorized_devices.join(', ')}.`
      : '';
    return `No connected Android device found. Run "adb devices" and authorize the device.${unauthorized}`;
  }

  if (!preflight.midscene_model_configured) {
    return `Midscene model configuration is incomplete: missing ${preflight.missing_midscene_env_keys.join(', ')}. Configure Midscene App Test in OpenCat Web Providers.`;
  }

  return null;
}

function normalizeAndroidSetupError(
  error: unknown,
  preflight: AndroidMidscenePreflight,
): Error {
  const preflightFailure = formatAndroidPreflightFailure(preflight);
  if (preflightFailure) return new Error(preflightFailure);

  const message = errorMessage(error);
  if (
    preflight.connected_devices.length > 0 &&
    /no connected android device|android_home|android_sdk_root|android sdk/i.test(message)
  ) {
    const sdkStatus = preflight.android_sdk_configured
      ? 'configured'
      : `unset (${preflight.missing_android_env_keys.join(', ')})`;
    return new Error(
      `Midscene Android initialization failed after ADB preflight found connected device(s): ${preflight.connected_devices.join(', ')}. Android SDK env: ${sdkStatus}.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

export function shouldForceStopBeforeLaunch(slots: JsonObject = {}): boolean {
  return coerceBooleanSlot(
    firstConfiguredValue(slots.force_stop_before_launch, slots.android_force_stop_before_launch),
    false,
  );
}

export function resolveReplanningCycleLimit(slots: JsonObject = {}): number {
  if (asText(slots.execution_mode).trim() === 'codex_guided') {
    return clampStepLimit(
      firstConfiguredValue(
        slots.replanning_cycle_limit,
        slots.codex_replanning_cycle_limit,
        process.env.MIDSCENE_CODEX_REPLANNING_CYCLE_LIMIT,
      ),
      DEFAULT_CODEX_REPLANNING_CYCLE_LIMIT,
    );
  }
  return clampStepLimit(firstConfiguredValue(slots.replanning_cycle_limit, slots.max_steps), DEFAULT_MAX_STEPS);
}

export function resolveCodexFallbackTimeoutMs(slots: JsonObject = {}): number {
  const configured = firstConfiguredValue(
    slots.codex_midscene_fallback_timeout_ms,
    slots.midscene_fallback_timeout_ms,
    process.env.MIDSCENE_CODEX_FALLBACK_TIMEOUT_MS,
  );
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CODEX_FALLBACK_TIMEOUT_MS;
  return Math.max(1000, Math.min(300_000, Math.trunc(parsed)));
}

export function resolveCodexMidsceneFallbackMaxCount(slots: JsonObject = {}): number {
  const configured = firstConfiguredValue(
    slots.codex_midscene_fallback_max_count,
    slots.midscene_fallback_max_count,
    process.env.MIDSCENE_CODEX_FALLBACK_MAX_COUNT,
  );
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CODEX_MIDSCENE_FALLBACK_MAX_COUNT;
  return Math.max(0, Math.min(20, Math.trunc(parsed)));
}

export function resolveObservationHeartbeatMs(slots: JsonObject = {}): number {
  const configured = firstConfiguredValue(
    slots.observation_heartbeat_ms,
    slots.visual_observation_heartbeat_ms,
    process.env.MIDSCENE_OBSERVATION_HEARTBEAT_MS,
  );
  if (configured == null) return DEFAULT_OBSERVATION_HEARTBEAT_MS;
  const parsed = Number(configured);
  if (!Number.isFinite(parsed)) return DEFAULT_OBSERVATION_HEARTBEAT_MS;
  return Math.max(0, Math.min(60000, Math.trunc(parsed)));
}

function normalizeAndroidImeStrategy(value: unknown): 'always-yadb' | 'yadb-for-non-ascii' | '' {
  const normalized = asText(value).trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'always-yadb' || normalized === 'always') return 'always-yadb';
  if (normalized === 'yadb-for-non-ascii' || normalized === 'non-ascii' || normalized === 'auto') return 'yadb-for-non-ascii';
  return '';
}

export function buildMidsceneAgentOptions(request: RunnerRequest) {
  const replanningCycleLimit = resolveReplanningCycleLimit(request.slots || {});
  const slots = request.slots || {};
  const imeStrategy = normalizeAndroidImeStrategy(firstConfiguredValue(
    slots.midscene_android_ime_strategy,
    slots.android_ime_strategy,
    slots.ime_strategy,
    process.env.MIDSCENE_ANDROID_IME_STRATEGY,
    'always-yadb',
  )) || 'always-yadb';
  process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT = String(replanningCycleLimit);
  process.env.MIDSCENE_ANDROID_IME_STRATEGY = imeStrategy;
  return {
    generateReport: true,
    reportFileName: `midscene-${asText(request.job_id)}`,
    replanningCycleLimit,
    imeStrategy,
  };
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
    return text.split(/[,\uFF0C\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return value == null ? [] : [value];
}

export function coerceTestSteps(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return coerceTestSteps(parsed);
    } catch {
      // fall through
    }
    return text.split(/[,\uFF0C\n;\uFF1B]+/).map((item) => item.trim()).filter(Boolean);
  }
  const result: string[] = [];
  for (const item of asList(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as JsonObject;
      const text = firstConfiguredValue(
        record.step,
        record.action,
        record.instruction,
        record.description,
        record.text,
        record.title,
        record.name,
      );
      result.push(...coerceTestSteps(text));
      continue;
    }
    const text = asText(item).trim();
    if (text) result.push(text);
  }
  const seen = new Set<string>();
  return result.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

async function readRequest(): Promise<RunnerRequest> {
  if (process.env.MIDSCENE_INTERACTIVE === '1') {
    const parsed = await readJsonLine();
    return parsed && typeof parsed === 'object' ? parsed as RunnerRequest : {};
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function getInputIterator(): AsyncIterator<string> {
  if (!inputInterface) {
    inputInterface = createInterface({ input: process.stdin, crlfDelay: Infinity });
    inputIterator = inputInterface[Symbol.asyncIterator]();
  }
  return inputIterator as AsyncIterator<string>;
}

async function readJsonLine(): Promise<JsonObject> {
  const next = await getInputIterator().next();
  if (next.done || !next.value) {
    throw new Error('interactive input closed while waiting for JSON line');
  }
  const parsed = JSON.parse(String(next.value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('interactive input line must be a JSON object');
  }
  return parsed as JsonObject;
}

function fallbackStepReflection(payload: JsonObject): ReflectionDecision {
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as JsonObject
    : {};
  const action = payload.action && typeof payload.action === 'object' && !Array.isArray(payload.action)
    ? payload.action as JsonObject
    : {};
  const highRisk = isHighRiskText(action, result, payload);
  const success = result.success !== false && !asText(result.terminal_status).trim() && !asText(result.error).trim();
  const verdict = highRisk ? 'ask_user' : (success ? 'continue' : 'retry');
  return {
    phase: asText(payload.phase || defaultReflectionPhase(payload)),
    source_step_id: asText(payload.source_step_id || payload.step_id || payload.step_index || ''),
    repair_attempt: Number(payload.repair_attempt || 0) || 0,
    visible: payload.visible !== false,
    verdict,
    confidence: highRisk || !success ? 0.68 : 0.55,
    risk_level: highRisk ? 'high' : (success ? 'low' : 'medium'),
    issues: success && !highRisk ? [] : [{
      type: highRisk ? 'high_risk_action' : 'visual_step_failed',
      severity: highRisk ? 'high' : 'medium',
      message: highRisk ? 'High-risk visual action requires confirmation.' : asText(result.message || 'Visual step failed.'),
    }],
    evidence: [{ ref: 'sidecar_result', text: clipText(result.message || result.terminal_status || verdict, 240) }],
    correction_actions: highRisk ? [] : [{ type: 'reobserve', risk_level: 'low', reason: 'Wait briefly and observe again before retrying.' }],
    memory_candidates: [],
    user_visible_summary: highRisk
      ? 'Visual reflection blocked a high-risk action.'
      : (success ? 'Visual reflection found no blocking issue.' : 'Visual reflection recommends retrying after re-observation.'),
    model_source: 'sidecar_rules_fallback',
    fallback_used: true,
  };
}

function defaultReflectionPhase(payload: JsonObject): string {
  const scope = asText(payload.scope || payload.phase || '').toLowerCase();
  if (scope.includes('assert')) return 'assertion';
  if (scope.includes('repair')) return 'repair';
  if (scope.includes('final')) return 'final_response';
  if (scope.includes('pre')) return 'pre_action';
  return 'post_action';
}

function normalizeStepReflection(decision: JsonObject, payload: JsonObject): ReflectionDecision {
  return {
    ...decision,
    phase: asText(decision.phase || payload.phase || defaultReflectionPhase(payload)),
    source_step_id: asText(decision.source_step_id || payload.source_step_id || payload.step_id || payload.step_index || ''),
    repair_attempt: Number(decision.repair_attempt || payload.repair_attempt || 0) || 0,
    visible: decision.visible !== false,
  } as ReflectionDecision;
}

async function requestStepReflection(payload: JsonObject): Promise<ReflectionDecision> {
  if (process.env.MIDSCENE_INTERACTIVE !== '1') {
    return fallbackStepReflection(payload);
  }
  const requestId = `reflection-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  emit({ type: 'reflection_request', request_id: requestId, ...payload });
  try {
    const response = await readJsonLine();
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      return normalizeStepReflection(response as JsonObject, payload);
    }
  } catch {
    return fallbackStepReflection(payload);
  }
  return fallbackStepReflection(payload);
}

function emitStepReflection(stepIndex: number, reflection: ReflectionDecision, extra: JsonObject = {}): void {
  emitEvent('visual_step_reflection', {
    step_index: stepIndex,
    reflection,
    verdict: reflection.verdict || 'continue',
    risk_level: reflection.risk_level || 'medium',
    summary: reflection.user_visible_summary || '',
    ...extra,
  });
}

function memoryList(value: unknown, limit = 12): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item))).slice(-limit)
    : [];
}

export function createVisualPathMemoryState(slots: JsonObject = {}): VisualPathMemoryState {
  const seed = slots.visual_execution_memory && typeof slots.visual_execution_memory === 'object' && !Array.isArray(slots.visual_execution_memory)
    ? slots.visual_execution_memory as JsonObject
    : {};
  const knownRoutes = memoryList(seed.known_routes);
  for (const route of memoryList(slots.used_navigation_routes)) {
    knownRoutes.push({
      source: 'used_navigation_route',
      route_id: asText(route.route_id),
      from_case_id: asText(route.from_case_id),
      to_ref: asText(route.to_ref),
      confidence: route.confidence,
    });
  }
  const routeReuse = slots.route_reuse && typeof slots.route_reuse === 'object' && !Array.isArray(slots.route_reuse)
    ? slots.route_reuse as JsonObject
    : {};
  if (Object.keys(routeReuse).length) {
    knownRoutes.push({
      source: 'route_reuse',
      route_id: asText(routeReuse.route_id),
      from_case_id: asText(routeReuse.from_case_id),
      to_ref: asText(routeReuse.to_ref),
      confidence: routeReuse.confidence,
    });
  }
  return {
    knownRoutes: knownRoutes.slice(-12),
    avoidActions: memoryList(seed.avoid_actions),
    recentMistakes: memoryList(seed.recent_mistakes),
    temporaryMemory: memoryList(seed.temporary_memory),
    pathMemoryDeltas: memoryList(seed.path_memory_deltas),
    appliedSteps: {},
  };
}

export function visualPathMemorySnapshot(state: VisualPathMemoryState): JsonObject {
  return {
    known_routes: state.knownRoutes.slice(-12),
    avoid_actions: state.avoidActions.slice(-12),
    recent_mistakes: state.recentMistakes.slice(-12),
    temporary_memory: state.temporaryMemory.slice(-12),
    path_memory_deltas: state.pathMemoryDeltas.slice(-12),
  };
}

function visualPathMemoryHasContext(state: VisualPathMemoryState): boolean {
  return state.knownRoutes.length > 0 || state.avoidActions.length > 0 || state.recentMistakes.length > 0 || state.temporaryMemory.length > 0;
}

function visualPathMemoryInstruction(state: VisualPathMemoryState): string {
  if (!visualPathMemoryHasContext(state)) return '';
  const lines = ['Runtime path memory for this mission. Use it as planning context, not as an extra test step.'];
  const routes = state.knownRoutes.slice(-3)
    .map((route) => [asText(route.to_ref || route.current_ref), asText(route.action_text)].filter(Boolean).join(' via '))
    .filter(Boolean);
  if (routes.length) lines.push(`Known routes: ${routes.join(' | ')}`);
  const avoids = state.avoidActions.slice(-3)
    .map((item) => [asText(item.action_text), asText(item.reason)].filter(Boolean).join(' because '))
    .filter(Boolean);
  if (avoids.length) lines.push(`Avoid repeating: ${avoids.join(' | ')}`);
  const mistakes = state.recentMistakes.slice(-2)
    .map((item) => [asText(item.action_text), asText(item.reason)].filter(Boolean).join(' -> '))
    .filter(Boolean);
  if (mistakes.length) lines.push(`Recent mistakes: ${mistakes.join(' | ')}`);
  return lines.join('\n');
}

function appendVisualPathMemoryInstruction(text: string, state: VisualPathMemoryState): string {
  const memory = visualPathMemoryInstruction(state);
  if (!memory) return text;
  return `${text || ''}\n\n${memory}`.trim();
}

function emitVisualPathMemoryApplied(state: VisualPathMemoryState, stepIndex: number, emitEventFn: (eventType: string, payload: JsonObject) => void = emitEvent): void {
  if (!visualPathMemoryHasContext(state)) return;
  const key = String(stepIndex);
  if (state.appliedSteps[key]) return;
  state.appliedSteps[key] = true;
  emitEventFn('visual_path_memory_applied', {
    step_index: stepIndex,
    stage: 'visual_path_memory_applied',
    message: 'Runtime path memory injected before planning this visual step.',
    memory: visualPathMemorySnapshot(state),
  });
}

export function applyVisualPathMemoryToAction(
  action: JsonObject,
  state: VisualPathMemoryState,
  stepIndex: number,
  emitEventFn: (eventType: string, payload: JsonObject) => void = emitEvent,
): JsonObject {
  if (!visualPathMemoryHasContext(state)) return action;
  emitVisualPathMemoryApplied(state, stepIndex, emitEventFn);
  const snapshot = visualPathMemorySnapshot(state);
  const instruction = visualPathMemoryInstruction(state);
  const nextAction: JsonObject = { ...action, path_memory_context: snapshot };
  const reason = asText(nextAction.reason || nextAction.intent || '');
  if (instruction && reason) nextAction.reason = `${reason}\n\n${instruction}`;
  return nextAction;
}

export function rememberVisualPathReflection(
  state: VisualPathMemoryState,
  stepIndex: number,
  reflection: ReflectionDecision,
  emitEventFn: (eventType: string, payload: JsonObject) => void = emitEvent,
): void {
  const delta = reflection.path_memory_delta && typeof reflection.path_memory_delta === 'object' && !Array.isArray(reflection.path_memory_delta)
    ? reflection.path_memory_delta as JsonObject
    : {};
  if (Object.keys(delta).length) {
    state.pathMemoryDeltas.push(delta);
    state.pathMemoryDeltas = state.pathMemoryDeltas.slice(-12);
    if (asText(delta.outcome) === 'success') {
      state.knownRoutes.push(delta);
      state.knownRoutes = state.knownRoutes.slice(-12);
    }
    if (delta.avoid) {
      state.avoidActions.push(delta);
      state.recentMistakes.push(delta);
      state.avoidActions = state.avoidActions.slice(-12);
      state.recentMistakes = state.recentMistakes.slice(-12);
    }
    emitEventFn('visual_path_memory_delta', {
      ...delta,
      step_index: Number(delta.step_index || stepIndex) || stepIndex,
      stage: 'visual_path_memory_delta',
      message: delta.avoid
        ? 'Recorded a path memory delta and will avoid repeating this action.'
        : 'Recorded a successful path memory delta.',
    });
  }
  const temporary = memoryList(reflection.temporary_memory);
  if (temporary.length) {
    state.temporaryMemory = temporary.slice(-12);
    emitEventFn('visual_temp_memory_snapshot', {
      step_index: stepIndex,
      stage: 'visual_temp_memory_snapshot',
      message: 'Temporary visual memory refreshed after this step.',
      temporary_memory: state.temporaryMemory,
      memory: visualPathMemorySnapshot(state),
    });
  }
  const verdict = asText(reflection.verdict).trim().toLowerCase();
  const shouldReplan = ['retry', 'repair_plan', 'recover', 'ask_user', 'block'].includes(verdict)
    || ['failure', 'blocked', 'uncertain'].includes(asText(delta.outcome).trim().toLowerCase());
  if (shouldReplan) {
    emitEventFn('visual_step_replan', {
      step_index: stepIndex,
      stage: 'visual_step_replan',
      message: asText(reflection.user_visible_summary || reflection.summary || 'Reflection updated the next visual plan.'),
      verdict,
      path_memory_delta: delta,
      next_step_hints: reflection.next_step_hints || {},
    });
  }
}

function reflectionCorrectionActions(reflection: ReflectionDecision): JsonObject[] {
  return Array.isArray(reflection.correction_actions)
    ? reflection.correction_actions.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : [];
}

function primaryReflectionCorrection(reflection: ReflectionDecision): JsonObject {
  const actions = reflectionCorrectionActions(reflection);
  return actions[0] || {};
}

function reflectionRequestsRetry(reflection: ReflectionDecision): boolean {
  const verdict = asText(reflection.verdict).trim();
  const actionType = asText(primaryReflectionCorrection(reflection).type).trim();
  if (['stop', 'ask_user', 'ask_user_confirmation', 'block'].includes(actionType)) return false;
  return ['retry', 'repair_plan', 'recover'].includes(verdict)
    || ['retry_current_action', 'correct_next_action'].includes(actionType);
}

function correctionWaitMs(action: JsonObject): number {
  const seconds = Number(firstConfiguredValue(action.seconds, action.wait_seconds, action.delay_seconds, 0));
  const milliseconds = Number(firstConfiguredValue(action.ms, action.wait_ms, action.delay_ms, 0));
  if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.min(10_000, Math.max(100, Math.trunc(milliseconds)));
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(10_000, Math.max(100, Math.trunc(seconds * 1000)));
  return 400;
}

function correctedActionFromReflection(reflection: ReflectionDecision, fallback: JsonObject): JsonObject {
  const action = primaryReflectionCorrection(reflection);
  if (asText(action.type).trim() !== 'correct_next_action') return fallback;
  const argumentsPayload = action.arguments && typeof action.arguments === 'object' && !Array.isArray(action.arguments)
    ? action.arguments as JsonObject
    : {};
  const candidate = action.action && typeof action.action === 'object' && !Array.isArray(action.action)
    ? action.action as JsonObject
    : (argumentsPayload.action && typeof argumentsPayload.action === 'object' && !Array.isArray(argumentsPayload.action)
      ? argumentsPayload.action as JsonObject
      : argumentsPayload);
  return Object.keys(candidate).length ? { ...fallback, ...candidate, reflection_corrected: true } : fallback;
}

function maxVisualReflectionRepairs(slots: JsonObject): number {
  return clampRepairLimit(firstConfiguredValue(slots.max_visual_repairs_per_step, slots.visual_reflection_max_repairs, 3), 3);
}

function maxVisualCaseRepairs(slots: JsonObject): number {
  return clampRepairLimit(firstConfiguredValue(slots.max_visual_repairs_per_case, slots.visual_self_healing_max_repairs, 10), 10);
}

function visualRepeatedFailureLimit(slots: JsonObject): number {
  return clampStepLimit(firstConfiguredValue(slots.visual_repeated_failure_limit, slots.repeated_failure_limit, 3), 3);
}

function visualSelfHealingEnabled(slots: JsonObject): boolean {
  return coerceBooleanSlot(firstConfiguredValue(slots.self_healing_enabled, slots.visual_self_healing_enabled), true);
}

export function createVisualSelfHealingState(slots: JsonObject = {}): VisualSelfHealingState {
  return {
    enabled: visualSelfHealingEnabled(slots),
    maxRepairsPerStep: maxVisualReflectionRepairs(slots),
    maxRepairsPerCase: maxVisualCaseRepairs(slots),
    repeatedFailureLimit: visualRepeatedFailureLimit(slots),
    autoRiskPolicy: asText(firstConfiguredValue(slots.visual_auto_risk_policy, 'low_medium_auto_high_confirm')).trim().toLowerCase(),
    caseRepairCount: 0,
    repairsByStep: {},
    failureCounts: {},
    failureEvents: [],
    stoppedReason: '',
  };
}

export function visualFailureSignature(payload: JsonObject = {}): string {
  const result = payload.result && typeof payload.result === 'object' && !Array.isArray(payload.result)
    ? payload.result as JsonObject
    : {};
  const action = payload.action && typeof payload.action === 'object' && !Array.isArray(payload.action)
    ? payload.action as JsonObject
    : {};
  const observation = payload.observation && typeof payload.observation === 'object' && !Array.isArray(payload.observation)
    ? payload.observation as JsonObject
    : {};
  const parts = [
    asText(payload.phase || ''),
    asText(action.action || action.intent || action.reason || '').slice(0, 80),
    asText(result.event_type || result.terminal_status || '').slice(0, 80),
    asText(result.deterministic_failure || result.message || result.error || '').slice(0, 140),
    asText(observation.current_ref || '').slice(0, 120),
  ].map((item) => item.trim().toLowerCase().replace(/\s+/g, ' '));
  return parts.filter(Boolean).join('|') || 'visual_failure';
}

function visualSelfHealingContext(state: VisualSelfHealingState, stepIndex: number): JsonObject {
  return {
    enabled: state.enabled,
    max_repairs_per_step: state.maxRepairsPerStep,
    max_repairs_per_case: state.maxRepairsPerCase,
    repeated_failure_limit: state.repeatedFailureLimit,
    step_repair_count: state.repairsByStep[String(stepIndex)] || 0,
    case_repair_count: state.caseRepairCount,
    remaining_case_repairs: Math.max(0, state.maxRepairsPerCase - state.caseRepairCount),
    auto_risk_policy: state.autoRiskPolicy,
  };
}

function visualSelfHealingTracePayload(state: VisualSelfHealingState): JsonObject {
  return {
    enabled: state.enabled,
    max_repairs_per_step: state.maxRepairsPerStep,
    max_repairs_per_case: state.maxRepairsPerCase,
    repeated_failure_limit: state.repeatedFailureLimit,
    case_repair_count: state.caseRepairCount,
    repairs_by_step: state.repairsByStep,
    stopped_reason: state.stoppedReason,
  };
}

export function canUseVisualSelfHealingRepair(
  state: VisualSelfHealingState,
  stepIndex: number,
  reflection: ReflectionDecision,
  payload: JsonObject = {},
): JsonObject {
  const risk = asText(reflection.risk_level || 'medium').trim().toLowerCase();
  const verdict = asText(reflection.verdict || '').trim().toLowerCase();
  const signature = visualFailureSignature(payload);
  const stepKey = String(stepIndex);
  const stepRepairCount = state.repairsByStep[stepKey] || 0;
  const repeatedCount = state.failureCounts[signature] || 0;
  let reason = '';
  if (!state.enabled) reason = 'self_healing_disabled';
  else if (!reflectionRequestsRetry(reflection)) reason = `reflection_${verdict || 'continue'}_does_not_request_repair`;
  else if (risk === 'high') reason = 'high_risk_requires_confirmation';
  else if (state.autoRiskPolicy === 'low_only' && risk !== 'low') reason = 'auto_risk_policy_allows_low_only';
  else if (stepRepairCount >= state.maxRepairsPerStep) reason = 'step_repair_budget_exhausted';
  else if (state.caseRepairCount >= state.maxRepairsPerCase) reason = 'case_repair_budget_exhausted';
  else if (repeatedCount >= state.repeatedFailureLimit) reason = 'repeated_failure_limit_reached';
  const allowed = !reason;
  if (!allowed) state.stoppedReason = reason;
  return {
    allowed,
    reason,
    failure_signature: signature,
    step_repair_count: stepRepairCount,
    case_repair_count: state.caseRepairCount,
    repeated_failure_count: repeatedCount,
  };
}

export function noteVisualSelfHealingRepair(state: VisualSelfHealingState, stepIndex: number, decision: JsonObject): JsonObject {
  const stepKey = String(stepIndex);
  const signature = asText(decision.failure_signature || 'visual_failure');
  state.caseRepairCount += 1;
  state.repairsByStep[stepKey] = (state.repairsByStep[stepKey] || 0) + 1;
  state.failureCounts[signature] = (state.failureCounts[signature] || 0) + 1;
  const event = {
    failure_signature: signature,
    step_index: stepIndex,
    step_repair_count: state.repairsByStep[stepKey],
    case_repair_count: state.caseRepairCount,
    repeated_failure_count: state.failureCounts[signature],
  };
  state.failureEvents.push(event);
  return event;
}

function ensureTraceDir(request: RunnerRequest): string {
  const traceDir = resolve(asText(request.trace_dir) || join(process.cwd(), 'midscene_trace'));
  mkdirSync(traceDir, { recursive: true });
  mkdirSync(join(traceDir, 'screenshots'), { recursive: true });
  return traceDir;
}

function screenshotPath(traceDir: string, stepIndex: number, extension: 'png' | 'jpg' = 'png'): string {
  return join(traceDir, 'screenshots', `step_${String(stepIndex).padStart(3, '0')}.${extension}`);
}

function artifactPath(traceDir: string, path: string): string {
  return relative(traceDir, path).replace(/\\/g, '/');
}

function isHighRiskText(...values: unknown[]): boolean {
  const haystack = values.map((value) => JSON.stringify(value ?? '')).join('\n').toLowerCase();
  return HIGH_RISK_TOKENS.some((token) => haystack.includes(token.toLowerCase()));
}

export function formatActionGoal(goal: string, testSteps: string[] = [], expectedResult = '', nonActionContext = ''): string {
  const parts = [goal.trim()].filter(Boolean);
  if (nonActionContext.trim()) {
    parts.push(nonActionContext.trim());
  }
  if (testSteps.length) {
    parts.push(`Test steps:\n${testSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  }
  if (expectedResult.trim()) {
    parts.push(`Expected result: ${expectedResult.trim()}`);
  }
  return parts.join('\n\n').trim();
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeLocator(value: unknown): JsonObject {
  if (typeof value === 'string') {
    const text = value.trim();
    return text ? { text } : {};
  }
  const raw = isRecord(value) ? value : {};
  const locator: JsonObject = {};
  for (const key of [
    'selector',
    'css',
    'xpath',
    'role',
    'name',
    'text',
    'label',
    'resource_id',
    'resourceId',
    'content_desc',
    'contentDesc',
    'accessibility_id',
    'accessibilityId',
    'text_candidates',
    'textCandidates',
    'resource_id_candidates',
    'resourceIdCandidates',
    'content_desc_candidates',
    'contentDescCandidates',
    'accessibility_id_candidates',
    'accessibilityIdCandidates',
    'normalized_point',
    'point',
    'x',
    'y',
  ]) {
    if (raw[key] !== undefined && raw[key] !== '') locator[key] = raw[key];
  }
  return locator;
}

function normalizeCodexActionName(value: unknown): string {
  const raw = asText(value).trim().toLowerCase();
  const aliases: Record<string, string> = {
    click: 'tap',
    press: 'tap',
    input: 'type',
    fill: 'type',
    enter_text: 'type',
    scroll: 'swipe',
    sleep: 'wait',
    assert: 'assert_text',
    assert_visible: 'assert_text',
    open: 'open_url',
    goto: 'open_url',
    launch: 'launch_app',
    aiact: 'aiAct',
    ai_act: 'aiAct',
  };
  return aliases[raw] || raw || 'aiAct';
}

function collectTextValues(...values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const text = asText(value).trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  };
  for (const value of values) visit(value);
  return result;
}

function cleanInferredTargetText(value: string): string {
  return value
    .trim()
    .replace(/^[\s"'`\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f\u3010\u3011]+|[\s"'`\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f\u3010\u3011]+$/g, '')
    .replace(/^(?:\u5bf9\u5e94\u7684|\u5bf9\u5e94|\u8be5|\u6b64|\u8fd9\u4e2a|\u8fd9|\u5176)/, '')
    .replace(/(?:\u6309\u94ae|\u5165\u53e3|\u9875\u9762|\u9875|\u83dc\u5355)$/i, '')
    .trim();
}

function isUsefulInferredTargetText(value: string): boolean {
  const text = value.trim();
  const ignored = new Set([
    'app',
    'APP',
    '\u9996\u9875',
    '\u9875\u9762',
    '\u5f53\u524d\u9875\u9762',
    '\u8bbe\u5907\u754c\u9762',
    '\u8bbe\u5907',
    '\u6444\u50cf\u5934',
    '\u667a\u80fd',
  ]);
  if (!text || ignored.has(text)) return false;
  if (/[\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f\u3010\u3011"'`]/.test(text)) return false;
  return true;
}

function dedupeTexts(items: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function inferCodexTargetTextsFromInstruction(value: unknown): string[] {
  const text = asText(value).trim();
  if (!text) return [];
  const candidates: string[] = [];
  const quotedPatterns = [
    /\u3010([^\u3011]{1,80})\u3011/g,
    /\u300c([^\u300d]{1,80})\u300d/g,
    /\u300e([^\u300f]{1,80})\u300f/g,
    /\u201c([^\u201d]{1,80})\u201d/g,
    /\u2018([^\u2019]{1,80})\u2019/g,
    /"([^"]{1,80})"/g,
    /'([^']{1,80})'/g,
  ];
  for (const pattern of quotedPatterns) {
    for (const match of text.matchAll(pattern)) {
      candidates.push(match[1]);
    }
  }
  const deviceObjectPatterns = [
    /(?:\u70b9\u51fb|\u70b9\u6309|\u8f7b\u89e6|\u9009\u62e9|\u6253\u5f00|\u8fdb\u5165)\s*([^\n\uff0c\u3002\uff1b;,.]{0,80}?(?:\u6444\u50cf\u5934|\u8bbe\u5907|\u7f51\u5173|\u95e8\u9501|\u4f20\u611f\u5668|\u8def\u7531\u5668|\u4e91\u7535\u8111)[A-Za-z0-9_-]*)(?:\u7684|\u6309\u94ae|\u5165\u53e3|\u9875\u9762|\u9875|\u83dc\u5355|\s|$)/g,
  ];
  for (const pattern of deviceObjectPatterns) {
    for (const match of text.matchAll(pattern)) {
      candidates.push(match[1]);
    }
  }
  const actionObjectPatterns = [
    /(?:\u70b9\u51fb|\u70b9\u6309|\u8f7b\u89e6|\u9009\u62e9|\u6253\u5f00|\u8fdb\u5165)\s*([^\n\uff0c\u3002\uff1b;,.]{1,80}?)(?:\u6309\u94ae|\u6444\u50cf\u5934|\u8bbe\u5907|\u5165\u53e3|\u9875\u9762|\u9875|\u83dc\u5355|\s|$)/g,
    /\b(?:tap|click)\s+([^\n,.;]{1,80}?)(?:\s+(?:button|camera|device|entry|page|tab|menu)|$)/gi,
  ];
  for (const pattern of actionObjectPatterns) {
    for (const match of text.matchAll(pattern)) {
      candidates.push(match[1]);
    }
  }
  return dedupeTexts(candidates.map(cleanInferredTargetText).filter(isUsefulInferredTargetText));
}

function codexIntentSuggestsTap(value: unknown): boolean {
  return /(?:\u70b9\u51fb|\u70b9\u6309|\u8f7b\u89e6|\u9009\u62e9|\u6253\u5f00|\u8fdb\u5165|\btap\b|\bclick\b|\bopen\b|\benter\b)/i.test(asText(value));
}

function hasEffectiveLocator(target: JsonObject): boolean {
  return [
    target.selector,
    target.css,
    target.xpath,
    target.role,
    target.name,
    target.text,
    target.label,
    target.resource_id,
    target.resourceId,
    target.content_desc,
    target.contentDesc,
    target.accessibility_id,
    target.accessibilityId,
    target.normalized_point,
    target.point,
    target.x,
    target.y,
  ].some((value) => {
    if (Array.isArray(value)) return value.some((item) => asText(item).trim());
    if (isRecord(value)) return Object.keys(value).length > 0;
    return asText(value).trim();
  });
}

function enrichCodexActionFromIntent(action: string, target: JsonObject, intent: string): {
  action: string;
  target: JsonObject;
  targetCandidates: string[];
  actionInferred: boolean;
  targetInferred: boolean;
} {
  const targetCandidates = inferCodexTargetTextsFromInstruction(intent);
  const hasLocator = hasEffectiveLocator(target);
  const shouldTap = codexIntentSuggestsTap(intent) && (targetCandidates.length > 0 || hasLocator);
  const normalizedAction = normalizeCodexActionName(action);
  const nextAction = shouldTap && (normalizedAction === 'aiAct' || !normalizedAction) ? 'tap' : normalizedAction;
  const nextTarget: JsonObject = { ...target };
  let targetInferred = false;
  if (!hasLocator && targetCandidates.length) {
    nextTarget.text = targetCandidates[0];
    nextTarget.text_candidates = targetCandidates;
    targetInferred = true;
  }
  return {
    action: nextAction,
    target: nextTarget,
    targetCandidates,
    actionInferred: nextAction !== normalizedAction,
    targetInferred,
  };
}

function dedupePublicList(items: unknown[]): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item === undefined || item === null || item === '') continue;
    const key = isRecord(item) || Array.isArray(item) ? JSON.stringify(item) : asText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function coerceStepAssertions(raw: JsonObject): unknown[] {
  return dedupePublicList([
    ...asList(raw.assert_after),
    ...asList(raw.post_assertions),
    ...asList(raw.assertions),
    ...asList(raw.assertion),
    ...asList(raw.expected),
    ...asList(raw.expected_result),
    ...asList(raw.expected_results),
    ...asList(raw.check),
    ...asList(raw.checks),
    ...asList(raw.validation),
    ...asList(raw.validations),
    ...asList(raw.verify),
    ...asList(raw.verifications),
  ]);
}

function normalizeCodexActionStep(raw: unknown, index: number): JsonObject {
  if (!isRecord(raw)) {
    const intent = asText(raw).trim();
    const enriched = enrichCodexActionFromIntent(intent ? 'aiAct' : 'wait', {}, intent);
    return {
      step_index: index,
      action: enriched.action,
      intent,
      target: enriched.target,
      value: '',
      assert_after: [],
      source: 'test_steps',
      allow_midscene_fallback: true,
      ...(enriched.targetCandidates.length ? { target_candidates: enriched.targetCandidates } : {}),
      ...(enriched.targetInferred ? { target_inferred_from_intent: true } : {}),
      ...(enriched.actionInferred ? { action_inferred_from_intent: true } : {}),
    };
  }
  const action = normalizeCodexActionName(firstConfiguredValue(raw.action, raw.operation, raw.type, raw.kind, raw.name));
  const intent = asText(firstConfiguredValue(raw.intent, raw.instruction, raw.description, raw.text, raw.title, raw.reason)).trim();
  const directTarget = normalizeLocator(raw);
  const nestedTarget = normalizeLocator(firstConfiguredValue(raw.preferred_locator, raw.locator, raw.target));
  const target = { ...directTarget, ...nestedTarget };
  const source = asText(raw.source || 'action_steps') || 'action_steps';
  const enriched = source === 'test_goal'
    ? {
      action,
      target,
      targetCandidates: [],
      actionInferred: false,
      targetInferred: false,
    }
    : enrichCodexActionFromIntent(action, target, intent);
  const value = asText(firstConfiguredValue(raw.value, raw.input, raw.text_value, raw.send_keys)).trim();
  return {
    step_index: Number(raw.step_index || raw.index || index) || index,
    action: enriched.action,
    intent,
    target: enriched.target,
    value,
    wait_for: raw.wait_for,
    assert_after: coerceStepAssertions(raw),
    source,
    allow_midscene_fallback: raw.allow_midscene_fallback !== false,
    ...(enriched.targetCandidates.length ? { target_candidates: enriched.targetCandidates } : {}),
    ...(enriched.targetInferred ? { target_inferred_from_intent: true } : {}),
    ...(enriched.actionInferred ? { action_inferred_from_intent: true } : {}),
  };
}

function rawCodexStepItems(slots: JsonObject): unknown[] {
  const raw = firstConfiguredValue(slots.test_steps, slots.steps, slots.procedure, slots.actions);
  if (Array.isArray(raw)) return raw;
  if (isRecord(raw)) return [raw];
  return [];
}

export function coerceCodexActionSteps(slots: JsonObject = {}): JsonObject[] {
  const explicit = firstConfiguredValue(
    slots.action_steps,
    slots.codex_action_steps,
    slots.structured_steps,
    slots.tool_steps,
  );
  const rawSteps = asList(explicit);
  if (rawSteps.length) {
    return rawSteps.map((item, index) => normalizeCodexActionStep(item, index + 1));
  }
  const rawItems = rawCodexStepItems(slots);
  if (rawItems.length) {
    return rawItems.map((item, index) => normalizeCodexActionStep(item, index + 1));
  }
  const textSteps = coerceTestSteps(slots.test_steps || slots.steps || slots.procedure || slots.actions);
  if (textSteps.length) {
    return textSteps.map((item, index) => normalizeCodexActionStep(item, index + 1));
  }
  const goal = asText(slots.test_goal).trim();
  return goal ? [normalizeCodexActionStep({ action: 'aiAct', intent: goal, source: 'test_goal' }, 1)] : [];
}

function normalizeStructuredAssertion(assertion: unknown): JsonObject {
  if (!isRecord(assertion)) {
    const text = asText(assertion).trim();
    return { kind: 'text_visible', expected: text, assertion: text, allow_midscene_fallback: true };
  }
  const kind = asText(firstConfiguredValue(assertion.kind, assertion.type, assertion.assertion_type, 'text_visible')).trim() || 'text_visible';
  const expected = asText(firstConfiguredValue(assertion.expected, assertion.value, assertion.text, assertion.contains, assertion.assertion)).trim();
  return {
    ...assertion,
    kind,
    expected,
    assertion: asText(assertion.assertion || expected),
    allow_midscene_fallback: assertion.allow_midscene_fallback === true,
  };
}

export function formatMidsceneAssertionText(assertion: unknown): string {
  if (!isRecord(assertion)) return asText(assertion).trim();
  const normalized = normalizeStructuredAssertion(assertion);
  const kind = asText(normalized.kind).toLowerCase();
  const assertionText = asText(normalized.assertion).trim();
  const expected = asText(normalized.expected).trim();
  if (assertionText && assertionText !== expected) return assertionText;
  if (!expected) return assertionText;
  if (kind === 'url_contains') return `Verify the current URL contains: ${expected}`;
  if (kind === 'activity_contains') return `Verify the current Android activity contains: ${expected}`;
  if (kind === 'log_contains') return `Verify the device log contains: ${expected}`;
  if (kind === 'visual') return expected;
  return `Verify the following text is visible: ${expected}`;
}

function describeMidsceneValue(label: string, value: unknown): string {
  if (value == null || value === '') return '';
  if (Array.isArray(value) && !value.length) return '';
  if (isRecord(value) && !Object.keys(value).length) return '';
  if (isRecord(value) || Array.isArray(value)) {
    const text = JSON.stringify(value);
    return text && text !== '{}' && text !== '[]' ? `${label}: ${text}` : '';
  }
  const text = asText(value).trim();
  return text ? `${label}: ${text}` : '';
}

type MidsceneStepInstructionContext = {
  goal?: unknown;
  expectedResult?: unknown;
  finalAssertions?: unknown[];
  stepIndex?: number;
  totalSteps?: number;
};

export function formatMidsceneStepInstruction(action: JsonObject, context: MidsceneStepInstructionContext = {}): string {
  const intent = asText(firstConfiguredValue(action.intent, action.instruction, action.description, action.reason, action.text, action.title)).trim();
  const lines = [intent].filter(Boolean);
  const actionName = asText(action.action).trim();
  if (actionName && actionName !== 'aiAct') lines.push(`Action: ${actionName}`);
  const targetLine = describeMidsceneValue('Target', action.target);
  if (targetLine) lines.push(targetLine);
  const valueLine = describeMidsceneValue('Value', action.value);
  if (valueLine) lines.push(valueLine);
  const waitLine = describeMidsceneValue('Wait for', action.wait_for);
  if (waitLine) lines.push(waitLine);
  const stepInstruction = lines.join('\n').trim() || 'Continue the UI test step.';
  const goal = asText(context.goal).trim();
  const expectedResult = asText(context.expectedResult).trim();
  const finalAssertions = asList(context.finalAssertions).map(formatMidsceneAssertionText).map((item) => item.trim()).filter(Boolean);
  if (!goal && !expectedResult && !finalAssertions.length && !context.stepIndex && !context.totalSteps) {
    return stepInstruction;
  }
  const blocks: string[] = [];
  if (goal) blocks.push(`Overall test goal:\n${goal}`);
  const stepLabel = context.stepIndex && context.totalSteps
    ? `Current step ${context.stepIndex}/${context.totalSteps}`
    : 'Current step';
  blocks.push(`${stepLabel}:\n${stepInstruction}`);
  if (expectedResult) blocks.push(`Expected result:\n${expectedResult}`);
  if (finalAssertions.length) {
    blocks.push(`Final success criteria:\n${finalAssertions.map((item) => `- ${item}`).join('\n')}`);
  }
  return blocks.join('\n\n').trim();
}

function isMeaningfulMidsceneActionStep(action: JsonObject): boolean {
  const intent = asText(firstConfiguredValue(action.intent, action.instruction, action.description, action.reason, action.text, action.title)).trim();
  if (intent) return true;
  if (describeMidsceneValue('Target', action.target)) return true;
  if (describeMidsceneValue('Value', action.value)) return true;
  if (describeMidsceneValue('Wait for', action.wait_for)) return true;
  return ['back', 'wait', 'swipe'].includes(normalizeCodexActionName(action.action));
}

function normalizeMidsceneActionSteps(items: unknown[]): JsonObject[] {
  return items
    .map((item, index) => normalizeCodexActionStep(item, index + 1))
    .filter(isMeaningfulMidsceneActionStep);
}

function explicitMidsceneActionStepItems(slots: JsonObject = {}): unknown[] {
  return asList(firstConfiguredValue(
    slots.action_steps,
    slots.codex_action_steps,
    slots.structured_steps,
  ));
}

function orphanAssertionsFromInvalidMidsceneSteps(slots: JsonObject = {}): string[] {
  return explicitMidsceneActionStepItems(slots)
    .map((item, index) => normalizeCodexActionStep(item, index + 1))
    .filter((item) => !isMeaningfulMidsceneActionStep(item))
    .flatMap((item) => asList(item.assert_after))
    .map(formatMidsceneAssertionText)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function coerceMidsceneStructuredActionSteps(slots: JsonObject = {}): JsonObject[] {
  const explicitSteps = normalizeMidsceneActionSteps(explicitMidsceneActionStepItems(slots));
  if (explicitSteps.length) return explicitSteps;
  const rawItems = normalizeMidsceneActionSteps(rawCodexStepItems(slots));
  if (rawItems.length) return rawItems;
  const textSteps = coerceTestSteps(slots.test_steps || slots.steps || slots.procedure || slots.actions);
  if (textSteps.length) return normalizeMidsceneActionSteps(textSteps);
  return [];
}

export function coerceMidsceneFinalAssertions(slots: JsonObject = {}): string[] {
  const items = [
    ...asList(slots.final_assertions),
    ...asList(slots.final_checks),
    ...asList(slots.final_validations),
    ...asList(slots.structured_assertions),
    ...asList(slots.assertions),
  ];
  return items.map(formatMidsceneAssertionText).map((item) => item.trim()).filter(Boolean);
}

export function prepareMidsceneAiDispatch(slots: JsonObject = {}) {
  const actionSteps = coerceMidsceneStructuredActionSteps(slots);
  const finalAssertions = dedupeTexts([
    ...orphanAssertionsFromInvalidMidsceneSteps(slots),
    ...(actionSteps.length
      ? coerceMidsceneFinalAssertions(slots)
      : asList(slots.assertions).map(asText).map((item) => item.trim()).filter(Boolean)),
  ]);
  const goal = asText(slots.test_goal).trim();
  const testSteps = coerceTestSteps(slots.test_steps || slots.steps || slots.procedure || slots.actions);
  const expectedResult = asText(firstConfiguredValue(slots.expected_result, slots.expected)).trim();
  const dispatchStrategy = actionSteps.length ? 'midscene_ai_structured' : 'midscene_ai_single_goal';
  return {
    actionSteps,
    finalAssertions,
    goal,
    testSteps,
    expectedResult,
    dispatchStrategy,
    eventPayload: {
      execution_mode: 'midscene_ai',
      dispatch_strategy: dispatchStrategy,
      action_step_count: actionSteps.length,
      assertion_count: finalAssertions.length,
      test_goal_summary: clipText(goal, 500),
      test_steps_count: testSteps.length,
      expected_result_summary: clipText(expectedResult, 500),
      action_summaries: actionSteps.slice(0, 20).map((action, index) => ({
        step_index: Number(action.step_index || index + 1) || index + 1,
        action: asText(action.action || 'aiAct'),
        source: asText(action.source || ''),
        instruction: clipText(formatMidsceneStepInstruction(action), 500),
      })),
      assertion_summaries: finalAssertions.slice(0, 20).map((assertion) => clipText(assertion, 500)),
    },
  };
}

function actionStepsHaveAssertions(actionSteps: JsonObject[] = []): boolean {
  return actionSteps.some((action) => asList(action.assert_after).some((item) => item !== ''));
}

export function coerceFinalAssertions(slots: JsonObject = {}, actionSteps: JsonObject[] = []): JsonObject[] {
  const hasStepAssertions = actionStepsHaveAssertions(actionSteps);
  const items = [
    ...asList(slots.final_assertions),
    ...asList(slots.final_checks),
    ...asList(slots.final_validations),
    ...asList(slots.structured_assertions),
    ...(hasStepAssertions ? [] : asList(slots.assertions)),
  ];
  return items.map(normalizeStructuredAssertion).filter((item) => asText(item.expected || item.assertion).trim());
}

export function evaluateCodexAssertion(assertion: unknown, observation: JsonObject): JsonObject {
  const normalized = normalizeStructuredAssertion(assertion);
  const kind = asText(normalized.kind).toLowerCase();
  const expected = asText(normalized.expected || normalized.assertion).trim();
  const haystack = [
    asText(observation.visible_text),
    asText(observation.ui_tree),
    asText(observation.current_ref),
    asText(observation.logcat_summary),
  ].join('\n');
  let success = false;
  let evidence = '';
  if (!expected) {
    success = true;
    evidence = 'empty assertion';
  } else if (kind === 'url_contains') {
    success = asText(observation.current_ref).includes(expected);
    evidence = asText(observation.current_ref);
  } else if (kind === 'activity_contains') {
    success = asText(observation.current_ref).includes(expected);
    evidence = asText(observation.current_ref);
  } else if (kind === 'log_contains') {
    success = asText(observation.logcat_summary).includes(expected);
    evidence = asText(observation.logcat_summary).slice(0, 400);
  } else {
    success = haystack.includes(expected);
    evidence = success ? expected : haystack.slice(0, 400);
  }
  return {
    ...normalized,
    success,
    message: success ? `deterministic assertion passed: ${expected}` : `deterministic assertion failed: ${expected}`,
    evidence,
    assertion_source: 'codex_guided_deterministic',
  };
}

function targetTextCandidatesFromAction(action: JsonObject): string[] {
  const target = normalizeLocator(action.target);
  return dedupeTexts(collectTextValues(
    action.target_candidates,
    target.text,
    target.label,
    target.name,
    target.text_candidates,
    target.textCandidates,
    target.content_desc,
    target.contentDesc,
    target.accessibility_id,
    target.accessibilityId,
    target.content_desc_candidates,
    target.contentDescCandidates,
    target.accessibility_id_candidates,
    target.accessibilityIdCandidates,
  ));
}

function normalizeComparableText(value: unknown): string {
  return asText(value)
    .replace(/[\s"'`\u2018\u2019\u201c\u201d\u300c\u300d\u300e\u300f\u3010\u3011]+/g, '')
    .toLowerCase();
}

function observationContainsComparableText(observation: JsonObject, expected: string): boolean {
  const haystack = [
    asText(observation.visible_text),
    asText(observation.ui_tree),
    asText(observation.current_ref),
    asText(observation.logcat_summary),
  ].join('\n');
  const expectedNorm = normalizeComparableText(expected);
  return Boolean(expectedNorm && normalizeComparableText(haystack).includes(expectedNorm));
}

export function isWeakAlreadyVisibleStepAssertion(assertion: unknown, action: JsonObject, preObservation: JsonObject): boolean {
  const normalized = normalizeStructuredAssertion(assertion);
  const expected = asText(normalized.expected || normalized.assertion).trim();
  const targetTexts = targetTextCandidatesFromAction(action);
  if (!expected || !targetTexts.length) return false;
  const expectedNorm = normalizeComparableText(expected);
  const matchesTarget = targetTexts.some((targetText) => {
    const targetNorm = normalizeComparableText(targetText);
    return Boolean(targetNorm && expectedNorm && (targetNorm === expectedNorm || targetNorm.includes(expectedNorm) || expectedNorm.includes(targetNorm)));
  });
  if (!matchesTarget) return false;
  const local = evaluateCodexAssertion(normalized, preObservation);
  if (local.success) return true;
  return observationContainsComparableText(preObservation, expected)
    || targetTexts.some((targetText) => observationContainsComparableText(preObservation, targetText));
}

export function formatCodexFallbackInstruction(action: JsonObject, request: RunnerRequest): string {
  const slots = request.slots || {};
  const testSteps = coerceTestSteps(slots.test_steps || slots.steps || slots.procedure || slots.actions);
  const goal = asText(slots.test_goal).trim();
  const expectedResult = asText(firstConfiguredValue(slots.expected_result, slots.expected)).trim();
  const stepIndex = Number(action.step_index || 0) || undefined;
  const totalSteps = testSteps.length || undefined;
  const blocks = [
    formatMidsceneStepInstruction(action, {
      goal,
      expectedResult,
      stepIndex,
      totalSteps,
    }),
  ].filter(Boolean);
  const nonActionContext = formatNonActionExecutionContext(slots);
  if (nonActionContext) {
    blocks.push(nonActionContext);
  }
  if (testSteps.length) {
    blocks.push(`Full test steps:\n${testSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`);
  }
  const targetCandidates = targetTextCandidatesFromAction(action);
  if (targetCandidates.length) {
    blocks.push(`Target candidates:\n${targetCandidates.map((item) => `- ${item}`).join('\n')}`);
  }
  blocks.push([
    'Execution constraints:',
    '- Execute the current UI action now.',
    '- Do not only observe or describe the screen.',
    '- If this action is a tap, click, open, or enter step, tap the best matching target candidate.',
    '- Do not run the final assertion until after the current action completes.',
  ].join('\n'));
  return blocks.join('\n\n').trim();
}

async function waitIfPaused(request: RunnerRequest): Promise<void> {
  const controlFile = asText(request.control_file);
  if (!controlFile) return;
  while (existsSync(controlFile)) {
    let command = '';
    try {
      const payload = JSON.parse(readFileSync(controlFile, 'utf8'));
      command = asText(payload.command).toLowerCase();
    } catch {
      return;
    }
    if (command === 'cancel') {
      throw new Error('cancelled by visual control');
    }
    if (command !== 'pause') return;
    emitEvent('visual_paused', { message: 'Midscene job paused' });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
}

function buildAIContext(request: RunnerRequest): string {
  const slots = request.slots || {};
  const lines = [
    'You are running inside OpenClaude App Test.',
    'Follow the user test goal, but do not execute high-risk operations such as payments, purchases, deleting data, transfers, or production submissions.',
    'If a high-risk operation is required, stop before performing it.',
  ];
  const nonActionContext = formatNonActionExecutionContext(slots);
  if (nonActionContext) lines.push(nonActionContext);
  const accountAlias = asText(slots.account_alias).trim();
  if (accountAlias) lines.push(`Use account alias only for context: ${accountAlias}. Do not reveal or request secrets.`);
  const assetContext = request.asset_context || {};
  if (Object.keys(assetContext).length) {
    lines.push(`Approved toolbox context: ${JSON.stringify(assetContext)}`);
  }
  return lines.join('\n');
}

function formatNonActionExecutionContext(slots: JsonObject = {}): string {
  const blocks: string[] = [];
  const skillContext = asText(slots.workspace_skill_guidance_context).trim();
  if (skillContext) {
    blocks.push(`Workspace Skill contract context (not an executable UI step):\n${skillContext}`);
  }
  const navigationContext = asText(slots.visual_navigation_context).trim();
  if (navigationContext) {
    blocks.push(`Mission navigation memory (not an executable UI step):\n${navigationContext}`);
  }
  const routeReuse = slots.route_reuse && typeof slots.route_reuse === 'object' && !Array.isArray(slots.route_reuse)
    ? slots.route_reuse as JsonObject
    : {};
  if (Object.keys(routeReuse).length) {
    blocks.push(`Route reuse policy:\n${JSON.stringify(routeReuse)}`);
  }
  const currentPageReuse = slots.current_page_reuse && typeof slots.current_page_reuse === 'object' && !Array.isArray(slots.current_page_reuse)
    ? slots.current_page_reuse as JsonObject
    : {};
  if (Object.keys(currentPageReuse).length) {
    blocks.push(`Current page reuse policy:\n${JSON.stringify(currentPageReuse)}`);
  }
  if (!blocks.length) return '';
  return [
    'Use the following context to decide whether repeated navigation can be skipped after observing the current page.',
    'Do not treat these context lines as UI actions or assertions.',
    ...blocks,
  ].join('\n\n');
}

function writeTrace(traceDir: string, payload: JsonObject): string {
  const tracePath = join(traceDir, 'trace.json');
  writeFileSync(tracePath, JSON.stringify(payload, null, 2), 'utf8');
  return tracePath;
}

type ReportWriteResult = {
  path: string;
  truncated: boolean;
  originalSizeBytes: number;
  writtenSizeBytes: number;
  screenshotCount: number;
  error?: string;
};

const DEFAULT_REPORT_MAX_BYTES = 50 * 1024 * 1024;

function resolveReportMaxBytes(): number {
  const parsed = Number(process.env.MIDSCENE_REPORT_MAX_BYTES || '');
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPORT_MAX_BYTES;
  return Math.max(1024 * 1024, Math.trunc(parsed));
}

function lightweightReportHtml(title: string, body: JsonObject): string {
  const escapedTitle = title.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch] || ch));
  const escapedBody = JSON.stringify(body, null, 2)
    .replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));
  return [
    '<!doctype html>',
    '<html><head><meta charset="UTF-8"><title>',
    escapedTitle,
    '</title></head><body>',
    '<h1>',
    escapedTitle,
    '</h1><pre>',
    escapedBody,
    '</pre></body></html>',
  ].join('');
}

export function writeReport(traceDir: string, html: string, metadata: JsonObject = {}): ReportWriteResult {
  const reportPath = join(traceDir, 'midscene_report.html');
  const maxBytes = resolveReportMaxBytes();
  const originalSizeBytes = Buffer.byteLength(html, 'utf8');
  const screenshotCount = Number(metadata.screenshot_count || metadata.screenshotCount || 0) || 0;
  let nextHtml = html;
  let truncated = false;
  if (originalSizeBytes > maxBytes) {
    truncated = true;
    nextHtml = lightweightReportHtml('Midscene Report (truncated)', {
      reason: 'report_exceeded_size_limit',
      max_bytes: maxBytes,
      original_size_bytes: originalSizeBytes,
      screenshot_count: screenshotCount,
      trace_file: 'trace.json',
      screenshots_dir: 'screenshots/',
    });
  }
  writeFileSync(reportPath, nextHtml, 'utf8');
  return {
    path: reportPath,
    truncated,
    originalSizeBytes,
    writtenSizeBytes: Buffer.byteLength(nextHtml, 'utf8'),
    screenshotCount,
  };
}

function writeReportSafely(traceDir: string, render: () => string, metadata: JsonObject = {}): ReportWriteResult {
  emitEvent('visual_report_generation_started', {
    screenshot_count: metadata.screenshot_count || metadata.screenshotCount || 0,
    report_max_bytes: resolveReportMaxBytes(),
  });
  try {
    const report = writeReport(traceDir, render(), metadata);
    if (report.truncated) {
      emitEvent('visual_report_generation_skipped', {
        reason: 'report_exceeded_size_limit',
        original_size_bytes: report.originalSizeBytes,
        written_size_bytes: report.writtenSizeBytes,
        screenshot_count: report.screenshotCount,
        report_path: artifactPath(traceDir, report.path),
      });
    }
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = writeReport(
      traceDir,
      lightweightReportHtml('Midscene Report (generation failed)', {
        reason: 'report_generation_failed',
        error: message,
        trace_file: 'trace.json',
        screenshots_dir: 'screenshots/',
        screenshot_count: metadata.screenshot_count || metadata.screenshotCount || 0,
      }),
      metadata,
    );
    emitEvent('visual_report_generation_skipped', {
      reason: 'report_generation_failed',
      error: message,
      written_size_bytes: fallback.writtenSizeBytes,
      screenshot_count: fallback.screenshotCount,
      report_path: artifactPath(traceDir, fallback.path),
    });
    return { ...fallback, truncated: true, error: message };
  }
}

function readGeneratedReportFile(agent: any): string {
  const reportFile = asText(agent?.reportFile).trim();
  if (!reportFile || !existsSync(reportFile)) return '';
  return readFileSync(reportFile, 'utf8');
}

export function renderReport(agent: any): string {
  if (typeof agent?.reportHTMLString === 'function') {
    try {
      const html = asText(agent.reportHTMLString({ inlineScreenshots: true }));
      if (html.trim()) return html;
    } catch {
      const generatedHtml = readGeneratedReportFile(agent);
      if (generatedHtml.trim()) return generatedHtml;
    }
    try {
      const html = asText(agent.reportHTMLString({ inlineScreenshots: false }));
      if (html.trim()) return html;
    } catch {
      // fall through to the generated report file or minimal fallback below
    }
  }
  const generatedHtml = readGeneratedReportFile(agent);
  if (generatedHtml.trim()) return generatedHtml;
  return '<!doctype html><title>Midscene Report</title><h1>Midscene Report</h1>';
}

function imageInfoFromBuffer(buffer: Buffer): Pick<ParsedScreenshot, 'mime' | 'extension'> | null {
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  return null;
}

function normalizeBase64Body(body: string): string {
  const normalized = body.replace(/\s+/g, '');
  if (!normalized) throw new Error('screenshot base64 payload is empty');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('screenshot base64 payload contains invalid characters');
  }
  return normalized;
}

function screenshotValueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const item = value as JsonObject;
    for (const key of ['base64', 'rawBase64', 'data', 'url']) {
      if (typeof item[key] === 'string') return item[key] as string;
    }
  }
  return asText(value);
}

export function parseMidsceneScreenshot(value: unknown): ParsedScreenshot {
  const raw = screenshotValueToText(value).trim();
  if (!raw) throw new Error('screenshot payload is empty');

  let declaredMime = '';
  let body = raw;
  const dataUrl = raw.match(/^data:(image\/(?:png|jpe?g));base64,([\s\S]+)$/i);
  if (dataUrl) {
    declaredMime = dataUrl[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataUrl[1].toLowerCase();
    body = dataUrl[2];
  } else if (/^data:/i.test(raw)) {
    throw new Error('unsupported screenshot data URL mime type');
  }

  const buffer = Buffer.from(normalizeBase64Body(body), 'base64');
  if (buffer.length < MIN_SCREENSHOT_BYTES) {
    throw new Error(`screenshot buffer too small: ${buffer.length} bytes`);
  }

  const detected = imageInfoFromBuffer(buffer);
  if (!detected) {
    throw new Error('screenshot buffer is not a valid PNG or JPEG image');
  }
  if (declaredMime && declaredMime !== detected.mime) {
    throw new Error(`screenshot mime mismatch: declared ${declaredMime}, detected ${detected.mime}`);
  }
  return { buffer, ...detected };
}

function parseAdbScreenshot(buffer: Buffer): ParsedScreenshot {
  const candidates = [
    buffer,
    Buffer.from(buffer.toString('binary').replace(/\r\n/g, '\n'), 'binary'),
  ];
  for (const candidate of candidates) {
    if (candidate.length < MIN_SCREENSHOT_BYTES) continue;
    const detected = imageInfoFromBuffer(candidate);
    if (detected) return { buffer: candidate, ...detected };
  }
  throw new Error(`ADB screencap returned invalid image data (${buffer.length} bytes)`);
}

function adbScreenshot(deviceId: string): ParsedScreenshot {
  const adbPath = process.env.ADB_PATH || 'adb';
  const args = [
    ...(deviceId ? ['-s', deviceId] : []),
    'exec-out',
    'screencap',
    '-p',
  ];
  const buffer = execFileSync(adbPath, args, {
    timeout: 8000,
    maxBuffer: 25 * 1024 * 1024,
    ...hiddenChildProcessOptions(),
  });
  return parseAdbScreenshot(buffer);
}

export function writeAndroidScreenshot(
  traceDir: string,
  stepIndex: number,
  rawScreenshot: unknown,
  deviceId: string,
): ScreenshotWriteResult {
  const errors: string[] = [];
  try {
    const parsed = parseMidsceneScreenshot(rawScreenshot);
    const shot = screenshotPath(traceDir, stepIndex, parsed.extension);
    writeFileSync(shot, parsed.buffer);
    return { ...parsed, path: shot, source: 'midscene_android' };
  } catch (error) {
    errors.push(`Midscene screenshot parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (deviceId) {
    try {
      const parsed = adbScreenshot(deviceId);
      const shot = screenshotPath(traceDir, stepIndex, parsed.extension);
      writeFileSync(shot, parsed.buffer);
      return { ...parsed, path: shot, source: 'adb_exec_out', error: errors.join('; ') };
    } catch (error) {
      errors.push(`ADB fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const shot = screenshotPath(traceDir, stepIndex, 'png');
  writeFileSync(shot, PLACEHOLDER_PNG);
  return {
    buffer: PLACEHOLDER_PNG,
    mime: 'image/png',
    extension: 'png',
    path: shot,
    source: 'placeholder',
    error: errors.join('; '),
  };
}

function safePublicValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return undefined;
  if (depth > 4) return '[truncated]';
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => safePublicValue(item, depth + 1, seen));
    }
    const out: JsonObject = {};
    for (const [key, val] of Object.entries(value as JsonObject).slice(0, 80)) {
      if (typeof val === 'function') continue;
      out[key] = safePublicValue(val, depth + 1, seen);
    }
    return out;
  }
  return String(value);
}

function normalizeMcpTools(rawTools: unknown): InternalMcpTool[] {
  const items: unknown[] = Array.isArray(rawTools)
    ? rawTools
    : rawTools && typeof rawTools === 'object'
      ? Object.entries(rawTools as Record<string, unknown>).map(([name, value]) => ({ name, ...(value as JsonObject) }))
      : [];
  return items
    .map((raw) => {
      const item = raw && typeof raw === 'object' ? raw as JsonObject : {};
      const name = asText(item.name || item.toolName || item.id).trim();
      if (!name) return null;
      const call = item.call || item.handler || item.execute || item.run || item.func;
      return {
        name,
        description: asText(item.description || item.title),
        schema: item.inputSchema || item.input_schema || item.schema || item.parameters || {},
        call: typeof call === 'function' ? call.bind(raw) : undefined,
      };
    })
    .filter(Boolean) as InternalMcpTool[];
}

function publicMcpTools(tools: InternalMcpTool[]): JsonObject[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: safePublicValue(tool.schema),
  }));
}

async function setupMcpKit(request: RunnerRequest, agent: any): Promise<{ description: string; tools: InternalMcpTool[] }> {
  const platform = request.platform === 'web' ? 'web' : 'android';
  const mod = platform === 'web'
    ? await import('@midscene/web/mcp-server')
    : await import('@midscene/android/mcp-server');
  const factory = (mod as any).mcpKitForAgent;
  if (typeof factory !== 'function') {
    throw new Error(`mcpKitForAgent is not exported for ${platform}`);
  }
  const kit = await factory(agent);
  return {
    description: asText(kit?.description || kit?.name || `Midscene ${platform} MCP tools`),
    tools: normalizeMcpTools(kit?.tools),
  };
}

async function callMcpTool(tools: InternalMcpTool[], name: string, args: JsonObject): Promise<unknown> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`unknown Midscene MCP tool: ${name}`);
  if (typeof tool.call !== 'function') throw new Error(`Midscene MCP tool is not callable: ${name}`);
  return await tool.call(args);
}

async function runMock(request: RunnerRequest, yamlMode = false, mcpMode = false, codexMode = false): Promise<void> {
  const traceDir = ensureTraceDir(request);
  const slots = request.slots || {};
  const shot = screenshotPath(traceDir, 1);
  writeFileSync(shot, PLACEHOLDER_PNG);
  const visibleText = asText((asList(slots.mock_observations)[0] as JsonObject | undefined)?.visible_text) || 'mock Midscene screen';
  const observation = {
    step_index: 1,
    platform: asText(request.platform || slots.platform || 'mock'),
    screenshot_artifact_path: artifactPath(traceDir, shot),
    ui_tree: visibleText,
    visible_text: visibleText,
    screen_size: { width: 1, height: 1 },
    current_ref: asText(slots.start_url || slots.app_package || 'mock://midscene'),
    summary: visibleText.slice(0, 160),
  };
  const mcpTools = mcpMode ? [
    { name: 'mock_tap', description: 'Mock Midscene MCP tap/action tool', schema: { type: 'object' } },
    { name: 'mock_assert', description: 'Mock Midscene MCP assertion helper', schema: { type: 'object' } },
  ] : [];
  if (mcpTools.length) {
    (observation as JsonObject).mcp_tools_available = mcpTools;
  }
  emitEvent('visual_observed', observation);

  const assertion = asText(asList(slots.assertions)[0] || '');
  const action = yamlMode
    ? { action: 'run_yaml', reason: 'mock YAML execution', risk_level: 'low' }
    : mcpMode
      ? { action: 'mcp_tool', reason: asText(slots.test_goal || 'mock Midscene MCP action'), risk_level: 'low', mcp_tool_name: 'mock_tap', mcp_arguments: { mock: true } }
      : codexMode
        ? { action: 'codex_guided', reason: asText(slots.test_goal || 'mock Codex guided action'), risk_level: 'low', execution_strategy: 'codex_guided' }
        : { action: 'aiAct', reason: asText(slots.test_goal || 'mock Midscene action'), risk_level: 'low' };
  emitEvent('visual_action_planned', { step_index: 1, action });
  emitEvent('visual_action_executed', {
    step_index: 1,
    action: action.action,
    success: true,
    message: action.reason,
    mcp_tool_name: (action as JsonObject).mcp_tool_name,
    mcp_arguments: (action as JsonObject).mcp_arguments,
    mcp_result: mcpMode ? { mock: true } : undefined,
  });
  let assertionFailure = '';
  if (assertion) {
    const pass = visibleText.includes(assertion);
    emitEvent('visual_assertion_result', {
      step_index: 1,
      assertion,
      success: pass,
      message: pass ? `assertion passed: ${assertion}` : `assertion failed: ${assertion}`,
    });
    if (!pass) assertionFailure = `assertion failed: ${assertion}`;
  }
  const report = writeReport(traceDir, '<!doctype html><title>Mock Midscene Report</title><h1>Mock Midscene Report</h1>');
  const tracePath = writeTrace(traceDir, {
    success: !assertionFailure,
    mode: yamlMode ? 'yaml' : 'test',
    execution_mode: codexMode ? 'codex_guided' : mcpMode ? 'mcp_tool_loop' : 'midscene_ai',
    steps: [{ step_index: 1, observation, action, result: { success: !assertionFailure, message: assertionFailure || action.reason } }],
    yaml_result: yamlMode ? { mock: true } : undefined,
    mcp_tools_available: mcpTools.length ? mcpTools : undefined,
    midscene_report: artifactPath(traceDir, report.path),
  });
  emitEvent('visual_trace_saved', {
    visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
    visual_trace: artifactPath(traceDir, tracePath),
    screenshots: [{ step_index: 1, artifact_path: observation.screenshot_artifact_path }],
    step_count: 1,
    midscene_report: artifactPath(traceDir, report.path),
    yaml_result: yamlMode ? { mock: true } : undefined,
    mcp_tools_available: mcpTools.length ? mcpTools : undefined,
  });
  emit({
    type: 'result',
    success: !assertionFailure,
    message: assertionFailure || (yamlMode ? 'mock Midscene YAML completed' : 'mock Midscene test completed'),
    midscene_report: artifactPath(traceDir, report.path),
    yaml_result: yamlMode ? { mock: true } : undefined,
    mcp_tools_available: mcpTools.length ? mcpTools : undefined,
  });
}

async function observeWeb(agent: any, page: any, traceDir: string, stepIndex: number): Promise<JsonObject> {
  const shot = screenshotPath(traceDir, stepIndex);
  await page.screenshot({ path: shot, fullPage: false });
  const visibleText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  let uiTree = '';
  try {
    uiTree = JSON.stringify(await page.accessibility.snapshot({ interestingOnly: false }));
  } catch {
    uiTree = await page.content().catch(() => '');
  }
  return {
    step_index: stepIndex,
    platform: 'web',
    screenshot_artifact_path: artifactPath(traceDir, shot),
    ui_tree: asText(uiTree).slice(0, 12000),
    visible_text: asText(visibleText).slice(0, 8000),
    screen_size: page.viewportSize?.() || { width: 1280, height: 800 },
    current_ref: page.url(),
    summary: asText(visibleText).slice(0, 160),
  };
}

async function observeAndroid(agent: any, traceDir: string, stepIndex: number, deviceId: string): Promise<JsonObject> {
  let shotResult: ScreenshotWriteResult;
  try {
    const screenshot = await agent.page.screenshotBase64();
    shotResult = writeAndroidScreenshot(traceDir, stepIndex, screenshot, deviceId);
    if (shotResult.error) {
      emit({ type: 'log', message: shotResult.error });
    }
  } catch (error) {
    const message = `Midscene screenshot call failed: ${error instanceof Error ? error.message : String(error)}`;
    shotResult = writeAndroidScreenshot(traceDir, stepIndex, '', deviceId);
    shotResult.error = shotResult.error ? `${message}; ${shotResult.error}` : message;
    emit({ type: 'log', message: shotResult.error });
  }
  let currentRef = '';
  try {
    currentRef = await agent.page.url();
  } catch {
    currentRef = 'android://device';
  }
  let tree = '';
  try {
    tree = JSON.stringify(await agent.page.getElementsNodeTree());
  } catch {
    tree = '';
  }
  if (isEmptyAndroidUiTree(tree)) {
    tree = chooseAndroidUiTree(tree, dumpAndroidUiTree(deviceId));
  }
  const visibleText = androidVisibleTextFromTree(tree);
  const currentActivity = currentAndroidActivity(deviceId);
  const effectiveCurrentRef = currentActivity || currentRef;
  const foregroundWarning = androidForegroundWarning(effectiveCurrentRef);
  return {
    step_index: stepIndex,
    platform: 'android',
    screenshot_artifact_path: artifactPath(traceDir, shotResult.path),
    screenshot_source: shotResult.source,
    screenshot_mime: shotResult.mime,
    screenshot_bytes: shotResult.buffer.length,
    screenshot_error: shotResult.error || undefined,
    ui_tree: tree.slice(0, 12000),
    visible_text: visibleText.slice(0, 8000),
    screen_size: androidScreenSize(deviceId),
    current_ref: effectiveCurrentRef,
    foreground_warning: foregroundWarning || undefined,
    logcat_summary: androidLogcatSummary(deviceId),
    summary: (visibleText || tree).slice(0, 160),
  };
}

function adbArgs(deviceId: string, args: string[]): string[] {
  return [...(deviceId ? ['-s', deviceId] : []), ...args];
}

function adbText(deviceId: string, args: string[], timeout = 10000): string {
  const adbPath = process.env.ADB_PATH || 'adb';
  try {
    const output = execFileSync(adbPath, adbArgs(deviceId, args), {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      ...hiddenChildProcessOptions(),
    });
    return output.toString('utf8');
  } catch {
    return '';
  }
}

function adbTextStrict(deviceId: string, args: string[], timeout = 10000): string {
  const adbPath = process.env.ADB_PATH || 'adb';
  const output = execFileSync(adbPath, adbArgs(deviceId, args), {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    ...hiddenChildProcessOptions(),
  });
  return output.toString('utf8');
}

export function parseAndroidScreenSize(value: string): AndroidScreenSize {
  let physical: AndroidScreenSize | null = null;
  let override: AndroidScreenSize | null = null;
  const matches = asText(value).matchAll(/\b(Physical|Override)\s+size:\s*(\d+)x(\d+)/gi);
  for (const match of matches) {
    const width = Number(match[2]);
    const height = Number(match[3]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
      continue;
    }
    const size = { width: Math.trunc(width), height: Math.trunc(height) };
    if (match[1].toLowerCase() === 'override') {
      override = size;
    } else {
      physical = size;
    }
  }
  return override || physical || { ...FALLBACK_ANDROID_SCREEN_SIZE };
}

function androidScreenSize(deviceId: string): AndroidScreenSize {
  return parseAndroidScreenSize(adbText(deviceId, ['shell', 'wm', 'size'], 10000));
}

type AndroidLaunchResetOptions = {
  adbText?: (deviceId: string, args: string[], timeout?: number) => string;
  emitEvent?: (eventType: string, payload: JsonObject) => void;
};

export async function launchAndroidAppWithOptionalReset(
  agent: any,
  deviceId: string,
  appPackage: string,
  slots: JsonObject = {},
  options: AndroidLaunchResetOptions = {},
): Promise<void> {
  const packageName = asText(appPackage).trim();
  if (!packageName) return;
  if (shouldForceStopBeforeLaunch(slots)) {
    const runAdb = options.adbText || adbTextStrict;
    runAdb(deviceId, ['shell', 'am', 'force-stop', packageName], 20000);
    const emitLaunchEvent = options.emitEvent || emitEvent;
    emitLaunchEvent('android_app_force_stopped', {
      app_package: packageName,
      device_id: deviceId,
      force_stop_before_launch: true,
    });
  }
  await agent.launch(packageName);
}

function dumpAndroidUiTree(deviceId: string): string {
  const text = adbText(deviceId, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], 15000);
  const idx = text.indexOf('<?xml');
  return idx >= 0 ? text.slice(idx) : text;
}

function currentAndroidActivity(deviceId: string): string {
  const text = adbText(deviceId, ['shell', 'dumpsys', 'window', 'windows'], 10000);
  const currentFocus = text.match(/mCurrentFocus=.*?\s([^\s}]+)\}/);
  if (currentFocus?.[1]) return currentFocus[1];
  const focusedActivity = text.match(/mFocusedApp=.*?\s([A-Za-z0-9_.]+\/[^\s}]+)/);
  return focusedActivity?.[1] || '';
}

function androidForegroundWarning(currentRef: string): string {
  const normalized = asText(currentRef).toLowerCase();
  if (!normalized) return '';
  if (/statusbar|keyguard|launcher|resolveractivity|grantpermissions|permissioncontroller|packageinstaller/.test(normalized)) {
    return 'Android device focus appears to be on a system surface; unlock the device and bring the target app to the foreground.';
  }
  if (/com\.android\.settings|settings\//.test(normalized)) {
    return 'Android device focus appears to be on Settings; bring the target app to the foreground before running visual steps.';
  }
  return '';
}

function androidLogcatSummary(deviceId: string): string {
  return adbText(deviceId, ['logcat', '-d', '-t', '80'], 10000).slice(-4000);
}

export function androidInputText(value: string): string {
  return value
    .replace(/\s+/g, '%s')
    .replace(/([\\'"`$&|<>;(){}\[\]*?!#~])/g, '\\$1');
}

type AndroidUiNode = {
  raw: string;
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  bounds: string;
  rect: AndroidRect | null;
  point: [number, number] | null;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  password: boolean;
};

function parseAndroidBounds(value: string): [number, number] | null {
  const match = value.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return [Math.trunc((left + right) / 2), Math.trunc((top + bottom) / 2)];
}

function parseAndroidBoundsRect(value: string): AndroidRect | null {
  const match = value.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return {
    left: Math.trunc(left),
    top: Math.trunc(top),
    width: Math.trunc(right - left),
    height: Math.trunc(bottom - top),
  };
}

function decodeAndroidXmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function androidNodeAttr(node: string, attr: string): string {
  const match = node.match(new RegExp(`${attr}="([^"]*)"`));
  return match ? decodeAndroidXmlAttr(match[1]) : '';
}

export function isEmptyAndroidUiTree(value: string): boolean {
  const text = asText(value).trim();
  if (!text) return true;
  const compact = text.replace(/\s+/g, '');
  if (['{}', '[]', 'null', 'undefined', '{"node":null,"children":[]}', '{"children":[],"node":null}'].includes(compact)) {
    return true;
  }
  if (/^<\?xml/i.test(text) || /<hierarchy\b/i.test(text)) {
    return !/<node\b/i.test(text);
  }
  return false;
}

export function chooseAndroidUiTree(observedTree: string, dumpedTree: string): string {
  const observed = asText(observedTree);
  if (!isEmptyAndroidUiTree(observed)) return observed;
  const dumped = asText(dumpedTree);
  return isEmptyAndroidUiTree(dumped) ? '' : dumped;
}

function parseAndroidUiNodes(uiTree: string): AndroidUiNode[] {
  const nodes = uiTree.match(/<node\b[^>]*>/g) || [];
  return nodes.map((node) => {
    const bounds = androidNodeAttr(node, 'bounds');
    return {
      raw: node,
      text: androidNodeAttr(node, 'text'),
      contentDesc: androidNodeAttr(node, 'content-desc'),
      resourceId: androidNodeAttr(node, 'resource-id'),
      className: androidNodeAttr(node, 'class'),
      bounds,
      rect: bounds ? parseAndroidBoundsRect(bounds) : null,
      point: bounds ? parseAndroidBounds(bounds) : null,
      clickable: androidNodeAttr(node, 'clickable') === 'true',
      enabled: androidNodeAttr(node, 'enabled') !== 'false',
      focused: androidNodeAttr(node, 'focused') === 'true',
      password: androidNodeAttr(node, 'password') === 'true',
    };
  });
}

function collectAndroidVisibleText(value: unknown, output: string[], seen: Set<string>, depth = 0): void {
  if (depth > 40 || output.length >= 200) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAndroidVisibleText(item, output, seen, depth + 1);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as JsonObject;
  for (const key of ['text', 'contentDesc', 'content-desc', 'label', 'name', 'accessibilityLabel']) {
    const text = asText(object[key]).trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      output.push(text);
    }
  }
  for (const child of Object.values(object)) {
    collectAndroidVisibleText(child, output, seen, depth + 1);
  }
}

export function androidVisibleTextFromTree(uiTree: string): string {
  const tree = asText(uiTree);
  const seen = new Set<string>();
  const values: string[] = [];
  if (/<node\b/i.test(tree)) {
    for (const node of parseAndroidUiNodes(tree)) {
      for (const text of [node.text, node.contentDesc]) {
        const normalized = text.trim();
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized);
          values.push(normalized);
        }
      }
    }
    return values.join('\n');
  }
  try {
    collectAndroidVisibleText(JSON.parse(tree), values, seen);
  } catch {
    return '';
  }
  return values.join('\n');
}

function androidUiTreeForDeterministic(deviceId: string, observation: JsonObject): string {
  const observedTree = asText(observation.ui_tree);
  if (/<node\b/.test(observedTree)) return observedTree;
  const dumpedTree = dumpAndroidUiTree(deviceId);
  return /<node\b/.test(dumpedTree) ? dumpedTree : observedTree;
}

function androidNodeValue(node: AndroidUiNode, attr: string): string {
  if (attr === 'resource-id') return node.resourceId;
  if (attr === 'content-desc') return node.contentDesc;
  if (attr === 'text') return node.text || node.contentDesc;
  return '';
}

function findAndroidNodePoint(uiTree: string, target: JsonObject): [number, number] | null {
  const candidates: Array<[string, string]> = [
    ...collectTextValues(
      target.resource_id,
      target.resourceId,
      target.resource_id_candidates,
      target.resourceIdCandidates,
    ).map((value): [string, string] => ['resource-id', value]),
    ...collectTextValues(
      target.text,
      target.label,
      target.name,
      target.text_candidates,
      target.textCandidates,
    ).map((value): [string, string] => ['text', value]),
    ...collectTextValues(
      target.content_desc,
      target.contentDesc,
      target.accessibility_id,
      target.accessibilityId,
      target.content_desc_candidates,
      target.contentDescCandidates,
      target.accessibility_id_candidates,
      target.accessibilityIdCandidates,
    ).map((value): [string, string] => ['content-desc', value]),
  ].filter(([, value]) => value.trim());
  if (!candidates.length) return null;
  const matches: Array<{ point: [number, number]; priority: number }> = [];
  const nodes = parseAndroidUiNodes(uiTree);
  for (const node of nodes) {
    for (const [attr, expected] of candidates) {
      const value = androidNodeValue(node, attr);
      if (!value.includes(expected) || !node.point) continue;
      matches.push({ point: node.point, priority: node.clickable && node.enabled ? 0 : node.enabled ? 1 : 2 });
    }
  }
  matches.sort((left, right) => left.priority - right.priority);
  return matches[0]?.point || null;
}

function androidRectContainsPoint(rect: AndroidRect | null, point: [number, number]): boolean {
  if (!rect) return false;
  return point[0] >= rect.left && point[0] <= rect.left + rect.width && point[1] >= rect.top && point[1] <= rect.top + rect.height;
}

function findAndroidNodeAtPoint(uiTree: string, point: [number, number] | null): AndroidUiNode | null {
  if (!point) return null;
  const matches = parseAndroidUiNodes(uiTree)
    .filter((node) => androidRectContainsPoint(node.rect, point))
    .sort((left, right) => {
      const leftArea = left.rect ? left.rect.width * left.rect.height : Number.MAX_SAFE_INTEGER;
      const rightArea = right.rect ? right.rect.width * right.rect.height : Number.MAX_SAFE_INTEGER;
      return leftArea - rightArea;
    });
  return matches[0] || null;
}

function androidLocateElementFromPoint(point: [number, number], target: JsonObject, uiTree: string): JsonObject {
  const node = findAndroidNodeAtPoint(uiTree, point);
  const rect = node?.rect || {
    left: Math.max(0, point[0] - 4),
    top: Math.max(0, point[1] - 4),
    width: 8,
    height: 8,
  };
  const description = collectTextValues(
    target.text,
    target.label,
    target.name,
    target.resource_id,
    target.resourceId,
    target.content_desc,
    target.contentDesc,
    node?.text,
    node?.contentDesc,
    node?.resourceId,
    node?.className,
  )[0] || `Android input at ${point[0]},${point[1]}`;
  return {
    description,
    center: point,
    rect,
  };
}

function normalizeAndroidInputComparable(value: unknown): string {
  return asText(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function androidInputTextMatches(actual: unknown, expected: string): boolean {
  const expectedText = normalizeAndroidInputComparable(expected);
  const actualText = normalizeAndroidInputComparable(actual);
  return Boolean(expectedText && actualText && (actualText.includes(expectedText) || expectedText.includes(actualText)));
}

function androidInputLooksSensitive(action: JsonObject, target: JsonObject, node: AndroidUiNode | null): boolean {
  if (node?.password) return true;
  const text = collectTextValues(
    action.intent,
    action.reason,
    target.text,
    target.label,
    target.name,
    target.resource_id,
    target.resourceId,
    target.content_desc,
    target.contentDesc,
    node?.text,
    node?.contentDesc,
    node?.resourceId,
    node?.className,
  ).join('\n');
  return /password|passwd|pwd|secret|token|captcha|otp|verification|verify\s*code|\u5bc6\u7801|\u9a8c\u8bc1\u7801|\u6821\u9a8c\u7801|\u77ed\u4fe1|\u52a8\u6001\u7801|\u53e3\u4ee4/i.test(text);
}

function verifyAndroidInputValue(
  uiTree: string,
  expectedValue: string,
  point: [number, number] | null,
  target: JsonObject,
  action: JsonObject,
): JsonObject {
  if (!expectedValue) return { verified: true, reason: 'empty_input_value' };
  if (!/<node\b/i.test(uiTree)) return { verified: null, reason: 'ui_tree_unavailable' };
  const targetNode = findAndroidNodeAtPoint(uiTree, point);
  if (androidInputLooksSensitive(action, target, targetNode)) {
    return { verified: null, reason: 'sensitive_input_not_visually_verified' };
  }
  const focusedNode = parseAndroidUiNodes(uiTree).find((node) => node.focused) || null;
  const candidates = [targetNode, focusedNode].filter(Boolean) as AndroidUiNode[];
  for (const node of candidates) {
    if (androidInputTextMatches(node.text, expectedValue) || androidInputTextMatches(node.contentDesc, expectedValue)) {
      return { verified: true, reason: node === targetNode ? 'target_node_text_matched' : 'focused_node_text_matched' };
    }
  }
  const visibleText = androidVisibleTextFromTree(uiTree);
  if (androidInputTextMatches(visibleText, expectedValue)) {
    return { verified: true, reason: 'visible_text_matched' };
  }
  return { verified: false, reason: 'input_value_not_found_after_typing' };
}

type AndroidInputDeps = {
  adbText?: (deviceId: string, args: string[], timeout?: number) => string;
  fetch?: (url: string, init?: JsonObject) => Promise<{
    ok?: boolean;
    status?: number;
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  }>;
  emitEvent?: (eventType: string, payload: JsonObject) => void;
};

function androidInputEventPayload(
  action: JsonObject,
  method: string,
  extra: JsonObject = {},
): JsonObject {
  const value = asText(action.value);
  return {
    step_index: Number(action.step_index || 0) || undefined,
    platform: 'android',
    method,
    action: 'type',
    value_length: value.length,
    value_has_non_ascii: /[\x80-\uFFFF]/.test(value),
    ...extra,
  };
}

function emitAndroidInputEvent(deps: AndroidInputDeps, eventType: string, payload: JsonObject): void {
  (deps.emitEvent || emitEvent)(eventType, payload);
}

function dumpAndroidUiTreeWithDeps(deviceId: string, deps: AndroidInputDeps): string {
  const runAdb = deps.adbText || adbText;
  const text = runAdb(deviceId, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], 15000);
  const idx = text.indexOf('<?xml');
  return idx >= 0 ? text.slice(idx) : text;
}

function adbForwardAtx(deviceId: string, deps: AndroidInputDeps, localPort: number): JsonObject {
  const runAdb = deps.adbText || adbText;
  try {
    const output = runAdb(deviceId, ['forward', `tcp:${localPort}`, 'tcp:7912'], 10000);
    return { success: true, output: output.slice(0, 500) };
  } catch (error) {
    return { success: false, message: `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function atxJsonRpc(localPort: number, method: string, params: unknown, deps: AndroidInputDeps): Promise<JsonObject> {
  const fetchFn = deps.fetch || (globalThis as unknown as { fetch?: AndroidInputDeps['fetch'] }).fetch;
  if (!fetchFn) return { success: false, message: 'fetch_unavailable' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchFn(`http://127.0.0.1:${localPort}/jsonrpc/0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
      signal: controller.signal,
    } as JsonObject);
    const body = response.json ? await response.json().catch(async () => response.text ? await response.text() : {}) : {};
    if (response.ok === false) return { success: false, message: `http_${response.status || 0}`, body };
    if (isRecord(body) && body.error) return { success: false, message: `jsonrpc_error:${JSON.stringify(body.error).slice(0, 300)}`, body };
    return { success: true, body };
  } catch (error) {
    return { success: false, message: `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function inputTextViaAtxClipboard(deviceId: string, value: string, deps: AndroidInputDeps): Promise<JsonObject> {
  const localPort = Number(process.env.OPENCAT_ATX_LOCAL_PORT || process.env.ATX_AGENT_LOCAL_PORT || 7912);
  const port = Number.isFinite(localPort) && localPort > 0 ? Math.trunc(localPort) : 7912;
  const forward = adbForwardAtx(deviceId, deps, port);
  if (!forward.success) return { success: false, method: 'atx_jsonrpc', message: forward.message || 'adb_forward_failed', forward };

  const clipboardAttempts = [
    ['setClipboard', ['OpenClaude', value]],
    ['setClipboard', [value]],
    ['setClipboard', { label: 'OpenClaude', text: value }],
  ] as Array<[string, unknown]>;
  const failures: JsonObject[] = [];
  for (const [method, params] of clipboardAttempts) {
    const result = await atxJsonRpc(port, method, params, deps);
    if (!result.success) {
      failures.push({ method, ...result });
      continue;
    }
    (deps.adbText || adbText)(deviceId, ['shell', 'input', 'keyevent', '279'], 10000);
    return { success: true, method: 'atx_jsonrpc_clipboard_paste', forward, jsonrpc: result };
  }
  const direct = await atxJsonRpc(port, 'setText', [value], deps);
  if (direct.success) return { success: true, method: 'atx_jsonrpc_set_text', forward, jsonrpc: direct };
  failures.push({ method: 'setText', ...direct });
  return { success: false, method: 'atx_jsonrpc', message: 'atx_jsonrpc_input_failed', forward, failures };
}

async function inputTextViaMidsceneAction(agent: any, value: string, locate: JsonObject, mode: string): Promise<JsonObject> {
  if (!agent || typeof agent.callActionInActionSpace !== 'function') {
    return { success: false, message: 'midscene_input_action_unavailable' };
  }
  await agent.callActionInActionSpace('Input', {
    value,
    mode: mode === 'append' ? 'typeOnly' : mode || 'replace',
    locate,
  });
  return { success: true, method: 'midscene_input' };
}

async function executeAndroidTextInput(
  agent: any,
  deviceId: string,
  observation: JsonObject,
  action: JsonObject,
  target: JsonObject,
  point: [number, number],
  deps: AndroidInputDeps,
): Promise<JsonObject> {
  const value = asText(action.value);
  const mode = asText(firstConfiguredValue(action.mode, action.input_mode, target.mode, 'replace')).trim() || 'replace';
  const runAdb = deps.adbText || adbText;
  const initialTree = androidUiTreeForDeterministic(deviceId, observation);
  const locate = androidLocateElementFromPoint(point, target, initialTree);
  const attempts: JsonObject[] = [];
  const verifyAfter = async (method: string): Promise<JsonObject> => {
    await delay(250);
    const uiTree = dumpAndroidUiTreeWithDeps(deviceId, deps);
    const verification = verifyAndroidInputValue(uiTree, value, point, target, action);
    emitAndroidInputEvent(deps, 'visual_android_input_verified', androidInputEventPayload(action, method, verification));
    return verification;
  };

  runAdb(deviceId, ['shell', 'input', 'tap', String(point[0]), String(point[1])]);
  emitAndroidInputEvent(deps, 'visual_android_input_attempt', androidInputEventPayload(action, 'midscene_input', { mode }));
  const midscene = await inputTextViaMidsceneAction(agent, value, locate, mode).catch((error) => ({
    success: false,
    message: `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}`,
  }));
  attempts.push({ method: 'midscene_input', ...midscene });
  if (midscene.success) {
    const verification = await verifyAfter('midscene_input');
    if (verification.verified !== false) {
      return {
        success: true,
        message: verification.verified === null ? 'executed type via Midscene Input; visual verification skipped' : 'executed type via Midscene Input',
        codex_action_source: 'android_midscene_input',
        input_method: 'midscene_input',
        input_verified: verification.verified,
        input_verification_reason: verification.reason,
        attempts,
      };
    }
    emitAndroidInputEvent(deps, 'visual_android_input_fallback', androidInputEventPayload(action, 'atx_jsonrpc', {
      from_method: 'midscene_input',
      reason: verification.reason,
    }));
  } else {
    emitAndroidInputEvent(deps, 'visual_android_input_fallback', androidInputEventPayload(action, 'atx_jsonrpc', {
      from_method: 'midscene_input',
      reason: midscene.message || 'midscene_input_failed',
    }));
  }

  const atx = await inputTextViaAtxClipboard(deviceId, value, deps);
  attempts.push({ method: 'atx_jsonrpc', ...atx });
  if (atx.success) {
    const verification = await verifyAfter('atx_jsonrpc');
    if (verification.verified !== false) {
      return {
        success: true,
        message: verification.verified === null ? 'executed type via ATX; visual verification skipped' : 'executed type via ATX',
        codex_action_source: 'android_atx_input',
        input_method: String(atx.method || 'atx_jsonrpc'),
        input_verified: verification.verified,
        input_verification_reason: verification.reason,
        attempts,
      };
    }
    emitAndroidInputEvent(deps, 'visual_android_input_fallback', androidInputEventPayload(action, 'legacy_adb_input', {
      from_method: 'atx_jsonrpc',
      reason: verification.reason,
    }));
  } else {
    emitAndroidInputEvent(deps, 'visual_android_input_fallback', androidInputEventPayload(action, 'legacy_adb_input', {
      from_method: 'atx_jsonrpc',
      reason: atx.message || 'atx_jsonrpc_input_failed',
    }));
  }

  runAdb(deviceId, ['shell', 'input', 'text', androidInputText(value)]);
  attempts.push({ method: 'legacy_adb_input', success: true });
  const verification = await verifyAfter('legacy_adb_input');
  if (verification.verified !== false) {
    return {
      success: true,
      message: verification.verified === null ? 'executed type via legacy ADB input; visual verification skipped' : 'executed type via legacy ADB input',
      codex_action_source: 'android_legacy_adb_input',
      input_method: 'legacy_adb_input',
      input_verified: verification.verified,
      input_verification_reason: verification.reason,
      attempts,
    };
  }

  const failure = {
    success: false,
    message: 'Android input failed verification after Midscene, ATX, and legacy ADB attempts',
    codex_action_source: 'android_input_failed',
    input_method: 'none',
    input_verified: false,
    input_verification_reason: verification.reason,
    attempts,
  };
  emitAndroidInputEvent(deps, 'visual_android_input_failed', androidInputEventPayload(action, 'android_input_failed', failure));
  return failure;
}

const ANDROID_POPUP_DISMISS_TEXTS = [
  '关闭',
  '跳过',
  '稍后',
  '以后再说',
  '暂不',
  '我知道了',
  '知道了',
  'Close',
  'Skip',
  'Later',
  'Not now',
];

const ANDROID_PERMISSION_ALLOW_TEXTS = [
  '允许',
  '仅在使用中允许',
  '使用应用时允许',
  'Allow',
  'While using the app',
];

const ANDROID_POPUP_HIGH_RISK_TEXTS = [
  '支付',
  '付款',
  '购买',
  '删除',
  '提交',
  '转账',
  '授权登录',
  '退出登录',
  '注销',
  '隐私政策',
  '用户协议',
];

const ANDROID_POPUP_HIGH_RISK_ACTION_TEXTS = [
  '确定',
  '确认',
  '同意',
  '允许',
  '继续',
  'OK',
  'Yes',
  'Agree',
  'Continue',
  'Authorize',
];

function matchTextToken(value: string, tokens: string[]): string {
  const compactValue = value.trim();
  const lowerValue = compactValue.toLowerCase();
  for (const token of tokens) {
    const compactToken = token.trim();
    if (!compactToken) continue;
    const lowerToken = compactToken.toLowerCase();
    if (compactValue.includes(compactToken) || lowerValue.includes(lowerToken)) return compactToken;
  }
  return '';
}

function androidPopupNodeLabel(node: AndroidUiNode): string {
  return asText(firstConfiguredValue(node.text, node.contentDesc, node.resourceId)).trim();
}

function androidPopupNodePayload(node: AndroidUiNode, matchedText: string, actionType: string, reason = ''): JsonObject {
  return {
    detected: true,
    action_type: actionType,
    matched_text: matchedText || androidPopupNodeLabel(node),
    resource_id: node.resourceId || undefined,
    content_desc: node.contentDesc || undefined,
    text: node.text || undefined,
    point: node.point ? { x: node.point[0], y: node.point[1] } : undefined,
    clickable: node.clickable,
    enabled: node.enabled,
    reason: reason || undefined,
  };
}

function nodeLooksLikeAndroidPermissionAllow(node: AndroidUiNode): string {
  const label = androidPopupNodeLabel(node);
  const textMatch = matchTextToken(label, ANDROID_PERMISSION_ALLOW_TEXTS);
  if (textMatch) return textMatch;
  const resource = node.resourceId.toLowerCase();
  if (resource.includes('permission_allow') || resource.includes('permissioncontroller:id/permission_allow')) {
    return node.resourceId;
  }
  return '';
}

function nodeLooksLikePopupDismiss(node: AndroidUiNode): string {
  return matchTextToken(androidPopupNodeLabel(node), ANDROID_POPUP_DISMISS_TEXTS);
}

export function findAndroidPopupGuardAction(uiTree: string): JsonObject {
  const nodes = parseAndroidUiNodes(uiTree).filter((node) => node.point && node.enabled);
  if (!nodes.length) return { detected: false };
  const fullText = [
    uiTree,
    ...nodes.flatMap((node) => [node.text, node.contentDesc, node.resourceId]),
  ].join('\n');
  const highRiskText = matchTextToken(fullText, ANDROID_POPUP_HIGH_RISK_TEXTS);
  if (highRiskText) {
    const riskyNode = nodes.find((node) => {
      const label = androidPopupNodeLabel(node);
      return matchTextToken(label, [...ANDROID_POPUP_HIGH_RISK_TEXTS, ...ANDROID_POPUP_HIGH_RISK_ACTION_TEXTS]);
    }) || nodes[0];
    return {
      ...androidPopupNodePayload(riskyNode, highRiskText, 'skip_high_risk_popup', 'high_risk_popup_text'),
      skipped: true,
    };
  }

  const permissionCandidates = nodes
    .map((node) => ({ node, matchedText: nodeLooksLikeAndroidPermissionAllow(node) }))
    .filter((item) => item.matchedText)
    .sort((left, right) => Number(right.node.clickable) - Number(left.node.clickable));
  if (permissionCandidates.length) {
    const { node, matchedText } = permissionCandidates[0];
    return androidPopupNodePayload(node, matchedText, 'allow_permission');
  }

  const dismissCandidates = nodes
    .map((node) => ({ node, matchedText: nodeLooksLikePopupDismiss(node) }))
    .filter((item) => item.matchedText)
    .sort((left, right) => Number(right.node.clickable) - Number(left.node.clickable));
  if (dismissCandidates.length) {
    const { node, matchedText } = dismissCandidates[0];
    return androidPopupNodePayload(node, matchedText, 'dismiss_popup');
  }
  return { detected: false };
}

function isCodexPopupGuardEnabled(request: RunnerRequest): boolean {
  if (request.platform !== 'android') return false;
  const slots = request.slots || {};
  return coerceBooleanSlot(
    firstConfiguredValue(
      slots.codex_popup_guard_enabled,
      slots.popup_guard_enabled,
      process.env.MIDSCENE_CODEX_POPUP_GUARD_ENABLED,
    ),
    true,
  );
}

function dismissAndroidPopup(deviceId: string, observation: JsonObject): JsonObject {
  const uiTree = androidUiTreeForDeterministic(deviceId, observation);
  const decision = findAndroidPopupGuardAction(uiTree);
  if (!decision.detected || decision.skipped) return decision;
  const point = decision.point as JsonObject | undefined;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ...decision, skipped: true, reason: 'popup_candidate_without_point' };
  }
  adbText(deviceId, ['shell', 'input', 'tap', String(Math.trunc(x)), String(Math.trunc(y))]);
  return {
    ...decision,
    dismissed: true,
  };
}

function pointFromTarget(target: JsonObject, screenSize: JsonObject = {}): [number, number] | null {
  const rawPoint = firstConfiguredValue(target.normalized_point, target.point);
  if (isRecord(rawPoint)) {
    const width = Number(screenSize.width || 0) || 1;
    const height = Number(screenSize.height || 0) || 1;
    const x = Number(rawPoint.x);
    const y = Number(rawPoint.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [Math.trunc(x <= 1 ? x * width : x), Math.trunc(y <= 1 ? y * height : y)];
    }
  }
  const x = Number(target.x);
  const y = Number(target.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [Math.trunc(x), Math.trunc(y)] : null;
}

async function executeWebCodexAction(page: any, action: JsonObject): Promise<JsonObject> {
  const name = normalizeCodexActionName(action.action);
  const target = normalizeLocator(action.target);
  const selector = asText(firstConfiguredValue(target.selector, target.css, target.xpath)).trim();
  const text = asText(firstConfiguredValue(target.text, target.label, target.name)).trim();
  const role = asText(target.role).trim();
  const value = asText(action.value).trim();
  try {
    if (name === 'open_url') {
      const url = asText(firstConfiguredValue(action.value, target.url)).trim();
      if (!url) return { success: false, message: 'open_url requires value', codex_action_source: 'web_deterministic' };
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true, message: `opened ${url}`, codex_action_source: 'web_deterministic' };
    }
    if (name === 'back') {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => undefined);
      return { success: true, message: 'went back', codex_action_source: 'web_deterministic' };
    }
    if (name === 'wait') {
      if (selector) await page.locator(selector).first().waitFor({ timeout: 10000 });
      else if (text) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
      else await page.waitForTimeout(Math.max(200, Math.min(10000, Number(action.value || 1) * 1000)));
      return { success: true, message: 'wait completed', codex_action_source: 'web_deterministic' };
    }
    if (name === 'tap' || name === 'type') {
      let locator: any = null;
      if (selector) locator = page.locator(selector).first();
      else if (role) locator = page.getByRole(role as never, text ? { name: text } : {}).first();
      else if (text) locator = page.getByText(text, { exact: false }).first();
      if (locator) {
        if (name === 'type') await locator.fill(value);
        else await locator.click();
        return { success: true, message: `executed ${name} by locator`, codex_action_source: 'web_deterministic' };
      }
      const point = pointFromTarget(target, page.viewportSize?.() || {});
      if (point) {
        await page.mouse.click(point[0], point[1]);
        if (name === 'type' && value) await page.keyboard.type(value);
        return { success: true, message: `executed ${name} by coordinate`, codex_action_source: 'web_deterministic' };
      }
    }
  } catch (error) {
    return { success: false, message: `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}`, codex_action_source: 'web_deterministic' };
  }
  return { success: false, message: `No deterministic Web action matched: ${name}`, codex_action_source: 'web_deterministic' };
}

export async function executeAndroidCodexAction(
  deviceId: string,
  observation: JsonObject,
  action: JsonObject,
  agent?: any,
  deps: AndroidInputDeps = {},
): Promise<JsonObject> {
  const name = normalizeCodexActionName(action.action);
  const target = normalizeLocator(action.target);
  const value = asText(action.value).trim();
  const runAdb = deps.adbText || adbText;
  try {
    if (name === 'launch_app') {
      const packageName = asText(firstConfiguredValue(action.value, target.package, target.app_package)).trim();
      if (!packageName) return { success: false, message: 'launch_app requires app package', codex_action_source: 'android_deterministic' };
      runAdb(deviceId, ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], 20000);
      return { success: true, message: `launched ${packageName}`, codex_action_source: 'android_deterministic' };
    }
    if (name === 'back') {
      runAdb(deviceId, ['shell', 'input', 'keyevent', '4']);
      return { success: true, message: 'pressed back', codex_action_source: 'android_deterministic' };
    }
    if (name === 'wait') {
      await delay(Math.max(200, Math.min(10000, Number(action.value || 1) * 1000)));
      return { success: true, message: 'wait completed', codex_action_source: 'android_deterministic' };
    }
    if (name === 'swipe') {
      runAdb(deviceId, ['shell', 'input', 'swipe', '540', '1500', '540', '450', '450']);
      return { success: true, message: 'swiped', codex_action_source: 'android_deterministic' };
    }
    if (name === 'tap' || name === 'type') {
      const uiTree = androidUiTreeForDeterministic(deviceId, observation);
      const point = findAndroidNodePoint(uiTree, target) || pointFromTarget(target, observation.screen_size as JsonObject);
      if (!point) return { success: false, message: `No deterministic Android target matched: ${JSON.stringify(target)}`, codex_action_source: 'android_deterministic' };
      if (name === 'type' && value) {
        return executeAndroidTextInput(agent, deviceId, observation, action, target, point, deps);
      }
      runAdb(deviceId, ['shell', 'input', 'tap', String(point[0]), String(point[1])]);
      return { success: true, message: `executed ${name} at ${point[0]},${point[1]}`, codex_action_source: 'android_deterministic' };
    }
  } catch (error) {
    return { success: false, message: `${error instanceof Error ? error.name : 'Error'}: ${error instanceof Error ? error.message : String(error)}`, codex_action_source: 'android_deterministic' };
  }
  return { success: false, message: `No deterministic Android action matched: ${name}`, codex_action_source: 'android_deterministic' };
}

async function setupWebAgent(request: RunnerRequest): Promise<RuntimeHandle> {
  const slots = request.slots || {};
  const agentOptions = buildMidsceneAgentOptions(request);
  const startUrl = asText(slots.start_url).trim();
  const viewport = { width: Number(slots.viewport_width || 1280), height: Number(slots.viewport_height || 800) };
  const initPayload = {
    platform: 'web',
    start_url: clipText(startUrl, 500),
    headed: slots.headed === true,
    viewport,
    playwright_browsers_path: asText(process.env.PLAYWRIGHT_BROWSERS_PATH),
  };
  let stage = 'start';
  let browser: any | null = null;
  let agent: any | null = null;
  const emitInitStep = (nextStage: string, status: 'started' | 'completed', extra: JsonObject = {}) => {
    emitEvent('visual_web_sidecar_init_step', {
      ...initPayload,
      stage: nextStage,
      status,
      ...extra,
    });
  };
  emitEvent('visual_web_sidecar_init_started', initPayload);
  try {
    stage = 'playwright_import';
    emitInitStep(stage, 'started');
    const { chromium } = await import('playwright');
    emitInitStep(stage, 'completed');

    stage = 'midscene_playwright_import';
    emitInitStep(stage, 'started');
    const { PlaywrightAgent } = await import('@midscene/web/playwright');
    emitInitStep(stage, 'completed');

    stage = 'chromium_launch';
    emitInitStep(stage, 'started', { headless: slots.headed === true ? false : true });
    browser = await chromium.launch({ headless: slots.headed === true ? false : true });
    emitInitStep(stage, 'completed');

    stage = 'page_create';
    emitInitStep(stage, 'started');
    const page = await browser.newPage({ viewport });
    emitInitStep(stage, 'completed');

    stage = 'start_url_open';
    if (startUrl) {
      emitInitStep(stage, 'started');
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      emitInitStep(stage, 'completed', { current_url: clipText(page.url(), 500) });
    } else {
      emitInitStep(stage, 'completed', { skipped: true, reason: 'empty_start_url' });
    }

    stage = 'playwright_agent_create';
    emitInitStep(stage, 'started');
    agent = new PlaywrightAgent(page, agentOptions);
    emitInitStep(stage, 'completed');

    stage = 'ai_context_set';
    emitInitStep(stage, 'started');
    await agent.setAIActContext(buildAIContext(request));
    emitInitStep(stage, 'completed');

    return {
      agent,
      free: async () => {
        await agent.destroy().catch(() => undefined);
        await browser.close().catch(() => undefined);
      },
      observe: async (step: number) => observeWeb(agent, page, ensureTraceDir(request), step),
      executeCodexAction: async (action: JsonObject) => executeWebCodexAction(page, action),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'Error';
    emitEvent('visual_web_sidecar_init_failed', {
      ...initPayload,
      stage,
      error_name: errorName,
      message: clipText(message, 1000),
      stack: error instanceof Error ? clipText(error.stack, 2000) : undefined,
    });
    emit({ type: 'log', message: `visual_web_sidecar_init_failed stage=${stage}: ${errorName}: ${message}` });
    if (agent && typeof agent.destroy === 'function') {
      await agent.destroy().catch(() => undefined);
    }
    if (browser && typeof browser.close === 'function') {
      await browser.close().catch(() => undefined);
    }
    if (
      stage === 'chromium_launch' &&
      /executable doesn't exist|browser.*not.*found|install chromium|playwright install/i.test(message)
    ) {
      throw new Error('Chromium is not installed.\nRun:\n  npx playwright install chromium');
    }
    throw error;
  }
}

async function setupAndroidAgent(request: RunnerRequest): Promise<RuntimeHandle> {
  const slots = request.slots || {};
  const agentOptions = buildMidsceneAgentOptions(request);
  const deviceId = asText(slots.device_id).trim();

  // Always ensure ANDROID_HOME/ANDROID_SDK_ROOT are set for known environment
  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    const knownSdkRoot = 'E:/04 Coding/platform-tools-latest-windows';
    process.env.ANDROID_HOME = knownSdkRoot;
    process.env.ANDROID_SDK_ROOT = knownSdkRoot;
  }
  // Set ADB path if not already set
  if (!process.env.ADB_PATH && process.env.ANDROID_HOME) {
    process.env.ADB_PATH = `${process.env.ANDROID_HOME}/platform-tools/adb.exe`;
  }

  const preflight = buildAndroidMidscenePreflight({ deviceId });
  emitEvent('visual_preflight_checked', preflight);
  const preflightFailure = formatAndroidPreflightFailure(preflight);
  if (preflightFailure) throw new Error(preflightFailure);

  const { agentFromAdbDevice } = await import('@midscene/android');
  let agent: any;
  try {
    agent = await agentFromAdbDevice(deviceId || undefined, agentOptions);
  } catch (error) {
    throw normalizeAndroidSetupError(error, preflight);
  }
  const appPackage = asText(slots.app_package).trim();
  const startUrl = asText(slots.start_url).trim();
  if (appPackage) await launchAndroidAppWithOptionalReset(agent, deviceId, appPackage, slots);
  if (startUrl) await agent.launch(startUrl);
  await agent.setAIActContext(buildAIContext(request));
  return {
    agent,
    free: async () => {
      await agent.destroy().catch(() => undefined);
    },
    observe: async (step: number) => observeAndroid(agent, ensureTraceDir(request), step, deviceId),
    executeCodexAction: async (action: JsonObject, observation: JsonObject) => executeAndroidCodexAction(deviceId, observation, action, agent),
    dismissAndroidPopup: async (observation: JsonObject) => dismissAndroidPopup(deviceId, observation),
  };
}

async function setupAgent(request: RunnerRequest): Promise<RuntimeHandle> {
  return request.platform === 'web' ? setupWebAgent(request) : setupAndroidAgent(request);
}

async function observeAndEmit(
  runtime: RuntimeHandle,
  stepIndex: number,
  screenshots: JsonObject[],
  source: 'pre_action' | 'heartbeat' | 'post_action',
): Promise<JsonObject> {
  const observed = await runtime.observe(stepIndex);
  const observation: JsonObject = {
    ...observed,
    observation_source: source,
  };
  screenshots.push({
    step_index: stepIndex,
    artifact_path: observation.screenshot_artifact_path,
    observation_source: source,
  });
  emitEvent('visual_observed', observation);
  return observation;
}

type CodexPopupGuardDeps = {
  emitEvent?: (eventType: string, payload: JsonObject) => void;
  observeAndEmit?: typeof observeAndEmit;
  maxAttempts?: number;
};

export async function runCodexPopupGuard(
  runtime: RuntimeHandle,
  request: RunnerRequest,
  observation: JsonObject,
  stepIndex: number,
  screenshots: JsonObject[],
  deps: CodexPopupGuardDeps = {},
): Promise<JsonObject> {
  if (!isCodexPopupGuardEnabled(request) || !runtime.dismissAndroidPopup) return observation;
  const emitEventFn = deps.emitEvent || emitEvent;
  const observeFn = deps.observeAndEmit || observeAndEmit;
  const configuredMaxAttempts = deps.maxAttempts ?? request.slots?.codex_popup_guard_max_attempts ?? 2;
  const parsedMaxAttempts = Number(configuredMaxAttempts);
  const maxAttempts = Number.isFinite(parsedMaxAttempts)
    ? Math.max(0, Math.min(5, Math.trunc(parsedMaxAttempts)))
    : 2;
  let currentObservation = observation;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const decision = await runtime.dismissAndroidPopup(currentObservation, stepIndex);
    if (!decision.detected) return currentObservation;
    const payload = {
      step_index: stepIndex,
      attempt,
      execution_mode: 'codex_guided',
      platform: 'android',
      ...decision,
    };
    emitEventFn('visual_popup_guard_detected', payload);
    if (decision.skipped || !decision.dismissed) {
      emitEventFn('visual_popup_guard_skipped', {
        ...payload,
        reason: asText(decision.reason || (decision.skipped ? 'popup_guard_skipped' : 'popup_guard_not_dismissed')),
      });
      return currentObservation;
    }
    emitEventFn('visual_popup_guard_dismissed', payload);
    await delay(500);
    currentObservation = await observeFn(runtime, stepIndex, screenshots, 'pre_action');
  }
  return currentObservation;
}

function startObservationHeartbeat(
  runtime: RuntimeHandle,
  request: RunnerRequest,
  screenshots: JsonObject[],
  steps: JsonObject[],
  nextStepIndex: () => number,
): () => Promise<void> {
  const intervalMs = resolveObservationHeartbeatMs(request.slots || {});
  if (intervalMs <= 0) return async () => undefined;
  let stopped = false;
  let inFlight = false;
  const timer = setInterval(() => {
    if (stopped || inFlight) return;
    inFlight = true;
    const stepIndex = nextStepIndex();
    observeAndEmit(runtime, stepIndex, screenshots, 'heartbeat')
      .then((observation) => {
        steps.push({
          step_index: stepIndex,
          observation,
          result: { success: true, message: 'heartbeat observation' },
        });
      })
      .catch((error) => {
        emit({ type: 'log', message: `Midscene heartbeat observation failed: ${error instanceof Error ? error.message : String(error)}` });
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (inFlight) {
      await delay(25);
    }
  };
}

export async function executeCodexStep(
  runtime: RuntimeHandle,
  request: RunnerRequest,
  action: JsonObject,
  observation: JsonObject,
): Promise<JsonObject> {
  const name = normalizeCodexActionName(action.action);
  if (name === 'finish') {
    return { success: true, message: asText(action.intent || action.reason || 'codex guided test finished'), terminal: true, execution_strategy: 'codex_guided' };
  }
  if (name === 'assert_text' || name === 'assert_visual') {
    const assertion = normalizeStructuredAssertion({
      kind: name === 'assert_visual' ? 'visual' : 'text_visible',
      expected: firstConfiguredValue(action.value, action.intent, action.assertion),
      allow_midscene_fallback: name === 'assert_visual',
    });
    return runCodexAssertion(runtime, assertion, observation, request);
  }

  let deterministic: JsonObject = { success: false, message: 'deterministic executor unavailable' };
  if (runtime.executeCodexAction) {
    deterministic = await runtime.executeCodexAction(action, observation);
  }
  if (deterministic.success || action.allow_midscene_fallback === false || name === 'wait' || name === 'back' || name === 'open_url' || name === 'launch_app') {
    return { ...deterministic, execution_strategy: 'codex_guided', midscene_fallback_used: false };
  }

  const timeoutMs = resolveCodexFallbackTimeoutMs(request.slots || {});
  const fallbackInstruction = formatCodexFallbackInstruction(action, request)
    || asText(request.slots?.test_goal || 'continue the UI test');
  const fallbackOutcome = await callCodexMidsceneFallback({
    request,
    kind: 'aiAct',
    instruction: fallbackInstruction,
    timeoutMs,
    call: () => runtime.agent.aiAct(fallbackInstruction),
  });
  if (!fallbackOutcome.success) {
    return {
      success: false,
      message: fallbackOutcome.message,
      execution_strategy: 'codex_guided',
      codex_action_source: 'midscene_fallback',
      midscene_fallback_used: true,
      deterministic_failure: deterministic.message,
      codex_midscene_fallback_timeout: fallbackOutcome.timeout,
      timeout_ms: timeoutMs,
      fallback_instruction: clipText(fallbackInstruction, 500),
    };
  }
  return {
    success: true,
    message: asText(fallbackOutcome.value || 'Midscene fallback action completed'),
    execution_strategy: 'codex_guided',
    codex_action_source: 'midscene_fallback',
    midscene_fallback_used: true,
    deterministic_failure: deterministic.message,
    fallback_instruction: clipText(fallbackInstruction, 500),
  };
}

type CodexFallbackOutcome = {
  success: boolean;
  timeout: boolean;
  message: string;
  value?: unknown;
};

async function callCodexMidsceneFallback(options: {
  request: RunnerRequest;
  kind: 'aiAct' | 'aiAssert';
  instruction: string;
  timeoutMs: number;
  call: () => Promise<unknown>;
}): Promise<CodexFallbackOutcome> {
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const value = await Promise.race([
      options.call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`codex_midscene_fallback_timeout:${options.kind}`));
        }, options.timeoutMs);
      }),
    ]);
    return { success: true, timeout: false, message: asText(value || 'Midscene fallback completed'), value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = timedOut || message.startsWith('codex_midscene_fallback_timeout:');
    const publicMessage = isTimeout
      ? `Codex Guided Midscene fallback timed out while executing ${clipText(options.instruction, 120)}`
      : `Codex Guided Midscene fallback failed: ${message}`;
    emitEvent(isTimeout ? 'codex_midscene_fallback_timeout' : 'codex_midscene_fallback_failed', {
      fallback_kind: options.kind,
      instruction: clipText(options.instruction, 240),
      timeout_ms: options.timeoutMs,
      elapsed_ms: Date.now() - startedAt,
      execution_mode: 'codex_guided',
      codex_midscene_fallback_timeout: isTimeout,
      message: publicMessage,
    });
    return { success: false, timeout: isTimeout, message: publicMessage };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCodexAssertion(runtime: RuntimeHandle, assertion: unknown, observation: JsonObject, request: RunnerRequest): Promise<JsonObject> {
  const normalized = normalizeStructuredAssertion(assertion);
  const local = evaluateCodexAssertion(normalized, observation);
  const kind = asText(normalized.kind).toLowerCase();
  if (local.success || (isRecord(assertion) && normalized.allow_midscene_fallback !== true && kind !== 'visual')) {
    return { ...local, execution_strategy: 'codex_guided', midscene_fallback_used: false };
  }
  if (kind === 'visual' || normalized.allow_midscene_fallback === true) {
    const assertionText = asText(normalized.assertion || normalized.expected).trim();
    const timeoutMs = resolveCodexFallbackTimeoutMs(request.slots || {});
    const fallbackOutcome = await callCodexMidsceneFallback({
      request,
      kind: 'aiAssert',
      instruction: assertionText,
      timeoutMs,
      call: () => runtime.agent.aiAssert(assertionText),
    });
    if (!fallbackOutcome.success) {
      return {
        ...normalized,
        success: false,
        message: fallbackOutcome.message,
        assertion_source: 'midscene_fallback',
        deterministic_message: local.message,
        execution_strategy: 'codex_guided',
        midscene_fallback_used: true,
        codex_midscene_fallback_timeout: fallbackOutcome.timeout,
        timeout_ms: timeoutMs,
      };
    }
    const assertionResult = fallbackOutcome.value as JsonObject | undefined;
    const pass = assertionResult?.pass !== false;
    return {
      ...normalized,
      success: pass,
      message: asText(assertionResult?.message || assertionResult?.thought || (pass ? `visual assertion passed: ${assertionText}` : `visual assertion failed: ${assertionText}`)),
      assertion_source: 'midscene_fallback',
      deterministic_message: local.message,
      execution_strategy: 'codex_guided',
      midscene_fallback_used: true,
    };
  }
  return { ...local, execution_strategy: 'codex_guided', midscene_fallback_used: false };
}

async function runCodexGuidedTest(request: RunnerRequest): Promise<void> {
  const traceDir = ensureTraceDir(request);
  const slots = request.slots || {};
  const goal = asText(slots.test_goal).trim();
  const actionSteps = coerceCodexActionSteps(slots);
  const assertions = coerceFinalAssertions(slots, actionSteps);
  const maxSteps = clampStepLimit(slots.max_steps, DEFAULT_MAX_STEPS);
  const midsceneFallbackMaxCount = resolveCodexMidsceneFallbackMaxCount(slots);
  const selfHealing = createVisualSelfHealingState(slots);
  let midsceneFallbackCount = 0;
  if (isHighRiskText(goal, actionSteps, assertions)) {
    throw new Error('high-risk codex_guided action text reached sidecar; backend should have blocked before execution');
  }

  const runtime = await setupAgent(request);
  const steps: JsonObject[] = [];
  const screenshots: JsonObject[] = [];
  let nextStep = 1;
  const nextStepIndex = () => nextStep++;
  let success = true;
  let finalMessage = 'Codex guided visual test completed';
  const reflectionEvents: JsonObject[] = [];
  const repairAttempts: JsonObject[] = [];
  let selfCorrectionCount = 0;
  const visualMemory = createVisualPathMemoryState(slots);
  try {
    emitEvent('visual_preflight_checked', {
      execution_mode: 'codex_guided',
      platform: request.platform,
      action_step_count: actionSteps.length,
      assertion_count: assertions.length,
      step_assertion_count: actionSteps.reduce((count, action) => count + asList(action.assert_after).length, 0),
    });
    for (const rawAction of actionSteps.slice(0, maxSteps)) {
      const stepIndex = nextStepIndex();
      let observation = await observeAndEmit(runtime, stepIndex, screenshots, 'pre_action');
      observation = await runCodexPopupGuard(runtime, request, observation, stepIndex, screenshots);
      await waitIfPaused(request);
      const action: JsonObject = applyVisualPathMemoryToAction({ ...(rawAction as JsonObject), execution_strategy: 'codex_guided' }, visualMemory, stepIndex);
      if (midsceneFallbackCount >= midsceneFallbackMaxCount && action.allow_midscene_fallback !== false) {
        action.allow_midscene_fallback = false;
        action.codex_midscene_fallback_suppressed = true;
      }
      emitEvent('visual_action_planned', { step_index: stepIndex, action });
      let result = await executeCodexStep(runtime, request, action, observation);
      emitEvent('visual_action_executed', { step_index: stepIndex, action: action.action, ...result });
      if (result.midscene_fallback_used) {
        midsceneFallbackCount += 1;
      }
      const step: JsonObject = { step_index: stepIndex, observation, action, result };
      steps.push(step);
      if (!result.success) {
        const reflection = await requestStepReflection({
          step_index: stepIndex,
          phase: 'post_action',
          source_step_id: `codex-action-${stepIndex}`,
          platform: request.platform,
          test_goal: goal,
          action,
          observation,
          result,
          history: steps.slice(-8),
          failure_signature: visualFailureSignature({ phase: 'post_action', action, observation, result }),
          self_healing: visualSelfHealingContext(selfHealing, stepIndex),
        });
        step.reflection = reflection;
        reflectionEvents.push({ step_index: stepIndex, reflection });
        emitStepReflection(stepIndex, reflection, { phase: 'action_result' });
        rememberVisualPathReflection(visualMemory, stepIndex, reflection);
        const repairDecision = canUseVisualSelfHealingRepair(selfHealing, stepIndex, reflection, {
          phase: 'post_action',
          action,
          observation,
          result,
        });
        if (repairDecision.allowed) {
          selfCorrectionCount += 1;
          const repairMeta = noteVisualSelfHealingRepair(selfHealing, stepIndex, repairDecision);
          await waitIfPaused(request);
          const correctionAction = primaryReflectionCorrection(reflection);
          if (asText(correctionAction.type).trim() === 'wait') {
            await delay(correctionWaitMs(correctionAction));
          }
          const retryObservation = await observeAndEmit(runtime, nextStepIndex(), screenshots, 'post_action');
          const repairAction = correctedActionFromReflection(reflection, action);
          const retryResult = await executeCodexStep(runtime, request, repairAction, retryObservation);
          const repairPayload = {
            step_index: stepIndex,
            repair_attempt: selfCorrectionCount,
            action: repairAction,
            correction_action: correctionAction,
            observation: retryObservation,
            result: retryResult,
            reflection_verdict: reflection.verdict,
            self_healing: repairMeta,
            failure_signature: repairMeta.failure_signature,
          };
          repairAttempts.push(repairPayload);
          step.repair_attempts = [...asList(step.repair_attempts), repairPayload];
          emitEvent('visual_step_repair', repairPayload);
          if (retryResult.midscene_fallback_used) {
            midsceneFallbackCount += 1;
          }
          result = retryResult;
          step.result = retryResult;
        }
        if (!result.success) {
          success = false;
          finalMessage = asText(result.message || 'Codex guided action failed');
          break;
        }
      }
      if (result.terminal) {
        finalMessage = asText(result.message || finalMessage);
        break;
      }

      const postStepIndex = nextStepIndex();
      const postObservation = await observeAndEmit(runtime, postStepIndex, screenshots, 'post_action');
      steps.push({ step_index: postStepIndex, observation: postObservation, result: { success: true, message: 'post-action observation' } });
      for (const assertion of asList(action.assert_after)) {
        if (isWeakAlreadyVisibleStepAssertion(assertion, action, observation)) {
          const normalized = normalizeStructuredAssertion(assertion);
          const skippedResult: JsonObject = {
            ...normalized,
            success: true,
            message: 'Skipped weak step assertion already visible before action; continuing to next step',
            assertion_source: 'codex_guided_weak_previsible_skip',
            execution_strategy: 'codex_guided',
            midscene_fallback_used: false,
            weak_assertion_skipped: true,
          };
          emitEvent('visual_assertion_result', {
            step_index: postStepIndex,
            assertion: skippedResult.assertion || skippedResult.expected,
            success: true,
            message: skippedResult.message,
            assertion_source: skippedResult.assertion_source,
            midscene_fallback_used: false,
            weak_assertion_skipped: true,
          });
          step.assertion_results = [...asList(step.assertion_results), skippedResult];
          continue;
        }
        const assertionResult = await runCodexAssertion(runtime, assertion, postObservation, request);
        emitEvent('visual_assertion_result', {
          step_index: postStepIndex,
          assertion: assertionResult.assertion || assertionResult.expected,
          success: boolValue(assertionResult.success),
          message: asText(assertionResult.message),
          assertion_source: assertionResult.assertion_source,
          midscene_fallback_used: assertionResult.midscene_fallback_used,
        });
        step.assertion_results = [...asList(step.assertion_results), assertionResult];
        if (!assertionResult.success) {
          success = false;
          finalMessage = asText(assertionResult.message || 'Codex guided assertion failed');
          const reflection = await requestStepReflection({
            step_index: stepIndex,
            phase: 'assertion',
            source_step_id: `codex-assertion-${stepIndex}`,
            platform: request.platform,
            test_goal: goal,
            action,
            observation,
            post_observation: postObservation,
            result,
            assertion_results: step.assertion_results,
            history: steps.slice(-8),
            failure_signature: visualFailureSignature({ phase: 'assertion', action, observation: postObservation, result: assertionResult }),
            self_healing: visualSelfHealingContext(selfHealing, stepIndex),
          });
          step.reflection = reflection;
          reflectionEvents.push({ step_index: stepIndex, reflection });
          emitStepReflection(stepIndex, reflection, { phase: 'assertion_result' });
          rememberVisualPathReflection(visualMemory, stepIndex, reflection);
          const repairDecision = canUseVisualSelfHealingRepair(selfHealing, stepIndex, reflection, {
            phase: 'assertion',
            action,
            observation: postObservation,
            result: assertionResult,
          });
          if (repairDecision.allowed) {
            selfCorrectionCount += 1;
            const repairMeta = noteVisualSelfHealingRepair(selfHealing, stepIndex, repairDecision);
            await waitIfPaused(request);
            const correctionAction = primaryReflectionCorrection(reflection);
            if (asText(correctionAction.type).trim() === 'wait') {
              await delay(correctionWaitMs(correctionAction));
            }
            const retryObservation = await observeAndEmit(runtime, nextStepIndex(), screenshots, 'post_action');
            const retryAssertion = await runCodexAssertion(runtime, assertion, retryObservation, request);
            emitEvent('visual_assertion_result', {
              step_index: Number(retryObservation.step_index || stepIndex),
              assertion: retryAssertion.assertion || retryAssertion.expected,
              success: boolValue(retryAssertion.success),
              message: asText(retryAssertion.message),
              assertion_source: retryAssertion.assertion_source,
              midscene_fallback_used: retryAssertion.midscene_fallback_used,
            });
            const repairPayload = {
              step_index: stepIndex,
              repair_attempt: selfCorrectionCount,
              action: { action: 'assert', assertion: retryAssertion.assertion || retryAssertion.expected },
              correction_action: correctionAction,
              observation: retryObservation,
              result: retryAssertion,
              reflection_verdict: reflection.verdict,
              self_healing: repairMeta,
              failure_signature: repairMeta.failure_signature,
            };
            repairAttempts.push(repairPayload);
            step.repair_attempts = [...asList(step.repair_attempts), repairPayload];
            step.assertion_results = [...asList(step.assertion_results), retryAssertion];
            emitEvent('visual_step_repair', repairPayload);
            if (retryAssertion.success) {
              success = true;
              finalMessage = 'Codex guided visual test completed';
              continue;
            }
          }
          break;
        }
      }
      if (success && !step.reflection) {
        const reflection = await requestStepReflection({
          step_index: stepIndex,
          phase: 'post_action',
          source_step_id: `codex-post-action-${stepIndex}`,
          platform: request.platform,
          test_goal: goal,
          action,
          observation,
          post_observation: postObservation,
          result,
          assertion_results: step.assertion_results || [],
          history: steps.slice(-8),
          self_healing: visualSelfHealingContext(selfHealing, stepIndex),
        });
        step.reflection = reflection;
        reflectionEvents.push({ step_index: stepIndex, reflection });
        emitStepReflection(stepIndex, reflection, { phase: 'post_action' });
        rememberVisualPathReflection(visualMemory, stepIndex, reflection);
      }
      if (!success) break;
    }

    const finalObservation = steps.length
      ? (steps[steps.length - 1].observation as JsonObject) || {}
      : await observeAndEmit(runtime, nextStepIndex(), screenshots, 'pre_action');
    for (const assertion of assertions) {
      const assertionResult = await runCodexAssertion(runtime, assertion, finalObservation, request);
      emitEvent('visual_assertion_result', {
        step_index: Number(finalObservation.step_index || nextStep),
        assertion: assertionResult.assertion || assertionResult.expected,
        success: boolValue(assertionResult.success),
        message: asText(assertionResult.message),
        assertion_source: assertionResult.assertion_source,
        midscene_fallback_used: assertionResult.midscene_fallback_used,
      });
      steps.push({ step_index: nextStepIndex(), action: { action: 'assert', execution_strategy: 'codex_guided' }, observation: finalObservation, result: assertionResult });
      if (!assertionResult.success) {
        success = false;
        finalMessage = asText(assertionResult.message || 'Codex guided assertion failed');
        const reflection = await requestStepReflection({
          step_index: Number(finalObservation.step_index || nextStep),
          phase: 'assertion',
          source_step_id: `codex-final-assertion-${Number(finalObservation.step_index || nextStep)}`,
          platform: request.platform,
          test_goal: goal,
          action: { action: 'assert', assertion },
          observation: finalObservation,
          result: assertionResult,
          assertion_results: [assertionResult],
          history: steps.slice(-8),
          failure_signature: visualFailureSignature({ phase: 'assertion', action: { action: 'assert', assertion }, observation: finalObservation, result: assertionResult }),
          self_healing: visualSelfHealingContext(selfHealing, Number(finalObservation.step_index || nextStep)),
        });
        reflectionEvents.push({ step_index: Number(finalObservation.step_index || nextStep), reflection });
        emitStepReflection(Number(finalObservation.step_index || nextStep), reflection, { phase: 'final_assertion' });
        rememberVisualPathReflection(visualMemory, Number(finalObservation.step_index || nextStep), reflection);
        break;
      }
    }

    steps.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
    screenshots.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
    const report = writeReportSafely(traceDir, () => renderReport(runtime.agent), { screenshot_count: screenshots.length });
    const reportArtifactPath = artifactPath(traceDir, report.path);
    const tracePath = writeTrace(traceDir, {
      success,
      mode: 'codex_guided',
      execution_mode: 'codex_guided',
      steps,
      screenshots,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emitEvent('visual_trace_saved', {
      visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
      visual_trace: artifactPath(traceDir, tracePath),
      screenshots,
      step_count: steps.length,
      execution_mode: 'codex_guided',
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emit({
      type: 'result',
      success,
      message: finalMessage,
      execution_mode: 'codex_guided',
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
  } finally {
    await runtime.free();
  }
}

function boolValue(value: unknown): boolean {
  return value === true;
}

type MidsceneStructuredFlowDeps = {
  observeAndEmit?: typeof observeAndEmit;
  waitIfPaused?: typeof waitIfPaused;
  emitEvent?: (eventType: string, payload: JsonObject) => void;
  startObservationHeartbeat?: typeof startObservationHeartbeat;
};

export async function runMidsceneAiStructuredFlow(
  runtime: RuntimeHandle,
  request: RunnerRequest,
  actionSteps: JsonObject[],
  finalAssertions: unknown[],
  steps: JsonObject[],
  screenshots: JsonObject[],
  nextStepIndex: () => number,
  deps: MidsceneStructuredFlowDeps = {},
): Promise<JsonObject> {
  const observeFn = deps.observeAndEmit || observeAndEmit;
  const waitFn = deps.waitIfPaused || waitIfPaused;
  const emitEventFn = deps.emitEvent || emitEvent;
  const startHeartbeatFn = deps.startObservationHeartbeat || startObservationHeartbeat;
  const maxSteps = clampStepLimit(request.slots?.max_steps, DEFAULT_MAX_STEPS);
  const slots = request.slots || {};
  const goal = asText(slots.test_goal).trim();
  const expectedResult = asText(firstConfiguredValue(slots.expected_result, slots.expected)).trim();
  const selfHealing = createVisualSelfHealingState(slots);
  const visualMemory = createVisualPathMemoryState(slots);
  const totalSteps = Math.min(actionSteps.length, maxSteps);
  let success = true;
  let finalMessage = 'Midscene structured test completed';

  for (const [actionIndex, rawAction] of actionSteps.slice(0, maxSteps).entries()) {
    const stepIndex = nextStepIndex();
    const observation = await observeFn(runtime, stepIndex, screenshots, 'pre_action');
    await waitFn(request);
    const instruction = appendVisualPathMemoryInstruction(formatMidsceneStepInstruction(rawAction, {
      goal,
      expectedResult,
      finalAssertions,
      stepIndex: actionIndex + 1,
      totalSteps,
    }), visualMemory);
    emitVisualPathMemoryApplied(visualMemory, stepIndex, emitEventFn);
    const action: JsonObject = applyVisualPathMemoryToAction({
      action: 'aiAct',
      reason: instruction,
      original_action: rawAction.action,
      intent: rawAction.intent,
      target: rawAction.target,
      value: rawAction.value,
      wait_for: rawAction.wait_for,
      source: rawAction.source,
      execution_strategy: 'midscene_ai',
      structured_step: true,
    }, visualMemory, stepIndex, emitEventFn);
    emitEventFn('visual_action_planned', { step_index: stepIndex, action });
    const stopHeartbeat = startHeartbeatFn(runtime, request, screenshots, steps, nextStepIndex);
    let actResult: unknown;
    try {
      actResult = await runtime.agent.aiAct(instruction);
    } finally {
      await stopHeartbeat();
    }
    const result = { success: true, message: asText(actResult || 'aiAct completed'), execution_strategy: 'midscene_ai' };
    emitEventFn('visual_action_executed', { step_index: stepIndex, action: 'aiAct', ...result });
    const step: JsonObject = { step_index: stepIndex, observation, action, result };
    steps.push(step);

    let postObservation = observation;
    try {
      const postStepIndex = nextStepIndex();
      postObservation = await observeFn(runtime, postStepIndex, screenshots, 'post_action');
      steps.push({
        step_index: postStepIndex,
        observation: postObservation,
        result: { success: true, message: 'post-action observation' },
      });
    } catch (error) {
      emit({ type: 'log', message: `Midscene post-action observation failed: ${error instanceof Error ? error.message : String(error)}` });
    }

    for (const assertion of asList(rawAction.assert_after)) {
      const assertionText = formatMidsceneAssertionText(assertion);
      if (!assertionText) continue;
      await waitFn(request);
      const assertionResult = await runtime.agent.aiAssert(assertionText);
      const pass = assertionResult?.pass !== false;
      const assertionPayload = {
        step_index: Number(postObservation.step_index || stepIndex),
        assertion: assertionText,
        success: pass,
        message: asText(assertionResult?.message || assertionResult?.thought || (pass ? `Midscene assertion passed: ${assertionText}` : `Midscene assertion failed: ${assertionText}`)),
        assertion_source: 'midscene_ai',
        execution_strategy: 'midscene_ai',
      };
      emitEventFn('visual_assertion_result', assertionPayload);
      step.assertion_results = [...asList(step.assertion_results), assertionPayload];
      if (!pass) {
        success = false;
        finalMessage = assertionPayload.message;
        break;
      }
    }
    const reflection = await requestStepReflection({
      step_index: stepIndex,
      phase: 'post_action',
      source_step_id: `midscene-ai-step-${stepIndex}`,
      platform: request.platform,
      test_goal: goal,
      action,
      observation,
      post_observation: postObservation,
      result,
      assertion_results: step.assertion_results || [],
      history: steps.slice(-8),
      failure_signature: visualFailureSignature({ phase: 'post_action', action, observation, result }),
      self_healing: visualSelfHealingContext(selfHealing, stepIndex),
    });
    step.reflection = reflection;
    emitStepReflection(stepIndex, reflection, { phase: 'midscene_ai_step' });
    rememberVisualPathReflection(visualMemory, stepIndex, reflection, emitEventFn);
    const repairDecision = canUseVisualSelfHealingRepair(selfHealing, stepIndex, reflection, {
      phase: 'post_action',
      action,
      observation,
      result,
    });
    if (repairDecision.allowed) {
      const repairMeta = noteVisualSelfHealingRepair(selfHealing, stepIndex, repairDecision);
      const correctionAction = primaryReflectionCorrection(reflection);
      if (asText(correctionAction.type).trim() === 'wait') {
        await delay(correctionWaitMs(correctionAction));
      }
      const repairPayload = {
        step_index: stepIndex,
        repair_attempt: repairMeta.case_repair_count,
        action: { action: 'reobserve' },
        correction_action: correctionAction,
        observation: postObservation,
        result: { success: true, message: 'Midscene reflection requested re-observation before continuing.' },
        reflection_verdict: reflection.verdict,
        self_healing: repairMeta,
        failure_signature: repairMeta.failure_signature,
      };
      step.repair_attempts = [...asList(step.repair_attempts), repairPayload];
      emitEventFn('visual_step_repair', repairPayload);
    }
    if (!success) {
      return {
        success,
        message: finalMessage,
        self_healing: visualSelfHealingTracePayload(selfHealing),
        failure_signatures: selfHealing.failureEvents,
        self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
        visual_execution_memory: visualPathMemorySnapshot(visualMemory),
        visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
      };
    }
  }

  const finalObservation = steps.length
    ? (steps[steps.length - 1].observation as JsonObject) || {}
    : await observeFn(runtime, nextStepIndex(), screenshots, 'pre_action');
  for (const assertion of finalAssertions) {
    const assertionText = formatMidsceneAssertionText(assertion);
    if (!assertionText) continue;
    const assertionStepIndex = nextStepIndex();
    await waitFn(request);
    const assertionResult = await runtime.agent.aiAssert(assertionText);
    const pass = assertionResult?.pass !== false;
    const assertionPayload = {
      step_index: assertionStepIndex,
      assertion: assertionText,
      success: pass,
      message: asText(assertionResult?.message || assertionResult?.thought || (pass ? `Midscene assertion passed: ${assertionText}` : `Midscene assertion failed: ${assertionText}`)),
      assertion_source: 'midscene_ai',
      execution_strategy: 'midscene_ai',
    };
    emitEventFn('visual_assertion_result', assertionPayload);
    steps.push({
      step_index: assertionStepIndex,
      action: { action: 'aiAssert', assertion: assertionText, execution_strategy: 'midscene_ai' },
      observation: finalObservation,
      result: assertionPayload,
    });
    if (!pass) {
      success = false;
      finalMessage = assertionPayload.message;
      break;
    }
  }
  return {
    success,
    message: finalMessage,
    self_healing: visualSelfHealingTracePayload(selfHealing),
    failure_signatures: selfHealing.failureEvents,
    self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
    visual_execution_memory: visualPathMemorySnapshot(visualMemory),
    visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
  };
}

async function runTest(request: RunnerRequest): Promise<void> {
  const mcpMode = asText(request.slots?.execution_mode) === 'mcp_tool_loop';
  const codexMode = asText(request.slots?.execution_mode) === 'codex_guided';
  if (request.mock_mode || request.slots?.mock_mode || process.env.MIDSCENE_RUNNER_MOCK === '1') {
    await runMock(request, false, mcpMode, codexMode);
    return;
  }
  if (codexMode) {
    await runCodexGuidedTest(request);
    return;
  }
  if (mcpMode) {
    await runMcpToolLoop(request);
    return;
  }
  const traceDir = ensureTraceDir(request);
  const slots = request.slots || {};
  const dispatch = prepareMidsceneAiDispatch(slots);
  const structuredActionSteps = dispatch.actionSteps;
  const assertions = dispatch.finalAssertions;
  const goal = dispatch.goal;
  const testSteps = dispatch.testSteps;
  const expectedResult = dispatch.expectedResult;
  const actionGoal = formatActionGoal(goal, testSteps, expectedResult, formatNonActionExecutionContext(slots));
  if (isHighRiskText(goal, testSteps, structuredActionSteps, assertions)) {
    throw new Error('high-risk action text reached sidecar; backend should have blocked before execution');
  }
  emitEvent('visual_midscene_dispatch_prepared', dispatch.eventPayload);

  const runtime = await setupAgent(request);
  const steps: JsonObject[] = [];
  const screenshots: JsonObject[] = [];
  const reflectionEvents: JsonObject[] = [];
  const repairAttempts: JsonObject[] = [];
  let selfCorrectionCount = 0;
  const selfHealing = createVisualSelfHealingState(slots);
  const visualMemory = createVisualPathMemoryState(slots);
  let nextStep = 1;
  const nextStepIndex = () => nextStep++;
  try {
    if (structuredActionSteps.length) {
      const flowResult = await runMidsceneAiStructuredFlow(
        runtime,
        request,
        structuredActionSteps,
        assertions,
        steps,
        screenshots,
        nextStepIndex,
      );
      steps.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
      screenshots.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
      const structuredReflectionEvents = steps
        .filter((item) => item.reflection && typeof item.reflection === 'object' && !Array.isArray(item.reflection))
        .map((item) => ({ step_index: item.step_index, reflection: item.reflection }));
      const structuredRepairAttempts = steps.flatMap((item) => asList(item.repair_attempts).filter((repair) => repair && typeof repair === 'object')) as JsonObject[];
      const report = writeReportSafely(traceDir, () => renderReport(runtime.agent), { screenshot_count: screenshots.length });
      const reportArtifactPath = artifactPath(traceDir, report.path);
      const tracePath = writeTrace(traceDir, {
        success: flowResult.success === true,
        mode: 'midscene_ai_structured',
        execution_mode: 'midscene_ai',
        steps,
        screenshots,
        midscene_report: reportArtifactPath,
        report_truncated: report.truncated,
        report_original_size_bytes: report.originalSizeBytes,
        report_written_size_bytes: report.writtenSizeBytes,
        report_generation_error: report.error || undefined,
        reflection_events: structuredReflectionEvents,
        repair_attempts: structuredRepairAttempts,
        self_correction_count: structuredRepairAttempts.length,
        self_healing: flowResult.self_healing,
        failure_signatures: flowResult.failure_signatures,
        self_healing_stopped_reason: flowResult.self_healing_stopped_reason,
        visual_execution_memory: flowResult.visual_execution_memory,
        visual_path_memory_deltas: flowResult.visual_path_memory_deltas,
      });
      emitEvent('visual_trace_saved', {
        visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
        visual_trace: artifactPath(traceDir, tracePath),
        screenshots,
        step_count: steps.length,
        execution_mode: 'midscene_ai',
        midscene_report: reportArtifactPath,
        report_truncated: report.truncated,
        report_original_size_bytes: report.originalSizeBytes,
        report_written_size_bytes: report.writtenSizeBytes,
        report_generation_error: report.error || undefined,
        reflection_events: structuredReflectionEvents,
        repair_attempts: structuredRepairAttempts,
        self_correction_count: structuredRepairAttempts.length,
        self_healing: flowResult.self_healing,
        failure_signatures: flowResult.failure_signatures,
        self_healing_stopped_reason: flowResult.self_healing_stopped_reason,
        visual_execution_memory: flowResult.visual_execution_memory,
        visual_path_memory_deltas: flowResult.visual_path_memory_deltas,
      });
      emit({
        type: 'result',
        success: flowResult.success === true,
        message: asText(flowResult.message || 'Midscene structured test completed'),
        execution_mode: 'midscene_ai',
        midscene_report: reportArtifactPath,
        report_truncated: report.truncated,
        report_original_size_bytes: report.originalSizeBytes,
        report_written_size_bytes: report.writtenSizeBytes,
        report_generation_error: report.error || undefined,
        reflection_events: structuredReflectionEvents,
        repair_attempts: structuredRepairAttempts,
        self_correction_count: structuredRepairAttempts.length,
        self_healing: flowResult.self_healing,
        failure_signatures: flowResult.failure_signatures,
        self_healing_stopped_reason: flowResult.self_healing_stopped_reason,
        visual_execution_memory: flowResult.visual_execution_memory,
        visual_path_memory_deltas: flowResult.visual_path_memory_deltas,
      });
      return;
    }

    const actionStepIndex = nextStepIndex();
    const observation = await observeAndEmit(runtime, actionStepIndex, screenshots, 'pre_action');

    await waitIfPaused(request);
    const action = applyVisualPathMemoryToAction({ action: 'aiAct', reason: actionGoal || goal, risk_level: 'low' }, visualMemory, actionStepIndex);
    emitEvent('visual_action_planned', { step_index: actionStepIndex, action });
    const stopHeartbeat = startObservationHeartbeat(runtime, request, screenshots, steps, nextStepIndex);
    let actResult: unknown;
    try {
      actResult = await runtime.agent.aiAct(asText(action.reason || actionGoal || goal));
    } finally {
      await stopHeartbeat();
    }
    const result = { success: true, message: asText(actResult || 'aiAct completed') };
    emitEvent('visual_action_executed', { step_index: actionStepIndex, action: 'aiAct', ...result });
    steps.push({ step_index: actionStepIndex, observation, action, result });

    try {
      const postStepIndex = nextStepIndex();
      const postObservation = await observeAndEmit(runtime, postStepIndex, screenshots, 'post_action');
      steps.push({
        step_index: postStepIndex,
        observation: postObservation,
        result: { success: true, message: 'post-action observation' },
      });
    } catch (error) {
      emit({ type: 'log', message: `Midscene post-action observation failed: ${error instanceof Error ? error.message : String(error)}` });
    }

    for (const assertion of assertions) {
      const assertionStepIndex = nextStepIndex();
      await waitIfPaused(request);
      const assertionResult = await runtime.agent.aiAssert(assertion);
      const pass = assertionResult?.pass !== false;
      emitEvent('visual_assertion_result', {
        step_index: assertionStepIndex,
        assertion,
        success: pass,
        message: asText(assertionResult?.message || assertionResult?.thought || ''),
      });
      if (!pass) throw new Error(`Midscene assertion failed: ${assertion}`);
    }

    const actionStep = steps.find((item) => Number(item.step_index || 0) === actionStepIndex);
    if (actionStep) {
      const latestObservation = (steps[steps.length - 1]?.observation as JsonObject) || observation;
      const reflection = await requestStepReflection({
        step_index: actionStepIndex,
        phase: 'post_action',
        source_step_id: `midscene-ai-action-${actionStepIndex}`,
        platform: request.platform,
        test_goal: goal,
        action,
        observation,
        post_observation: latestObservation,
        result: actionStep.result as JsonObject,
        history: steps.slice(-8),
        failure_signature: visualFailureSignature({ phase: 'post_action', action, observation, result: actionStep.result as JsonObject }),
        self_healing: visualSelfHealingContext(selfHealing, actionStepIndex),
      });
      actionStep.reflection = reflection;
      reflectionEvents.push({ step_index: actionStepIndex, reflection });
      emitStepReflection(actionStepIndex, reflection, { phase: 'midscene_ai_action' });
      rememberVisualPathReflection(visualMemory, actionStepIndex, reflection);
      const repairDecision = canUseVisualSelfHealingRepair(selfHealing, actionStepIndex, reflection, {
        phase: 'post_action',
        action,
        observation,
        result: actionStep.result as JsonObject,
      });
      if (repairDecision.allowed) {
        selfCorrectionCount += 1;
        const repairMeta = noteVisualSelfHealingRepair(selfHealing, actionStepIndex, repairDecision);
        const correctionAction = primaryReflectionCorrection(reflection);
        if (asText(correctionAction.type).trim() === 'wait') {
          await delay(correctionWaitMs(correctionAction));
        }
        const repairPayload = {
          step_index: actionStepIndex,
          repair_attempt: selfCorrectionCount,
          action: { action: 'reobserve' },
          correction_action: correctionAction,
          observation: latestObservation,
          result: { success: true, message: 'Midscene reflection requested re-observation before continuing.' },
          reflection_verdict: reflection.verdict,
          self_healing: repairMeta,
          failure_signature: repairMeta.failure_signature,
        };
        repairAttempts.push(repairPayload);
        actionStep.repair_attempts = [...asList(actionStep.repair_attempts), repairPayload];
        emitEvent('visual_step_repair', repairPayload);
      }
    }

    steps.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
    screenshots.sort((left, right) => Number(left.step_index || 0) - Number(right.step_index || 0));
    const report = writeReportSafely(traceDir, () => renderReport(runtime.agent), { screenshot_count: screenshots.length });
    const reportArtifactPath = artifactPath(traceDir, report.path);
    const tracePath = writeTrace(traceDir, {
      success: true,
      steps,
      screenshots,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emitEvent('visual_trace_saved', {
      visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
      visual_trace: artifactPath(traceDir, tracePath),
      screenshots,
      step_count: steps.length,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emit({
      type: 'result',
      success: true,
      message: 'Midscene test completed',
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
  } finally {
    await runtime.free();
  }
}

async function listMcpTools(request: RunnerRequest): Promise<void> {
  const runtime = await setupAgent(request);
  try {
    const kit = await setupMcpKit(request, runtime.agent);
    emit({
      type: 'result',
      success: true,
      message: 'Midscene MCP tools listed',
      mcp_description: kit.description,
      mcp_tools_available: publicMcpTools(kit.tools),
    });
  } finally {
    await runtime.free();
  }
}

async function callSingleMcpTool(request: RunnerRequest): Promise<void> {
  const name = asText(request.mcp_tool_name || request.slots?.mcp_tool_name).trim();
  const args = (request.mcp_arguments || request.slots?.mcp_arguments || {}) as JsonObject;
  if (!name) throw new Error('mcp_tool_name is required');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('mcp_arguments must be a JSON object');
  if (isHighRiskText(name, args)) throw new Error('high-risk MCP tool call reached sidecar; backend should have blocked before execution');
  const runtime = await setupAgent(request);
  try {
    const kit = await setupMcpKit(request, runtime.agent);
    const result = await callMcpTool(kit.tools, name, args);
    emit({
      type: 'result',
      success: true,
      message: `Midscene MCP tool completed: ${name}`,
      mcp_tool_name: name,
      mcp_arguments: args,
      mcp_result: safePublicValue(result),
    });
  } finally {
    await runtime.free();
  }
}

async function runMcpToolLoop(request: RunnerRequest): Promise<void> {
  const traceDir = ensureTraceDir(request);
  const slots = request.slots || {};
  const assertions = asList(slots.assertions).map(asText).filter(Boolean);
  const goal = asText(slots.test_goal).trim();
  const testSteps = coerceTestSteps(slots.test_steps);
  const expectedResult = asText(firstConfiguredValue(slots.expected_result, slots.expected)).trim();
  if (isHighRiskText(goal, testSteps, assertions)) {
    throw new Error('high-risk action text reached sidecar; backend should have blocked before execution');
  }

  const runtime = await setupAgent(request);
  const steps: JsonObject[] = [];
  const screenshots: JsonObject[] = [];
  const history: JsonObject[] = [];
  const reflectionEvents: JsonObject[] = [];
  const repairAttempts: JsonObject[] = [];
  let selfCorrectionCount = 0;
  const selfHealing = createVisualSelfHealingState(slots);
  const visualMemory = createVisualPathMemoryState(slots);
  let stepIndex = 1;
  let success = false;
  let finalMessage = 'Midscene MCP tool loop ended without finish';
  let terminalStatus = '';
  try {
    const kit = await setupMcpKit(request, runtime.agent);
    const publicTools = publicMcpTools(kit.tools);
    let observation = await runtime.observe(stepIndex);
    observation = { ...observation, mcp_tools_available: publicTools };
    screenshots.push({ step_index: stepIndex, artifact_path: observation.screenshot_artifact_path });
    emitEvent('visual_observed', observation);

    const maxCalls = clampStepLimit(firstConfiguredValue(slots.max_tool_calls, slots.max_steps, DEFAULT_MAX_STEPS));
    for (let callIndex = 0; callIndex < maxCalls; callIndex += 1) {
      await waitIfPaused(request);
      const requestId = `mcp-decision-${Date.now()}-${callIndex}`;
      emit({
        type: 'mcp_decision_request',
        request_id: requestId,
        step_index: stepIndex,
        platform: request.platform,
        test_goal: goal,
        test_steps: testSteps,
        case_id: asText(slots.case_id).trim(),
        case_title: asText(slots.case_title).trim(),
        expected_result: expectedResult,
        assertions,
        observation,
        history,
        mcp_description: kit.description,
        mcp_tools_available: publicTools,
        visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      });
      const decision = await readJsonLine() as McpDecision;
      const kind = asText(decision.decision || 'call_tool').trim();
      if (kind === 'finish') {
        finalMessage = asText(decision.message || decision.reason || 'Midscene MCP test completed');
        success = true;
        break;
      }
      if (kind === 'blocked') {
        finalMessage = asText(decision.message || decision.reason || 'Midscene MCP decision blocked');
        terminalStatus = asText(decision.terminal_status).trim();
        const action = applyVisualPathMemoryToAction({ action: 'mcp_blocked', reason: finalMessage, risk_level: terminalStatus === 'awaiting_approval' ? 'high' : 'medium' }, visualMemory, stepIndex);
        emitEvent('visual_action_planned', { step_index: stepIndex, action });
        emitEvent('visual_action_executed', { step_index: stepIndex, success: false, message: finalMessage, terminal_status: terminalStatus });
        const blockedStep: JsonObject = { step_index: stepIndex, observation, action, result: { success: false, message: finalMessage, terminal_status: terminalStatus } };
        const reflection = await requestStepReflection({
          step_index: stepIndex,
          phase: 'post_action',
          source_step_id: `mcp-blocked-${stepIndex}`,
          platform: request.platform,
          test_goal: goal,
          action,
          observation,
          result: blockedStep.result,
          history,
          failure_signature: visualFailureSignature({ phase: 'post_action', action, observation, result: blockedStep.result }),
          self_healing: visualSelfHealingContext(selfHealing, stepIndex),
        });
        blockedStep.reflection = reflection;
        reflectionEvents.push({ step_index: stepIndex, reflection });
        emitStepReflection(stepIndex, reflection, { phase: 'mcp_blocked' });
        rememberVisualPathReflection(visualMemory, stepIndex, reflection);
        steps.push(blockedStep);
        success = false;
        break;
      }
      if (kind === 'assert') {
        const assertion = asText(decision.assertion || decision.message).trim();
        if (!assertion) throw new Error('MCP assert decision requires assertion');
        const assertionResult = await runtime.agent.aiAssert(assertion);
        const pass = assertionResult?.pass !== false;
        const message = asText(assertionResult?.message || assertionResult?.thought || assertion);
        emitEvent('visual_assertion_result', { step_index: stepIndex, assertion, success: pass, message });
        history.push({ decision: kind, assertion, success: pass, message });
        if (!pass) {
          throw new Error(`Midscene MCP assertion failed: ${assertion}`);
        }
        continue;
      }
      if (kind !== 'call_tool') throw new Error(`unsupported MCP decision: ${kind}`);

      const toolName = asText(decision.mcp_tool_name).trim();
      const toolArgs = decision.mcp_arguments || {};
      if (!toolName) throw new Error('MCP call_tool decision requires mcp_tool_name');
      if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) throw new Error('mcp_arguments must be a JSON object');
      if (!kit.tools.some((tool) => tool.name === toolName)) throw new Error(`unknown MCP tool from decision: ${toolName}`);
      if (isHighRiskText(toolName, toolArgs)) throw new Error(`high-risk MCP tool call blocked: ${toolName}`);

      const action = applyVisualPathMemoryToAction({
        action: 'mcp_tool',
        reason: asText(decision.reason || decision.message || toolName),
        risk_level: 'low',
        mcp_tool_name: toolName,
        mcp_arguments: safePublicValue(toolArgs),
      }, visualMemory, stepIndex);
      emitEvent('visual_action_planned', { step_index: stepIndex, action, mcp_tool_name: toolName, mcp_arguments: safePublicValue(toolArgs) });
      const mcpResult = await callMcpTool(kit.tools, toolName, toolArgs);
      const publicResult = safePublicValue(mcpResult);
      const result = { success: true, message: `MCP tool completed: ${toolName}`, mcp_tool_name: toolName, mcp_result: publicResult };
      emitEvent('visual_action_executed', { step_index: stepIndex, ...result, mcp_arguments: safePublicValue(toolArgs) });
      const step: JsonObject = { step_index: stepIndex, observation, action, result };
      steps.push(step);
      history.push({ decision: kind, mcp_tool_name: toolName, mcp_arguments: safePublicValue(toolArgs), mcp_result: publicResult });

      stepIndex += 1;
      const observedAfterTool = await runtime.observe(stepIndex) as JsonObject;
      const postObservation: JsonObject = { ...observedAfterTool, mcp_tools_available: publicTools };
      observation = postObservation;
      screenshots.push({ step_index: stepIndex, artifact_path: postObservation.screenshot_artifact_path });
      emitEvent('visual_observed', postObservation);
      const reflection = await requestStepReflection({
        step_index: Number(step.step_index || stepIndex),
        phase: 'post_action',
        source_step_id: `mcp-tool-${Number(step.step_index || stepIndex)}`,
        platform: request.platform,
        test_goal: goal,
        action,
        observation: step.observation as JsonObject,
        post_observation: postObservation,
        result,
        history,
        mcp_tools_available: publicTools,
        failure_signature: visualFailureSignature({ phase: 'post_action', action, observation: step.observation as JsonObject, result }),
        self_healing: visualSelfHealingContext(selfHealing, Number(step.step_index || stepIndex)),
      });
      step.reflection = reflection;
      reflectionEvents.push({ step_index: Number(step.step_index || stepIndex), reflection });
      emitStepReflection(Number(step.step_index || stepIndex), reflection, { phase: 'mcp_tool_result' });
      rememberVisualPathReflection(visualMemory, Number(step.step_index || stepIndex), reflection);
      const reflectionStepIndex = Number(step.step_index || stepIndex);
      const repairDecision = canUseVisualSelfHealingRepair(selfHealing, reflectionStepIndex, reflection, {
        phase: 'post_action',
        action,
        observation: step.observation as JsonObject,
        result,
      });
      if (repairDecision.allowed) {
        selfCorrectionCount += 1;
        const repairMeta = noteVisualSelfHealingRepair(selfHealing, reflectionStepIndex, repairDecision);
        const correctionAction = primaryReflectionCorrection(reflection);
        if (asText(correctionAction.type).trim() === 'wait') {
          await delay(correctionWaitMs(correctionAction));
        }
        const repairPayload = {
          step_index: reflectionStepIndex,
          repair_attempt: selfCorrectionCount,
          action: { action: 'reobserve' },
          correction_action: correctionAction,
          observation: postObservation,
          result: { success: true, message: 'MCP reflection requested re-observation before continuing.' },
          reflection_verdict: reflection.verdict,
          self_healing: repairMeta,
          failure_signature: repairMeta.failure_signature,
        };
        repairAttempts.push(repairPayload);
        step.repair_attempts = [...asList(step.repair_attempts), repairPayload];
        emitEvent('visual_step_repair', repairPayload);
      }
    }

    if (success && assertions.length) {
      for (const assertion of assertions) {
        const assertionResult = await runtime.agent.aiAssert(assertion);
        const pass = assertionResult?.pass !== false;
        const message = asText(assertionResult?.message || assertionResult?.thought || assertion);
        emitEvent('visual_assertion_result', { step_index: stepIndex, assertion, success: pass, message });
        if (!pass) {
          success = false;
          finalMessage = `Midscene MCP assertion failed: ${assertion}`;
          break;
        }
      }
    } else if (!success && finalMessage === 'Midscene MCP tool loop ended without finish') {
      finalMessage = 'Midscene MCP tool loop reached max tool calls';
    }

    const report = writeReportSafely(traceDir, () => renderReport(runtime.agent), { screenshot_count: screenshots.length });
    const reportArtifactPath = artifactPath(traceDir, report.path);
    const tracePath = writeTrace(traceDir, {
      success,
      mode: 'mcp_tool_loop',
      steps,
      screenshots,
      history,
      mcp_tools_available: publicTools,
      terminal_status: terminalStatus || undefined,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emitEvent('visual_trace_saved', {
      visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
      visual_trace: artifactPath(traceDir, tracePath),
      screenshots,
      step_count: steps.length,
      mcp_tools_available: publicTools,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    emit({
      type: 'result',
      success,
      message: finalMessage,
      mcp_tools_available: publicTools,
      terminal_status: terminalStatus || undefined,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
      reflection_events: reflectionEvents,
      repair_attempts: repairAttempts,
      self_correction_count: selfCorrectionCount,
      self_healing: visualSelfHealingTracePayload(selfHealing),
      failure_signatures: selfHealing.failureEvents,
      self_healing_stopped_reason: selfHealing.stoppedReason || undefined,
      visual_execution_memory: visualPathMemorySnapshot(visualMemory),
      visual_path_memory_deltas: visualMemory.pathMemoryDeltas,
    });
    if (!success) process.exitCode = 1;
  } finally {
    await runtime.free();
  }
}

function sessionRequestId(command: JsonObject): string {
  return asText(command.request_id || command.requestId || `session-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`);
}

function sessionIdFromCommand(command: JsonObject): string {
  const value = asText(firstConfiguredValue(command.session_id, command.sessionId, command.task_id, command.taskId));
  return value.trim() || `midscene-session-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function sessionSlots(command: JsonObject): JsonObject {
  const slots = command.slots && typeof command.slots === 'object' && !Array.isArray(command.slots)
    ? { ...(command.slots as JsonObject) }
    : {};
  for (const key of [
    'app_package',
    'start_url',
    'device_id',
    'test_goal',
    'case_id',
    'case_title',
    'expected_result',
    'force_stop_before_launch',
    'android_force_stop_before_launch',
    'max_steps',
  ]) {
    if (command[key] !== undefined && slots[key] === undefined) slots[key] = command[key];
  }
  return slots;
}

function sessionRunnerRequest(command: JsonObject): RunnerRequest {
  const slots = sessionSlots(command);
  const platform = asText(firstConfiguredValue(command.platform, slots.platform, slots.start_url ? 'web' : 'android')).trim() === 'web'
    ? 'web'
    : 'android';
  const traceDir = asText(command.trace_dir || command.traceDir).trim();
  return {
    job_id: asText(firstConfiguredValue(command.job_id, command.jobId, command.task_id, command.taskId, sessionIdFromCommand(command))),
    platform,
    trace_dir: traceDir || undefined,
    slots,
    mock_mode: command.mock_mode === true || slots.mock_mode === true,
  };
}

function mockSessionObservation(state: MidsceneSessionState, stepIndex: number): JsonObject {
  const observations = asList(state.request.slots?.mock_observations).filter((item): item is JsonObject => isRecord(item));
  const configured = observations[Math.max(0, stepIndex - 1)] || observations[0] || {};
  const shot = screenshotPath(state.traceDir, stepIndex);
  writeFileSync(shot, PLACEHOLDER_PNG);
  const visibleText = asText(configured.visible_text || configured.summary || 'mock Midscene screen');
  return {
    step_index: stepIndex,
    platform: asText(state.request.platform || 'mock'),
    screenshot_artifact_path: artifactPath(state.traceDir, shot),
    ui_tree: asText(configured.ui_tree || visibleText),
    visible_text: visibleText,
    screen_size: configured.screen_size || { width: 1, height: 1 },
    current_ref: asText(configured.current_ref || state.request.slots?.start_url || state.request.slots?.app_package || 'mock://midscene'),
    summary: visibleText.slice(0, 160),
    observation_source: 'session_mock',
  };
}

function safeSessionAction(command: JsonObject): JsonObject {
  if (isRecord(command.action)) return command.action as JsonObject;
  const actionName = asText(firstConfiguredValue(command.action, command.type, command.name)).trim();
  const target = isRecord(command.target) ? command.target as JsonObject : {};
  const value = firstConfiguredValue(command.value, command.text, command.input);
  const intent = asText(firstConfiguredValue(command.intent, command.instruction, command.reason, command.message)).trim();
  return {
    action: actionName || 'aiAct',
    target,
    value,
    intent,
    reason: intent,
    allow_midscene_fallback: command.allow_midscene_fallback !== false,
  };
}

function sessionInstruction(command: JsonObject): string {
  return asText(firstConfiguredValue(command.instruction, command.intent, command.message, command.test_goal, command.goal)).trim();
}

function parseAdbArgs(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asText(item).trim()).filter(Boolean);
  const text = asText(value).trim();
  if (!text) return [];
  return text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function adbCommandAllowed(args: string[]): boolean {
  if (!args.length) return false;
  if (args[0] === 'shell') {
    const shell = args.slice(1);
    if (!shell.length) return false;
    if (shell[0] === 'am' && shell[1] === 'force-stop' && shell.length === 3) return true;
    if (shell[0] === 'monkey' && shell.includes('-p') && shell.includes('android.intent.category.LAUNCHER')) return true;
    if (shell[0] === 'input' && ['tap', 'swipe', 'keyevent', 'text'].includes(shell[1] || '')) return true;
    if (shell[0] === 'wm' && ['size', 'density'].includes(shell[1] || '')) return true;
    if (shell[0] === 'dumpsys' && ['window', 'activity', 'package', 'input_method'].includes(shell[1] || '')) return true;
    if (shell[0] === 'uiautomator' && shell[1] === 'dump') return true;
    if (shell[0] === 'screencap') return true;
    return false;
  }
  return ['devices', 'get-state'].includes(args[0]);
}

function runAllowedAdb(command: JsonObject, state: MidsceneSessionState): JsonObject {
  const args = parseAdbArgs(firstConfiguredValue(command.args, command.adb_args, command.command));
  if (!adbCommandAllowed(args)) {
    return { success: false, message: `ADB command is not allowed: ${args.join(' ')}`, allowed: false };
  }
  const deviceId = asText(firstConfiguredValue(command.device_id, command.deviceId, state.request.slots?.device_id)).trim();
  const timeout = Math.max(1000, Math.min(60000, Number(command.timeout_ms || command.timeoutMs || 10000) || 10000));
  try {
    const output = adbTextStrict(deviceId, args, timeout);
    return {
      success: true,
      message: 'ADB command completed',
      args,
      output: clipText(output, 8000),
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      args,
    };
  }
}

async function startMidsceneSession(command: JsonObject): Promise<MidsceneSessionState> {
  const request = sessionRunnerRequest(command);
  const sessionId = sessionIdFromCommand(command);
  const traceDir = ensureTraceDir(request);
  const mockMode = request.mock_mode === true || process.env.MIDSCENE_RUNNER_MOCK === '1';
  const runtime = mockMode ? null : await setupAgent(request);
  return {
    sessionId,
    request,
    runtime,
    traceDir,
    steps: [],
    screenshots: [],
    assertions: [],
    history: [],
    stepIndex: 1,
    latestObservation: null,
    mockMode,
    finished: false,
  };
}

async function sessionObserve(state: MidsceneSessionState, source = 'manual_observe'): Promise<JsonObject> {
  const stepIndex = state.stepIndex;
  const observation = state.mockMode
    ? mockSessionObservation(state, stepIndex)
    : await observeAndEmit(state.runtime as RuntimeHandle, stepIndex, state.screenshots, source === 'post_action' ? 'post_action' : 'pre_action');
  if (state.mockMode) {
    state.screenshots.push({
      step_index: stepIndex,
      artifact_path: observation.screenshot_artifact_path,
      observation_source: source,
    });
    emitEvent('visual_observed', observation);
  }
  state.latestObservation = observation;
  state.stepIndex += 1;
  return observation;
}

async function sessionAction(state: MidsceneSessionState, command: JsonObject): Promise<JsonObject> {
  const action = safeSessionAction(command);
  const observation = state.latestObservation || await sessionObserve(state, 'pre_action');
  const result = state.mockMode
    ? { success: true, message: asText(action.intent || action.reason || action.action || 'mock session action'), execution_strategy: 'session_mock' }
    : await executeCodexStep(state.runtime as RuntimeHandle, state.request, action, observation);
  const step = {
    step_index: Number(observation.step_index || state.stepIndex - 1),
    observation,
    action,
    result,
  };
  state.steps.push(step);
  state.history.push({ action, result });
  emitEvent('visual_action_planned', { step_index: step.step_index, action });
  emitEvent('visual_action_executed', { step_index: step.step_index, action: action.action, ...result });
  let postObservation: JsonObject | null = null;
  if (command.observe_after !== false && result.terminal !== true) {
    postObservation = await sessionObserve(state, 'post_action');
    (step as JsonObject).post_observation = postObservation;
  }
  return { success: result.success !== false, message: asText(result.message || 'action completed'), result, observation: postObservation || observation };
}

async function sessionAiAct(state: MidsceneSessionState, command: JsonObject): Promise<JsonObject> {
  const instruction = sessionInstruction(command);
  if (!instruction) return { success: false, message: 'ai_act requires instruction' };
  const observation = state.latestObservation || await sessionObserve(state, 'pre_action');
  const result = state.mockMode
    ? { success: true, message: instruction, execution_strategy: 'session_mock' }
    : { success: true, message: asText(await (state.runtime as RuntimeHandle).agent.aiAct(instruction) || 'aiAct completed'), execution_strategy: 'midscene_ai' };
  const action = { action: 'aiAct', instruction, reason: instruction };
  const step = {
    step_index: Number(observation.step_index || state.stepIndex - 1),
    observation,
    action,
    result,
  };
  state.steps.push(step);
  state.history.push({ action, result });
  emitEvent('visual_action_planned', { step_index: step.step_index, action });
  emitEvent('visual_action_executed', { step_index: step.step_index, action: 'aiAct', ...result });
  let postObservation: JsonObject | null = null;
  if (command.observe_after !== false) {
    postObservation = await sessionObserve(state, 'post_action');
    (step as JsonObject).post_observation = postObservation;
  }
  return { success: true, message: result.message, result, observation: postObservation || observation };
}

async function sessionAssert(state: MidsceneSessionState, command: JsonObject): Promise<JsonObject> {
  const assertion = asText(firstConfiguredValue(command.assertion, command.instruction, command.message, command.expected)).trim();
  if (!assertion) return { success: false, message: 'assert requires assertion text' };
  const observation = state.latestObservation || await sessionObserve(state, 'pre_action');
  let assertionResult: JsonObject;
  if (state.mockMode) {
    const text = asText(observation.visible_text || observation.summary || '');
    const pass = !assertion || text.includes(assertion) || command.mock_pass === true;
    assertionResult = { pass, success: pass, message: pass ? `assertion passed: ${assertion}` : `assertion failed: ${assertion}` };
  } else {
    const raw = await (state.runtime as RuntimeHandle).agent.aiAssert(assertion);
    const pass = raw?.pass !== false;
    assertionResult = {
      pass,
      success: pass,
      message: asText(raw?.message || raw?.thought || (pass ? `assertion passed: ${assertion}` : `assertion failed: ${assertion}`)),
      raw,
    };
  }
  const payload = {
    step_index: Number(observation.step_index || state.stepIndex - 1),
    assertion,
    success: assertionResult.success !== false,
    message: asText(assertionResult.message),
  };
  state.assertions.push(payload);
  state.history.push({ decision: 'assert', assertion, result: assertionResult });
  emitEvent('visual_assertion_result', payload);
  return {
    success: assertionResult.success !== false,
    message: asText(assertionResult.message),
    result: assertionResult,
    observation,
  };
}

async function finishMidsceneSession(state: MidsceneSessionState, command: JsonObject = {}): Promise<JsonObject> {
  const explicitSuccess = command.success;
  const failedAssertion = state.assertions.find((item) => item.success === false);
  const success = explicitSuccess == null ? !failedAssertion : explicitSuccess !== false;
  const summary = asText(command.summary || command.message || (success ? 'Midscene session completed' : asText(failedAssertion?.message || 'Midscene session failed')));
  const report = state.runtime
    ? writeReportSafely(state.traceDir, () => renderReport((state.runtime as RuntimeHandle).agent), { screenshot_count: state.screenshots.length })
    : writeReport(state.traceDir, '<!doctype html><title>Mock Midscene Session Report</title><h1>Mock Midscene Session Report</h1>', { screenshot_count: state.screenshots.length });
  const reportArtifactPath = artifactPath(state.traceDir, report.path);
  const tracePath = writeTrace(state.traceDir, {
    success,
    mode: 'low_level_session',
    session_id: state.sessionId,
    platform: state.request.platform,
    steps: state.steps,
    screenshots: state.screenshots,
    assertions: state.assertions,
    history: state.history,
    midscene_report: reportArtifactPath,
    report_truncated: report.truncated,
    report_original_size_bytes: report.originalSizeBytes,
    report_written_size_bytes: report.writtenSizeBytes,
    report_generation_error: report.error || undefined,
  });
  const visualTrace = artifactPath(state.traceDir, tracePath);
  emitEvent('visual_trace_saved', {
    visual_trace_dir: `visual_traces/${asText(state.request.job_id)}`,
    visual_trace: visualTrace,
    screenshots: state.screenshots,
    step_count: state.steps.length,
    midscene_report: reportArtifactPath,
    report_truncated: report.truncated,
    report_original_size_bytes: report.originalSizeBytes,
    report_written_size_bytes: report.writtenSizeBytes,
    report_generation_error: report.error || undefined,
  });
  if (state.runtime) {
    await state.runtime.free().catch(() => undefined);
  }
  state.finished = true;
  return {
    success,
    status: success ? 'completed' : 'failed',
    message: summary,
    summary,
    session_id: state.sessionId,
    visual_trace: visualTrace,
    midscene_report: reportArtifactPath,
    screenshots: state.screenshots,
    artifacts: [
      { type: 'visual_trace', path: visualTrace },
      { type: 'midscene_report', path: reportArtifactPath },
    ],
  };
}

async function handleSessionCommand(state: MidsceneSessionState | null, command: JsonObject): Promise<{ state: MidsceneSessionState | null; payload: JsonObject }> {
  const action = asText(command.action || command.command || command.tool).trim().toLowerCase();
  if (action === 'start') {
    if (state && !state.finished) {
      await finishMidsceneSession(state, { success: false, summary: 'superseded by new session start' }).catch(() => undefined);
    }
    const nextState = await startMidsceneSession(command);
    return {
      state: nextState,
      payload: {
        success: true,
        message: 'Midscene session started',
        session_id: nextState.sessionId,
        trace_dir: nextState.traceDir,
        platform: nextState.request.platform,
        mock_mode: nextState.mockMode,
      },
    };
  }
  if (!state || state.finished) {
    return { state, payload: { success: false, message: 'Midscene session has not been started' } };
  }
  if (action === 'observe') {
    const observation = await sessionObserve(state, 'manual_observe');
    return { state, payload: { success: true, message: 'observed', session_id: state.sessionId, observation } };
  }
  if (action === 'action') {
    return { state, payload: { session_id: state.sessionId, ...(await sessionAction(state, command)) } };
  }
  if (action === 'ai_act' || action === 'aiact') {
    return { state, payload: { session_id: state.sessionId, ...(await sessionAiAct(state, command)) } };
  }
  if (action === 'assert' || action === 'ai_assert' || action === 'aiassert') {
    return { state, payload: { session_id: state.sessionId, ...(await sessionAssert(state, command)) } };
  }
  if (action === 'adb' || action === 'android_adb') {
    return { state, payload: { session_id: state.sessionId, ...runAllowedAdb(command, state) } };
  }
  if (action === 'finish' || action === 'stop') {
    const payload = await finishMidsceneSession(state, command);
    return { state, payload };
  }
  return { state, payload: { success: false, message: `unknown session action: ${action || '<empty>'}` } };
}

async function runSession(): Promise<void> {
  let state: MidsceneSessionState | null = null;
  while (true) {
    let command: JsonObject;
    try {
      command = await readJsonLine();
    } catch {
      break;
    }
    const requestId = sessionRequestId(command);
    try {
      const result = await handleSessionCommand(state, command);
      state = result.state;
      emit({ type: 'session_response', request_id: requestId, ...result.payload });
      const action = asText(command.action || command.command || command.tool).trim().toLowerCase();
      if ((action === 'finish' || action === 'stop') && state?.finished) break;
    } catch (error) {
      emit({
        type: 'session_response',
        request_id: requestId,
        success: false,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
  if (state && !state.finished) {
    await finishMidsceneSession(state, { success: false, summary: 'Midscene session input closed' }).catch(() => undefined);
  }
}

async function runYaml(request: RunnerRequest): Promise<void> {
  if (request.mock_mode || request.slots?.mock_mode || process.env.MIDSCENE_RUNNER_MOCK === '1') {
    await runMock(request, true);
    return;
  }
  const traceDir = ensureTraceDir(request);
  if (isHighRiskText(request.yaml_script, request.slots?.yaml_script)) {
    throw new Error('high-risk YAML text reached sidecar; backend should have blocked before execution');
  }
  const runtime = await setupAgent(request);
  try {
    await waitIfPaused(request);
    emitEvent('visual_action_planned', { step_index: 1, action: { action: 'run_yaml', reason: 'run Midscene YAML', risk_level: 'low' } });
    const yamlResult = await runtime.agent.runYaml(asText(request.yaml_script || request.slots?.yaml_script));
    emitEvent('visual_action_executed', { step_index: 1, action: 'run_yaml', success: true, message: 'YAML completed' });
    const report = writeReportSafely(traceDir, () => renderReport(runtime.agent), { screenshot_count: 0 });
    const reportArtifactPath = artifactPath(traceDir, report.path);
    const tracePath = writeTrace(traceDir, {
      success: true,
      yaml_result: yamlResult,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
    });
    emitEvent('visual_trace_saved', {
      visual_trace_dir: `visual_traces/${asText(request.job_id)}`,
      visual_trace: artifactPath(traceDir, tracePath),
      screenshots: [],
      step_count: 1,
      yaml_result: yamlResult,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
    });
    emit({
      type: 'result',
      success: true,
      message: 'Midscene YAML completed',
      yaml_result: yamlResult,
      midscene_report: reportArtifactPath,
      report_truncated: report.truncated,
      report_original_size_bytes: report.originalSizeBytes,
      report_written_size_bytes: report.writtenSizeBytes,
      report_generation_error: report.error || undefined,
    });
  } finally {
    await runtime.free();
  }
}

function resolvePackageBin(packageName: string, relativeBin: string): string {
  const packageJson = requireFromHere.resolve(`${packageName}/package.json`);
  return join(dirname(packageJson), relativeBin);
}

async function startPlayground(request: RunnerRequest): Promise<void> {
  const platform = request.platform === 'web' ? 'web' : 'android';
  const port = Number(request.playground?.port || (platform === 'web' ? 3900 : 3901));
  const host = asText(request.playground?.host || '127.0.0.1');
  if (request.mock_mode || request.slots?.mock_mode || process.env.MIDSCENE_RUNNER_MOCK === '1') {
    emit({ type: 'playground_started', playground_url: `http://${host}:${port}`, pid: process.pid });
    await new Promise(() => undefined);
    return;
  }
  const bin = platform === 'web'
    ? resolvePackageBin('@midscene/web', 'bin/midscene-web')
    : resolvePackageBin('@midscene/android-playground', 'bin/android-playground');
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [bin, '--host', host, '--port', String(port)], {
    env: process.env,
    cwd: process.cwd(),
    ...hiddenChildProcessOptions(),
  });
  child.stdout.on('data', (chunk) => emit({ type: 'log', stream: 'stdout', message: asText(chunk) }));
  child.stderr.on('data', (chunk) => emit({ type: 'log', stream: 'stderr', message: asText(chunk) }));
  child.on('exit', (code, signal) => emit({ type: 'playground_exit', code, signal }));
  emit({ type: 'playground_started', playground_url: `http://${host}:${port}`, pid: child.pid });
  await new Promise((resolveExit) => child.on('exit', resolveExit));
}

async function main(): Promise<void> {
  const command = process.argv[2] || '';
  try {
    if (command === 'session') {
      await runSession();
      return;
    }
    const request = await readRequest();
    if (command === 'run-test') {
      await runTest(request);
    } else if (command === 'run-yaml') {
      await runYaml(request);
    } else if (command === 'list-mcp-tools') {
      await listMcpTools(request);
    } else if (command === 'call-mcp-tool') {
      await callSingleMcpTool(request);
    } else if (command === 'start-playground') {
      await startPlayground(request);
    } else if (command === 'stop-playground') {
      emit({ type: 'result', success: true, message: 'stop is handled by the Python process manager' });
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  } catch (error) {
    emit({
      type: 'result',
      success: false,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
