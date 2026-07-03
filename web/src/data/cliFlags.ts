// Seeded from the commander option definitions in src/main.tsx.
// Hidden/internal flags (hideHelp) are intentionally excluded.

export interface CliFlag {
  flag: string
  arg?: string
  description: string
}

export interface FlagGroup {
  id: string
  label: string
  intro?: string
  flags: CliFlag[]
}

export interface Subcommand {
  name: string
  usage: string
  description: string
}

export const flagGroups: FlagGroup[] = [
  {
    id: 'core',
    label: '核心',
    flags: [
      { flag: '-v, --version', description: '显示已安装版本并退出。' },
      { flag: '-h, --help', description: '显示命令帮助。' },
      { flag: '-p, --print', description: '打印响应并退出，适合 pipe 和脚本。会跳过 workspace trust 对话框，请只在可信目录中使用。' },
      { flag: '--bare', description: '最小模式：跳过 hooks、LSP、plugin sync、attribution、auto-memory、keychain 读取和 CLAUDE.md 自动发现。通过 --system-prompt、--add-dir、--mcp-config、--settings、--agents 或 --plugin-dir 显式提供上下文。' },
      { flag: '-d, --debug', arg: '[filter]', description: '启用 debug mode，可按类别过滤，例如 "api,hooks" 或 "!file"。' },
      { flag: '--debug-file', arg: '<path>', description: '将 debug log 写入指定文件路径，并隐式启用 debug mode。' },
      { flag: '--verbose', description: '覆盖配置中的 verbose mode 设置。' },
    ],
  },
  {
    id: 'io',
    label: '输入与输出格式',
    intro: '这些 flag 用于调整 --print 的非交互运行方式，例如脚本和 CI。',
    flags: [
      { flag: '--output-format', arg: '<format>', description: '输出格式（配合 --print）："text"（默认）、"json"（单个结果）或 "stream-json"（实时流式）。' },
      { flag: '--input-format', arg: '<format>', description: '输入格式（配合 --print）："text"（默认）或 "stream-json"（实时流式输入）。' },
      { flag: '--json-schema', arg: '<schema>', description: '用于验证最终结构化输出的 JSON Schema。' },
      { flag: '--include-hook-events', description: '在输出流中包含 hook 生命周期事件（仅 stream-json）。' },
      { flag: '--include-partial-messages', description: '包含逐步到达的 partial message chunk（仅 stream-json）。' },
      { flag: '--replay-user-messages', description: '将 stdin 中的用户消息重新发到 stdout 作为确认（stream-json 输入输出）。' },
    ],
  },
  {
    id: 'model',
    label: '模型与 provider',
    flags: [
      { flag: '--model', arg: '<model>', description: "当前会话使用的模型：可以是 'sonnet'、'opus' 这类别名，也可以是完整模型名。" },
      { flag: '--provider', arg: '<provider>', description: '要使用的 AI provider，例如 anthropic、openai、gemini、github、bedrock、vertex、ollama 等。' },
      { flag: '--effort', arg: '<level>', description: '模型使用的 effort level：low、medium、high、xhigh 或 max。' },
      { flag: '--fallback-model', arg: '<model>', description: '默认模型过载时自动使用的 fallback model。' },
      { flag: '--agent', arg: '<agent>', description: "当前会话使用的 agent，会覆盖 'agent' 设置。" },
      { flag: '--betas', arg: '<betas...>', description: '要包含在 API 请求中的 beta header（仅 API key 用户）。' },
    ],
  },
  {
    id: 'session',
    label: '会话',
    flags: [
      { flag: '-c, --continue', description: '继续当前目录中最近的对话。' },
      { flag: '-r, --resume', arg: '[id]', description: '按 session ID 恢复对话，或用可选搜索词打开交互式选择器。' },
      { flag: '--fork-session', description: '恢复时把对话分支到新的 session ID；不会创建文件系统或 worktree 隔离。' },
      { flag: '--from-pr', arg: '[pr]', description: '按 PR 编号/URL 恢复关联会话，或打开交互式选择器。' },
      { flag: '--session-id', arg: '<uuid>', description: '为对话使用指定 session ID（必须是有效 UUID）。' },
      { flag: '-n, --name', arg: '<name>', description: '设置会话显示名（显示在 /resume 和终端标题中）。' },
      { flag: '--no-session-persistence', description: '禁用 session persistence；会话不会保存到磁盘，也无法恢复（仅 --print）。' },
      { flag: '-w, --worktree', arg: '[name]', description: '在隔离的 git worktree 中运行会话，可选命名。' },
    ],
  },
  {
    id: 'permissions',
    label: '权限与工具',
    flags: [
      { flag: '--permission-mode', arg: '<mode>', description: '当前会话的 permission mode，例如 auto、plan、acceptEdits、bypassPermissions。' },
      { flag: '--allowed-tools', arg: '<tools...>', description: '允许的工具规则列表，可用逗号或空格分隔，例如 "Bash(git:*) Edit"。' },
      { flag: '--disallowed-tools', arg: '<tools...>', description: '拒绝的工具规则列表，可用逗号或空格分隔。' },
      { flag: '--tools', arg: '<tools...>', description: '限制内置工具集："" 禁用全部，"default" 启用全部，也可列出 "Bash,Edit,Read" 等名称。' },
      { flag: '--dangerously-skip-permissions', description: '绕过所有权限检查。只建议在无互联网访问的 sandbox 中使用。' },
      { flag: '--allow-dangerously-skip-permissions', description: '让权限绕过模式作为选项出现，但默认不启用。' },
      { flag: '--add-dir', arg: '<dirs...>', description: '允许工具访问的额外目录。' },
    ],
  },
  {
    id: 'prompt',
    label: 'system prompt',
    flags: [
      { flag: '--system-prompt', arg: '<prompt>', description: '替换当前会话的默认 system prompt。' },
      { flag: '--append-system-prompt', arg: '<prompt>', description: '追加到默认 system prompt，而不是替换它。' },
    ],
  },
  {
    id: 'mcp',
    label: 'mcp',
    flags: [
      { flag: '--mcp-config', arg: '<configs...>', description: '从 JSON 文件或字符串加载 MCP server（用空格分隔）。' },
      { flag: '--strict-mcp-config', description: '只使用 --mcp-config 中的 MCP server，忽略其他 MCP 配置。' },
    ],
  },
  {
    id: 'config',
    label: '配置',
    flags: [
      { flag: '--settings', arg: '<file-or-json>', description: '额外 settings：可以是 settings JSON 文件路径，也可以是 JSON 字符串。' },
      { flag: '--setting-sources', arg: '<sources>', description: '要加载的 setting source，用逗号分隔：user、project、local。' },
      { flag: '--agents', arg: '<json>', description: '为当前会话定义 custom agents 的 JSON 对象。' },
      { flag: '--plugin-dir', arg: '<path>', description: '从目录加载 plugin（可重复传入）。' },
      { flag: '--ide', description: '启动时如恰好发现一个有效 IDE，则自动连接。' },
    ],
  },
  {
    id: 'limits',
    label: '限制与预算',
    flags: [
      { flag: '--max-budget-usd', arg: '<amount>', description: 'API 调用可花费的美元上限（仅 --print）。' },
    ],
  },
]

export const subcommands: Subcommand[] = [
  {
    name: 'mcp',
    usage: 'openclaude mcp [add|remove|list|doctor]',
    description: '从命令行管理 MCP server 配置。',
  },
  {
    name: 'ssh',
    usage: 'openclaude ssh <host> [dir]',
    description: '通过 SSH 在远程主机上运行 OpenClaude。会部署二进制文件，并通过本机隧道转发 API auth，无需远程手动配置。',
  },
]
