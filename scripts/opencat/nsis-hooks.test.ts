import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

describe('OpenCat NSIS installer hooks', () => {
  test('preinstall cleanup does not use PowerShell reserved PID variable', () => {
    const hook = readFileSync(
      join(import.meta.dir, '..', '..', 'launcher', 'src-tauri', 'windows', 'nsis-hooks.nsh'),
      'utf8',
    )

    expect(hook).toContain('foreach ($$processId in $$ids)')
    expect(hook).toContain("Write-Output ('Stopping OpenCat backend PID ' + $$processId)")
    expect(hook).toContain('Stop-Process -Id $$processId -Force -ErrorAction Stop')
    expect(hook).not.toContain('foreach ($$pid in $$ids)')
    expect(hook).not.toContain('Stop-Process -Id $$pid')
  })
})
