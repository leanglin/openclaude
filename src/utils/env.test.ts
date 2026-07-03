import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalEnv = {
  OPENCAT_CONFIG_DIR: process.env.OPENCAT_CONFIG_DIR,
  OPENCLAUDE_CONFIG_DIR: process.env.OPENCLAUDE_CONFIG_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CLAUDE_CODE_CUSTOM_OAUTH_URL: process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL,
  USER_TYPE: process.env.USER_TYPE,
}

let tempDir: string

beforeEach(async () => {
  await acquireSharedMutationLock('env.test.ts')
  tempDir = mkdtempSync(join(tmpdir(), 'opencat-env-test-'))
  delete process.env.OPENCAT_CONFIG_DIR
  delete process.env.OPENCLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tempDir
  delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
  delete process.env.USER_TYPE
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
    if (originalEnv.OPENCAT_CONFIG_DIR === undefined) {
      delete process.env.OPENCAT_CONFIG_DIR
    } else {
      process.env.OPENCAT_CONFIG_DIR = originalEnv.OPENCAT_CONFIG_DIR
    }
    if (originalEnv.OPENCLAUDE_CONFIG_DIR === undefined) {
      delete process.env.OPENCLAUDE_CONFIG_DIR
    } else {
      process.env.OPENCLAUDE_CONFIG_DIR = originalEnv.OPENCLAUDE_CONFIG_DIR
    }
    if (originalEnv.CLAUDE_CONFIG_DIR === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalEnv.CLAUDE_CONFIG_DIR
    }
    if (originalEnv.CLAUDE_CODE_CUSTOM_OAUTH_URL === undefined) {
      delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    } else {
      process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = originalEnv.CLAUDE_CODE_CUSTOM_OAUTH_URL
    }
    if (originalEnv.USER_TYPE === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = originalEnv.USER_TYPE
    }
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFreshEnvModule() {
  return import(`./env.js?ts=${Date.now()}-${Math.random()}`)
}

// getGlobalClaudeFile — default path plus explicit override compatibility

test('getGlobalClaudeFile: new install returns .opencat.json when neither file exists', async () => {
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.opencat.json'))
})

test('getGlobalClaudeFile: explicit config dir keeps .claude.json fallback when only legacy file exists', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.claude.json'))
})

test('getGlobalClaudeFile: migrated user uses .opencat.json when current and legacy files exist', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  writeFileSync(join(tempDir, '.openclaude.json'), '{}')
  writeFileSync(join(tempDir, '.opencat.json'), '{}')
  const { getGlobalClaudeFile } = await importFreshEnvModule()
  expect(getGlobalClaudeFile()).toBe(join(tempDir, '.opencat.json'))
})

test('getGlobalClaudeFile: OPENCAT_CONFIG_DIR uses preferred config dir', async () => {
  const preferredDir = mkdtempSync(join(tmpdir(), 'opencat-preferred-env-test-'))
  try {
    process.env.OPENCAT_CONFIG_DIR = preferredDir
    process.env.CLAUDE_CONFIG_DIR = tempDir

    const { getGlobalClaudeFile } = await importFreshEnvModule()

    expect(getGlobalClaudeFile()).toBe(join(preferredDir, '.opencat.json'))
  } finally {
    rmSync(preferredDir, { recursive: true, force: true })
  }
})

test('getGlobalClaudeFile: OPENCAT_CONFIG_DIR keeps .claude.json fallback when only legacy file exists', async () => {
  const preferredDir = mkdtempSync(join(tmpdir(), 'opencat-preferred-env-test-'))
  try {
    process.env.OPENCAT_CONFIG_DIR = preferredDir
    process.env.CLAUDE_CONFIG_DIR = tempDir
    writeFileSync(join(preferredDir, '.claude.json'), '{}')

    const { getGlobalClaudeFile } = await importFreshEnvModule()

    expect(getGlobalClaudeFile()).toBe(join(preferredDir, '.claude.json'))
  } finally {
    rmSync(preferredDir, { recursive: true, force: true })
  }
})

test('resolveGlobalClaudeFile: failed default migration keeps legacy file when new file is missing', async () => {
  writeFileSync(join(tempDir, '.claude.json'), '{}')
  const { resolveGlobalClaudeFile } = await importFreshEnvModule()

  expect(
    resolveGlobalClaudeFile({
      homeDir: tempDir,
      migrationSucceeded: false,
      existsSync: path => path === join(tempDir, '.claude.json'),
    }),
  ).toBe(join(tempDir, '.claude.json'))
})

test('resolveGlobalClaudeFile: failed default migration keeps OpenCat legacy file when new file is missing', async () => {
  writeFileSync(join(tempDir, '.openclaude.json'), '{}')
  const { resolveGlobalClaudeFile } = await importFreshEnvModule()

  expect(
    resolveGlobalClaudeFile({
      homeDir: tempDir,
      migrationSucceeded: false,
      existsSync: path => path === join(tempDir, '.openclaude.json'),
    }),
  ).toBe(join(tempDir, '.openclaude.json'))
})
