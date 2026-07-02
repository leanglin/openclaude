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

  test('preserves an existing OpenAI-compatible API key when the key field is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-openai-keep-'))
    try {
      const filePath = join(dir, 'profile.json')
      const key = 'sk-openai-secret-to-keep'
      saveProviderProfileFromPayload(
        {
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.test/v1',
          model: 'example-model',
          apiKey: key,
        },
        { filePath },
      )
      saveProviderProfileFromPayload(
        {
          provider: 'openai-compatible',
          baseUrl: 'https://api-2.example.test/v1',
          model: 'example-model-2',
          apiKey: '',
        },
        { filePath },
      )
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'))

      expect(persisted.env.OPENAI_API_KEY).toBe(key)
      expect(persisted.env.OPENAI_BASE_URL).toBe('https://api-2.example.test/v1')
      expect(persisted.env.OPENAI_MODEL).toBe('example-model-2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preserves existing Gemini and Mistral API keys when their key fields are empty', () => {
    const gemini = buildProfileFromPayload(
      {
        provider: 'gemini',
        baseUrl: 'https://gemini.example.test/v1beta/openai',
        model: 'gemini-example',
        apiKey: '',
      },
      {},
      { GEMINI_API_KEY: 'gemini-secret-to-keep' },
    )
    const mistral = buildProfileFromPayload(
      {
        provider: 'mistral',
        baseUrl: 'https://mistral.example.test/v1',
        model: 'mistral-example',
        apiKey: '',
      },
      {},
      { MISTRAL_API_KEY: 'mistral-secret-to-keep' },
    )

    expect(gemini.env.GEMINI_API_KEY).toBe('gemini-secret-to-keep')
    expect(gemini.env.GEMINI_MODEL).toBe('gemini-example')
    expect(gemini.env.GEMINI_BASE_URL).toBe('https://gemini.example.test/v1beta/openai')
    expect(mistral.env.MISTRAL_API_KEY).toBe('mistral-secret-to-keep')
    expect(mistral.env.MISTRAL_MODEL).toBe('mistral-example')
    expect(mistral.env.MISTRAL_BASE_URL).toBe('https://mistral.example.test/v1')
  })

  test('requires a new key when switching to a remote provider without a matching saved key', () => {
    expect(() =>
      buildProfileFromPayload(
        {
          provider: 'gemini',
          baseUrl: 'https://gemini.example.test/v1beta/openai',
          model: 'gemini-example',
          apiKey: '',
        },
        {},
        { OPENAI_API_KEY: 'sk-openai-secret-that-is-not-gemini' },
      ),
    ).toThrow('Gemini API key is required.')
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

  test('saves Midscene settings and omits the API key from bootstrap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-midscene-'))
    try {
      const filePath = join(dir, 'profile.json')
      const key = 'midscene-secret-that-should-not-leak'
      saveProviderProfileFromPayload(
        {
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'llama3.2:3b',
          midscene: {
            baseUrl: 'https://vision.example.test/v1',
            model: 'doubao-vision-pro',
            modelFamily: 'doubao-vision',
            apiKey: key,
          },
        },
        { filePath },
      )
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'))
      const bootstrap = buildBootstrapState({
        cwd: dir,
        permissionMode: 'acceptEdits',
        profileLocation: { filePath },
      })

      expect(persisted.env.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro')
      expect(persisted.env.MIDSCENE_MODEL_BASE_URL).toBe('https://vision.example.test/v1')
      expect(persisted.env.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
      expect(persisted.env.MIDSCENE_MODEL_API_KEY).toBe(key)
      expect(bootstrap.midsceneProfile).toEqual({
        model: 'doubao-vision-pro',
        baseUrl: 'https://vision.example.test/v1',
        modelFamily: 'doubao-vision',
        credentialConfigured: true,
        credentialKeys: ['MIDSCENE_MODEL_API_KEY'],
      })
      expect(bootstrap.profile?.credentialConfigured).toBe(false)
      expect(bootstrap.profile?.credentialKeys).not.toContain('MIDSCENE_MODEL_API_KEY')
      expect(JSON.stringify(bootstrap)).not.toContain(key)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('preserves an existing Midscene API key when the key field is empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-midscene-keep-'))
    try {
      const filePath = join(dir, 'profile.json')
      const key = 'midscene-secret-to-keep'
      saveProviderProfileFromPayload(
        {
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'llama3.2:3b',
          midscene: {
            baseUrl: 'https://vision.example.test/v1',
            model: 'doubao-vision-pro',
            apiKey: key,
          },
        },
        { filePath },
      )
      saveProviderProfileFromPayload(
        {
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434',
          model: 'llama3.2:3b',
          midscene: {
            baseUrl: 'https://vision-2.example.test/v1',
            model: 'doubao-vision-pro-2',
            modelFamily: 'doubao-seed',
            apiKey: '',
          },
        },
        { filePath },
      )
      const persisted = JSON.parse(readFileSync(filePath, 'utf8'))

      expect(persisted.env.MIDSCENE_MODEL_API_KEY).toBe(key)
      expect(persisted.env.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro-2')
      expect(persisted.env.MIDSCENE_MODEL_BASE_URL).toBe('https://vision-2.example.test/v1')
      expect(persisted.env.MIDSCENE_MODEL_FAMILY).toBe('doubao-seed')
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
