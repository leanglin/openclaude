---
name: function-testing
description: 当前工作区的功能测试执行 Skill。用于读取结构化 APP/Web 测试用例，通过 AppTest 和低层 Midscene session 工具真实执行，并让 execution_plan、route_memory、reflection_report、execution_report 作为实际执行输入和输出生效。
---

# 功能测试执行

本 Skill 执行结构化 APP/Web 测试用例。它不生成用例，也不伪造通过/失败结果。

主要输入：

- 根字段为 `test_cases` 的 `test_cases.json`。
- 可选的已审核用例文件，但根结构必须相同。
- 可选的历史 `execution_plan.json`、`route_memory.json`、`reflection_report.json` 和 `execution_report.json`。

主要输出：

- `execution_plan.json`
- `route_memory.json`
- `reflection_report.json`
- `execution_report.json`
- 真实 AppTest trace、report、截图、断言和工具事件证据

## 用例读取

执行前必须读取真实用例 JSON。不得只根据摘要执行。

支持的根结构：

```json
{
  "test_cases": [
    {
      "case_id": "TC-001",
      "title": "",
      "tool": "visual_app_test",
      "test_objective": "",
      "steps": [],
      "action_steps": [],
      "expected_result": "",
      "assertions": [],
      "parameter_overrides": {
        "test_goal": "",
        "test_steps": [],
        "action_steps": [],
        "expected_result": "",
        "assertions": [],
        "navigation_route": []
      }
    }
  ]
}
```

每条可执行用例必须满足：

- `case_id` 存在。
- `test_objective` 或 `parameter_overrides.test_goal` 中存在测试目标。
- 顶层 `action_steps` 和 `parameter_overrides.action_steps` 中存在可执行步骤。
- 如果两个 action-step 字段同时存在，内容必须完全一致。
- 断言必须能通过 UI 状态、截图、trace、report、ADB 输出或工具事件观察。

如果环境、账号、app package、start URL、设备、权限或数据缺失导致用例无法执行，应标记 blocked 或向用户询问。不得模拟执行。

## 执行规划

执行批次前先创建或读取 `execution_plan.json`。

规划时考虑：

- 总用例数；
- 平台类型（`android` 或 `web`）；
- app package 或 start URL；
- 设备或浏览器目标；
- 可共享导航路径；
- 必须隔离的状态变更用例；
- 可安全复用路径的用例；
- 前置检查；
- 重试上限；
- 已知路径图谱缺口；
- 需要用户明确批准的高风险动作。

`execution_plan.json` 建议包含：

```json
{
  "total_cases": 0,
  "preflight_checks": [],
  "batches": [],
  "route_memory_seed": {},
  "execution_risks": [],
  "optimization_summary": {}
}
```

## 路径记忆

`route_memory.json` 是执行辅助输入，不是装饰性报告。

用于记录：

- 当前页面或 URL；
- 成功路径；
- 失败路径；
- 页面别名；
- 稳定和不稳定动作；
- 截图、trace 和 report 引用；
- 用例和批次结果。

后续用例如果入口、权限、状态和目标页面一致，应复用成功路径。失败路径应避开，除非反思结果给出明确调整，例如更换数据、定位方式或入口。

## 工具使用

结构化用例、批量执行、路径记忆或修复循环，优先使用当前 AppTest 低层 session 工具：

```text
opencat_midscene_start
opencat_midscene_observe
opencat_midscene_action
opencat_midscene_ai_act
opencat_midscene_assert
opencat_android_adb
opencat_midscene_finish
```

这些是当前项目 AppTest 实现中真实注册的工具名。`AppTest` 本身只用于简单单目标执行，或低层 session 不可用时的 fallback。

启动低层 session 时，只要路径可用，就必须传入：

```json
{
  "execution_plan_path": "execution_plan.json",
  "route_memory_path": "route_memory.json",
  "reflection_report_path": "reflection_report.json",
  "execution_report_path": "execution_report.json"
}
```

runner 会读取这些文件，并注入 `visual_execution_memory`、`route_reuse`、`current_page_reuse`、`shared_navigation_steps` 和 `case_specific_steps`。后续 observe、action/aiAct/assert/ADB、finish 必须沿用同一个 session，让工具合并路径记忆、反思事件和执行报告。

## 批次执行

只有当路径、状态、账号、设备、权限和目标页面兼容时，才允许批量执行。

以下情况不得合并批次：

- 破坏性或不可逆动作；
- 账号、权限、设备或网络状态切换；
- 会修改共享配置的用例；
- 需要重新登录、重置或重启 APP 的用例；
- 页面偏离或工具失败后尚未恢复的用例。

批次流程：

1. 启动或恢复低层 session。
2. observe 当前页面或 URL。
3. 当路径记忆证明安全时，复用当前位置。
4. 按 `execution_plan.json` 中的共享步骤导航。
5. 执行每条用例的专属动作。
6. 每条用例独立断言。
7. 逐条记录证据和状态。
8. 每条用例和每个批次后更新路径记忆。
9. finish session 并合并产物。

## 反思

失败、阻塞、批次部分失败、页面偏离、断言失败、工具异常、环境问题或重复重试后，必须生成或更新 `reflection_report.json`。

反思必须影响后续执行，而不是只写报告。它应当：

- 避开连续失败的路径；
- 复用已成功的路径；
- 发现状态污染时调整批次分组；
- 元素找不到时改用替代定位或动作；
- 达到重试上限后停止重复修复；
- 把环境、账号、权限或数据缺口标记为 blocked；
- 区分产品失败和用例定义失败。

当低层工具返回 `visual_path_memory_delta`、`visual_step_replan`、`visual_step_repair` 或 `artifact_warnings` 时，必须把结果应用到下一条用例或下一批次。不得只把它们写进报告。

## 证据与报告

每个 passed、failed、blocked 或 skipped 结论都必须有真实工具证据支撑：

- AppTest message、events、trace path、report path、截图或断言结果；
- Midscene observe/action/assert 事件；
- 安全 ADB 输出；
- 明确的工具错误或输入校验信息。

不得根据用例文本本身判断通过。

`execution_report.json` 建议包含：

```json
{
  "execution_summary": {
    "total_cases": 0,
    "passed": 0,
    "failed": 0,
    "blocked": 0,
    "skipped": 0
  },
  "executed_cases": [],
  "execution_plan_ref": {},
  "route_memory_ref": {},
  "reflection_report_ref": {},
  "evidence_refs": []
}
```

时间字段必须是实际 ISO-8601 字符串。不得写模板表达式、伪代码占位或猜测时间。

## 阻塞规则

以下情况应 blocked，而不是 failed：

- 没有可解析的 `test_cases.json`；
- 目标 app package、start URL、设备、账号、权限或环境缺失；
- 必需工具不可用；
- 用例没有可执行步骤或可观察断言；
- 用户尚未批准高风险动作。

只有环境就绪、用例可执行，且产品行为或断言真实失败时，才标记 failed。

## 结束门禁

结束前必须确认：

- 已执行用例数量与目标范围一致，或 blocked 用例解释了缺口。
- 每条已执行用例都有独立状态和证据。
- `opencat_midscene_finish` 或 `AppTest` 返回了真实 trace/report/screenshot/event 数据。
- `execution_plan.json`、`route_memory.json`、`reflection_report.json` 和 `execution_report.json` 反映真实执行过程。
- 失败或可复用路径出现后，反思和路径记忆确实影响了后续动作。
- 没有用纯 Markdown 报告替代执行证据。
