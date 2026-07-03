import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProfileFile,
  saveProfileFile,
} from '../../utils/providerProfile.js'
import {
  buildAppTestRunnerEnv,
  MIDSCENE_CONFIG_PRESENT_KEYS_ENV,
  MIDSCENE_CONFIG_SOURCE_ENV,
} from './config.js'

const KEYS = [
  'ADB_PATH',
  'OPENCAT_ADB_PATH',
  'OPENCLAUDE_ADB_PATH',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
  'MIDSCENE_BASE_URL',
  'MIDSCENE_API_KEY',
  MIDSCENE_CONFIG_SOURCE_ENV,
  MIDSCENE_CONFIG_PRESENT_KEYS_ENV,
] as const

const MIDSCENE_MODEL_ENV_KEYS = [
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const

const original = new Map<string, string | undefined>()
for (const key of KEYS) {
  original.set(key, process.env[key])
}

function clearMidsceneEnv(): void {
  for (const key of KEYS) {
    if (String(key).startsWith('MIDSCENE_') || String(key).startsWith('OPENCAT_APP_TEST_MIDSCENE_')) {
      delete process.env[key]
    }
  }
}

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('AppTest runner env', () => {
  test('passes Midscene model env through to the runner', () => {
    clearMidsceneEnv()
    process.env.MIDSCENE_MODEL_NAME = 'doubao-vision-pro'
    process.env.MIDSCENE_MODEL_BASE_URL = 'https://vision.example.test/v1'
    process.env.MIDSCENE_MODEL_API_KEY = 'midscene-key'
    process.env.MIDSCENE_MODEL_FAMILY = 'doubao-vision'

    const env = buildAppTestRunnerEnv()

    expect(env.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro')
    expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://vision.example.test/v1')
    expect(env.MIDSCENE_MODEL_API_KEY).toBe('midscene-key')
    expect(env.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
    expect(env[MIDSCENE_CONFIG_SOURCE_ENV]).toBe('process-env')
    expect(env[MIDSCENE_CONFIG_PRESENT_KEYS_ENV]?.split(',').sort()).toEqual([...MIDSCENE_MODEL_ENV_KEYS].sort())
  })

  test('fills missing Midscene model env from saved provider profile', () => {
    clearMidsceneEnv()
    const dir = mkdtempSync(join(tmpdir(), 'opencat-app-test-profile-'))
    try {
      const filePath = join(dir, 'profile.json')
      saveProfileFile(
        createProfileFile('ollama', {
          MIDSCENE_MODEL_NAME: 'profile-vision-pro',
          MIDSCENE_MODEL_BASE_URL: 'https://profile-vision.example.test/v1',
          MIDSCENE_MODEL_API_KEY: 'profile-midscene-key',
          MIDSCENE_MODEL_FAMILY: 'doubao-vision',
        }),
        { filePath },
      )

      const env = buildAppTestRunnerEnv({ profileLocation: { filePath } })

      expect(env.MIDSCENE_MODEL_NAME).toBe('profile-vision-pro')
      expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://profile-vision.example.test/v1')
      expect(env.MIDSCENE_MODEL_API_KEY).toBe('profile-midscene-key')
      expect(env.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
      expect(env[MIDSCENE_CONFIG_SOURCE_ENV]).toBe('saved-profile')
      expect(env[MIDSCENE_CONFIG_PRESENT_KEYS_ENV]?.split(',').sort()).toEqual([...MIDSCENE_MODEL_ENV_KEYS].sort())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('keeps explicit Midscene model env ahead of saved provider profile', () => {
    clearMidsceneEnv()
    const dir = mkdtempSync(join(tmpdir(), 'opencat-app-test-profile-'))
    try {
      const filePath = join(dir, 'profile.json')
      saveProfileFile(
        createProfileFile('ollama', {
          MIDSCENE_MODEL_NAME: 'profile-vision-pro',
          MIDSCENE_MODEL_BASE_URL: 'https://profile-vision.example.test/v1',
          MIDSCENE_MODEL_API_KEY: 'profile-midscene-key',
          MIDSCENE_MODEL_FAMILY: 'profile-family',
        }),
        { filePath },
      )
      process.env.MIDSCENE_MODEL_NAME = 'env-vision-pro'
      process.env.MIDSCENE_MODEL_BASE_URL = 'https://env-vision.example.test/v1'
      process.env.MIDSCENE_MODEL_API_KEY = 'env-midscene-key'
      process.env.MIDSCENE_MODEL_FAMILY = 'env-family'

      const env = buildAppTestRunnerEnv({ profileLocation: { filePath } })

      expect(env.MIDSCENE_MODEL_NAME).toBe('env-vision-pro')
      expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://env-vision.example.test/v1')
      expect(env.MIDSCENE_MODEL_API_KEY).toBe('env-midscene-key')
      expect(env.MIDSCENE_MODEL_FAMILY).toBe('env-family')
      expect(env[MIDSCENE_CONFIG_SOURCE_ENV]).toBe('process-env')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('maps legacy Midscene API env names when model names are absent', () => {
    clearMidsceneEnv()
    const dir = mkdtempSync(join(tmpdir(), 'opencat-app-test-profile-'))
    try {
      process.env.MIDSCENE_BASE_URL = 'https://legacy-vision.example.test/v1'
      process.env.MIDSCENE_API_KEY = 'legacy-midscene-key'

      const env = buildAppTestRunnerEnv({
        profileLocation: { filePath: join(dir, 'missing-profile.json') },
      })

      expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://legacy-vision.example.test/v1')
      expect(env.MIDSCENE_MODEL_API_KEY).toBe('legacy-midscene-key')
      expect(env[MIDSCENE_CONFIG_SOURCE_ENV]).toBe('legacy-env')
      expect(env[MIDSCENE_CONFIG_PRESENT_KEYS_ENV]?.split(',').sort()).toEqual([
        'MIDSCENE_MODEL_API_KEY',
        'MIDSCENE_MODEL_BASE_URL',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('maps OPENCAT_ADB_PATH to ADB_PATH for packaged runs', () => {
    delete process.env.ADB_PATH
    process.env.OPENCAT_ADB_PATH = 'C:/Android/platform-tools/adb.exe'

    const env = buildAppTestRunnerEnv()

    expect(env.ADB_PATH).toBe('C:/Android/platform-tools/adb.exe')
  })

  test('keeps legacy ADB path fallback behind OPENCAT_ADB_PATH', () => {
    delete process.env.ADB_PATH
    process.env.OPENCAT_ADB_PATH = 'C:/Android/current/adb.exe'
    process.env.OPENCLAUDE_ADB_PATH = 'C:/Android/legacy/adb.exe'

    const env = buildAppTestRunnerEnv()

    expect(env.ADB_PATH).toBe('C:/Android/current/adb.exe')
  })

  test('derives ADB path from Android SDK env when no explicit ADB path is set', () => {
    delete process.env.ADB_PATH
    delete process.env.OPENCAT_ADB_PATH
    delete process.env.OPENCLAUDE_ADB_PATH
    process.env.ANDROID_HOME = 'C:/Users/me/AppData/Local/Android/Sdk'

    const env = buildAppTestRunnerEnv()

    expect(env.ADB_PATH).toBe(
      'C:/Users/me/AppData/Local/Android/Sdk/platform-tools/adb.exe',
    )
  })
})
