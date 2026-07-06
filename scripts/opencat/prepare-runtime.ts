import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  chmod,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const rootDir = resolve(import.meta.dirname, '..', '..')
const runtimeDir = join(rootDir, 'launcher', 'src-tauri', 'resources', 'opencat-runtime')
const packageJsonPath = join(rootDir, 'package.json')
const defaultBuildCacheDir = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'OpenCatBuildCache')
  : join(rootDir, '.opencat-build-cache')
const buildCacheDir = resolve(process.env.OPENCAT_BUILD_CACHE_DIR ?? defaultBuildCacheDir)
const targetPlatform = normalizeRuntimePlatform(process.env.OPENCAT_RUNTIME_PLATFORM ?? process.platform)
const targetArch = normalizeRuntimeArch(process.env.OPENCAT_RUNTIME_ARCH ?? process.arch)
const runtimeTargetId = `${targetPlatform}-${targetArch}`
const targetCacheDir = join(buildCacheDir, runtimeTargetId)
const runtimeNodeModulesCacheDir = join(targetCacheDir, 'runtime-node_modules')
const runtimeNodeModulesCacheMetaPath = join(targetCacheDir, 'runtime-node_modules.json')
const runtimePackageLockCachePath = join(targetCacheDir, 'runtime-package-lock.json')
const playwrightBuildCacheDir = join(targetCacheDir, 'ms-playwright')
const cleanRuntimeCache = process.env.OPENCAT_CLEAN_RUNTIME_CACHE === '1'
const cleanPlaywrightCache = process.env.OPENCAT_CLEAN_PLAYWRIGHT_CACHE === '1'
const runtimeNodeModulesCacheVersion = '3'
const visibleLeakPattern = /OpenClaude|Open Claude|openclaude/g
const nodeDistBaseUrl = process.env.OPENCAT_NODE_DIST_BASE_URL ?? 'https://nodejs.org/dist'

type CopyEntry = {
  from: string
  to: string
  required?: boolean
}

type RuntimeNodeModulesCacheMeta = {
  hash?: string
  version?: string
}

type RuntimeManifest = {
  runtimePlatform?: string
  runtimeArch?: string
}

function normalizeRuntimePlatform(value: string): NodeJS.Platform {
  const platform = value.trim()
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform
  }
  throw new Error(`Unsupported OPENCAT_RUNTIME_PLATFORM: ${value}`)
}

