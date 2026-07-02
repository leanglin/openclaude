---
name: requirement-understanding
description: 需求分析子智能体的纯 JSON 测试蓝图 Skill。适用于 requirement_understanding_claw 将 Boss 用户目标、上游资产、业务规则、页面路径图谱和用户澄清答案整理为可由 routeB 传递给 testcase-generator 直接消费的 requirement_blueprint.json。
user-invocable: true
triggers:
  - requirement understanding
  - requirement analysis
  - structured requirements
  - test blueprint
  - case generation blueprint
  - 需求分析
  - 需求理解
  - 需求澄清
  - 结构化需求
  - 测试蓝图
  - 测试范围梳理
allowed-tools:
  - Read
  - Write
  - read_file
  - list_workspace_skills
  - read_workspace_skill
  - save_artifact
  - register_artifact
  - finish_task
  - request_user_input
capabilities:
  - requirement_analysis
  - requirement_clarification
  - test_blueprint_generation
  - artifact_io
  - human_input
---

# 功能概述

接收 Boss 下发给 `requirement_understanding_claw` 的需求分析任务，把当前用户目标、授权资产、上游输出、业务规则和页面路径图谱整理为下游 `testcase-generator` 可直接消费的纯 JSON 测试蓝图文件。

本 Skill 不生成正式 `test_cases`，不分配最终 `case_id`，不执行 APP/Web 测试，不修改资产。它只产出 `requirement_blueprint.json`，用于帮助后续用例生成实例生成更多、更准、更有效的结构化用例。

最终落盘文件必须是纯 `requirement_blueprint.json`，文件内容只允许是完整 JSON 对象，不得包含 Markdown、代码块围栏、说明性正文、注释或平台外层包装。

```json
{
  "structured_requirements": {},
  "clarification_summary": {},
  "test_point_inventory": [],
  "coverage_strategy": {},
  "case_generation_blueprint": {},
  "path_and_assertion_hints": {},
  "risk_based_priorities": [],
  "missing_questions": [],
  "risk_notes": [],
  "downstream_hints": {},
  "evidence_usage": {}
}
```

不得在 `requirement_blueprint.json` 中输出以下平台外层字段：

- `task_id`
- `status`
- `summary`
- `assistant_reply`
- `result`
- `diagnostics`
- `contract_output`
- `used_skills`
- `used_workspace_files`
- `source_asset_ids`
- `active_skill_ids`
- workspace 绝对路径

如平台需要任务状态、artifact refs、active skill、used files、diagnostics 或 run/task 元数据，应由 Boss/OpenCat/routeB 运行器在文件外部维护，不得写入本文件。

## 适用角色

- `requirement_understanding_claw`

## 输入来源与授权边界

- 只能使用 Boss 提供的用户目标、任务参数、上游输出、`asset_refs`、角色合同、workspace Skill read set 和已授权文件。
- 可以读取本 Skill Required Files 中存在的 workspace 文件，也可以读取 Boss 显式授权到 read set 的文件。
- 不允许自行扫描无关目录，不允许绕过 Boss 授权补充事实来源。
- 不允许编造未授权资产 ID、workspace 绝对路径、运行器状态、实际读取文件列表或 active skill 信息。
- 如果业务规则、路径图谱或环境信息缺失，不阻塞；应把缺失项写入 `missing_questions`、`structured_requirements.constraints`、`structured_requirements.assumptions` 或 `risk_notes`。
- 用户目标中的 `【...】` 设备名、页面名、功能名必须逐字保留。

## Required Files

根据当前 workspace 尝试读取以下可选文件；缺失时继续基于 Boss 上下文分析：

- `knowledge/alarm_deviceshare_rules.md`
- `knowledge/alarm_business_rules.md`
- `knowledge/ydkj_path_map.md`

如果 Boss 上下文或 read set 中提供了更匹配的规则文件、PRD、Excel 摘要或路径图谱，应优先使用这些文件。

## 上传文档全文消费门禁

当上下文包含上传文档时，本节优先级高于普通证据卡摘要规则。

