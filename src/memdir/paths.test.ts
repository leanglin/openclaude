import { afterEach, beforeEach, expect, test } from 'bun:test'
import { setAllowedSettingSources } from '../bootstrap/state.js'
import { SETTING_SOURCES } from '../utils/settings/constants.js'
import type { SettingSource } from '../utils/settings/constants.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
} from '../utils/settings/settingsCache.js'
import { isAutoMemoryEnabled, isExtractModeActive } from './paths.ts'

// Pin issue #1326: `memory.autoWrite` is a discoverable alias for the legacy
// `autoMemoryEnabled` setting, and either key opts out for governance /
// regulated / client-sensitive repos. The opt-out is evaluated across the raw
// per-source settings (low-to-high priority) rather than the merged object, so
// a `false` in any source survives source-precedence merging and a parent-scope
// opt-out can't be silently re-enabled by a narrower scope flipping the key.

let _originalEnv: Record<string, string | undefined> = {}

type SourceFixture = { source: string; settings: Record<string, unknown> }

// Drive the raw per-source view that isAutoMemoryEnabled() reads. Sources are
// listed low-to-high priority (userSettings lowest, policySettings highest) —
// the order getEnabledSettingSources() yields. Use the real settings module's
// per-source cache instead of mock.module so this test does not leak module
// replacements into later files in the same Bun process.
function mockSources(sources: SourceFixture[]): void {
  resetSettingsCache()
  for (const source of SETTING_SOURCES) {
    setCachedSettingsForSource(source, null)
  }
  for (const source of sources) {
    setCachedSettingsForSource(
      source.source as SettingSource,
      source.settings,
    )
  }
}

beforeEach(() => {
  _originalEnv = {
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
    CLAUDE_CODE_REMOTE: process.env.CLAUDE_CODE_REMOTE,
    CLAUDE_CODE_REMOTE_MEMORY_DIR: process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR,
  }
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR

  // Enable every source so getEnabledSettingSources() returns the full set in
  // priority order; the fixtures decide which of them carry a value.
  setAllowedSettingSources([...SETTING_SOURCES])
  resetSettingsCache()
})

afterEach(() => {
  for (const [k, v] of Object.entries(_originalEnv)) {
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
  setAllowedSettingSources([...SETTING_SOURCES])
  resetSettingsCache()
})

test('defaults to enabled when no source sets the key and no env override', () => {
  mockSources([{ source: 'userSettings', settings: {} }])
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('memory extraction is enabled for default non-interactive Web-style sessions', () => {
  mockSources([{ source: 'userSettings', settings: {} }])
  expect(isAutoMemoryEnabled()).toBe(true)
  expect(isExtractModeActive()).toBe(true)
})

test('memory.autoWrite: false opts out via the new discoverable alias (#1326)', () => {
  mockSources([
    { source: 'projectSettings', settings: { memory: { autoWrite: false } } },
  ])
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('memory.autoWrite: true explicitly opts in', () => {
  mockSources([
    { source: 'projectSettings', settings: { memory: { autoWrite: true } } },
  ])
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('legacy autoMemoryEnabled: false still opts out (back-compat)', () => {
  mockSources([{ source: 'projectSettings', settings: { autoMemoryEnabled: false } }])
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('legacy autoMemoryEnabled: true still opts in (back-compat)', () => {
  mockSources([{ source: 'projectSettings', settings: { autoMemoryEnabled: true } }])
  expect(isAutoMemoryEnabled()).toBe(true)
})

test('a lower-priority memory.autoWrite: false survives a higher-priority true (#1326)', () => {
  // The regression the merged-object read missed: source precedence collapses
  // same-key values, so getInitialSettings() would keep only the higher-priority
  // `true` and silently re-enable auto-memory. Evaluating the raw per-source
  // list keeps the parent-scope opt-out authoritative.
  mockSources([
    { source: 'userSettings', settings: { memory: { autoWrite: false } } },
    { source: 'localSettings', settings: { memory: { autoWrite: true } } },
  ])
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('a parent autoMemoryEnabled: false is not re-enabled by a narrower memory.autoWrite: true', () => {
  mockSources([
    { source: 'projectSettings', settings: { autoMemoryEnabled: false } },
    { source: 'localSettings', settings: { memory: { autoWrite: true } } },
  ])
  expect(isAutoMemoryEnabled()).toBe(false)
})

test('env var still overrides settings', () => {
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  mockSources([
    { source: 'projectSettings', settings: { memory: { autoWrite: true } } },
  ])
  expect(isAutoMemoryEnabled()).toBe(false)
})
