---
name: function-testing
description: 功能测试执行专家。负责在 OpenCat routeB / CrewAI Native Task Flow 中读取结构化测试用例，基于 APP/Web 视觉执行工具完成真实功能验证，并输出 execution_plan、route_memory、reflection_report 和 execution_report 等可追溯产物。
user-invocable: true
triggers:
  - function testing
  - app test execution
  - web test execution
  - visual app test
  - visual web test
  - 功能测试执行
  - APP测试执行
  - Web测试执行
  - 视觉执行
allowed-tools:
  - get_current_task_context
  - list_run_resources
  - get_resource_manifest
  - read_resource
  - search_resource
  - read_resource_chunk
  - read_file
  - save_artifact
  - register_artifact
  - finish_task
  - request_user_input
  - run_visual_task
  - opencat_midscene_start
  - opencat_midscene_observe
  - opencat_midscene_action
  - opencat_midscene_ai_act
  - opencat_midscene_assert
  - opencat_android_adb
  - opencat_midscene_finish
---

# 功能测试执行 Skill（routeB 优化版）

## 1. 功能定位

本 Skill 用于 APP/Web 功能测试执行角色。它不是用例生成 Skill，也不是报告美化 Skill；它的核心职责是：

1. 从 routeB 上下文、RunResourceRegistry、上游 artifact 或 Task.context 中找到结构化测试用例。
2. 基于 `test_cases.json` 中的 `action_steps`、`parameter_overrides.action_steps`、`navigation_route`、`assertions`、`expected_result` 等字段执行真实 APP/Web 测试。
3. 在执行前进行前向反思，生成或读取 `execution_plan.json`。
4. 对同路径、同页面、同前置条件的用例进行批次化执行，减少重复导航。
5. 维护 `route_memory.json`，记录成功路径、失败路径、当前页面、稳定动作和执行证据。
6. 在每条用例或每个批次后进行执行反思，输出 `reflection_report.json`。
7. 保存并登记真实执行报告、截图、trace、日志等证据产物。
8. 使用 `finish_task` 交付结构化结果；不得只输出模拟性 Markdown 报告。

---

## 2. routeB 资源访问优先级

本 Skill 在 routeB 中执行时，必须优先使用 run 级资源工具，而不是直接猜测本地路径。

### 2.1 必须先读取当前任务上下文

执行开始前必须调用：

```text
get_current_task_context
```

并检查：

```text
previous_outputs
upstream_artifact_manifest
run_resource_manifest
artifact_refs
result
structured_extract
crewai_task_output
task description
role/capability_tags
```

### 2.2 查找可执行用例的优先级

按以下顺序查找测试用例：

1. `RunResourceRegistry` 中 `artifact_type=test_case_artifact` 或名称为 `test_cases.json` 的资源。
2. 上游用例审核角色输出的 approved/reviewed case artifact。
3. 上游用例生成角色输出的 generated case artifact。
4. `Task.context` 中明确包含的 `test_cases` 数组。
5. 兼容字段：`approved_test_cases`、`source_test_case`、`parameter_overrides`、`contract_output.content.test_cases`。

如果存在多个用例 artifact：

- 优先使用审核通过的用例；
- 没有审核产物时使用生成产物；
- 不得只根据上游摘要执行；
- 必须读取真实 `test_cases.json` 或等价结构化用例内容。

### 2.3 资源读取规则

优先使用：

```text
list_run_resources
read_resource
search_resource
read_resource_chunk
```

仅当资源工具不可用、且 Boss/routeB 明确提供安全文本路径时，才允许使用 `read_file` 兼容读取。

禁止：

- 猜测 `.opencat/kernel_attachments/...` 路径。
- 直接读取未授权路径。
- 把 docx/pdf/xlsx/pptx 当普通 UTF-8 文本读。
- 从“Uploaded document preview index only”或摘要索引中推断测试步骤。
- 仅凭自然语言总结生成通过/失败结论。

---

## 3. 支持的测试用例格式

当前 Skill 支持的主格式是纯 JSON：

