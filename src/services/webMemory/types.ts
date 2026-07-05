export type MemoryFileKind = 'index' | 'topic' | 'daily-log' | 'other'

export type MemoryStatus = {
  autoMemoryEnabled: boolean
  autoMemoryExtractionEnabled: boolean
  memoryDir: string
  memoryEntrypointPath: string
  hasMemoryIndex: boolean
  memoryFileCount: number
  totalBytes: number
  knowledgeGraphEnabled: boolean
  knowledgeGraphCollectionEnabled: boolean
  knowledgeGraphStats: {
    entityCount: number
    relationCount: number
    summaryCount: number
    ruleCount: number
    lastUpdateTime?: number
  }
}

export type MemoryFile = {
  id: string
  name: string
  relativePath: string
  kind: MemoryFileKind
  sizeBytes: number
  updatedAt?: string
  title?: string
  description?: string
  type?: string
  preview?: string
  readonly: boolean
}

export type MemoryFileDetail = MemoryFile & {
  content: string
  frontmatter?: Record<string, unknown>
  warnings?: string[]
}

export type MemorySearchResult = {
  fileId: string
  relativePath: string
  snippet: string
}

export type KnowledgeGraphSnapshot = {
  enabled: boolean
  entities: Array<{
    id: string
    type: string
    name: string
    attributes: Record<string, string>
  }>
  relations: Array<{
    sourceId: string
    targetId: string
    type: string
  }>
  summaries: Array<{
    id: string
    content: string
    keywords: string[]
    timestamp: number
  }>
  rules: string[]
  lastUpdateTime: number
}

export type CreateMemoryFileInput = {
  filename?: string
  title?: string
  description?: string
  type?: string
  content?: string
  addToIndex?: boolean
}
