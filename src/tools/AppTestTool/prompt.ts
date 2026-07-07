export function getAppTestPrompt(): string {
  return `
Use this tool to run Android App or Web UI tests with Midscene.

Use AppTest when the user asks to:
- test an Android app
- test a web page
- run app UI steps
- run web UI steps
- verify login, settings, navigation, or visible UI behavior
- collect screenshots, trace, report, and assertion evidence

For structured test cases, batches, execution_plan.json, route_memory.json, or
step-by-step repair loops, prefer the low-level session tools:
- opencat_midscene_start
- opencat_midscene_observe
- opencat_midscene_action
- opencat_midscene_ai_act
- opencat_midscene_assert
- opencat_android_adb
- opencat_midscene_finish

Use AppTest itself for simple one-shot goals or as a fallback when the user only
needs a single high-level attempt. The low-level tools are the default for
structured tap/type/swipe/back/wait/open_url execution because they let you
observe, act, assert, repair, and persist route memory between steps.

Use platform="android" for Android app tests.
Use platform="web" for web page tests.

Prefer natural-language test_goal/test_steps for normal testing.
Use action_steps only when the user explicitly provides deterministic low-level steps or when prior attempts need repair.
When execution_plan_path, route_memory_path, reflection_report_path, or
execution_report_path are available, pass them to opencat_midscene_start and
finish with opencat_midscene_finish so the artifacts are merged by the tool.

Post-run reporting:
- AppTest returns its own message, screenshots, trace_path, and report_path. Use those fields when summarizing results.
- You may create or update reflection_report.json, execution_report.json, or other report files when useful or when the user asks.
- Before updating an existing report file, call Read on that exact file path first, then use Write/Edit.
- For new reports, prefer a new timestamped filename when overwriting an existing report is not required.

Safety:
- Do not perform payment, purchase, transfer, deletion, production submission, account cancellation, or authorization-login confirmation unless the user explicitly approves.
- Stop before high-risk operations.
- Use mock_mode for dry-run validation when no device or browser is available.
`.trim()
}
