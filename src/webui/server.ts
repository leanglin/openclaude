import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { openBrowser as openSystemBrowser } from '../utils/browser.js'
import { PERMISSION_MODES } from '../utils/permissions/PermissionMode.js'
import type { ProfileFileLocation } from '../utils/providerProfile.js'
import { CliChatSession, type SpawnFactory } from './chatSession.js'
import {
  buildBootstrapState,
  buildMidsceneSessionEnv,
  saveProviderProfileFromPayload,
} from './providerProfile.js'
import {
  clearMemoryKnowledgeGraph,
  createMemoryFile,
  deleteMemoryFile,
  getMemoryFile,
  getMemoryKnowledgeGraph,
  getMemoryStatus,
  listMemoryFiles,
  saveMemoryFile,
  searchMemoryFiles,
  updateKnowledgeGraphEnabled,
} from '../services/webMemory/memoryStore.js'
import {
  createSkillAsset,
  deleteSkillAsset,
  getAssetDetail,
  getAssetRoots,
  importSkillAsset,
  listAssets,
  reloadAssets,
  updateSkillAsset,
} from '../services/webAssets/assetStore.js'
import { renderWebUiPage } from './page.js'
import {
  createWebChatSession,
  deleteWebChatSession,
  getWebChatSession,
  hasWebChatTranscriptMessages,
  listWebChatSessions,
  loadWebChatMessages,
  touchWebChatSessionWithUserMessage,
  type WebChatSessionStoreLocation,
} from './sessionStore.js'
import type {
  BootstrapState,
  ClientMessage,
  ProviderProfilePayload,
  ServerEvent,
  WebUiPermissionMode,
} from './types.js'

type WebUiServerOptions = {
  host?: string
  port?: number | string
  cwd?: string
  permissionMode?: string
  openBrowser?: boolean
  spawnFactory?: SpawnFactory
  profileLocation?: ProfileFileLocation
  sessionStoreLocation?: WebChatSessionStoreLocation
}

type WebUiAppOptions = {
  cwd: string
  permissionMode: string
  token: string
  spawnFactory?: SpawnFactory
  profileLocation?: ProfileFileLocation
  sessionStoreLocation?: WebChatSessionStoreLocation
}

type WebUiApp = {
  handler: (request: IncomingMessage, response: ServerResponse) => void
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  close: () => void
}

function parsePort(value: number | string | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '0', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function normalizePermissionMode(mode: string | undefined): WebUiPermissionMode {
  const candidate = mode || 'acceptEdits'
  return (PERMISSION_MODES as readonly string[]).includes(candidate)
    ? candidate as WebUiPermissionMode
    : 'acceptEdits'
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function isAuthorized(request: IncomingMessage, url: URL, token: string): boolean {
  const authorization = request.headers.authorization
  if (authorization === `Bearer ${token}`) return true
  if (request.headers['x-opencat-token'] === token) return true
  return url.searchParams.get('token') === token
}

async function readJsonBody<T>(request: IncomingMessage, limitBytes = 1_000_000): Promise<T> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buffer.length
    if (total > limitBytes) {
      throw new Error('Request body is too large.')
    }
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return JSON.parse(raw || '{}') as T
}

function resolveIconPath(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(moduleDir, 'assets', 'opencat.ico'),
    join(moduleDir, '..', 'src', 'webui', 'assets', 'opencat.ico'),
    join(process.cwd(), 'src', 'webui', 'assets', 'opencat.ico'),
  ]
  return candidates.find(existsSync) ?? null
}

function bootstrap(options: WebUiAppOptions): BootstrapState {
  const chatSessions = listWebChatSessions(
    options.cwd,
    options.sessionStoreLocation,
  )
  return buildBootstrapState({
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    profileLocation: options.profileLocation,
    chatSessions,
    activeChatSessionId: chatSessions[0]?.id,
  })
}

