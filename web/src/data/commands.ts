// Seeded from src/commands.ts, src/i18n/languages/en.ts, and per-command
// argumentHint fields in src/commands/*/index.ts in the CLI source.
// Hidden, ant-only, and feature-gated commands are intentionally excluded.

export type CommandCategory =
  | 'session'
  | 'context'
  | 'models'
  | 'workflow'
  | 'tools'
  | 'customization'
  | 'diagnostics'

export interface SlashCommand {
  name: string
  description: string
  category: CommandCategory
  /** argument hint, mirrors the CLI's autocomplete hint */
  args?: string
}

export const commandCategories: { id: CommandCategory; label: string; blurb: string }[] = [
  {
    id: 'session',
    label: '会话与对话',
    blurb: '启动、恢复、分支和导出对话，并在设备之间接续。',
  },
  {
    id: 'context',
    label: '上下文与记忆',
    blurb: '控制 agent 可见内容：工作目录、上下文用量、memory 和项目知识。',
  },
  {
    id: 'models',
    label: '模型与 Provider',
    blurb: '选择模型、连接 provider、登录或退出，并查看用量限制。',
  },
  {
    id: 'workflow',
    label: '代码审查与 git',
    blurb: '审查 diff 和 pull request，运行安全审查，并连接 GitHub 或 Slack。',
  },
  {
    id: 'tools',
    label: '工具与集成',
    blurb: 'MCP server、language server、IDE、plugin、skill、agent 和 hook。',
  },
  {
    id: 'customization',
    label: '界面与自定义',
    blurb: '主题、快捷键、vim mode、状态行和编辑体验。',
  },
  {
    id: 'diagnostics',
    label: '帮助与诊断',
    blurb: '检查状态、诊断安装，并查看会话统计。',
  },
]

