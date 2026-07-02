import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import { CliChatSession, resolveCliLaunch } from './chatSession.js'
import type { ServerEvent } from './types.js'

function createMockChild() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const writes: string[] = []
  const originalWrite = stdin.write.bind(stdin)
  stdin.write = ((chunk: unknown, ...args: unknown[]) => {
    writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
    return originalWrite(chunk as never, ...(args as never[]))
  }) as never

  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    kill: (signal?: NodeJS.Signals | number) => boolean
  }
  child.stdin = stdin
  child.stdout = stdout
  child.stderr = stderr
  child.killed = false
  child.kill = signal => {
    child.killed = true
    child.emit('close', 0, signal)
    return true
  }

  return { child, stdout, stderr, writes }
}

describe('webui CLI chat session', () => {
  test('resolves script launches without shell so paths with spaces are safe', () => {
    const launch = resolveCliLaunch({
      execPath: 'E:\\Programs\\nodejs\\node.exe',
      argv: ['node', 'E:\\04 Coding\\openclaude\\dist\\cli.mjs', 'web'],
      streamArgs: [
        '--print',
        '--input-format=stream-json',
      ],
    })

    expect(launch).toEqual({
      command: 'E:\\Programs\\nodejs\\node.exe',
      args: [
        'E:\\04 Coding\\openclaude\\dist\\cli.mjs',
        '--print',
        '--input-format=stream-json',
      ],
      shell: false,
    })
  })

  test('send_message starts the stream-json child and writes user NDJSON', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    let capturedArgs: string[] = []
    let capturedOptionsShell: unknown
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: (_command, args, options) => {
        capturedArgs = args
        capturedOptionsShell = options.shell
        return mock.child
      },
    })

    session.sendUserMessage('hello')

    expect(capturedArgs).toContain('--input-format=stream-json')
    expect(capturedArgs).toContain('--output-format=stream-json')
    expect(capturedArgs).toContain('--include-partial-messages')
    expect(capturedOptionsShell).toBe(false)
    expect(JSON.parse(mock.writes[0])).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    })
    expect(events.some(event => event.type === 'status' && event.status === 'Running')).toBe(true)
  })

  test('stdout NDJSON broadcasts chat and activity events', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })

    session.start()
    mock.stdout.write('{"type":"stream_event","event":{"type":"message_start"}}\n')
    mock.stdout.write('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"text":"hi"}}}\n')
    mock.stdout.write('{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"a.ts"}}]}}\n')
    mock.stdout.write('{"type":"result","result":"done"}\n')

    expect(events.some(event => event.type === 'stream_start')).toBe(true)
    expect(events.some(event => event.type === 'stream_delta' && event.delta === 'hi')).toBe(true)
    expect(events.some(event => event.type === 'tool' && event.name === 'Read')).toBe(true)
    expect(events.some(event => event.type === 'activity' && event.activity.title === 'Result ready')).toBe(true)
  })

  test('permission decisions write control_response messages', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })

    session.start()
    mock.stdout.write(JSON.stringify({
      type: 'control_request',
      request_id: 'request-1',
      request: {
        name: 'Edit',
        tool_use_id: 'tool-1',
        input: { file_path: 'a.ts' },
        permission_suggestions: [{ behavior: 'allow' }],
      },
    }) + '\n')
    session.sendPermissionResponse('request-1', 'allow-session')

    const response = JSON.parse(mock.writes.at(-1) ?? '{}')
    expect(response).toEqual({
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
  })
})
