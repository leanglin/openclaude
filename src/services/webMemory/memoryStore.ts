import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  readFileSync,
} from 'fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'
import {
  getAutoMemEntrypoint,
  getAutoMemEntrypointForProject,
  getAutoMemPath,
  getAutoMemPathForProject,
  isAutoMemoryEnabled,
  isExtractModeActive,
} from '../../memdir/paths.js'
import { parseMemoryType } from '../../memdir/memoryTypes.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { getGlobalConfig } from '../../utils/config.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../../utils/file.js'
import {
  getKnowledgeGraphSnapshot,
  setKnowledgeGraphEnabled,
  clearKnowledgeGraph,
} from './knowledgeGraphBridge.js'
import type {
  CreateMemoryFileInput,
  KnowledgeGraphSnapshot,
  MemoryFile,
  MemoryFileDetail,
  MemoryFileKind,
  MemorySearchResult,
  MemoryStatus,
} from './types.js'

const MEMORY_INDEX = 'MEMORY.md'
const MAX_MEMORY_FILE_BYTES = 1 * 1024 * 1024
const MAX_MEMORY_FILES = 500
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

function toPortablePath(value: string): string {
  return value.split(sep).join('/')
}

export function encodeMemoryFileId(relativePath: string): string {
  return Buffer.from(relativePath, 'utf8').toString('base64url')
}

export function decodeMemoryFileId(fileId: string): string {
  const decoded = Buffer.from(fileId, 'base64url').toString('utf8')
  return normalizeRelativeMemoryPath(decoded)
}

function getMemoryDir(cwd?: string): string {
  return resolve(cwd ? getAutoMemPathForProject(cwd) : getAutoMemPath())
}

function getMemoryEntrypoint(cwd?: string): string {
  return resolve(
    cwd ? getAutoMemEntrypointForProject(cwd) : getAutoMemEntrypoint(),
  )
}

function normalizeRelativeMemoryPath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) {
    throw new Error('Invalid memory file path.')
  }
  if (isAbsolute(input) || isAbsolute(normalized)) {
    throw new Error('Memory file path must be relative.')
  }
  const parts = normalized.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Memory file path cannot contain traversal segments.')
  }
  if (extname(normalized).toLowerCase() !== '.md') {
    throw new Error('Only markdown memory files are supported.')
  }
  return normalized
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function realpathDeepestExisting(path: string): string {
  let current = path
  while (true) {
    try {
      return realpathSync(current)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        throw error
      }
      const parent = dirname(current)
      if (parent === current) {
        throw error
      }
      current = parent
    }
  }
}

function ensureMemoryDir(cwd?: string): string {
  const memoryDir = getMemoryDir(cwd)
  mkdirSync(memoryDir, { recursive: true })
  return memoryDir
}

function resolveMemoryPath(
  relativePath: string,
  options: { mustExist?: boolean; createRoot?: boolean; cwd?: string } = {},
): string {
  const safeRelativePath = normalizeRelativeMemoryPath(relativePath)
  const memoryDir = options.createRoot
    ? ensureMemoryDir(options.cwd)
    : getMemoryDir(options.cwd)
  const absolutePath = resolve(memoryDir, safeRelativePath)

  if (!isWithin(resolve(memoryDir), absolutePath)) {
    throw new Error('Memory file path escapes the memory directory.')
  }

  if (options.mustExist && !existsSync(absolutePath)) {
    throw new Error('Memory file was not found.')
  }

  const realMemoryDir = existsSync(memoryDir)
    ? realpathSync(memoryDir)
    : realpathDeepestExisting(dirname(memoryDir))
  const realTarget = existsSync(absolutePath)
    ? realpathSync(absolutePath)
    : realpathDeepestExisting(dirname(absolutePath))

  if (!isWithin(realMemoryDir, realTarget)) {
    throw new Error('Memory file path escapes the memory directory.')
  }

  return absolutePath
}

function getMemoryKind(relativePath: string): MemoryFileKind {
  if (relativePath === MEMORY_INDEX) return 'index'
  if (relativePath.startsWith('logs/')) return 'daily-log'
  return 'topic'
}

