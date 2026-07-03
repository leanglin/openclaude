import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_TEST_RUNNER_MISSING_MESSAGE =
  'OpenCat AppTest runner is not built or not included in this installation.'

const APP_TEST_ENV_KEYS = [
  'ADB_PATH',
  'OPENCAT_ADB_PATH',
  'OPENCLAUDE_ADB_PATH',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'PLAYWRIGHT_BROWSERS_PATH',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
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

export function buildAppTestRunnerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

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
  if (!env.MIDSCENE_MODEL_BASE_URL && env.MIDSCENE_BASE_URL) {
    env.MIDSCENE_MODEL_BASE_URL = env.MIDSCENE_BASE_URL
  }
  if (!env.MIDSCENE_MODEL_API_KEY && env.MIDSCENE_API_KEY) {
    env.MIDSCENE_MODEL_API_KEY = env.MIDSCENE_API_KEY
  }
  return env
}

export function formatMissingRunnerMessage(): string {
  return `${APP_TEST_RUNNER_MISSING_MESSAGE}

Build it with:
  npm.cmd --prefix packages/app-test-runner install
  npm.cmd --prefix packages/app-test-runner run build

Or set OPENCAT_APP_TEST_RUNNER to packages/app-test-runner/dist/cli.js.`
}
