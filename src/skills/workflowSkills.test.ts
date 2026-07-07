import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const readSkill = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), 'skills', ...parts, 'SKILL.md'), 'utf8')

const requirementUnderstanding = (): string =>
  readSkill('requirement-understanding')

const testcaseGenerator = (): string =>
  readSkill('testcase-generator')

const functionTesting = (): string =>
  readSkill('function-testing')

const skillContents = (): string =>
  [
    requirementUnderstanding(),
    testcaseGenerator(),
    functionTesting(),
  ].join('\n')

describe('工作流 Skills', () => {
  test('不包含已移除执行别名、旧运行时术语或模板占位', () => {
    const content = skillContents()

    for (const forbidden of [
      'run' + '_visual_task',
      'app' + '_visual',
      '$' + '{new Date',
      'Bo' + 'ss',
      'route' + 'B',
      'Crew' + 'AI',
      'Open' + 'Cat',
      'Open' + 'Claw',
      '_cl' + 'aw',
      'Run' + 'ResourceRegistry',
      'open' + 'claude',
      'Open' + 'Claude',
      '上传文档' + '全文' + '消费门禁',
      'full_' + 'text_available',
      'Uploaded document ' + 'full-text context',
    ]) {
      expect(content).not.toContain(forbidden)
    }
  })

  test('需求分析和用例生成保留既有参考文件名', () => {
    const skillsWithReferences = [
      requirementUnderstanding(),
      testcaseGenerator(),
    ]

    for (const content of skillsWithReferences) {
      expect(content).toContain('Required Files')
      expect(content).toContain('knowledge/alarm_deviceshare_rules.md')
      expect(content).toContain('knowledge/alarm_business_rules.md')
      expect(content).toContain('knowledge/ydkj_path_map.md')
    }
  })

  test('requirement-understanding 在输出完整蓝图前强制 HITL', () => {
    const content = requirementUnderstanding()

    expect(content).toContain('强制人工澄清（HITL）')
    expect(content).toContain('保存 `requirement_blueprint.json` 前必须先完成人工澄清')
    expect(content).toContain('不得保存 `requirement_blueprint.json`')
    expect(content).toContain('user_requirement_story')
    expect(content).toContain('case_generation_blueprint')
    expect(content).toContain('case_generation_blueprint.expected_min_case_count')
  })

  test('testcase-generator 消费蓝图并保留可执行用例结构', () => {
    const content = testcaseGenerator()

    expect(content).toContain('user_requirement_story')
    expect(content).toContain('root.test_cases 存在')
    expect(content).toContain('JSON.parse')
    expect(content).toContain('visual_app_test')
    expect(content).toContain('顶层 `action_steps`')
    expect(content).toContain('parameter_overrides.action_steps')
    expect(content).toContain('coverage_matrix 每项都有 case 追踪')
    expect(content).toContain('actual_case_count >= expected_min_case_count')
    expect(content).toContain('总览用例')
  })

  test('function-testing 使用真实 AppTest 低层 session 和产物路径', () => {
    const content = functionTesting()

    for (const required of [
      'AppTest',
      'opencat_midscene_start',
      'opencat_midscene_observe',
      'opencat_midscene_action',
      'opencat_midscene_ai_act',
      'opencat_midscene_assert',
      'opencat_android_adb',
      'opencat_midscene_finish',
      'execution_plan_path',
      'route_memory_path',
      'reflection_report_path',
      'execution_report_path',
      'visual_execution_memory',
      'route_reuse',
      'current_page_reuse',
    ]) {
      expect(content).toContain(required)
    }
  })
})