1. `knowledge_evidence_cards.summary`、`attachment_evidence_cards.summary` 只是预览索引，不是全文。不得因为 summary 只显示开头或包含 `[truncated]`，就判断需求文档正文被截断。
2. 如果上传文档元信息显示 `full_text_available=true` 且存在 `Uploaded document full-text context`、`chunk_count` 或 `BEGIN UPLOADED DOCUMENT ... CHUNK`，必须以全文 chunk 为主输入完成需求理解。
3. 需求蓝图必须检查文档后半段模块，不能只覆盖开头模块。若文档提到“模块三/模块四/模块五/模块六”、表格、附录、文案库、统计口径等后段内容，必须进入 `test_point_inventory`、`coverage_strategy` 或 `risk_notes`。
4. 如果元信息说全文可用，但当前上下文实际看不到全文 chunk，必须调用 `request_user_input` 说明“上传文档全文上下文缺失”，不得凭 summary 推断后续章节，也不得落盘 `requirement_blueprint.json`。
5. 如果 `truncated=true` 或存在 `content_truncated` warning，应在 `risk_notes` 中说明真实截断风险，并把缺失章节列入 `missing_questions`。
6. 文档全文使用情况只允许写入 `evidence_usage`，不要写入顶层 `diagnostics`。

## 需求澄清与可恢复暂停

本节优先级高于普通蓝图生成。需求分析必须先执行需求澄清门；第一次分析没有用户澄清答案时，不允许生成最终蓝图，也不允许把推断内容当作已回答。

### 需要澄清时的硬协议

当用户需求缺失、完全无法理解，或必须用户确认后才能继续生成有效蓝图时，必须：

1. 调用 `request_user_input`；
2. 向用户提出 5 个具体、可回答、与当前需求强相关的待澄清问题；
3. 不得落盘 `requirement_blueprint.json`；
4. 不得调用 `finish_task`；
5. 不得只在最终文本中写澄清问题；
6. 调用 `request_user_input` 后立即停止当前任务，等待 routeB 暂停与恢复；
7. 不得把平台字段、运行状态、JSON 字段名或内部执行术语展示给用户；
8. 不得把一大段“初步理解/业务规则/页面路径/推测内容”塞进 `message_to_user`，避免前端气泡冗长、混乱。

### 澄清消息展示规范

调用 `request_user_input` 时，必须把展示给用户的内容拆成三层：

1. `message_to_user`：只放简短、自然、面向用户的提示语。
2. `questions_json`：放 5 个具体问题，供前端逐项展示。
3. `payload_json`：放结构化上下文，例如初步理解、证据摘要、推测规则、风险说明；这些内容可供恢复后继续执行，但不要直接作为长段消息展示给用户。

#### `message_to_user` 规则

`message_to_user` 必须满足：

- 只写 1～3 句自然语言，建议不超过 180 个中文字符。
- 只说明“需要先确认几个关键信息”，不要展开全部需求分析。
- 不要包含 Markdown 表格、长段落、业务规则清单、页面路径清单、JSON 片段或代码块。
- 不要出现以下内部术语：`routeB`、`Boss`、`structured_requirements`、`case_generation_blueprint`、`clarification_gate`、`missing_slots`、`current_stage`、`status=blocked`、`requirement_blueprint.json`。
- 不要写“请回答以下5个维度的问题，以便生成结构化需求蓝图”这类生硬提示；应改成用户能直接理解的表达。
- 不要在 `message_to_user` 中直接复制 5 个问题；5 个问题必须放入 `questions_json`。

推荐 `message_to_user`：

```text
为了避免生成的测试用例偏离你的真实业务，我需要先确认 5 个关键点。请按下面问题补充即可；不确定的可以写“按默认/无特殊要求”。
```

#### `questions_json` 规则

`questions_json` 必须是长度为 5 的 JSON 数组，问题 ID 固定为 `CQ-001` 到 `CQ-005`。每个问题必须：

- 结合当前用户目标、设备名、页面名、功能名、业务规则或路径图谱定制。
- 使用用户能直接回答的口吻，避免“确认业务流程/触发条件”这类标签式问题。
- 每个问题只问一个重点，避免一问中堆多个问题。
- 如果某个维度在需求中已经明确，改成确认性问题，例如“我理解为……是否正确？”。
- 如果无法从上下文判断，允许让用户选择“按默认/无特殊要求”。
- 问题文本建议 20～100 个中文字符。
- `preliminary_answer` 可以写初步理解，但不能当作用户已回答内容。

推荐结构：

