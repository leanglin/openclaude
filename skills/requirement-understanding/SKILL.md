---
name: requirement-understanding
description: 当前工作区的需求澄清与测试蓝图 Skill。用于强制先向用户澄清需求，再把用户目标、可见资料和可选参考文件整理为 testcase-generator 可直接消费的纯 JSON requirement_blueprint.json。
---

# 需求理解与澄清

本 Skill 只产出一个主文件：`requirement_blueprint.json`。

它不生成测试用例，不执行测试，不修改产品资产，也不在输出 JSON 中夹带主机、运行器或任务状态信息。该 JSON 必须能被 `testcase-generator` 直接消费。

## Required Files

当以下可选工作区参考文件存在时，优先尝试读取。引用路径必须保持原样：

- `knowledge/alarm_deviceshare_rules.md`
- `knowledge/alarm_business_rules.md`
- `knowledge/ydkj_path_map.md`

参考文件缺失不是致命错误。把缺口记录到 `missing_questions`、`risk_notes` 或 `evidence_usage`，不要编造文件内容。

## 输入规则

只能使用用户请求、当前对话、明确提供的文件，以及上述 Required Files 中实际可见的信息。

- 用户提供的产品名、页面名、设备名、标签和引号内文本必须原样保留。
- 摘要、片段和附件只按实际可见内容作为证据。
- 如果被引用的文档不可用或只有摘要，不得推断隐藏章节；缺失内容影响蓝图时必须向用户澄清。
- 不得在 JSON 中输出绝对工作区路径、内部诊断、工具 trace 或平台/任务状态。

## 强制人工澄清（HITL）

保存 `requirement_blueprint.json` 前必须先完成人工澄清。

如果当前上下文还没有用户对澄清问题的明确回答，必须向用户提问并停止；不得保存 `requirement_blueprint.json`，不得把假设当作答案。

必须提出 5 个结合当前目标定制的问题：

1. `CQ-001` 业务流程和入口：确认测试路径、触发方式和起始状态。
2. `CQ-002` 输入数据和约束：确认数据、格式、范围、数量、账号、设备或配置值。
3. `CQ-003` 异常和边界：确认网络、空数据、非法输入、中断、重试和边界场景。
4. `CQ-004` 角色、权限和状态：确认账号角色、设备状态、功能可用性、授权和环境差异。
5. `CQ-005` UI 反馈和成功标准：确认可见结果、toast/弹窗文案、跳转、按钮状态或其他可观察验收标准。

给用户看的澄清消息要简短自然。分析、假设和证据说明不要塞进用户可见提示，除非这些信息能帮助用户回答问题。

用户回答后，必须把答案真实写入：

- `structured_requirements`
- `user_requirement_story`
- `test_point_inventory`
- `coverage_strategy`
- `case_generation_blueprint`
- `path_and_assertion_hints`

澄清答案优先级高于早期假设。

## 蓝图流程

拿到澄清答案后，按以下顺序生成蓝图：

1. 保留用户原始目标和关键锚点，不改写成泛化目标。
2. 识别范围、非范围、目标平台、目标功能、页面、角色、权限、数据、设备/环境假设和成功标准。
3. 生成 `user_requirement_story`，覆盖业务场景、角色/权限、前置条件、主成功路径、可观察成功标准、异常/边界故事、非范围和剩余风险。
4. 从用户目标、澄清答案、可见文档、业务规则和路径图谱证据中拆出测试点。
5. 把动作、配置项、权限项、状态、文档功能点、异常和边界拆成独立覆盖项。
6. 基于覆盖矩阵和用例分组估算最低用例数；复杂需求不得使用很低的总览数量。
7. 生成 `case_generation_blueprint`，让 `testcase-generator` 不需要重新猜测需求即可生成用例。

## 覆盖度与数量门禁

`expected_min_case_count` 必须保守计算。

当变量可用时，使用以下下限：

```text
max(P*5 + 2N + A + M*2, sum(coverage_matrix.minimum_case_count), sum(case_groups.minimum_cases))
```