function getTitleFromMarkdown(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || undefined
}

function previewContent(markdown: string): string | undefined {
  const stripped = markdown
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped ? stripped.slice(0, 180) : undefined
}

function buildMemoryFile(
  relativePath: string,
  includePreview = false,
  cwd?: string,
): MemoryFile {
  const absolutePath = resolveMemoryPath(relativePath, {
    mustExist: relativePath !== MEMORY_INDEX,
    cwd,
  })
  const exists = existsSync(absolutePath)
  const stats = exists ? statSync(absolutePath) : undefined
  const tooLarge = Boolean(stats && stats.size > MAX_MEMORY_FILE_BYTES)
  let frontmatter: Record<string, unknown> = {}
  let content = ''

  if (exists && !tooLarge) {
    content = readFileSync(absolutePath, 'utf8')
    frontmatter = parseFrontmatter(content, absolutePath).frontmatter
  }

  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description
      : undefined
  const parsedType = parseMemoryType(frontmatter.type)
  const title =
    typeof frontmatter.title === 'string'
      ? frontmatter.title
      : getTitleFromMarkdown(content)
  const kind = getMemoryKind(relativePath)

  return {
    id: encodeMemoryFileId(relativePath),
    name: basename(relativePath),
    relativePath,
    kind,
    sizeBytes: stats?.size ?? 0,
    updatedAt: stats ? new Date(stats.mtimeMs).toISOString() : undefined,
    title,
    description,
    type: parsedType ?? (
      typeof frontmatter.type === 'string' ? frontmatter.type : undefined
    ),
    preview: includePreview && !tooLarge ? previewContent(content) : undefined,
    readonly: kind === 'daily-log' || tooLarge,
  }
}

function walkMemoryFiles(memoryDir: string, cwd?: string): string[] {
  if (!existsSync(memoryDir)) return []
  const files: string[] = []
  const pending = ['']

  while (pending.length > 0 && files.length < MAX_MEMORY_FILES) {
    const currentRelative = pending.pop()!
    const currentAbsolute = currentRelative
      ? join(memoryDir, currentRelative)
      : memoryDir
    let entries
    try {
      entries = readdirSync(currentAbsolute, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= MAX_MEMORY_FILES) break
      if (entry.name.endsWith('.tmp') || entry.name.endsWith('.bak')) continue
      const relativePath = currentRelative
        ? toPortablePath(join(currentRelative, entry.name))
        : entry.name
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          pending.push(relativePath)
        }
        continue
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (extname(entry.name).toLowerCase() !== '.md') continue
      try {
        resolveMemoryPath(relativePath, { mustExist: true, cwd })
        files.push(relativePath)
      } catch {
        // Skip symlink escapes or otherwise invalid memory candidates.
      }
    }
  }

  return files.sort((a, b) => {
    if (a === MEMORY_INDEX) return -1
    if (b === MEMORY_INDEX) return 1
    return a.localeCompare(b)
  })
}

export function listMemoryFiles(cwd?: string): MemoryFile[] {
  const memoryDir = getMemoryDir(cwd)
  const relativePaths = walkMemoryFiles(memoryDir, cwd)
  if (!relativePaths.includes(MEMORY_INDEX)) {
    relativePaths.unshift(MEMORY_INDEX)
  }
  return relativePaths.map(relativePath =>
    buildMemoryFile(relativePath, true, cwd),
  )
}

export async function getMemoryStatus(cwd: string): Promise<MemoryStatus> {
  const files = listMemoryFiles(cwd)
  const graph = await getKnowledgeGraphSnapshot(cwd)
  const autoMemoryEnabled = isAutoMemoryEnabled()
  const knowledgeGraphEnabled = getGlobalConfig().knowledgeGraphEnabled !== false
  const hasMemoryIndex = existsSync(getMemoryEntrypoint(cwd))
  const countedFiles = files.filter(
    file => file.relativePath !== MEMORY_INDEX || hasMemoryIndex,
  )
  return {
    autoMemoryEnabled,
    autoMemoryExtractionEnabled: autoMemoryEnabled && isExtractModeActive(),
    memoryDir: getMemoryDir(cwd),
    memoryEntrypointPath: getMemoryEntrypoint(cwd),
    hasMemoryIndex,
    memoryFileCount: countedFiles.length,
    totalBytes: countedFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    knowledgeGraphEnabled,
    knowledgeGraphCollectionEnabled: knowledgeGraphEnabled,
    knowledgeGraphStats: {
      entityCount: graph.entities.length,
      relationCount: graph.relations.length,
      summaryCount: graph.summaries.length,
      ruleCount: graph.rules.length,
      lastUpdateTime: graph.lastUpdateTime,
    },
  }
}

