---
name: testcase-generator
description: 当前工作区的高覆盖测试用例生成 Skill。用于消费 requirement_blueprint.json、可选参考文件和用户目标，生成根字段为 test_cases 的纯 JSON test_cases.json。
---

# 测试用例生成

本 Skill 只生成一个主产物：`test_cases.json`。

文件必须是合法 JSON，且只包含：

```json
{
  "test_cases": []
}
```

不要在 `test_cases.json` 中写入 Markdown、注释、说明文字、诊断信息或运行时元数据。

## Required Files

当以下可选工作区参考文件存在时，优先尝试读取。引用路径必须保持原样：

- `knowledge/alarm_deviceshare_rules.md`
- `knowledge/alarm_business_rules.md`
- `knowledge/ydkj_path_map.md`

参考文件缺失不是致命错误。受影响的导航或规则衍生字段标记为 `missing`、`partial` 或 `unmatched`；不要编造参考文件内容。

## 输入优先级

按以下顺序优先使用输入：

1. `requirement-understanding` 产出的 `requirement_blueprint.json`。
2. 当前用户目标和澄清答案。
3. 上述 Required Files 中实际可用的内容。
4. 当前工作区中用户明确提供且可读取的其他文件或示例。

从 `requirement_blueprint.json` 中优先消费：

```text
user_requirement_story
structured_requirements
test_point_inventory
coverage_strategy
case_generation_blueprint
path_and_assertion_hints
risk_based_priorities
clarification_summary
```

如果存在 `user_requirement_story`，必须用它锁定业务场景、角色/权限、前置条件、成功标准、异常/边界预期和剩余风险。生成的用例不得偏离该故事。

如果存在 `case_generation_blueprint.case_groups`，必须优先按它生成；如果存在 `coverage_strategy.coverage_matrix`，每个矩阵项都必须至少能追踪到一条用例。

## 覆盖规则

写用例前先在内部建立覆盖账：

```text
module_inventory
feature_inventory
action_flow_inventory
config_permission_inventory
state_permission_inventory
exception_boundary_inventory
coverage_matrix
case_group_plan
```

用例数量要足以覆盖：

- 模块和页面；
- 功能点；
- 动作流程；
- 配置项和权限项；
- 角色、账号、设备、数据和环境状态；
- 正常、负向、边界、中断恢复和异常行为；
- 导航路径和可观察 UI 反馈。

允许生成总览用例，但总览只覆盖入口、展示和列表层行为。总览用例不能替代具体功能点、配置项、权限项、动作流程或异常场景。

## 最低用例数

写入最终 JSON 前必须计算 `expected_min_case_count`：

```text
max(
  blueprint.expected_min_case_count,
  sum(case_generation_blueprint.case_groups.minimum_cases),
  sum(coverage_strategy.coverage_matrix.minimum_case_count),
  M*2 + F*3 + P*5 + N*2 + S + E + A + R
)
```

其中：

- `M` = 模块数。
- `F` = 功能点数。
- `P` = 动作流程数。
- `N` = 配置项或权限项数。
- `S` = 状态或权限差异数。
- `E` = 异常或边界项数。
- `A` = 有证据支持的附加属性数。
- `R` = 高风险项数。

不得因为输出较长而降低数量。如果范围过大导致单次无法完整输出，先询问用户如何拆分，而不是保存一个不完整文件。

## 用例结构

每条可执行 APP/Web 用例必须包含：

```json
{
  "case_id": "TC-001",
  "title": "",
  "tool": "visual_app_test",
  "test_objective": "",
  "steps": [],
  "action_steps": [],
  "expected_result": "",
  "assertions": [],
  "priority": "P0|P1|P2",
  "risk_tags": [],
  "coverage_items": [],
  "source_blueprint_item_ids": [],
  "blueprint_trace": [],
  "parameter_overrides": {
    "test_goal": "",
    "test_steps": [],
    "action_steps": [],
    "expected_result": "",
    "assertions": [],
    "navigation_route": [],
    "path_map_match_status": "matched|partial|unmatched|not_applicable",
    "coverage_trace": []
  }
}
```

规则：

- 可执行 APP/Web 用例的 `tool` 必须是 `visual_app_test`。
- 顶层 `action_steps` 和 `parameter_overrides.action_steps` 必须同时存在且完全一致。
- `steps` 和 `parameter_overrides.test_steps` 语义必须一致。
- `expected_result`、`assertions` 及其 `parameter_overrides` 镜像字段必须一致。
- 不得使用“同上”“见上一条”“沿用第一条”这类占位步骤。
- 如果某条用例暂时不可执行，必须在 `risk_tags` 或 `parameter_overrides.case_type` 中说明原因；不要伪造空的可执行步骤。

## 导航与路径图谱

当 `knowledge/ydkj_path_map.md` 可用时，APP 用例必须把它作为导航规划参考。

- 将每条用例的目标页面或功能点匹配到路径图谱。
- 命中路径必须展开成逐步导航，不得压缩成单条 `A -> B -> C`。
- 只命中部分路径时，使用已知前缀，并标记 `path_map_match_status="partial"`。
- 完全未命中时，使用目标页面作为导航目的地，并标记 `path_map_match_status="unmatched"`。
- 不得编造页面、按钮或路径节点。

`action_steps` 尽量使用确定性的低层动作：

```json
{
  "step_index": 1,
  "action": "aiAct",
  "intent": "打开目标页面",
  "target": {},
  "value": "",
  "navigation_step": true,
  "page_from": "",
  "page_to": "",
  "assert_after": []
}
```

操作和断言必须分离：动作只描述要做什么；`expected_result` 和 `assertions` 描述要验证什么。

## ID 与追踪规则

- 生成稳定、唯一、可读的 `case_id`，例如 `TC-M01-F01-001`。
- 不同覆盖项不得因为标题相似而合并成同一个 ID。
- 通过 `coverage_items`、`source_blueprint_item_ids`、`blueprint_trace` 和 `parameter_overrides.coverage_trace` 保留追踪关系。
- 不得添加 `status`、`summary`、`result`、`diagnostics`、`contract_output`、`used_skills`、`used_workspace_files` 或绝对工作区路径等根字段。

## 保存门禁

保存 `test_cases.json` 前必须确认：

```text
root.test_cases 存在
JSON.parse 成功
actual_case_count >= expected_min_case_count
coverage_matrix 每项都有 case 追踪
总览用例没有替代细项用例
每条可执行用例都有匹配的顶层 action_steps 和 parameter_overrides.action_steps
每条可执行用例都有非空 steps/action_steps/assertions，或有明确 blocked 原因
不出现占位路径、重复页面后缀、U+FFFD、Markdown 围栏或模板表达式
```

如果门禁失败，先修复用例再保存。如果必要信息缺失且无法从可见证据中得到，向用户询问，不要写一个误导性的完整文件。

## 可选报告

需要记录诊断信息时，可以另存 `case_generation_report.json`，但不得混入 `test_cases.json`。

报告可包含：

```text
module_inventory
feature_inventory
coverage_matrix
expected_min_case_count
actual_case_count
coverage_gap
self_check_result
```
