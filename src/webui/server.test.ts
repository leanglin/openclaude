import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, test } from 'bun:test'
import { createWebUiApp, ensureWebUiBootstrapDirs } from './server.js'
import { buildMidsceneSessionEnv } from './providerProfile.js'
import { createWebChatSession } from './sessionStore.js'
import type { ServerEvent } from './types.js'
import { getAutoMemPath } from '../memdir/paths.js'
import { clearCommandsCache } from '../commands.js'
import {
  getClaudeConfigHomeDir,
  getClaudeConfigHomeDirOverrideForTesting,
  setClaudeConfigHomeDirForTesting,
} from '../utils/envUtils.js'
import { saveGlobalConfig } from '../utils/config.js'

let tempApiDir: string | undefined
let previousMemoryOverride: string | undefined
let previousConfigHome: string | undefined

function setupIsolatedApiState(): {
  cwd: string
  memoryDir: string
  configDir: string
} {
  previousMemoryOverride = process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  previousConfigHome = getClaudeConfigHomeDirOverrideForTesting()
  tempApiDir = mkdtempSync(join(tmpdir(), 'opencat-webui-api-'))
  const cwd = join(tempApiDir, 'project')
  const memoryDir = join(tempApiDir, 'memory')
  const configDir = join(tempApiDir, 'config')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = memoryDir
  setClaudeConfigHomeDirForTesting(configDir)
  getAutoMemPath.cache?.clear?.()
  getClaudeConfigHomeDir.cache?.clear?.()
  clearCommandsCache()
  saveGlobalConfig(current => ({ ...current, knowledgeGraphEnabled: true }))
  return { cwd, memoryDir, configDir }
}

afterEach(() => {
  if (previousMemoryOverride === undefined) {
    delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  } else {
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = previousMemoryOverride
  }
  setClaudeConfigHomeDirForTesting(previousConfigHome)
  getAutoMemPath.cache?.clear?.()
  getClaudeConfigHomeDir.cache?.clear?.()
  clearCommandsCache()
  if (tempApiDir) {
    rmSync(tempApiDir, { recursive: true, force: true })
    tempApiDir = undefined
  }
  previousMemoryOverride = undefined
  previousConfigHome = undefined
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
