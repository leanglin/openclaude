---
name: testcase-review
description: 用例审核子智能体的纯 JSON 用例审核 Skill。适用于 test_case_review_claw 消费上游 test_cases.json、需求理解蓝图、业务规则、路径图谱和授权资源，对测试用例进行目标保真、覆盖率、可执行性、断言和风险审核，并输出不破坏下游执行读取的纯 JSON 用例产物。
user-invocable: true
triggers:
  - testcase review
  - case review
  - coverage review
  - risk review
  - approved_test_cases
  - reviewed test cases
  - 用例审核
  - 用例审查
  - 覆盖率审核
  - 风险审核
  - 目标锚点保真
  - 执行可行性审核
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
---

# 用例审核 Skill（纯 JSON 交付版）

## 1. 功能定位

本 Skill 用于 `test_case_review_claw` 对上游结构化测试用例进行审核、轻量安全修订和执行可行性判断。

本 Skill 只做：

1. 审核上游 `test_cases.json` 或等价结构化用例产物。
2. 保留并校验用例生成 Skill 产出的所有执行必需字段。
3. 对可安全修复的小问题进行原 payload 级修订。
4. 将审核通过的完整用例保存为纯 JSON 用例产物。
5. 另行保存审核报告，记录拒绝、阻塞、覆盖缺口和修订建议。

本 Skill 不做：

1. 不执行 APP/Web 测试。
2. 不重新生成新的业务用例集合。
3. 不改变已有 `case_id`。
4. 不压缩为 case_id 列表。
5. 不把审核结果写成平台外层包装。
6. 不在下游执行需要读取的用例 JSON 里写 `status`、`result`、`contract_output`、`approved_test_cases` 等平台外层字段。

---

## 2. 最终用例产物硬要求

审核后的主交付产物必须是纯 JSON 文件，推荐命名为：

```text
approved_test_cases.json
```

但文件内容必须保持与用例生成 Skill 一致的根结构：

```json
{
  "test_cases": []
}
```

严禁在该文件中输出以下平台外层字段：

```text
task_id
status
summary
assistant_reply
result
diagnostics
contract_output
approved_test_cases
rejected_cases
revision_suggestions
coverage_report
review_diagnostics
anchor_audit
case_id_audit
execution_readiness_report
used_skills
used_workspace_files
source_asset_ids
active_skill_ids
workspace 绝对路径
```

说明：

- `approved_test_cases.json` 的文件名可以表示“已审核通过”，但 JSON 根字段必须仍为 `test_cases`。
- 下游执行 Skill 读取该文件时，应像读取用例生成产物一样读取 `root.test_cases`。
- 审核报告、拒绝列表、修订建议、覆盖诊断必须写入独立文件 `case_review_report.json`，不得混入主用例 JSON 文件。

---

## 3. 为什么必须保持 `test_cases` 根结构

用例生成 Skill 的纯 JSON 产物结构是：

```json
{
  "test_cases": [
    {
      "case_id": "TC-XXX-001",
      "title": "string",
      "tool": "visual_app_test",
      "test_objective": "string",
      "steps": ["string"],
      "action_steps": [],
      "expected_result": "string",
      "assertions": ["string"],
      "parameter_overrides": {
        "test_goal": "string",
        "assertions": ["string"],
        "test_steps": ["string"],
        "action_steps": [],
        "expected_result": "string",
        "openclaw_test_instruction": "string"
      },
      "priority": "P0",
      "risk_tags": []
    }
  ]
}
```

审核通过后的用例 JSON 必须仍然使用相同根字段和相同 case payload 结构。否则下游 `function-testing` / APP 执行 Skill 可能无法正确读取：

```text
test_cases
case_id
title
tool
test_objective
steps
action_steps
expected_result
assertions
parameter_overrides.test_goal
parameter_overrides.assertions
parameter_overrides.test_steps
parameter_overrides.action_steps
parameter_overrides.expected_result
parameter_overrides.openclaw_test_instruction
priority
risk_tags
parameter_overrides.path_map_match_status
parameter_overrides.navigation_route
```

---

## 4. 字段保真原则

### 4.1 先复制，后审核，少量安全修订

审核通过的用例必须以“复制原 case payload”为基础，不得从零重写。

处理顺序：

1. 深拷贝上游 case 原始 payload。
2. 执行字段完整性检查。
3. 执行目标锚点、路径、步骤、断言和可执行性审核。
4. 对明显可安全修复的问题进行最小修订。
5. 保留上游未识别但不违规的扩展字段。
6. 将修订后的完整 case payload 放入输出 `test_cases`。

