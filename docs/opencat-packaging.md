# OpenCat Desktop Packaging

OpenCat 7.0.1 ships as a Tauri launcher plus bundled runtime. The launcher
starts the local Web server as a hidden child process and opens the Web UI
inside a Tauri WebView.

## Windows NSIS Packaging

### Prerequisites

- Bun 1.3.13
- Rust stable MSVC toolchain and Cargo
- Microsoft C++ Build Tools
- Node.js 22 or newer available on `PATH` when preparing the runtime

### Build

Run from the repository root:

```powershell
.\package-windows.bat
```

The script checks prerequisites, repairs the local Tauri NSIS cache when needed,
builds the CLI and launcher, prepares the bundled runtime, and prints the NSIS
installer path with its SHA256 hash.

To check or prepare packaging tools without building:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\package-windows.ps1 -CheckOnly
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

### Version Bump

Before packaging a new OpenCat release, update the synchronized project and
launcher version fields from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\set-opencat-version.ps1 -Version 7.0.2
```

For a double-click workflow, run `set-opencat-version.bat` and enter the new
plain SemVer value when prompted. Do not include a leading `v`.

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

## macOS DMG Packaging

macOS packaging must run on macOS. It produces unsigned DMG files by default and
does not change the Windows NSIS package flow.

### Prerequisites

- Bun 1.3.13
- Node.js 22 or newer with npm available on `PATH`
- Rust stable with Cargo and rustup
- Xcode command line tools
- `hdiutil`, `shasum`, `file`, and `tar`
- Rosetta 2 when building the `x64` DMG on Apple Silicon

### Build

Run from the repository root:

```bash
bash scripts/opencat/package-macos.sh
```

The default builds both Apple Silicon and Intel packages. To build one
architecture:

```bash
bash scripts/opencat/package-macos.sh --arch arm64
bash scripts/opencat/package-macos.sh --arch x64
```

To check prerequisites without building:

```bash
bash scripts/opencat/package-macos.sh --check-only
```

Useful flags:

- `--arch arm64|x64|all` chooses the macOS architecture set. The default is `all`.
- `--check-only` checks tools and Rust targets without running the package build.
- `--clean-runtime-cache` rebuilds the cached production `node_modules` for the target architecture.
- `--clean-playwright-cache` rebuilds the cached Playwright Chromium bundle for the target architecture.

The package log is written to
`launcher/src-tauri/target/opencat-package-macos.log`.

The script builds an unsigned `.app` with Tauri and then creates a simple DMG
with `hdiutil`. DMG files are emitted under architecture-specific target
directories such as:

- `launcher/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/`
- `launcher/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/`

The script prints each DMG path, size, and SHA256 hash.

Manual fallback commands for a single architecture:

```bash
bun install
npm --prefix packages/app-test-runner install
npm --prefix packages/app-test-runner run build
bun run build
OPENCAT_RUNTIME_PLATFORM=darwin OPENCAT_RUNTIME_ARCH=arm64 bun run opencat:prepare-runtime
bun run --cwd launcher tauri build --target aarch64-apple-darwin --bundles app --no-sign --config src-tauri/tauri.macos.conf.json
DMG_ROOT="$(mktemp -d)"
ditto launcher/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/OpenCat.app "$DMG_ROOT/OpenCat.app"
ln -s /Applications "$DMG_ROOT/Applications"
mkdir -p launcher/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg
hdiutil create -volname OpenCat -srcfolder "$DMG_ROOT" -ov -format UDZO launcher/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/OpenCat_<version>_aarch64.dmg
rm -rf "$DMG_ROOT"
```

Use `OPENCAT_RUNTIME_ARCH=x64` and `--target x86_64-apple-darwin` for the Intel
DMG.

These DMGs are unsigned and not notarized. Users may need to open them through
Finder's context menu or allow the app in macOS Privacy & Security settings
after first launch.

### DMG Verification

Mount a DMG and check the bundled runtime in the final `.app` bundle. The
runtime must live directly under `Contents/Resources/opencat-runtime`, not under
an extra nested `Contents/Resources/resources/` directory:

```bash
hdiutil attach path/to/OpenCat.dmg
test -d "/Volumes/OpenCat/OpenCat.app/Contents/Resources/opencat-runtime"
test -f "/Volumes/OpenCat/OpenCat.app/Contents/Resources/opencat-runtime/dist/cli.mjs"
test -f "/Volumes/OpenCat/OpenCat.app/Contents/Resources/opencat-runtime/opencat-runtime.json"
! test -d "/Volumes/OpenCat/OpenCat.app/Contents/Resources/resources/opencat-runtime"
file "/Volumes/OpenCat/OpenCat.app/Contents/Resources/opencat-runtime/node/bin/node"
lipo -archs "/Volumes/OpenCat/OpenCat.app/Contents/MacOS/opencat-launcher"
hdiutil detach "/Volumes/OpenCat"
```

## Runtime Staging

`bun run opencat:prepare-runtime` stages resources into
`launcher/src-tauri/resources/opencat-runtime`:

- `dist/cli.mjs` and `dist/sdk.mjs`
- `dist/assets/opencat.ico`
- `packages/app-test-runner/dist`
- production runtime dependencies from `node_modules`
- bundled Node executable
- Playwright Chromium under `ms-playwright`

Runtime dependency and browser caches are keyed by target platform and
architecture. The Windows package flow keeps them under
`%LOCALAPPDATA%\OpenCatBuildCache`; the macOS package flow defaults to
`~/Library/Caches/OpenCatBuildCache`. Both flows reuse caches across runs; use
the clean-cache flags when dependency or browser cache corruption is suspected.

The launcher sets `PLAYWRIGHT_BROWSERS_PATH`, `OPENCAT_APP_TEST_RUNNER`, and
`OPENCAT_APP_TEST_NODE` before starting the hidden Web server.

## Installed Data Layout

The installed launcher keeps the bundled runtime read-only and creates user data
under the platform OpenCat config directory before starting the hidden Web
server. On Windows this is `%APPDATA%\OpenCat`; on macOS this is
`~/Library/Application Support/OpenCat`.

- `workspace` - default Web chat working directory.
- `skills` - user-level custom Skills shared across projects.
- `workspace/.opencat/skills` - project-level custom Skills for the installed default workspace.
- `projects` - transcript and project-scoped CLI state.
- `webui/sessions.json` - Web chat session list.

The launcher starts `opencat web` with `--cwd <config-dir>/workspace` and sets
`OPENCAT_CONFIG_DIR=<config-dir>`, so sessions and custom Skills survive
restarts and runtime upgrades.

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
`/api/system/download_center/check_update/?product_key=opencat&current_version=<version>&platform=<platform>&channel=stable`,
where `<platform>` is `windows` for Windows builds and `macos` for macOS builds.
When a newer version is available, the launcher shows the installer name, size,
and release notes, then downloads the installer only after user confirmation.
Downloads are written to `<config-dir>/downloads` through a `.part` file and are
SHA256-verified when the update response includes a checksum.

The launcher never replaces the running app automatically. After download, run
the downloaded `OpenCat_Setup` installer or DMG manually to complete the update.
