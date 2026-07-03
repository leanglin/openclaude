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
    expect(html).toContain('还没有对话。点击加号按钮开始一个新对话。')
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
    expect(html).toContain('id="workspaceView"')
    expect(html).toContain('function renderMemoryPanel()')
    expect(html).toContain('function renderAssetsPanel()')
    expect(html).toContain('id="composerInput"')
    expect(html).toContain('id="activityPanel"')
  })
})