### 4.2 必须保留的字段

如果上游 case 中存在以下字段，审核通过后必须保留，除非字段值明显非法且已记录修订原因：

```text
case_id
title
tool
test_objective
steps
action_steps
expected_result
assertions
parameter_overrides
parameter_overrides.test_goal
parameter_overrides.assertions
parameter_overrides.test_steps
parameter_overrides.action_steps
parameter_overrides.expected_result
parameter_overrides.openclaw_test_instruction
parameter_overrides.path_map_match_status
parameter_overrides.navigation_route
priority
risk_tags
```

如果上游 case 中还有以下字段，也应保留：

```text
source_blueprint_item_ids
blueprint_trace
coverage_items
source_item_ids
source_file
source_sheet
source_row
excel_test_case_source
raw_case_fields
tags
preconditions
postconditions
test_data
environment
app_package
start_url
device_anchor
target_pages
```

原则：

```text
未知字段默认保留。
平台外层字段默认不写入主用例 JSON。
危险、伪造、绝对路径、运行器内部字段默认剔除或移入 review report。
```

### 4.3 禁止丢字段

禁止以下行为：

```text
只输出 case_id
只输出 title
只输出审核摘要
只输出 approved_test_cases 数组
把 action_steps 删除
把 parameter_overrides 删除
把 parameter_overrides.action_steps 删除
把 openclaw_test_instruction 删除
把 navigation_route 删除
把 path_map_match_status 删除
```

---

## 5. 输入来源优先级

执行前必须先调用：

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

### 5.1 查找上游用例产物

按以下优先级查找：

1. RunResourceRegistry 中 `artifact_type=test_case_artifact` 或名称为 `test_cases.json` 的资源。
2. 上游用例生成任务保存的 `test_cases.json`。
3. 上游用例审核任务已有的 `approved_test_cases.json`，但必须检查根字段是否为 `test_cases`。
4. `Task.context` 中明确包含的 `test_cases`。
5. 兼容字段：`previous_outputs[].result.test_cases`、`previous_outputs[].result.contract_output.content.test_cases`、`approved_test_cases`。

如果找到多个候选：

- 优先审核 `test_cases.json` 原始生成产物；
- 如果存在人工/上游审核通过产物，可优先使用最新版；
- 必须在 `case_review_report.json` 中记录 consumed resource/artifact 信息；
- 主用例 JSON 不写这些元信息。

### 5.2 资源读取规则

优先使用：

```text
list_run_resources
read_resource
search_resource
read_resource_chunk
```

仅当资源工具不可用且 Boss/routeB 明确提供安全文本路径时，才允许使用 `read_file` 兼容读取。

禁止：

- 猜测 `.opencat/kernel_attachments/...` 路径。
- 直接读取未授权路径。
- 把 docx/pdf/xlsx/pptx 当普通 UTF-8 文本读。
- 仅凭 “Uploaded document preview index only” 或摘要索引批准用例。
- 仅凭自然语言 summary 认为已拿到完整用例。

---

## 6. 审核流程

必须按以下步骤审核：

### 6.1 收集和解析用例

1. 读取上游用例 JSON。
2. 确认根字段为 `test_cases` 或可安全兼容提取。
3. 建立 `case_id -> case payload` 映射。
4. 检查 case_id 是否重复、缺失、变化。
5. 保留原始 case payload，用于字段保真对比。

如果上游没有可审核用例：

- 调用 `request_user_input` 或返回 blocked；
- 不得生成伪造用例；
- 不得保存空的“已审核通过”产物，除非任务明确允许空集合。

### 6.2 需求和蓝图对齐

从以下来源提取审核依据：

```text
structured_requirements
test_point_inventory
coverage_strategy
case_generation_blueprint
path_and_assertion_hints
requirement_blueprint.json
business rules
path map
用户原始目标
```

审核用例是否满足：

- 目标语义一致；
- 设备锚点一致；
- 页面/入口一致；
- 覆盖项对应；
- 步骤可执行；
- 断言可验证；
- 路径可被执行器消费。

### 6.3 单条用例门禁

每条用例审核以下内容：

