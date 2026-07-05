import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export const DEFAULT_PLATFORM_BASE_URL = 'http://172.21.39.142:8000'

const AUTH_TIMEOUT_MS = 8_000

export type PlatformAuthMethod = 'password' | 'sso'
export type PlatformAuthValidationStatus = 'unknown' | 'valid' | 'invalid' | 'error'

export type PlatformAuthSession = {
  accessToken: string
  apiToken: string
  baseUrl: string
  method: PlatformAuthMethod
  identityName: string
  authenticatedAt: string
  lastValidatedAt?: string
  validationStatus?: PlatformAuthValidationStatus
  lastValidationMessage?: string
}

export type PlatformAuthStatus = {
  authenticated: boolean
  baseUrl: string
  method?: PlatformAuthMethod
  identityName?: string
  authenticatedAt?: string
  lastValidatedAt?: string
  validationStatus: PlatformAuthValidationStatus
  message: string
}

export type CaptchaResult = {
  success: boolean
  message: string
  baseUrl?: string
  captchaKey?: string
  captchaImageBase64?: string
}

export type SsoCodeResult = {
  success: boolean
  message: string
  baseUrl?: string
  account?: string
  uuid?: string
}

export type LoginResult = {
  success: boolean
  message: string
  status?: PlatformAuthStatus
}

export type TokenValidationResult = {
  valid: boolean
  message: string
}

type JsonObject = Record<string, unknown>
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function asRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function trimOptional(value: unknown): string | undefined {
  const text = stringValue(value).trim()
  return text ? text : undefined
}

function readJson(path: string): JsonObject | undefined {
  if (!existsSync(path)) return undefined
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return undefined
  }
}

function writeJsonAtomic(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  renameSync(tempPath, path)
}

export function normalizePlatformBaseUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const parsed = new URL(withScheme)
    return parsed.origin.replace(/\/+$/, '')
  } catch {
    return withScheme.replace(/\/+$/, '')
  }
}

export function platformBaseUrlFromConfigPayload(payload: unknown): string | undefined {
  const root = asRecord(payload)
  if (!root) return undefined

  const update = asRecord(root.update)
  const updateBase = trimOptional(update?.platform_base_url)
  if (updateBase) return normalizePlatformBaseUrl(updateBase)

  const server = asRecord(root.server)
  const host = trimOptional(server?.host)
  if (!server || !host) return undefined
  if (/^https?:\/\//i.test(host)) return normalizePlatformBaseUrl(host)

  const protocol = trimOptional(server.protocol) || 'http'
  const port = trimOptional(server.port)
  return normalizePlatformBaseUrl(`${protocol}://${host}${port ? `:${port}` : ''}`)
}

export function resolvePlatformBaseUrl(options: {
  savedBaseUrl?: string
  configDir?: string
  env?: NodeJS.ProcessEnv
} = {}): string {
  const saved = trimOptional(options.savedBaseUrl)
  if (saved) return normalizePlatformBaseUrl(saved)

  const env = options.env ?? process.env
  const fromEnv =
    trimOptional(env.OPENCAT_PLATFORM_BASE_URL) ||
    trimOptional(env.OPENCAT_UPDATE_BASE_URL)
  if (fromEnv) return normalizePlatformBaseUrl(fromEnv)

  const configDir = options.configDir ?? getClaudeConfigHomeDir()
  const candidates = [
    join(configDir, 'config.json'),
    join(configDir, 'config', 'config.json'),
  ]
  for (const path of candidates) {
    const baseUrl = platformBaseUrlFromConfigPayload(readJson(path))
    if (baseUrl) return baseUrl
  }

  return DEFAULT_PLATFORM_BASE_URL
}

export function authorizationHeader(accessToken: string): string {
  const token = accessToken.trim()
  const lower = token.toLowerCase()
  if (lower.startsWith('jwt ') || lower.startsWith('bearer ')) return token
  return `JWT ${token}`
}

export function getPlatformAuthStatePath(configDir = getClaudeConfigHomeDir()): string {
  return join(configDir, 'webui', 'platform-auth.json')
}

export function loadPlatformAuthSession(options: {
  configDir?: string
} = {}): PlatformAuthSession | null {
  const payload = readJson(getPlatformAuthStatePath(options.configDir))
  if (!payload) return null
  const accessToken = stringValue(payload.accessToken).trim()
  const baseUrl = normalizePlatformBaseUrl(stringValue(payload.baseUrl))
  const method = payload.method === 'sso' ? 'sso' : payload.method === 'password' ? 'password' : undefined
  if (!accessToken || !baseUrl || !method) return null
  return {
    accessToken,
    apiToken: stringValue(payload.apiToken).trim() || accessToken,
    baseUrl,
    method,
    identityName: stringValue(payload.identityName).trim(),
    authenticatedAt: stringValue(payload.authenticatedAt).trim(),
    lastValidatedAt: trimOptional(payload.lastValidatedAt),
    validationStatus:
      payload.validationStatus === 'valid' ||
      payload.validationStatus === 'invalid' ||
      payload.validationStatus === 'error'
        ? payload.validationStatus
        : 'unknown',
    lastValidationMessage: trimOptional(payload.lastValidationMessage),
  }
}

export function savePlatformAuthSession(
  session: PlatformAuthSession,
  options: { configDir?: string } = {},
): void {
  writeJsonAtomic(getPlatformAuthStatePath(options.configDir), session)
}

export function clearPlatformAuthSession(options: { configDir?: string } = {}): void {
  rmSync(getPlatformAuthStatePath(options.configDir), { force: true })
}

function statusFromSession(
  session: PlatformAuthSession | null,
  baseUrl?: string,
): PlatformAuthStatus {
  if (!session) {
    return {
      authenticated: false,
      baseUrl: resolvePlatformBaseUrl({ savedBaseUrl: baseUrl }),
      validationStatus: 'unknown',
      message: '未登录',
    }
  }
  return {
    authenticated: true,
    baseUrl: session.baseUrl,
    method: session.method,
    identityName: session.identityName,
    authenticatedAt: session.authenticatedAt,
    lastValidatedAt: session.lastValidatedAt,
    validationStatus: session.validationStatus || 'unknown',
    message: session.lastValidationMessage || '已保存认证',
  }
}

function isApiSuccess(payload: JsonObject): boolean {
  return payload.success === true || payload.code === 2000 || payload.code === 200
}

function apiMessage(payload: JsonObject, fallback: string): string {
  return (
    trimOptional(payload.message) ||
    trimOptional(payload.msg) ||
    trimOptional(asRecord(payload.detail)?.message) ||
    fallback
  )
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetcher: FetchLike,
  timeoutMs = AUTH_TIMEOUT_MS,
): Promise<JsonObject> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal })
    const text = await response.text()
    const payload = text.trim() ? JSON.parse(text) : {}
    if (!response.ok) {
      return {
        success: false,
        message: `HTTP ${response.status}: ${text.slice(0, 300)}`,
      }
    }
    return asRecord(payload) || {}
  } finally {
    clearTimeout(timer)
  }
}

