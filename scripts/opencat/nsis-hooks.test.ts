import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

function readHook() {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'launcher', 'src-tauri', 'windows', 'nsis-hooks.nsh'),
    'utf8',
  )
}

describe('OpenCat NSIS installer hooks', () => {
  test('preinstall cleanup does not use PowerShell reserved PID variable', () => {
    const hook = readHook()

    expect(hook).toContain('foreach ($$processId in $$ids)')
    expect(hook).toContain("Write-Output ('Stopping OpenCat backend PID ' + $$processId)")
    expect(hook).toContain('Stop-Process -Id $$processId -Force -ErrorAction Stop')
    expect(hook).not.toContain('foreach ($$pid in $$ids)')
    expect(hook).not.toContain('Stop-Process -Id $$pid')
  })

  test('preinstall cleanup runs inline PowerShell instead of loading a temp ps1 file', () => {
    const hook = readHook()

    expect(hook).toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command')
    expect(hook).toContain('param([string]$$InstallDir)')
    expect(hook).toContain('"$INSTDIR"')
    expect(hook).not.toContain('opencat-preinstall-cleanup.ps1')
    expect(hook).not.toContain('-File "$0"')
  })

  test('preinstall cleanup still stops OpenCat runtime and checks the node lock', () => {
    const hook = readHook()

    expect(hook).toContain('function Find-OpenCatBackend')
    expect(hook).toContain("Join-Path $$InstallDir 'resources\\opencat-runtime'")
    expect(hook).toContain("Join-Path $$runtimeDir 'node\\node.exe'")
    expect(hook).toContain("Join-Path $$runtimeDir 'dist\\cli.mjs'")
    expect(hook).toContain('Stop-Process -Id $$processId -Force -ErrorAction Stop')
    expect(hook).toContain('Test-Path -LiteralPath $$nodePath')
    expect(hook).toContain('[System.IO.File]::Open($$nodePath')
  })
})