export const commands: SlashCommand[] = [
  // ── sessions & conversations ─────────────────────────────────────────
  { name: 'clear', description: '清空对话历史并释放上下文', category: 'session' },
  { name: 'compact', description: '清空对话历史，但在上下文中保留摘要', category: 'session', args: '[instructions]' },
  { name: 'resume', description: '恢复之前的对话', category: 'session', args: '[conversation id or search term]' },
  { name: 'rename', description: '重命名当前对话', category: 'session', args: '[name]' },
  { name: 'branch', description: '从当前点创建一个对话分支', category: 'session', args: '[name]' },
  { name: 'rewind', description: '将代码和/或对话恢复到之前的某个点', category: 'session' },
  { name: 'export', description: '将当前对话导出到文件或剪贴板', category: 'session', args: '[filename]' },
  { name: 'copy', description: '复制 agent 最近一次回复到剪贴板（或用 /copy N 复制倒数第 N 条）', category: 'session', args: '[N]' },
  { name: 'btw', description: '提出一个旁路小问题，不打断主对话', category: 'session', args: '<question>' },
  { name: 'goal', description: '设置和管理会话完成目标', category: 'session', args: '[condition|status|pause|resume|clear]' },
  { name: 'tasks', description: '列出并管理后台任务', category: 'session' },
  { name: 'session', description: '显示远程会话 URL 和二维码', category: 'session' },
  { name: 'desktop', description: '在 Claude Desktop 中继续当前会话', category: 'session' },
  { name: 'mobile', description: '显示下载 Claude mobile app 的二维码', category: 'session' },
  { name: 'exit', description: '退出 REPL', category: 'session' },

  // ── context & memory ─────────────────────────────────────────────────
  { name: 'context', description: '显示当前上下文用量', category: 'context' },
  { name: 'files', description: '列出当前上下文中的所有文件', category: 'context' },
  { name: 'add-dir', description: '添加新的工作目录', category: 'context', args: '<path>' },
  { name: 'init', description: '初始化新的项目说明文件并写入代码库文档', category: 'context' },
  { name: 'memory', description: '编辑持久 memory 文件', category: 'context' },
  { name: 'dream', description: '运行 memory consolidation，将近期会话沉淀为长期记忆', category: 'context' },
  { name: 'knowledge', description: '管理原生 Knowledge Graph', category: 'context', args: 'enable <yes|no> | clear | status | list' },
  { name: 'wiki', description: '初始化并检查 OpenClaude 项目 wiki', category: 'context', args: '[init|status]' },
  { name: 'cost', description: '显示当前会话的总成本和耗时', category: 'context' },
  { name: 'request-size', description: '显示估算的请求上下文负载和主要贡献项', category: 'context' },
  { name: 'cache-stats', description: '显示每轮和会话级 cache hit/miss 统计（适用于所有 provider）', category: 'context' },

  // ── models & providers ───────────────────────────────────────────────
  { name: 'model', description: '设置当前会话使用的 AI 模型', category: 'models', args: '[model]' },
  { name: 'provider', description: '管理 API provider profile', category: 'models' },
  { name: 'effort', description: '设置模型使用的 effort level', category: 'models', args: '[low|medium|high|max|auto]' },
  { name: 'login', description: '使用 Anthropic 账号登录', category: 'models' },
  { name: 'logout', description: '退出 Anthropic 账号', category: 'models' },
  { name: 'onboard-github', description: '交互式设置 GitHub Copilot：OAuth device login 会保存在 secure storage 中', category: 'models' },
  { name: 'usage', description: '显示套餐用量限制', category: 'models' },
  { name: 'extra-usage', description: '配置 extra usage，在触及限制后继续工作', category: 'models' },

  // ── code review & git ────────────────────────────────────────────────
  { name: 'diff', description: '查看未提交改动和每轮 diff', category: 'workflow' },
  { name: 'review', description: '审查 pull request', category: 'workflow' },
  { name: 'security-review', description: '对当前分支待提交改动执行安全审查', category: 'workflow' },
  { name: 'pr-comments', description: '获取 GitHub pull request 评论', category: 'workflow' },
  { name: 'auto-fix', description: '配置 auto-fix：AI 编辑后运行 lint/test', category: 'workflow' },
  { name: 'plan', description: '启用 plan mode 或查看当前会话计划', category: 'workflow', args: '[open|<description>]' },
  { name: 'install-github-app', description: '为仓库设置 GitHub Actions 集成', category: 'workflow' },
  { name: 'install-slack-app', description: '安装 Slack app 集成', category: 'workflow' },

  // ── tools & integrations ─────────────────────────────────────────────
  { name: 'mcp', description: '管理 MCP server', category: 'tools', args: '[enable|disable [server-name]]' },
  { name: 'lsp', description: '检查并设置 Language Server Protocol 代码智能能力', category: 'tools', args: 'status | recommend [path] | install <plugin-id> | uninstall <plugin-id> | restart' },
  { name: 'ide', description: '管理 IDE 集成并显示状态', category: 'tools', args: '[open]' },
  { name: 'plugin', description: '管理 OpenClaude plugin', category: 'tools' },
  { name: 'reload-plugins', description: '在当前会话中激活待生效的 plugin 改动', category: 'tools' },
  { name: 'skills', description: '列出可用 skill', category: 'tools' },
  { name: 'agents', description: '管理 agent 配置', category: 'tools' },
  { name: 'hooks', description: '查看 tool event 的 hook 配置', category: 'tools' },
  { name: 'permissions', description: '管理 allow 和 deny 工具权限规则', category: 'tools' },

  // ── ui & customization ───────────────────────────────────────────────
  { name: 'config', description: '打开配置面板', category: 'customization' },
  { name: 'theme', description: '切换主题', category: 'customization' },
  { name: 'logo', description: '更改启动 logo 配色', category: 'customization' },
  { name: 'color', description: '设置当前会话的 prompt bar 颜色', category: 'customization', args: '<color|default>' },
  { name: 'keybindings', description: '打开或创建快捷键配置文件', category: 'customization' },
  { name: 'vim', description: '在 Vim 和 Normal 编辑模式之间切换', category: 'customization' },
  { name: 'statusline', description: '设置 OpenClaude 状态行 UI', category: 'customization' },
  { name: 'terminal-setup', description: '安装 Shift+Enter 换行快捷键', category: 'customization' },
  { name: 'commit-message', description: '配置 commit attribution 文本', category: 'customization', args: '[status|off|default|set "text"|co-author <name> <email>]' },
  { name: 'output-style', description: '已弃用：请使用 /config 修改 output style', category: 'customization' },
  { name: 'stickers', description: '订购 OpenClaude stickers', category: 'customization' },

  // ── help & diagnostics ───────────────────────────────────────────────
  { name: 'help', description: '显示帮助和可用命令', category: 'diagnostics' },
  { name: 'status', description: '显示版本、模型、账号、API 连接和工具状态', category: 'diagnostics' },
  { name: 'doctor', description: '诊断并验证 OpenClaude 安装和设置', category: 'diagnostics' },
  { name: 'diagnostics', description: '显示当前会话已捕获的 LSP 诊断', category: 'diagnostics' },
  { name: 'stats', description: '显示你的使用统计和活动', category: 'diagnostics' },
  { name: 'insights', description: '生成 OpenClaude 会话分析报告', category: 'diagnostics' },
  { name: 'release-notes', description: '查看 release notes', category: 'diagnostics' },
  { name: 'feedback', description: '提交 OpenClaude 反馈', category: 'diagnostics', args: '[report]' },
]

export function commandsByCategory(category: CommandCategory): SlashCommand[] {
  return commands.filter(c => c.category === category)
}