```json
[
  {
    "id": "CQ-001",
    "dimension": "业务流程/触发条件",
    "question": "本次要测试的入口是否就是「移动爱家首页 -> 移动看家设备列表页 -> 直播页」进入目标功能？如果不是，请补充实际入口。",
    "preliminary_answer": "如路径图谱或需求中有明确入口，可写初步理解；否则留空。",
    "required": true
  },
  {
    "id": "CQ-002",
    "dimension": "输入数据/格式约束",
    "question": "本次功能是否涉及需要输入或选择的数据？例如时间段、设备、账号、文件或配置项；如无特殊输入，请写“无”。",
    "preliminary_answer": "",
    "required": true
  },
  {
    "id": "CQ-003",
    "dimension": "异常/边界场景处理",
    "question": "异常场景重点要覆盖哪些？例如网络异常、空数据、接口失败、连续点击或中断恢复；如无特别要求，请写“按常规覆盖”。",
    "preliminary_answer": "",
    "required": true
  },
  {
    "id": "CQ-004",
    "dimension": "状态/权限/角色区分",
    "question": "是否需要区分不同账号、权限、设备状态或能力集？例如主人/共享用户、在线/离线、有无云存储等。",
    "preliminary_answer": "",
    "required": true
  },
  {
    "id": "CQ-005",
    "dimension": "交互反馈/UI规范",
    "question": "成功或失败后是否有指定的页面反馈、toast、弹窗、按钮状态或跳转要求？如没有指定，请写“按现有产品表现”。",
    "preliminary_answer": "",
    "required": true
  }
]
```

#### `payload_json` 规则

`payload_json` 可包含以下结构，供 routeB 恢复后继续使用：

```json
{
  "preliminary_understanding": {
    "preconditions": "当前理解到的前置条件",
    "inputs": "当前理解到的输入或数据",
    "business_rules": "当前理解到的业务规则",
    "outputs_or_expectations": "当前理解到的输出/预期",
    "page_paths": "当前理解到的页面路径"
  },
  "implicit_rules": ["基于证据或常识推测的规则"],
  "risk_notes": ["需要用户确认的风险点"]
}
```

`payload_json` 中的推测内容不能写入最终 `clarification_summary.answers`，也不能让后续蓝图把推测当成用户确认答案。

### 强制 5 问澄清维度

没有明确用户答案时，必须提出 5 个问题，并固定覆盖以下维度。问题必须结合用户目标、业务规则、路径图谱或上传文档上下文定制；如果某个维度已经明确，改成确认性问题。

- `CQ-001` 业务流程/触发条件：确认触发功能的具体路径、入口和前置条件。
- `CQ-002` 输入数据/格式约束：确认输入数据类型、格式、长度、数量、时间范围等限制。
- `CQ-003` 异常/边界场景处理：确认网络异常、空数据、操作中断、越界等处理方式。
- `CQ-004` 状态/权限/角色区分：确认不同设备状态、能力集、用户角色、权限等级下的表现差异。
- `CQ-005` 交互反馈/UI规范：确认成功/失败后的页面反馈、toast 文案、弹窗、跳转和按钮状态。

禁止输出如下不合格问题：

```text
请确认业务流程/触发条件。
请确认输入数据/格式约束。
请确认异常/边界场景处理。
请回答以下5个维度的问题。
```

必须改写为结合当前业务对象的具体问题。

### 恢复后处理

恢复后必须从 `parameters.requirement_clarification_answers` 或 routeB 注入的用户回复上下文中读取用户回答。用户回答补足关键缺口后，才允许生成 `requirement_blueprint.json`。

澄清答案必须真实消费：

- 融入 `structured_requirements.constraints`、`structured_requirements.success_criteria`、`structured_requirements.assumptions`。
- 融入 `test_point_inventory` 的覆盖项、断言提示和风险。
- 融入 `coverage_strategy.coverage_sources.clarification_items`。
- 融入 `case_generation_blueprint.clarification_inputs`，供 `testcase-generator` 直接读取。

澄清答案优先级高于初步假设。若用户答案修正了前置条件、输入规则、异常处理、权限状态或 UI 反馈，最终蓝图必须以答案为准，并把被替换的假设放入 `risk_notes` 或 `structured_requirements.assumptions`。


## 分析流程

必须按以下顺序分析，不要只做摘要：