function normalizeRuntimeArch(value: string): NodeJS.Architecture {
  const arch = value.trim()
  if (arch === 'x64' || arch === 'arm64') {
    return arch
  }
  throw new Error(`Unsupported OPENCAT_RUNTIME_ARCH: ${value}`)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function hasDirectoryEntries(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length > 0
  } catch {
    return false
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

async function copyPath(entry: CopyEntry): Promise<void> {
  if (!(await exists(entry.from))) {
    if (entry.required !== false) {
      throw new Error(`Required runtime input is missing: ${entry.from}`)
    }
    return
  }
  await mkdir(dirname(entry.to), { recursive: true })
  await cp(entry.from, entry.to, {
    recursive: true,
    force: true,
    dereference: false,
  })
}

function detectNodeExecutable(): string {
  if (/^node(?:\.exe)?$/i.test(basename(process.execPath))) {
    return process.execPath
  }
  const result = spawnSync('node', ['-p', 'process.execPath'], {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true,
  })
  const detected = result.stdout?.trim()
  if (result.status === 0 && detected && existsSync(detected)) {
    return detected
  }
  throw new Error('Node runtime was not found on PATH.')
}

function currentNodeVersion(): string {
  const result = spawnSync(detectNodeExecutable(), ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const version = result.stdout.trim()
  if (result.status !== 0 || !/^v\d+\.\d+\.\d+/.test(version)) {
    throw new Error('Failed to resolve the local Node.js version.')
  }
  return version
}

function bundledNodeRuntimePath(): string {
  return targetPlatform === 'win32'
    ? join(runtimeDir, 'node', 'node.exe')
    : join(runtimeDir, 'node', 'bin', 'node')
}

async function downloadText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  return response.text()
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function expectedNodeArchiveSha256(shasums: string, archiveName: string): string {
  for (const line of shasums.split(/\r?\n/)) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === archiveName && /^[a-f0-9]{64}$/i.test(hash)) {
      return hash.toLowerCase()
    }
  }
  throw new Error(`Node.js SHASUMS256.txt did not include ${archiveName}.`)
}

async function downloadedDarwinNodeExecutable(): Promise<string> {
  if (targetPlatform !== 'darwin') {
    throw new Error(`Cross-platform Node runtime download is only supported for darwin, got ${targetPlatform}.`)
  }

  const nodeVersion = currentNodeVersion()
  const distName = `node-${nodeVersion}-darwin-${targetArch}`
  const archiveName = `${distName}.tar.gz`
  const nodeCacheDir = join(targetCacheDir, 'node', nodeVersion)
  const extractedDir = join(nodeCacheDir, distName)
  const cachedNode = join(extractedDir, 'bin', 'node')
  if (await exists(cachedNode)) {
    return cachedNode
  }

  const versionBaseUrl = `${nodeDistBaseUrl.replace(/\/$/, '')}/${nodeVersion}`
  console.log(`Downloading Node.js ${nodeVersion} for darwin-${targetArch}`)
  const [shasums, archive] = await Promise.all([
    downloadText(`${versionBaseUrl}/SHASUMS256.txt`),
    downloadBuffer(`${versionBaseUrl}/${archiveName}`),
  ])
  const expectedSha = expectedNodeArchiveSha256(shasums, archiveName)
  const actualSha = sha256Hex(archive)
  if (actualSha !== expectedSha) {
    throw new Error(`SHA256 mismatch for ${archiveName}. Expected ${expectedSha}, got ${actualSha}.`)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'opencat-node-'))
  const archivePath = join(tempDir, archiveName)
  try {
    await mkdir(nodeCacheDir, { recursive: true })
    await rm(extractedDir, { recursive: true, force: true })
    await writeFile(archivePath, archive)
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', nodeCacheDir], {
      stdio: 'inherit',
      windowsHide: true,
    })
    if (result.status !== 0) {
      throw new Error(`Failed to extract ${archiveName}.`)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }

  if (!(await exists(cachedNode))) {
    throw new Error(`Downloaded Node.js runtime did not contain ${cachedNode}.`)
  }
  return cachedNode
}

async function copyNodeRuntime(): Promise<void> {
  const nodeSource = process.platform === targetPlatform && process.arch === targetArch
    ? detectNodeExecutable()
    : await downloadedDarwinNodeExecutable()
  const nodeTarget = bundledNodeRuntimePath()
  await mkdir(dirname(nodeTarget), { recursive: true })
  await copyFile(nodeSource, nodeTarget)
  await chmod(nodeTarget, 0o755)
}

function playwrightCliPath(): string {
  const packageJson = require.resolve('playwright/package.json')
  return join(dirname(packageJson), 'cli.js')
}

function playwrightCacheCandidates(): string[] {
  if (process.platform !== targetPlatform || process.arch !== targetArch) {
    return []
  }

  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'ms-playwright') : undefined,
    process.env.HOME ? join(process.env.HOME, '.cache', 'ms-playwright') : undefined,
    join(rootDir, 'node_modules', 'playwright-core', '.local-browsers'),
  ]
  return candidates.filter((candidate): candidate is string => Boolean(candidate))
}

async function hasPlaywrightChromiumCache(path: string): Promise<boolean> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .some(entry => entry.name.toLowerCase().startsWith('chromium'))
  } catch {
    return false
  }
}

async function hydratePlaywrightCacheFromExistingRuntime(): Promise<void> {
  const existingRuntimeCache = join(runtimeDir, 'ms-playwright')
  if (
    cleanPlaywrightCache ||
    await hasPlaywrightChromiumCache(playwrightBuildCacheDir) ||
    !(await hasPlaywrightChromiumCache(existingRuntimeCache)) ||
    !(await existingRuntimeMatchesTarget())
  ) {
    return
  }

  console.log(`Saving existing staged Playwright Chromium cache to ${playwrightBuildCacheDir}`)
  await mkdir(targetCacheDir, { recursive: true })
  await rm(playwrightBuildCacheDir, { recursive: true, force: true })
  await cp(existingRuntimeCache, playwrightBuildCacheDir, {
    recursive: true,
    force: true,
    dereference: true,
  })
}

