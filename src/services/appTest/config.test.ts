import { afterEach, describe, expect, test } from 'bun:test'
import { buildAppTestRunnerEnv } from './config.js'

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
] as const

const original = new Map<string, string | undefined>()
for (const key of KEYS) {
  original.set(key, process.env[key])
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
    process.env.MIDSCENE_MODEL_NAME = 'doubao-vision-pro'
    process.env.MIDSCENE_MODEL_BASE_URL = 'https://vision.example.test/v1'
    process.env.MIDSCENE_MODEL_API_KEY = 'midscene-key'
    process.env.MIDSCENE_MODEL_FAMILY = 'doubao-vision'

    const env = buildAppTestRunnerEnv()

    expect(env.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro')
    expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://vision.example.test/v1')
    expect(env.MIDSCENE_MODEL_API_KEY).toBe('midscene-key')
    expect(env.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
  })

  test('maps legacy Midscene API env names when model names are absent', () => {
    delete process.env.MIDSCENE_MODEL_BASE_URL
    delete process.env.MIDSCENE_MODEL_API_KEY
    process.env.MIDSCENE_BASE_URL = 'https://legacy-vision.example.test/v1'
    process.env.MIDSCENE_API_KEY = 'legacy-midscene-key'

    const env = buildAppTestRunnerEnv()

    expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://legacy-vision.example.test/v1')
    expect(env.MIDSCENE_MODEL_API_KEY).toBe('legacy-midscene-key')
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
