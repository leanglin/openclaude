import { describe, expect, test } from 'bun:test'
import {
  downloadAssetHubAsset,
  listAssetHubAssets,
  uploadAssetToHub,
  voteAssetHubAsset,
} from './index.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('platform asset hub service', () => {
  test('lists Hub assets with old endpoint parameters and JWT auth', async () => {
    const calls: Array<{ url: string; auth: string | null }> = []
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get('authorization'),
      })
      return jsonResponse({
        code: 2000,
        data: [{ id: 'hub-1', asset_type: 'skill', title: 'Skill One' }],
        total: 1,
        page: 2,
        limit: 8,
      })
    }

    const result = await listAssetHubAssets({
      baseUrl: 'http://platform.example.test/',
      accessToken: 'access-token',
      search: 'robot',
      assetType: 'skill',
      ordering: '-like_count',
      page: 2,
      limit: 8,
      fetcher,
    })

    expect(calls[0]?.auth).toBe('JWT access-token')
    expect(calls[0]?.url).toContain('/api/system/agent_hub_asset/')
    expect(calls[0]?.url).toContain('search=robot')
    expect(calls[0]?.url).toContain('asset_type=skill')
    expect(calls[0]?.url).toContain('ordering=-like_count')
    expect(result).toMatchObject({ total: 1, page: 2, limit: 8 })
    expect(result.items).toHaveLength(1)
  })

  test('downloads and votes Hub assets through old endpoints', async () => {
    const calls: string[] = []
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${String(url)}`)
      return jsonResponse({ code: 2000, data: { markdown: '# Hub Knowledge\n' } })
    }

    const downloaded = await downloadAssetHubAsset({
      baseUrl: 'http://platform.example.test',
      accessToken: 'access-token',
      assetId: 'hub-1',
      fetcher,
    })
    await voteAssetHubAsset({
      baseUrl: 'http://platform.example.test',
      accessToken: 'access-token',
      assetId: 'hub-1',
      vote: 'like',
      fetcher,
    })

    expect(downloaded.markdown).toContain('Hub Knowledge')
    expect(calls).toEqual([
      'GET http://platform.example.test/api/system/agent_hub_asset/hub-1/download/',
      'POST http://platform.example.test/api/system/agent_hub_asset/hub-1/vote/',
    ])
  })

  test('uploads markdown with init upload, object PUT, and complete upload payload', async () => {
    const calls: Array<{ url: string; method: string; body: string; auth: string | null }> = []
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || 'GET'
      const body = typeof init?.body === 'string' ? init.body : ''
      calls.push({
        url: String(url),
        method,
        body,
        auth: new Headers(init?.headers).get('authorization'),
      })
      if (String(url).endsWith('/init_upload/')) {
        return jsonResponse({
          code: 2000,
          data: {
            upload_url: 'http://object-store.example/upload',
            object_name: 'objects/knowledge.md',
          },
        })
      }
      if (String(url) === 'http://object-store.example/upload') {
        return new Response('', { status: 200 })
      }
      return jsonResponse({ code: 2000, data: { title: 'Knowledge One' } })
    }

    const result = await uploadAssetToHub({
      baseUrl: 'http://platform.example.test',
      accessToken: 'access-token',
      metadata: {
        title: 'Knowledge One',
        version: 'v1',
        applicableRoles: 'tester',
        applicableBusiness: 'robot',
        description: 'Useful notes',
        assetType: 'knowledge',
      },
      filename: 'Knowledge One.md',
      markdown: '# Knowledge One\n',
      fetcher,
    })

    expect(result.title).toBe('Knowledge One')
    expect(calls.map(call => call.method)).toEqual(['POST', 'PUT', 'POST'])
    expect(calls[0]?.auth).toBe('JWT access-token')
    expect(JSON.parse(calls[0]?.body || '{}')).toMatchObject({
      file_name: 'Knowledge-One.md',
      asset_type: 'knowledge',
    })
    expect(JSON.parse(calls[2]?.body || '{}')).toMatchObject({
      title: 'Knowledge One',
      asset_type: 'knowledge',
      object_name: 'objects/knowledge.md',
    })
    expect(JSON.parse(calls[2]?.body || '{}').sha256).toBeTruthy()
  })
})
