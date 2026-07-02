import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  buildBootstrapState,
  buildProfileFromPayload,
  saveProviderProfileFromPayload,
} from './providerProfile.js'
import { redactServerEvent } from './redaction.js'

describe('webui provider profiles', () => {
  test('converts OpenAI-compatible payload into a profile env', () => {
    const profile = buildProfileFromPayload(
      {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        model: 'example-model',
        apiKey: 'sk-test-1234567890abcdef',
      },
      {},
    )

    expect(profile.profile).toBe('openai')
    expect(profile.env.OPENAI_BASE_URL).toBe('https://api.example.test/v1')
    expect(profile.env.OPENAI_MODEL).toBe('example-model')
    expect(profile.env.OPENAI_API_KEY).toBe('sk-test-1234567890abcdef')
  })

  test('allows local OpenAI-compatible profile without an API key', () => {
    const profile = buildProfileFromPayload(
      {
        provider: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'local-model',
      },
      {},
    )

    expect(profile.env.OPENAI_BASE_URL).toBe('http://127.0.0.1:1234/v1')
    expect(profile.env.OPENAI_MODEL).toBe('local-model')
    expect(profile.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('does not expose API keys in bootstrap summaries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-profile-'))
    try {
      const filePath = join(dir, 'profile.json')
      const key = 'sk-test-secret-that-should-not-leak'
      const summary = saveProviderProfileFromPayload(
        {
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.test/v1',
          model: 'example-model',
          apiKey: key,
        },
        { filePath },
      )
      const persisted = readFileSync(filePath, 'utf8')
      const bootstrap = buildBootstrapState({
        cwd: dir,
        permissionMode: 'acceptEdits',
        profileLocation: { filePath },
      })

      expect(persisted).toContain(key)
      expect(JSON.stringify(summary)).not.toContain(key)
      expect(JSON.stringify(bootstrap)).not.toContain(key)
      expect(bootstrap.profile?.credentialConfigured).toBe(true)
      expect(bootstrap.profile?.credentialKeys).toContain('OPENAI_API_KEY')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('redacts secrets from outbound events', () => {
    const event = {
      type: 'activity',
      detail: 'request failed for sk-test-secret-that-should-not-leak',
      nested: {
        apiKey: 'sk-test-secret-that-should-not-leak',
      },
    }

    const redacted = redactServerEvent(event, ['sk-test-secret-that-should-not-leak'])

    expect(JSON.stringify(redacted)).not.toContain('sk-test-secret-that-should-not-leak')
    expect(JSON.stringify(redacted)).toContain('[redacted]')
  })
})