async function handleMemoryApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/memory')) return false

  const parts = url.pathname.split('/').filter(Boolean)

  if (request.method === 'GET' && url.pathname === '/api/memory/status') {
    sendJson(response, 200, await getMemoryStatus(options.cwd))
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/files') {
    sendJson(response, 200, { files: listMemoryFiles() })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/files') {
    const payload = await readJsonBody<Parameters<typeof createMemoryFile>[0]>(request)
    sendJson(response, 200, { file: createMemoryFile(payload) })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/search') {
    sendJson(response, 200, {
      results: searchMemoryFiles(url.searchParams.get('q') ?? ''),
    })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/api/memory/knowledge-graph') {
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/knowledge-graph/enable') {
    const payload = await readJsonBody<{ enabled?: unknown }>(request)
    updateKnowledgeGraphEnabled(payload.enabled)
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/knowledge-graph/clear') {
    const payload = await readJsonBody<{ confirm?: unknown }>(request)
    await clearMemoryKnowledgeGraph(options.cwd, payload.confirm)
    sendJson(response, 200, await getMemoryKnowledgeGraph(options.cwd))
    return true
  }

  if (parts[0] === 'api' && parts[1] === 'memory' && parts[2] === 'files' && parts[3]) {
    const fileId = decodeURIComponent(parts[3])
    if (request.method === 'GET') {
      const file = getMemoryFile(fileId)
      sendJson(response, 200, { file, content: file.content })
      return true
    }
    if (request.method === 'PUT') {
      const payload = await readJsonBody<{ content?: unknown }>(request)
      const file = saveMemoryFile(fileId, payload.content)
      sendJson(response, 200, { file, content: file.content })
      return true
    }
    if (request.method === 'DELETE') {
      const payload = await readJsonBody<{ confirm?: unknown }>(request)
      deleteMemoryFile(fileId, payload.confirm)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  sendJson(response, 404, { error: 'Memory API route was not found.' })
  return true
}

async function handleAssetsApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: WebUiAppOptions,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/assets')) return false

  const parts = url.pathname.split('/').filter(Boolean)

  if (request.method === 'GET' && url.pathname === '/api/assets') {
    sendJson(response, 200, {
      assets: await listAssets(options.cwd, {
        kind: url.searchParams.get('kind'),
        source: url.searchParams.get('source'),
        q: url.searchParams.get('q'),
      }),
      roots: getAssetRoots(options.cwd),
    })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/reload') {
    sendJson(response, 200, await reloadAssets(options.cwd))
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/skills') {
    const payload = await readJsonBody<Parameters<typeof createSkillAsset>[1]>(request)
    sendJson(response, 200, { asset: await createSkillAsset(options.cwd, payload) })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/api/assets/skills/import') {
    const payload = await readJsonBody<Parameters<typeof importSkillAsset>[1]>(request)
    sendJson(response, 200, { asset: await importSkillAsset(options.cwd, payload) })
    return true
  }

  if (parts[0] === 'api' && parts[1] === 'assets' && parts[2] === 'skills' && parts[3]) {
    const assetId = decodeURIComponent(parts[3])
    if (request.method === 'PUT') {
      const payload = await readJsonBody<Parameters<typeof updateSkillAsset>[2]>(request)
      sendJson(response, 200, { asset: await updateSkillAsset(options.cwd, assetId, payload) })
      return true
    }
    if (request.method === 'DELETE') {
      const payload = await readJsonBody<{ confirm?: unknown }>(request)
      await deleteSkillAsset(options.cwd, assetId, payload.confirm)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'assets' && parts[2]) {
    const assetId = decodeURIComponent(parts[2])
    sendJson(response, 200, { asset: await getAssetDetail(options.cwd, assetId) })
    return true
  }

  sendJson(response, 404, { error: 'Assets API route was not found.' })
  return true
}

function sendWs(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event))
  }
}

function parseClientMessage(data: RawData): ClientMessage {
  const parsed = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('Invalid client message.')
  }
  return parsed as ClientMessage
}

