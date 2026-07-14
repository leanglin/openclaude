# App And Web UI Testing

OpenCat includes an `AppTest` tool for Android App and Web UI testing through a local Midscene sidecar. The tool exposes one high-level entry point to the model while keeping low-level actions such as observe, tap, type, swipe, back, wait, launch_app, open_url, and assert inside `packages/app-test-runner`.

## Install And Build

Install and build the sidecar:

```bash
npm.cmd --prefix packages/app-test-runner install
npm.cmd --prefix packages/app-test-runner run build
```

The root package also keeps Midscene and Playwright runtime dependencies so packaged installs can resolve `@midscene/android`, `@midscene/web`, `playwright`, and related packages.

## Android App Tests

Android tests require ADB and a real device or emulator:

```bash
adb version
adb devices
```

Useful environment variables:

```bash
export ADB_PATH=/path/to/adb
export OPENCAT_ADB_PATH=/path/to/adb
export ANDROID_HOME=/path/to/android/sdk
export ANDROID_SDK_ROOT=/path/to/android/sdk
export MIDSCENE_MODEL_NAME=your-vision-model
export MIDSCENE_MODEL_BASE_URL=https://your-openai-compatible-host/v1
export MIDSCENE_MODEL_API_KEY=your-key
export MIDSCENE_MODEL_FAMILY=doubao-vision
```

In OpenCat Web, the same Midscene model settings can be saved from the
Providers panel under `Midscene App Test`. The Web UI stores them as
`MIDSCENE_MODEL_*` variables and injects them into new local CLI child
processes used by `AppTest`.

Example AppTest input:

```json
{
  "platform": "android",
  "app_package": "com.example.demo",
  "test_goal": "Open the app and verify that the home page is visible.",
  "assertions": ["Home"],
  "execution_mode": "midscene_ai"
}
```

Structured Android steps are also supported:

```json
{
  "platform": "android",
  "app_package": "com.example.demo",
  "test_goal": "Verify the phone login entry.",
  "execution_mode": "codex_guided",
  "action_steps": [
    { "action": "tap", "target": { "text": "Phone login" } },
    { "action": "type", "target": { "resource_id": "phone_input" }, "value": "13800000000" },
    { "action": "back" }
  ],
  "assertions": ["Home"]
}
```

The Android sidecar retains ADB screenshot fallback, uiautomator dump fallback, text input fallbacks, current activity checks, logcat summaries, and popup guard behavior.

## Web UI Tests

Web tests use Playwright Chromium and `@midscene/web`.

Install Chromium when it is not bundled by an installer:

```bash
npx playwright install chromium
```

Example AppTest input:

```json
{
  "platform": "web",
  "start_url": "https://example.com",
  "test_goal": "Open the page and verify that Example Domain appears.",
  "assertions": ["Example Domain"],
  "execution_mode": "midscene_ai"
}
```

Structured Web steps are supported:

```json
{
  "platform": "web",
  "start_url": "https://example.com",
  "test_goal": "Click the More information link.",
  "execution_mode": "codex_guided",
  "action_steps": [
    { "action": "tap", "target": { "text": "More information" } }
  ],
  "assertions": ["iana.org"]
}
```

The Web sidecar keeps Playwright screenshots, visible text extraction, accessibility snapshot fallback, HTML content fallback, `open_url`, `tap`, `type`, `back`, `wait`, and assertion support.

## Mock Validation

Mock mode does not require ADB or Chromium.

```bash
npm.cmd run app-test:mock:android
npm.cmd run app-test:mock:web
```

Equivalent direct commands:

```bash
node -e "process.stdout.write(JSON.stringify({job_id:'mock-android-1',platform:'android',mock_mode:true,slots:{mock_mode:true,app_package:'com.example.demo',test_goal:'mock android test',assertions:['mock Midscene screen']}}))" | node packages/app-test-runner/dist/cli.js run-test
node -e "process.stdout.write(JSON.stringify({job_id:'mock-web-1',platform:'web',mock_mode:true,slots:{mock_mode:true,start_url:'https://example.com',test_goal:'mock web test',assertions:['mock Midscene screen']}}))" | node packages/app-test-runner/dist/cli.js run-test
```

Both commands should return a final JSONL `result` with `success: true`.

## Artifacts

AppTest returns:

- success or failure message
- platform and execution mode
- JSONL events
- screenshot metadata
- assertion results
- trace path
- report path

Midscene reports are saved as standalone HTML files with inline screenshots so they can be opened directly with `file://`. `MIDSCENE_REPORT_MAX_BYTES` remains available as a large-report warning threshold and defaults to 50 MiB. Reports above the threshold are still written in full and emit a `visual_report_generation_large` event; large files may take longer to open and use more browser memory. A lightweight diagnostic page is written only when report generation fails.

Large event payloads are truncated before returning to the model. Fields with names such as `password`, `secret`, `token`, `api_key`, `access_key`, `authorization`, or `cookie` are redacted.

## Packaged Installs

The OpenCat installer includes:

- `packages/app-test-runner/dist/`
- `packages/app-test-runner/package.json`
- this document
- bundled Playwright Chromium under the installer runtime resources

Runtime dependencies for Midscene and Playwright are kept in the root `dependencies` so the packaged CLI can resolve them. The installer sets `PLAYWRIGHT_BROWSERS_PATH` to the bundled browser cache. Source checkouts may still need:

```bash
npx playwright install chromium
```

## Common Errors

`OpenCat AppTest runner is not built or not included in this installation.`

Build the runner:

```bash
npm.cmd --prefix packages/app-test-runner install
npm.cmd --prefix packages/app-test-runner run build
```

`adb not found` or `no devices`

Check `ADB_PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `adb devices`.

`invalid app_package`

Use a valid Android package name and confirm the app is installed on the device.

`Chromium is not installed.`

Run:

```bash
npx playwright install chromium
```

`start_url missing`

Provide `start_url` for non-mock Web tests unless the first structured action opens a URL.

`permission popup blocked`

Unlock the device, bring the target app forward, and rerun. The Android sidecar can allow common permission popups but blocks or skips high-risk surfaces.

`high risk operation blocked`

Requests involving payment, purchase, deletion, transfer, production submission, account cancellation, or authorization-login confirmation are blocked when `risk_mode` is `block` and otherwise require explicit confirmation.
