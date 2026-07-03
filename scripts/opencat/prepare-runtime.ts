import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFile,
  cp,
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

const require = createRequire(import.meta.url)
const rootDir = resolve(import.meta.dirname, '..', '..')
const runtimeDir = join(rootDir, 'launcher', 'src-tauri', 'resources', 'opencat-runtime')
const packageJsonPath = join(rootDir, 'package.json')
const defaultBuildCacheDir = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'OpenCatBuildCache')
  : join(rootDir, '.opencat-build-cache')
const buildCacheDir = resolve(process.env.OPENCAT_BUILD_CACHE_DIR ?? defaultBuildCacheDir)
const runtimeNodeModulesCacheDir = join(buildCacheDir, 'runtime-node_modules')
const runtimeNodeModulesCacheMetaPath = join(buildCacheDir, 'runtime-node_modules.json')
const runtimePackageLockCachePath = join(buildCacheDir, 'runtime-package-lock.json')
const playwrightBuildCacheDir = join(buildCacheDir, 'ms-playwright')
const cleanRuntimeCache = process.env.OPENCAT_CLEAN_RUNTIME_CACHE === '1'
const cleanPlaywrightCache = process.env.OPENCAT_CLEAN_PLAYWRIGHT_CACHE === '1'
const runtimeNodeModulesCacheVersion = '2'
const visibleLeakPattern = /OpenClaude|Open Claude|openclaude/g

type CopyEntry = {
  from: string
  to: string
  required?: boolean
}

type RuntimeNodeModulesCacheMeta = {
  hash?: string
  version?: string
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

async function copyNodeRuntime(): Promise<void> {
  const nodeSource = detectNodeExecutable()
  const nodeTarget = process.platform === 'win32'
    ? join(runtimeDir, 'node', 'node.exe')
    : join(runtimeDir, 'node', 'bin', basename(nodeSource))
  await mkdir(dirname(nodeTarget), { recursive: true })
  await copyFile(nodeSource, nodeTarget)
}

function playwrightCliPath(): string {
  const packageJson = require.resolve('playwright/package.json')
  return join(dirname(packageJson), 'cli.js')
}

function playwrightCacheCandidates(): string[] {
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
    !(await hasPlaywrightChromiumCache(existingRuntimeCache))
  ) {
    return
  }

  console.log(`Saving existing staged Playwright Chromium cache to ${playwrightBuildCacheDir}`)
  await mkdir(buildCacheDir, { recursive: true })
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
    await mkdir(buildCacheDir, { recursive: true })
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
  await mkdir(buildCacheDir, { recursive: true })
  await rm(playwrightBuildCacheDir, { recursive: true, force: true })
  await mkdir(playwrightBuildCacheDir, { recursive: true })
  const result = spawnSync(detectNodeExecutable(), [playwrightCliPath(), 'install', 'chromium'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: playwrightBuildCacheDir,
    },
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error('Failed to install bundled Playwright Chromium.')
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
  const result = spawnSync(npmCommand(), ['install', '--omit=dev'], {
    cwd: runtimeDir,
    stdio: 'inherit',
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
  await mkdir(buildCacheDir, { recursive: true })
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
  const nodeVersion = spawnSync(detectNodeExecutable(), ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim()
  await writeFile(
    join(runtimeDir, 'opencat-runtime.json'),
    `${JSON.stringify({
      productName: 'OpenCat',
      version: pkg.version,
      node: nodeVersion,
      preparedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  )
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
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