function createStatusActivity(title: string, detail?: string): ServerEvent {
  return {
    type: 'activity',
    activity: {
      id: `activity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'status',
      title,
      detail,
      at: Date.now(),
    },
  }
}

function formatWebRuntimeDetail(chatCwd: string): string {
  return `webProcessCwd=${process.cwd()}; cliBundle=${process.argv[1] || '(unknown)'}; chatCwd=${chatCwd}`
}

export function createWebUiApp(options: WebUiAppOptions): WebUiApp {
  const wss = new WebSocketServer({ noServer: true })
  const iconPath = resolveIconPath()

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      try {
        if (request.method === 'GET' && url.pathname === '/') {
          sendText(response, 200, 'text/html; charset=utf-8', renderWebUiPage())
          return
        }

        if (request.method === 'GET' && url.pathname === '/assets/opencat.ico') {
          if (!iconPath) {
            sendJson(response, 404, { error: 'Icon asset is missing.' })
            return
          }
          sendText(response, 200, 'image/x-icon', readFileSync(iconPath))
          return
        }

        if (!isAuthorized(request, url, options.token)) {
          sendJson(response, 401, { error: 'Unauthorized.' })
          return
        }

        if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
          sendJson(response, 200, bootstrap(options))
          return
        }

        if (await handleMemoryApi(request, response, url, options)) {
          return
        }

        if (await handleAssetsApi(request, response, url, options)) {
          return
        }

        if (request.method === 'POST' && url.pathname === '/api/provider-profile') {
          const payload = await readJsonBody<ProviderProfilePayload>(request)
          const profile = saveProviderProfileFromPayload(
            payload,
            options.profileLocation,
          )
          sendJson(response, 200, { profile, bootstrap: bootstrap(options) })
          return
        }

        sendJson(response, 404, { error: 'Not found.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(response, 400, { error: message })
      }
    })()
  }

  wss.on('connection', ws => {
    let session: CliChatSession | null = null
    let activeSessionId = bootstrap(options).activeChatSessionId
    const send = (event: ServerEvent): void => sendWs(ws, event)
    send({ type: 'ready', bootstrap: bootstrap(options) })
    send(createStatusActivity('Web runtime', formatWebRuntimeDetail(options.cwd)))

    if (activeSessionId) {
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: loadWebChatMessages(options.cwd, activeSessionId),
      })
    } else {
      send({ type: 'session_loaded', messages: [] })
    }

    function disposeSession(): void {
      session?.dispose()
      session = null
    }

    function sendSessionsUpdated(): void {
      send({
        type: 'sessions_updated',
        sessions: listWebChatSessions(options.cwd, options.sessionStoreLocation),
        activeSessionId,
      })
    }

    function loadActiveSession(sessionId: string | undefined): void {
      activeSessionId = sessionId
      disposeSession()
      send({ type: 'status', status: 'Ready', detail: 'Session selected' })
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: activeSessionId
          ? loadWebChatMessages(options.cwd, activeSessionId)
          : [],
      })
    }

    function createAndSelectSession(): void {
      const record = createWebChatSession(
        options.cwd,
        options.sessionStoreLocation,
      )
      activeSessionId = record.id
      disposeSession()
      sendSessionsUpdated()
      send({
        type: 'session_loaded',
        sessionId: activeSessionId,
        messages: [],
      })
      send({ type: 'status', status: 'Ready', detail: 'New chat created' })
    }

    function ensureActiveSessionForMessage(text: string): string {
      if (!activeSessionId) {
        activeSessionId = createWebChatSession(
          options.cwd,
          options.sessionStoreLocation,
        ).id
      }
      touchWebChatSessionWithUserMessage(
        options.cwd,
        activeSessionId,
        text,
        options.sessionStoreLocation,
      )
      sendSessionsUpdated()
      return activeSessionId
    }

    function ensureSession(): CliChatSession {
      if (!activeSessionId) {
        activeSessionId = createWebChatSession(
          options.cwd,
          options.sessionStoreLocation,
        ).id
        sendSessionsUpdated()
      }
      if (!session) {
        session = new CliChatSession({
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          send,
          env: buildMidsceneSessionEnv(options.profileLocation),
          spawnFactory: options.spawnFactory,
          sessionId: activeSessionId,
          resumeSession: hasWebChatTranscriptMessages(options.cwd, activeSessionId),
        })
      }
      return session
    }

    ws.on('message', data => {
      try {
        const message = parseClientMessage(data)
        if (message.type === 'new_session') {
          createAndSelectSession()
          return
        }
        if (message.type === 'refresh_session') {
          disposeSession()
          send({ type: 'status', status: 'Ready', detail: 'Session refreshed' })
          send({ type: 'ready', bootstrap: bootstrap(options) })
          return
        }
        if (message.type === 'select_session') {
          if (!getWebChatSession(options.cwd, message.sessionId, options.sessionStoreLocation)) {
            send({ type: 'error', message: 'Chat session was not found.' })
            return
          }
          loadActiveSession(message.sessionId)
          sendSessionsUpdated()
          return
        }
        if (message.type === 'delete_session') {
          const deleted = deleteWebChatSession(
            options.cwd,
            message.sessionId,
            options.sessionStoreLocation,
          )
          if (!deleted) {
            send({ type: 'error', message: 'Chat session was not found.' })
            return
          }
          const remaining = listWebChatSessions(
            options.cwd,
            options.sessionStoreLocation,
          )
          if (message.sessionId === activeSessionId) {
            loadActiveSession(remaining[0]?.id)
          }
          sendSessionsUpdated()
          return
        }
        if (message.type === 'send_message') {
          ensureActiveSessionForMessage(message.text)
          ensureSession().handleClientMessage(message)
          return
        }
        if (message.type === 'permission_response') {
          if (!session) {
            send({ type: 'error', message: 'Permission request is no longer pending.' })
            return
          }
          session.handleClientMessage(message)
          return
        }
        if (message.type === 'abort') {
          if (!session) {
            send({ type: 'status', status: 'Ready', detail: 'No running session' })
            return
          }
          session.handleClientMessage(message)
          return
        }
        ensureSession().handleClientMessage(message)
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })

    ws.on('close', () => {
      session?.dispose()
      session = null
    })
  })

  const handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws' || !isAuthorized(request, url, options.token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request)
    })
  }

  return {
    handler,
    handleUpgrade,
    close: () => {
      wss.clients.forEach(client => client.terminate())
      wss.close(() => {})
    },
  }
}

function formatBrowserHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '[::1]'
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`
  return host
}

export async function startWebUi(rawOptions: WebUiServerOptions = {}): Promise<void> {
  const host = rawOptions.host || '127.0.0.1'
  const cwd = resolve(rawOptions.cwd ?? process.cwd())
  const permissionMode = normalizePermissionMode(rawOptions.permissionMode)
  const token = randomBytes(24).toString('base64url')
  const app = createWebUiApp({
    cwd,
    permissionMode,
    token,
    spawnFactory: rawOptions.spawnFactory,
    profileLocation: rawOptions.profileLocation,
    sessionStoreLocation: rawOptions.sessionStoreLocation,
  })
  const server = createServer(app.handler)
  server.on('upgrade', app.handleUpgrade)

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(parsePort(rawOptions.port), host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address() as AddressInfo
  const url = `http://${formatBrowserHost(host)}:${address.port}/#token=${token}`
  process.stdout.write(`OpenCat Web: ${url}\n`)

  if (rawOptions.openBrowser !== false) {
    void openSystemBrowser(url)
  }

  await new Promise<void>(resolveClose => {
    let closing = false
    const close = (): void => {
      if (closing) return
      closing = true
      app.close()
      server.close(() => resolveClose())
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    server.once('close', resolveClose)
  })
}
