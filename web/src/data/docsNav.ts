export interface DocsNavItem {
  title: string
  href: string
}

export interface DocsNavGroup {
  group: string
  items: DocsNavItem[]
}

export const docsNav: DocsNavGroup[] = [
  {
    group: '开始使用',
    items: [
      { title: '概览', href: '/docs/' },
      { title: '安装', href: '/docs/installation/' },
      { title: '快速开始', href: '/docs/quickstart/' },
      { title: 'Provider', href: '/docs/providers/' },
    ],
  },
  {
    group: '参考',
    items: [
      { title: '斜杠命令', href: '/docs/slash-commands/' },
      { title: 'CLI 参考', href: '/docs/cli-reference/' },
      { title: '配置', href: '/docs/configuration/' },
      { title: '快捷键', href: '/docs/keybindings/' },
      { title: 'Skills', href: '/docs/skills/' },
    ],
  },
]

export const docsPages: DocsNavItem[] = docsNav.flatMap(g => g.items)

export function pagerFor(href: string): { prev?: DocsNavItem; next?: DocsNavItem } {
  const i = docsPages.findIndex(p => p.href === href)
  if (i === -1) return {}
  return {
    prev: i > 0 ? docsPages[i - 1] : undefined,
    next: i < docsPages.length - 1 ? docsPages[i + 1] : undefined,
  }
}
