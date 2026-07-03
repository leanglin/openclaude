import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createMemoryFile,
  deleteMemoryFile,
  encodeMemoryFileId,
  getMemoryFile,
  listMemoryFiles,
  saveMemoryFile,
  searchMemoryFiles,
} from './memoryStore.js'
import { getAutoMemPath } from '../../memdir/paths.js'

let tempDir: string | undefined
let previousOverride: string | undefined

function useTempMemoryDir(): string {
  previousOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  tempDir = mkdtempSync(join(tmpdir(), 'openclaude-web-memory-'))
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = tempDir
  getAutoMemPath.cache?.clear?.()
  return tempDir
}

afterEach(() => {
  if (previousOverride === undefined) {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  } else {
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = previousOverride
  }
  getAutoMemPath.cache?.clear?.()
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

test('rejects traversal file ids and refuses to delete MEMORY.md', () => {
  useTempMemoryDir()

  expect(() => getMemoryFile(encodeMemoryFileId('../outside.md'))).toThrow(
    /traversal|relative|Invalid/,
  )
  expect(() => deleteMemoryFile(encodeMemoryFileId('MEMORY.md'), true)).toThrow(
    /cannot be deleted/,
  )
})
