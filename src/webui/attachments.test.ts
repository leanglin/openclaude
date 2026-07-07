import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  WEB_MESSAGE_ATTACHMENT_MAX_BYTES,
  getWebMessageAttachmentDir,
  prependAttachmentReferences,
  sanitizeAttachmentFileName,
  stageWebMessageAttachments,
} from './attachments.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.js'

let tempRoot: string | undefined
let previousConfigHome: string | undefined

function setupAttachmentState(): { cwd: string; configDir: string } {
  previousConfigHome = getClaudeConfigHomeDirOverrideForTesting()
  tempRoot = mkdtempSync(join(tmpdir(), 'opencat-webui-attachments-'))
  const cwd = join(tempRoot, 'project')
  const configDir = join(tempRoot, 'config')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  setClaudeConfigHomeDirForTesting(configDir)
  getClaudeConfigHomeDir.cache?.clear?.()
  return { cwd, configDir }
}

function attachment(name: string, content: string | Buffer, mimeType = 'text/plain') {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
  return {
    name,
    mimeType,
    size: buffer.length,
    contentBase64: buffer.toString('base64'),
  }
}

afterEach(() => {
  setClaudeConfigHomeDirForTesting(previousConfigHome)
  getClaudeConfigHomeDir.cache?.clear?.()
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
  tempRoot = undefined
  previousConfigHome = undefined
})

describe('webui attachment staging', () => {
  test('sanitizes unsafe attachment file names while preserving readable names', () => {
    expect(sanitizeAttachmentFileName('..\\..\\bad:name?.txt')).toBe('bad_name_.txt')
    expect(sanitizeAttachmentFileName('浙江安防报告v2_clean.md')).toBe('浙江安防报告v2_clean.md')
    expect(sanitizeAttachmentFileName('   ...   ')).toBe('attachment')
  })

  test('stages repeated and Chinese file names into unique local files', async () => {
    const { cwd } = setupAttachmentState()
    const sessionId = 'session-1'

    const staged = await stageWebMessageAttachments({
      cwd,
      sessionId,
      attachments: [
        attachment('same.txt', 'hello'),
        attachment('same.txt', 'world'),
        attachment('浙江安防报告v2_clean.md', '# 需求'),
      ],
    })

    const dir = resolve(getWebMessageAttachmentDir(cwd, sessionId))
    expect(staged).toHaveLength(3)
    expect(new Set(staged.map(item => item.path)).size).toBe(3)
    expect(staged.every(item => dirname(item.path) === dir)).toBe(true)
    expect(readFileSync(staged[0]!.path, 'utf8')).toBe('hello')
    expect(readFileSync(staged[1]!.path, 'utf8')).toBe('world')
    expect(readFileSync(staged[2]!.path, 'utf8')).toBe('# 需求')
    expect(basename(staged[2]!.path)).toContain('浙江安防报告v2_clean.md')
  })

  test('neutralizes path traversal names and keeps files in the attachment directory', async () => {
    const { cwd } = setupAttachmentState()
    const sessionId = '..\\outside'

    const [staged] = await stageWebMessageAttachments({
      cwd,
      sessionId,
      attachments: [attachment('..\\..\\evil.txt', 'safe')],
    })

    const dir = resolve(getWebMessageAttachmentDir(cwd, sessionId))
    expect(staged).toBeDefined()
    expect(dirname(staged!.path)).toBe(dir)
    expect(basename(staged!.path)).toContain('evil.txt')
    expect(readFileSync(staged!.path, 'utf8')).toBe('safe')
  })

  test('allows empty files and rejects oversized attachments', async () => {
    const { cwd } = setupAttachmentState()
    const empty = await stageWebMessageAttachments({
      cwd,
      sessionId: 'empty',
      attachments: [attachment('empty.txt', Buffer.alloc(0))],
    })

    expect(existsSync(empty[0]!.path)).toBe(true)
    expect(readFileSync(empty[0]!.path).length).toBe(0)

    await expect(stageWebMessageAttachments({
      cwd,
      sessionId: 'too-large',
      attachments: [attachment('large.bin', Buffer.alloc(WEB_MESSAGE_ATTACHMENT_MAX_BYTES + 1))],
    })).rejects.toThrow('exceeds')
  })

  test('rejects invalid base64 payloads and declared size mismatches', async () => {
    const { cwd } = setupAttachmentState()

    await expect(stageWebMessageAttachments({
      cwd,
      sessionId: 'bad-base64',
      attachments: [{
        name: 'bad.txt',
        mimeType: 'text/plain',
        size: 3,
        contentBase64: 'not base64!',
      }],
    })).rejects.toThrow('not valid base64')

    await expect(stageWebMessageAttachments({
      cwd,
      sessionId: 'bad-size',
      attachments: [{
        ...attachment('size.txt', 'a'),
        size: 2,
      }],
    })).rejects.toThrow('size does not match')
  })

  test('prepends quoted at-path attachment references to the user message', () => {
    const message = prependAttachmentReferences('请分析这个文件', [{
      originalName: 'report.md',
      path: 'C:\\tmp\\attachments\\report.md',
      size: 12,
    }])

    expect(message).toContain('附件文件：')
    expect(message).toContain('- report.md: @"C:\\tmp\\attachments\\report.md"')
    expect(message.endsWith('请分析这个文件')).toBe(true)
  })
})
