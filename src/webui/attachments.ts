import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { getProjectDir } from '../utils/sessionStoragePortable.js'
import type { WebMessageAttachment } from './types.js'

export const WEB_MESSAGE_ATTACHMENT_MAX_COUNT = 10
export const WEB_MESSAGE_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024

export type StagedWebMessageAttachment = {
  originalName: string
  path: string
  size: number
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'session'
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = String(name || 'attachment')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || 'attachment'
  const sanitized = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return sanitized || 'attachment'
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  if (process.platform === 'win32') {
    const left = normalizedParent.toLowerCase()
    const right = normalizedChild.toLowerCase()
    return right === left || right.startsWith(left + sep)
  }
  return normalizedChild === normalizedParent || normalizedChild.startsWith(normalizedParent + sep)
}

function decodeAttachmentContent(attachment: WebMessageAttachment): Buffer {
  const content = String(attachment.contentBase64 ?? '')
  const declaredSize = Number(attachment.size)
  if (!Number.isFinite(declaredSize) || declaredSize < 0) {
    throw new Error(`Attachment "${attachment.name}" size is invalid.`)
  }
  if ((content && !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) || content.length % 4 !== 0) {
    throw new Error(`Attachment "${attachment.name}" is not valid base64.`)
  }
  const buffer = Buffer.from(content, 'base64')
  if (buffer.length > WEB_MESSAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `Attachment "${attachment.name}" exceeds ${WEB_MESSAGE_ATTACHMENT_MAX_BYTES} bytes.`,
    )
  }
  if (declaredSize !== buffer.length) {
    throw new Error(`Attachment "${attachment.name}" size does not match its payload.`)
  }
  return buffer
}

export function getWebMessageAttachmentDir(cwd: string, sessionId: string): string {
  return join(getProjectDir(cwd), 'attachments', sanitizeSessionId(sessionId))
}

export async function stageWebMessageAttachments(params: {
  cwd: string
  sessionId: string
  attachments?: readonly WebMessageAttachment[]
}): Promise<StagedWebMessageAttachment[]> {
  const attachments = params.attachments ?? []
  if (attachments.length === 0) return []
  if (attachments.length > WEB_MESSAGE_ATTACHMENT_MAX_COUNT) {
    throw new Error(`Too many attachments. Maximum is ${WEB_MESSAGE_ATTACHMENT_MAX_COUNT}.`)
  }

  const dir = getWebMessageAttachmentDir(params.cwd, params.sessionId)
  await mkdir(dir, { recursive: true })

  const staged: StagedWebMessageAttachment[] = []
  for (const [index, attachment] of attachments.entries()) {
    const name = sanitizeAttachmentFileName(attachment.name)
    const buffer = decodeAttachmentContent(attachment)
    const target = resolve(
      dir,
      `${Date.now()}-${index + 1}-${randomUUID().slice(0, 8)}-${name}`,
    )
    if (!isInside(dir, target)) {
      throw new Error(`Attachment "${attachment.name}" resolved outside the attachment directory.`)
    }
    await writeFile(target, buffer, { flag: 'wx' })
    staged.push({
      originalName: name,
      path: target,
      size: buffer.length,
    })
  }
  return staged
}

function quoteAtPath(path: string): string {
  if (path.includes('"')) {
    throw new Error(`Attachment path contains a quote and cannot be referenced: ${path}`)
  }
  return `@"${path}"`
}

export function prependAttachmentReferences(
  text: string,
  staged: readonly StagedWebMessageAttachment[],
): string {
  const trimmed = text.trim()
  if (staged.length === 0) return trimmed
  const lines = [
    '附件文件：',
    ...staged.map(attachment => `- ${attachment.originalName}: ${quoteAtPath(attachment.path)}`),
  ]
  return [lines.join('\n'), trimmed].filter(Boolean).join('\n\n')
}

export function attachmentTitleFallback(
  text: string,
  attachments?: readonly WebMessageAttachment[],
): string {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  const names = (attachments ?? []).map(attachment => sanitizeAttachmentFileName(attachment.name))
  return names.length ? `Attachments: ${names.join(', ')}` : trimmed
}
