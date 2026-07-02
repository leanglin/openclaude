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
  const killSignals: Array<NodeJS.Signals | number | undefined> = []
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
    killSignals.push(signal)
    child.killed = true
    child.emit('close', 0, signal)
    return true
  }

  return { child, stdout, stderr, writes, killSignals }
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
    expect(capturedArgs).toContain('--permission-prompt-tool')
    expect(capturedArgs[capturedArgs.indexOf('--permission-prompt-tool') + 1]).toBe('stdio')
    expect(capturedOptionsShell).toBe(false)
    expect(JSON.parse(mock.writes[0])).toEqual({
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
    })
    expect(events.some(event => event.type === 'status' && event.status === 'Running')).toBe(true)
  })

  test('new Web chat sessions launch with a fixed session id', () => {
    const mock = createMockChild()
    let capturedArgs: string[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      sessionId: '11111111-1111-4111-8111-111111111111',
      send: () => {},
      spawnFactory: (_command, args) => {
        capturedArgs = args
        return mock.child
      },
    })

    session.sendUserMessage('hello')

    expect(capturedArgs).toContain('--session-id')
    expect(capturedArgs[capturedArgs.indexOf('--session-id') + 1]).toBe('11111111-1111-4111-8111-111111111111')
    expect(capturedArgs).not.toContain('--resume')
  })

  test('existing Web chat sessions resume their transcript id', () => {
    const mock = createMockChild()
    let capturedArgs: string[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      sessionId: '22222222-2222-4222-8222-222222222222',
      resumeSession: true,
      send: () => {},
      spawnFactory: (_command, args) => {
        capturedArgs = args
        return mock.child
      },
    })

    session.sendUserMessage('hello again')

    expect(capturedArgs).toContain('--resume')
    expect(capturedArgs[capturedArgs.indexOf('--resume') + 1]).toBe('22222222-2222-4222-8222-222222222222')
    expect(capturedArgs).not.toContain('--session-id')
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

  test('AppTest tool results surface preflight activity details', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })
    const appTestResult = {
      success: false,
      message: 'Midscene model configuration is incomplete: missing MIDSCENE_MODEL_NAME.',
      platform: 'android',
      events: [{
        type: 'event',
        event_type: 'visual_preflight_checked',
        payload: {
          platform: 'android',
          adb_available: true,
          adb_path: 'adb',
          connected_devices: ['AREMUT5226001251'],
          unauthorized_devices: [],
          offline_devices: [],
          target_device_connected: true,
          android_sdk_configured: false,
          missing_android_env_keys: ['ANDROID_HOME', 'ANDROID_SDK_ROOT'],
          midscene_model_configured: false,
          missing_midscene_env_keys: ['MIDSCENE_MODEL_NAME'],
        },
      }],
    }

    session.start()
    mock.stdout.write(JSON.stringify({
      type: 'user',
      message: {
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-app',
          content: JSON.stringify(appTestResult),
        }],
      },
    }) + '\n')

    const preflightActivity = events.find(event =>
      event.type === 'activity' && event.activity.title === 'Preflight',
    )
    expect(preflightActivity).toMatchObject({
      type: 'activity',
      activity: {
        kind: 'preflight',
        title: 'Preflight',
      },
    })
    expect(preflightActivity?.type === 'activity' ? preflightActivity.activity.detail : '').toContain('ADB: ready / device AREMUT5226001251')
    expect(preflightActivity?.type === 'activity' ? preflightActivity.activity.detail : '').toContain('Midscene model: missing MIDSCENE_MODEL_NAME')
  })

  test('SDK can_use_tool control_request broadcasts permission modal events', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })

    const permissionSuggestions = [{
      behavior: 'allow',
      destination: 'localSettings',
      rule: { toolName: 'AppTest' },
    }]

    session.start()
    mock.stdout.write(JSON.stringify({
      type: 'control_request',
      request_id: 'request-app',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AppTest',
        tool_use_id: 'tool-app',
        input: {
          app_package: 'com.cmri.universalapp',
          platform: 'android',
        },
        permission_suggestions: permissionSuggestions,
        description: 'OpenClaude wants to run an Android App test against com.cmri.universalapp.',
        title: 'Run Android App test',
      },
    }) + '\n')

    const permissionEvent = events.find((event): event is Extract<ServerEvent, { type: 'permission_request' }> =>
      event.type === 'permission_request',
    )
    expect(permissionEvent?.request).toEqual({
      requestId: 'request-app',
      toolName: 'AppTest',
      toolUseId: 'tool-app',
      input: {
        app_package: 'com.cmri.universalapp',
        platform: 'android',
      },
      permissionSuggestions,
      prompt: 'OpenClaude wants to run an Android App test against com.cmri.universalapp.',
    })
    expect(events.some(event =>
      event.type === 'activity' &&
      event.activity.title === 'Permission requested' &&
      event.activity.detail === 'AppTest',
    )).toBe(true)
  })

  test('Bash can_use_tool control_request broadcasts permission modal events', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })

    const permissionSuggestions = [{
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: 'Bash', ruleContent: 'adb:*' }],
      behavior: 'allow',
    }]

    session.start()
    mock.stdout.write(JSON.stringify({
      type: 'control_request',
      request_id: 'request-bash',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tool-bash',
        input: {
          command: 'adb devices',
          description: 'Check connected Android devices via ADB',
        },
        permission_suggestions: permissionSuggestions,
        description: 'Current permission mode (Accept edits) requires approval for this Bash command',
      },
    }) + '\n')

    const permissionEvent = events.find((event): event is Extract<ServerEvent, { type: 'permission_request' }> =>
      event.type === 'permission_request',
    )
    expect(permissionEvent?.request).toEqual({
      requestId: 'request-bash',
      toolName: 'Bash',
      toolUseId: 'tool-bash',
      input: {
        command: 'adb devices',
        description: 'Check connected Android devices via ADB',
      },
      permissionSuggestions,
      prompt: 'Current permission mode (Accept edits) requires approval for this Bash command',
    })
    expect(events.some(event =>
      event.type === 'activity' &&
      event.activity.title === 'Permission requested' &&
      event.activity.detail === 'Bash',
    )).toBe(true)
  })

  test('allow permission decisions write one-shot control_response messages', () => {
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
      request_id: 'request-allow',
      request: {
        name: 'Edit',
        tool_use_id: 'tool-allow',
        input: { file_path: 'a.ts' },
        permission_suggestions: [{ behavior: 'allow' }],
      },
    }) + '\n')
    session.sendPermissionResponse('request-allow', 'allow')

    const response = JSON.parse(mock.writes.at(-1) ?? '{}')
    expect(response).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'request-allow',
        response: {
          behavior: 'allow',
          updatedInput: { file_path: 'a.ts' },
          toolUseID: 'tool-allow',
        },
      },
    })
  })

  test('allow-session permission decisions write remembered permissions', () => {
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

  test('abort interrupts the child and reports stopping state', () => {
    const mock = createMockChild()
    const events: ServerEvent[] = []
    const session = new CliChatSession({
      cwd: process.cwd(),
      permissionMode: 'acceptEdits',
      send: event => events.push(event),
      spawnFactory: () => mock.child,
    })

    session.start()
    session.handleClientMessage({ type: 'abort' })

    expect(mock.killSignals).toContain('SIGINT')
    expect(
      events.some(event => event.type === 'status' && event.status === 'Stopping'),
    ).toBe(true)
    expect(
      events.some(
        event =>
          event.type === 'activity' &&
          event.activity.title === 'Abort requested',
      ),
    ).toBe(true)
  })

  test('deny permission decisions write deny control_response messages', () => {
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
      request_id: 'request-deny',
      request: {
        name: 'AppTest',
        tool_use_id: 'tool-deny',
        input: { app_package: 'com.cmri.universalapp' },
      },
    }) + '\n')
    session.sendPermissionResponse('request-deny', 'deny')

    const response = JSON.parse(mock.writes.at(-1) ?? '{}')
    expect(response).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'request-deny',
        response: {
          behavior: 'deny',
          message: 'User denied permission',
          toolUseID: 'tool-deny',
        },
      },
    })
  })
})