```json
{
  "test_cases": [
    {
      "case_id": "TC-001",
      "title": "string",
      "tool": "visual_app_test",
      "test_objective": "string",
      "steps": ["string"],
      "action_steps": [],
      "expected_result": "string",
      "assertions": ["string"],
      "parameter_overrides": {
        "test_goal": "string",
        "test_steps": ["string"],
        "action_steps": [],
        "expected_result": "string",
        "openclaw_test_instruction": "string",
        "navigation_route": []
      },
      "priority": "P0|P1|P2",
      "risk_tags": []
    }
  ]
}
```

### 3.1 action_steps 一致性校验

每条用例必须消费：

```text
顶层 action_steps
或 parameter_overrides.action_steps
```

如果两者都存在但不一致，必须阻塞当前用例，并记录原因：

```text
action_steps_mismatch
```

不要自行猜测以哪个为准。

### 3.2 可执行性校验

用例缺少以下内容时，不能模拟执行：

- `case_id`
- `test_objective` 或 `parameter_overrides.test_goal`
- 可执行 steps/action_steps
- 可验证 expected_result/assertions
- APP/Web 执行目标或环境信息

如果缺失信息会导致无法执行，应调用 `request_user_input` 或将对应 case 标记为 blocked。

---

## 4. 执行前反思与 execution_plan

APP/Web 执行前必须先生成或读取执行计划。

### 4.1 前向反思目标

执行前必须分析：

1. 总用例数。
2. 每条用例的目标页面。
3. 每条用例的导航路径。
4. 哪些用例具有相同路径或相同目标页。
5. 哪些用例会改变状态，不能合并。
6. 哪些用例需要前置检查。
7. 哪些环境/账号/设备状态可能导致阻塞。
8. 是否存在路径图谱缺失或目标页面未匹配。
9. 是否需要先启动 APP/Web 会话。
10. 是否需要请求用户补充设备、账号、权限或环境信息。

### 4.2 execution_plan.json

必须生成或读取 `execution_plan.json`，结构建议：

```json
{
  "plan_id": "exec-plan-001",
  "total_cases": 0,
  "preflight_checks": [],
  "batches": [
    {
      "batch_id": "BATCH-001",
      "batch_type": "shared_route",
      "target_page": "目标页面",
      "shared_route": {
        "pages": ["首页", "设备列表页", "直播页"],
        "action_steps": [],
        "confidence": "high|medium|low"
      },
      "case_ids": ["TC-001", "TC-002"],
      "shared_navigation_steps": [],
      "case_specific_steps": {},
      "risks": [],
      "retry_policy": {}
    }
  ],
  "route_memory_seed": {},
  "execution_risks": [],
  "optimization_summary": {
    "batch_count": 0,
    "shared_route_case_count": 0,
    "estimated_navigation_steps_saved": 0
  }
}
```

### 4.3 execution_plan 保存要求

生成后必须使用：

```text
save_artifact
```

保存为：

```text
execution_plan.json
```

并在 metadata 中标记：

```text
artifact_type=execution_plan
name=execution_plan.json
read_hint=APP/Web 执行计划，包含同路径合并、批次分组、前置检查和风险
```

如果平台已有执行规划模块生成了 execution_plan，可直接读取并校验，不重复生成。

---

## 5. 同路径合并与批次执行

### 5.1 核心原则

本 Skill 采用：

```text
逻辑隔离 + 物理路径可复用
```

而不是每条用例都强制重新从首页导航。

含义：

- 每条用例的结果、断言、证据必须独立记录；
- 但多条用例如果有相同前置路径、相同目标页、相同执行环境，允许共享一次导航；
- 共享导航不能导致用例之间状态污染；
- 状态会被改变的用例必须单独处理或排在批次末尾。

### 5.2 可以合并的用例

以下场景允许同 batch 执行：

- 同一导航路径；
- 同一目标页面；
- 同一配置页下多个配置项只读校验；
- 同一入口下多个 UI 状态验证；
- 同一页面上多个不会互相影响的断言；
- 只读/查看/展示类用例。

### 5.3 不允许合并的用例

以下用例必须拆分或强制重置：

- 删除、提交、保存、关闭、解绑等不可逆或强状态变更操作；
- 切换账号、权限、设备能力集、网络状态；
- 修改全局配置后会影响后续用例；
- 依赖清空数据、重新登录、重启 APP；
- 目标页面相同但前置状态冲突；
- 前一条用例出现页面偏离、工具异常、断言异常且未恢复。

