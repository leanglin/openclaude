import { afterEach, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMemoryFile,
  deleteMemoryFile,
  encodeMemoryFileId,
  getMemoryFile,
  getMemoryStatus,
  listMemoryFiles,
  saveMemoryFile,
  searchMemoryFiles,
} from './memoryStore.js'
import { getAutoMemPath, getAutoMemPathForProject } from '../../memdir/paths.js'

let tempDir: string | undefined
let previousOverride: string | undefined

function useTempMemoryDir(): string {
  previousOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-web-memory-'))
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = tempDir
  getAutoMemPath.cache?.clear?.()
  getAutoMemPathForProject.cache?.clear?.()
  return tempDir
}

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  } else {
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = previousOverride
  }
  getAutoMemPath.cache?.clear?.()
  getAutoMemPathForProject.cache?.clear?.()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
  previousOverride = undefined
})

test('creates, lists, searches, edits, and deletes topic memory files', () => {
  const dir = useTempMemoryDir()
  const created = createMemoryFile({
    filename: 'robot_testing.md',
    title: 'Robot Testing',
    description: 'Robot testing preferences',
    type: 'project',
    content: 'Prefer small app checks.',
    addToIndex: true,
  })

  expect(created.relativePath).toBe('robot_testing.md')
  expect(listMemoryFiles().map(file => file.relativePath)).toContain('MEMORY.md')
  expect(searchMemoryFiles('small app')).toContainEqual(
    expect.objectContaining({ relativePath: 'robot_testing.md' }),
  )

  const saved = saveMemoryFile(created.id, '# Updated\n\nNew content.')
  expect(saved.content).toContain('New content')

  deleteMemoryFile(created.id, true)
  expect(listMemoryFiles().map(file => file.relativePath)).not.toContain('robot_testing.md')
  expect(readFileSync(join(dir, 'MEMORY.md'), 'utf8')).not.toContain('robot_testing.md')
})

test('status does not count the synthetic MEMORY.md placeholder as content', async () => {
  const dir = useTempMemoryDir()

  const files = listMemoryFiles()
  const status = await getMemoryStatus(join(dir, 'project'))

  expect(files.map(file => file.relativePath)).toEqual(['MEMORY.md'])
  expect(status.hasMemoryIndex).toBe(false)
  expect(status.memoryFileCount).toBe(0)
  expect(status.totalBytes).toBe(0)
})

test('treats nested MEMORY.md files as real indexes', async () => {
  const dir = useTempMemoryDir()
  mkdirSync(join(dir, 'team'), { recursive: true })
  writeFileSync(
    join(dir, 'team', 'MEMORY.md'),
    '- [Team Project](team-project.md): Shared memory index entry.\n',
  )
  writeFileSync(
    join(dir, 'team', 'team-project.md'),
    [
      '---',
      'title: "Team Project"',
      'description: "Shared project memory"',
      'type: "project"',
      '---',
      '',
      '# Team Project',
      '',
      'Remember the team index contract.',
      '',
    ].join('\n'),
  )

  const files = listMemoryFiles()
  expect(files.map(file => file.relativePath)).not.toContain('MEMORY.md')
  expect(files).toContainEqual(
    expect.objectContaining({
      relativePath: 'team/MEMORY.md',
      kind: 'index',
      sizeBytes: expect.any(Number),
    }),
  )
  expect(files).toContainEqual(
    expect.objectContaining({
      relativePath: 'team/team-project.md',
      kind: 'topic',
    }),
  )

  const index = getMemoryFile(encodeMemoryFileId('team/MEMORY.md'))
  expect(index.kind).toBe('index')
  expect(index.content).toContain('Shared memory index entry')
  expect(searchMemoryFiles('Shared memory index')).toContainEqual(
    expect.objectContaining({ relativePath: 'team/MEMORY.md' }),
  )
  expect(() =>
    deleteMemoryFile(encodeMemoryFileId('team/MEMORY.md'), true),
  ).toThrow(/cannot be deleted/)

  const status = await getMemoryStatus(join(dir, 'project'))
  expect(status.hasMemoryIndex).toBe(true)
  expect(status.memoryFileCount).toBe(2)
})

test('rejects traversal file ids and refuses to delete MEMORY.md', () => {
  useTempMemoryDir()

  expect(() => getMemoryFile(encodeMemoryFileId('../outside.md'))).toThrow(
    /traversal|relative|Invalid/,
  )
  expect(() => deleteMemoryFile(encodeMemoryFileId('MEMORY.md'), true)).toThrow(
    /cannot be deleted/,
  )
  expect(() =>
    deleteMemoryFile(encodeMemoryFileId('team/MEMORY.md'), true),
  ).toThrow(/cannot be deleted/)
})
