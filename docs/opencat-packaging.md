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

## Installed Data Layout

The installed launcher keeps the bundled runtime read-only and creates user data
under `%APPDATA%\OpenCat` before starting the hidden Web server:

- `%APPDATA%\OpenCat\workspace` - default Web chat working directory.
- `%APPDATA%\OpenCat\skills` - user-level custom Skills shared across projects.
- `%APPDATA%\OpenCat\workspace\.opencat\skills` - project-level custom Skills for the installed default workspace.
- `%APPDATA%\OpenCat\projects` - transcript and project-scoped CLI state.
- `%APPDATA%\OpenCat\webui\sessions.json` - Web chat session list.

The launcher starts `opencat web` with `--cwd %APPDATA%\OpenCat\workspace` and
sets `OPENCAT_CONFIG_DIR=%APPDATA%\OpenCat`, so sessions and custom Skills
survive restarts and runtime upgrades.

## ADB

ADB is not bundled. The launcher checks a saved path, `OPENCAT_ADB_PATH`,
`ADB_PATH`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`. Users can save a custom ADB
path in the launcher.

## Updates

The launcher exposes a manual update check. It resolves the update center base
URL in this order:

1. `OPENCAT_UPDATE_BASE_URL`
2. `%APPDATA%\OpenCat\config.json` or `%APPDATA%\OpenCat\config\config.json`
   with `update.platform_base_url`
3. the same config files with `server.protocol`, `server.host`, and
   `server.port`
4. the default OpenCat platform URL

The check calls
`/api/system/download_center/check_update/?product_key=opencat&current_version=<version>&platform=windows&channel=stable`.
When a newer version is available, the launcher shows the installer name, size,
and release notes, then downloads the installer only after user confirmation.
Downloads are written to `%APPDATA%\OpenCat\downloads` through a `.part` file
and are SHA256-verified when the update response includes a checksum.

The launcher never replaces the running app automatically. After download, run
the downloaded `OpenCat_Setup` installer manually to complete the update.