其中：

- `P` = 动作流程或带编号的操作段落。
- `N` = 配置项或权限项。
- `A` = 有证据支持的附加属性、状态、边界、提示、子页面或能力差异。
- `M` = 文档或业务规则中的功能点。

规则：

- 每个动作流程应覆盖基础、负向/异常、高频、中断恢复、边界/风险场景。
- 每个配置项或权限项至少覆盖默认状态和基础行为。
- 总览用例不能抵扣单项覆盖的最低数量。
- `coverage_strategy.expected_min_case_count` 和 `case_generation_blueprint.expected_min_case_count` 都不得低于覆盖矩阵和用例分组的最小值之和。

## 输出契约

`requirement_blueprint.json` 只能保存合法 JSON。根对象使用以下结构：

```json
{
  "structured_requirements": {
    "goal": "保留关键锚点的用户原始目标",
    "scope": "本次覆盖范围",
    "out_of_scope": [],
    "test_object": {
      "platform": "android|ios|web|unknown",
      "app_package": "",
      "device_anchor": "",
      "feature": "",
      "target_pages": []
    },
    "success_criteria": [],
    "constraints": [],
    "assumptions": []
  },
  "user_requirement_story": {
    "original_user_goal": "",
    "business_scenario": "",
    "actors_and_permissions": [],
    "preconditions": [],
    "main_success_flow": [],
    "success_criteria": [],
    "exception_and_boundary_story": [],
    "out_of_scope": [],
    "open_questions_or_risks": []
  },
  "clarification_summary": {
    "status": "answered",
    "answers": [],
    "final_requirement_understanding": "",
    "test_focus_summary": {
      "normal_flow": "",
      "boundary_or_exception": "",
      "ui_feedback": "",
      "permission_or_state": ""
    }
  },
  "test_point_inventory": [],
  "coverage_strategy": {
    "coverage_sources": {},
    "coverage_items": [],
    "coverage_matrix": [],
    "coverage_matrix_min_sum": 0,
    "expected_min_case_count": 0,
    "expected_min_case_count_formula": "",
    "expected_min_case_count_formula_breakdown": "",
    "avoid_overview_only": true,
    "quality_gates": []
  },
  "case_generation_blueprint": {
    "goal": "",
    "user_requirement_story_ref": "testcase-generator 必须优先消费 user_requirement_story",
    "clarification_inputs": {
      "status": "answered",
      "answers": [],
      "impact_on_cases": []
    },
    "expected_min_case_count": 0,
    "case_group_min_sum": 0,
    "case_groups": [],
    "do_not_merge": [],
    "scenario_expansion_rules": [],
    "item_split_rules": [],
    "quality_gate_hints": [],
    "generation_rules": []
  },
  "path_and_assertion_hints": {
    "navigation_candidates": [],
    "assertion_catalog": []
  },
  "risk_based_priorities": [],
  "missing_questions": [],
  "risk_notes": [],
  "downstream_hints": {
    "case_generation": [],
    "execution": []
  },
  "evidence_usage": {
    "used_sources": [],
    "missing_or_unread_sources": [],
    "source_limits": []
  }
}
```

不得添加以下根字段：

```text
task_id
status
summary
assistant_reply
result
diagnostics
contract_output
used_skills
used_workspace_files
source_asset_ids
active_skill_ids
```

## 保存前自检

保存前必须确认：

- 文件可被 `JSON.parse` 或 `json.loads` 解析。
- HITL 答案已经反映到需求故事、约束、覆盖策略和用例生成蓝图。
- `user_requirement_story` 覆盖原始目标、场景、角色/权限、前置条件、主成功路径、成功标准、异常边界和剩余风险。
- 每个覆盖矩阵项都能追溯到用户答案、可见资料、规则或路径提示。
- `case_generation_blueprint.expected_min_case_count` 不低于覆盖策略的最低数量。
- 总览项没有替代细项覆盖。
- 文件中没有 Markdown、注释、隐藏运行时元数据或占位值。
