import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadProfileFile,
  type ProfileFileLocation,
} from '../../utils/providerProfile.js'

export const APP_TEST_RUNNER_MISSING_MESSAGE =
  'OpenCat AppTest runner is not built or not included in this installation.'

const MIDSCENE_MODEL_ENV_KEYS = [
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const

export const MIDSCENE_CONFIG_SOURCE_ENV =
  'OPENCAT_APP_TEST_MIDSCENE_CONFIG_SOURCE'
export const MIDSCENE_CONFIG_PRESENT_KEYS_ENV =
  'OPENCAT_APP_TEST_MIDSCENE_PRESENT_KEYS'

const APP_TEST_ENV_KEYS = [
  'ADB_PATH',
  'OPENCAT_ADB_PATH',
  'OPENCLAUDE_ADB_PATH',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'PLAYWRIGHT_BROWSERS_PATH',
  ...MIDSCENE_MODEL_ENV_KEYS,
  'MIDSCENE_BASE_URL',
  'MIDSCENE_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
]

function currentModuleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

export function resolveAppTestRunnerPath(cwd = process.cwd()): string | null {
  const configured =
    process.env.OPENCAT_APP_TEST_RUNNER?.trim() ||
    process.env.OPENCLAUDE_APP_TEST_RUNNER?.trim()
  const candidates = [
    configured,
    resolve(cwd, 'packages/app-test-runner/dist/cli.js'),
    resolve(currentModuleDir(), '../../../packages/app-test-runner/dist/cli.js'),
    resolve(currentModuleDir(), '../packages/app-test-runner/dist/cli.js'),
    resolve(currentModuleDir(), '../../packages/app-test-runner/dist/cli.js'),
  ].filter((item): item is string => Boolean(item))

  return candidates.find(candidate => existsSync(candidate)) ?? null
}

export function resolveAppTestNodePath(): string {
  return (
    process.env.OPENCAT_APP_TEST_NODE?.trim() ||
    process.env.OPENCLAUDE_APP_TEST_NODE?.trim() ||
    process.execPath
  )
}

function configured(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
}

function copyMissingMidsceneProfileEnv(
  env: NodeJS.ProcessEnv,
  location?: ProfileFileLocation,
): boolean {
  const profileEnv = loadProfileFile(location)?.env
  if (!profileEnv) return false

  let usedProfile = false
  for (const key of MIDSCENE_MODEL_ENV_KEYS) {
    if (!configured(env[key]) && configured(profileEnv[key])) {
      env[key] = profileEnv[key]
      usedProfile = true
    }
  }
  return usedProfile
}

function updateMidsceneDiagnostics(
  env: NodeJS.ProcessEnv,
  source: string | undefined,
): void {
  const presentKeys = MIDSCENE_MODEL_ENV_KEYS.filter(key => configured(env[key]))
  env[MIDSCENE_CONFIG_PRESENT_KEYS_ENV] = presentKeys.join(',')
  env[MIDSCENE_CONFIG_SOURCE_ENV] =
    source ||
    env[MIDSCENE_CONFIG_SOURCE_ENV] ||
    (presentKeys.length === MIDSCENE_MODEL_ENV_KEYS.length
      ? 'process-env'
      : 'missing')
}

export function buildAppTestRunnerEnv(options: {
  profileLocation?: ProfileFileLocation
} = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  let midsceneSource = configured(env[MIDSCENE_CONFIG_SOURCE_ENV])
    ? env[MIDSCENE_CONFIG_SOURCE_ENV]
    : MIDSCENE_MODEL_ENV_KEYS.every(key => configured(env[key]))
      ? 'process-env'
      : undefined

  if (!env.ADB_PATH) {
    env.ADB_PATH =
      env.OPENCAT_ADB_PATH ||
      env.OPENCLAUDE_ADB_PATH ||
      (env.ANDROID_HOME ? `${env.ANDROID_HOME}/platform-tools/adb.exe` : undefined) ||
      (env.ANDROID_SDK_ROOT ? `${env.ANDROID_SDK_ROOT}/platform-tools/adb.exe` : undefined)
  }
  for (const key of APP_TEST_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  if (copyMissingMidsceneProfileEnv(env, options.profileLocation)) {
    midsceneSource = midsceneSource || 'saved-profile'
  }
  if (!env.MIDSCENE_MODEL_BASE_URL && env.MIDSCENE_BASE_URL) {
    env.MIDSCENE_MODEL_BASE_URL = env.MIDSCENE_BASE_URL
    midsceneSource = midsceneSource || 'legacy-env'
  }
  if (!env.MIDSCENE_MODEL_API_KEY && env.MIDSCENE_API_KEY) {
    env.MIDSCENE_MODEL_API_KEY = env.MIDSCENE_API_KEY
    midsceneSource = midsceneSource || 'legacy-env'
  }
  updateMidsceneDiagnostics(env, midsceneSource)
  return env
}

export function formatMissingRunnerMessage(): string {
  return `${APP_TEST_RUNNER_MISSING_MESSAGE}

Build it with:
  npm.cmd --prefix packages/app-test-runner install
  npm.cmd --prefix packages/app-test-runner run build

Or set OPENCAT_APP_TEST_RUNNER to packages/app-test-runner/dist/cli.js.`
}
