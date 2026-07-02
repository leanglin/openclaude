import { describe, expect, test } from 'bun:test'
import {
  buildControlResponse,
  buildPermissionControlResult,
  buildUserMessage,
  getStreamTextDelta,
  getTextContent,
  getToolUseBlocks,
  parseStdoutLine,
} from './protocol.js'

describe('webui stream-json protocol helpers', () => {
  test('builds stdin NDJSON payloads for user messages', () => {
    expect(buildUserMessage('hello')).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: 'hello',
      },
      parent_tool_use_id: null,
    })
  })

  test('parses assistant, partial, result, tool, and permission messages', () => {
    const assistant = parseStdoutLine(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
    )
    const partial = parseStdoutLine(
      '{"type":"partial","message":{"content":[{"type":"text","text":"h"}]}}',
    )
    const result = parseStdoutLine('{"type":"result","result":"done"}')
    const tool = parseStdoutLine(
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"a.ts"}}]}}',
    )
    const permission = parseStdoutLine(
      '{"type":"control_request","request_id":"r1","request":{"name":"Edit","input":{"file_path":"a.ts"}}}',
    )

    expect(assistant?.type).toBe('assistant')
    expect(getTextContent(assistant?.message)).toBe('hi')
    expect(partial?.type).toBe('partial')
    expect(result?.type).toBe('result')
    expect(getToolUseBlocks(tool?.message)).toHaveLength(1)
    expect(permission?.type).toBe('control_request')
    expect(parseStdoutLine('not-json')).toBeNull()
  })

  test('maps stream deltas and permission control responses', () => {
    expect(getStreamTextDelta({ delta: { text: 'hello' } })).toBe('hello')
    expect(
      buildControlResponse(
        'request-1',
        buildPermissionControlResult('allow-session', {
          input: { file_path: 'a.ts' },
          toolUseId: 'tool-1',
          permissionSuggestions: [{ behavior: 'allow' }],
        }),
      ),
    ).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'request-1',
        response: {
          behavior: 'allow',
          updatedInput: { file_path: 'a.ts' },
          toolUseID: 'tool-1',
          updatedPermissions: [{ behavior: 'allow' }],
        },
      },
    })

    expect(buildPermissionControlResult('deny', { toolUseId: 'tool-1' })).toEqual({
      behavior: 'deny',
      message: 'User denied permission',
      toolUseID: 'tool-1',
    })
  })
})
