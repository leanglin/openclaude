import { createServer, type Server } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createWebUiApp } from './server.js'
import { buildMidsceneSessionEnv } from './providerProfile.js'
import { createWebChatSession } from './sessionStore.js'

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
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

describe('webui server', () => {
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
        },
        {
          profileLocation: { filePath },
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
})
