import { describe, expect, test } from 'bun:test'
import { renderWebUiPage } from './page.js'

describe('webui page', () => {
  test('uses OpenCat visible branding and the icon asset', () => {
    const html = renderWebUiPage()

    expect(html).toContain('OpenCat Web')
    expect(html).toContain('/assets/opencat.ico')
    expect(html).not.toContain('OpenClaude')
  })

  test('includes a stop control wired to abort the session', () => {
    const html = renderWebUiPage()

    expect(html).toContain('id="stopSession"')
    expect(html).toContain('aria-label="Stop"')
    expect(html).toContain("sendWs({ type: 'abort' })")
  })

  test('labels permission actions clearly', () => {
    const html = renderWebUiPage()

    expect(html).toContain('Allow once')
    expect(html).toContain('Deny')
    expect(html).toContain('Allow and remember')
    expect(html).toContain('data-permission-action="allow"')
    expect(html).toContain('data-permission-action="deny"')
    expect(html).toContain('data-permission-action="allow-session"')
    expect(html).not.toContain('Allow session')
  })

  test('renders Midscene provider settings and refreshes the session after save', () => {
    const html = renderWebUiPage()

    expect(html).toContain('Chat provider')
    expect(html).toContain('Midscene App Test')
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
    expect(html).toContain("apiKey.placeholder = selectedSavedProvider ? 'Saved'")
    expect(html).toContain("midsceneApiKey.placeholder = midscene?.credentialConfigured ? 'Saved'")
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
  })

  test('topbar plus creates a chat and switches the secondary panel to Chat', () => {
    const html = renderWebUiPage()

    expect(html).toContain("sendWs({ type: 'new_session' })")
    expect(html).toContain("state.activeMenu = 'chat'")
    expect(html).toContain('renderLoadedMessages(event.messages || [])')
  })
})