async function seedPlaywrightCacheFromCandidates(): Promise<boolean> {
  for (const candidate of playwrightCacheCandidates()) {
    if (samePath(candidate, playwrightBuildCacheDir)) {
      continue
    }
    if (!(await hasPlaywrightChromiumCache(candidate))) {
      continue
    }

    console.log(`Caching existing Playwright Chromium from ${candidate}`)
    await mkdir(targetCacheDir, { recursive: true })
    await rm(playwrightBuildCacheDir, { recursive: true, force: true })
    await cp(candidate, playwrightBuildCacheDir, {
      recursive: true,
      force: true,
      dereference: true,
    })
    return true
  }
  return false
}

async function installPlaywrightChromiumToCache(): Promise<void> {
  console.log(`Installing Playwright Chromium into ${playwrightBuildCacheDir}`)
  await mkdir(targetCacheDir, { recursive: true })
  await rm(playwrightBuildCacheDir, { recursive: true, force: true })
  await mkdir(playwrightBuildCacheDir, { recursive: true })
  const installerNode = targetPlatform === process.platform
    ? bundledNodeRuntimePath()
    : detectNodeExecutable()
  const result = spawnSync(installerNode, [playwrightCliPath(), 'install', 'chromium'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: playwrightBuildCacheDir,
      npm_config_os: targetPlatform,
      npm_config_cpu: targetArch,
    },
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`Failed to install bundled Playwright Chromium for ${runtimeTargetId}.`)
  }
  if (!(await hasPlaywrightChromiumCache(playwrightBuildCacheDir))) {
    throw new Error(`Playwright Chromium cache was not created at ${playwrightBuildCacheDir}.`)
  }
}

