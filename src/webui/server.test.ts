import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, test } from 'bun:test'
import { createWebUiApp, ensureWebUiBootstrapDirs } from './server.js'
import { buildMidsceneSessionEnv } from './providerProfile.js'
import { createWebChatSession } from './sessionStore.js'
import type { ServerEvent } from './types.js'
import { getAutoMemPath, getAutoMemPathForProject } from '../memdir/paths.js'
import { clearCommandsCache } from '../commands.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.js'
import { saveGlobalConfig } from '../utils/config.js'
import { clearAllCaches } from '../utils/plugins/cacheUtils.js'
import { clearInstalledPluginsCache } from '../utils/plugins/installedPluginsManager.js'
import { clearMarketplacesCache } from '../utils/plugins/marketplaceManager.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
} from '../utils/settings/settingsCache.js'
import { getManagedFilePath } from '../utils/settings/managedPath.js'

let tempApiDir: string | undefined
let previousMemoryOverride: string | undefined
let previousConfigHome: string | undefined
let previousPluginCacheDir: string | undefined
let previousUserType: string | undefined
let previousManagedSettingsPath: string | undefined

function setupIsolatedApiState(): {
  cwd: string
  memoryDir: string
  configDir: string
  pluginCacheDir: string
  managedDir: string
} {
  previousMemoryOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  previousConfigHome = getClaudeConfigHomeDirOverrideForTesting()
  previousPluginCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  previousUserType = process.env.USER_TYPE
  previousManagedSettingsPath = process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  tempApiDir = mkdtempSync(join(tmpdir(), 'opencat-webui-api-'))
  const cwd = join(tempApiDir, 'project')
  const memoryDir = join(tempApiDir, 'memory')
  const configDir = join(tempApiDir, 'config')
  const pluginCacheDir = join(tempApiDir, 'plugins')
  const managedDir = join(tempApiDir, 'managed')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(pluginCacheDir, { recursive: true })
  mkdirSync(managedDir, { recursive: true })
  writeFileSync(
    join(pluginCacheDir, 'install-counts-cache.json'),
    JSON.stringify({
      version: 1,
      fetchedAt: new Date().toISOString(),
      counts: [
        { plugin: 'sample-plugin@local-tools', unique_installs: 42 },
      ],
    }),
  )
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = memoryDir
  process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = pluginCacheDir
  process.env.USER_TYPE = 'ant'
  process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = managedDir
  setClaudeConfigHomeDirForTesting(configDir)
  getAutoMemPath.cache?.clear?.()
  getAutoMemPathForProject.cache?.clear?.()
  getClaudeConfigHomeDir.cache?.clear?.()
  getManagedFilePath.cache?.clear?.()
  clearCommandsCache()
  clearInstalledPluginsCache()
  clearMarketplacesCache()
  clearAllCaches()
  resetSettingsCache()
  saveGlobalConfig(current => ({ ...current, knowledgeGraphEnabled: true }))
  return { cwd, memoryDir, configDir, pluginCacheDir, managedDir }
}

afterEach(() => {
  if (previousMemoryOverride === undefined) {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  } else {
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = previousMemoryOverride
  }
  if (previousPluginCacheDir === undefined) {
    delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
  } else {
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = previousPluginCacheDir
  }
  if (previousUserType === undefined) {
    delete process.env.USER_TYPE
  } else {
    process.env.USER_TYPE = previousUserType
  }
  if (previousManagedSettingsPath === undefined) {
    delete process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH
  } else {
    process.env.CLAUDE_CODE_MANAGED_SETTINGS_PATH = previousManagedSettingsPath
  }
  setClaudeConfigHomeDirForTesting(previousConfigHome)
  getAutoMemPath.cache?.clear?.()
  getAutoMemPathForProject.cache?.clear?.()
  getClaudeConfigHomeDir.cache?.clear?.()
  getManagedFilePath.cache?.clear?.()
  clearCommandsCache()
  clearInstalledPluginsCache()
  clearMarketplacesCache()
  clearAllCaches()
  resetSettingsCache()
  if (tempApiDir) {
    rmSync(tempApiDir, { recursive: true, force: true })
    tempApiDir = undefined
  }
  previousMemoryOverride = undefined
  previousConfigHome = undefined
  previousPluginCacheDir = undefined
  previousUserType = undefined
  previousManagedSettingsPath = undefined
})

async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
  options: Partial<Parameters<typeof createWebUiApp>[0]> = {},
): Promise<T> {
  const app = createWebUiApp({
    cwd: process.cwd(),
    permissionMode: 'acceptEdits',
    token: 'test-token',
    ...options,
  })
  const server: Server = createServer(app.handler)
  const sockets = new Set<Socket>()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('upgrade', app.handleUpgrade)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    return await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    app.close()
    sockets.forEach(socket => socket.destroy())
    const closeAll = server as Server & {
      closeAllConnections?: () => void
      closeIdleConnections?: () => void
      unref?: () => void
    }
    closeAll.closeAllConnections?.()
    closeAll.closeIdleConnections?.()
    closeAll.unref?.()
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 500)
      timeout.unref?.()
      server.close(() => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
}

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = signal => {
    child.killed = true
    child.stdin.end()
    child.stdout.destroy()
    child.stderr.destroy()
    child.emit('close', 0, signal)
    return true
  }
  return child
}