1. 提取目标保真信息：原始目标、设备锚点、平台、APP 包名、功能入口、页面名、账号/权限/环境依赖。
2. 识别范围边界：本次要测什么、不测什么、不能擅自扩展到哪些页面/业务。
3. 从用户目标和业务规则中拆出覆盖项：动作编号段落、功能点、入口、页面、配置项、权限项、状态、数据条件、设备能力、异常/边界场景。
4. 带编号且包含点击、跳转、设置、填写、保存、删除、切换等动作的段落，必须作为独立流程覆盖来源。
5. 如果出现配置项/权限项列表，每一项都必须成为独立覆盖项。
6. 命中的业务规则功能点必须作为文档功能点覆盖来源，不要只写成背景摘要。
7. 为每个覆盖项生成测试点蓝图：至少包含正向路径、关键断言、所需前置条件、风险等级。
8. 有证据时追加默认状态、可取消/不可取消、提示文案、子页面、能力集依赖、异常状态、空数据/无权限/网络异常等测试点。
9. 估算最低用例数，并写入 `coverage_strategy` 与 `case_generation_blueprint`。
10. 生成给下游 `testcase-generator` 的可执行建议：覆盖矩阵、建议标题方向、步骤/断言提示、最低用例数、禁止合并项和质量门禁。

## 最低数量估算规则

1. 动作编号段落数量为 `P` 时，动作场景建议数为 `P * 5`，覆盖基础流程、异常/负面、高频操作、中断恢复和边界/替代/适用风险补足。
2. 配置项/权限项数量为 `N` 时，配置项建议数至少为 `2N + A`；如需要配置项展示总览，可额外增加 1 条，但总览不能抵扣任一配置项的默认状态或基础行为用例，`A` 为有证据的属性追加用例数。
3. 命中文档功能点数量为 `M` 时，文档功能点建议数至少为 `M * 2`，覆盖基础验证和 1 条适用扩展场景。
4. `expected_min_case_count` 必须使用：

```text
max(P*5 + 2N + A + M*2, sum(coverage_matrix.minimum_case_count), sum(case_groups.minimum_cases))
```

5. `1 + 2N + A` 只允许作为配置项局部公式，`N+1` 不能作为全局兜底或降低最低数量。
6. 如果存在点击、跳转、开关、设置、保存、删除、筛选、查看详情等操作，必须优先计入 `P` 或 `N/A`，不能只作为普通 `M` 粗算。
7. 如果存在可取消、不可取消、副标题、子页面、能力集依赖、取消提示、异常状态、空数据、权限差异等属性，应继续增加 `A` 或提高对应覆盖项 `minimum_case_count`。
8. 每个模块若包含多个动作、状态、异常或配置属性，必须拆成多个 `coverage_matrix` 项，并给每项独立 `minimum_case_count`。
9. 没有列表时，按核心功能点、状态、边界和风险数量给出保守最低值。

## 纯 JSON 文件输出模式

当需求澄清已完成，且可以生成下游蓝图时，必须使用本模式。

1. 最终落盘文件名建议为 `requirement_blueprint.json`。
2. 文件内容必须是完整 JSON 对象，且可被 `json.loads` 直接解析。
3. 文件内容不得包含 Markdown、代码块围栏、说明性正文、注释或多余文本。
4. 根对象只允许输出以下有效结果字段：
   - `structured_requirements`
   - `clarification_summary`
   - `test_point_inventory`
   - `coverage_strategy`
   - `case_generation_blueprint`
   - `path_and_assertion_hints`
   - `risk_based_priorities`
   - `missing_questions`
   - `risk_notes`
   - `downstream_hints`
   - `evidence_usage`
5. 不得输出平台外层字段：`task_id`、`status`、`summary`、`assistant_reply`、`result`、`diagnostics`、`contract_output`、`used_skills`、`used_workspace_files`、`source_asset_ids`、`active_skill_ids`。
6. 不得输出正式 `test_cases`、`approved_test_cases` 或最终 `case_id`。

## `requirement_blueprint.json` 结构