### 5.4 Batch 执行流程

每个 batch 执行顺序：

1. 检查 route_memory 中是否已经位于目标页或共享路径中间页。
2. 如当前页面可复用，跳过已完成的导航前缀。
3. 如当前页面不可复用，按 shared_navigation_steps 导航。
4. 每进入一个页面，调用 `opencat_midscene_observe` 校验。
5. 按 case_id 逐条执行 case_specific_steps。
6. 每条用例单独执行断言。
7. 每条用例单独记录截图、trace、assert 结果和状态。
8. batch 完成后执行反思并更新 route_memory。

---

## 6. 路径记忆 route_memory

### 6.1 route_memory 目标

`route_memory.json` 用于记录当前执行 run 内的页面路径经验：

- 当前页面；
- 成功路径；
- 失败路径；
- 页面别名；
- 稳定动作；
- 不稳定动作；
- 最近截图/trace；
- 每条用例执行结果；
- 每个 batch 执行结果。

### 6.2 route_memory 建议结构

```json
{
  "current_page": "",
  "successful_routes": [],
  "failed_routes": [],
  "page_aliases": {},
  "stable_actions": [],
  "unstable_actions": [],
  "last_screenshot_artifact": {},
  "last_trace_artifact": {},
  "case_results": {},
  "batch_results": {}
}
```

### 6.3 何时更新

以下情况必须更新 route_memory：

- 成功启动 APP/Web；
- 成功识别当前页面；
- 成功完成导航步骤；
- 成功到达目标页面；
- 执行断言通过；
- 页面偏离；
- 元素找不到；
- 导航失败；
- 工具失败；
- batch 结束；
- case 结束。

### 6.4 保存要求

每个 batch 后必须保存最新 `route_memory.json`。

metadata：

```text
artifact_type=route_memory
name=route_memory.json
read_hint=APP/Web 执行路径记忆，供后续 batch、排障和报告生成使用
```

---

## 7. 页面识别与偏离纠正

保留原页面识别与偏离纠正机制，但要结合 route_memory 和 execution_plan 使用。

### 7.1 用例/批次开始前页面识别

每个 batch 开始前：

1. 调用 `opencat_midscene_observe` 或 ADB 检查当前页面。
2. 如果当前页面与 batch 目标路径中的某一页面一致，复用当前位置。
3. 如果不一致，按 execution_plan 的 shared_navigation_steps 导航。
4. 如果无法判断当前页，优先回到首页或启动页，再执行完整路径。

### 7.2 执行中偏离

操作过程中发现当前页面与预期页面不一致时：

1. 停止当前 case 的后续操作；
2. 保存截图/observe 结果；
3. 更新 route_memory.failed_routes；
4. 判断是否能恢复到目标页；
5. 可恢复则执行 recovery navigation；
6. 不可恢复则标记当前 case blocked/failed，并按反思策略处理后续 case。

### 7.3 偏离纠正策略

优先级：

1. 使用 route_memory 中已成功路径恢复；
2. 使用 execution_plan 的 shared route 恢复；
3. 使用路径图谱恢复；
4. ADB 重启 APP 后从首页恢复；
5. 无法恢复时 request_user_input 或 blocked。

禁止：

- 无限制反复点击返回；
- 在错误页面盲目点击；
- 不保存证据直接继续执行；
- 页面偏离后仍标记用例 passed。

---

## 8. 路径规划优先级

需要导航到目标页面时，按以下优先级：

1. route_memory 中已经验证成功的路径；
2. execution_plan 中的 shared_navigation_steps；
3. 用例 `parameter_overrides.navigation_route`；
4. `action_steps` 中 `navigation_step=true` 的步骤；
5. RunResourceRegistry 中路径图谱资源；
6. Midscene 自主探索。

如果使用自主探索：

- 必须在 route_memory 中记录 `path_map_match_status=unmatched`；
- 成功后记录新路径；
- 失败后记录失败路径；
- 报告中提示可补充路径图谱。

---

## 9. APP 启动与工具使用

### 9.1 APP 启动

APP 测试推荐：

1. 使用 `opencat_android_adb` 检查当前 APP 状态；
2. 如不在目标 APP，使用 ADB 启动；
3. ADB 启动失败时，使用 Midscene 启动/唤起；
4. 启动后调用 `opencat_midscene_observe` 确认首页或当前页面。

