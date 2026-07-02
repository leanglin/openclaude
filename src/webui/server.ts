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
import { CliChatSession, type SpawnFactory } from './chatSession.js'
import { buildBootstrapState, saveProviderProfileFromPayload } from './providerProfile.js'
import { renderWebUiPage } from './page.js'
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
}

type WebUiAppOptions = {
  cwd: string
  permissionMode: string
  token: string
  spawnFactory?: SpawnFactory
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
  return buildBootstrapState({
    cwd: options.cwd,
    permissionMode: options.permissionMode,
  })
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

        if (request.method === 'POST' && url.pathname === '/api/provider-profile') {
          const payload = await readJsonBody<ProviderProfilePayload>(request)
          const profile = saveProviderProfileFromPayload(payload)
          sendJson(response, 200, { profile })
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
    const send = (event: ServerEvent): void => sendWs(ws, event)
    send({ type: 'ready', bootstrap: bootstrap(options) })

    function ensureSession(): CliChatSession {
      if (!session) {
        session = new CliChatSession({
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          send,
          spawnFactory: options.spawnFactory,
        })
      }
      return session
    }

    ws.on('message', data => {
      try {
        const message = parseClientMessage(data)
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
      wss.clients.forEach(client => client.close())
      wss.close()
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