1. `case_id` 存在且不变。
2. `title` 明确，不能空泛。
3. `tool` 存在；APP 视觉执行优先保留 `visual_app_test`。
4. `test_objective` 与用户目标、需求蓝图、目标锚点一致。
5. `steps` 是操作步骤，不把校验写成操作。
6. `expected_result` 是可观测结果。
7. `assertions` 是可执行断言。
8. 顶层 `action_steps` 存在且可执行。
9. `parameter_overrides.action_steps` 存在且与顶层 `action_steps` 完全一致。
10. `parameter_overrides.test_goal` 与 `test_objective` 语义一致。
11. `parameter_overrides.test_steps` 与 `steps` 语义一致。
12. `parameter_overrides.expected_result` 与 `expected_result` 语义一致。
13. `parameter_overrides.assertions` 与顶层 `assertions` 语义一致。
14. `parameter_overrides.openclaw_test_instruction` 存在且包含【初始导航】【核心操作】【预期结果】。
15. 导航步骤中 `navigation_step=true` 的步骤包含 `page_from`、`page_to`、`intent`、`target`。
16. 不能出现“同上”“见第一条”“沿用前置路径”。
17. 不能出现“页面页面”“页页面”等异常重复词。
18. 不得包含未授权本地绝对路径或运行器内部路径。

### 6.4 action_steps 一致性修复

如果顶层 `action_steps` 和 `parameter_overrides.action_steps`：

- 都存在且一致：通过；
- 只存在一个：可复制到另一个，并记录 safe fix；
- 都存在但轻微字段顺序差异：可规范化后修复；
- 都存在但语义冲突：拒绝或 blocked，不得猜测。

### 6.5 parameter_overrides 镜像修复

如果审核中安全修订了以下字段：

```text
test_objective
steps
action_steps
expected_result
assertions
```

必须同步更新：

```text
parameter_overrides.test_goal
parameter_overrides.test_steps
parameter_overrides.action_steps
parameter_overrides.expected_result
parameter_overrides.assertions
parameter_overrides.openclaw_test_instruction
```

保持下游执行 Skill 可从任一位置读取一致信息。

### 6.6 覆盖审核

非 Excel / 非用户既有用例库审核：

- 对比 `coverage_strategy.expected_min_case_count`。
- 对比 `coverage_matrix` / `test_point_inventory`。
- must-have 覆盖项缺失时，写入 `case_review_report.json` 的 blocking revision。
- 可批准已合格用例，但整体 handoff 可标记为 not_ready。

Excel 回归 / 用户既有用例库审核：

- 覆盖缺口只作为 advisory 记录。
- 不得因为覆盖数量不足而拒绝当前批合格用例。
- 当前批用例的 `case_id`、来源文件、Sheet、行号必须保留。

---

## 7. 安全修订范围

### 7.1 可以安全修订

允许修订：

```text
标题中的错别字
目标锚点缺失但目标明确
steps 中把断言混入操作的表述
expected_result 表述不够可观测
assertions 与 expected_result 镜像缺失
parameter_overrides 缺少镜像字段
action_steps 顶层与 parameter_overrides 单侧缺失
openclaw_test_instruction 缺少标准段落但信息足够
path_map_match_status 缺失但上下文明确
navigation_route 缺失但 action_steps 已可提取
```

### 7.2 不得安全修订

以下情况不得擅自修复并批准：

```text
case_id 缺失且无法回溯
目标设备锚点冲突
页面入口明显错误
用例业务目标与需求不一致
步骤完全不可执行
断言不可验证
需要用户提供账号/设备/权限/环境
用例依赖未授权业务规则
高风险操作未授权
```

---

## 8. 输出文件

### 8.1 主用例文件：approved_test_cases.json

必须保存：

```text
approved_test_cases.json
```

文件内容：

```json
{
  "test_cases": [
    {
      "case_id": "保持原 case_id",
      "title": "审核后标题",
      "tool": "visual_app_test",
      "test_objective": "审核后目标",
      "steps": ["审核后步骤"],
      "action_steps": [],
      "expected_result": "审核后预期",
      "assertions": ["审核后断言"],
      "parameter_overrides": {
        "test_goal": "审核后目标",
        "assertions": ["审核后断言"],
        "test_steps": ["审核后步骤"],
        "action_steps": [],
        "expected_result": "审核后预期",
        "openclaw_test_instruction": "帮我按照以下步骤执行测试：\n【初始导航】...\n【核心操作】...\n【预期结果】..."
      },
      "priority": "P0|P1|P2",
      "risk_tags": []
    }
  ]
}
```

该文件：

- 必须可被 `json.loads` 直接解析；
- 不得包含 Markdown；
- 不得包含注释；
- 不得包含平台外层包装；
- 根字段只能以 `test_cases` 作为下游执行必需字段；
- 可以保留每条 case 的扩展字段；
- 不得在根对象加入 `approved_test_cases` 或 `review_report`。