常用包名如果上下文未提供，不得硬编码为唯一值；可以将 `com.cmri.universalapp` 作为已知移动爱家默认值，但优先使用任务参数、用例参数或环境配置中的 app package。

### 9.2 Midscene low-level 工具优先

APP/Web 执行中，优先使用低层工具：

```text
opencat_midscene_start
opencat_midscene_observe
opencat_midscene_action
opencat_midscene_ai_act
opencat_midscene_assert
opencat_android_adb
opencat_midscene_finish
```

这些 low-level Midscene 名称是 OpenCat/Codex 内置可调用工具，不是文档占位。结构化用例、批次执行、路径记忆、逐步反思和纠偏必须默认走这组工具闭环；高层 `AppTest` / `run_visual_task` 只用于简单单目标执行或低层工具不可用时的 fallback。

### 9.3 run_visual_task 使用场景

`run_visual_task` 可用于：

- 单条用例；
- 不需要跨用例共享路径；
- low-level Midscene 工具不可用；
- 执行器内部已支持完整执行计划。

但如果执行同路径合并、路径记忆、逐步反思，应优先使用 low-level tools。

---

## 10. 弹窗、重试与恢复

### 10.1 弹窗处理

每次关键点击前：

- observe 当前页面；
- 检查是否存在弹窗、权限弹窗、升级提示、广告遮挡；
- 可关闭的弹窗先关闭；
- 不可关闭或影响测试目标时记录 blocker。

### 10.2 重试次数

默认：

```text
单个动作最多重试 2 次
单条 case 最多重试 1 次
同一路径失败最多 2 次
```

超过后必须进入反思，不得无限循环。

### 10.3 恢复策略

恢复优先级：

1. 当前页局部恢复；
2. 返回目标页上一级；
3. 使用 route_memory 成功路径；
4. 使用 execution_plan 路径；
5. ADB 重启 APP；
6. request_user_input 或 blocked。

---

## 11. 执行后反思 reflection

### 11.1 反思触发

以下场景必须生成反思：

- case failed；
- case blocked；
- batch partial/failed；
- 页面偏离；
- 路径失败；
- 断言失败；
- 工具异常；
- APP/Web 环境不可用；
- 需要跳过后续用例。

### 11.2 reflection_report.json

结构建议：

```json
{
  "reflections": [
    {
      "batch_id": "BATCH-001",
      "case_id": "TC-001",
      "status": "failed",
      "failure_type": "navigation|assertion|environment|data|permission|tool|case_issue|unknown",
      "root_cause_summary": "失败原因摘要",
      "evidence_refs": [],
      "route_memory_updates": {},
      "plan_adjustments": [],
      "retry_recommendation": "none|retry_same_route|retry_alternative_route|request_user_input|skip_case"
    }
  ]
}
```

### 11.3 反思结论使用

反思结果必须真实影响后续执行：

- 同一路径连续失败，避免继续使用；
- 设备离线/账号无权限，相关用例标记 blocked；
- 断言失败但路径成功，后续同路径用例可以继续；
- 页面元素找不到，可尝试备用定位一次；
- 明显用例问题，标记 case_issue，不要继续重复执行。

---

## 12. 执行结果与证据

### 12.1 完成判定

任务完成必须包含真实执行证据。

满足以下任一条件：

1. `run_visual_task` 成功执行并返回 trace/report/screenshot/step evidence；
2. 完成 low-level sequence：
   - `opencat_midscene_start`
   - 至少一次 `opencat_midscene_action` / `opencat_midscene_ai_act` / `opencat_midscene_assert` / `opencat_android_adb`
   - `opencat_midscene_finish`
   - 有 trace/report/screenshot/tool evidence

不得仅输出：

```text
“测试已通过”
“根据用例判断通过”
“模拟执行结果”
```

### 12.2 每条用例结果

每条用例必须记录：

```json
{
  "case_id": "TC-001",
  "title": "用例标题",
  "status": "passed|failed|blocked|skipped",
  "batch_id": "BATCH-001",
  "steps_executed": [],
  "assertions": [],
  "evidence_refs": [],
  "failure_type": "",
  "failure_reason": "",
  "retry_count": 0
}
```

### 12.3 execution_report

