import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getPlatformAuthStatePath,
  getPlatformCaptcha,
  loadPlatformAuthSession,
  loginPlatformPassword,
  loginPlatformSso,
  normalizePlatformBaseUrl,
  platformBaseUrlFromConfigPayload,
  resolvePlatformBaseUrl,
  validatePlatformToken,
} from './index.js'

let tempDir = ''

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'opencat-platform-auth-'))
  return tempDir
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = ''
})

describe('platform auth service', () => {
  test('normalizes and resolves platform base URL from saved value, env, config, and default', () => {
    const configDir = makeTempDir()
    mkdirSync(join(configDir, 'config'), { recursive: true })
    writeFileSync(
      join(configDir, 'config', 'config.json'),
      JSON.stringify({ server: { protocol: 'http', host: 'platform.example.test', port: 8000 } }),
      'utf8',
    )

    expect(normalizePlatformBaseUrl('platform.local:9000/root')).toBe('http://platform.local:9000')
    expect(platformBaseUrlFromConfigPayload({
      update: { platform_base_url: 'https://updates.example.test/root' },
    })).toBe('https://updates.example.test')
    expect(resolvePlatformBaseUrl({ savedBaseUrl: 'https://saved.example.test/a' })).toBe(
      'https://saved.example.test',
    )
    expect(resolvePlatformBaseUrl({
      configDir,
      env: { OPENCAT_PLATFORM_BASE_URL: 'http://env.example.test:7000/path' } as NodeJS.ProcessEnv,
    })).toBe('http://env.example.test:7000')
    expect(resolvePlatformBaseUrl({ configDir, env: {} as NodeJS.ProcessEnv })).toBe(
      'http://platform.example.test:8000',
    )
  })

  test('parses captcha response fields from the old platform API', async () => {
    const fetcher = async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('http://platform.example.test/api/captcha/')
      return jsonResponse({
        code: 2000,
        data: {
          key: 'captcha-key',
          image_base: 'data:image/png;base64,abc123',
        },
      })
    }

    const result = await getPlatformCaptcha({
      baseUrl: 'http://platform.example.test',
      fetcher,
    })

    expect(result).toMatchObject({
      success: true,
      captchaKey: 'captcha-key',
      captchaImageBase64: 'abc123',
    })
  })

  test('saves password login token without persisting password or captcha', async () => {
    const configDir = makeTempDir()
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        username: 'alice',
        captcha: '2468',
        captchaKey: 'captcha-key',
      })
      return jsonResponse({
        code: 2000,
        data: {
          access: 'access-token',
          token: 'api-token',
        },
      })
    }

    const result = await loginPlatformPassword({
      baseUrl: 'http://platform.example.test',
      username: 'alice',
      password: 'secret-password',
      captcha: '2468',
      captchaKey: 'captcha-key',
      fetcher,
      configDir,
    })

    expect(result.success).toBe(true)
    expect(loadPlatformAuthSession({ configDir })).toMatchObject({
      accessToken: 'access-token',
      apiToken: 'api-token',
      method: 'password',
      identityName: 'alice',
    })
    const saved = readFileSync(getPlatformAuthStatePath(configDir), 'utf8')
    expect(saved).not.toContain('secret-password')
    expect(saved).not.toContain('2468')
    expect(saved).not.toContain('captcha-key')
  })

  test('parses SSO login token from old response shapes', async () => {
    const configDir = makeTempDir()
    const fetcher = async () => jsonResponse({
      success: true,
      data: {
        access_token: 'sso-access',
      },
    })

    const result = await loginPlatformSso({
      baseUrl: 'http://platform.example.test',
      account: 'alice@example.test',
      code: '135790',
      uuid: 'uuid-1',
      fetcher,
      configDir,
    })

    expect(result.success).toBe(true)
    expect(loadPlatformAuthSession({ configDir })).toMatchObject({
      accessToken: 'sso-access',
      apiToken: 'sso-access',
      method: 'sso',
      identityName: 'alice@example.test',
    })
  })

  test('validates token with robot dataset first and dataset fallback second', async () => {
    const calls: string[] = []
    const fetcher = async (url: RequestInfo | URL) => {
      calls.push(String(url))
      if (String(url).includes('/robot_dataset/')) {
        return jsonResponse({ success: false, message: 'robot denied' })
      }
      return jsonResponse({ code: 2000, data: [] })
    }

    const result = await validatePlatformToken({
      baseUrl: 'http://platform.example.test',
      accessToken: 'access-token',
      fetcher,
    })

    expect(result).toEqual({ valid: true, message: 'ok' })
    expect(calls[0]).toContain('/api/system/robot_dataset/')
    expect(calls[1]).toContain('/api/system/dataset/')
  })
})
