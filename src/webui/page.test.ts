import { describe, expect, test } from 'bun:test'
import { renderWebUiPage } from './page.js'

describe('webui page', () => {
  test('uses Chinese OpenCat visible branding and the icon asset', () => {
    const html = renderWebUiPage()

    expect(html).toContain('OpenCat Web 控制台')
    expect(html).toContain('/assets/opencat.ico')
    expect(html).not.toContain('OpenClaude')
    expect(html).toContain('<html lang="zh-CN">')
  })

  test('includes a stop control wired to abort the session', () => {
    const html = renderWebUiPage()

    expect(html).toContain('id="stopSession"')
    expect(html).toContain('aria-label="停止"')
    expect(html).toContain("sendWs({ type: 'abort' })")
  })

  test('labels permission actions clearly', () => {
    const html = renderWebUiPage()

    expect(html).toContain('仅允许一次')
    expect(html).toContain('拒绝')
    expect(html).toContain('允许并记住')
    expect(html).toContain('data-permission-action="allow"')
    expect(html).toContain('data-permission-action="deny"')
    expect(html).toContain('data-permission-action="allow-session"')
    expect(html).not.toContain('Allow session')
  })

  test('renders Midscene provider settings and refreshes the session after save', () => {
    const html = renderWebUiPage()

    expect(html).toContain('对话模型提供方')
    expect(html).toContain('Midscene App 测试')
    expect(html).toContain('id="midsceneBaseUrl"')
    expect(html).toContain('id="midsceneModel"')
    expect(html).toContain('id="midsceneModelFamily"')
    expect(html).toContain('id="midsceneApiKey"')
    expect(html).toContain('payload.midscene')
    expect(html).toContain("sendWs({ type: 'refresh_session' })")
  })

  test('renders Settings auth and manual usage upload without visible token login', () => {
    const html = renderWebUiPage()

    expect(html).toContain('function renderSettingsPanel()')
    expect(html).toContain('身份认证')
    expect(html).toContain('SSO 登录')
    expect(html).toContain('账号密码登录')
    expect(html).toContain('/api/platform-auth/sso/send-code')
    expect(html).toContain('/api/platform-auth/login/password')
    expect(html).toContain('数据统计上传')
    expect(html).toContain('/api/platform-usage/report')
    expect(html).toContain('登录后才能上传统计')
    expect(html).not.toContain('/api/platform-auth/token')
    expect(html).not.toContain('Token 登录')
  })

  test('renders collapsible provider sections and saved key placeholders', () => {
    const html = renderWebUiPage()

    expect(html).toContain('providerEditorOpen')
    expect(html).toContain('sectionToggle')
    expect(html).toContain("sectionToggle('chat'")
    expect(html).toContain("sectionToggle('midscene'")
    expect(html).toContain('class="sectionFields"')
    expect(html).toContain("current?.credentialConfigured && providerOptionId === select.value")
    expect(html).toContain("apiKey.placeholder = selectedSavedProvider ? '已保存'")
    expect(html).toContain("midsceneApiKey.placeholder = midscene?.credentialConfigured ? '已保存'")
  })

  test('keeps long provider summaries inside the side panel', () => {
    const html = renderWebUiPage()

    expect(html).toContain('.summaryLine')
    expect(html).toContain('overflow-wrap: anywhere')
    expect(html).toContain('word-break: break-word')
    expect(html).toContain('min-width: 0')
  })

  test('renders chat session list controls instead of the old placeholder', () => {
    const html = renderWebUiPage()

    expect(html).toContain('function renderChatPanel()')
    expect(html).toContain('data-select-session')
    expect(html).toContain('data-delete-session')
    expect(html).toContain("sendWs({ type: 'select_session', sessionId })")
    expect(html).toContain("sendWs({ type: 'delete_session', sessionId })")
    expect(html).not.toContain('Current chat controls will appear here.')
    expect(html).toContain('还没有对话')
    expect(html).toContain('data-chat-new')
  })

  test('includes shared motion utilities and reduced-motion handling', () => {
    const html = renderWebUiPage()

    expect(html).toContain('--oc-duration-fast')
    expect(html).toContain('.oc-skeleton')
    expect(html).toContain('.oc-typing-dots')
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
    expect(html).toContain('html:focus-within')
    expect(html).not.toContain('animation-duration: 1ms !important')
    expect(html).not.toContain('transition-duration: 1ms !important')
    expect(html).toContain('class="toastStack"')
  })

  test('binds primary navigation once and avoids forced layout on menu render', () => {
    const html = renderWebUiPage()

    expect(html).toContain('function initNavControls()')
    expect(html).toContain("document.querySelector('.rail')")
    expect(html).toContain("const button = target.closest('.navButton[data-menu]')")
    expect(html).toContain('initNavControls()')
    expect(html).not.toContain("button.addEventListener('click', () => selectMenu(menu))")
    expect(html).toContain('const isCurrentMenu = menu === state.activeMenu')
    expect(html).toContain('if (state.secondaryCollapsed)')
    expect(html).toContain('window.requestAnimationFrame(() =>')
    expect(html).not.toContain('void activeView.offsetWidth')
  })

  test('renders attachment chips and structured tool activity affordances', () => {
    const html = renderWebUiPage()
    const composerFormIndex = html.indexOf('id="composerForm"')
    const attachmentTrayIndex = html.indexOf('id="attachmentTray"', composerFormIndex)
    const attachButtonIndex = html.indexOf('id="attachButton"', composerFormIndex)
    const composerInputIndex = html.indexOf('id="composerInput"', composerFormIndex)
    const sendButtonIndex = html.indexOf('id="sendButton"', composerFormIndex)

    expect(html).toContain('id="attachButton"')
    expect(attachmentTrayIndex).toBeGreaterThan(composerFormIndex)
    expect(attachmentTrayIndex).toBeLessThan(attachButtonIndex)
    expect(attachmentTrayIndex).toBeLessThan(composerInputIndex)
    expect(attachmentTrayIndex).toBeLessThan(sendButtonIndex)
    expect(html).toContain('grid-template-columns: 40px minmax(0, 1fr) 40px;')
    expect(html).toContain('align-items: center;')
    expect(html).toContain('background: #2563eb;')
    expect(html).toContain('.sendButton.isLoading::after')
    expect(html).toContain('top: 50%;')
    expect(html).toContain('left: 50%;')
    expect(html).toContain('margin: -8px 0 0 -8px;')
    expect(html).toContain('align-self: center;')
    expect(html).toContain('class="attachmentChip"')
    expect(html).toContain('function renderMarkdownContent(content)')
    expect(html).toContain('class="statusBadge')
    expect(html).toContain('function renderToolSummary(tool)')
  })

  test('animates only newly inserted chat bubbles and tool rows', () => {
    const html = renderWebUiPage()

    expect(html).toContain('@keyframes ocAssistantBubbleIn')
    expect(html).toContain('@keyframes ocUserBubbleIn')
    expect(html).toContain('@keyframes ocToolCardIn')
    expect(html).toContain('.message.isNew .bubble')
    expect(html).toContain('.message.isNew.user .bubble')
    expect(html).toContain('.toolRow.isNew')
    expect(html).toContain('function addMessage(role, content, id, options)')
    expect(html).toContain("{ animate: false }")
    expect(html).toContain("message.className = 'message ' + role + (animate ? ' isNew' : '')")
    expect(html).toContain("row.className = 'toolRow isNew status-'")
    expect(html).not.toContain('animation: ocSlideUp var(--oc-duration-normal) var(--oc-ease-standard);\\n      will-change: transform, opacity;\\n    }\\n\\n    .message.user')
  })

  test('topbar plus creates a chat and switches the secondary panel to Chat', () => {
    const html = renderWebUiPage()

    expect(html).toContain("sendWs({ type: 'new_session' })")
    expect(html).toContain("state.activeMenu = 'chat'")
    expect(html).toContain('renderLoadedMessages(event.messages || [])')
  })

  test('renders Memory and Assets menus without replacing the chat surface', () => {
    const html = renderWebUiPage()

    expect(html).toContain('data-menu="memory"')
    expect(html).toContain('data-menu="assets"')
    expect(html).toContain('data-menu="assetHub"')
    expect(html).not.toContain('data-menu="sessions"')
    expect(html).toContain('id="workspaceView"')
    expect(html).toContain('function renderMemoryPanel()')
    expect(html).toContain('.memorySectionStack')
    expect(html).toContain('<div class="memorySectionStack">')
    expect(html).toContain('autoMemoryExtractionEnabled')
    expect(html).toContain('knowledgeGraphCollectionEnabled')
    expect(html).toContain('Auto write')
    expect(html).toContain('Graph capture')
    expect(html).toContain('function renderAssetsPanel()')
    expect(html).toContain('function renderAssetHubPanel()')
    expect(html).toContain('function renderAssetHubWorkspace()')
    expect(html).toContain('/api/asset-hub/assets')
    expect(html).toContain('/api/asset-hub/local-assets/')
    expect(html).toContain('data-knowledge-new')
    expect(html).toContain('knowledgeImportFile')
    expect(html).toContain('/api/assets/knowledge')
    expect(html).toContain("asset.kind === 'knowledge'")
    expect(html).not.toContain('downloadTarget')
    expect(html).not.toContain('ownership')
    expect(html).toContain('id="composerInput"')
    expect(html).toContain('id="activityPanel"')
  })

  test('renders Tools plugin marketplace controls instead of a placeholder', () => {
    const html = renderWebUiPage()

    expect(html).toContain('data-menu="tools"')
    expect(html).toContain('function renderToolsPanel()')
    expect(html).toContain('function renderToolsWorkspace()')
    expect(html).toContain('/api/plugins/marketplaces')
    expect(html).toContain('/api/plugins/install')
    expect(html).toContain('id="toolsSearch"')
    expect(html).toContain('id="toolsAddSource"')
    expect(html).toContain('data-tools-install')
    expect(html).toContain("menu === 'tools' && state.tools.plugins.length === 0")
    expect(html).not.toContain('Tools panel will appear here.')
  })

  test('surfaces plugin recommendations as confirmation UI without silent install', () => {
    const html = renderWebUiPage()

    expect(html).toContain("event.type === 'plugin_recommendation'")
    expect(html).toContain('function renderToolsRecommendation()')
    expect(html).toContain('data-tools-recommend-install')
    expect(html).toContain('data-tools-recommend-dismiss')
    expect(html).toContain("installToolPlugin(button.dataset.toolsRecommendInstall, 'recommendation')")
    expect(html).not.toContain('autoInstallPlugin')
  })
})