```json
{
  "structured_requirements": {
    "goal": "保持用户原始目标语义，不改写关键锚点",
    "scope": "本次测试覆盖范围",
    "out_of_scope": ["明确不测或不可推断的内容"],
    "test_object": {
      "platform": "android|ios|web|unknown",
      "app_package": "如已知则填写，否则为空字符串",
      "device_anchor": "如【书房-HDC52】",
      "feature": "目标功能或入口",
      "target_pages": ["页面或路径名称"]
    },
    "success_criteria": ["可验证的成功标准"],
    "constraints": ["环境、权限、数据、设备、账号等约束"],
    "assumptions": ["缺资料时采用的保守假设"]
  },
  "clarification_summary": {
    "status": "answered|not_required",
    "answers": [
      {
        "id": "CQ-001",
        "dimension": "业务流程/触发条件",
        "answer": "用户补充答案"
      }
    ],
    "final_requirement_understanding": "原始需求与澄清答案整合后的最终需求理解",
    "test_focus_summary": {
      "normal_flow": "正常流程关注点",
      "boundary_or_exception": "边界/异常关注点",
      "ui_feedback": "交互反馈关注点",
      "permission_or_state": "权限/状态关注点"
    }
  },
  "test_point_inventory": [
    {
      "item_id": "TP-001",
      "name": "覆盖项名称",
      "item_type": "overview|action_flow|scenario_extension|document_feature|feature|config_item|permission_item|state|negative|boundary|device_capability",
      "source": "user_goal|business_rule|path_map|upstream_context|clarification_answer",
      "evidence": "来自需求、澄清答案或文档的依据摘要",
      "must_have": true,
      "risk": "P0|P1|P2",
      "suggested_case_focus": ["建议拆出的用例方向"],
      "assertion_hints": ["可验证断言"],
      "path_hints": ["建议导航路径或目标页面"]
    }
  ],
  "coverage_strategy": {
    "coverage_sources": {
      "action_paragraph_count": 0,
      "action_paragraph_items": ["动作段落或流程覆盖项明细"],
      "config_or_permission_item_count": 0,
      "config_or_permission_items": ["配置项/权限项明细"],
      "document_feature_count": 0,
      "document_feature_items": ["文档功能点明细"],
      "attribute_case_count": 0,
      "attribute_case_items": ["可取消/不可取消/子页面/能力集/提示文案/异常状态等属性追加项明细"],
      "clarification_items": ["CQ-* 对覆盖项、断言和风险的影响"]
    },
    "coverage_items": ["逐项列出必须覆盖的功能点/配置项/权限项"],
    "coverage_matrix": [
      {
        "item": "覆盖项名称",
        "item_id": "TP-001",
        "minimum_case_count": 1,
        "suggested_case_titles": ["建议用例标题，不写最终 case_id"],
        "assertions": ["该覆盖项必须验证的断言"]
      }
    ],
    "coverage_matrix_min_sum": 1,
    "expected_min_case_count": 1,
    "expected_min_case_count_formula": "max(P*5 + 2N + A + M*2, sum(coverage_matrix.minimum_case_count), sum(case_groups.minimum_cases))",
    "expected_min_case_count_formula_breakdown": "P=0,N=0,A=0,M=0；formula_floor=0；coverage_matrix_min_sum=1；case_group_min_sum=1；expected_min_case_count=1",
    "count_floor_check": "pass|failed",
    "avoid_overview_only": true,
    "split_guidance": "多条短用例优先，不要把多个动作段落、配置项/权限项或文档功能点塞进一条用例。",
    "quality_gates": [
      "每个动作段落原则上至少 5 条场景用例",
      "每个配置项/权限项至少有默认状态和基础行为两类用例建议",
      "每个文档功能点至少有基础验证和扩展场景两类用例建议",
      "核心操作只写动作，预期结果只写可观测校验",
      "路径提示不能使用同上、见第一条或伪造路径"
    ]
  },
  "case_generation_blueprint": {
    "goal": "传给用例生成的保真目标",
    "clarification_inputs": {
      "status": "answered|not_required",
      "answers": [],
      "impact_on_cases": ["澄清答案对用例生成的影响"]
    },
    "expected_min_case_count": 1,
    "case_group_min_sum": 1,
    "case_groups": [
      {
        "group": "总览/功能点/配置项/风险/边界",
        "minimum_cases": 1,
        "candidate_titles": ["建议标题"],
        "source_item_ids": ["TP-001"],
        "coverage_items": ["覆盖项名称"],
        "step_hints": ["只写操作方向"],
        "expected_result_hints": ["只写校验方向"]
      }
    ],
    "do_not_merge": ["不能合并成同一条用例的覆盖项"],
    "scenario_expansion_rules": [
      "动作编号段落生成基础流程、异常/负面、高频操作、中断恢复、边界/替代/风险补足",
      "配置项/权限项逐项生成默认状态、基础行为和有证据的属性追加用例",
      "文档功能点生成基础验证和至少 1 条适用扩展场景"
    ],
    "item_split_rules": [
      "总览只能验证入口、页面和列表展示，不能替代单项覆盖",
      "配置项标题必须包含具体配置项名称",
      "文档功能点与配置项语义重复时保留配置项用例，并提示去重"
    ],
    "quality_gate_hints": [
      "检查 expected_min_case_count_formula 与覆盖矩阵一致",
      "检查【核心操作】与【预期结果】语义分离",
      "检查路径不出现页面页面、页页面、同上或见第一条",
      "检查输出内容无 U+FFFD 替换字符"
    ],
    "generation_rules": [
      "必须保留设备锚点和原始目标语义",
      "steps 只写可执行动作，校验写入 expected_result/assertions",
      "配置项/权限项必须逐项独立覆盖"
    ]
  },
  "path_and_assertion_hints": {
    "navigation_candidates": [
      {
        "target": "页面或入口",
        "path": "路径图谱中命中的路径；未命中则写目标页面",
        "confidence": "high|medium|low",
        "source": "path_map|user_goal|business_rule|clarification_answer"
      }
    ],
    "assertion_catalog": ["页面可见、入口正确、状态正确、跳转正确、提示正确、权限正确等断言"]
  },
  "risk_based_priorities": [
    {
      "risk": "目标锚点错误/路径误判/权限状态遗漏/能力集差异等",
      "priority": "P0|P1|P2",
      "mitigation": "生成或审核时的规避建议"
    }
  ],
  "missing_questions": [],
  "risk_notes": [],
  "downstream_hints": {
    "case_generation": [
      "用例生成必须优先消费 case_generation_blueprint 和 coverage_strategy",
      "必须按 item_id/coverage_items 逐项生成 case_outline，并保留 source_blueprint_item_ids 与 blueprint_trace",
      "必须按覆盖矩阵、expected_min_case_count_formula、路径提示和语义分离规则生成结构化用例"
    ],
    "case_review": ["审核必须检查 expected_min_case_count、覆盖矩阵和设备锚点"],
    "execution": ["执行前应确认的环境和参数"]
  },
  "evidence_usage": {
    "uploaded_document_full_text_used": false,
    "document_chunks_consumed": 0,
    "document_late_section_check": "not_applicable|pass|risk",
    "evidence_summary_used_as_preview_only": true,
    "authorized_sources": ["user_goal|business_rule|path_map|attachment|upstream_context"]
  }
}
```

