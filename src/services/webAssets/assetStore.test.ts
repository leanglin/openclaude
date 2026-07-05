import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createKnowledgeAsset,
  createSkillAsset,
  deleteKnowledgeAsset,
  deleteSkillAsset,
  importHubKnowledgeAsset,
  importHubSkillAsset,
  importKnowledgeAsset,
  listAssets,
  updateKnowledgeAsset,
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

  const skillPath = join(cwd, '.opencat', 'skills', 'app-test-runner', 'SKILL.md')
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

test('creates user skills under the OpenCat config skills directory', async () => {
  const { cwd, configDir } = setupTempAssets()
  const created = await createSkillAsset(cwd, {
    scope: 'user',
    name: 'Shared Helper',
    description: 'Shared across projects',
    whenToUse: 'Use for reusable project help.',
    allowedTools: ['Read'],
    content: 'Reusable guidance.',
  })

  expect(created.source).toBe('user')
  expect(created.readonly).toBe(false)
  const skillPath = join(configDir, 'skills', 'shared-helper', 'SKILL.md')
  expect(readFileSync(skillPath, 'utf8')).toContain('Shared across projects')

  await deleteSkillAsset(cwd, created.id, true)
  expect(existsSync(skillPath)).toBe(false)
})

test('manages user knowledge markdown in the user skills root', async () => {
  const { cwd, configDir } = setupTempAssets()
  const created = await createKnowledgeAsset(cwd, {
    filename: 'Robot Tips.md',
    title: 'Robot Tips',
    description: 'Reusable robot notes',
    content: 'Use careful setup.',
  })

  expect(created.kind).toBe('knowledge')
  expect(created.source).toBe('user')
  expect(created.readonly).toBe(false)
  expect(created.content).toContain('Robot Tips')
  const knowledgePath = join(configDir, 'skills', 'Robot-Tips.md')
  expect(readFileSync(knowledgePath, 'utf8')).toContain('Reusable robot notes')

  const updated = await updateKnowledgeAsset(cwd, created.id, {
    content: '# Robot Tips\n\nUpdated notes.\n',
  })
  expect(updated.content).toContain('Updated notes')

  const assets = await listAssets(cwd, { kind: 'knowledge' })
  expect(assets.map(asset => asset.path)).toContain(knowledgePath)

  await deleteKnowledgeAsset(cwd, created.id, true)
  expect(existsSync(knowledgePath)).toBe(false)
})

test('imports knowledge with duplicate filenames as non-overwriting copies and excludes SKILL.md', async () => {
  const { cwd, configDir } = setupTempAssets()
  await importKnowledgeAsset(cwd, {
    filename: 'Shared.md',
    content: '# Shared\n\nFirst.\n',
  })
  const second = await importKnowledgeAsset(cwd, {
    filename: 'Shared.md',
    content: '# Shared\n\nSecond.\n',
  })
  await createSkillAsset(cwd, {
    scope: 'user',
    name: 'Knowledge Skill',
    description: 'Should not be knowledge',
    content: 'Skill content.',
  })

  expect(readFileSync(join(configDir, 'skills', 'Shared.md'), 'utf8')).toContain('First')
  expect(second.path).toBe(join(configDir, 'skills', 'Shared-2.md'))
  const knowledgeAssets = await listAssets(cwd, { kind: 'knowledge' })
  expect(knowledgeAssets).toHaveLength(2)
  expect(knowledgeAssets.some(asset => asset.path?.endsWith('SKILL.md'))).toBe(false)
})

test('imports Hub skills and knowledge into user asset locations without overwriting', async () => {
  const { cwd, configDir } = setupTempAssets()
  const firstSkill = await importHubSkillAsset(cwd, {
    name: 'Shared Helper',
    content: [
      '---',
      'name: "Shared Helper"',
      'description: "Downloaded helper"',
      '---',
      '',
      '# Shared Helper',
      '',
      'First skill.',
      '',
    ].join('\n'),
  })
  const secondSkill = await importHubSkillAsset(cwd, {
    name: 'Shared Helper',
    content: [
      '---',
      'name: "Shared Helper"',
      'description: "Downloaded helper copy"',
      '---',
      '',
      '# Shared Helper',
      '',
      'Second skill.',
      '',
    ].join('\n'),
  })
  const firstKnowledge = await importHubKnowledgeAsset(cwd, {
    filename: 'Shared Knowledge.md',
    content: '# Shared Knowledge\n\nFirst note.\n',
  })
  const secondKnowledge = await importHubKnowledgeAsset(cwd, {
    filename: 'Shared Knowledge.md',
    content: '# Shared Knowledge\n\nSecond note.\n',
  })

  expect(firstSkill.path).toBe(join(configDir, 'skills', 'shared-helper', 'SKILL.md'))
  expect(secondSkill.path).toBe(join(configDir, 'skills', 'shared-helper-2', 'SKILL.md'))
  expect(readFileSync(firstSkill.path!, 'utf8')).toContain('First skill.')
  expect(readFileSync(secondSkill.path!, 'utf8')).toContain('Second skill.')
  expect(firstKnowledge.path).toBe(join(configDir, 'skills', 'Shared-Knowledge.md'))
  expect(secondKnowledge.path).toBe(join(configDir, 'skills', 'Shared-Knowledge-2.md'))
  expect(readFileSync(firstKnowledge.path!, 'utf8')).toContain('First note.')
  expect(readFileSync(secondKnowledge.path!, 'utf8')).toContain('Second note.')
})

test('refuses to edit read-only MCP placeholder assets', async () => {
  const { cwd } = setupTempAssets()
  const mcpAsset = (await listAssets(cwd)).find(asset => asset.source === 'mcp')
  expect(mcpAsset).toBeDefined()

  await expect(
    updateSkillAsset(cwd, mcpAsset!.id, { content: '# Not allowed' }),
  ).rejects.toThrow(/Only user and project skills/)
})
