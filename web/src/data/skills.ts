// Seeded from src/skills/bundledSkills.ts + src/i18n/languages/en.ts.

export interface Skill {
  name: string
  invocation: string
  description: string
}

export const skills: Skill[] = [
  {
    name: 'batch',
    invocation: '/batch',
    description:
      '研究并规划大规模改动，然后在 5-30 个隔离 worktree agent 中并行执行，每个 agent 打开一个 PR。适合可拆成独立单元的机械式批量改动，例如 migration、refactor、批量重命名。',
  },
  {
    name: 'loop',
    invocation: '/loop',
    description:
      '按固定间隔运行 prompt，或动态重新调度。适合轮询状态、看护工作流，或在当前会话中反复运行同一个 prompt。',
  },
  {
    name: 'simplify',
    invocation: '/simplify',
    description:
      '检查已改代码的复用性、质量和效率，并修复发现的问题。',
  },
  {
    name: 'debug',
    invocation: '/debug',
    description: '为当前会话启用 debug logging，并辅助诊断问题。',
  },
  {
    name: 'update-config',
    invocation: '/update-config',
    description:
      '通过 settings.json 配置 harness：permissions、env vars、hooks，以及“从现在开始当 X 时...”这类自动化行为。',
  },
  {
    name: 'keybindings-help',
    invocation: '/keybindings-help',
    description:
      '自定义快捷键：重绑定按键、添加 chord 绑定，或修改 keybindings 文件（默认 ~/.openclaude/keybindings.json；可通过 OPENCLAUDE_CONFIG_DIR 覆盖）。',
  },
]