## 输出前自检

落盘 `requirement_blueprint.json` 前，必须完成以下内部自检；自检结果不写入 JSON 文件：

- 是否仍包含平台外层字段：`task_id/status/summary/assistant_reply/result/contract_output/diagnostics/used_skills/used_workspace_files`。
- `structured_requirements.goal` 是否保留用户原始目标语义和关键锚点。
- `test_point_inventory` 是否覆盖动作段落、配置/权限项、文档功能点和风险项。
- `coverage_strategy.expected_min_case_count` 是否与公式和覆盖矩阵一致。
- `case_generation_blueprint.case_groups` 是否能被 `testcase-generator` 直接消费。
- `clarification_summary` 是否真实融入 `structured_requirements`、`coverage_strategy` 和 `case_generation_blueprint`。
- 是否存在“只有总览，没有单项覆盖”的问题。
- 所有输出字符串中是否无 `U+FFFD` 替换字符。

如果任一检查不通过，必须修复蓝图后再保存文件；不能落盘半成品 JSON。

## 交付要求

- 在 OpenCat CrewAI Thread / routeB runtime 中，使用 `read_file` / `save_artifact` / `register_artifact` / `finish_task` / `request_user_input`；在 OpenClaw/Codex 兼容运行时中，可将 `Read` / `Write` 视为等价文件读写能力。
- 需求澄清未完成时，只能调用 `request_user_input`，不得生成 `requirement_blueprint.json`，不得调用 `finish_task`；`message_to_user` 必须简短自然，5 个具体问题必须放入 `questions_json`，初步理解和推测内容放入 `payload_json`，不得把长篇需求分析塞进用户消息。
- 需求澄清完成且蓝图生成成功时，必须使用 `save_artifact` 保存 `requirement_blueprint.json`。
- 如果文件已由其他受控工具生成，则使用 `register_artifact` 登记该文件。
- 登记产物时必须设置清晰 metadata：
  - `artifact_type=requirement_blueprint_artifact`
  - `name=requirement_blueprint.json`
  - `read_hint=structured requirements and case_generation_blueprint for downstream test case generation`
- 保存或登记产物后，必须调用 `finish_task`；`artifacts_json` 中必须包含 `save_artifact` 或 `register_artifact` 返回的 artifact。
- 调用 `finish_task` 时只说明已生成的 artifact 路径、格式和下游读取方式；不要把完整 JSON 文件内容复制到最终文本。
- 不得只在最终文本中粘贴 JSON；最终文本不是有效的 OpenCat 任务交付。
- 不在 JSON 文件内输出实现说明、Markdown、注释、诊断信息或额外正文。
- 保持与下游 `testcase-generator` 兼容，不新增公开 API，不改变其字段含义。
