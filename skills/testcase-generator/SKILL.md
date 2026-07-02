---
name: testcase-generator
description: 用例生成子智能体的高覆盖结构化测试用例生成 Skill。适用于 test_case_generation_claw 基于 Boss 授权资产、需求理解蓝图、业务规则、页面路径图谱、上传附件和用户目标生成覆盖模块/功能点/流程/配置/权限/状态/异常的纯 `test_cases.json` 文件。
user-invocable: true
triggers:
  - generate test cases
  - testcase-generator
  - 测试用例生成
  - 生成用例
  - 结构化测试用例
  - APP功能测试用例
  - 回归测试用例
  - 高覆盖用例生成
allowed-tools:
  - Read
  - Write
  - get_current_task_context
  - list_run_resources
  - get_resource_manifest
  - read_resource
  - search_resource
  - read_resource_chunk
  - read_file
  - list_workspace_skills
  - read_workspace_skill
  - begin_artifact
  - append_artifact_chunk
  - finalize_artifact
  - abort_artifact
  - save_artifact
  - register_artifact
  - finish_task
  - request_user_input
---

# 用例生成 Skill（高覆盖纯 JSON 版）

## 1. 功能定位

接收 Boss 下发给 `test_case_generation_claw` 的用例生成任务，基于 Boss 授权资产、当前任务参数、上游需求理解蓝图、RunResourceRegistry、业务规则文档、页面路径图谱和用户目标，生成平台可消费的结构化测试用例文件。

本 Skill 的最终主产物必须是纯 `test_cases.json`，文件内容只允许是完整 JSON 对象：

```json
{
  "test_cases": []
}
```

