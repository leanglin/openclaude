import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  createWebChatSession,
  deleteWebChatSession,
  deriveWebChatSessionTitle,
  getWebChatTranscriptPath,
  hasWebChatTranscriptMessages,
  listWebChatSessions,
  loadWebChatMessages,
  migrateWebChatSessionsToCwd,
  touchWebChatSessionWithUserMessage,
} from './sessionStore.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.js'

describe('webui session store', () => {
  test('creates, filters, sorts, titles, and soft-deletes Web chat sessions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-sessions-'))
    try {
      const location = { filePath: join(dir, 'webui', 'sessions.json') }
      const cwd = join(dir, 'project-a')
      const otherCwd = join(dir, 'project-b')
      const first = createWebChatSession(cwd, location, new Date('2026-07-03T00:00:00.000Z'))
      const second = createWebChatSession(cwd, location, new Date('2026-07-03T00:01:00.000Z'))
      createWebChatSession(otherCwd, location, new Date('2026-07-03T00:02:00.000Z'))

      touchWebChatSessionWithUserMessage(
        cwd,
        first.id,
        '  first   user\nmessage  ',
        location,
        new Date('2026-07-03T00:03:00.000Z'),
      )

      expect(listWebChatSessions(cwd, location)).toEqual([
        {
          id: first.id,
          title: 'first user message',
          createdAt: '2026-07-03T00:00:00.000Z',
          updatedAt: '2026-07-03T00:03:00.000Z',
        },
        {
          id: second.id,
          title: 'New chat',
          createdAt: '2026-07-03T00:01:00.000Z',
          updatedAt: '2026-07-03T00:01:00.000Z',
        },
      ])

      deleteWebChatSession(cwd, first.id, location, new Date('2026-07-03T00:04:00.000Z'))

      expect(listWebChatSessions(cwd, location).map(session => session.id)).toEqual([second.id])
      expect(listWebChatSessions(otherCwd, location)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('generates first-message titles with whitespace normalization and truncation', () => {
    expect(deriveWebChatSessionTitle('   \n  ')).toBe('New chat')
    expect(deriveWebChatSessionTitle('a '.repeat(80))).toHaveLength(60)
    expect(deriveWebChatSessionTitle('hello\n\tthere')).toBe('hello there')
  })

  test('restores visible user and assistant messages from the CLI transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-transcript-'))
    const previousConfigDir = getClaudeConfigHomeDirOverrideForTesting()
    try {
      setClaudeConfigHomeDirForTesting(dir)
      getClaudeConfigHomeDir.cache?.clear?.()
      const cwd = resolve(join(dir, 'project with spaces'))
      const sessionId = '33333333-3333-4333-8333-333333333333'
      const transcriptPath = getWebChatTranscriptPath(cwd, sessionId)
      mkdirSync(dirname(transcriptPath), { recursive: true })
      writeFileSync(transcriptPath, [
        JSON.stringify({
          type: 'user',
          uuid: 'user-1',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'assistant-1',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi there' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'tool-result-1',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', content: 'hidden tool result' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'meta-1',
          isMeta: true,
          message: { role: 'user', content: 'hidden meta message' },
        }),
      ].join('\n'))

      expect(hasWebChatTranscriptMessages(cwd, sessionId)).toBe(true)
      expect(loadWebChatMessages(cwd, sessionId)).toEqual([
        { messageId: 'user-1', role: 'user', content: 'hello' },
        { messageId: 'assistant-1', role: 'assistant', content: 'hi there' },
      ])
    } finally {
      setClaudeConfigHomeDirForTesting(previousConfigDir)
      getClaudeConfigHomeDir.cache?.clear?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('migrates installed Web sessions from the legacy runtime cwd to the workspace cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-migrate-'))
    const previousConfigDir = getClaudeConfigHomeDirOverrideForTesting()
    try {
      const configDir = join(dir, 'config')
      setClaudeConfigHomeDirForTesting(configDir)
      getClaudeConfigHomeDir.cache?.clear?.()
      const legacyCwd = resolve(join(dir, 'runtime'))
      const workspaceCwd = resolve(join(configDir, 'workspace'))
      const location = { filePath: join(configDir, 'webui', 'sessions.json') }
      const session = createWebChatSession(
        legacyCwd,
        location,
        new Date('2026-07-03T00:00:00.000Z'),
      )
      touchWebChatSessionWithUserMessage(
        legacyCwd,
        session.id,
        'old installed chat',
        location,
        new Date('2026-07-03T00:01:00.000Z'),
      )
      const oldTranscriptPath = getWebChatTranscriptPath(legacyCwd, session.id)
      mkdirSync(dirname(oldTranscriptPath), { recursive: true })
      writeFileSync(
        oldTranscriptPath,
        JSON.stringify({
          type: 'user',
          uuid: 'legacy-user',
          message: { role: 'user', content: 'old installed chat' },
        }),
      )

      expect(listWebChatSessions(workspaceCwd, location)).toEqual([])
      expect(migrateWebChatSessionsToCwd(workspaceCwd, [legacyCwd], location)).toBe(1)

      expect(listWebChatSessions(workspaceCwd, location).map(item => item.id)).toEqual([
        session.id,
      ])
      expect(listWebChatSessions(legacyCwd, location)).toEqual([])
      expect(hasWebChatTranscriptMessages(workspaceCwd, session.id)).toBe(true)
      expect(loadWebChatMessages(workspaceCwd, session.id)).toEqual([
        {
          messageId: 'legacy-user',
          role: 'user',
          content: 'old installed chat',
        },
      ])
    } finally {
      setClaudeConfigHomeDirForTesting(previousConfigDir)
      getClaudeConfigHomeDir.cache?.clear?.()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
