import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { getProjectDir } from '../utils/sessionStoragePortable.js'
import type {
  WebChatMessage,
  WebChatSessionSummary,
} from './types.js'

export type WebChatSessionRecord = {
  id: string
  cwd: string
  title: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  firstUserMessageSeen: boolean
}

type WebChatSessionStoreFile = {
  version: 1
  sessions: WebChatSessionRecord[]
}

export type WebChatSessionStoreLocation = {
  configDir?: string
  filePath?: string
}

const STORE_VERSION = 1
const DEFAULT_TITLE = 'New chat'
const TITLE_LIMIT = 60

function nowIso(now: Date = new Date()): string {
  return now.toISOString()
}

function normalizeCwd(cwd: string): string {
  return resolve(cwd).normalize('NFC')
}

export function getWebChatSessionStorePath(
  location: WebChatSessionStoreLocation = {},
): string {
  return location.filePath ?? join(
    location.configDir ?? getClaudeConfigHomeDir(),
    'webui',
    'sessions.json',
  )
}

function emptyStore(): WebChatSessionStoreFile {
  return { version: STORE_VERSION, sessions: [] }
}

function readStore(
  location: WebChatSessionStoreLocation = {},
): WebChatSessionStoreFile {
  const filePath = getWebChatSessionStorePath(location)
  if (!existsSync(filePath)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<WebChatSessionStoreFile>
    if (!Array.isArray(parsed.sessions)) return emptyStore()
    return {
      version: STORE_VERSION,
      sessions: parsed.sessions
        .filter((session): session is WebChatSessionRecord => Boolean(session) && typeof session.id === 'string')
        .map(session => ({
          id: session.id,
          cwd: normalizeCwd(typeof session.cwd === 'string' ? session.cwd : ''),
          title: typeof session.title === 'string' && session.title.trim()
            ? session.title
            : DEFAULT_TITLE,
          createdAt: typeof session.createdAt === 'string'
            ? session.createdAt
            : nowIso(),
          updatedAt: typeof session.updatedAt === 'string'
            ? session.updatedAt
            : nowIso(),
          deletedAt: typeof session.deletedAt === 'string' ? session.deletedAt : undefined,
          firstUserMessageSeen: Boolean(session.firstUserMessageSeen),
        })),
    }
  } catch {
    return emptyStore()
  }
}

function writeStore(
  store: WebChatSessionStoreFile,
  location: WebChatSessionStoreLocation = {},
): void {
  const filePath = getWebChatSessionStorePath(location)
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function toSummary(session: WebChatSessionRecord): WebChatSessionSummary {
  return {
    id: session.id,
    title: session.title || DEFAULT_TITLE,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function compareUpdatedDesc(
  left: WebChatSessionRecord,
  right: WebChatSessionRecord,
): number {
  return right.updatedAt.localeCompare(left.updatedAt)
}

function findVisibleSession(
  store: WebChatSessionStoreFile,
  cwd: string,
  sessionId: string,
): WebChatSessionRecord | undefined {
  const normalizedCwd = normalizeCwd(cwd)
  return store.sessions.find(session =>
    session.id === sessionId &&
    session.cwd === normalizedCwd &&
    !session.deletedAt,
  )
}

export function deriveWebChatSessionTitle(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  if (!collapsed) return DEFAULT_TITLE
  return collapsed.length > TITLE_LIMIT
    ? collapsed.slice(0, TITLE_LIMIT)
    : collapsed
}

export function listWebChatSessions(
  cwd: string,
  location: WebChatSessionStoreLocation = {},
): WebChatSessionSummary[] {
  const normalizedCwd = normalizeCwd(cwd)
  return readStore(location).sessions
    .filter(session => session.cwd === normalizedCwd && !session.deletedAt)
    .sort(compareUpdatedDesc)
    .map(toSummary)
}

export function createWebChatSession(
  cwd: string,
  location: WebChatSessionStoreLocation = {},
  now: Date = new Date(),
): WebChatSessionRecord {
  const timestamp = nowIso(now)
  const record: WebChatSessionRecord = {
    id: randomUUID(),
    cwd: normalizeCwd(cwd),
    title: DEFAULT_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp,
    firstUserMessageSeen: false,
  }
  const store = readStore(location)
  store.sessions.push(record)
  writeStore(store, location)
  return record
}

export function getWebChatSession(
  cwd: string,
  sessionId: string,
  location: WebChatSessionStoreLocation = {},
): WebChatSessionRecord | null {
  return findVisibleSession(readStore(location), cwd, sessionId) ?? null
}

export function touchWebChatSessionWithUserMessage(
  cwd: string,
  sessionId: string,
  text: string,
  location: WebChatSessionStoreLocation = {},
  now: Date = new Date(),
): WebChatSessionRecord | null {
  const store = readStore(location)
  const session = findVisibleSession(store, cwd, sessionId)
  if (!session) return null
  if (!session.firstUserMessageSeen) {
    session.title = deriveWebChatSessionTitle(text)
    session.firstUserMessageSeen = true
  }
  session.updatedAt = nowIso(now)
  writeStore(store, location)
  return session
}

export function deleteWebChatSession(
  cwd: string,
  sessionId: string,
  location: WebChatSessionStoreLocation = {},
  now: Date = new Date(),
): boolean {
  const store = readStore(location)
  const session = findVisibleSession(store, cwd, sessionId)
  if (!session) return false
  const timestamp = nowIso(now)
  session.deletedAt = timestamp
  session.updatedAt = timestamp
  writeStore(store, location)
  return true
}

export function getWebChatTranscriptPath(cwd: string, sessionId: string): string {
  return join(getProjectDir(normalizeCwd(cwd)), `${sessionId}.jsonl`)
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        return record.text
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function parseTranscriptMessage(line: string): WebChatMessage | null {
  const record = JSON.parse(line) as Record<string, unknown>
  if (
    record.isMeta ||
    record.isVisibleInTranscriptOnly ||
    record.isVirtual ||
    record.isCompactSummary ||
    record.isCollapseSummary
  ) {
    return null
  }
  const message = record.message && typeof record.message === 'object'
    ? record.message as Record<string, unknown>
    : {}
  const role = typeof message.role === 'string'
    ? message.role
    : typeof record.type === 'string'
      ? record.type
      : undefined
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null
  }
  const content = extractTextContent(message.content)
  if (!content.trim()) return null
  return {
    messageId: typeof record.uuid === 'string'
      ? record.uuid
      : typeof message.id === 'string'
        ? message.id
        : randomUUID(),
    role,
    content,
  }
}

export function loadWebChatMessages(
  cwd: string,
  sessionId: string,
): WebChatMessage[] {
  const filePath = getWebChatTranscriptPath(cwd, sessionId)
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return parseTranscriptMessage(line)
      } catch {
        return null
      }
    })
    .filter((message): message is WebChatMessage => Boolean(message))
}

export function hasWebChatTranscriptMessages(cwd: string, sessionId: string): boolean {
  const filePath = getWebChatTranscriptPath(cwd, sessionId)
  if (!existsSync(filePath)) return false
  try {
    return statSync(filePath).size > 0 && loadWebChatMessages(cwd, sessionId).length > 0
  } catch {
    return false
  }
}
