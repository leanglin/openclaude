// Seeded from src/keybindings/defaultBindings.ts. User overrides live in
// ~/.openclaude/keybindings.json (open it with /keybindings).

export interface Keybinding {
  keys: string
  action: string
  context: string
}

export const keybindings: Keybinding[] = [
  { keys: 'Ctrl+C', action: '中断当前轮次', context: '全局' },
  { keys: 'Ctrl+D', action: '退出 REPL', context: '全局' },
  { keys: 'Ctrl+L', action: '重绘屏幕', context: '全局' },
  { keys: 'Ctrl+T', action: '显示或隐藏 todo 列表', context: '全局' },
  { keys: 'Ctrl+O', action: '切换 transcript 视图', context: '全局' },
  { keys: 'Ctrl+R', action: '搜索 prompt 历史', context: '全局' },
  { keys: 'Shift+Tab', action: '轮换 permission mode', context: 'prompt' },
  { keys: 'Ctrl+V', action: '从剪贴板粘贴图片（Windows 上为 Alt+V）', context: 'prompt' },
  { keys: 'Ctrl+S', action: '暂存当前 prompt 草稿', context: 'prompt' },
  { keys: 'Ctrl+G', action: '在外部 $EDITOR 中编辑 prompt', context: 'prompt' },
  { keys: 'Ctrl+_ / Ctrl+Shift+-', action: '撤销 prompt 输入', context: 'prompt' },
  { keys: 'Ctrl+P / Ctrl+N', action: '上一项 / 下一项', context: '菜单和选择器' },
  { keys: 'Ctrl+E', action: '显示或隐藏解释面板', context: '权限对话框' },
  { keys: 'Esc', action: '取消 / 关闭当前对话框', context: '对话框' },
  { keys: 'Shift+Enter', action: '插入换行（通过 /terminal-setup 安装）', context: 'prompt' },
]
