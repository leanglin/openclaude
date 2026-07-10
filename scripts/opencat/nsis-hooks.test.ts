import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const NSIS_MAX_STRLEN = 1024
const windowsTest = process.platform === 'win32' ? test : test.skip

function readHook() {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'launcher', 'src-tauri', 'windows', 'nsis-hooks.nsh'),
    'utf8',
  )
}

function extractNsExecCommands(hook: string) {
  const delimiter = String.fromCharCode(96)

  return hook.split(/\r?\n/).flatMap((line) => {
    if (!line.includes('nsExec::ExecToStack')) {
      return []
    }

    const start = line.indexOf(delimiter)
    const end = line.lastIndexOf(delimiter)
    if (start < 0 || end <= start) {
      throw new Error('Unexpected nsExec command shape: ' + line)
    }

    return [line.slice(start + 1, end)]
  })
}

function toRuntimeCommand(command: string) {
  return command.replaceAll('$$', '$')
}

function extractPowerShellScript(command: string) {
  const runtimeCommand = toRuntimeCommand(command)
  const quote = '"'
  const prefix = '-Command ' + quote
  const start = runtimeCommand.indexOf(prefix)

  if (start < 0 || !runtimeCommand.endsWith(quote)) {
    throw new Error('Unexpected PowerShell command shape: ' + runtimeCommand)
  }

  return runtimeCommand.slice(start + prefix.length, -quote.length)
}

describe('OpenCat NSIS installer hooks', () => {
  test('preinstall cleanup does not use PowerShell reserved PID variable', () => {
    const hook = readHook()

    expect(hook).toContain('$$processId=[int]$$item.ProcessId')
    expect(hook).toContain("Write-Output ('Stopping OpenCat backend PID ' + $$processId)")
    expect(hook).toContain('Stop-Process -Id $$processId -Force -ErrorAction SilentlyContinue')
    expect(hook).not.toContain('foreach ($$pid in $$ids)')
    expect(hook).not.toContain('Stop-Process -Id $$pid')
  })

  test('preinstall cleanup runs inline PowerShell instead of loading a temp ps1 file', () => {
    const hook = readHook()

    expect(hook).toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command')
    expect(hook).toContain('-Command "& {')
    expect(hook).not.toContain('-Command ' + String.fromCharCode(92, 34))
    expect(hook).toContain('SetEnvironmentVariable(t "OPENCAT_INSTALL_DIR", t "$INSTDIR")')
    expect(hook).toContain('$$env:OPENCAT_INSTALL_DIR')
    expect(hook).toContain('SetEnvironmentVariable(t "OPENCAT_INSTALL_DIR", p 0)')
    expect(hook).not.toContain('opencat-preinstall-cleanup.ps1')
    expect(hook).not.toContain('-File "$0"')
  })

  test('each command stays below the NSIS runtime string limit', () => {
    const commands = extractNsExecCommands(readHook())

    expect(commands).toHaveLength(2)
    for (const command of commands) {
      expect(toRuntimeCommand(command).length).toBeLessThan(NSIS_MAX_STRLEN)
      expect(command).not.toContain('$INSTDIR')
    }
  })

  test('preinstall cleanup still stops OpenCat runtime and checks the node lock', () => {
    const hook = readHook()

    expect(hook).toContain('function Find-Backend')
    expect(hook).toContain("Join-Path $$env:OPENCAT_INSTALL_DIR 'resources\\opencat-runtime'")
    expect(hook).toContain("Join-Path $$runtime 'node\\node.exe'")
    expect(hook).toContain("Join-Path $$runtime 'dist\\cli.mjs'")
    expect(hook).toContain('Stop-Process -Id $$processId -Force -ErrorAction SilentlyContinue')
    expect(hook).toContain('Wait-Process -Id $$items.ProcessId -Timeout 10')
    expect(hook).toContain(
      "Join-Path $$env:OPENCAT_INSTALL_DIR 'resources\\opencat-runtime\\node\\node.exe'",
    )
    expect(hook).toContain('Test-Path -LiteralPath $$node')
    expect(hook).toContain('[System.IO.File]::Open($$node')
  })

  windowsTest(
    'inline PowerShell commands parse and run without touching an installation',
    () => {
      const commands = extractNsExecCommands(readHook())
      const installDir = join(tmpdir(), 'opencat-nsis-hook-' + randomUUID())

      for (const command of commands) {
        const result = spawnSync(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', extractPowerShellScript(command)],
          {
            encoding: 'utf8',
            env: { ...process.env, OPENCAT_INSTALL_DIR: installDir },
            timeout: 20_000,
            windowsHide: true,
          },
        )

        expect(result.error).toBeUndefined()
        expect(result.stderr).not.toContain('ParserError')
        expect(result.status).toBe(0)
      }
    },
    30_000,
  )
})