必须保存：

```text
execution_report.json
```

建议同时保存：

```text
execution_report.md
```

metadata：

```text
artifact_type=execution_report
name=execution_report.json
read_hint=APP/Web 功能测试执行结果，包含每条用例状态、证据和失败原因
```

---

## 13. 产物交付要求

执行类任务结束前必须保存或登记以下产物：

1. `execution_plan.json`
2. `route_memory.json`
3. `reflection_report.json`
4. `execution_report.json` 或 `execution_report.md`
5. Midscene trace/report/screenshot/log 等真实执行证据

使用：

```text
save_artifact
register_artifact
finish_task
```

`finish_task.structured_extract` 至少包含：

```json
{
  "upstream_consumption": {
    "consumed_task_ids": [],
    "consumed_resource_ids": [],
    "consumed_artifacts": [],
    "skipped_artifacts": [],
    "parse_errors": []
  },
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
  "execution_report_ref": {},
  "evidence_refs": []
}
```

---

## 14. 失败与阻塞处理

### 14.1 应 blocked 的情况

以下情况应 blocked，不应 failed：

- 找不到测试用例 artifact；
- `test_cases.json` 无法解析；
- 缺少 app package / start URL / 目标设备 / 执行环境；
- Midscene / ADB 不可用；
- 用户必须补充账号、设备、权限、环境；
- 高风险操作未授权；
- 用例缺少可执行步骤。

### 14.2 应 failed 的情况

以下情况可 failed：

- 执行环境正常，但操作失败；
- 页面到达正常，但断言不满足；
- APP 崩溃或目标功能异常；
- 工具执行返回明确失败且重试后仍失败。

### 14.3 request_user_input

当缺失信息必须由用户补充时，必须调用：

```text
request_user_input
```

不得只在最终文本中写“请补充”。

---

## 15. 兼容旧模式

如果 routeB 执行优化器尚未启用：

- 仍可按单条用例顺序执行；
- 但必须保留真实工具执行证据；
- 仍要保存 execution_report；
- 如果能生成简单 route_memory，也应保存；
- 不得强制把每条用例都从首页重新执行，除非页面状态无法复用或配置要求严格隔离。

旧的“每条用例全新独立”规则降级为 fallback：

```text
仅在 execution_plan 缺失、route_memory 不可用、用例存在状态冲突、或页面偏离无法恢复时启用硬隔离。
```

---

## 16. 禁止事项

禁止：

1. 不读真实用例 artifact，仅凭摘要执行。
2. 不调用执行工具，直接生成通过/失败报告。
3. 用 Markdown 报告替代真实执行证据。
4. 把多个用例合并后丢失每条用例的独立结果。
5. 状态冲突用例强行合并。
6. 无限重试或循环点击。
7. 直接猜测未授权路径。
8. 读取 docx/pdf/xlsx 原始二进制内容。
9. 页面偏离后继续执行后续断言。
10. 在 routeB 优化模式下强制每条用例都从首页重新导航。

---

## 17. 简化执行流程

### 17.1 标准 routeB APP/Web 执行流程

1. `get_current_task_context`
2. `list_run_resources`
3. 找到 `test_cases.json`
4. `read_resource` 读取用例
5. 校验用例结构
6. 生成或读取 `execution_plan.json`
7. 保存 `execution_plan.json`
8. 初始化 `route_memory.json`
9. `opencat_midscene_start`
10. 按 batch 执行共享导航
11. 逐条执行 case-specific 操作和断言
12. 每条 case 记录证据
13. 每个 batch 后更新 `route_memory.json`
14. 失败/阻塞时生成 reflection
15. 保存 `reflection_report.json`
16. `opencat_midscene_finish`
17. 保存 `execution_report.json/md`
18. `finish_task`

### 17.2 单条用例 fallback 流程

1. 找到并读取单条 case；
2. 启动 APP/Web；
3. observe 当前页面；
4. 根据用例路径或图谱导航；
5. 执行业务动作；
6. 执行断言；
7. 保存证据；
8. 输出 execution_report；
9. finish_task。

---

## 18. 输出风格

对话层只简要说明执行状态和产物路径。

不要在对话层粘贴完整 execution_report、route_memory 或 test_cases。

完整结果必须通过 artifact 交付。
