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