function extractData(payload: JsonObject): JsonObject {
  return asRecord(payload.data) || {}
}

function extractAccessToken(payload: JsonObject): string {
  const data = extractData(payload)
  for (const source of [data, payload]) {
    for (const key of ['access', 'access_token', 'token', 'api_token']) {
      const value = trimOptional(source[key])
      if (value) return value
    }
  }
  return ''
}

function extractApiToken(payload: JsonObject, accessToken: string): string {
  const data = extractData(payload)
  for (const source of [data, payload]) {
    for (const key of ['token', 'api_token']) {
      const value = trimOptional(source[key])
      if (value) return value
    }
  }
  return accessToken
}

function stripDataUrlPrefix(value: string): string {
  const marker = ';base64,'
  const index = value.indexOf(marker)
  return index >= 0 ? value.slice(index + marker.length) : value
}

function authHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: authorizationHeader(token) } : {}),
  }
}

export async function getPlatformCaptcha(options: {
  baseUrl?: string
  fetcher?: FetchLike
  configDir?: string
} = {}): Promise<CaptchaResult> {
  const baseUrl = resolvePlatformBaseUrl({
    savedBaseUrl: options.baseUrl,
    configDir: options.configDir,
  })
  try {
    const payload = await fetchJson(
      `${baseUrl}/api/captcha/`,
      { method: 'GET', headers: authHeaders() },
      options.fetcher ?? fetch,
    )
    if (!isApiSuccess(payload)) {
      return { success: false, message: apiMessage(payload, '验证码获取失败'), baseUrl }
    }
    const data = extractData(payload)
    const captchaKey =
      trimOptional(data.key) ||
      trimOptional(data.captchaKey) ||
      trimOptional(data.hashkey)
    const image =
      trimOptional(data.image_base) ||
      trimOptional(data.image) ||
      trimOptional(data.img)
    if (!captchaKey || !image) {
      return { success: false, message: '验证码响应缺少图片或 key', baseUrl }
    }
    return {
      success: true,
      message: '验证码获取成功',
      baseUrl,
      captchaKey,
      captchaImageBase64: stripDataUrlPrefix(image),
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      baseUrl,
    }
  }
}

export async function sendPlatformSsoCode(options: {
  baseUrl?: string
  account: string
  fetcher?: FetchLike
  configDir?: string
}): Promise<SsoCodeResult> {
  const account = options.account.trim()
  if (!account) return { success: false, message: '账号不能为空' }
  const baseUrl = resolvePlatformBaseUrl({
    savedBaseUrl: options.baseUrl,
    configDir: options.configDir,
  })
  try {
    const payload = await fetchJson(
      `${baseUrl}/api/sso/send-code/`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account }),
      },
      options.fetcher ?? fetch,
      30_000,
    )
    if (!isApiSuccess(payload)) {
      return { success: false, message: apiMessage(payload, '验证码发送失败'), baseUrl }
    }
    const uuid = trimOptional(extractData(payload).uuid) || trimOptional(payload.uuid)
    if (!uuid) {
      return { success: false, message: '验证码发送成功，但响应缺少 uuid', baseUrl }
    }
    return { success: true, message: '验证码已发送', baseUrl, account, uuid }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      baseUrl,
    }
  }
}