async function readRequestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

async function terminateWebSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 250)
    timeout.unref?.()
    ws.once('close', () => {
      clearTimeout(timeout)
      resolve()
    })
    ws.terminate()
  })
}

async function connectWebSocket(baseUrl: string): Promise<{
  ws: WebSocket
  reader: ReturnType<typeof createWsEventReader>
}> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws?token=test-token`)
  const reader = createWsEventReader(ws)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out opening WebSocket.')), 2000)
    timeout.unref?.()
    ws.once('open', resolve)
    ws.once('error', reject)
    ws.once('open', () => clearTimeout(timeout))
    ws.once('error', () => clearTimeout(timeout))
  })
  return { ws, reader }
}

function createWsEventReader(ws: WebSocket) {
  const events: ServerEvent[] = []
  const waiters = new Set<() => void>()
  ws.on('message', data => {
    events.push(JSON.parse(String(data)) as ServerEvent)
    for (const notify of waiters) notify()
  })
  return {
    waitFor(
      predicate: (event: ServerEvent) => boolean,
      timeoutMs = 2000,
    ): Promise<ServerEvent> {
      const existing = events.find(predicate)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(check)
          reject(new Error('Timed out waiting for WebSocket event.'))
        }, timeoutMs)
        const check = () => {
          const event = events.find(predicate)
          if (!event) return
          clearTimeout(timeout)
          waiters.delete(check)
          resolve(event)
        }
        waiters.add(check)
      })
    },
    events,
  }
}

function createLocalPluginMarketplace(root: string): string {
  const marketplaceDir = join(root, 'local-marketplace')
  const marketplaceMetaDir = join(marketplaceDir, '.claude-plugin')
  const samplePluginDir = join(marketplaceDir, 'sample-plugin')
  const blockedPluginDir = join(marketplaceDir, 'blocked-plugin')
  mkdirSync(join(samplePluginDir, '.claude-plugin'), { recursive: true })
  mkdirSync(join(blockedPluginDir, '.claude-plugin'), { recursive: true })
  mkdirSync(marketplaceMetaDir, { recursive: true })

  writeFileSync(
    join(samplePluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'sample-plugin',
      version: '1.0.0',
      description: 'Sample plugin for Web UI tests',
      userConfig: {
        token: {
          type: 'string',
          title: 'Token',
          description: 'Test token',
          required: true,
        },
      },
    }, null, 2),
  )
  writeFileSync(
    join(blockedPluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'blocked-plugin',
      version: '1.0.0',
      description: 'Blocked plugin for Web UI tests',
    }, null, 2),
  )
  writeFileSync(
    join(marketplaceMetaDir, 'marketplace.json'),
    JSON.stringify({
      name: 'local-tools',
      owner: { name: 'OpenCat Test' },
      metadata: {
        version: '1.0.0',
        description: 'Local marketplace for Web UI plugin tests',
      },
      plugins: [
        {
          name: 'sample-plugin',
          source: './sample-plugin',
          description: 'Sample plugin for Web UI tests',
          category: 'testing',
          tags: ['webui', 'sample'],
          keywords: ['browser', 'install'],
          version: '1.0.0',
          userConfig: {
            token: {
              type: 'string',
              title: 'Token',
              description: 'Test token',
              required: true,
            },
          },
        },
        {
          name: 'blocked-plugin',
          source: './blocked-plugin',
          description: 'Blocked plugin for Web UI tests',
          category: 'testing',
          tags: ['blocked'],
          version: '1.0.0',
        },
      ],
    }, null, 2),
  )

  return marketplaceDir
}

describe('webui server', () => {
  test('creates installed Web workspace, session, and skill directories', () => {
    const { cwd, configDir } = setupIsolatedApiState()

    const dirs = ensureWebUiBootstrapDirs(cwd)

    expect(dirs).toEqual({
      configDir,
      workspaceDir: cwd,
      userSkillsDir: join(configDir, 'skills'),
      projectsDir: join(configDir, 'projects'),
      webuiDir: join(configDir, 'webui'),
      projectSkillsDir: join(cwd, '.opencat', 'skills'),
    })
    expect(existsSync(dirs.workspaceDir)).toBe(true)
    expect(existsSync(dirs.userSkillsDir)).toBe(true)
    expect(existsSync(dirs.projectsDir)).toBe(true)
    expect(existsSync(dirs.webuiDir)).toBe(true)
    expect(existsSync(dirs.projectSkillsDir)).toBe(true)
  })

  test('serves the icon asset with image/x-icon', async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/assets/opencat.ico`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('image/x-icon')
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
    })
  })

  test('protects bootstrap and omits old visible branding', async () => {
    await withServer(async baseUrl => {
      const denied = await fetch(`${baseUrl}/api/bootstrap`)
      const allowed = await fetch(`${baseUrl}/api/bootstrap`, {
        headers: { Authorization: 'Bearer test-token' },
      })
      const bootstrap = await allowed.json()
      const page = await fetch(`${baseUrl}/`).then(response => response.text())

      expect(denied.status).toBe(401)
      expect(allowed.status).toBe(200)
      expect(JSON.stringify(bootstrap)).not.toContain('OpenClaude')
      expect(page).not.toContain('OpenClaude')
    })
  })

  test('serves plugin marketplace APIs and installs plugins through user scope', async () => {
    const { cwd, managedDir } = setupIsolatedApiState()
    const marketplaceSource = createLocalPluginMarketplace(tempApiDir!)

    await withServer(
      async baseUrl => {
        const headers = {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }

        const invalid = await fetch(`${baseUrl}/api/plugins/marketplaces`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source: '' }),
        })
        expect(invalid.status).toBe(400)

        const added = await fetch(`${baseUrl}/api/plugins/marketplaces`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source: marketplaceSource }),
        })
        expect(added.status).toBe(200)
        expect((await added.json()).marketplace.name).toBe('local-tools')

        writeFileSync(
          join(managedDir, 'managed-settings.json'),
          JSON.stringify({
            enabledPlugins: { 'blocked-plugin@local-tools': false },
          }),
        )
        resetSettingsCache()
        clearInstalledPluginsCache()
        clearMarketplacesCache()
        clearAllCaches()
        setCachedSettingsForSource('policySettings', {
          enabledPlugins: { 'blocked-plugin@local-tools': false },
        })

        const marketplaces = await fetch(`${baseUrl}/api/plugins/marketplaces`, {
          headers: { Authorization: 'Bearer test-token' },
        }).then(response => response.json())
        expect(marketplaces.marketplaces).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'local-tools',
              pluginCount: 2,
            }),
          ]),
        )

        const allPlugins = await fetch(`${baseUrl}/api/plugins?status=all`, {
          headers: { Authorization: 'Bearer test-token' },
        }).then(response => response.json())
        expect(allPlugins.plugins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              pluginId: 'sample-plugin@local-tools',
              marketplaceName: 'local-tools',
              category: 'testing',
              tags: ['webui', 'sample'],
              keywords: ['browser', 'install'],
              installed: false,
              blocked: false,
              installCount: 42,
              needsConfiguration: true,
            }),
            expect.objectContaining({
              pluginId: 'blocked-plugin@local-tools',
              blocked: true,
            }),
          ]),
        )

        const searched = await fetch(`${baseUrl}/api/plugins?q=sample&marketplace=local-tools&status=available`, {
          headers: { Authorization: 'Bearer test-token' },
        }).then(response => response.json())
        expect(searched.plugins.map((plugin: { pluginId: string }) => plugin.pluginId)).toEqual([
          'sample-plugin@local-tools',
        ])

        const missing = await fetch(`${baseUrl}/api/plugins/install`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ pluginId: 'missing-plugin@local-tools', scope: 'user' }),
        })
        expect(missing.status).toBe(404)

        const installed = await fetch(`${baseUrl}/api/plugins/install`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ pluginId: 'sample-plugin@local-tools', scope: 'user' }),
        })
        expect(installed.status).toBe(200)
        expect(await installed.json()).toEqual(
          expect.objectContaining({
            ok: true,
            pluginId: 'sample-plugin@local-tools',
            needsConfiguration: true,
          }),
        )

        const installedList = await fetch(`${baseUrl}/api/plugins?status=installed`, {
          headers: { Authorization: 'Bearer test-token' },
        }).then(response => response.json())
        expect(installedList.plugins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              pluginId: 'sample-plugin@local-tools',
              installed: true,
            }),
          ]),
        )
      },
      { cwd },
    )
  })

  test('emits plugin recommendations from hint evidence without silently installing', async () => {
    const { cwd } = setupIsolatedApiState()
    const marketplaceSource = createLocalPluginMarketplace(tempApiDir!)
    let child: ReturnType<typeof createMockChild> | undefined

    await withServer(
      async baseUrl => {
        const headers = {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }
        const added = await fetch(`${baseUrl}/api/plugins/marketplaces`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ source: marketplaceSource }),
        })
        expect(added.status).toBe(200)

        const { ws, reader } = await connectWebSocket(baseUrl)
        try {
          await reader.waitFor(event => event.type === 'ready')
          ws.send(JSON.stringify({ type: 'send_message', text: 'run tool that can emit hints' }))
          await reader.waitFor(event => event.type === 'status' && event.status === 'Running')
          expect(child).toBeDefined()
          child!.stderr.write('<claude-code-hint v=1 type=plugin value="sample-plugin@local-tools" />\n')

          const event = await reader.waitFor(
            candidate => candidate.type === 'plugin_recommendation',
          )
          expect(event).toEqual({
            type: 'plugin_recommendation',
            recommendation: expect.objectContaining({
              pluginId: 'sample-plugin@local-tools',
              pluginName: 'sample-plugin',
              marketplaceName: 'local-tools',
              source: 'web-cli-stderr',
            }),
          })

          const installedList = await fetch(`${baseUrl}/api/plugins?status=installed`, {
            headers: { Authorization: 'Bearer test-token' },
          }).then(response => response.json())
          expect(installedList.plugins).toEqual([])
        } finally {
          await terminateWebSocket(ws)
        }
      },
      {
        cwd,
        spawnFactory: () => {
          child = createMockChild()
          return child
        },
      },
    )
  })

  test('serves platform auth SSO APIs and manual usage report without token login route', async () => {
    const { cwd } = setupIsolatedApiState()
    let reportedPayload: Record<string, unknown> | null = null
    const platformServer = createServer(async (request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (request.method === 'POST' && url.pathname === '/api/sso/send-code/') {
        const body = await readRequestJson(request)
        expect(body).toEqual({ username: 'alice@example.test' })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 2000, data: { uuid: 'uuid-1' } }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/sso/login/') {
        const body = await readRequestJson(request)
        expect(body).toMatchObject({
          username: 'alice@example.test',
          code: '123456',
          uuid: 'uuid-1',
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: { access: 'access-token', token: 'api-token' },
        }))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/system/agent_usage_data/report/') {
        expect(request.headers.authorization).toBe('JWT access-token')
        reportedPayload = await readRequestJson(request)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ success: true }))
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
    })
    await new Promise<void>(resolve => platformServer.listen(0, '127.0.0.1', resolve))
    const platformAddress = platformServer.address() as AddressInfo
    const platformBaseUrl = `http://127.0.0.1:${platformAddress.port}`

    try {
      await withServer(
        async baseUrl => {
          const headers = {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }
          const sendCode = await fetch(`${baseUrl}/api/platform-auth/sso/send-code`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              baseUrl: platformBaseUrl,
              account: 'alice@example.test',
            }),
          }).then(response => response.json())
          expect(sendCode).toMatchObject({ success: true, uuid: 'uuid-1' })

          const login = await fetch(`${baseUrl}/api/platform-auth/sso/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              baseUrl: platformBaseUrl,
              account: 'alice@example.test',
              code: '123456',
              uuid: 'uuid-1',
            }),
          }).then(response => response.json())
          expect(login).toMatchObject({
            success: true,
            status: {
              authenticated: true,
              method: 'sso',
              identityName: 'alice@example.test',
            },
          })
          expect(JSON.stringify(login)).not.toContain('access-token')

          const tokenRoute = await fetch(`${baseUrl}/api/platform-auth/token`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ token: 'manual-token' }),
          })
          expect(tokenRoute.status).toBe(404)

          const report = await fetch(`${baseUrl}/api/platform-usage/report`, {
            method: 'POST',
            headers,
          }).then(response => response.json())
          expect(report.success).toBe(true)
          expect(reportedPayload).toMatchObject({
            payload_version: 2,
            report_mode: 'snapshot',
            timezone: 'Asia/Shanghai',
          })
        },
        { cwd },
      )
    } finally {
      await new Promise<void>(resolve => platformServer.close(() => resolve()))
    }
  })

  test('serves Asset Hub APIs using saved platform auth and local knowledge assets', async () => {
    const { cwd, configDir } = setupIsolatedApiState()
    let platformBaseUrl = ''
    const completedUploads: Record<string, unknown>[] = []
    let objectUploadBytes = 0
    const seenRequests: Array<{ method: string; path: string; authorization?: string }> = []

    const platformServer = createServer(async (request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      seenRequests.push({
        method: request.method || 'GET',
        path: url.pathname,
        authorization: request.headers.authorization,
      })

      if (request.method === 'POST' && url.pathname === '/api/sso/login/') {
        const body = await readRequestJson(request)
        expect(body).toMatchObject({
          username: 'hub-user@example.test',
          code: '654321',
          uuid: 'uuid-hub',
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 2000, data: { access: 'hub-access-token' } }))
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/system/agent_hub_asset/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        expect(url.searchParams.get('asset_type')).toBe('knowledge')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: [
            {
              id: 'hub-knowledge',
              asset_type: 'knowledge',
              title: 'Hub Knowledge',
              version: 'v1',
              description_text: 'Reusable hub note',
              like_count: 2,
              download_count: 3,
            },
          ],
          total: 1,
          page: 1,
          limit: 8,
        }))
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/system/agent_hub_asset/hub-knowledge/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: {
            id: 'hub-knowledge',
            asset_type: 'knowledge',
            title: 'Hub Knowledge',
            version: 'v1',
            description_text: 'Reusable hub note',
          },
        }))
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/system/agent_hub_asset/hub-knowledge/preview/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 2000, data: { markdown: '# Hub Knowledge Preview\n' } }))
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/system/agent_hub_asset/hub-knowledge/download/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: {
            asset_type: 'knowledge',
            file_name: 'Hub Knowledge.md',
            markdown: '# Hub Knowledge\n\nDownloaded from Hub.\n',
          },
        }))
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/system/agent_hub_asset/init_upload/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        const body = await readRequestJson(request)
        const assetType = String(body.asset_type || '')
        expect(['knowledge', 'skill']).toContain(assetType)
        expect(body.file_name).toBe(assetType === 'skill' ? 'SKILL.md' : 'Local-Knowledge.md')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: {
            upload_url: `${platformBaseUrl}/object-upload/${assetType}.md`,
            object_name: `objects/${assetType}.md`,
          },
        }))
        return
      }

      if (
        request.method === 'PUT' &&
        (url.pathname === '/object-upload/knowledge.md' || url.pathname === '/object-upload/skill.md')
      ) {
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        }
        objectUploadBytes = Buffer.concat(chunks).length
        response.writeHead(200)
        response.end('')
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/system/agent_hub_asset/complete_upload/') {
        expect(request.headers.authorization).toBe('JWT hub-access-token')
        const completed = await readRequestJson(request)
        completedUploads.push(completed)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({
          code: 2000,
          data: { id: `uploaded-${completed.asset_type || 'asset'}`, title: completed.title },
        }))
        return
      }

      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
    })
    await new Promise<void>(resolve => platformServer.listen(0, '127.0.0.1', resolve))
    const platformAddress = platformServer.address() as AddressInfo
    platformBaseUrl = `http://127.0.0.1:${platformAddress.port}`

    try {
      await withServer(
        async baseUrl => {
          const headers = {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }

          const unauthorized = await fetch(`${baseUrl}/api/asset-hub/assets`, {
            headers: { Authorization: 'Bearer test-token' },
          })
          expect(unauthorized.status).toBe(401)

          const login = await fetch(`${baseUrl}/api/platform-auth/sso/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              baseUrl: platformBaseUrl,
              account: 'hub-user@example.test',
              code: '654321',
              uuid: 'uuid-hub',
            }),
          }).then(response => response.json())
          expect(login).toMatchObject({ success: true })

          const list = await fetch(`${baseUrl}/api/asset-hub/assets?asset_type=knowledge`, {
            headers,
          }).then(response => response.json())
          expect(list.items).toHaveLength(1)
          expect(list.items[0]).toMatchObject({ id: 'hub-knowledge', asset_type: 'knowledge' })

          const detail = await fetch(`${baseUrl}/api/asset-hub/assets/hub-knowledge`, {
            headers,
          }).then(response => response.json())
          expect(detail.markdown).toContain('Preview')

          const download = await fetch(`${baseUrl}/api/asset-hub/assets/hub-knowledge/download`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ assetSnapshot: list.items[0] }),
          }).then(response => response.json())
          expect(download.asset).toMatchObject({ kind: 'knowledge', source: 'user' })
          const downloadedPath = join(configDir, 'skills', 'Hub-Knowledge.md')
          expect(existsSync(downloadedPath)).toBe(true)
          expect(readFileSync(downloadedPath, 'utf8')).toContain('Downloaded from Hub.')

          const localKnowledge = await fetch(`${baseUrl}/api/assets/knowledge`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filename: 'Local Knowledge.md',
              title: 'Local Knowledge',
              description: 'Uploadable local note',
              content: '# Local Knowledge\n\nUpload me.\n',
            }),
          }).then(response => response.json())
          expect(localKnowledge.asset).toMatchObject({ kind: 'knowledge', source: 'user' })

          const upload = await fetch(
            `${baseUrl}/api/asset-hub/local-assets/${encodeURIComponent(localKnowledge.asset.id)}/upload`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                title: 'Local Knowledge',
                version: 'v1',
                applicableRoles: 'tester',
                applicableBusiness: 'app testing',
                description: 'Uploadable local note',
              }),
            },
          ).then(response => response.json())
          expect(upload).toMatchObject({ id: 'uploaded-knowledge' })
          expect(objectUploadBytes).toBeGreaterThan(0)
          expect(completedUploads).toContainEqual(expect.objectContaining({
            asset_type: 'knowledge',
            title: 'Local Knowledge',
            file_name: 'Local-Knowledge.md',
            object_name: 'objects/knowledge.md',
          }))

          const localSkill = await fetch(`${baseUrl}/api/assets/skills`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              scope: 'user',
              name: 'Upload Skill',
              description: 'Uploadable local skill',
              whenToUse: 'Use when uploading skill assets.',
              content: 'Skill upload body.',
            }),
          }).then(response => response.json())
          expect(localSkill.asset).toMatchObject({ kind: 'skill', source: 'user' })

          const skillUpload = await fetch(
            `${baseUrl}/api/asset-hub/local-assets/${encodeURIComponent(localSkill.asset.id)}/upload`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                title: 'Upload Skill',
                version: 'v1',
                applicableRoles: 'tester',
                applicableBusiness: 'app testing',
                description: 'Uploadable local skill',
              }),
            },
          ).then(response => response.json())
          expect(skillUpload).toMatchObject({ id: 'uploaded-skill' })
          expect(completedUploads).toContainEqual(expect.objectContaining({
            asset_type: 'skill',
            title: 'Upload Skill',
            file_name: 'SKILL.md',
            object_name: 'objects/skill.md',
          }))

          const mcpOnly = await fetch(`${baseUrl}/api/assets?source=mcp`, {
            headers,
          }).then(response => response.json())
          const blockedUpload = await fetch(
            `${baseUrl}/api/asset-hub/local-assets/${encodeURIComponent(mcpOnly.assets[0].id)}/upload`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                title: 'Blocked',
                version: 'v1',
                applicableRoles: 'tester',
                applicableBusiness: 'app testing',
                description: 'Should not upload',
              }),
            },
          )
          expect(blockedUpload.status).toBe(403)
        },
        { cwd },
      )
      expect(seenRequests.some(request => request.path === '/api/system/agent_hub_asset/')).toBe(true)
    } finally {
      await new Promise<void>(resolve => platformServer.close(() => resolve()))
    }
  }, 15000)

  test('saves Midscene settings through the provider API and exposes child env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-server-midscene-'))
    try {
      const filePath = join(dir, 'profile.json')
      await withServer(
        async baseUrl => {
          const key = 'midscene-secret-for-child'
          const save = await fetch(`${baseUrl}/api/provider-profile`, {
            method: 'POST',
            headers: {
              Authorization: 'Bearer test-token',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              provider: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'llama3.2:3b',
              midscene: {
                baseUrl: 'https://vision.example.test/v1',
                model: 'doubao-vision-pro',
                modelFamily: 'doubao-vision',
                apiKey: key,
              },
            }),
          })
          const body = await save.json()
          expect(save.status).toBe(200)
          expect(JSON.stringify(body.bootstrap)).not.toContain(key)
          expect(body.bootstrap.midsceneProfile).toEqual({
            model: 'doubao-vision-pro',
            baseUrl: 'https://vision.example.test/v1',
            modelFamily: 'doubao-vision',
            credentialConfigured: true,
            credentialKeys: ['MIDSCENE_MODEL_API_KEY'],
          })
          const env = buildMidsceneSessionEnv({ filePath })

          expect(env.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro')
          expect(env.MIDSCENE_MODEL_BASE_URL).toBe('https://vision.example.test/v1')
          expect(env.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
          expect(env.MIDSCENE_MODEL_API_KEY).toBe(key)
          expect(env.OPENCAT_APP_TEST_MIDSCENE_CONFIG_SOURCE).toBe('saved-profile')
          expect(env.OPENCAT_APP_TEST_MIDSCENE_PRESENT_KEYS?.split(',').sort()).toEqual([
            'MIDSCENE_MODEL_API_KEY',
            'MIDSCENE_MODEL_BASE_URL',
            'MIDSCENE_MODEL_FAMILY',
            'MIDSCENE_MODEL_NAME',
          ])
        },
        {
          profileLocation: { filePath },
        },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('refresh_session sends latest bootstrap and next CLI child receives saved Midscene env', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-server-refresh-'))
    try {
      const cwd = join(dir, 'project')
      mkdirSync(cwd, { recursive: true })
      const filePath = join(dir, 'profile.json')
      const sessionStoreLocation = { filePath: join(dir, 'sessions.json') }
      let capturedEnv: NodeJS.ProcessEnv | undefined
      let resolveSpawned: (() => void) | undefined
      const spawned = new Promise<void>(resolve => {
        resolveSpawned = resolve
      })

      await withServer(
        async baseUrl => {
          const key = 'midscene-secret-after-refresh'
          const { ws, reader } = await connectWebSocket(baseUrl)
          try {
            await reader.waitFor(event => event.type === 'ready')

            const save = await fetch(`${baseUrl}/api/provider-profile`, {
              method: 'POST',
              headers: {
                Authorization: 'Bearer test-token',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                provider: 'ollama',
                baseUrl: 'http://127.0.0.1:11434',
                model: 'llama3.2:3b',
                midscene: {
                  baseUrl: 'https://vision.example.test/v1',
                  model: 'doubao-vision-pro',
                  modelFamily: 'doubao-vision',
                  apiKey: key,
                },
              }),
            })
            expect(save.status).toBe(200)

            ws.send(JSON.stringify({ type: 'refresh_session' }))
            const refreshed = await reader.waitFor(event =>
              event.type === 'ready' &&
              event.bootstrap.midsceneProfile?.model === 'doubao-vision-pro',
            )
            expect(JSON.stringify(refreshed)).not.toContain(key)

            ws.send(JSON.stringify({ type: 'send_message', text: 'run app test' }))
            await Promise.race([
              spawned,
              new Promise((_resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for CLI child spawn.')), 2000)
                timeout.unref?.()
              }),
            ])

            expect(capturedEnv?.MIDSCENE_MODEL_NAME).toBe('doubao-vision-pro')
            expect(capturedEnv?.MIDSCENE_MODEL_BASE_URL).toBe('https://vision.example.test/v1')
            expect(capturedEnv?.MIDSCENE_MODEL_FAMILY).toBe('doubao-vision')
            expect(capturedEnv?.MIDSCENE_MODEL_API_KEY).toBe(key)
            expect(capturedEnv?.OPENCAT_APP_TEST_MIDSCENE_CONFIG_SOURCE).toBe('saved-profile')
          } finally {
            await terminateWebSocket(ws)
          }
        },
        {
          cwd,
          profileLocation: { filePath },
          sessionStoreLocation,
          spawnFactory: (_command, _args, options) => {
            capturedEnv = options.env
            resolveSpawned?.()
            return createMockChild()
          },
        },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('bootstrap includes Web chat sessions for the active cwd only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-webui-server-session-'))
    try {
      const cwd = join(dir, 'project')
      const otherCwd = join(dir, 'other-project')
      const sessionStoreLocation = { filePath: join(dir, 'sessions.json') }
      const older = createWebChatSession(cwd, sessionStoreLocation, new Date('2026-07-03T00:00:00.000Z'))
      const newer = createWebChatSession(cwd, sessionStoreLocation, new Date('2026-07-03T00:01:00.000Z'))
      createWebChatSession(otherCwd, sessionStoreLocation, new Date('2026-07-03T00:02:00.000Z'))

      await withServer(
        async baseUrl => {
          const bootstrap = await fetch(`${baseUrl}/api/bootstrap`, {
            headers: { Authorization: 'Bearer test-token' },
          }).then(response => response.json())

          expect(bootstrap.activeChatSessionId).toBe(newer.id)
          expect(bootstrap.chatSessions.map((session: { id: string }) => session.id)).toEqual([
            newer.id,
            older.id,
          ])
        },
        {
          cwd,
          sessionStoreLocation,
          profileLocation: { filePath: join(dir, 'profile.json') },
        },
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('serves memory APIs from the Web cwd when process cwd is a packaged runtime', async () => {
    const { cwd } = setupIsolatedApiState()
    const runtimeCwd = resolve(cwd, '..', 'opencat-runtime')
    const previousProcessCwd = process.cwd()
    mkdirSync(runtimeCwd, { recursive: true })
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
    getAutoMemPath.cache?.clear?.()
    getAutoMemPathForProject.cache?.clear?.()

    try {
      process.chdir(runtimeCwd)
      await withServer(
        async baseUrl => {
          const headers = {
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }
          const expectedMemoryDir = resolve(getAutoMemPathForProject(cwd))
          const runtimeMemoryDir = resolve(getAutoMemPathForProject(runtimeCwd))

          const status = await fetch(`${baseUrl}/api/memory/status`, {
            headers,
          }).then(response => response.json())
          expect(status.memoryDir).toBe(expectedMemoryDir)
          expect(status.memoryDir).not.toBe(runtimeMemoryDir)
          expect(status.memoryFileCount).toBe(0)

          const createdResponse = await fetch(`${baseUrl}/api/memory/files`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filename: 'workspace-topic.md',
              title: 'Workspace Topic',
              content: 'Remember the Web cwd.',
              addToIndex: true,
            }),
          })
          expect(createdResponse.status).toBe(200)
          expect(existsSync(join(expectedMemoryDir, 'workspace-topic.md'))).toBe(true)
          expect(existsSync(join(runtimeMemoryDir, 'workspace-topic.md'))).toBe(false)
        },
        {
          cwd,
          profileLocation: { filePath: join(cwd, 'profile.json') },
          sessionStoreLocation: { filePath: join(cwd, 'sessions.json') },
        },
      )
    } finally {
      process.chdir(previousProcessCwd)
    }
  })

  test('serves memory file and knowledge graph APIs from isolated memory state', async () => {
    const { cwd, memoryDir } = setupIsolatedApiState()
    await withServer(
      async baseUrl => {
        const headers = {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }
        const status = await fetch(`${baseUrl}/api/memory/status`, {
          headers,
        }).then(response => response.json())
        expect(status.memoryDir).toBe(memoryDir)
        expect(status.hasMemoryIndex).toBe(false)
        expect(status.autoMemoryEnabled).toBe(true)
        expect(status.autoMemoryExtractionEnabled).toBe(true)
        expect(status.knowledgeGraphEnabled).toBe(true)
        expect(status.knowledgeGraphCollectionEnabled).toBe(true)

        const createdResponse = await fetch(`${baseUrl}/api/memory/files`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filename: 'api-topic.md',
            title: 'API Topic',
            description: 'Memory API coverage',
            content: 'Remember the endpoint contract.',
            addToIndex: true,
          }),
        })
        expect(createdResponse.status).toBe(200)
        const created = await createdResponse.json()
        expect(created.file.relativePath).toBe('api-topic.md')

        const files = await fetch(`${baseUrl}/api/memory/files`, {
          headers,
        }).then(response => response.json())
        expect(files.files.map((file: { relativePath: string }) => file.relativePath)).toContain(
          'MEMORY.md',
        )
        expect(files.files.map((file: { relativePath: string }) => file.relativePath)).toContain(
          'api-topic.md',
        )

        const search = await fetch(`${baseUrl}/api/memory/search?q=endpoint`, {
          headers,
        }).then(response => response.json())
        expect(search.results).toContainEqual(
          expect.objectContaining({ relativePath: 'api-topic.md' }),
        )

        const saved = await fetch(
          `${baseUrl}/api/memory/files/${encodeURIComponent(created.file.id)}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ content: '# API Topic\n\nUpdated memory.' }),
          },
        ).then(response => response.json())
        expect(saved.content).toContain('Updated memory')

        const disabledGraph = await fetch(
          `${baseUrl}/api/memory/knowledge-graph/enable`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ enabled: false }),
          },
        ).then(response => response.json())
        expect(disabledGraph.enabled).toBe(false)

        const clearedGraph = await fetch(
          `${baseUrl}/api/memory/knowledge-graph/clear`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ confirm: true }),
          },
        ).then(response => response.json())
        expect(clearedGraph.entities).toEqual([])
        expect(clearedGraph.relations).toEqual([])
      },
      {
        cwd,
        profileLocation: { filePath: join(cwd, 'profile.json') },
        sessionStoreLocation: { filePath: join(cwd, 'sessions.json') },
      },
    )
  })

  test('serves assets APIs and restricts writes to project skills', async () => {
    const { cwd } = setupIsolatedApiState()
    await withServer(
      async baseUrl => {
        const headers = {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        }
        const createdResponse = await fetch(`${baseUrl}/api/assets/skills`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            scope: 'project',
            name: 'Endpoint Skill',
            description: 'Created through the assets API',
            whenToUse: 'Use when endpoint coverage is needed.',
            allowedTools: ['Read'],
            content: 'Follow the project API checks.',
          }),
        })
        expect(createdResponse.status).toBe(200)
        const created = await createdResponse.json()
        expect(created.asset.source).toBe('project')
        expect(created.asset.readonly).toBe(false)
        expect(created.asset.content).toContain('allowed-tools')

        const filtered = await fetch(`${baseUrl}/api/assets?q=endpoint`, {
          headers,
        }).then(response => response.json())
        expect(filtered.assets).toContainEqual(
          expect.objectContaining({
            id: created.asset.id,
            source: 'project',
            readonly: false,
          }),
        )

        const detail = await fetch(
          `${baseUrl}/api/assets/${encodeURIComponent(created.asset.id)}`,
          { headers },
        ).then(response => response.json())
        expect(detail.asset.content).toContain('Endpoint Skill')

        const updated = await fetch(
          `${baseUrl}/api/assets/skills/${encodeURIComponent(created.asset.id)}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              content: [
                '---',
                'name: "Endpoint Skill"',
                'description: "Created through the assets API"',
                '---',
                '',
                '# Endpoint Skill',
                '',
                'Updated by endpoint test.',
                '',
              ].join('\n'),
            }),
          },
        ).then(response => response.json())
        expect(updated.asset.content).toContain('Updated by endpoint test')

        const mcpOnly = await fetch(`${baseUrl}/api/assets?source=mcp`, {
          headers,
        }).then(response => response.json())
        expect(mcpOnly.assets).toContainEqual(
          expect.objectContaining({ source: 'mcp', readonly: true }),
        )

        const reload = await fetch(`${baseUrl}/api/assets/reload`, {
          method: 'POST',
          headers,
        }).then(response => response.json())
        expect(reload.count).toBeGreaterThan(0)

        const deleted = await fetch(
          `${baseUrl}/api/assets/skills/${encodeURIComponent(created.asset.id)}`,
          {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ confirm: true }),
          },
        )
        expect(deleted.status).toBe(200)
      },
      {
        cwd,
        profileLocation: { filePath: join(cwd, 'profile.json') },
        sessionStoreLocation: { filePath: join(cwd, 'sessions.json') },
      },
    )
  }, 15000)
})