export function getMemoryFile(fileId: string, cwd?: string): MemoryFileDetail {
  const relativePath = decodeMemoryFileId(fileId)
  const absolutePath = resolveMemoryPath(relativePath, {
    mustExist: relativePath !== MEMORY_INDEX,
    cwd,
  })
  const file = buildMemoryFile(relativePath, false, cwd)
  const warnings: string[] = []

  if (!existsSync(absolutePath)) {
    return { ...file, content: '', frontmatter: {}, warnings }
  }
  if (file.sizeBytes > MAX_MEMORY_FILE_BYTES) {
    warnings.push('This memory file is larger than 1 MB and is read-only.')
    return { ...file, content: '', frontmatter: {}, warnings }
  }

  const content = readFileSync(absolutePath, 'utf8')
  const { frontmatter } = parseFrontmatter(content, absolutePath)
  return { ...file, content, frontmatter, warnings }
}

function writeAtomic(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSyncAndFlush_DEPRECATED(filePath, content, { encoding: 'utf-8' })
}

export function saveMemoryFile(
  fileId: string,
  content: unknown,
  cwd?: string,
): MemoryFileDetail {
  if (typeof content !== 'string') {
    throw new Error('Memory content must be a string.')
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_FILE_BYTES) {
    throw new Error('Memory file content exceeds the 1 MB limit.')
  }
  const relativePath = decodeMemoryFileId(fileId)
  const kind = getMemoryKind(relativePath)
  if (kind === 'daily-log') {
    throw new Error('Daily log memory files are read-only in this view.')
  }
  const absolutePath = resolveMemoryPath(relativePath, { createRoot: true, cwd })
  if (existsSync(absolutePath) && statSync(absolutePath).size > MAX_MEMORY_FILE_BYTES) {
    throw new Error('This memory file is too large to edit.')
  }

  writeAtomic(absolutePath, content)
  return getMemoryFile(encodeMemoryFileId(relativePath), cwd)
}

function safeMemoryFilename(filename: string | undefined): string {
  const raw = (filename ?? '').trim()
  if (!raw) throw new Error('Memory filename is required.')
  const withExtension = raw.toLowerCase().endsWith('.md') ? raw : `${raw}.md`
  const normalized = normalizeRelativeMemoryPath(withExtension)
  if (normalized === MEMORY_INDEX || normalized.startsWith('logs/')) {
    throw new Error('Choose a regular topic memory filename.')
  }
  return normalized
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function buildNewMemoryContent(input: CreateMemoryFileInput): string {
  const lines = ['---']
  if (input.title?.trim()) {
    lines.push(`title: ${yamlString(input.title.trim())}`)
  }
  if (input.description?.trim()) {
    lines.push(`description: ${yamlString(input.description.trim())}`)
  }
  if (input.type?.trim()) {
    lines.push(`type: ${yamlString(input.type.trim())}`)
  }
  lines.push('---', '')

  const body = input.content?.trim() ?? ''
  if (input.title?.trim() && !body.startsWith('#')) {
    lines.push(`# ${input.title.trim()}`, '')
  }
  if (body) lines.push(body, '')
  return lines.join('\n')
}

function addMemoryToIndex(
  relativePath: string,
  input: CreateMemoryFileInput,
  cwd?: string,
): void {
  const indexPath = resolveMemoryPath(MEMORY_INDEX, { createRoot: true, cwd })
  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '# Memory\n'
  if (existing.includes(`](${relativePath})`) || existing.includes(relativePath)) {
    return
  }
  const label = input.title?.trim() || basename(relativePath, '.md')
  const description = input.description?.trim()
  const line = description
    ? `- [${label}](${relativePath}): ${description}`
    : `- [${label}](${relativePath})`
  const next = `${existing.trimEnd()}\n${line}\n`
  writeAtomic(indexPath, next)
}

export function createMemoryFile(
  input: CreateMemoryFileInput,
  cwd?: string,
): MemoryFileDetail {
  const relativePath = safeMemoryFilename(input.filename)
  const absolutePath = resolveMemoryPath(relativePath, { createRoot: true, cwd })
  if (existsSync(absolutePath)) {
    throw new Error('Memory file already exists.')
  }
  const content = buildNewMemoryContent(input)
  if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_FILE_BYTES) {
    throw new Error('Memory file content exceeds the 1 MB limit.')
  }

  writeAtomic(absolutePath, content)
  if (input.addToIndex) {
    addMemoryToIndex(relativePath, input, cwd)
  }
  return getMemoryFile(encodeMemoryFileId(relativePath), cwd)
}

