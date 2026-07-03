# OpenCat Windows Packaging

OpenCat 7.0.0 ships as a Windows-first Tauri launcher plus bundled runtime.
The launcher starts the local Web server as a hidden child process and opens
the Web UI inside a Tauri WebView.

## Prerequisites

- Bun 1.3.13
- Rust stable MSVC toolchain and Cargo
- Microsoft C++ Build Tools
- Node.js 22 or newer available on `PATH` when preparing the runtime

## Build

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\opencat\package-windows.ps1
```

The script checks prerequisites, repairs the local Tauri NSIS cache when needed,
builds the CLI and launcher, prepares the bundled runtime, and prints the NSIS
installer path with its SHA256 hash.

To check or prepare packaging tools without building:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\opencat\package-windows.ps1 -CheckOnly
```

Useful flags:

- `-CheckOnly` checks and prepares tools without running the package build.
- `-SkipToolInstall` fails fast instead of installing missing Bun, Rust, or NSIS cache files.
- `-SkipBuildToolsInstall` skips automatic Microsoft C++ Build Tools installation.
- `-CleanRuntimeCache` rebuilds the cached production `node_modules` used for runtime staging.
- `-CleanPlaywrightCache` rebuilds the cached Playwright Chromium browser bundle.
- `-NoKillOldTests` skips automatic cleanup of old `bun test` processes.

The package log is written to
`launcher/src-tauri/target/opencat-package-windows.log`.

Manual fallback commands:

```bash
bun install
npm.cmd --prefix packages/app-test-runner install
npm.cmd --prefix packages/app-test-runner run build
bun run build
bun run opencat:prepare-runtime
bun run --cwd launcher tauri build
```

The NSIS installer is emitted by Tauri under `launcher/src-tauri/target`.

## Runtime Staging

`bun run opencat:prepare-runtime` stages resources into
`launcher/src-tauri/resources/opencat-runtime`:

- `dist/cli.mjs` and `dist/sdk.mjs`
- `dist/assets/opencat.ico`
- `packages/app-test-runner/dist`
- production runtime dependencies from `node_modules`
- bundled Node executable
- Playwright Chromium under `ms-playwright`

Runtime dependency and browser caches are kept outside the repository under
`%LOCALAPPDATA%\OpenCatBuildCache`. The default package flow reuses them across
runs; use `-CleanRuntimeCache` or `-CleanPlaywrightCache` when dependency or
browser cache corruption is suspected.

The launcher sets `PLAYWRIGHT_BROWSERS_PATH`, `OPENCAT_APP_TEST_RUNNER`, and
`OPENCAT_APP_TEST_NODE` before starting the hidden Web server.

## ADB

ADB is not bundled. The launcher checks a saved path, `OPENCAT_ADB_PATH`,
`ADB_PATH`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`. Users can save a custom ADB
path in the launcher.

## Updates

The launcher exposes a manual update check. Set `OPENCAT_UPDATE_MANIFEST_URL`
at build time to enable a configured source. Without it, the launcher reports
`No update source configured`.
