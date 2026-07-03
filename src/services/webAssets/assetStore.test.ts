import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSkillAsset,
  deleteSkillAsset,
  listAssets,
  updateSkillAsset,
} from './assetStore.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../../utils/envUtils.js'
import { clearCommandsCache } from '../../commands.js'

let tempDir: string | undefined
let previousConfigHome: string | undefined

function setupTempAssets(): { cwd: string; configDir: string } {
  previousConfigHome = getClaudeConfigHomeDirOverrideForTesting()
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-web-assets-'))
  const configDir = join(tempDir, 'config')
  const cwd = join(tempDir, 'project')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  clearCommandsCache()
  return { cwd, configDir }
}

afterEach(() => {
  setClaudeConfigHomeDirForTesting(previousConfigHome)
  getClaudeConfigHomeDir.cache?.clear?.()
  clearCommandsCache()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
  previousConfigHome = undefined
})

test('creates, edits, lists, and deletes project skills', async () => {
  const { cwd } = setupTempAssets()
  const created = await createSkillAsset(cwd, {
    scope: 'project',
    name: 'App Test Runner',
    description: 'Run app tests',
    whenToUse: 'Use for app test runs.',
    allowedTools: ['Read', 'Bash'],
    context: 'fork',
    content: 'Check the app and report findings.',
  })

  expect(created.source).toBe('project')
  expect(created.readonly).toBe(false)
  expect(created.content).toContain('allowed-tools')

  const skillPath = join(cwd, '.claude', 'skills', 'app-test-runner', 'SKILL.md')
  expect(readFileSync(skillPath, 'utf8')).toContain('Run app tests')

  const updated = await updateSkillAsset(cwd, created.id, {
    content: [
      '---',
      'name: "App Test Runner"',
      'description: "Run app tests"',
      '---',
      '',
      '# App Test Runner',
      '',
      'Updated content.',
      '',
    ].join('\n'),
  })
  expect(updated.content).toContain('Updated content')

  const assets = await listAssets(cwd, { q: 'app test' })
  expect(assets.some(asset => asset.id === created.id)).toBe(true)

  await deleteSkillAsset(cwd, created.id, true)
  expect(existsSync(skillPath)).toBe(false)
})

test('refuses to edit read-only MCP placeholder assets', async () => {
  const { cwd } = setupTempAssets()
  const mcpAsset = (await listAssets(cwd)).find(asset => asset.source === 'mcp')
  expect(mcpAsset).toBeDefined()

  await expect(
    updateSkillAsset(cwd, mcpAsset!.id, { content: '# Not allowed' }),
  ).rejects.toThrow(/Only user and project skills/)
})
