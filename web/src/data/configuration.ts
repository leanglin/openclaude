// Seeded from src/utils/envValidation.ts, src/utils/config.ts, and the README.

export interface SettingsFile {
  path: string
  scope: string
  notes: string
}

export const settingsFiles: SettingsFile[] = [
  {
    path: '~/.openclaude/settings.json',
    scope: 'user',
    notes: '机器上所有项目的默认全局设置路径；OPENCLAUDE_CONFIG_DIR 会把它移动到配置的 config home 下。',
  },
  {
    path: '.openclaude/settings.json',
    scope: 'project',
    notes: '共享项目设置，通常提交到仓库。',
  },
  {
    path: '.openclaude/settings.local.json',
    scope: 'local',
    notes: '单个项目的本机覆盖配置，通常会被 gitignore。',
  },
  {
    path: '~/.openclaude/keybindings.json',
    scope: 'user',
    notes: '默认快捷键覆盖配置路径；OPENCLAUDE_CONFIG_DIR 会把它移动到配置的 config home 下。',
  },
  {
    path: 'CLAUDE.md / .claude/CLAUDE.md',
    scope: 'project',
    notes: '会话启动时加载到上下文中的项目说明。',
  },
]

export interface SettingOption {
  key: string
  description: string
}

export const settingOptions: SettingOption[] = [
  { key: 'model', description: "默认模型，可以是 'sonnet' 这类别名或完整模型名。" },
  { key: 'provider', description: '新会话默认使用的 provider preset。' },
  { key: 'effort', description: '默认 effort level：low、medium、high、xhigh 或 max。' },
  { key: 'agent', description: '新会话默认使用的 agent。' },
  { key: 'permissions', description: '工具 allow/deny 规则，以及默认 permission mode。' },
  { key: 'env', description: '应用到每个会话的环境变量。' },
  { key: 'theme', description: '终端配色主题。' },
  { key: 'verbose', description: '默认启用 verbose 输出。' },
  { key: 'allowAutoUpdates', description: '启用或禁用 auto-updater。' },
  { key: 'hooks', description: '在 tool event 上运行的 shell hooks（PreToolUse、PostToolUse 等）。' },
]

export interface EnvVar {
  name: string
  description: string
}

export const envVars: EnvVar[] = [
  { name: 'ANTHROPIC_API_KEY', description: 'Anthropic API key，也是在 --bare mode 下的严格认证路径。' },
  { name: 'ANTHROPIC_AUTH_TOKEN', description: 'Anthropic API key 的 Bearer token 替代项。' },
  { name: 'OPENAI_API_KEY', description: 'OpenAI-compatible provider 和 gateway 使用的 key（包括 Opengateway）。' },
  { name: 'OPENAI_BASE_URL', description: 'OpenAI-compatible /v1 endpoint 的 Base URL（OpenRouter、LM Studio、LiteLLM 等）。' },
  { name: 'OPENAI_MODEL', description: '向 OpenAI-compatible endpoint 请求的模型名。' },
  { name: 'GOOGLE_API_KEY', description: 'Google Gemini API key。' },
  { name: 'NEARAI_API_KEY', description: 'NEAR AI unified gateway key。' },
  { name: 'MIMO_API_KEY', description: 'Xiaomi MiMo API key。' },
  { name: 'OPENCODE_API_KEY', description: 'OpenCode Zen / Go gateway key。' },
  { name: 'GITHUB_TOKEN', description: 'GitHub Models 和 PR 工作流使用的 GitHub token。' },
  { name: 'OPENCLAUDE_CONFIG_DIR', description: '首选配置目录覆盖项；未设置时默认为 ~/.openclaude。' },
  { name: 'CLAUDE_CONFIG_DIR', description: '旧版配置目录覆盖项；仅在 OPENCLAUDE_CONFIG_DIR 未设置时使用。' },
  { name: 'HTTP_PROXY / HTTPS_PROXY', description: '通过代理转发 API 流量。' },
  { name: 'NODE_EXTRA_CA_CERTS', description: '为企业 TLS 中间检查提供额外 CA 证书。' },
  { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', description: '禁用非必要网络流量。' },
]