async function copyOrInstallPlaywrightChromium(): Promise<void> {
  const target = join(runtimeDir, 'ms-playwright')
  if (cleanPlaywrightCache) {
    console.log(`Cleaning OpenCat Playwright cache at ${playwrightBuildCacheDir}`)
    await rm(playwrightBuildCacheDir, { recursive: true, force: true })
  }

  if (!(await hasPlaywrightChromiumCache(playwrightBuildCacheDir))) {
    const seeded = await seedPlaywrightCacheFromCandidates()
    if (!seeded) {
      await installPlaywrightChromiumToCache()
    }
  }

  console.log(`Using cached Playwright Chromium from ${playwrightBuildCacheDir}`)
  await rm(target, { recursive: true, force: true })
  await cp(playwrightBuildCacheDir, target, {
    recursive: true,
    force: true,
    dereference: true,
  })
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function installRuntimeNodeModules(): Promise<void> {
  const dependencyHash = await runtimeDependencyHash()
  if (cleanRuntimeCache) {
    console.log(`Cleaning OpenCat runtime dependency cache at ${runtimeNodeModulesCacheDir}`)
    await rm(runtimeNodeModulesCacheDir, { recursive: true, force: true })
    await rm(runtimeNodeModulesCacheMetaPath, { force: true })
    await rm(runtimePackageLockCachePath, { force: true })
  }

  if (await copyRuntimeNodeModulesFromCache(dependencyHash)) {
    return
  }

  console.log('Installing OpenCat runtime production dependencies')
  const result = spawnSync(npmCommand(), [
    'install',
    '--omit=dev',
    '--os',
    targetPlatform,
    '--cpu',
    targetArch,
  ], {
    cwd: runtimeDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_os: targetPlatform,
      npm_config_cpu: targetArch,
    },
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error('Failed to install OpenCat runtime production dependencies.')
  }
  await materializeRuntimeFileDependencies()
  await pruneRuntimeNodeModules()
  await saveRuntimeNodeModulesCache(dependencyHash)
}

async function runtimeDependencyHash(): Promise<string> {
  const hash = createHash('sha256')
  const hashInputs = [
    packageJsonPath,
    join(rootDir, 'bun.lock'),
    join(rootDir, 'bun.lockb'),
    join(rootDir, 'package-lock.json'),
    join(rootDir, 'vendor', 'node-domexception-shim', 'package.json'),
  ]

  hash.update(`opencat-runtime-node-modules-cache:${runtimeNodeModulesCacheVersion}\n`)
  hash.update(`target:${runtimeTargetId}\n`)
  for (const path of hashInputs) {
    if (!(await exists(path))) {
      continue
    }
    hash.update(path)
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readRuntimeNodeModulesCacheMeta(): Promise<RuntimeNodeModulesCacheMeta | null> {
  try {
    return JSON.parse(await readFile(runtimeNodeModulesCacheMetaPath, 'utf8')) as RuntimeNodeModulesCacheMeta
  } catch {
    return null
  }
}

async function copyRuntimeNodeModulesFromCache(expectedHash: string): Promise<boolean> {
  const meta = await readRuntimeNodeModulesCacheMeta()
  if (
    meta?.version !== runtimeNodeModulesCacheVersion ||
    meta.hash !== expectedHash ||
    !(await hasDirectoryEntries(runtimeNodeModulesCacheDir))
  ) {
    return false
  }

  console.log(`Using cached OpenCat runtime production dependencies from ${runtimeNodeModulesCacheDir}`)
  await rm(join(runtimeDir, 'node_modules'), { recursive: true, force: true })
  await cp(runtimeNodeModulesCacheDir, join(runtimeDir, 'node_modules'), {
    recursive: true,
    force: true,
    dereference: true,
  })
  if (await exists(runtimePackageLockCachePath)) {
    await copyFile(runtimePackageLockCachePath, join(runtimeDir, 'package-lock.json'))
  }
  return true
}

async function saveRuntimeNodeModulesCache(hash: string): Promise<void> {
  const nodeModules = join(runtimeDir, 'node_modules')
  if (!(await hasDirectoryEntries(nodeModules))) {
    throw new Error('Runtime node_modules was not created.')
  }

  console.log(`Saving OpenCat runtime production dependencies to ${runtimeNodeModulesCacheDir}`)
  await mkdir(targetCacheDir, { recursive: true })
  await rm(runtimeNodeModulesCacheDir, { recursive: true, force: true })
  await cp(nodeModules, runtimeNodeModulesCacheDir, {
    recursive: true,
    force: true,
    dereference: true,
  })
  const runtimePackageLockPath = join(runtimeDir, 'package-lock.json')
  if (await exists(runtimePackageLockPath)) {
    await copyFile(runtimePackageLockPath, runtimePackageLockCachePath)
  } else {
    await rm(runtimePackageLockCachePath, { force: true })
  }
  await writeFile(
    runtimeNodeModulesCacheMetaPath,
    `${JSON.stringify({
      version: runtimeNodeModulesCacheVersion,
      hash,
      preparedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  )
}

async function materializeRuntimeFileDependencies(): Promise<void> {
  const nodeDomExceptionTarget = join(runtimeDir, 'node_modules', 'node-domexception')
  const nodeDomExceptionSource = join(runtimeDir, 'vendor', 'node-domexception-shim')
  if (!(await exists(nodeDomExceptionSource))) {
    return
  }
  await rm(nodeDomExceptionTarget, { recursive: true, force: true })
  await cp(nodeDomExceptionSource, nodeDomExceptionTarget, {
    recursive: true,
    force: true,
    dereference: true,
  })
}

async function pruneRuntimeNodeModules(): Promise<void> {
  const nodeModules = join(runtimeDir, 'node_modules')
  const removableExtensions = new Set([
    '.map',
    '.md',
    '.markdown',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
  ])
  const removableDirectories = new Set([
    '.github',
    '.vscode',
    'benchmark',
    'benchmarks',
    'coverage',
    'doc',
    'docs',
    'example',
    'examples',
    'test',
    'tests',
    '__test__',
    '__tests__',
  ])

  if (!(await exists(nodeModules))) {
    return
  }

  async function pruneFiles(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await pruneFiles(path)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const lower = entry.name.toLowerCase()
      const extension = lower.endsWith('.d.ts')
        ? '.ts'
        : lower.slice(lower.lastIndexOf('.'))
      if (removableExtensions.has(extension)) {
        await rm(path, { force: true })
      }
    }
  }

  function isPackageRoot(relativeParts: string[]): boolean {
    if (relativeParts.length === 1) return true
    return relativeParts[0]?.startsWith('@') && relativeParts.length === 2
  }

  async function pruneDirs(dir: string, relativeParts: string[] = []): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const path = join(dir, entry.name)
      const nextParts = [...relativeParts, entry.name]
      if (removableDirectories.has(entry.name.toLowerCase()) && !isPackageRoot(nextParts)) {
        await rm(path, { recursive: true, force: true })
        continue
      }
      await pruneDirs(path, nextParts)
    }
  }

  async function removeEmptyDirs(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const path = join(dir, entry.name)
      await removeEmptyDirs(path)
      await rmdir(path).catch(() => {})
    }
  }

  await pruneFiles(nodeModules)
  await pruneDirs(nodeModules)
  await removeEmptyDirs(nodeModules)
}

async function writeRuntimeManifest(): Promise<void> {
  const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const nodeVersion = spawnSync(bundledNodeRuntimePath(), ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim()
  await writeFile(
    join(runtimeDir, 'opencat-runtime.json'),
    `${JSON.stringify({
      productName: 'OpenCat',
      version: pkg.version,
      node: nodeVersion,
      runtimePlatform: targetPlatform,
      runtimeArch: targetArch,
      preparedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  )
}

async function existingRuntimeMatchesTarget(): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(join(runtimeDir, 'opencat-runtime.json'), 'utf8'),
    ) as RuntimeManifest
    return manifest.runtimePlatform === targetPlatform && manifest.runtimeArch === targetArch
  } catch {
    return process.platform === targetPlatform && process.arch === targetArch
  }
}

async function scanVisibleLeaks(): Promise<void> {
  const allowedExtensions = new Set([
    '.html',
    '.json',
    '.css',
    '.md',
    '.txt',
  ])
  const excludedFragments = [
    '/node_modules/',
    '/licenses/',
    '/license',
    '/notice',
    '.map',
    '/docs/',
  ]
  const leaks: string[] = []

  async function walk(dir: string): Promise<void> {
    for await (const relativePath of new Bun.Glob('**/*').scan({ cwd: dir, onlyFiles: true })) {
      const normalized = relativePath.replace(/\\/g, '/')
      const lower = normalized.toLowerCase()
      if (excludedFragments.some(fragment => lower.includes(fragment))) continue
      if (!allowedExtensions.has(lower.slice(lower.lastIndexOf('.')))) continue
      const path = join(dir, relativePath)
      const text = await readFile(path, 'utf8').catch(() => '')
      if (visibleLeakPattern.test(text)) {
        leaks.push(normalized)
      }
      visibleLeakPattern.lastIndex = 0
    }
  }

  await walk(runtimeDir)
  if (leaks.length) {
    throw new Error(`OpenCat staging contains old visible branding:\n${leaks.map(item => `  - ${item}`).join('\n')}`)
  }
}

async function main(): Promise<void> {
  await hydratePlaywrightCacheFromExistingRuntime()
  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(runtimeDir, { recursive: true })

  const entries: CopyEntry[] = [
    { from: join(rootDir, 'dist', 'cli.mjs'), to: join(runtimeDir, 'dist', 'cli.mjs') },
    { from: join(rootDir, 'dist', 'sdk.mjs'), to: join(runtimeDir, 'dist', 'sdk.mjs') },
    { from: join(rootDir, 'src', 'webui', 'assets', 'opencat.ico'), to: join(runtimeDir, 'dist', 'assets', 'opencat.ico') },
    { from: join(rootDir, 'packages', 'app-test-runner', 'dist'), to: join(runtimeDir, 'packages', 'app-test-runner', 'dist') },
    { from: join(rootDir, 'packages', 'app-test-runner', 'package.json'), to: join(runtimeDir, 'packages', 'app-test-runner', 'package.json') },
    { from: join(rootDir, 'vendor', 'node-domexception-shim'), to: join(runtimeDir, 'vendor', 'node-domexception-shim') },
    { from: join(rootDir, 'package.json'), to: join(runtimeDir, 'package.json') },
    { from: join(rootDir, 'docs', 'app-testing.md'), to: join(runtimeDir, 'docs', 'app-testing.md'), required: false },
    { from: join(rootDir, 'docs', 'opencat-packaging.md'), to: join(runtimeDir, 'docs', 'opencat-packaging.md'), required: false },
  ]

  for (const entry of entries) {
    await copyPath(entry)
  }
  await installRuntimeNodeModules()
  await copyNodeRuntime()
  await copyOrInstallPlaywrightChromium()
  await writeRuntimeManifest()
  await scanVisibleLeaks()

  console.log(`OpenCat runtime staged at ${runtimeDir}`)
  console.log(`OpenCat runtime target: ${runtimeTargetId}`)
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