metadata：

```text
artifact_type=test_case_artifact
name=approved_test_cases.json
read_hint=reviewed approved test cases for downstream execution; JSON root is test_cases
case_artifact_format=test_cases_root
review_status=approved
```

### 8.2 审核报告：case_review_report.json

审核报告另存为：

```text
case_review_report.json
```

内容建议：

```json
{
  "review_summary": {
    "reviewed_case_count": 0,
    "approved_count": 0,
    "rejected_count": 0,
    "blocking_revision_count": 0,
    "advisory_count": 0,
    "handoff_ready": true
  },
  "rejected_cases": [],
  "revision_suggestions": [],
  "coverage_report": {},
  "review_diagnostics": {},
  "anchor_audit": {},
  "case_id_audit": {},
  "execution_readiness_report": {},
  "safe_fixes_applied": [],
  "upstream_consumption": {
    "consumed_resource_ids": [],
    "consumed_artifacts": [],
    "parse_errors": [],
    "skipped_artifacts": []
  }
}
```

该文件不是下游执行的主用例文件。下游执行应读取 `approved_test_cases.json` 中的 `test_cases`。

metadata：

```text
artifact_type=case_review_report
name=case_review_report.json
read_hint=case review diagnostics; not the execution case artifact
```

---

## 9. finish_task 要求

保存或登记产物后，必须调用：

```text
finish_task
```

`finish_task` 可以说明：

- approved test cases artifact 路径；
- case_review_report artifact 路径；
- 批准/拒绝/阻塞数量；
- 下游应读取 `approved_test_cases.json` 的 `test_cases` 根字段。

但注意：

- 不要求在 `finish_task.structured_extract` 中复制完整 `test_cases` 数组；
- 不得把平台外层字段写入 `approved_test_cases.json`；
- 如果 `approved_count > 0`，必须存在 `approved_test_cases.json` 且其中 `test_cases.length == approved_count`。

---

## 10. 失败与阻塞

### 10.1 输入缺失

没有收到可审核用例时：

- 不生成伪造用例；
- 不保存已审核通过的 `approved_test_cases.json`；
- 可以保存 `case_review_report.json` 说明阻塞原因；
- 必须调用 `request_user_input` 或 `finish_task` 返回 blocked。

### 10.2 全部拒绝

如果所有用例都不可批准：

- 不生成包含伪通过用例的主用例产物；
- 可以生成空 `approved_test_cases.json`，但必须在 report 中明确 `handoff_ready=false`；
- 更推荐只生成 `case_review_report.json` 并 blocked，等待上游重写。

### 10.3 部分通过

如果部分用例通过：

- `approved_test_cases.json` 只包含审核通过且字段完整的用例；
- `case_review_report.json` 记录 rejected/revision；
- 如果阻塞缺口影响整体任务，可在 finish_task 中说明 `handoff_ready=false`，但主用例文件仍必须保持纯 `{ "test_cases": [...] }`。

---

## 11. 最终自检清单

输出前必须逐项自检：

1. `approved_test_cases.json` 可被 `json.loads` 解析。
2. `approved_test_cases.json` 根字段为 `test_cases`。
3. `approved_test_cases.json` 不含 `task_id/status/result/contract_output/approved_test_cases` 等外层字段。
4. 每条通过用例都保留完整 case payload。
5. 每条通过用例保留或补齐：
   - `case_id`
   - `title`
   - `tool`
   - `test_objective`
   - `steps`
   - `action_steps`
   - `expected_result`
   - `assertions`
   - `parameter_overrides.test_goal`
   - `parameter_overrides.assertions`
   - `parameter_overrides.test_steps`
   - `parameter_overrides.action_steps`
   - `parameter_overrides.expected_result`
   - `parameter_overrides.openclaw_test_instruction`
   - `priority`
   - `risk_tags`
6. 顶层 `action_steps` 与 `parameter_overrides.action_steps` 完全一致。
7. 如果有 `navigation_route`、`path_map_match_status`，必须保留。
8. `case_id` 不改变。
9. 未知但不违规的 case 扩展字段保留。
10. `case_review_report.json` 中的 approved_count 与 `approved_test_cases.json.test_cases.length` 一致。
11. 如果下游执行需要的字段无法补齐，则不得批准该用例。

---

## 12. 响应风格

对话层只简要说明：

```text
已完成审核，已生成 approved_test_cases.json 和 case_review_report.json。
```

不要在对话层粘贴完整用例 JSON。

完整结果必须通过 artifact 交付。
