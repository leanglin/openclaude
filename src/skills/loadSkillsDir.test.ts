import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { getSkillDirCommands, clearSkillCaches } from './loadSkillsDir.ts'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

function writeSkill(rootDir: string, skillPath: string): void {
  const skillDir = join(rootDir, '.opencat', 'skills', ...skillPath.split('/'))
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\ndescription: ${skillPath}\n---\n# ${skillPath}\n`,
    'utf8',
  )
}

test('loads flat and nested skills with colon namespaces', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    writeSkill(configDir, 'flat-skill')
    writeSkill(configDir, 'git/commit')
    writeSkill(configDir, 'frontend/react/form')

    process.env.CLAUDE_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    const fixtureSkillsRoot = join(configDir, '.opencat', 'skills')
    const promptSkills = skills.filter(
      (
        skill,
      ): skill is Extract<(typeof skills)[number], { type: 'prompt' }> & {
        skillRoot: string
      } =>
        skill.type === 'prompt' &&
        skill.skillRoot?.startsWith(fixtureSkillsRoot) === true,
    )
    const skillNames = promptSkills.map(skill => skill.name).sort()

    assert.deepEqual(skillNames, [
      'flat-skill',
      'frontend:react:form',
      'git:commit',
    ])

    const nestedSkill = promptSkills.find(skill => skill.name === 'git:commit')
    assert.ok(nestedSkill)
    assert.equal(nestedSkill.skillRoot, join(configDir, '.opencat', 'skills', 'git', 'commit'))

    const deepSkill = promptSkills.find(
      skill => skill.name === 'frontend:react:form',
    )
    assert.ok(deepSkill)
    assert.equal(
      deepSkill.skillRoot,
      join(configDir, '.opencat', 'skills', 'frontend', 'react', 'form'),
    )
  } finally {
    try {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      clearSkillCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})

test('ignores legacy project skill directories', async () => {
  await acquireSharedMutationLock('loadSkillsDir.test.ts')
  const configDir = mkdtempSync(join(tmpdir(), 'openclaude-skills-'))
  const cwd = join(configDir, 'workspace')
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

  try {
    mkdirSync(cwd, { recursive: true })
    for (const legacyDir of ['.openclaude', '.claude']) {
      const skillDir = join(cwd, legacyDir, 'skills', `legacy-${legacyDir.slice(1)}`)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\ndescription: ${legacyDir} legacy skill\n---\n# legacy\n`,
        'utf8',
      )
    }

    process.env.CLAUDE_CONFIG_DIR = configDir
    clearSkillCaches()

    const skills = await getSkillDirCommands(cwd)
    const skillNames = skills
      .filter(skill => skill.type === 'prompt')
      .map(skill => skill.name)

    assert.equal(skillNames.includes('legacy-openclaude'), false)
    assert.equal(skillNames.includes('legacy-claude'), false)
  } finally {
    try {
      if (originalConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      }
      clearSkillCaches()
      rmSync(configDir, { recursive: true, force: true })
    } finally {
      releaseSharedMutationLock()
    }
  }
})