async function saveLoginPayload(options: {
  payload: JsonObject
  baseUrl: string
  method: PlatformAuthMethod
  identityName: string
  configDir?: string
}): Promise<LoginResult> {
  if (!isApiSuccess(options.payload)) {
    return {
      success: false,
      message: apiMessage(options.payload, '登录失败'),
    }
  }
  const accessToken = extractAccessToken(options.payload)
  if (!accessToken) {
    return { success: false, message: '登录成功，但响应缺少 access token' }
  }
  const session: PlatformAuthSession = {
    accessToken,
    apiToken: extractApiToken(options.payload, accessToken),
    baseUrl: options.baseUrl,
    method: options.method,
    identityName: options.identityName,
    authenticatedAt: new Date().toISOString(),
    validationStatus: 'unknown',
    lastValidationMessage: '已登录',
  }
  savePlatformAuthSession(session, { configDir: options.configDir })
  return {
    success: true,
    message: '登录成功',
    status: statusFromSession(session),
  }
}

export async function loginPlatformPassword(options: {
  baseUrl?: string
  username: string
  password: string
  captcha: string
  captchaKey: string
  fetcher?: FetchLike
  configDir?: string
}): Promise<LoginResult> {
  const username = options.username.trim()
  if (!username) return { success: false, message: '用户名不能为空' }
  if (!options.password) return { success: false, message: '密码不能为空' }
  if (!options.captcha.trim()) return { success: false, message: '验证码不能为空' }
  if (!options.captchaKey.trim()) return { success: false, message: '请先获取验证码' }
  const baseUrl = resolvePlatformBaseUrl({
    savedBaseUrl: options.baseUrl,
    configDir: options.configDir,
  })
  try {
    const payload = await fetchJson(
      `${baseUrl}/api/login/`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password: options.password,
          captcha: options.captcha.trim(),
          captchaKey: options.captchaKey.trim(),
        }),
      },
      options.fetcher ?? fetch,
    )
    return saveLoginPayload({
      payload,
      baseUrl,
      method: 'password',
      identityName: username,
      configDir: options.configDir,
    })
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function loginPlatformSso(options: {
  baseUrl?: string
  account: string
  code: string
  uuid: string
  fetcher?: FetchLike
  configDir?: string
}): Promise<LoginResult> {
  const account = options.account.trim()
  if (!account) return { success: false, message: '账号不能为空' }
  if (!options.code.trim()) return { success: false, message: '验证码不能为空' }
  if (!options.uuid.trim()) return { success: false, message: '请先发送验证码' }
  const baseUrl = resolvePlatformBaseUrl({
    savedBaseUrl: options.baseUrl,
    configDir: options.configDir,
  })
  try {
    const payload = await fetchJson(
      `${baseUrl}/api/sso/login/`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: account,
          code: options.code.trim(),
          uuid: options.uuid.trim(),
        }),
      },
      options.fetcher ?? fetch,
      30_000,
    )
    return saveLoginPayload({
      payload,
      baseUrl,
      method: 'sso',
      identityName: account,
      configDir: options.configDir,
    })
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function validatePlatformToken(options: {
  baseUrl: string
  accessToken: string
  fetcher?: FetchLike
}): Promise<TokenValidationResult> {
  const token = options.accessToken.trim()
  if (!token) return { valid: false, message: '缺少 token' }
  const baseUrl = normalizePlatformBaseUrl(options.baseUrl)
  const fetcher = options.fetcher ?? fetch
  const probes = [
    `${baseUrl}/api/system/robot_dataset/?dataset_type=9&data_type=1&page=1&limit=1`,
    `${baseUrl}/api/system/dataset/?datasetType=7&dataType=1&page=1&limit=1`,
  ]
  let lastMessage = '认证未通过'
  for (const url of probes) {
    try {
      const payload = await fetchJson(
        url,
        { method: 'GET', headers: authHeaders(token) },
        fetcher,
      )
      if (isApiSuccess(payload)) return { valid: true, message: 'ok' }
      lastMessage = apiMessage(payload, lastMessage)
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
  }
  return { valid: false, message: lastMessage }
}

export async function getPlatformAuthStatus(options: {
  forceValidate?: boolean
  fetcher?: FetchLike
  configDir?: string
} = {}): Promise<PlatformAuthStatus> {
  const session = loadPlatformAuthSession({ configDir: options.configDir })
  if (!session) {
    return statusFromSession(null)
  }
  if (!options.forceValidate) return statusFromSession(session)

  const validation = await validatePlatformToken({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    fetcher: options.fetcher,
  })
  const updated: PlatformAuthSession = {
    ...session,
    lastValidatedAt: new Date().toISOString(),
    validationStatus: validation.valid ? 'valid' : 'invalid',
    lastValidationMessage: validation.message,
  }
  savePlatformAuthSession(updated, { configDir: options.configDir })
  return statusFromSession(updated)
}
