import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { PRODUCT_VERSION } from '../../constants/product.js'
import { authorizationHeader } from '../platformAuth/index.js'

const HUB_TIMEOUT_MS = 15_000
const HUB_UPLOAD_TIMEOUT_MS = 60_000

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type JsonObject = Record<string, unknown>

export type AssetHubAssetType = 'skill' | 'knowledge'

export type AssetHubListOptions = {
  baseUrl: string
  accessToken: string
  search?: string
  assetType?: string
  ordering?: string
  page?: number
  limit?: number
  fetcher?: FetchLike
}

export type AssetHubUploadOptions = {
  baseUrl: string
  accessToken: string
  metadata: {
    title: string
    version: string
    applicableRoles: string
    applicableBusiness: string
    description: string
    assetType: AssetHubAssetType
    sourceAssetId?: string
    sourceAssetVersion?: string
  }
  filename: string
  markdown: string
  fetcher?: FetchLike
}

function asRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function apiUrl(baseUrl: string, path: string, params?: URLSearchParams): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`)
  if (params) {
    for (const [key, value] of params) url.searchParams.set(key, value)
  }
  return url.toString()
}

async function requestJson(
  method: string,
  url: string,
  accessToken: string,
  options: {
    body?: unknown
    timeoutMs?: number
    fetcher?: FetchLike
    headers?: Record<string, string>
  } = {},
): Promise<JsonObject> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? HUB_TIMEOUT_MS)
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: authorizationHeader(accessToken),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
    const text = await response.text()
    let payload: unknown = {}
    try {
      payload = text.trim() ? JSON.parse(text) : {}
    } catch {
      throw new Error(`Platform Hub returned non-JSON response: ${text.slice(0, 200)}`)
    }
    if (!response.ok) {
      throw new Error(`Platform Hub request failed with HTTP ${response.status}: ${text.slice(0, 500)}`)
    }
    const record = asRecord(payload) ?? {}
    const code = record.code
    if (code !== undefined && code !== null && code !== 2000 && code !== 200) {
      throw new Error(trimString(record.msg) || trimString(record.message) || 'Platform Hub request failed.')
    }
    const data = 'data' in record ? record.data : record
    if (Array.isArray(data)) {
      return {
        items: data,
        total: record.total ?? data.length,
        page: record.page ?? 1,
        limit: record.limit ?? (data.length || 1),
        raw: record,
      }
    }
    const dataRecord = asRecord(data)
    if (!dataRecord) return { raw: record }
    if ('total' in record && !('total' in dataRecord)) {
      return {
        ...dataRecord,
        total: record.total,
        page: record.page,
        limit: record.limit,
      }
    }
    return dataRecord
  } finally {
    clearTimeout(timer)
  }
}

export async function listAssetHubAssets(options: AssetHubListOptions): Promise<JsonObject> {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(1, Math.trunc(options.page || 1))))
  params.set('limit', String(Math.max(1, Math.min(100, Math.trunc(options.limit || 10)))))
  params.set('ordering', options.ordering?.trim() || '-create_datetime')
  params.set('status', '1')
  if (options.search?.trim()) params.set('search', options.search.trim())
  if (options.assetType?.trim()) params.set('asset_type', options.assetType.trim())
  return requestJson(
    'GET',
    apiUrl(options.baseUrl, '/api/system/agent_hub_asset/', params),
    options.accessToken,
    { fetcher: options.fetcher },
  )
}

export async function getAssetHubAsset(options: {
  baseUrl: string
  accessToken: string
  assetId: string
  fetcher?: FetchLike
}): Promise<JsonObject> {
  return requestJson(
    'GET',
    apiUrl(options.baseUrl, `/api/system/agent_hub_asset/${encodeURIComponent(options.assetId)}/`),
    options.accessToken,
    { fetcher: options.fetcher },
  )
}

export async function previewAssetHubAsset(options: {
  baseUrl: string
  accessToken: string
  assetId: string
  fetcher?: FetchLike
}): Promise<JsonObject> {
  return requestJson(
    'GET',
    apiUrl(options.baseUrl, `/api/system/agent_hub_asset/${encodeURIComponent(options.assetId)}/preview/`),
    options.accessToken,
    { fetcher: options.fetcher },
  )
}

export async function downloadAssetHubAsset(options: {
  baseUrl: string
  accessToken: string
  assetId: string
  fetcher?: FetchLike
}): Promise<JsonObject> {
  return requestJson(
    'GET',
    apiUrl(options.baseUrl, `/api/system/agent_hub_asset/${encodeURIComponent(options.assetId)}/download/`),
    options.accessToken,
    { fetcher: options.fetcher },
  )
}

export async function voteAssetHubAsset(options: {
  baseUrl: string
  accessToken: string
  assetId: string
  vote: string
  fetcher?: FetchLike
}): Promise<JsonObject> {
  return requestJson(
    'POST',
    apiUrl(options.baseUrl, `/api/system/agent_hub_asset/${encodeURIComponent(options.assetId)}/vote/`),
    options.accessToken,
    { body: { vote: options.vote }, fetcher: options.fetcher },
  )
}

function safeUploadFilename(filename: string, assetType: AssetHubAssetType): string {
  if (assetType === 'skill') return 'SKILL.md'
  const name = basename(filename || 'knowledge.md')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return (name || 'knowledge').toLowerCase().endsWith('.md')
    ? (name || 'knowledge.md')
    : `${name || 'knowledge'}.md`
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function uploadAssetToHub(options: AssetHubUploadOptions): Promise<JsonObject> {
  const markdown = options.markdown
  if (!markdown.trim()) throw new Error('Asset markdown source is empty.')
  const filename = safeUploadFilename(options.filename, options.metadata.assetType)
  const payloadBytes = new TextEncoder().encode(markdown)
  const uploadInfo = await requestJson(
    'POST',
    apiUrl(options.baseUrl, '/api/system/agent_hub_asset/init_upload/'),
    options.accessToken,
    {
      body: {
        file_name: filename,
        file_size: payloadBytes.byteLength,
        asset_type: options.metadata.assetType,
      },
      fetcher: options.fetcher,
    },
  )
  const uploadUrl = trimString(uploadInfo.upload_url)
  const objectName = trimString(uploadInfo.object_name)
  if (!uploadUrl || !objectName) {
    throw new Error('Platform Hub did not return a valid upload URL.')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HUB_UPLOAD_TIMEOUT_MS)
  try {
    const putResponse = await (options.fetcher ?? fetch)(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payloadBytes,
      signal: controller.signal,
    })
    const text = await putResponse.text()
    if (!putResponse.ok) {
      throw new Error(`Hub object upload failed with HTTP ${putResponse.status}: ${text.slice(0, 500)}`)
    }
  } finally {
    clearTimeout(timer)
  }

  return requestJson(
    'POST',
    apiUrl(options.baseUrl, '/api/system/agent_hub_asset/complete_upload/'),
    options.accessToken,
    {
      body: {
        title: options.metadata.title,
        asset_type: options.metadata.assetType,
        version: options.metadata.version,
        applicable_roles: options.metadata.applicableRoles,
        applicable_business: options.metadata.applicableBusiness,
        description_text: options.metadata.description,
        source_asset_id: options.metadata.sourceAssetId || '',
        source_asset_version: options.metadata.sourceAssetVersion || '',
        client_version: PRODUCT_VERSION,
        object_name: objectName,
        file_name: filename,
        file_size: payloadBytes.byteLength,
        sha256: sha256(markdown),
      },
      fetcher: options.fetcher,
      timeoutMs: HUB_UPLOAD_TIMEOUT_MS,
    },
  )
}