function removeMemoryFromIndex(relativePath: string, cwd?: string): void {
  const indexPath = resolveMemoryPath(MEMORY_INDEX, { createRoot: true, cwd })
  if (!existsSync(indexPath)) return
  const existing = readFileSync(indexPath, 'utf8')
  const next = existing
    .split(/\r?\n/)
    .filter(line => !line.includes(`](${relativePath})`) && !line.includes(relativePath))
    .join('\n')
  if (next !== existing) {
    writeAtomic(indexPath, `${next.trimEnd()}\n`)
  }
}

export function deleteMemoryFile(
  fileId: string,
  confirm: unknown,
  cwd?: string,
): void {
  if (confirm !== true) {
    throw new Error('Deleting a memory file requires confirm=true.')
  }
  const relativePath = decodeMemoryFileId(fileId)
  const kind = getMemoryKind(relativePath)
  if (kind === 'index') {
    throw new Error('MEMORY.md cannot be deleted.')
  }
  if (kind === 'daily-log') {
    throw new Error('Daily log memory files are read-only in this view.')
  }
  const absolutePath = resolveMemoryPath(relativePath, { mustExist: true, cwd })
  unlinkSync(absolutePath)
  removeMemoryFromIndex(relativePath, cwd)
}

export function searchMemoryFiles(
  query: string,
  cwd?: string,
): MemorySearchResult[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const results: MemorySearchResult[] = []
  for (const file of listMemoryFiles(cwd)) {
    if (file.sizeBytes > MAX_MEMORY_FILE_BYTES) continue
    const detail = getMemoryFile(file.id, cwd)
    const haystack = `${file.relativePath}\n${detail.content}`.toLowerCase()
    const index = haystack.indexOf(needle)
    if (index < 0) continue
    const contentIndex = detail.content.toLowerCase().indexOf(needle)
    const snippetSource = contentIndex >= 0 ? detail.content : file.relativePath
    const snippetIndex = contentIndex >= 0 ? contentIndex : 0
    const start = Math.max(0, snippetIndex - 60)
    const end = Math.min(snippetSource.length, snippetIndex + needle.length + 100)
    results.push({
      fileId: file.id,
      relativePath: file.relativePath,
      snippet: snippetSource.slice(start, end).replace(/\s+/g, ' ').trim(),
    })
    if (results.length >= 50) break
  }
  return results
}

export async function getMemoryKnowledgeGraph(
  cwd: string,
): Promise<KnowledgeGraphSnapshot> {
  return getKnowledgeGraphSnapshot(cwd)
}

export function updateKnowledgeGraphEnabled(enabled: unknown): void {
  if (typeof enabled !== 'boolean') {
    throw new Error('enabled must be a boolean.')
  }
  setKnowledgeGraphEnabled(enabled)
}

export async function clearMemoryKnowledgeGraph(
  cwd: string,
  confirm: unknown,
): Promise<void> {
  if (confirm !== true) {
    throw new Error('Clearing the knowledge graph requires confirm=true.')
  }
  await clearKnowledgeGraph(cwd)
}