不得在 `test_cases.json` 中输出：

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
workspace 绝对路径
```

本 Skill 的核心目标不是“生成少量示例用例”，而是：

```text
围绕需求蓝图和授权文档，尽可能完整覆盖模块、功能点、流程、配置项、权限项、状态、边界、异常和执行路径。
```

---

## 2. 生成原则：覆盖优先，不允许概览替代细项

### 2.1 禁止少量概览化生成

禁止只生成以下类型的少量用例：

```text
1 条主流程
1 条异常流程
1 条边界流程
1 条 UI 展示
```

除非用户明确要求“只生成少量示例”。

如果需求、蓝图、文档中包含多个模块、功能点、动作段落、配置项、权限项、状态或异常，必须逐项拆解并生成用例。

### 2.2 总览用例不能替代细项用例

允许生成模块总览/列表展示用例，但总览用例只能覆盖：

```text
入口是否存在
页面是否展示
模块列表是否出现
数量/名称/顺序是否正确
```

总览用例不能抵扣：

```text
单个功能点基础验证
单个配置项默认状态
单个权限项基础行为
单个动作流程闭环
单个异常/边界场景
```

### 2.3 先建覆盖账，再生成用例

必须先在内部建立覆盖账：

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

然后按覆盖账逐项生成用例。

最终 `test_cases.json` 不需要输出这些内部账本作为根字段，但每条 case 可以保留以下追踪字段，供审核和执行优化使用：

```text
coverage_items
source_blueprint_item_ids
source_item_ids
blueprint_trace
parameter_overrides.coverage_trace
parameter_overrides.navigation_route
parameter_overrides.path_map_match_status
```

---

## 3. 输入来源与授权边界

### 3.1 必须先读取当前任务上下文

执行前必须调用：

```text
get_current_task_context
```

并检查：

```text
user_goal
task parameters
previous_outputs
upstream_artifact_manifest
run_resource_manifest
artifact_refs
structured_requirements
case_generation_blueprint
coverage_strategy
test_point_inventory
path_and_assertion_hints
asset_refs
workspace read set
```

### 3.2 资源读取优先级

优先使用 routeB run 级资源工具：

```text
list_run_resources
read_resource
search_resource
read_resource_chunk
```

用于读取：

```text
requirement_blueprint.json
业务规则文档
页面路径图谱
上传附件
Excel/CSV 测试需求
历史用例或示例
```

只有在资源工具不可用且 Boss/routeB 明确给出安全文本路径时，才允许使用 `read_file` 兼容读取。

### 3.3 授权边界

只能使用 Boss 提供的用户目标、任务参数、上游资产摘要、RunResourceRegistry、`asset_refs`、`previous_outputs`、角色合同和 workspace Skill read set。

禁止：

- 自行扫描无关目录；
- 绕过 Boss 资产授权补充事实来源；
- 编造未授权资产 ID；
- 编造 workspace 绝对路径；
- 编造运行器状态、实际读取文件列表或 active skill 信息；
- 将运行器元数据写入 `test_cases.json` 根对象。

---


---

## 3.4 Required Files：必须优先尝试读取的工作区参考文件

根据任务所在 workspace 和 routeB RunResourceRegistry，必须优先尝试读取以下可选参考文件；缺失时继续生成，但必须在 `parameter_overrides.path_map_match_status` 或可选 `case_generation_report.json` 中说明缺失或未匹配状态：

- `knowledge/alarm_deviceshare_rules.md`
- `knowledge/alarm_business_rules.md`
- `knowledge/ydkj_path_map.md`

读取优先级：

1. 优先通过 `list_run_resources` / `get_resource_manifest` 查找已经注册到 RunResourceRegistry 的路径图谱或业务规则资源。
2. 如果 RunResourceRegistry 中存在名称、路径或 `read_hint` 命中 `ydkj_path_map.md` / 页面路径图谱 / path map 的资源，必须通过 `read_resource` 或 `search_resource` 读取。
3. 如果 run 级资源中没有，但 workspace read set 或任务上下文明确授权了 `knowledge/ydkj_path_map.md`，才允许使用 `read_file` 兼容读取。
4. 不允许自行扫描未授权目录；不允许编造路径图谱内容。
5. `ydkj_path_map.md` 是移动爱家 APP 用例生成的可执行导航规划输入，不是普通参考资料。

如果 `ydkj_path_map.md` 读取成功，后续每条 APP 视觉测试用例都必须尝试用它匹配目标页面的完整路径，并把逐跳导航写入：

- 顶层 `steps`
- `parameter_overrides.test_steps`
- 顶层 `action_steps`
- `parameter_overrides.action_steps`
- `parameter_overrides.openclaw_test_instruction` 的【初始导航】
- `parameter_overrides.navigation_route`
- `parameter_overrides.path_map_match_status`

如果目标页面无法在路径图谱中匹配，不得伪造路径；必须将 `parameter_overrides.path_map_match_status` 标记为 `unmatched`，并使用“目标页面”占位导航。


## 4. 缺失信息处理策略

为避免“暂停”和“降级”规则冲突，统一按以下策略处理：

1. **用户需求缺失或完全无法理解**：必须调用 `request_user_input`，向用户提出具体澄清问题；不得落盘 `test_cases.json`；不得调用 `finish_task`；不得只在最终文本中写澄清问题。
2. **需求理解蓝图缺失，但用户目标足够清晰**：继续基于用户目标和授权文档生成；不要因此只生成少量用例。
3. **业务规则文件缺失，但用户需求足够清晰**：不暂停，不编造业务规则；仅基于用户目标、Boss 授权资产和上游产出生成用例。
4. **页面路径图谱缺失或未匹配到目标页面**：不暂停，不伪造路径；保留结构化用例，导航步骤使用“目标页面”占位，并在 `parameter_overrides.path_map_match_status` 中标记 `unmatched`。
5. **部分业务规则缺失但不影响主路径生成**：继续生成，并把预期结果限定为已有需求和已授权文档能够支持的可观测结果。
6. **缺失信息会导致断言不可验证**：不要写成确定性断言，应将用例缩小到可验证范围，或将对应场景改为低优先级风险补足用例。
7. **模块/功能点信息很多**：不得以“内容较多”为由只生成摘要用例；必须按覆盖账生成完整用例，必要时生成多条短用例。

---

## 5. 覆盖建账流程

必须按以下顺序建立覆盖账，不要跳步。

### 5.1 提取需求理解蓝图

优先从上游 `requirement_blueprint.json` 或 Task.context 读取：

```text
structured_requirements
test_point_inventory
coverage_strategy
case_generation_blueprint
path_and_assertion_hints
risk_based_priorities
clarification_summary
```

如果存在 `case_generation_blueprint.case_groups`，必须优先消费，不得忽略。

### 5.2 建立模块清单 module_inventory

从用户目标、上传文档、业务规则、需求蓝图中提取模块：

```text
一级模块
二级模块
页面模块
业务区域
功能入口
配置页
权限页
状态页
列表页
详情页
弹窗/Toast/空态
```

每个模块至少记录：

```json
{
  "module_id": "MOD-001",
  "name": "模块名称",
  "source": "user_goal|requirement_blueprint|business_rule|attachment|path_map",
  "evidence": "依据摘要",
  "priority": "P0|P1|P2",
  "features": [],
  "minimum_case_count": 0
}
```

要求：

- 文档中出现的明确模块不得遗漏。
- 如果文档有“模块一/模块二/模块三/附录/统计口径/文案库/配置列表”，必须逐项检查。
- 不得只覆盖文档前半段模块。

### 5.3 建立功能点清单 feature_inventory

每个模块下继续提取功能点：

```text
按钮/入口
查询/筛选
新增/编辑/删除
开启/关闭
保存/提交/取消
展示字段
状态文案
权限控制
设备能力差异
空态/异常态
统计口径
联动规则
```

每个功能点至少记录：

```json
{
  "feature_id": "FEA-001",
  "module_id": "MOD-001",
  "name": "功能点名称",
  "feature_type": "display|action|config|permission|state|data|navigation|exception|boundary",
  "source": "requirement_blueprint|business_rule|user_goal|attachment",
  "evidence": "依据摘要",
  "minimum_case_count": 0
}
```

### 5.4 建立动作流程清单 action_flow_inventory

识别所有包含动作的流程段落：

```text
点击
跳转
设置
填写
保存
删除
切换
筛选
查看详情
上传
下载
分享
授权
取消
重试
返回
```

每个动作流程生成至少 5 条用例方向：

```text
基础流程
异常/负面
高频操作
中断恢复
边界/替代/风险补足
```

### 5.5 建立配置/权限项清单 config_permission_inventory

识别：

```text
配置项
权限项
开关项
勾选项
可取消/不可取消项
子页面设置项
能力集依赖项
默认状态项
```

每个配置/权限项至少生成：

```text
默认状态
基础行为
```

有证据时追加：

```text
不可取消
可取消/重新勾选
取消提示
子页面设置
设备能力集差异
权限差异
```

### 5.6 建立状态/权限矩阵 state_permission_inventory

识别状态维度：

```text
账号角色：主人/共享用户/管理员/普通用户
设备状态：在线/离线/休眠/无能力集
网络状态：正常/弱网/断网
数据状态：有数据/无数据/过期数据/异常数据
权限状态：有权限/无权限/部分权限
功能状态：开启/关闭/未开通/已过期
```

不能穷举爆炸时，至少使用 pairwise 思路覆盖：

```text
主路径状态
每个关键状态至少 1 条
每个高风险权限差异至少 1 条
每个数据空态至少 1 条
```

### 5.7 建立异常/边界清单 exception_boundary_inventory

识别：

```text
网络异常
接口失败
空数据
重复点击
快速连续操作
切后台恢复
页面刷新
返回中断
超长输入
非法输入
时间边界
数量边界
权限不足
设备离线
能力集不支持
```

每个 P0/P1 模块至少应有异常/边界覆盖，除非需求明确不测。

---

## 6. 高覆盖最低数量公式

### 6.1 覆盖来源变量

必须计算以下变量：

```text
B = 上游蓝图 expected_min_case_count，缺失则 0
G = sum(case_generation_blueprint.case_groups.minimum_cases)，缺失则 0
C = sum(coverage_strategy.coverage_matrix.minimum_case_count)，缺失则 0
M = 模块数量
F = 功能点数量
P = 动作流程数量
N = 配置/权限项数量
S = 状态/权限差异项数量
E = 异常/边界项数量
A = 有证据的属性追加项数量，如可取消、不可取消、提示、子页面、能力集依赖
R = 高风险项数量
```

### 6.2 最低数量公式

默认最低数量：

```text
expected_min_case_count =
max(
  B,
  G,
  C,
  M * 2 + F * 3 + P * 5 + N * 2 + S + E + A + R,
  sum(module.minimum_case_count),
  sum(feature.minimum_case_count)
)
```

解释：

- 每个模块至少 2 条：模块入口/展示 + 模块核心流程或状态。
- 每个功能点至少 3 条：基础验证 + 异常/边界或状态 + 交互/断言。
- 每个动作流程至少 5 条：基础、异常、高频、中断、边界/替代。
- 每个配置/权限项至少 2 条：默认状态 + 基础行为。
- 状态、异常、属性、高风险项额外增加。

如果上游需求理解蓝图给出的 `expected_min_case_count` 更高，必须使用更高值。

### 6.3 禁止降低数量

禁止：

```text
用 N+1 作为全局兜底
用 3～5 条作为复杂需求兜底
用模块总览抵扣功能点用例
用文档功能点粗略合并到 1 条
因为输出长就自行减少数量
```

### 6.4 数量过大时的处理

如果计算结果超过平台或模型单次输出能力：

- 不得悄悄减少覆盖。
- 应优先生成完整 JSON。
- 如必须分批，应调用 `request_user_input` 或遵循 Boss 提供的批量策略。
- 若 Boss 明确要求单文件，则必须在单文件中生成全部用例。
- 不得输出“已覆盖全部”但实际只生成少量用例。

---

## 7. 用例生成策略

### 7.1 从 case_generation_blueprint 生成

如果上游存在：

```text
case_generation_blueprint.case_groups
```

必须逐组生成：

```text
每个 case_group 至少生成 minimum_cases 条
candidate_titles 优先转为用例标题
source_item_ids 必须写入每条用例的 source_blueprint_item_ids
coverage_items 必须写入每条用例的 coverage_items
step_hints 转换为 steps/action_steps
expected_result_hints 转换为 expected_result/assertions
```

不得把多个 case_group 合并成一条用例。

### 7.2 从 coverage_matrix 生成

如果存在：

```text
coverage_strategy.coverage_matrix
```

必须逐项生成：

```text
每个 coverage_matrix item 至少生成 minimum_case_count 条
suggested_case_titles 优先转为用例标题
assertions 转为用例 assertions
item_id 写入 source_blueprint_item_ids
```

### 7.3 从 test_point_inventory 生成

如果存在：

```text
test_point_inventory
```

必须对每个 `must_have=true` 的测试点至少生成 1 条；如果测试点类型为动作流程、配置项、权限项、状态、异常、边界，则按对应最低数量规则扩展。

### 7.4 从模块/功能点清单生成

当上游蓝图不完整时，根据内部 `module_inventory` 和 `feature_inventory` 生成：

```text
每个模块至少 2 条
每个功能点至少 3 条
每个动作流程至少 5 条
每个配置/权限项至少 2 条
每个关键状态/异常至少 1 条
```

---

## 8. 用例类型库

每个功能点优先从以下类型中选择，不要只生成基础用例：

```text
基础流程
入口展示
默认状态
基础行为
配置变更
权限差异
设备能力差异
状态联动
空态展示
异常提示
弱网/断网
接口失败
重复点击
高频操作
中断恢复
返回恢复
边界值
非法输入
数据刷新
页面跳转
按钮状态
Toast/弹窗/文案
子页面进入
不可取消/可取消
保存/取消/撤销
```

对于 P0/P1 功能，至少包含：

```text
1 条基础流程
1 条异常/边界
1 条状态/权限/交互反馈
```

---

## 9. 用例结构要求

最终 `test_cases.json` 文件必须至少包含根字段：

```text
test_cases
```

每条用例至少包含：

```text
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
```

每条用例可按需包含：

```text
coverage_items
source_blueprint_item_ids
source_item_ids
blueprint_trace
parameter_overrides.coverage_trace
parameter_overrides.path_map_match_status
parameter_overrides.navigation_route
parameter_overrides.module_id
parameter_overrides.feature_id
parameter_overrides.case_type
parameter_overrides.path_map_source
```

禁止输出或默认不输出：

```text
source_asset_ids
used_workspace_files
parameter_overrides.workspace_skill_runtime
workspace 绝对路径
active_skill_ids
顶层 diagnostics
顶层 contract_output
顶层 result
顶层 status
顶层 summary
```

---


---

## 9.5 页面路径图谱强制使用规则：基于 `ydkj_path_map.md` 生成逐跳导航

本节优先级高于普通 `action_steps` 生成规则。APP 视觉测试用例必须优先使用 `ydkj_path_map.md` 生成真实可执行导航路径。

### 9.5.1 路径图谱不是参考提示，而是导航规划输入

生成测试步骤时，必须把 `ydkj_path_map.md` 当作可执行导航规划输入：

1. 先从 `parameter_overrides.test_goal`、`test_objective`、标题、步骤、预期结果、覆盖项、功能点名称中识别目标页面或目标入口。
2. 再在 `ydkj_path_map.md` 中按目标页面、页面别名、入口元素、功能关键词匹配完整路径。
3. 命中完整路径后，必须逐跳展开，不得把完整路径压缩成一条。
4. 命中部分路径时，已命中的部分必须逐跳展开，未命中部分使用目标页面占位，并标记 `path_map_match_status="partial"`。
5. 完全未命中时，不得伪造路径，标记 `path_map_match_status="unmatched"`。

示例：目标页面为 `AI时光页` 时，如果路径图谱中存在：

```text
移动爱家首页 -> 移动看家设备列表页 -> 直播页 -> AI时光页
```

则必须展开为：

```text
在移动爱家首页进入移动看家设备列表页
在移动看家设备列表页进入直播页
在直播页进入AI时光页
```

禁止输出：

```text
进入移动爱家首页 -> 移动看家设备列表页 -> 直播页 -> AI时光页页面
优先使用路径图谱进入目标页面
同上
见第一条
沿用前置路径
```

### 9.5.2 `steps` 与 `parameter_overrides.test_steps` 的导航要求

每条 APP 用例的 `steps` 和 `parameter_overrides.test_steps` 必须包含展开后的逐跳导航：

- 每一段页面跳转必须是独立步骤。
- 完成逐跳导航后，再写具体业务动作。
- 校验统一写入 `expected_result` 和 `assertions`，不要混入【核心操作】。
- 不得出现“页面页面”“页页面”“页面的页面”等重复词；路径名称包含“页”时不要再追加“页面”。

### 9.5.3 `action_steps` 的路径覆盖要求

顶层 `action_steps` 与 `parameter_overrides.action_steps` 必须完全一致，并且必须覆盖路径图谱中的每一段页面跳转。

每个导航步骤必须使用结构化 `aiAct`，并包含：

```json
{
  "step_index": 1,
  "action": "aiAct",
  "intent": "在「直播页」点击「AI时光」，进入「AI时光页」",
  "target": {"text": "AI时光"},
  "value": "",
  "source": "workspace_path_map",
  "navigation_step": true,
  "page_from": "直播页",
  "page_to": "AI时光页",
  "assert_after": [
    {
      "kind": "text_visible",
      "expected": "AI时光"
    }
  ]
}
```

业务操作步骤可以继续使用：

```json
{
  "step_index": 2,
  "action": "aiAct",
  "intent": "查看目标配置项默认状态",
  "target": {},
  "value": "",
  "source": "testcase_generator",
  "navigation_step": false,
  "assert_after": [
    {
      "kind": "visual_state",
      "expected": "页面展示目标配置项默认状态",
      "assertion": "页面展示目标配置项默认状态"
    }
  ]
}
```

### 9.5.4 OpenClaw 指令中的【初始导航】

`parameter_overrides.openclaw_test_instruction` 的【初始导航】必须写路径图谱展开后的逐跳导航：

允许：

```text
【初始导航】在移动爱家首页进入移动看家设备列表页；在移动看家设备列表页进入直播页；在直播页进入AI时光页
```

不允许：

```text
【初始导航】优先使用路径图谱进入目标页面
【初始导航】移动爱家首页 -> 移动看家设备列表页 -> 直播页 -> AI时光页
【初始导航】同上
```

### 9.5.5 path_map_match_status 写入规则

每条 APP 用例必须在 `parameter_overrides` 中写入：

```json
{
  "path_map_match_status": "matched|partial|unmatched",
  "navigation_route": ["移动爱家首页", "移动看家设备列表页", "直播页", "AI时光页"],
  "path_map_source": "knowledge/ydkj_path_map.md"
}
```

取值规则：

- `matched`：目标页面在 `ydkj_path_map.md` 中命中完整路径。
- `partial`：只命中部分路径，未命中部分使用目标页面占位。
- `unmatched`：没有命中路径图谱，不得伪造路径。

### 9.5.6 生成前路径自检

保存 `test_cases.json` 前必须自检：

- 已读取或尝试读取 `ydkj_path_map.md`。
- 每条 APP 用例都尝试匹配目标页面。
- `steps` 不能出现单条压缩式 `A -> B -> C`。
- 顶层 `action_steps` 与 `parameter_overrides.action_steps` 至少覆盖路径图谱中的每一段页面跳转。
- `openclaw_test_instruction` 中【核心操作】与【预期结果】语义不重叠。
- 无法匹配目标页面时，必须写 `path_map_match_status="unmatched"`，不能伪造路径。
- 所有输出字符串中不得出现 `U+FFFD` 替换字符。


## 10. action_steps 生成规则

顶层 `action_steps` 与 `parameter_overrides.action_steps` 必须完全一致。

### 10.1 导航步骤

导航步骤必须使用结构化 `aiAct`：

```json
{
  "step_index": 1,
  "action": "aiAct",
  "intent": "在「直播页」点击「AI时光」，进入「AI时光页」",
  "target": {"text": "AI时光"},
  "value": "",
  "source": "workspace_path_map",
  "navigation_step": true,
  "page_from": "直播页",
  "page_to": "AI时光页",
  "assert_after": [
    {
      "kind": "text_visible",
      "expected": "AI时光"
    }
  ]
}
```

### 10.2 业务操作步骤

业务操作步骤可继续使用：

```json
{
  "step_index": 2,
  "action": "aiAct",
  "intent": "查看目标配置项默认状态",
  "target": {},
  "value": "",
  "source": "testcase_generator",
  "navigation_step": false,
  "assert_after": [
    {
      "kind": "visual_state",
      "expected": "页面展示目标配置项默认状态",
      "assertion": "页面展示目标配置项默认状态"
    }
  ]
}
```

### 10.3 step_index

`step_index` 必须从 1 开始连续递增，不得跳号或重复。

### 10.4 路径展开

`steps` 与 `parameter_overrides.test_steps` 必须展开逐跳导航：

允许：

```text
在移动爱家首页进入移动看家设备列表页
在移动看家设备列表页进入直播页
在直播页进入AI时光页
```

禁止：

```text
进入移动爱家首页 -> 移动看家设备列表页 -> 直播页 -> AI时光页页面
同上
见第一条
沿用前置路径
```

---

## 11. OpenClaw 指令格式

`parameter_overrides.openclaw_test_instruction` 必须使用以下结构：

```text
帮我按照以下步骤执行测试：
【初始导航】{按路径图谱展开后的逐跳导航}
【核心操作】{纯操作步骤，不含校验}
【预期结果】{可校验的预期结果}
```

要求：

- 【核心操作】只写操作，不写校验。
- 【预期结果】只写可观测结果，不复述操作过程。
- 每条用例必须引用具体配置项、功能点、页面或业务对象名称，不能写“各配置项”“所有项”等泛称替代逐项校验。
- 与 `steps`、`expected_result`、`assertions` 语义一致。

---

## 12. case_id 规则

### 12.1 生成规则

使用稳定、可读、连续的 case_id：

```text
TC-{模块序号}-{功能序号}-{场景序号}
```

示例：

```text
TC-M01-F01-001
TC-M01-F01-002
TC-M02-F03-001
```

如果 Boss 或上游要求特定格式，优先使用 Boss 指定格式。

### 12.2 不重复

`case_id` 不得重复。

### 12.3 不按覆盖项合并

不同覆盖项不得因为标题相似而共用一个 case_id。

---

## 13. 生成后自检

保存 `test_cases.json` 前必须执行自检。

### 13.1 数量自检

检查：

```text
actual_case_count >= expected_min_case_count
```

如果未达到：

- 必须继续补充用例；
- 不得保存声称完整覆盖的 `test_cases.json`；
- 如果无法补齐，必须调用 `request_user_input` 或返回 blocked。

### 13.2 覆盖自检

检查：

```text
每个模块至少有用例
每个 must-have 功能点至少有用例
每个动作流程达到最低数量
每个配置/权限项至少有默认状态和基础行为
每个 P0/P1 模块至少有异常/边界/状态覆盖
总览用例没有替代细项用例
coverage_matrix 每项均有 case 追踪
```

### 13.3 字段自检

检查每条用例：

```text
必填字段齐全
顶层 action_steps 与 parameter_overrides.action_steps 完全一致
steps 与 parameter_overrides.test_steps 语义一致
expected_result 与 parameter_overrides.expected_result 语义一致
assertions 与 parameter_overrides.assertions 语义一致
openclaw_test_instruction 包含三段
navigation_step 有 page_from/page_to
不出现同上/见第一条/沿用前置路径
不出现页面页面/页页面/U+FFFD
```

### 13.4 下游执行兼容自检

检查：

```text
function-testing Skill 能按 test_cases 根字段读取
APP/Web 执行能按 action_steps 执行
执行优化器能按 navigation_route/page_from/page_to 分组
用例审核能保留所有执行字段
```

---

## 14. 输出与保存要求

### 14.1 主用例产物

必须使用事务型 artifact 写入协议保存：

```text
test_cases.json
```

写入步骤必须严格按顺序执行：

```text
1. begin_artifact(relative_path="test_cases.json", kind="test_case_artifact", validation_mode="auto", ...)
2. 使用 begin_artifact 返回的 artifact_id，按 chunk_index=1..N 连续调用 append_artifact_chunk
3. finalize_artifact(artifact_id=同一个 begin_artifact 返回值, expected_chunk_count=N)
```

严禁自造或猜测 `artifact_id`。`append_artifact_chunk` 和 `finalize_artifact` 的 `artifact_id` 只能来自当前文件对应的 `begin_artifact` 返回值。

`save_artifact` 仅是小内容兼容入口，不适合大 JSON 用例文件；如果 `save_artifact` 返回 `content_too_large_for_save_artifact`，必须从 `begin_artifact` 重新开始，不得直接调用 `append_artifact_chunk`。

文件内容只包含：

```json
{
  "test_cases": [...]
}
```

metadata：

```text
artifact_type=test_case_artifact
name=test_cases.json
read_hint=generated high-coverage test cases for downstream review and execution
case_artifact_format=test_cases_root
coverage_mode=high_coverage
```

### 14.2 可选生成报告

如需要记录覆盖账，可另存：

```text
case_generation_report.json
```

用于审核和排查，但不得混入主 `test_cases.json`。

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

metadata：

```text
artifact_type=case_generation_report
name=case_generation_report.json
read_hint=case generation coverage diagnostics; not the execution case artifact
```

### 14.3 finish_task

保存或登记产物后，必须调用 `finish_task`。

`finish_task` 中说明：

```text
已生成 test_cases.json
用例数量
是否达到 expected_min_case_count
下游应读取 root.test_cases
```

不要求把完整 `test_cases` 数组复制到固定后端字段。

---

## 15. 失败与降级

- 用户需求为空、任务目标为空或无法确定测试对象：不生成 `test_cases.json`，调用 `request_user_input`。
- 上游蓝图缺失但用户目标清晰：继续生成，不得只生成少量示例。
- 业务规则缺失：继续基于授权信息生成，避免扩展未授权规则。
- 路径图谱缺失：保留结构化用例，导航路径使用目标页面占位，并写 `path_map_match_status=unmatched`。
- LLM 输出字段不完整：补齐到当前结构化用例合同；无法补齐时不要落盘最终 JSON。
- 计算出 expected_min_case_count 但实际无法达到：调用 `request_user_input` 或 blocked，不得伪称完整覆盖。

---

## 16. 响应风格

对话层只给出简短生成结果或失败原因。

不要把说明性文本混入 `test_cases.json`。

不要在最终文本中粘贴完整 JSON；最终交付必须通过 artifact。
