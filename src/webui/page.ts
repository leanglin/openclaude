export type WebComposerCommandToken = {
  input: string
  start: number
  end: number
}

function escapeWebComposerHighlightHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch] ?? ch)
}

export function findWebComposerCommandToken(
  value: string,
  cursor: number,
): WebComposerCommandToken | null {
  const cursorOffset = Math.min(Math.max(cursor, 0), value.length)
  const beforeCursor = value.slice(0, cursorOffset)
  const slashIndex = beforeCursor.lastIndexOf('/')
  if (slashIndex < 0 || cursorOffset <= slashIndex) return null
  if (slashIndex > 0 && !/\s/.test(value.charAt(slashIndex - 1))) {
    return null
  }

  const afterSlash = value.slice(slashIndex)
  const boundaryOffset = afterSlash.search(/\s/)
  const tokenEnd =
    boundaryOffset === -1 ? value.length : slashIndex + boundaryOffset
  if (cursorOffset > tokenEnd) return null

  const rawToken = value.slice(slashIndex, tokenEnd)
  const input = value.slice(slashIndex, cursorOffset)
  if (!/^\/[a-zA-Z0-9_:-]*$/.test(rawToken)) return null
  if (!/^\/[a-zA-Z0-9_:-]*$/.test(input)) return null

  return { input, start: slashIndex, end: tokenEnd }
}

export function findWebComposerCommandTokens(
  value: string,
): WebComposerCommandToken[] {
  const tokens: WebComposerCommandToken[] = []
  const regex = /(^|\s)(\/[a-zA-Z0-9_:-]*)(?=\s|$)/g
  let match: RegExpExecArray | null = null
  while ((match = regex.exec(value)) !== null) {
    const leading = match[1] ?? ''
    const input = match[2] ?? ''
    const start = match.index + leading.length
    tokens.push({ input, start, end: start + input.length })
  }
  return tokens
}

export function renderWebComposerHighlightHtml(value: string): string {
  const tokens = findWebComposerCommandTokens(value)
  let cursor = 0
  let html = ''
  for (const token of tokens) {
    html += escapeWebComposerHighlightHtml(value.slice(cursor, token.start))
    html += `<span class="composerCommandToken">${escapeWebComposerHighlightHtml(token.input)}</span>`
    cursor = token.end
  }
  html += escapeWebComposerHighlightHtml(value.slice(cursor))
  return html
}

export function renderWebUiPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCat Web 控制台</title>
  <link rel="icon" href="/assets/opencat.ico" type="image/x-icon">
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --surface: #ffffff;
      --surface-soft: #eef2f3;
      --border: #d9e0e2;
      --border-strong: #bdc8cc;
      --text: #172126;
      --muted: #657379;
      --accent: #147d74;
      --accent-soft: #dff3ef;
      --success: #25845f;
      --danger: #b73b48;
      --coral: #c7563f;
      --indigo: #4757a6;
      --shadow: 0 18px 45px rgba(23, 33, 38, 0.08);
      --oc-duration-fast: 120ms;
      --oc-duration-normal: 180ms;
      --oc-duration-slow: 260ms;
      --oc-ease-standard: cubic-bezier(0.2, 0, 0, 1);
      --oc-ease-emphasized: cubic-bezier(0.2, 0, 0, 1.12);
      --oc-ease-exit: cubic-bezier(0.4, 0, 1, 1);
      --oc-radius-sm: 8px;
      --oc-radius-md: 10px;
      --oc-radius-lg: 12px;
      --oc-shadow-soft: 0 8px 24px rgba(23, 33, 38, 0.08);
      --oc-shadow-hover: 0 12px 32px rgba(23, 33, 38, 0.14);
      --oc-ring: 0 0 0 3px rgba(20, 125, 116, 0.18);
      --rail: 56px;
      --secondary: 300px;
      --activity: 280px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body, #app { width: 100%; height: 100%; margin: 0; }
    body {
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }

    @keyframes ocFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes ocSlideUp {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes ocSlideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes ocScaleIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes ocSoftPop {
      0% { opacity: 0; transform: translateY(6px) scale(0.98); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes ocAssistantBubbleIn {
      0% { opacity: 0; transform: translateX(-12px) translateY(14px) scale(0.985); }
      70% { opacity: 1; }
      100% { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
    }

    @keyframes ocUserBubbleIn {
      0% { opacity: 0; transform: translateX(12px) translateY(14px) scale(0.985); }
      70% { opacity: 1; }
      100% { opacity: 1; transform: translateX(0) translateY(0) scale(1); }
    }

    @keyframes ocAvatarIn {
      0% { opacity: 0; transform: translateY(10px) scale(0.92); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes ocToolCardIn {
      0% {
        opacity: 0;
        transform: translateY(12px);
        box-shadow: 0 2px 8px rgba(23, 33, 38, 0.02);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
        box-shadow: 0 8px 22px rgba(23, 33, 38, 0.04);
      }
    }

    @keyframes ocShimmer {
      100% { transform: translateX(100%); }
    }

    @keyframes ocTypingDot {
      0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-2px); }
    }

    @keyframes ocPulse {
      0%, 100% { opacity: 0.55; transform: scale(0.9); }
      50% { opacity: 1; transform: scale(1.08); }
    }

    @keyframes ocSpin {
      to { transform: rotate(360deg); }
    }

    @keyframes ocShake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-3px); }
      75% { transform: translateX(3px); }
    }

    .oc-fade-in { animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard); }
    .oc-slide-up { animation: ocSlideUp var(--oc-duration-normal) var(--oc-ease-standard); }
    .oc-slide-down { animation: ocSlideDown var(--oc-duration-normal) var(--oc-ease-standard); }
    .oc-scale-in { animation: ocScaleIn var(--oc-duration-normal) var(--oc-ease-emphasized); }
    .oc-soft-pop { animation: ocSoftPop var(--oc-duration-slow) var(--oc-ease-emphasized); }

    .oc-skeleton {
      position: relative;
      overflow: hidden;
      min-height: 14px;
      border-radius: var(--oc-radius-sm);
      background: rgba(148, 163, 184, 0.16);
    }

    .oc-skeleton::after {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.34), transparent);
      animation: ocShimmer 1.2s infinite;
    }

    .oc-typing-dots {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 34px;
    }

    .oc-typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: currentColor;
      animation: ocTypingDot 1.2s infinite ease-in-out;
    }

    .oc-typing-dots span:nth-child(2) { animation-delay: 120ms; }
    .oc-typing-dots span:nth-child(3) { animation-delay: 240ms; }

    button, input, select, textarea {
      font: inherit;
      letter-spacing: 0;
    }

    button {
      border: 0;
      cursor: pointer;
      color: inherit;
      background: transparent;
    }

    button,
    input,
    select,
    textarea,
    .bubble,
    .workspaceCard,
    .listItem,
    .sessionItem,
    .profileSummary,
    .tag,
    .pill {
      transition:
        background-color var(--oc-duration-fast) var(--oc-ease-standard),
        border-color var(--oc-duration-fast) var(--oc-ease-standard),
        box-shadow var(--oc-duration-fast) var(--oc-ease-standard),
        color var(--oc-duration-fast) var(--oc-ease-standard),
        opacity var(--oc-duration-fast) var(--oc-ease-standard),
        transform var(--oc-duration-fast) var(--oc-ease-standard);
    }

    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    .listItem:focus-visible,
    .sessionItem:focus-within {
      outline: none;
      box-shadow: var(--oc-ring);
    }

    .shell {
      height: 100%;
      display: grid;
      grid-template-columns: var(--rail) var(--secondary) minmax(0, 1fr) var(--activity);
      grid-template-rows: 100%;
      transition: grid-template-columns var(--oc-duration-slow) var(--oc-ease-standard);
    }

    .shell.secondaryCollapsed {
      grid-template-columns: var(--rail) 0 minmax(0, 1fr) var(--activity);
    }

    .shell.activityCollapsed {
      grid-template-columns: var(--rail) var(--secondary) minmax(0, 1fr) 48px;
    }

    .shell.secondaryCollapsed.activityCollapsed {
      grid-template-columns: var(--rail) 0 minmax(0, 1fr) 48px;
    }

    .rail {
      background: #10191d;
      color: #dce7e9;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 10px 6px;
      gap: 10px;
      min-width: var(--rail);
    }

    .railBrand {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #ffffff;
      display: grid;
      place-items: center;
      margin-bottom: 4px;
      overflow: hidden;
    }

    .railBrand img { width: 24px; height: 24px; }

    .navButton, .iconButton {
      width: 38px;
      height: 38px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      color: currentColor;
      position: relative;
    }

    .navButton:hover, .iconButton:hover {
      background: rgba(255,255,255,0.10);
      transform: translateX(2px);
    }

    .navButton:active, .iconButton:active,
    .primaryButton:active,
    .secondaryAction:active,
    .miniButton:active,
    .sendButton:active,
    .textButton:active,
    .dangerButton:active,
    .allowButton:active {
      transform: scale(0.98);
    }

    .navButton.active {
      background: #e7f4f1;
      color: #0b514c;
      box-shadow: inset 3px 0 0 var(--accent), 0 8px 20px rgba(20,125,116,0.16);
    }

    .navButton svg, .iconButton svg {
      width: 19px;
      height: 19px;
      stroke-width: 2;
      transition: transform var(--oc-duration-fast) var(--oc-ease-standard);
    }

    .navButton:hover svg, .iconButton:hover svg,
    .navButton.active svg {
      transform: scale(1.08);
    }

    .secondary {
      min-width: 0;
      border-right: 1px solid var(--border);
      background: var(--surface);
      overflow: hidden;
      transition:
        opacity var(--oc-duration-normal) var(--oc-ease-standard),
        transform var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .shell.secondaryCollapsed .secondary {
      opacity: 0;
      pointer-events: none;
    }

    .secondaryInner {
      width: var(--secondary);
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .panelHeader {
      height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px 0 18px;
      border-bottom: 1px solid var(--border);
    }

    .panelHeader h2 {
      font-size: 15px;
      line-height: 20px;
      margin: 0;
      font-weight: 700;
    }

    .panelBody {
      padding: 16px;
      overflow: auto;
      min-height: 0;
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .chat {
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: var(--bg);
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .topbar {
      height: 58px;
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,0.84);
      backdrop-filter: blur(16px);
      transition:
        background-color var(--oc-duration-normal) var(--oc-ease-standard),
        box-shadow var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .topbar:hover {
      box-shadow: 0 10px 24px rgba(23, 33, 38, 0.05);
    }

    .brand {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 10px;
    }

    .brand img {
      width: 24px;
      height: 24px;
      flex: 0 0 auto;
    }

    .brand h1 {
      font-size: 18px;
      line-height: 22px;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 760;
    }

    .topMeta {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      min-width: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .pill {
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--muted);
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pill:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      flex: 0 0 auto;
    }

    .primaryButton {
      height: 34px;
      padding: 0 12px;
      border-radius: 8px;
      background: #182326;
      color: white;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .primaryButton:hover {
      background: #253438;
      box-shadow: var(--oc-shadow-soft);
    }

    .primaryButton svg {
      width: 18px;
      height: 18px;
      stroke-width: 2;
    }

    #newChat, #stopSession {
      width: 34px;
      padding: 0;
      justify-content: center;
    }

    #newChat:active svg {
      transform: rotate(90deg) scale(0.96);
    }

    #stopSession {
      background: var(--danger);
    }

    #stopSession:hover {
      background: #9f2f3b;
    }

    #stopSession:disabled {
      cursor: default;
      opacity: 0.58;
    }

    #stopSession[hidden] {
      display: none;
    }

    #secondaryExpand {
      display: none;
    }

    .shell.secondaryCollapsed #secondaryExpand {
      display: grid;
    }

    .messages {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 26px max(22px, 6vw);
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .empty {
      margin: auto;
      width: min(520px, 100%);
      text-align: center;
      color: var(--muted);
      border: 1px solid var(--border);
      border-radius: var(--oc-radius-sm);
      background: rgba(255,255,255,0.72);
      padding: 28px;
      box-shadow: var(--oc-shadow-soft);
      animation: ocScaleIn var(--oc-duration-normal) var(--oc-ease-emphasized);
    }

    .emptyTitle {
      color: var(--text);
      font-weight: 760;
      font-size: 26px;
      line-height: 32px;
      margin-bottom: 8px;
    }

    .message {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      max-width: 900px;
    }

    .message.user {
      align-self: flex-end;
      grid-template-columns: minmax(0, 1fr) 34px;
    }

    .avatar {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      font-size: 12px;
      font-weight: 800;
      color: white;
      background: var(--accent);
    }

    .message.user .avatar {
      grid-column: 2;
      grid-row: 1;
      background: var(--indigo);
    }

    .bubble {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      padding: 11px 13px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      box-shadow: 0 8px 25px rgba(23, 33, 38, 0.04);
    }

    .bubble:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .message.user .bubble {
      background: linear-gradient(180deg, #f7f8ff 0%, #edf1ff 100%);
      border-color: #ced4f2;
    }

    .message.isNew .bubble {
      animation: ocAssistantBubbleIn var(--oc-duration-slow) var(--oc-ease-standard) both;
      will-change: transform, opacity;
    }

    .message.isNew.user .bubble {
      animation-name: ocUserBubbleIn;
    }

    .message.isNew .avatar {
      animation: ocAvatarIn var(--oc-duration-slow) var(--oc-ease-emphasized) both;
      will-change: transform, opacity;
    }

    .bubble.streaming {
      position: relative;
      border-color: #a7d5cf;
      box-shadow: var(--oc-shadow-soft);
    }

    .bubble.streaming::after {
      content: "";
      display: inline-block;
      width: 7px;
      height: 16px;
      margin-left: 3px;
      vertical-align: -3px;
      border-radius: 999px;
      background: var(--accent);
      animation: ocPulse 1s infinite var(--oc-ease-standard);
    }

    .bubble.markdownBody {
      white-space: normal;
    }

    .toolRow {
      max-width: 900px;
      display: grid;
      gap: 8px;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfbf9;
      color: var(--muted);
      font-size: 13px;
      overflow: hidden;
      border-left: 3px solid var(--accent);
      box-shadow: 0 8px 22px rgba(23, 33, 38, 0.04);
    }

    .toolRow.isNew {
      animation: ocToolCardIn var(--oc-duration-slow) var(--oc-ease-standard) both;
      will-change: transform, opacity;
    }

    .toolRow strong {
      color: var(--text);
      font-weight: 700;
    }

    .toolHeader,
    .toolMeta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .toolTitle {
      color: var(--text);
      font-weight: 760;
    }

    .toolDetail {
      max-height: 260px;
      overflow: auto;
      border-radius: 8px;
      background: #f8faf9;
      border: 1px solid var(--border);
      padding: 10px;
    }

    .composer {
      padding: 14px 18px 18px;
      border-top: 1px solid var(--border);
      background: rgba(255,255,255,0.86);
      backdrop-filter: blur(16px);
    }

    .composerBox {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) 40px;
      gap: 10px;
      max-width: 980px;
      margin: 0 auto;
      align-items: center;
      position: relative;
    }

    .attachmentTray {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-height: 0;
      animation: ocSlideDown var(--oc-duration-normal) var(--oc-ease-standard);
    }

    textarea {
      width: 100%;
      min-height: 48px;
      max-height: 160px;
      resize: vertical;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 13px 14px;
      outline: none;
      background: var(--surface);
      color: var(--text);
    }

    textarea:focus, input:focus, select:focus {
      border-color: var(--accent);
      box-shadow: var(--oc-ring), var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    #composerInput {
      position: relative;
      z-index: 2;
      background: transparent;
      color: transparent;
      caret-color: var(--text);
      transition:
        min-height var(--oc-duration-normal) var(--oc-ease-standard),
        border-color var(--oc-duration-fast) var(--oc-ease-standard),
        box-shadow var(--oc-duration-fast) var(--oc-ease-standard),
        transform var(--oc-duration-fast) var(--oc-ease-standard);
    }

    #composerInput:focus {
      transform: none;
    }

    #composerInput::placeholder {
      color: var(--muted);
      opacity: 0.72;
    }

    #composerInput::selection {
      background: rgba(37, 99, 235, 0.18);
      color: transparent;
    }

    .composerInputWrap {
      position: relative;
      min-width: 0;
      width: 100%;
    }

    .composerHighlight {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      overflow: hidden;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 13px 14px;
      color: var(--text);
      font: inherit;
      line-height: 1.35;
      letter-spacing: 0;
      word-spacing: 0;
      tab-size: 4;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    #composerInput {
      font: inherit;
      line-height: 1.35;
      letter-spacing: 0;
      word-spacing: 0;
      tab-size: 4;
    }

    .composerCommandToken {
      display: inline;
      color: #1d6fe8;
      background: #fff;
      border-radius: 4px;
      box-shadow: 0 0 0 1px #bfd7ff;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
    }

    .commandSuggestions {
      position: absolute;
      left: 50px;
      right: 50px;
      bottom: calc(100% + 8px);
      z-index: 16;
      max-height: 280px;
      overflow: auto;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 6px;
    }

    .commandSuggestion {
      width: 100%;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      display: grid;
      grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 9px 10px;
      text-align: left;
      cursor: pointer;
    }

    .commandSuggestion:hover,
    .commandSuggestion.active {
      background: #eef7f4;
    }

    .commandSuggestionName {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-weight: 760;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .commandSuggestionDetail {
      color: var(--muted);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }

    .commandSuggestionTag {
      color: var(--accent);
      font-weight: 700;
      margin-right: 6px;
    }

    .sendButton {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #2563eb;
      color: white;
      position: relative;
      box-shadow: 0 10px 24px rgba(37, 99, 235, 0.22);
    }

    .sendButton:hover {
      background: #1d4ed8;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.28);
      transform: translateY(-1px);
    }

    .sendButton:focus-visible {
      outline: none;
      box-shadow:
        0 0 0 3px rgba(37, 99, 235, 0.22),
        0 10px 24px rgba(37, 99, 235, 0.22);
    }

    .sendButton.isLoading svg {
      opacity: 0;
    }

    .sendButton.isLoading::after,
    .buttonLoading::after,
    .attachmentSpinner {
      content: "";
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.45);
      border-top-color: currentColor;
      animation: ocSpin 780ms linear infinite;
    }

    .sendButton.isLoading::after {
      position: absolute;
      top: 50%;
      left: 50%;
      margin: -8px 0 0 -8px;
    }

    .attachButton {
      align-self: center;
      width: 40px;
      height: 40px;
      color: var(--muted);
      border: 1px solid var(--border);
      background: var(--surface);
    }

    .attachButton:hover {
      color: var(--accent);
      border-color: #a7d5cf;
      background: var(--accent-soft);
    }

    .attachmentChip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 30px;
      max-width: 260px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      padding: 0 7px 0 9px;
      box-shadow: 0 6px 18px rgba(23, 33, 38, 0.04);
      animation: ocScaleIn var(--oc-duration-normal) var(--oc-ease-emphasized);
    }

    .attachmentChip:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .attachmentName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 700;
    }

    .attachmentStatus {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
    }

    .statusDot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--muted);
    }

    .attachmentChip[data-status="uploading"] .statusDot {
      background: var(--accent);
      animation: ocPulse 1s infinite var(--oc-ease-standard);
    }

    .attachmentChip[data-status="ready"] .statusDot { background: #25845f; }
    .attachmentChip[data-status="failed"] {
      border-color: #f0c2c8;
      background: #fff1f2;
    }
    .attachmentChip[data-status="failed"] .statusDot { background: var(--danger); }

    .attachmentRemove {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      color: var(--muted);
    }

    .attachmentRemove:hover {
      color: var(--danger);
      background: #f6e7e9;
    }

    .activity {
      border-left: 1px solid var(--border);
      background: #faf8f3;
      overflow: hidden;
      min-width: 0;
      transition:
        width var(--oc-duration-slow) var(--oc-ease-standard),
        opacity var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .activityInner {
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .activityCollapsed .activityTitle,
    .activityCollapsed .activityList {
      display: none;
    }

    .activityList {
      padding: 12px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 0;
    }

    .activityItem {
      border: 1px solid #e2dacb;
      background: #fffdf8;
      border-radius: 8px;
      padding: 10px;
      font-size: 13px;
      animation: ocSlideDown var(--oc-duration-normal) var(--oc-ease-standard);
      box-shadow: 0 7px 18px rgba(86, 64, 28, 0.04);
      border-left: 3px solid #d5c6a8;
      transition:
        border-color var(--oc-duration-fast) var(--oc-ease-standard),
        box-shadow var(--oc-duration-fast) var(--oc-ease-standard),
        transform var(--oc-duration-fast) var(--oc-ease-standard);
    }

    .activityItem:hover {
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .activityItem.kind-error {
      border-color: #f0c2c8;
      border-left-color: var(--danger);
      background: #fff8f8;
    }

    .activityItem.kind-permission { border-left-color: var(--indigo); }
    .activityItem.kind-read,
    .activityItem.kind-grep,
    .activityItem.kind-edit { border-left-color: var(--coral); }
    .activityItem.kind-thinking,
    .activityItem.kind-preflight { border-left-color: var(--accent); }
    .activityItem.kind-result { border-left-color: #25845f; }

    .activityBadge,
    .statusBadge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 22px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      padding: 0 8px;
      font-size: 11px;
      line-height: 1;
      font-weight: 760;
      white-space: nowrap;
    }

    .activityBadge.error,
    .statusBadge.error {
      color: var(--danger);
      border-color: #f0c2c8;
      background: #fff1f2;
    }

    .activityBadge.running,
    .statusBadge.running {
      color: #0b514c;
      border-color: #a7d5cf;
      background: var(--accent-soft);
    }

    .activityBadge.success,
    .statusBadge.success {
      color: #1d684e;
      border-color: #b8dcc8;
      background: #e7f6ed;
    }

    .pulseDot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: currentColor;
      animation: ocPulse 1s infinite var(--oc-ease-standard);
    }

    .activityItemTitle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--text);
      font-weight: 700;
      line-height: 18px;
    }

    .activityItemTitle > span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .activityDetail {
      margin-top: 4px;
      color: var(--muted);
      overflow-wrap: anywhere;
      line-height: 18px;
    }

    .activityDetail details {
      overflow: hidden;
    }

    .activityDetail summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 700;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    .field label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    input, select {
      width: 100%;
      height: 38px;
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      color: var(--text);
      background: var(--surface);
      outline: none;
      min-width: 0;
    }

    input {
      padding: 0 10px;
    }

    select {
      padding: 0 32px 0 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .profileSummary {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 11px;
      margin-bottom: 14px;
      font-size: 13px;
      color: var(--muted);
      line-height: 18px;
      min-width: 0;
      overflow: hidden;
      overflow-wrap: anywhere;
    }

    .profileSummary:hover,
    .workspaceCard:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
    }

    .profileSummary strong {
      color: var(--text);
    }

    .summaryLine {
      display: block;
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .formSection {
      margin-bottom: 18px;
      min-width: 0;
    }

    .toolsMarketplaceSection {
      margin-top: 14px;
    }

    .memorySectionStack {
      margin-top: 14px;
    }

    .formSection h3 {
      margin: 0;
      color: var(--text);
      font-size: 14px;
      line-height: 20px;
    }

    .sectionHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
      margin-bottom: 10px;
    }

    .sectionToggle {
      height: 30px;
      border-radius: 8px;
      border: 1px solid var(--border);
      padding: 0 9px;
      background: var(--surface);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      flex: 0 0 auto;
    }

    .sectionToggle:hover {
      color: var(--text);
      border-color: var(--border-strong);
    }

    .sectionFields[hidden] {
      display: none;
    }

    .sectionFields {
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .secondaryAction {
      width: 100%;
      height: 38px;
      border-radius: 8px;
      color: white;
      background: var(--accent);
      font-weight: 700;
    }

    .secondaryAction:hover {
      background: #0f6962;
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .ghostState {
      color: var(--muted);
      padding: 18px;
      line-height: 21px;
      font-size: 14px;
      border: 1px dashed var(--border);
      border-radius: 8px;
      background: rgba(255,255,255,0.62);
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .workspaceView {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 22px max(20px, 4vw);
      animation: ocSlideUp var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .workspaceHeader {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 16px;
    }

    .workspaceHeader h2 {
      margin: 0;
      font-size: 22px;
      line-height: 28px;
      font-weight: 760;
    }

    .workspaceMeta {
      color: var(--muted);
      font-size: 13px;
      line-height: 19px;
      overflow-wrap: anywhere;
    }

    .workspaceCard {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      padding: 14px;
      box-shadow: 0 8px 25px rgba(23, 33, 38, 0.04);
      min-width: 0;
      margin-bottom: 14px;
      animation: ocScaleIn var(--oc-duration-normal) var(--oc-ease-emphasized);
    }

    .toolbarRow {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .miniButton {
      min-height: 32px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      padding: 0 10px;
      font-size: 13px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      position: relative;
    }

    .miniButton:hover {
      border-color: var(--border-strong);
      background: var(--surface-soft);
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .miniButton.active {
      border-color: #a7d5cf;
      background: var(--accent-soft);
      color: #0b514c;
    }

    .miniButton.danger {
      color: var(--danger);
    }

    .miniButton:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .buttonLoading {
      pointer-events: none;
    }

    .buttonLoading::after {
      width: 13px;
      height: 13px;
      border-color: color-mix(in srgb, currentColor 32%, transparent);
      border-top-color: currentColor;
      flex: 0 0 auto;
    }

    .splitFields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .settingsTabs,
    .settingsActions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .settingsStatus {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      color: var(--text);
    }

    .settingsDot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--muted);
      flex: 0 0 auto;
    }

    .settingsDot.ok {
      background: var(--success);
    }

    .settingsDot.error {
      background: var(--danger);
    }

    .captchaRow {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    .captchaImage {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      margin-bottom: 12px;
    }

    .captchaImage img {
      display: block;
      max-width: 100%;
      height: 42px;
      object-fit: contain;
    }

    .usageGrid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .usageMetric {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 10px;
      min-width: 0;
    }

    .usageMetric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      line-height: 16px;
    }

    .usageMetric strong {
      display: block;
      color: var(--text);
      font-size: 18px;
      line-height: 24px;
      overflow-wrap: anywhere;
    }

    .editorArea {
      width: 100%;
      min-height: 360px;
      max-height: none;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.55;
    }

    .editorTabs {
      display: inline-flex;
      gap: 6px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      margin-bottom: 12px;
    }

    .previewPane,
    .contentPanel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfbf9;
      padding: 14px;
      min-height: 220px;
      overflow: auto;
      animation: ocFadeIn var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .unsavedNotice {
      border: 1px solid #ead79a;
      border-radius: 8px;
      background: #fff9df;
      color: #7b5f14;
      padding: 9px 11px;
      font-size: 13px;
      line-height: 18px;
      margin-bottom: 12px;
      animation: ocSlideDown var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .readonlyNotice, .errorBox {
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 19px;
      margin-bottom: 12px;
      overflow-wrap: anywhere;
    }

    .readonlyNotice {
      color: var(--muted);
      background: var(--surface-soft);
      border: 1px solid var(--border);
    }

    .errorBox {
      color: var(--danger);
      background: #fff1f2;
      border: 1px solid #f0c2c8;
    }

    .errorBox .miniButton {
      margin-top: 8px;
      color: var(--danger);
      border-color: #f0c2c8;
    }

    .itemList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .listItem {
      width: 100%;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      padding: 9px 10px;
      min-width: 0;
      position: relative;
      animation: ocSlideUp var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .listItem.active {
      border-color: #a7d5cf;
      background: var(--accent-soft);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    .listItem:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .listItem strong, .listItem span {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .listItem span {
      color: var(--muted);
      font-size: 12px;
      line-height: 17px;
      margin-top: 2px;
    }

    .tagRow {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .tag {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      color: var(--muted);
      padding: 3px 7px;
      font-size: 12px;
      line-height: 16px;
    }

    .tag.success {
      border-color: #b8dcc8;
      background: #e7f6ed;
      color: #1d684e;
    }

    .tag.warning {
      border-color: #ead79a;
      background: #fff9df;
      color: #7b5f14;
    }

    .tag.danger {
      border-color: #f0c2c8;
      background: #fff1f2;
      color: var(--danger);
    }

    .listItemHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .listItemHeader strong {
      min-width: 0;
    }

    .fileIcon {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      display: inline-grid;
      place-items: center;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      color: var(--accent);
      margin-right: 7px;
      vertical-align: -5px;
    }

    .fileIcon svg {
      width: 14px;
      height: 14px;
      stroke-width: 2;
    }

    .graphTabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .graphTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      line-height: 19px;
    }

    .graphTable th, .graphTable td {
      border-bottom: 1px solid var(--border);
      padding: 8px;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    .graphTable .graphTimeCell {
      width: 96px;
      min-width: 96px;
      white-space: nowrap;
      overflow-wrap: normal;
      word-break: keep-all;
    }

    .graphTable .graphContentCell {
      width: 48%;
    }

    .graphTable .graphKeywordsCell {
      width: 40%;
    }

    .graphTable tr {
      transition: background-color var(--oc-duration-fast) var(--oc-ease-standard);
    }

    .graphTable tr:hover {
      background: rgba(20,125,116,0.06);
    }

    .sessionList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .sessionItem {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 32px;
      gap: 8px;
      align-items: center;
      padding: 9px 8px 9px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      text-align: left;
      min-width: 0;
      animation: ocSlideDown var(--oc-duration-normal) var(--oc-ease-standard);
      position: relative;
    }

    .sessionItem.active {
      border-color: #a7d5cf;
      background: var(--accent-soft);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    .sessionItem:hover {
      border-color: var(--border-strong);
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .sessionItem .sessionDelete {
      opacity: 0.42;
    }

    .sessionItem:hover .sessionDelete,
    .sessionItem:focus-within .sessionDelete {
      opacity: 1;
    }

    .sessionSelect {
      min-width: 0;
      text-align: left;
    }

    .sessionTitle {
      display: block;
      color: var(--text);
      font-size: 13px;
      font-weight: 700;
      line-height: 18px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .sessionTime {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      line-height: 16px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sessionDelete {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      color: var(--muted);
      display: grid;
      place-items: center;
    }

    .sessionDelete:hover {
      background: #f6e7e9;
      color: var(--danger);
    }

    .sessionDelete svg {
      width: 16px;
      height: 16px;
      stroke-width: 2;
    }

    .permissionModal {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(16,25,29,0.36);
      padding: 20px;
      z-index: 20;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        opacity var(--oc-duration-normal) var(--oc-ease-standard),
        visibility var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .permissionModal.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .permissionBox {
      width: min(520px, 100%);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 18px;
      transform: translateY(8px) scale(0.98);
      transition:
        transform var(--oc-duration-normal) var(--oc-ease-emphasized),
        opacity var(--oc-duration-normal) var(--oc-ease-standard);
      opacity: 0;
    }

    .permissionModal.open .permissionBox {
      transform: translateY(0) scale(1);
      opacity: 1;
    }

    .permissionBox h3 {
      margin: 0 0 8px;
      font-size: 18px;
      line-height: 24px;
    }

    .permissionPreview {
      margin: 12px 0;
      padding: 10px;
      max-height: 220px;
      overflow: auto;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: #f8faf9;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 18px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .permissionActions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .textButton {
      height: 34px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      padding: 0 11px;
      background: var(--surface);
      color: var(--text);
    }

    .dangerButton {
      height: 34px;
      border-radius: 8px;
      padding: 0 11px;
      background: var(--danger);
      color: white;
    }

    .allowButton {
      height: 34px;
      border-radius: 8px;
      padding: 0 11px;
      background: var(--accent);
      color: white;
    }

    .textButton:hover,
    .dangerButton:hover,
    .allowButton:hover {
      box-shadow: var(--oc-shadow-soft);
      transform: translateY(-1px);
    }

    .markdownBody h1,
    .markdownBody h2,
    .markdownBody h3 {
      margin: 0.75em 0 0.35em;
      line-height: 1.25;
    }

    .markdownBody p {
      margin: 0.45em 0;
    }

    .markdownBody a {
      color: var(--accent);
      text-decoration: none;
    }

    .markdownBody a:hover {
      text-decoration: underline;
    }

    .markdownBody code:not(pre code) {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-soft);
      padding: 1px 5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }

    .codeBlock,
    .jsonBlock {
      margin: 0.7em 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #10191d;
      color: #e6f2f0;
      overflow: hidden;
    }

    .codeHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      color: #a9c4bf;
      font-size: 11px;
      font-weight: 760;
      text-transform: uppercase;
    }

    .codeBlock pre,
    .jsonBlock {
      margin: 0;
      padding: 12px;
      overflow: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre;
    }

    .markdownBody blockquote,
    .quoteBox {
      margin: 0.75em 0;
      padding: 10px 12px;
      border-left: 3px solid var(--accent);
      border-radius: 8px;
      background: var(--accent-soft);
      color: #0b514c;
    }

    .markdownBody ul,
    .markdownBody ol {
      margin: 0.5em 0 0.5em 1.2em;
      padding: 0;
    }

    .tableWrap {
      width: 100%;
      overflow-x: auto;
      margin: 0.75em 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }

    .markdownBody table {
      width: 100%;
      border-collapse: collapse;
      min-width: 420px;
      font-size: 13px;
    }

    .markdownBody th,
    .markdownBody td {
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }

    .markdownBody tr:hover {
      background: rgba(20,125,116,0.06);
    }

    .metaGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin: 12px 0;
    }

    .metaCard {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 10px;
      min-width: 0;
    }

    .metaCard span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      line-height: 15px;
      font-weight: 760;
      text-transform: uppercase;
    }

    .metaCard strong {
      display: block;
      margin-top: 3px;
      overflow-wrap: anywhere;
      font-size: 13px;
      line-height: 18px;
    }

    .toolsGrid {
      display: grid;
      grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.4fr);
      gap: 14px;
      align-items: start;
    }

    .toolsListScroll {
      max-height: calc(100vh - 210px);
      overflow: auto;
      padding-right: 2px;
    }

    .toolsDescription {
      margin-top: 12px;
      min-height: 120px;
    }

    .skeletonStack {
      display: grid;
      gap: 10px;
      margin: 12px 0;
    }

    .skeletonStack .oc-skeleton:nth-child(1) { width: 82%; height: 18px; }
    .skeletonStack .oc-skeleton:nth-child(2) { width: 100%; height: 42px; }
    .skeletonStack .oc-skeleton:nth-child(3) { width: 64%; height: 18px; }

    .toastStack {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 30;
      display: grid;
      gap: 10px;
      width: min(360px, calc(100vw - 36px));
      pointer-events: none;
    }

    .toast {
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--oc-shadow-hover);
      padding: 11px 12px;
      font-size: 13px;
      line-height: 18px;
      color: var(--text);
      animation: ocSlideUp var(--oc-duration-normal) var(--oc-ease-standard);
    }

    .toast.error {
      border-left-color: var(--danger);
      background: #fff8f8;
    }

    .toast.warning {
      border-left-color: #b88a16;
      background: #fff9df;
    }

    .toast.success {
      border-left-color: #25845f;
      background: #f3fbf6;
    }

    .toast.leaving {
      opacity: 0;
      transform: translateY(6px);
    }

    .srOnly {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      html:focus-within {
        scroll-behavior: auto !important;
      }
    }

    @media (max-width: 900px) {
      .shell,
      .shell.activityCollapsed,
      .shell.secondaryCollapsed,
      .shell.secondaryCollapsed.activityCollapsed {
        grid-template-columns: var(--rail) minmax(0, 1fr);
      }

      .secondary {
        position: fixed;
        top: 0;
        bottom: 0;
        left: var(--rail);
        width: min(var(--secondary), calc(100vw - var(--rail)));
        z-index: 10;
        box-shadow: var(--shadow);
      }

      .shell.secondaryCollapsed .secondary {
        transform: translateX(-100%);
      }

      .activity {
        display: none;
      }

      .topMeta .pill {
        max-width: 150px;
      }

      .composerBox {
        grid-template-columns: 38px minmax(0, 1fr) 38px;
      }

      .commandSuggestions {
        left: 48px;
        right: 48px;
      }

      .splitFields {
        grid-template-columns: 1fr;
      }

      .usageGrid,
      .captchaRow,
      .toolsGrid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .topbar {
        padding: 0 10px;
        gap: 8px;
      }

      .brand {
        flex: 1 1 auto;
        gap: 8px;
      }

      .brand h1 {
        font-size: 16px;
        line-height: 20px;
      }

      .topMeta {
        flex: 0 0 auto;
        gap: 6px;
      }

      #providerSummary {
        display: none;
      }

      .topMeta .pill {
        max-width: none;
        padding: 0 8px;
      }
    }
  </style>
</head>
<body>
  <div id="app" class="shell">
    <nav class="rail" aria-label="主导航">
      <div class="railBrand"><img src="/assets/opencat.ico" alt=""></div>
      <button class="navButton" data-menu="chat" title="对话" aria-label="对话"></button>
      <button class="navButton" data-menu="memory" title="记忆" aria-label="记忆"></button>
      <button class="navButton" data-menu="assets" title="资产" aria-label="资产"></button>
      <button class="navButton" data-menu="assetHub" title="资产 Hub" aria-label="资产 Hub"></button>
      <button class="navButton active" data-menu="providers" title="模型提供方" aria-label="模型提供方"></button>
      <button class="navButton" data-menu="tools" title="工具" aria-label="工具"></button>
      <button class="navButton" data-menu="settings" title="设置" aria-label="设置"></button>
    </nav>

    <aside class="secondary" aria-label="侧边栏">
      <div class="secondaryInner">
        <div class="panelHeader">
          <h2 id="secondaryTitle">模型提供方</h2>
          <button id="secondaryCollapse" class="iconButton" title="收起面板" aria-label="收起面板"></button>
        </div>
        <div id="secondaryBody" class="panelBody"></div>
      </div>
    </aside>

    <main class="chat">
      <header class="topbar">
        <div class="brand">
          <button id="secondaryExpand" class="iconButton" title="展开面板" aria-label="展开面板"></button>
          <img src="/assets/opencat.ico" alt="">
          <h1>OpenCat Web</h1>
        </div>
        <div class="topMeta">
          <span class="pill"><span id="statusDot" class="dot"></span><span id="statusText">就绪</span></span>
          <span id="providerSummary" class="pill">未配置模型提供方</span>
          <button id="stopSession" class="primaryButton" title="停止" aria-label="停止" disabled hidden></button>
          <button id="newChat" class="primaryButton" title="新建对话" aria-label="新建对话"></button>
        </div>
      </header>

      <section id="workspaceView" class="workspaceView" hidden></section>

      <section id="messages" class="messages" aria-live="polite">
        <div id="emptyState" class="empty">
          <div class="emptyTitle">向 OpenCat 提问</div>
          <div>先配置模型提供方，然后启动本地对话。</div>
        </div>
      </section>

      <footer id="composer" class="composer">
        <form id="composerForm" class="composerBox">
          <input id="attachmentInput" type="file" multiple hidden>
          <div id="attachmentTray" class="attachmentTray" hidden></div>
          <button id="attachButton" class="iconButton attachButton" type="button" title="添加附件" aria-label="添加附件"></button>
          <label class="srOnly" for="composerInput">向 OpenCat 提问</label>
          <div class="composerInputWrap">
            <div id="composerHighlight" class="composerHighlight" aria-hidden="true"></div>
            <textarea id="composerInput" placeholder="向 OpenCat 提问..." rows="1"></textarea>
          </div>
          <div id="commandSuggestions" class="commandSuggestions" role="listbox" hidden></div>
          <button id="sendButton" class="sendButton" title="发送" aria-label="发送"></button>
        </form>
      </footer>
    </main>

    <aside id="activityPanel" class="activity" aria-label="活动">
      <div class="activityInner">
        <div class="panelHeader">
          <h2 class="activityTitle">活动</h2>
          <button id="activityCollapse" class="iconButton" title="收起活动" aria-label="收起活动"></button>
        </div>
        <div id="activityList" class="activityList"></div>
      </div>
    </aside>
  </div>

  <div id="permissionModal" class="permissionModal" role="dialog" aria-modal="true" aria-labelledby="permissionTitle">
    <div class="permissionBox">
      <h3 id="permissionTitle">需要授权</h3>
      <div id="permissionPrompt" class="profileSummary"></div>
      <div id="permissionPreview" class="permissionPreview"></div>
      <div class="permissionActions">
        <button class="dangerButton" data-permission-action="deny">拒绝</button>
        <button class="textButton" data-permission-action="allow-session">允许并记住</button>
        <button class="allowButton" data-permission-action="allow">仅允许一次</button>
      </div>
    </div>
  </div>

  <div id="toastStack" class="toastStack" aria-live="polite" aria-atomic="true"></div>

  <script>
  (() => {
    ${escapeWebComposerHighlightHtml.toString()}
    ${findWebComposerCommandToken.toString()}
    ${findWebComposerCommandTokens.toString()}
    ${renderWebComposerHighlightHtml.toString()}

    const iconSvg = {
      "message-square": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
      brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9.5 2A3.5 3.5 0 0 0 6 5.5v.2A4 4 0 0 0 4 13a4 4 0 0 0 3.5 6H9V2z"/><path d="M14.5 2A3.5 3.5 0 0 1 18 5.5v.2A4 4 0 0 1 20 13a4 4 0 0 1-3.5 6H15V2z"/><path d="M9 8H7"/><path d="M15 8h2"/><path d="M9 14H7"/><path d="M15 14h2"/></svg>',
      package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
      cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20 12.5 3.5 3.5 0 0 1 17.5 19z"/><path d="M12 13v-6"/><path d="m9 10 3-3 3 3"/></svg>',
      plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v4a6 6 0 0 1-12 0V8z"/></svg>',
      history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/></svg>',
      wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
      chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m15 18-6-6 6-6"/></svg>',
      chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>',
      panelRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      square: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>',
      send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
      paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l8.8-8.8a4 4 0 1 1 5.7 5.7l-8.8 8.8a2 2 0 0 1-2.8-2.8l8.1-8.1"/></svg>',
      x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
      file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"/></svg>',
      calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
      pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m16 3 5 5L8 21H3v-5z"/><path d="M15 4 20 9"/></svg>',
      check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m20 6-11 11-5-5"/></svg>'
    };

    const app = document.getElementById('app');
    const workspaceView = document.getElementById('workspaceView');
    const messages = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
    const composer = document.getElementById('composer');
    const secondaryTitle = document.getElementById('secondaryTitle');
    const secondaryBody = document.getElementById('secondaryBody');
    const statusText = document.getElementById('statusText');
    const providerSummary = document.getElementById('providerSummary');
    const activityPanel = document.getElementById('activityPanel');
    const activityList = document.getElementById('activityList');
    const modal = document.getElementById('permissionModal');
    const permissionPrompt = document.getElementById('permissionPrompt');
    const permissionPreview = document.getElementById('permissionPreview');
    const composerInput = document.getElementById('composerInput');
    const composerHighlight = document.getElementById('composerHighlight');
    const commandSuggestions = document.getElementById('commandSuggestions');
    const stopSession = document.getElementById('stopSession');
    const sendButton = document.getElementById('sendButton');
    const attachButton = document.getElementById('attachButton');
    const attachmentInput = document.getElementById('attachmentInput');
    const attachmentTray = document.getElementById('attachmentTray');
    const toastStack = document.getElementById('toastStack');

    const state = {
      token: getToken(),
      ws: null,
      bootstrap: null,
      activeChatSessionId: null,
      requestedStoredSession: false,
      activeMenu: 'providers',
      mainViewWorkspaceActive: null,
      mainViewAnimationFrame: 0,
      secondaryCollapsed: false,
      activityCollapsed: false,
      running: false,
      stopping: false,
      streams: new Map(),
      attachments: [],
      pendingPermission: null,
      commandSuggestions: {
        items: [],
        selectedIndex: 0,
        open: false,
        requestId: 0,
        debounceTimer: 0,
        activeToken: null
      },
      providerEditorOpen: { chat: false, midscene: false },
      memory: {
        status: null,
        files: [],
        selectedId: null,
        selectedFile: null,
        graph: null,
        graphTab: 'entities',
        search: '',
        searchResults: [],
        error: '',
        newDraft: false,
        loading: false,
        saving: false,
        editorMode: 'edit',
        draftContent: '',
        unsaved: false
      },
      assets: {
        list: [],
        roots: null,
        selectedId: null,
        selectedAsset: null,
        query: '',
        kind: '',
        source: '',
        error: '',
        newDraft: false,
        draftKind: 'skill',
        editing: false,
        loading: false,
        saving: false,
        reloading: false
      },
      assetHub: {
        items: [],
        total: 0,
        page: 1,
        limit: 8,
        search: '',
        assetType: '',
        ordering: '-create_datetime',
        selectedId: '',
        selectedDetail: null,
        selectedMarkdown: '',
        loading: false,
        actionId: '',
        error: '',
        uploadOpen: false,
        uploadAssetId: '',
        uploadTitle: '',
        uploadVersion: 'v1',
        uploadRoles: '',
        uploadBusiness: '',
        uploadDescription: '',
        uploadError: ''
      },
      tools: {
        view: 'plugins',
        marketplaces: [],
        failures: [],
        plugins: [],
        search: '',
        marketplace: '',
        status: 'available',
        selectedId: '',
        loading: false,
        adding: false,
        installingId: '',
        addSource: '',
        error: '',
        notice: '',
        recommendation: null,
        mcpServers: [],
        mcpErrors: [],
        selectedMcpName: '',
        mcpLoading: false,
        mcpAdding: false,
        removingMcp: '',
        mcpError: '',
        mcpNotice: '',
        mcpForm: {
          name: '',
          scope: 'user',
          transport: 'stdio',
          command: '',
          args: '',
          env: '',
          url: '',
          headers: ''
        }
      },
      platformAuth: {
        status: null,
        usage: null,
        tab: 'sso',
        baseUrl: '',
        ssoAccount: '',
        ssoCode: '',
        ssoUuid: '',
        username: '',
        password: '',
        captcha: '',
        captchaKey: '',
        captchaImageBase64: '',
        loading: false,
        sendingCode: false,
        loggingIn: false,
        captchaLoading: false,
        uploading: false,
        error: '',
        usageError: ''
      }
    };

    const MAX_COMPOSER_ATTACHMENT_COUNT = 10;
    const MAX_COMPOSER_ATTACHMENT_BYTES = 15 * 1024 * 1024;

    function getToken() {
      const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
      const queryParams = new URLSearchParams(location.search);
      const token = hashParams.get('token') || queryParams.get('token') || sessionStorage.getItem('opencat-token') || '';
      if (token) sessionStorage.setItem('opencat-token', token);
      return token;
    }

    function setIcon(id, name) {
      const element = document.getElementById(id);
      if (element) element.innerHTML = iconSvg[name] || '';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[ch]);
    }

    function syncComposerHighlightScroll() {
      composerHighlight.scrollTop = composerInput.scrollTop;
      composerHighlight.scrollLeft = composerInput.scrollLeft;
    }

    function renderComposerHighlight() {
      composerHighlight.innerHTML = renderWebComposerHighlightHtml(composerInput.value);
      syncComposerHighlightScroll();
    }

    function getComposerCommandToken() {
      const value = composerInput.value;
      const cursor = composerInput.selectionStart ?? value.length;
      return findWebComposerCommandToken(value, cursor);
    }

    function commandTokenKey(token) {
      return token ? [token.start, token.end, token.input].join(':') : '';
    }

    function closeCommandSuggestions() {
      state.commandSuggestions.requestId += 1;
      if (state.commandSuggestions.debounceTimer) {
        clearTimeout(state.commandSuggestions.debounceTimer);
        state.commandSuggestions.debounceTimer = 0;
      }
      state.commandSuggestions.items = [];
      state.commandSuggestions.selectedIndex = 0;
      state.commandSuggestions.open = false;
      state.commandSuggestions.activeToken = null;
      commandSuggestions.hidden = true;
      commandSuggestions.innerHTML = '';
    }

    function renderCommandSuggestions() {
      const items = state.commandSuggestions.items;
      commandSuggestions.hidden = !state.commandSuggestions.open || items.length === 0;
      if (commandSuggestions.hidden) {
        commandSuggestions.innerHTML = '';
        return;
      }
      commandSuggestions.innerHTML = items.map((item, index) => [
        '<button type="button" role="option" class="commandSuggestion ' + (index === state.commandSuggestions.selectedIndex ? 'active' : '') + '" aria-selected="' + (index === state.commandSuggestions.selectedIndex ? 'true' : 'false') + '" data-command-suggestion-index="' + String(index) + '">',
        '<span class="commandSuggestionName">' + escapeHtml(item.displayText) + '</span>',
        '<span class="commandSuggestionDetail">' + (item.tag ? '<span class="commandSuggestionTag">' + escapeHtml(item.tag) + '</span>' : '') + escapeHtml(item.description || '') + '</span>',
        '</button>'
      ].join('')).join('');
      commandSuggestions.querySelectorAll('[data-command-suggestion-index]').forEach(button => {
        button.addEventListener('mousedown', event => {
          event.preventDefault();
          applyCommandSuggestion(Number(button.dataset.commandSuggestionIndex || '0'));
        });
      });
    }

    function applyCommandSuggestion(index) {
      const item = state.commandSuggestions.items[index];
      if (!item) return;
      const token = state.commandSuggestions.activeToken || getComposerCommandToken();
      if (!token) return;
      const replacement = '/' + item.commandName + ' ';
      composerInput.value = composerInput.value.slice(0, token.start) + replacement + composerInput.value.slice(token.end);
      composerInput.focus();
      const cursor = token.start + replacement.length;
      composerInput.setSelectionRange(cursor, cursor);
      renderComposerHighlight();
      closeCommandSuggestions();
    }

    function moveCommandSuggestionSelection(delta) {
      const count = state.commandSuggestions.items.length;
      if (!count) return;
      state.commandSuggestions.selectedIndex = (state.commandSuggestions.selectedIndex + delta + count) % count;
      renderCommandSuggestions();
    }

    function scheduleCommandSuggestions() {
      const token = getComposerCommandToken();
      if (!token) {
        closeCommandSuggestions();
        return;
      }
      if (state.commandSuggestions.debounceTimer) {
        clearTimeout(state.commandSuggestions.debounceTimer);
      }
      const requestId = state.commandSuggestions.requestId + 1;
      const tokenKey = commandTokenKey(token);
      state.commandSuggestions.requestId = requestId;
      state.commandSuggestions.activeToken = token;
      state.commandSuggestions.debounceTimer = setTimeout(async () => {
        state.commandSuggestions.debounceTimer = 0;
        try {
          const result = await api('/api/command-suggestions?input=' + encodeURIComponent(token.input));
          if (requestId !== state.commandSuggestions.requestId) return;
          const currentToken = getComposerCommandToken();
          if (commandTokenKey(currentToken) !== tokenKey) return;
          state.commandSuggestions.items = Array.isArray(result.suggestions) ? result.suggestions : [];
          state.commandSuggestions.selectedIndex = 0;
          state.commandSuggestions.open = state.commandSuggestions.items.length > 0;
          state.commandSuggestions.activeToken = currentToken;
          renderCommandSuggestions();
        } catch {
          if (requestId === state.commandSuggestions.requestId) closeCommandSuggestions();
        }
      }, 120);
    }

    function handleCommandSuggestionKeydown(event) {
      if (!state.commandSuggestions.open || state.commandSuggestions.items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveCommandSuggestionSelection(1);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveCommandSuggestionSelection(-1);
        return true;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        applyCommandSuggestion(state.commandSuggestions.selectedIndex);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandSuggestions();
        return true;
      }
      return false;
    }

    function renderInlineMarkdown(value) {
      const tick = String.fromCharCode(96);
      const inlineCode = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
      return escapeHtml(value)
        .replace(inlineCode, '<code>$1</code>')
        .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    }

    function tryFormatJson(value) {
      const text = String(value ?? '').trim();
      if (!text || !/^[\\[{]/.test(text)) return null;
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return null;
      }
    }

    function renderCodeBlock(code, language) {
      const label = language && language.trim() ? language.trim() : 'code';
      return '<div class="codeBlock"><div class="codeHeader"><span>' + escapeHtml(label) + '</span><span>CODE</span></div><pre><code>' + escapeHtml(code) + '</code></pre></div>';
    }

    function splitTableRow(line) {
      return line.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(cell => cell.trim());
    }

    function renderMarkdownTable(lines) {
      const header = splitTableRow(lines[0] || '');
      const body = lines.slice(2).filter(line => line.includes('|')).map(splitTableRow);
      return '<div class="tableWrap"><table><thead><tr>' +
        header.map(cell => '<th>' + renderInlineMarkdown(cell) + '</th>').join('') +
        '</tr></thead><tbody>' +
        body.map(row => '<tr>' + row.map(cell => '<td>' + renderInlineMarkdown(cell) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
    }

    function renderMarkdownPlain(block) {
      const lines = String(block || '').split(/\\r?\\n/);
      const output = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] || '';
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (line.includes('|') && lines[index + 1] && /\\|?\\s*:?-{3,}:?\\s*(\\||$)/.test(lines[index + 1])) {
          const tableLines = [line, lines[index + 1]];
          index += 2;
          while (index < lines.length && lines[index].includes('|')) {
            tableLines.push(lines[index]);
            index += 1;
          }
          index -= 1;
          output.push(renderMarkdownTable(tableLines));
          continue;
        }
        if (/^#{1,3}\\s+/.test(trimmed)) {
          const level = Math.min(3, trimmed.match(/^#+/)?.[0].length || 3);
          output.push('<h' + level + '>' + renderInlineMarkdown(trimmed.replace(/^#{1,3}\\s+/, '')) + '</h' + level + '>');
          continue;
        }
        if (trimmed.startsWith('>')) {
          output.push('<blockquote>' + renderInlineMarkdown(trimmed.replace(/^>\\s?/, '')) + '</blockquote>');
          continue;
        }
        if (/^[-*]\\s+/.test(trimmed)) {
          const items = [];
          while (index < lines.length && /^[-*]\\s+/.test((lines[index] || '').trim())) {
            items.push('<li>' + renderInlineMarkdown((lines[index] || '').trim().replace(/^[-*]\\s+/, '')) + '</li>');
            index += 1;
          }
          index -= 1;
          output.push('<ul>' + items.join('') + '</ul>');
          continue;
        }
        output.push('<p>' + renderInlineMarkdown(line) + '</p>');
      }
      return output.join('');
    }

    function renderMarkdownContent(content) {
      const source = String(content ?? '');
      if (!source.trim()) {
        return '<span class="oc-typing-dots" aria-label="正在生成"><span></span><span></span><span></span></span>';
      }
      const json = tryFormatJson(source);
      if (json) return '<pre class="jsonBlock">' + escapeHtml(json) + '</pre>';
      const fence = String.fromCharCode(96, 96, 96);
      const parts = source.split(fence);
      return parts.map((part, index) => {
        if (index % 2 === 0) return renderMarkdownPlain(part);
        const lines = part.replace(/^\\r?\\n/, '').split(/\\r?\\n/);
        const first = lines[0] || '';
        const hasLanguage = first.trim() && !/\\s/.test(first.trim()) && lines.length > 1;
        const language = hasLanguage ? first.trim() : 'code';
        const code = hasLanguage ? lines.slice(1).join('\\n') : lines.join('\\n');
        return renderCodeBlock(code, language);
      }).join('');
    }

    function skeletonStack() {
      return '<div class="skeletonStack" aria-busy="true"><div class="oc-skeleton"></div><div class="oc-skeleton"></div><div class="oc-skeleton"></div></div>';
    }

    function showToast(message, type) {
      const toast = document.createElement('div');
      toast.className = 'toast ' + (type || 'success');
      toast.textContent = message;
      toastStack.appendChild(toast);
      window.setTimeout(() => {
        toast.classList.add('leaving');
        window.setTimeout(() => toast.remove(), 220);
      }, 2600);
    }

    function attachmentStatusLabel(status) {
      return {
        uploading: '读取中',
        ready: '已就绪',
        failed: '失败'
      }[status] || '准备中';
    }

    function renderAttachments() {
      attachmentTray.hidden = state.attachments.length === 0;
      attachmentTray.innerHTML = state.attachments.map(item => [
        '<span class="attachmentChip" data-status="' + escapeHtml(item.status) + '" title="' + escapeHtml(item.error || item.name) + '">',
        '<span class="attachmentName">' + escapeHtml(item.name) + '</span>',
        '<span class="attachmentStatus"><span class="statusDot"></span>' + escapeHtml(attachmentStatusLabel(item.status)) + '</span>',
        '<button class="attachmentRemove" type="button" aria-label="移除附件" data-attachment-remove="' + escapeHtml(item.id) + '">' + iconSvg.x + '</button>',
        '</span>'
      ].join('')).join('');
      attachmentTray.querySelectorAll('[data-attachment-remove]').forEach(button => {
        button.addEventListener('click', () => {
          const id = button.dataset.attachmentRemove;
          state.attachments = state.attachments.filter(item => item.id !== id);
          renderAttachments();
        });
      });
    }

    function updateAttachmentStatus(id, status, error, fields) {
      const item = state.attachments.find(candidate => candidate.id === id);
      if (!item) return;
      item.status = status;
      item.error = error || '';
      Object.assign(item, fields || {});
      renderAttachments();
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
      }
      return btoa(binary);
    }

    async function readComposerFile(file, id) {
      if (file.size > MAX_COMPOSER_ATTACHMENT_BYTES) {
        updateAttachmentStatus(id, 'failed', '附件超过 15 MB。');
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        updateAttachmentStatus(id, 'ready', '', {
          contentBase64: arrayBufferToBase64(buffer),
          mimeType: file.type || '',
          size: file.size
        });
      } catch (error) {
        updateAttachmentStatus(id, 'failed', error.message || '附件读取失败。');
      }
    }

    function addComposerFiles(files) {
      const incoming = Array.from(files || []);
      const available = MAX_COMPOSER_ATTACHMENT_COUNT - state.attachments.length;
      if (available <= 0) {
        showToast('最多只能添加 10 个附件。', 'warning');
        return;
      }
      if (incoming.length > available) {
        showToast('最多只能添加 10 个附件。', 'warning');
      }
      incoming.slice(0, available).forEach(file => {
        const id = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        state.attachments.push({
          id,
          name: file.name || 'attachment',
          mimeType: file.type || '',
          size: file.size,
          contentBase64: '',
          status: 'uploading',
          error: ''
        });
        void readComposerFile(file, id);
      });
      renderAttachments();
    }

    const menuLabels = {
      chat: '对话',
      memory: '记忆',
      assets: '资产',
      assetHub: '资产 Hub',
      providers: '模型提供方',
      tools: '工具',
      settings: '设置'
    };

    const statusLabels = {
      Ready: '就绪',
      Running: '运行中',
      Stopping: '正在停止',
      'Stopping...': '正在停止...',
      Disconnected: '已断开',
      'Connection error': '连接错误',
      Error: '错误',
      'Token missing': '缺少令牌',
      'Bootstrap failed': '启动失败'
    };

    const commonText = new Map([
      ['Session ended', '会话已结束'],
      ['Chat session started', '对话会话已启动'],
      ['User message', '用户消息'],
      ['Sent to local CLI', '已发送到本地 CLI'],
      ['No running session', '没有正在运行的会话'],
      ['Interrupting session', '正在中断会话'],
      ['CLI stderr', 'CLI stderr'],
      ['Session selected', '已选择会话'],
      ['New chat created', '已新建对话'],
      ['Session refreshed', '会话已刷新'],
      ['Provider saved', '模型提供方已保存'],
      ['Configuration saved', '配置已保存'],
      ['Midscene settings applied to new local CLI process', 'Midscene 设置已应用到新的本地 CLI 进程'],
      ['Provider save failed', '模型提供方保存失败'],
      ['Invalid event', '无效事件'],
      ['Launch the web command again.', '请重新启动 web 命令。'],
      ['Missing local session token.', '缺少本地会话令牌。'],
      ['Request failed.', '请求失败。'],
      ['Activity', '活动'],
      ['status', '状态'],
      ['error', '错误'],
      ['Tool permission', '工具授权'],
      ['Tool', '工具']
    ]);

    function localizeStatus(text) {
      return statusLabels[text] || localizeCommonText(text);
    }

    function localizeMenuLabel(menu, fallback) {
      return menuLabels[menu] || localizeCommonText(fallback || '模型提供方');
    }

    function localizeCommonText(text) {
      return commonText.get(text) || text;
    }

    function setStatus(text) {
      statusText.textContent = localizeStatus(text);
    }

    function updateStopControl() {
      const visible = state.running || Boolean(state.pendingPermission);
      stopSession.hidden = !visible;
      stopSession.disabled = !visible || state.stopping;
    }

    function setRunning(running) {
      state.running = running;
      if (!running) state.stopping = false;
      sendButton.classList.toggle('isLoading', running);
      sendButton.setAttribute('aria-busy', running ? 'true' : 'false');
      updateStopControl();
    }

    function clearPendingPermission() {
      state.pendingPermission = null;
      modal.classList.remove('open');
      updateStopControl();
    }

    function setProviderSummary(profile) {
      if (!profile) {
        providerSummary.textContent = '未配置模型提供方';
        return;
      }
      providerSummary.textContent = [profile.displayName, profile.model].filter(Boolean).join(' / ');
    }

    function authHeaders(extra) {
      return Object.assign({ Authorization: 'Bearer ' + state.token }, extra || {});
    }

    async function api(path, options) {
      if (!state.token) throw new Error('缺少本地会话令牌。');
      const response = await fetch(path, Object.assign({}, options || {}, {
        headers: authHeaders((options && options.headers) || {})
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '请求失败。');
      return data;
    }

    function getErrorMessage(error) {
      return error && error.message ? error.message : String(error);
    }

    function formatBytes(bytes) {
      if (!bytes) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function shortTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function isWorkspaceMenu(menu) {
      return menu === 'memory' || menu === 'assets' || menu === 'assetHub' || menu === 'tools';
    }

    function animateMainView(activeView) {
      if (state.mainViewAnimationFrame) {
        window.cancelAnimationFrame(state.mainViewAnimationFrame);
      }
      activeView.classList.remove('oc-slide-up');
      state.mainViewAnimationFrame = window.requestAnimationFrame(() => {
        activeView.classList.add('oc-slide-up');
        state.mainViewAnimationFrame = 0;
      });
    }

    function renderMainView() {
      const workspaceActive = isWorkspaceMenu(state.activeMenu);
      const viewChanged = state.mainViewWorkspaceActive !== workspaceActive;
      state.mainViewWorkspaceActive = workspaceActive;
      workspaceView.hidden = !workspaceActive;
      messages.hidden = workspaceActive;
      composer.hidden = workspaceActive;
      const activeView = workspaceActive ? workspaceView : messages;
      if (viewChanged) {
        animateMainView(activeView);
      }
      if (state.activeMenu === 'memory') {
        renderMemoryWorkspace();
      } else if (state.activeMenu === 'assets') {
        renderAssetsWorkspace();
      } else if (state.activeMenu === 'assetHub') {
        renderAssetHubWorkspace();
      } else if (state.activeMenu === 'tools') {
        renderToolsWorkspace();
      }
    }

    function connectWs() {
      if (state.ws && state.ws.readyState <= 1) return state.ws;
      if (!state.token) {
        setStatus('Token missing');
        addActivity({ kind: 'error', title: 'Token missing', detail: 'Launch the web command again.', at: Date.now() });
        return null;
      }
      const wsUrl = new URL('/ws', location.href);
      wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.searchParams.set('token', state.token);
      state.ws = new WebSocket(wsUrl);
      state.ws.addEventListener('open', () => setStatus('Ready'));
      state.ws.addEventListener('close', () => {
        setStatus('Disconnected');
        clearPendingPermission();
        setRunning(false);
      });
      state.ws.addEventListener('error', () => {
        setStatus('Connection error');
        setRunning(false);
      });
      state.ws.addEventListener('message', event => {
        try {
          handleServerEvent(JSON.parse(event.data));
        } catch {
          addActivity({ kind: 'error', title: 'Invalid event', at: Date.now() });
        }
      });
      return state.ws;
    }

    function sendWs(message) {
      const ws = connectWs();
      if (!ws) return;
      const write = () => ws.send(JSON.stringify(message));
      if (ws.readyState === WebSocket.OPEN) write();
      else ws.addEventListener('open', write, { once: true });
    }

    function renderNav() {
      document.querySelectorAll('.navButton').forEach(button => {
        const menu = button.dataset.menu;
        const icon = state.bootstrap?.primaryMenus?.find(item => item.id === menu)?.icon;
        button.innerHTML = iconSvg[icon] || '';
        button.classList.toggle('active', menu === state.activeMenu);
      });
    }

    function initNavControls() {
      const rail = document.querySelector('.rail');
      rail?.addEventListener('click', event => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('.navButton[data-menu]');
        if (!button || !rail.contains(button)) return;
        selectMenu(button.dataset.menu);
      });
    }

    function selectMenu(menu) {
      if (!menu) return;
      const isCurrentMenu = menu === state.activeMenu;
      if (isCurrentMenu) {
        if (state.secondaryCollapsed) {
          state.secondaryCollapsed = false;
          renderLayout();
        }
        return;
      }
      state.activeMenu = menu;
      state.secondaryCollapsed = false;
      renderLayout();
      renderSecondary();
      renderNav();
      renderMainView();
      if (menu === 'memory' && !state.memory.status) {
        refreshMemory();
      }
      if (menu === 'assets' && state.assets.list.length === 0) {
        refreshAssets();
      }
      if (menu === 'assetHub') {
        if (state.assetHub.items.length === 0) refreshAssetHub();
        if (state.assets.list.length === 0) refreshAssets(false);
      }
      if (menu === 'tools' && state.tools.plugins.length === 0 && !state.tools.loading) {
        refreshTools();
      }
      if (menu === 'tools' && state.tools.mcpServers.length === 0 && !state.tools.mcpLoading) {
        refreshMcpServers();
      }
      if (menu === 'settings' && !state.platformAuth.status) {
        refreshPlatformSettings();
      }
    }

    function renderLayout() {
      app.classList.toggle('secondaryCollapsed', state.secondaryCollapsed);
      app.classList.toggle('activityCollapsed', state.activityCollapsed);
      activityPanel.classList.toggle('activityCollapsed', state.activityCollapsed);
    }

    function renderSecondary() {
      const label = localizeMenuLabel(
        state.activeMenu,
        state.bootstrap?.primaryMenus?.find(item => item.id === state.activeMenu)?.label || '模型提供方'
      );
      secondaryTitle.textContent = label;
      if (state.activeMenu === 'providers') {
        renderProviderPanel();
      } else if (state.activeMenu === 'chat') {
        renderChatPanel();
      } else if (state.activeMenu === 'memory') {
        renderMemoryPanel();
      } else if (state.activeMenu === 'assets') {
        renderAssetsPanel();
      } else if (state.activeMenu === 'assetHub') {
        renderAssetHubPanel();
      } else if (state.activeMenu === 'tools') {
        renderToolsPanel();
      } else if (state.activeMenu === 'settings') {
        renderSettingsPanel();
      } else {
        secondaryBody.innerHTML = '<div class="ghostState">' + escapeHtml(label) + ' 面板尚未开放。</div>';
      }
    }

    async function refreshMemory() {
      try {
        state.memory.error = '';
        state.memory.loading = true;
        renderSecondary();
        renderMainView();
        const status = await api('/api/memory/status');
        const files = await api('/api/memory/files');
        state.memory.status = status;
        state.memory.files = files.files || [];
        if (!state.memory.selectedId && state.memory.files.length) {
          state.memory.selectedId = state.memory.files[0].id;
        }
        state.memory.loading = false;
        renderSecondary();
        renderMainView();
        if (state.memory.selectedId && !state.memory.selectedFile && !state.memory.newDraft) {
          await loadMemoryFile(state.memory.selectedId);
        }
      } catch (error) {
        state.memory.loading = false;
        state.memory.error = getErrorMessage(error);
        renderSecondary();
        renderMainView();
      }
    }

    async function loadMemoryFile(fileId) {
      try {
        state.memory.error = '';
        state.memory.newDraft = false;
        state.memory.graph = null;
        state.memory.selectedId = fileId;
        const result = await api('/api/memory/files/' + encodeURIComponent(fileId));
        state.memory.selectedFile = result.file || null;
        state.memory.draftContent = state.memory.selectedFile?.content || '';
        state.memory.unsaved = false;
        state.memory.editorMode = 'edit';
        renderSecondary();
        renderMainView();
      } catch (error) {
        state.memory.error = getErrorMessage(error);
        renderSecondary();
        renderMainView();
      }
    }

    async function loadKnowledgeGraph() {
      try {
        state.memory.error = '';
        state.memory.newDraft = false;
        state.memory.selectedId = 'knowledge-graph';
        state.memory.selectedFile = null;
        state.memory.graph = await api('/api/memory/knowledge-graph');
        renderSecondary();
        renderMainView();
      } catch (error) {
        state.memory.error = getErrorMessage(error);
        renderSecondary();
        renderMainView();
      }
    }

    async function runMemorySearch() {
      try {
        const q = state.memory.search.trim();
        state.memory.searchResults = q ? (await api('/api/memory/search?q=' + encodeURIComponent(q))).results || [] : [];
        renderMemoryPanel();
      } catch (error) {
        state.memory.error = getErrorMessage(error);
        renderMemoryPanel();
      }
    }

    function renderMemoryPanel() {
      const status = state.memory.status;
      const files = state.memory.files || [];
      const indexFiles = files.filter(file => file.kind === 'index');
      const topicFiles = files.filter(file => file.kind === 'topic' || file.kind === 'other');
      const dailyLogs = files.filter(file => file.kind === 'daily-log');
      const fileIcon = file => file.kind === 'index' ? iconSvg.book : file.kind === 'daily-log' ? iconSvg.calendar : iconSvg.file;
      const fileButton = file => [
        '<button class="listItem ' + (state.memory.selectedId === file.id ? 'active' : '') + '" data-memory-file="' + escapeHtml(file.id) + '">',
        '<div class="listItemHeader"><strong><span class="fileIcon">' + fileIcon(file) + '</span>' + escapeHtml(file.title || file.name) + '</strong><span class="statusBadge">' + escapeHtml(file.kind) + '</span></div>',
        '<span>' + escapeHtml(file.relativePath) + '</span>',
        '<span>' + escapeHtml([file.kind, formatBytes(file.sizeBytes), shortTime(file.updatedAt)].filter(Boolean).join(' / ')) + '</span>',
        '</button>'
      ].join('');
      const searchResults = state.memory.searchResults || [];
      const extractionEnabled = Boolean(status?.autoMemoryExtractionEnabled);
      const graphCollectionEnabled = Boolean(status?.knowledgeGraphCollectionEnabled);
      secondaryBody.innerHTML = [
        state.memory.error ? '<div class="errorBox"><strong>记忆加载失败</strong><div>' + escapeHtml(state.memory.error) + '</div><button class="miniButton" type="button" data-memory-refresh>重试</button></div>' : '',
        '<div class="profileSummary">',
        status ? [
          '<strong class="summaryLine">' + escapeHtml(status.autoMemoryEnabled ? '自动记忆已启用' : '自动记忆已禁用') + ' <span class="statusBadge ' + (status.autoMemoryEnabled ? 'success' : '') + '">' + (status.autoMemoryEnabled ? 'Enabled' : 'Disabled') + '</span></strong>',
          '<span class="summaryLine">Auto write <span class="statusBadge ' + (extractionEnabled ? 'success' : '') + '">' + (extractionEnabled ? 'Enabled' : 'Disabled') + '</span></span>',
          '<span class="summaryLine">Graph capture <span class="statusBadge ' + (graphCollectionEnabled ? 'success' : '') + '">' + (graphCollectionEnabled ? 'Enabled' : 'Disabled') + '</span></span>',
          '<span class="summaryLine">工作区记忆：' + escapeHtml(status.memoryDir || '') + '</span>',
          '<span class="summaryLine">' + escapeHtml((status.memoryFileCount || 0) + ' 个文件 / ' + formatBytes(status.totalBytes || 0)) + '</span>'
        ].join('') : skeletonStack(),
        '</div>',
        '<div class="toolbarRow">',
        '<button class="miniButton" type="button" data-memory-refresh>刷新</button>',
        '<button class="miniButton" type="button" data-memory-new>新建记忆</button>',
        '</div>',
        '<div class="field"><label for="memorySearch">搜索</label><input id="memorySearch" value="' + escapeHtml(state.memory.search) + '" autocomplete="off"></div>',
        '<button class="secondaryAction" type="button" data-memory-search>搜索记忆</button>',
        '<div class="memorySectionStack">',
        searchResults.length ? '<section class="formSection"><div class="sectionHeader"><h3>结果</h3></div><div class="itemList">' + searchResults.map(result => [
          '<button class="listItem" data-memory-file="' + escapeHtml(result.fileId) + '">',
          '<strong>' + escapeHtml(result.relativePath) + '</strong>',
          '<span>' + escapeHtml(result.snippet) + '</span>',
          '</button>'
        ].join('')).join('') + '</div></section>' : '',
        state.memory.loading ? skeletonStack() : '',
        '<section class="formSection"><div class="sectionHeader"><h3>索引</h3></div><div class="itemList">' + (indexFiles.length ? indexFiles.map(fileButton).join('') : '<div class="ghostState">还没有 MEMORY.md。</div>') + '</div></section>',
        '<section class="formSection"><div class="sectionHeader"><h3>主题文件</h3></div><div class="itemList">' + (topicFiles.length ? topicFiles.map(fileButton).join('') : '<div class="ghostState">还没有主题记忆。</div>') + '</div></section>',
        dailyLogs.length ? '<section class="formSection"><div class="sectionHeader"><h3>每日日志</h3></div><div class="itemList">' + dailyLogs.map(fileButton).join('') + '</div></section>' : '',
        '<section class="formSection"><div class="sectionHeader"><h3>知识</h3></div><div class="itemList"><button class="listItem ' + (state.memory.selectedId === 'knowledge-graph' ? 'active' : '') + '" data-memory-graph><strong>Knowledge Graph</strong><span>' + escapeHtml(status ? String(status.knowledgeGraphStats.entityCount) + ' 个实体 / ' + String(status.knowledgeGraphStats.summaryCount) + ' 条摘要' : '图谱状态') + '</span></button></div></section>',
        '</div>'
      ].join('');
      const search = document.getElementById('memorySearch');
      if (search) {
        search.addEventListener('input', () => {
          state.memory.search = search.value;
        });
        search.addEventListener('keydown', event => {
          if (event.key === 'Enter') runMemorySearch();
        });
      }
      secondaryBody.querySelectorAll('[data-memory-refresh]').forEach(button => button.addEventListener('click', () => refreshMemory()));
      secondaryBody.querySelector('[data-memory-new]')?.addEventListener('click', () => {
        state.memory.newDraft = true;
        state.memory.selectedId = null;
        state.memory.selectedFile = null;
        state.memory.graph = null;
        state.memory.draftContent = '';
        state.memory.unsaved = false;
        state.memory.editorMode = 'edit';
        renderMainView();
      });
      secondaryBody.querySelector('[data-memory-search]')?.addEventListener('click', () => runMemorySearch());
      secondaryBody.querySelectorAll('[data-memory-file]').forEach(button => {
        button.addEventListener('click', () => loadMemoryFile(button.dataset.memoryFile));
      });
      secondaryBody.querySelector('[data-memory-graph]')?.addEventListener('click', () => loadKnowledgeGraph());
    }

    function renderMemoryWorkspace() {
      if (state.memory.newDraft) {
        workspaceView.innerHTML = [
          '<div class="workspaceHeader"><div><h2>新建记忆</h2><div class="workspaceMeta">在当前记忆目录中创建一条主题记忆。</div></div></div>',
          '<form id="memoryCreateForm" class="workspaceCard">',
          '<div class="splitFields">',
          '<div class="field"><label for="memoryFilename">文件名</label><input id="memoryFilename" autocomplete="off" placeholder="robot_testing.md"></div>',
          '<div class="field"><label for="memoryType">类型</label><input id="memoryType" autocomplete="off" placeholder="project"></div>',
          '</div>',
          '<div class="field"><label for="memoryTitle">标题</label><input id="memoryTitle" autocomplete="off"></div>',
          '<div class="field"><label for="memoryDescription">描述</label><input id="memoryDescription" autocomplete="off"></div>',
          '<div class="field"><label for="memoryContent">内容</label><textarea id="memoryContent" class="editorArea"></textarea></div>',
          '<label class="toolbarRow"><input id="memoryAddToIndex" type="checkbox" checked style="width:auto;height:auto"> 添加到 MEMORY.md</label>',
          '<button class="primaryButton ' + (state.memory.saving ? 'buttonLoading' : '') + '" type="submit" aria-busy="' + String(state.memory.saving) + '">' + (state.memory.saving ? '创建中' : '创建记忆') + '</button>',
          '</form>'
        ].join('');
        document.getElementById('memoryCreateForm').addEventListener('submit', async event => {
          event.preventDefault();
          try {
            state.memory.saving = true;
            const result = await api('/api/memory/files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: document.getElementById('memoryFilename').value,
                title: document.getElementById('memoryTitle').value,
                description: document.getElementById('memoryDescription').value,
                type: document.getElementById('memoryType').value,
                content: document.getElementById('memoryContent').value,
                addToIndex: document.getElementById('memoryAddToIndex').checked
              })
            });
            state.memory.newDraft = false;
            state.memory.selectedId = result.file.id;
            state.memory.selectedFile = result.file;
            state.memory.draftContent = result.file.content || '';
            state.memory.unsaved = false;
            state.memory.saving = false;
            await refreshMemory();
            showToast('记忆已创建', 'success');
          } catch (error) {
            state.memory.saving = false;
            state.memory.error = getErrorMessage(error);
            renderSecondary();
            showToast('创建记忆失败', 'error');
          }
        });
        return;
      }

      if (state.memory.selectedId === 'knowledge-graph') {
        renderKnowledgeGraphWorkspace();
        return;
      }

      const file = state.memory.selectedFile;
      if (!file) {
        workspaceView.innerHTML = '<div class="workspaceCard ghostState">选择一个记忆文件查看内容。</div>';
        return;
      }
      const readonly = file.readonly;
      const draftContent = state.memory.draftContent !== undefined ? state.memory.draftContent : (file.content || '');
      const editorActive = state.memory.editorMode !== 'preview';
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>' + escapeHtml(file.title || file.name) + '</h2><div class="workspaceMeta">' + escapeHtml(file.relativePath) + '</div></div>',
        '<div class="toolbarRow">',
        '<button class="miniButton ' + (state.memory.saving ? 'buttonLoading' : '') + '" type="button" data-memory-save aria-busy="' + String(state.memory.saving) + '" ' + (readonly || state.memory.saving ? 'disabled' : '') + '>' + (state.memory.saving ? '保存中' : '保存') + '</button>',
        file.kind !== 'index' && file.kind !== 'daily-log' ? '<button class="miniButton danger" type="button" data-memory-delete>删除</button>' : '',
        '</div></div>',
        (file.warnings || []).map(warning => '<div class="readonlyNotice">' + escapeHtml(warning) + '</div>').join(''),
        readonly ? '<div class="readonlyNotice">此记忆文件在 Web UI 中为只读。</div>' : '',
        state.memory.unsaved ? '<div class="unsavedNotice">有未保存更改。</div>' : '',
        '<div class="workspaceCard">',
        '<div class="tagRow"><span class="tag">' + escapeHtml(file.kind) + '</span><span class="tag">' + escapeHtml(formatBytes(file.sizeBytes)) + '</span><span class="tag">' + escapeHtml(shortTime(file.updatedAt)) + '</span></div>',
        '<div class="field" style="margin-top:12px"><label>Markdown</label><div class="editorTabs"><button class="miniButton ' + (editorActive ? 'active' : '') + '" type="button" data-memory-editor-tab="edit">编辑</button><button class="miniButton ' + (!editorActive ? 'active' : '') + '" type="button" data-memory-editor-tab="preview">预览</button></div>' +
          (editorActive ? '<textarea id="memoryEditor" class="editorArea" ' + (readonly ? 'readonly' : '') + '>' + escapeHtml(draftContent) + '</textarea>' : '<div class="previewPane markdownBody">' + renderMarkdownContent(draftContent) + '</div>') +
        '</div>',
        '</div>'
      ].join('');
      workspaceView.querySelectorAll('[data-memory-editor-tab]').forEach(button => {
        button.addEventListener('click', () => {
          state.memory.editorMode = button.dataset.memoryEditorTab || 'edit';
          const editor = document.getElementById('memoryEditor');
          if (editor) state.memory.draftContent = editor.value;
          renderMemoryWorkspace();
        });
      });
      document.getElementById('memoryEditor')?.addEventListener('input', event => {
        state.memory.draftContent = event.target.value;
        state.memory.unsaved = state.memory.draftContent !== (file.content || '');
        const notice = workspaceView.querySelector('.unsavedNotice');
        if (!notice && state.memory.unsaved) renderMemoryWorkspace();
      });
      workspaceView.querySelector('[data-memory-save]')?.addEventListener('click', async () => {
        try {
          state.memory.saving = true;
          renderMemoryWorkspace();
          const result = await api('/api/memory/files/' + encodeURIComponent(file.id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: state.memory.draftContent })
          });
          state.memory.selectedFile = result.file;
          state.memory.draftContent = result.file.content || '';
          state.memory.unsaved = false;
          state.memory.saving = false;
          await refreshMemory();
          showToast('记忆已保存', 'success');
        } catch (error) {
          state.memory.saving = false;
          state.memory.error = getErrorMessage(error);
          renderSecondary();
          renderMemoryWorkspace();
          showToast('保存记忆失败', 'error');
        }
      });
      workspaceView.querySelector('[data-memory-delete]')?.addEventListener('click', async () => {
        if (!confirm('确定删除这个记忆文件吗？')) return;
        try {
          await api('/api/memory/files/' + encodeURIComponent(file.id), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
          });
          state.memory.selectedId = null;
          state.memory.selectedFile = null;
          await refreshMemory();
          showToast('记忆已删除', 'success');
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
          showToast('删除记忆失败', 'error');
        }
      });
    }

    function renderKnowledgeGraphWorkspace() {
      const graph = state.memory.graph;
      if (!graph) {
        workspaceView.innerHTML = '<div class="workspaceCard ghostState">正在加载知识图谱...</div>';
        return;
      }
      const activeTab = state.memory.graphTab;
      const tabs = ['entities', 'relations', 'summaries', 'rules'];
      const rows = {
        entities: graph.entities.map(entity => '<tr><td>' + escapeHtml(entity.type) + '</td><td>' + escapeHtml(entity.name) + '</td><td>' + escapeHtml(JSON.stringify(entity.attributes || {})) + '</td></tr>').join(''),
        relations: graph.relations.map(rel => '<tr><td>' + escapeHtml(rel.sourceId) + '</td><td>' + escapeHtml(rel.type) + '</td><td>' + escapeHtml(rel.targetId) + '</td></tr>').join(''),
        summaries: graph.summaries.map(summary => '<tr><td class="graphTimeCell">' + escapeHtml(shortTime(summary.timestamp)) + '</td><td class="graphContentCell">' + escapeHtml(summary.content) + '</td><td class="graphKeywordsCell">' + escapeHtml((summary.keywords || []).join(', ')) + '</td></tr>').join(''),
        rules: graph.rules.map(rule => '<tr><td>' + escapeHtml(rule) + '</td></tr>').join('')
      };
      const headers = {
        entities: '<tr><th>类型</th><th>名称</th><th>属性</th></tr>',
        relations: '<tr><th>来源</th><th>类型</th><th>目标</th></tr>',
        summaries: '<tr><th class="graphTimeCell">时间</th><th class="graphContentCell">内容</th><th class="graphKeywordsCell">关键词</th></tr>',
        rules: '<tr><th>规则</th></tr>'
      };
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>Knowledge Graph</h2><div class="workspaceMeta">' + escapeHtml(graph.enabled ? '已启用' : '已禁用') + ' / ' + escapeHtml(String(graph.entities.length)) + ' 个实体 / ' + escapeHtml(String(graph.summaries.length)) + ' 条摘要</div></div>',
        '<div class="toolbarRow">',
        '<button class="miniButton" type="button" data-graph-refresh>刷新</button>',
        '<button class="miniButton" type="button" data-graph-toggle>' + (graph.enabled ? '禁用' : '启用') + '</button>',
        '<button class="miniButton danger" type="button" data-graph-clear>清空图谱</button>',
        '</div></div>',
        '<div class="workspaceCard">',
        '<div class="graphTabs">' + tabs.map(tab => '<button class="miniButton ' + (tab === activeTab ? 'active' : '') + '" type="button" data-graph-tab="' + tab + '">' + tab + '</button>').join('') + '</div>',
        '<table class="graphTable"><tbody>' + headers[activeTab] + (rows[activeTab] || '<tr><td>暂无数据</td></tr>') + '</tbody></table>',
        '</div>'
      ].join('');
      workspaceView.querySelector('[data-graph-refresh]')?.addEventListener('click', () => loadKnowledgeGraph());
      workspaceView.querySelector('[data-graph-toggle]')?.addEventListener('click', async () => {
        try {
          state.memory.graph = await api('/api/memory/knowledge-graph/enable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !graph.enabled })
          });
          await refreshMemory();
          showToast(graph.enabled ? '知识图谱已禁用' : '知识图谱已启用', 'success');
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
          showToast('知识图谱更新失败', 'error');
        }
      });
      workspaceView.querySelector('[data-graph-clear]')?.addEventListener('click', async () => {
        if (!confirm('确定清空 Knowledge Graph 吗？此操作无法撤销。')) return;
        try {
          state.memory.graph = await api('/api/memory/knowledge-graph/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
          });
          await refreshMemory();
          showToast('知识图谱已清空', 'success');
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
          showToast('清空知识图谱失败', 'error');
        }
      });
      workspaceView.querySelectorAll('[data-graph-tab]').forEach(button => {
        button.addEventListener('click', () => {
          state.memory.graphTab = button.dataset.graphTab;
          renderKnowledgeGraphWorkspace();
        });
      });
    }

    async function refreshAssets(loadSelected) {
      try {
        state.assets.error = '';
        state.assets.loading = true;
        renderSecondary();
        renderMainView();
        const params = new URLSearchParams();
        if (state.assets.query.trim()) params.set('q', state.assets.query.trim());
        if (state.assets.kind) params.set('kind', state.assets.kind);
        if (state.assets.source) params.set('source', state.assets.source);
        const result = await api('/api/assets' + (params.toString() ? '?' + params.toString() : ''));
        state.assets.list = result.assets || [];
        state.assets.roots = result.roots || null;
        if (!state.assets.selectedId || !state.assets.list.some(asset => asset.id === state.assets.selectedId)) {
          state.assets.selectedId = state.assets.list[0]?.id || null;
          state.assets.selectedAsset = null;
        }
        state.assets.loading = false;
        renderSecondary();
        renderMainView();
        if (loadSelected !== false && state.assets.selectedId && !state.assets.selectedAsset && !state.assets.newDraft) {
          await loadAssetDetail(state.assets.selectedId);
        }
      } catch (error) {
        state.assets.loading = false;
        state.assets.error = getErrorMessage(error);
        renderSecondary();
        renderMainView();
      }
    }

    async function loadAssetDetail(assetId) {
      try {
        state.assets.error = '';
        state.assets.newDraft = false;
        state.assets.editing = false;
        state.assets.selectedId = assetId;
        const result = await api('/api/assets/' + encodeURIComponent(assetId));
        state.assets.selectedAsset = result.asset || null;
        renderSecondary();
        renderMainView();
      } catch (error) {
        state.assets.error = getErrorMessage(error);
        renderSecondary();
        renderMainView();
      }
    }

    function renderAssetsPanel() {
      const assets = state.assets.list || [];
      const kinds = Array.from(new Set(assets.map(asset => asset.kind))).sort();
      const sources = Array.from(new Set(assets.map(asset => asset.source))).sort();
      const sourceClass = source => source === 'project' ? 'success' : source === 'user' ? 'running' : '';
      secondaryBody.innerHTML = [
        state.assets.error ? '<div class="errorBox"><strong>资产加载失败</strong><div>' + escapeHtml(state.assets.error) + '</div><button class="miniButton" type="button" data-assets-reload>重试</button></div>' : '',
        '<div class="profileSummary">',
        '<strong class="summaryLine">' + escapeHtml(String(assets.length)) + ' 个资产</strong>',
        state.assets.roots ? '<span class="summaryLine">用户：' + escapeHtml(state.assets.roots.userSkillsDir || '') + '</span><span class="summaryLine">项目：' + escapeHtml(state.assets.roots.projectSkillsDir || '') + '</span>' : '',
        '</div>',
        '<div class="toolbarRow">',
        '<button class="miniButton ' + (state.assets.reloading ? 'buttonLoading' : '') + '" type="button" data-assets-reload aria-busy="' + String(state.assets.reloading) + '">' + (state.assets.reloading ? '加载中' : '重新加载') + '</button>',
        '<button class="miniButton" type="button" data-assets-new>新建 Skill</button>',
        '<button class="miniButton" type="button" data-knowledge-new>新建 Knowledge</button>',
        '<button class="miniButton" type="button" data-assets-import>导入 SKILL.md</button>',
        '<button class="miniButton" type="button" data-knowledge-import>导入 Knowledge</button>',
        '<input id="assetImportFile" type="file" accept=".md,text/markdown" hidden>',
        '<input id="knowledgeImportFile" type="file" accept=".md,text/markdown" hidden>',
        '</div>',
        '<div class="field"><label for="assetSearch">搜索</label><input id="assetSearch" value="' + escapeHtml(state.assets.query) + '" autocomplete="off"></div>',
        '<div class="splitFields">',
        '<div class="field"><label for="assetKind">类型</label><select id="assetKind"><option value="">全部</option>' + kinds.map(kind => '<option value="' + escapeHtml(kind) + '" ' + (state.assets.kind === kind ? 'selected' : '') + '>' + escapeHtml(kind) + '</option>').join('') + '</select></div>',
        '<div class="field"><label for="assetSource">来源</label><select id="assetSource"><option value="">全部</option>' + sources.map(source => '<option value="' + escapeHtml(source) + '" ' + (state.assets.source === source ? 'selected' : '') + '>' + escapeHtml(source) + '</option>').join('') + '</select></div>',
        '</div>',
        '<button class="secondaryAction" type="button" data-assets-filter>应用筛选</button>',
        '<div class="itemList" style="margin-top:14px">',
        state.assets.loading ? skeletonStack() : '',
        assets.length ? assets.map(asset => [
          '<button class="listItem ' + (state.assets.selectedId === asset.id ? 'active' : '') + '" data-asset-id="' + escapeHtml(asset.id) + '">',
          '<div class="listItemHeader"><strong>' + escapeHtml(asset.displayName || asset.name) + '</strong><span class="statusBadge ' + sourceClass(asset.source) + '">' + escapeHtml(asset.source || 'unknown') + '</span></div>',
          '<span>' + (asset.readonly ? '<span class="fileIcon">' + iconSvg.lock + '</span>只读' : '<span class="fileIcon">' + iconSvg.pencil + '</span>可编辑') + ' / ' + escapeHtml(asset.kind) + '</span>',
          '<span>' + escapeHtml(asset.description || '') + '</span>',
          '</button>'
        ].join('')).join('') : (state.assets.loading ? '' : '<div class="ghostState">没有匹配当前筛选条件的资产。<div style="margin-top:10px"><button class="miniButton" type="button" data-assets-new>新建 Skill</button></div></div>'),
        '</div>'
      ].join('');
      const search = document.getElementById('assetSearch');
      const kind = document.getElementById('assetKind');
      const source = document.getElementById('assetSource');
      search?.addEventListener('input', () => {
        state.assets.query = search.value;
      });
      search?.addEventListener('keydown', event => {
        if (event.key === 'Enter') refreshAssets();
      });
      kind?.addEventListener('change', () => {
        state.assets.kind = kind.value;
      });
      source?.addEventListener('change', () => {
        state.assets.source = source.value;
      });
      secondaryBody.querySelector('[data-assets-filter]')?.addEventListener('click', () => refreshAssets());
      secondaryBody.querySelectorAll('[data-assets-reload]').forEach(button => button.addEventListener('click', async () => {
        try {
          state.assets.reloading = true;
          renderAssetsPanel();
          await api('/api/assets/reload', { method: 'POST' });
          await refreshAssets(false);
          state.assets.reloading = false;
          renderAssetsPanel();
          showToast('资产已重新加载', 'success');
        } catch (error) {
          state.assets.reloading = false;
          state.assets.error = getErrorMessage(error);
          renderAssetsPanel();
          showToast('重新加载资产失败', 'error');
        }
      }));
      secondaryBody.querySelectorAll('[data-assets-new]').forEach(button => button.addEventListener('click', () => {
        state.assets.newDraft = true;
        state.assets.draftKind = 'skill';
        state.assets.editing = false;
        state.assets.selectedId = null;
        state.assets.selectedAsset = null;
        renderMainView();
      }));
      secondaryBody.querySelectorAll('[data-knowledge-new]').forEach(button => button.addEventListener('click', () => {
        state.assets.newDraft = true;
        state.assets.draftKind = 'knowledge';
        state.assets.editing = false;
        state.assets.selectedId = null;
        state.assets.selectedAsset = null;
        renderMainView();
      }));
      secondaryBody.querySelector('[data-assets-import]')?.addEventListener('click', () => {
        document.getElementById('assetImportFile')?.click();
      });
      secondaryBody.querySelector('[data-knowledge-import]')?.addEventListener('click', () => {
        document.getElementById('knowledgeImportFile')?.click();
      });
      document.getElementById('assetImportFile')?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const result = await api('/api/assets/skills/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scope: 'project',
                name: file.name.replace(/\\.md$/i, ''),
                content: String(reader.result || '')
              })
            });
            state.assets.selectedId = result.asset.id;
            state.assets.selectedAsset = result.asset;
            await refreshAssets(false);
            renderMainView();
            showToast('Skill 已导入', 'success');
          } catch (error) {
            state.assets.error = getErrorMessage(error);
            renderAssetsPanel();
            showToast('导入 Skill 失败', 'error');
          }
        };
        reader.readAsText(file);
      });
      document.getElementById('knowledgeImportFile')?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const result = await api('/api/assets/knowledge/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: file.name,
                content: String(reader.result || '')
              })
            });
            state.assets.selectedId = result.asset.id;
            state.assets.selectedAsset = result.asset;
            await refreshAssets(false);
            renderMainView();
            showToast('Knowledge 已导入', 'success');
          } catch (error) {
            state.assets.error = getErrorMessage(error);
            renderAssetsPanel();
            showToast('导入 Knowledge 失败', 'error');
          }
        };
        reader.readAsText(file);
      });
      secondaryBody.querySelectorAll('[data-asset-id]').forEach(button => {
        button.addEventListener('click', () => loadAssetDetail(button.dataset.assetId));
      });
    }

    function renderSkillForm(kind, asset) {
      const isEdit = kind === 'edit';
      const content = isEdit ? asset?.content || '' : '';
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>' + (isEdit ? '编辑 Skill' : '新建 Skill') + '</h2><div class="workspaceMeta">' + (isEdit ? escapeHtml(asset.path || '') : '创建用户级或项目级 Skill。') + '</div></div></div>',
        state.assets.error ? '<div class="errorBox">' + escapeHtml(state.assets.error) + '</div>' : '',
        '<form id="skillForm" class="workspaceCard oc-scale-in">',
        isEdit ? '' : '<div class="field"><label for="skillScope">范围</label><select id="skillScope"><option value="project">项目</option><option value="user">用户</option></select></div>',
        isEdit ? '' : '<div class="field"><label for="skillName">名称</label><input id="skillName" autocomplete="off"></div>',
        isEdit ? '' : '<div class="field"><label for="skillDescription">描述</label><input id="skillDescription" autocomplete="off"></div>',
        isEdit ? '' : '<div class="field"><label for="skillWhen">使用时机</label><input id="skillWhen" autocomplete="off"></div>',
        isEdit ? '' : '<div class="splitFields"><div class="field"><label for="skillTools">允许的工具</label><input id="skillTools" autocomplete="off" placeholder="Read, Grep, Bash"></div><div class="field"><label for="skillContext">上下文</label><select id="skillContext"><option value="">未设置</option><option value="inline">Inline</option><option value="fork">Fork</option></select></div></div>',
        isEdit ? '' : '<div class="field"><label for="skillModel">模型</label><input id="skillModel" autocomplete="off" placeholder="inherit"></div>',
        '<div class="field"><label for="skillContent">SKILL.md</label><textarea id="skillContent" class="editorArea">' + escapeHtml(content) + '</textarea></div>',
        '<button class="primaryButton ' + (state.assets.saving ? 'buttonLoading' : '') + '" type="submit" aria-busy="' + String(state.assets.saving) + '" ' + (state.assets.saving ? 'disabled' : '') + '>' + (state.assets.saving ? '保存中' : (isEdit ? '保存 Skill' : '创建 Skill')) + '</button>',
        '</form>'
      ].join('');
      document.getElementById('skillForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          state.assets.saving = true;
          let result;
          if (isEdit) {
            result = await api('/api/assets/skills/' + encodeURIComponent(asset.id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: document.getElementById('skillContent').value })
            });
          } else {
            result = await api('/api/assets/skills', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scope: document.getElementById('skillScope').value,
                name: document.getElementById('skillName').value,
                description: document.getElementById('skillDescription').value,
                whenToUse: document.getElementById('skillWhen').value,
                allowedTools: document.getElementById('skillTools').value.split(',').map(item => item.trim()).filter(Boolean),
                context: document.getElementById('skillContext').value,
                model: document.getElementById('skillModel').value,
                content: document.getElementById('skillContent').value
              })
            });
          }
          state.assets.newDraft = false;
          state.assets.editing = false;
          state.assets.selectedId = result.asset.id;
          state.assets.selectedAsset = result.asset;
          state.assets.saving = false;
          await refreshAssets(false);
          renderMainView();
          showToast(isEdit ? 'Skill 已保存' : 'Skill 已创建', 'success');
        } catch (error) {
          state.assets.saving = false;
          state.assets.error = getErrorMessage(error);
          renderSecondary();
          renderSkillForm(kind, asset);
          showToast('保存 Skill 失败', 'error');
        }
      });
    }

    function renderKnowledgeForm(kind, asset) {
      const isEdit = kind === 'edit';
      const content = isEdit ? asset?.content || '' : '';
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>' + (isEdit ? '编辑 Knowledge' : '新建 Knowledge') + '</h2><div class="workspaceMeta">' + (isEdit ? escapeHtml(asset.path || '') : '创建用户级 Knowledge Markdown 文件') + '</div></div></div>',
        state.assets.error ? '<div class="errorBox">' + escapeHtml(state.assets.error) + '</div>' : '',
        '<form id="knowledgeForm" class="workspaceCard oc-scale-in">',
        isEdit ? '' : '<div class="field"><label for="knowledgeFilename">文件名</label><input id="knowledgeFilename" autocomplete="off" placeholder="my-knowledge.md"></div>',
        isEdit ? '' : '<div class="field"><label for="knowledgeTitle">标题</label><input id="knowledgeTitle" autocomplete="off"></div>',
        isEdit ? '' : '<div class="field"><label for="knowledgeDescription">描述</label><input id="knowledgeDescription" autocomplete="off"></div>',
        '<div class="field"><label for="knowledgeContent">Markdown</label><textarea id="knowledgeContent" class="editorArea">' + escapeHtml(content) + '</textarea></div>',
        '<button class="primaryButton ' + (state.assets.saving ? 'buttonLoading' : '') + '" type="submit" aria-busy="' + String(state.assets.saving) + '" ' + (state.assets.saving ? 'disabled' : '') + '>' + (state.assets.saving ? '保存中' : (isEdit ? '保存 Knowledge' : '创建 Knowledge')) + '</button>',
        '</form>'
      ].join('');
      document.getElementById('knowledgeForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          state.assets.saving = true;
          let result;
          if (isEdit) {
            result = await api('/api/assets/knowledge/' + encodeURIComponent(asset.id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: document.getElementById('knowledgeContent').value })
            });
          } else {
            result = await api('/api/assets/knowledge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: document.getElementById('knowledgeFilename').value,
                title: document.getElementById('knowledgeTitle').value,
                description: document.getElementById('knowledgeDescription').value,
                content: document.getElementById('knowledgeContent').value
              })
            });
          }
          state.assets.newDraft = false;
          state.assets.editing = false;
          state.assets.selectedId = result.asset.id;
          state.assets.selectedAsset = result.asset;
          state.assets.saving = false;
          await refreshAssets(false);
          renderMainView();
          showToast(isEdit ? 'Knowledge 已保存' : 'Knowledge 已创建', 'success');
        } catch (error) {
          state.assets.saving = false;
          state.assets.error = getErrorMessage(error);
          renderSecondary();
          renderKnowledgeForm(kind, asset);
          showToast('保存 Knowledge 失败', 'error');
        }
      });
    }

    function renderAssetsWorkspace() {
      if (state.assets.newDraft) {
        if (state.assets.draftKind === 'knowledge') renderKnowledgeForm('new');
        else renderSkillForm('new');
        return;
      }
      const asset = state.assets.selectedAsset;
      if (!asset) {
        workspaceView.innerHTML = '<div class="workspaceCard ghostState">选择一个资产查看内容。</div>';
        return;
      }
      if (state.assets.editing && !asset.readonly) {
        if (asset.kind === 'knowledge') renderKnowledgeForm('edit', asset);
        else renderSkillForm('edit', asset);
        return;
      }
      const enabledClass = asset.enabled ? 'success' : 'warning';
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>' + escapeHtml(asset.displayName || asset.name) + '</h2><div class="workspaceMeta">' + escapeHtml(asset.path || asset.description || '') + '</div></div>',
        '<div class="toolbarRow">',
        asset.readonly ? '' : '<button class="miniButton" type="button" data-asset-edit>编辑</button>',
        asset.readonly ? '' : '<button class="miniButton danger" type="button" data-asset-delete>删除</button>',
        '</div></div>',
        state.assets.error ? '<div class="errorBox">' + escapeHtml(state.assets.error) + '</div>' : '',
        asset.readonly ? '<div class="readonlyNotice">此资产来自 ' + escapeHtml(asset.source) + '，因此为只读。</div>' : '',
        (asset.warnings || []).map(warning => '<div class="readonlyNotice">' + escapeHtml(warning) + '</div>').join(''),
        '<div class="workspaceCard">',
        '<div class="tagRow"><span class="tag">' + escapeHtml(asset.kind) + '</span><span class="tag">' + escapeHtml(asset.source) + '</span><span class="tag ' + enabledClass + '">' + escapeHtml(asset.enabled ? '已启用' : '已禁用') + '</span><span class="tag ' + (asset.readonly ? 'warning' : 'success') + '">' + (asset.readonly ? '只读' : '可编辑') + '</span></div>',
        '<div class="metaGrid">',
        '<div class="metaCard"><span>Kind</span><strong>' + escapeHtml(asset.kind || 'skill') + '</strong></div>',
        '<div class="metaCard"><span>Source</span><strong>' + escapeHtml(asset.source || 'unknown') + '</strong></div>',
        '<div class="metaCard"><span>Model</span><strong>' + escapeHtml(asset.model || 'inherit') + '</strong></div>',
        '<div class="metaCard"><span>Context</span><strong>' + escapeHtml(asset.context || '未设置') + '</strong></div>',
        '</div>',
        '<div class="profileSummary" style="margin-top:12px"><strong class="summaryLine">' + escapeHtml(asset.description || '暂无描述') + '</strong></div>',
        asset.whenToUse ? '<div class="quoteBox"><strong>when_to_use</strong><br>' + escapeHtml(asset.whenToUse) + '</div>' : '',
        asset.allowedTools?.length ? '<div class="tagRow">' + asset.allowedTools.map(tool => '<span class="tag">' + escapeHtml(tool) + '</span>').join('') + '</div>' : '',
        asset.content !== undefined ? '<div class="field" style="margin-top:12px"><label>内容</label><div class="contentPanel markdownBody">' + renderMarkdownContent(asset.content || '') + '</div></div>' : '<div class="ghostState">此资产没有可显示的文件内容。</div>',
        '</div>'
      ].join('');
      workspaceView.querySelector('[data-asset-edit]')?.addEventListener('click', () => {
        state.assets.editing = true;
        renderAssetsWorkspace();
      });
      workspaceView.querySelector('[data-asset-delete]')?.addEventListener('click', async () => {
        if (!confirm('确定删除这个 ' + (asset.kind === 'knowledge' ? 'Knowledge' : 'Skill') + ' 吗？')) return;
        try {
          const route = asset.kind === 'knowledge' ? '/api/assets/knowledge/' : '/api/assets/skills/';
          await api(route + encodeURIComponent(asset.id), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
          });
          state.assets.selectedId = null;
          state.assets.selectedAsset = null;
          await refreshAssets();
          showToast((asset.kind === 'knowledge' ? 'Knowledge' : 'Skill') + ' 已删除', 'success');
        } catch (error) {
          state.assets.error = getErrorMessage(error);
          renderSecondary();
          renderMainView();
          showToast('删除资产失败', 'error');
        }
      });
    }

    function assetHubTotalPages() {
      return Math.max(1, Math.ceil(Number(state.assetHub.total || 0) / Math.max(1, Number(state.assetHub.limit || 8))));
    }

    function assetHubItemKey(item) {
      return String(item?.id || item?.asset_id || '').trim();
    }

    function assetHubSnapshot(item) {
      return {
        id: assetHubItemKey(item),
        asset_type: item?.asset_type || '',
        title: item?.title || '',
        version: item?.version || '',
        description_text: item?.description_text || '',
        applicable_roles: item?.applicable_roles || '',
        applicable_business: item?.applicable_business || '',
        uploader_name_display: item?.uploader_name_display || item?.uploader_name || item?.uploader_username || '',
        like_count: item?.like_count || 0,
        download_count: item?.download_count || 0
      };
    }

    async function refreshAssetHub() {
      state.assetHub.loading = true;
      state.assetHub.error = '';
      renderSecondary();
      renderMainView();
      try {
        const params = new URLSearchParams();
        params.set('page', String(state.assetHub.page || 1));
        params.set('limit', String(state.assetHub.limit || 8));
        params.set('ordering', state.assetHub.ordering || '-create_datetime');
        if (state.assetHub.search.trim()) params.set('search', state.assetHub.search.trim());
        if (state.assetHub.assetType.trim()) params.set('asset_type', state.assetHub.assetType.trim());
        const result = await api('/api/asset-hub/assets?' + params.toString());
        state.assetHub.items = result.items || [];
        state.assetHub.total = Number(result.total || state.assetHub.items.length || 0);
        state.assetHub.page = Number(result.page || state.assetHub.page || 1);
        state.assetHub.limit = Number(result.limit || state.assetHub.limit || 8);
        if (state.assetHub.selectedId && !state.assetHub.items.some(item => assetHubItemKey(item) === state.assetHub.selectedId)) {
          state.assetHub.selectedId = '';
          state.assetHub.selectedDetail = null;
          state.assetHub.selectedMarkdown = '';
        }
      } catch (error) {
        state.assetHub.error = getErrorMessage(error);
      } finally {
        state.assetHub.loading = false;
        renderSecondary();
        renderMainView();
      }
    }

    async function loadAssetHubDetail(item) {
      const hubId = assetHubItemKey(item);
      if (!hubId) return;
      state.assetHub.selectedId = hubId;
      state.assetHub.selectedDetail = item;
      state.assetHub.selectedMarkdown = '';
      renderMainView();
      try {
        const result = await api('/api/asset-hub/assets/' + encodeURIComponent(hubId));
        state.assetHub.selectedDetail = result.item || item;
        state.assetHub.selectedMarkdown = result.markdown || '';
      } catch (error) {
        state.assetHub.error = getErrorMessage(error);
      } finally {
        renderSecondary();
        renderMainView();
      }
    }

    async function voteAssetHubItem(item, vote) {
      const hubId = assetHubItemKey(item);
      if (!hubId || state.assetHub.actionId) return;
      state.assetHub.actionId = 'vote:' + hubId;
      renderMainView();
      try {
        await api('/api/asset-hub/assets/' + encodeURIComponent(hubId) + '/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vote })
        });
        await refreshAssetHub();
      } catch (error) {
        state.assetHub.error = getErrorMessage(error);
        renderMainView();
      } finally {
        state.assetHub.actionId = '';
        renderMainView();
      }
    }

    async function downloadAssetHubItem(item) {
      const hubId = assetHubItemKey(item);
      if (!hubId || state.assetHub.actionId) return;
      state.assetHub.actionId = 'download:' + hubId;
      state.assetHub.error = '';
      renderMainView();
      try {
        const result = await api('/api/asset-hub/assets/' + encodeURIComponent(hubId) + '/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetSnapshot: assetHubSnapshot(item) })
        });
        addActivity({ kind: 'status', title: 'Asset Hub', detail: '已下载到本地资产: ' + (result.asset?.path || result.asset?.name || hubId), at: Date.now() });
        await refreshAssets(false);
        showToast('Hub 资产已下载', 'success');
      } catch (error) {
        state.assetHub.error = getErrorMessage(error);
        showToast('Hub 下载失败', 'error');
      } finally {
        state.assetHub.actionId = '';
        renderSecondary();
        renderMainView();
      }
    }

    function uploadableAssets() {
      return (state.assets.list || []).filter(asset => asset.source === 'user' && !asset.readonly && (asset.kind === 'skill' || asset.kind === 'knowledge'));
    }

    function syncAssetHubUploadFromSelected() {
      const asset = uploadableAssets().find(item => item.id === state.assetHub.uploadAssetId);
      if (!asset) return;
      if (!state.assetHub.uploadTitle) state.assetHub.uploadTitle = asset.displayName || asset.name || '';
      if (!state.assetHub.uploadDescription) state.assetHub.uploadDescription = asset.description || '';
    }

    async function uploadAssetHubLocalAsset() {
      const assetId = state.assetHub.uploadAssetId;
      if (!assetId || state.assetHub.actionId) return;
      state.assetHub.actionId = 'upload:' + assetId;
      state.assetHub.uploadError = '';
      renderSecondary();
      try {
        const result = await api('/api/asset-hub/local-assets/' + encodeURIComponent(assetId) + '/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: state.assetHub.uploadTitle,
            version: state.assetHub.uploadVersion,
            applicableRoles: state.assetHub.uploadRoles,
            applicableBusiness: state.assetHub.uploadBusiness,
            description: state.assetHub.uploadDescription
          })
        });
        addActivity({ kind: 'status', title: 'Asset Hub', detail: '上传成功: ' + (result.title || state.assetHub.uploadTitle), at: Date.now() });
        state.assetHub.uploadOpen = false;
        showToast('资产已上传 Hub', 'success');
        await refreshAssetHub();
      } catch (error) {
        state.assetHub.uploadError = getErrorMessage(error);
        showToast('上传 Hub 失败', 'error');
      } finally {
        state.assetHub.actionId = '';
        renderSecondary();
      }
    }

    function renderAssetHubPanel() {
      const choices = uploadableAssets();
      const selectedUpload = choices.find(asset => asset.id === state.assetHub.uploadAssetId);
      secondaryBody.innerHTML = [
        state.assetHub.error ? '<div class="errorBox"><strong>Asset Hub 加载失败</strong><div>' + escapeHtml(state.assetHub.error) + '</div></div>' : '',
        '<div class="profileSummary"><strong class="summaryLine">' + escapeHtml(String(state.assetHub.total || state.assetHub.items.length || 0)) + ' 个 Hub 资产</strong><span class="summaryLine">远端 Skill / Knowledge，可下载到本地资产</span></div>',
        '<div class="toolbarRow"><button class="miniButton ' + (state.assetHub.loading ? 'buttonLoading' : '') + '" type="button" data-hub-refresh>' + (state.assetHub.loading ? '刷新中' : '刷新 Hub') + '</button><button class="miniButton" type="button" data-hub-upload-toggle>上传本地资产</button></div>',
        '<div class="field"><label for="hubSearch">搜索</label><input id="hubSearch" value="' + escapeHtml(state.assetHub.search) + '" autocomplete="off" placeholder="标题 / 上传者 / 描述"></div>',
        '<div class="splitFields">',
        '<div class="field"><label for="hubType">类型</label><select id="hubType"><option value="">全部</option><option value="skill" ' + (state.assetHub.assetType === 'skill' ? 'selected' : '') + '>Skill</option><option value="knowledge" ' + (state.assetHub.assetType === 'knowledge' ? 'selected' : '') + '>Knowledge</option></select></div>',
        '<div class="field"><label for="hubOrdering">排序</label><select id="hubOrdering"><option value="-create_datetime" ' + (state.assetHub.ordering === '-create_datetime' ? 'selected' : '') + '>最新上传</option><option value="-like_count" ' + (state.assetHub.ordering === '-like_count' ? 'selected' : '') + '>好评最多</option><option value="-download_count" ' + (state.assetHub.ordering === '-download_count' ? 'selected' : '') + '>下载最多</option><option value="title" ' + (state.assetHub.ordering === 'title' ? 'selected' : '') + '>标题升序</option></select></div>',
        '</div>',
        '<button class="secondaryAction" type="button" data-hub-search>应用筛选</button>',
        state.assetHub.uploadOpen ? [
          '<section class="formSection"><div class="sectionHeader"><h3>上传到 Hub</h3></div>',
          choices.length ? '<div class="field"><label for="hubUploadAsset">本地资产</label><select id="hubUploadAsset">' + choices.map(asset => '<option value="' + escapeHtml(asset.id) + '" ' + (state.assetHub.uploadAssetId === asset.id ? 'selected' : '') + '>' + escapeHtml((asset.kind === 'knowledge' ? 'Knowledge: ' : 'Skill: ') + (asset.displayName || asset.name)) + '</option>').join('') + '</select></div>' : '<div class="readonlyNotice">没有可上传的 User Skill 或 User Knowledge。</div>',
          '<div class="field"><label for="hubUploadTitle">标题</label><input id="hubUploadTitle" value="' + escapeHtml(state.assetHub.uploadTitle || selectedUpload?.displayName || '') + '"></div>',
          '<div class="splitFields"><div class="field"><label for="hubUploadVersion">版本</label><input id="hubUploadVersion" value="' + escapeHtml(state.assetHub.uploadVersion || 'v1') + '"></div><div class="field"><label for="hubUploadRoles">适用角色</label><input id="hubUploadRoles" value="' + escapeHtml(state.assetHub.uploadRoles) + '"></div></div>',
          '<div class="field"><label for="hubUploadBusiness">适用业务</label><input id="hubUploadBusiness" value="' + escapeHtml(state.assetHub.uploadBusiness) + '"></div>',
          '<div class="field"><label for="hubUploadDescription">描述</label><textarea id="hubUploadDescription" rows="3">' + escapeHtml(state.assetHub.uploadDescription || selectedUpload?.description || '') + '</textarea></div>',
          state.assetHub.uploadError ? '<div class="errorBox">' + escapeHtml(state.assetHub.uploadError) + '</div>' : '',
          '<button class="secondaryAction" type="button" data-hub-upload-submit ' + (!choices.length || state.assetHub.actionId.startsWith('upload:') ? 'disabled' : '') + '>' + (state.assetHub.actionId.startsWith('upload:') ? '上传中' : '确认上传') + '</button>',
          '</section>'
        ].join('') : ''
      ].join('');
      const search = document.getElementById('hubSearch');
      const type = document.getElementById('hubType');
      const ordering = document.getElementById('hubOrdering');
      search?.addEventListener('input', () => { state.assetHub.search = search.value; });
      search?.addEventListener('keydown', event => { if (event.key === 'Enter') { state.assetHub.page = 1; refreshAssetHub(); } });
      type?.addEventListener('change', () => { state.assetHub.assetType = type.value; state.assetHub.page = 1; refreshAssetHub(); });
      ordering?.addEventListener('change', () => { state.assetHub.ordering = ordering.value; state.assetHub.page = 1; refreshAssetHub(); });
      secondaryBody.querySelector('[data-hub-refresh]')?.addEventListener('click', () => refreshAssetHub());
      secondaryBody.querySelector('[data-hub-search]')?.addEventListener('click', () => { state.assetHub.page = 1; refreshAssetHub(); });
      secondaryBody.querySelector('[data-hub-upload-toggle]')?.addEventListener('click', () => {
        state.assetHub.uploadOpen = !state.assetHub.uploadOpen;
        if (!state.assetHub.uploadAssetId && choices[0]) state.assetHub.uploadAssetId = choices[0].id;
        syncAssetHubUploadFromSelected();
        renderAssetHubPanel();
      });
      document.getElementById('hubUploadAsset')?.addEventListener('change', event => {
        state.assetHub.uploadAssetId = event.target.value;
        state.assetHub.uploadTitle = '';
        state.assetHub.uploadDescription = '';
        syncAssetHubUploadFromSelected();
        renderAssetHubPanel();
      });
      const bindUploadInput = (id, key) => {
        document.getElementById(id)?.addEventListener('input', event => {
          state.assetHub[key] = event.target.value;
        });
      };
      bindUploadInput('hubUploadTitle', 'uploadTitle');
      bindUploadInput('hubUploadVersion', 'uploadVersion');
      bindUploadInput('hubUploadRoles', 'uploadRoles');
      bindUploadInput('hubUploadBusiness', 'uploadBusiness');
      bindUploadInput('hubUploadDescription', 'uploadDescription');
      secondaryBody.querySelector('[data-hub-upload-submit]')?.addEventListener('click', () => uploadAssetHubLocalAsset());
    }

    function renderAssetHubWorkspace() {
      const items = state.assetHub.items || [];
      const detail = state.assetHub.selectedDetail;
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>资产 Hub</h2><div class="workspaceMeta">平台远端 Skill / Knowledge，下载后进入本地资产菜单</div></div><div class="toolbarRow"><button class="miniButton" type="button" data-hub-prev ' + (state.assetHub.page <= 1 ? 'disabled' : '') + '>上一页</button><button class="miniButton" type="button" data-hub-next ' + (state.assetHub.page >= assetHubTotalPages() ? 'disabled' : '') + '>下一页</button></div></div>',
        state.assetHub.loading ? skeletonStack() : '',
        '<div class="workspaceCard">',
        '<div class="profileSummary"><strong class="summaryLine">第 ' + escapeHtml(String(state.assetHub.page)) + ' / ' + escapeHtml(String(assetHubTotalPages())) + ' 页</strong><span class="summaryLine">共 ' + escapeHtml(String(state.assetHub.total || 0)) + ' 项</span></div>',
        items.length ? '<div class="itemList">' + items.map(item => {
          const hubId = assetHubItemKey(item);
          const active = state.assetHub.selectedId === hubId;
          const title = item.title || hubId || 'Hub 资产';
          return [
            '<button class="listItem ' + (active ? 'active' : '') + '" data-hub-item="' + escapeHtml(hubId) + '">',
            '<div class="listItemHeader"><strong>' + escapeHtml(title) + '</strong><span class="statusBadge">' + escapeHtml(item.asset_type || '-') + '</span></div>',
            '<span>' + escapeHtml(item.uploader_name_display || item.uploader_name || item.uploader_username || '-') + ' / ' + escapeHtml(item.version || '-') + '</span>',
            '<span>好评 ' + escapeHtml(String(item.like_count || 0)) + ' / 下载 ' + escapeHtml(String(item.download_count || 0)) + '</span>',
            '</button>'
          ].join('');
        }).join('') + '</div>' : '<div class="ghostState">暂无 Hub 资产。</div>',
        '</div>',
        detail ? [
          '<div class="workspaceCard">',
          '<div class="workspaceHeader"><div><h2>' + escapeHtml(detail.title || state.assetHub.selectedId) + '</h2><div class="workspaceMeta">' + escapeHtml(detail.asset_type || '') + ' / ' + escapeHtml(detail.version || '') + '</div></div></div>',
          '<div class="tagRow"><span class="tag">好评 ' + escapeHtml(String(detail.like_count || 0)) + '</span><span class="tag">下载 ' + escapeHtml(String(detail.download_count || 0)) + '</span><span class="tag">' + escapeHtml(detail.applicable_roles || '未设置角色') + '</span><span class="tag">' + escapeHtml(detail.applicable_business || '未设置业务') + '</span></div>',
          '<div class="profileSummary" style="margin-top:12px"><strong class="summaryLine">' + escapeHtml(detail.description_text || '暂无描述') + '</strong></div>',
          '<div class="toolbarRow" style="margin-top:12px"><button class="miniButton" type="button" data-hub-like>点赞</button><button class="miniButton" type="button" data-hub-dislike>踩</button><button class="miniButton" type="button" data-hub-download ' + (state.assetHub.actionId === 'download:' + state.assetHub.selectedId ? 'disabled' : '') + '>' + (state.assetHub.actionId === 'download:' + state.assetHub.selectedId ? '下载中' : '下载到本地资产') + '</button></div>',
          state.assetHub.selectedMarkdown ? '<div class="field" style="margin-top:12px"><label>预览</label><div class="contentPanel markdownBody">' + renderMarkdownContent(state.assetHub.selectedMarkdown) + '</div></div>' : '',
          '</div>'
        ].join('') : ''
      ].join('');
      workspaceView.querySelector('[data-hub-prev]')?.addEventListener('click', () => {
        if (state.assetHub.page <= 1) return;
        state.assetHub.page -= 1;
        state.assetHub.selectedId = '';
        state.assetHub.selectedDetail = null;
        refreshAssetHub();
      });
      workspaceView.querySelector('[data-hub-next]')?.addEventListener('click', () => {
        if (state.assetHub.page >= assetHubTotalPages()) return;
        state.assetHub.page += 1;
        state.assetHub.selectedId = '';
        state.assetHub.selectedDetail = null;
        refreshAssetHub();
      });
      workspaceView.querySelectorAll('[data-hub-item]').forEach(button => {
        button.addEventListener('click', () => {
          const item = state.assetHub.items.find(candidate => assetHubItemKey(candidate) === button.dataset.hubItem);
          if (item) loadAssetHubDetail(item);
        });
      });
      workspaceView.querySelector('[data-hub-like]')?.addEventListener('click', () => voteAssetHubItem(detail, 'like'));
      workspaceView.querySelector('[data-hub-dislike]')?.addEventListener('click', () => voteAssetHubItem(detail, 'dislike'));
      workspaceView.querySelector('[data-hub-download]')?.addEventListener('click', () => downloadAssetHubItem(detail));
    }

    function selectedToolPlugin() {
      return (state.tools.plugins || []).find(plugin => plugin.pluginId === state.tools.selectedId) || (state.tools.plugins || [])[0] || null;
    }

    function selectedMcpServer() {
      return (state.tools.mcpServers || []).find(server => server.name === state.tools.selectedMcpName) || (state.tools.mcpServers || [])[0] || null;
    }

    function renderToolsViewTabs() {
      return '<div class="toolbarRow"><button class="miniButton ' + (state.tools.view === 'plugins' ? 'active' : '') + '" type="button" data-tools-view="plugins">插件 Marketplace</button><button class="miniButton ' + (state.tools.view === 'mcp' ? 'active' : '') + '" type="button" data-tools-view="mcp">MCP Servers</button></div>';
    }

    function wireToolsViewTabs(root) {
      root.querySelectorAll('[data-tools-view]').forEach(button => {
        button.addEventListener('click', () => {
          state.tools.view = button.dataset.toolsView === 'mcp' ? 'mcp' : 'plugins';
          renderSecondary();
          renderMainView();
          if (state.tools.view === 'mcp' && state.tools.mcpServers.length === 0 && !state.tools.mcpLoading) {
            refreshMcpServers();
          }
        });
      });
    }

    function getMcpFormPayload() {
      const form = state.tools.mcpForm;
      const payload = {
        name: form.name.trim(),
        scope: form.scope || 'user',
        transport: form.transport || 'stdio'
      };
      if (payload.transport === 'stdio') {
        payload.command = form.command.trim();
        payload.args = form.args.trim();
        payload.env = form.env.trim();
      } else {
        payload.url = form.url.trim();
        payload.headers = form.headers.trim();
      }
      return payload;
    }

    function syncMcpFormFromInputs() {
      const form = state.tools.mcpForm;
      const read = (id, fallback) => {
        const element = document.getElementById(id);
        return element && 'value' in element ? element.value : fallback;
      };
      form.name = read('toolsMcpName', form.name);
      form.scope = read('toolsMcpScope', form.scope);
      form.transport = read('toolsMcpTransport', form.transport);
      form.command = read('toolsMcpCommand', form.command);
      form.args = read('toolsMcpArgs', form.args);
      form.env = read('toolsMcpEnv', form.env);
      form.url = read('toolsMcpUrl', form.url);
      form.headers = read('toolsMcpHeaders', form.headers);
    }

    async function refreshMcpServers() {
      state.tools.mcpLoading = true;
      state.tools.mcpError = '';
      renderSecondary();
      renderMainView();
      try {
        const result = await api('/api/mcp/servers');
        state.tools.mcpServers = result.servers || [];
        state.tools.mcpErrors = result.errors || [];
        if (state.tools.selectedMcpName && !state.tools.mcpServers.some(server => server.name === state.tools.selectedMcpName)) {
          state.tools.selectedMcpName = '';
        }
        if (!state.tools.selectedMcpName && state.tools.mcpServers[0]) {
          state.tools.selectedMcpName = state.tools.mcpServers[0].name;
        }
      } catch (error) {
        state.tools.mcpError = getErrorMessage(error);
      } finally {
        state.tools.mcpLoading = false;
        renderSecondary();
        renderMainView();
      }
    }

    async function addMcpServer() {
      syncMcpFormFromInputs();
      const payload = getMcpFormPayload();
      if (!payload.name) {
        state.tools.mcpError = '请输入 MCP server 名称。';
        renderToolsPanel();
        return;
      }
      state.tools.mcpAdding = true;
      state.tools.mcpError = '';
      state.tools.mcpNotice = '';
      renderToolsPanel();
      try {
        const result = await api('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        state.tools.mcpNotice = '已添加 MCP Server：' + (result.server?.name || payload.name) + '，下次刷新会话后生效。';
        if (state.running) state.tools.mcpNotice += ' 当前会话正在运行，可手动刷新会话。';
        state.tools.selectedMcpName = result.server?.name || payload.name;
        state.tools.mcpForm.name = '';
        state.tools.mcpForm.command = '';
        state.tools.mcpForm.args = '';
        state.tools.mcpForm.env = '';
        state.tools.mcpForm.url = '';
        state.tools.mcpForm.headers = '';
        await refreshMcpServers();
        showToast('MCP Server 已添加', 'success');
      } catch (error) {
        state.tools.mcpError = getErrorMessage(error);
        renderToolsPanel();
        showToast('添加 MCP Server 失败', 'error');
      } finally {
        state.tools.mcpAdding = false;
        renderToolsPanel();
      }
    }

    async function removeMcpServer(name, scope) {
      if (!name || !scope || state.tools.removingMcp) return;
      state.tools.removingMcp = name + '@' + scope;
      state.tools.mcpError = '';
      state.tools.mcpNotice = '';
      renderSecondary();
      renderMainView();
      try {
        await api('/api/mcp/servers/' + encodeURIComponent(name) + '?scope=' + encodeURIComponent(scope), {
          method: 'DELETE'
        });
        state.tools.mcpNotice = '已移除 MCP Server：' + name + '，下次刷新会话后生效。';
        if (state.running) state.tools.mcpNotice += ' 当前会话正在运行，可手动刷新会话。';
        if (state.tools.selectedMcpName === name) state.tools.selectedMcpName = '';
        await refreshMcpServers();
        showToast('MCP Server 已移除', 'success');
      } catch (error) {
        state.tools.mcpError = getErrorMessage(error);
        showToast('移除 MCP Server 失败', 'error');
      } finally {
        state.tools.removingMcp = '';
        renderSecondary();
        renderMainView();
      }
    }

    function toolStatusTags(plugin) {
      const tags = [
        '<span class="tag">' + escapeHtml(plugin.marketplaceName || 'marketplace') + '</span>'
      ];
      if (plugin.category) tags.push('<span class="tag">' + escapeHtml(plugin.category) + '</span>');
      if (plugin.version) tags.push('<span class="tag">v' + escapeHtml(plugin.version) + '</span>');
      tags.push('<span class="tag ' + (plugin.installed ? 'success' : 'warning') + '">' + (plugin.installed ? '已安装' : '未安装') + '</span>');
      if (plugin.blocked) tags.push('<span class="tag danger">策略阻止</span>');
      if (plugin.needsConfiguration) tags.push('<span class="tag warning">需要配置</span>');
      return tags.join('');
    }

    function toolSearchParams() {
      const params = new URLSearchParams();
      if (state.tools.search.trim()) params.set('q', state.tools.search.trim());
      if (state.tools.marketplace.trim()) params.set('marketplace', state.tools.marketplace.trim());
      params.set('status', state.tools.status || 'available');
      return params.toString();
    }

    async function refreshTools() {
      state.tools.loading = true;
      state.tools.error = '';
      renderSecondary();
      renderMainView();
      try {
        const [marketplaces, plugins] = await Promise.all([
          api('/api/plugins/marketplaces'),
          api('/api/plugins?' + toolSearchParams())
        ]);
        state.tools.marketplaces = marketplaces.marketplaces || plugins.marketplaces || [];
        state.tools.failures = [...(marketplaces.failures || []), ...(plugins.failures || [])];
        state.tools.plugins = plugins.plugins || [];
        if (state.tools.selectedId && !state.tools.plugins.some(plugin => plugin.pluginId === state.tools.selectedId)) {
          state.tools.selectedId = '';
        }
        if (!state.tools.selectedId && state.tools.plugins[0]) {
          state.tools.selectedId = state.tools.plugins[0].pluginId;
        }
      } catch (error) {
        state.tools.error = getErrorMessage(error);
      } finally {
        state.tools.loading = false;
        renderSecondary();
        renderMainView();
      }
    }

    async function addToolsMarketplace() {
      const source = state.tools.addSource.trim();
      if (!source) {
        state.tools.error = '请输入 marketplace source。';
        renderToolsPanel();
        return;
      }
      state.tools.adding = true;
      state.tools.error = '';
      state.tools.notice = '';
      renderToolsPanel();
      try {
        const result = await api('/api/plugins/marketplaces', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source })
        });
        state.tools.notice = (result.marketplace?.alreadyMaterialized ? 'Marketplace 已存在: ' : '已添加 marketplace: ') + (result.marketplace?.name || source);
        state.tools.addSource = '';
        await refreshTools();
        showToast('Marketplace 已更新', 'success');
      } catch (error) {
        state.tools.error = getErrorMessage(error);
        renderToolsPanel();
        showToast('添加 marketplace 失败', 'error');
      } finally {
        state.tools.adding = false;
        renderToolsPanel();
      }
    }

    async function installToolPlugin(pluginId, source) {
      if (!pluginId || state.tools.installingId) return;
      state.tools.installingId = pluginId;
      state.tools.error = '';
      state.tools.notice = '';
      renderSecondary();
      renderMainView();
      try {
        const result = await api('/api/plugins/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pluginId, scope: 'user' })
        });
        const configText = result.needsConfiguration ? '，需要补充配置后使用' : '';
        state.tools.notice = '已安装' + configText + '，下次刷新会话后生效。';
        if (state.running) state.tools.notice += ' 当前会话正在运行，可手动刷新会话。';
        if (state.tools.recommendation?.pluginId === pluginId) {
          state.tools.recommendation = null;
        }
        addActivity({ kind: 'status', title: 'Plugin installed', detail: pluginId + ' installed from ' + (source || 'tools menu'), at: Date.now() });
        await refreshTools();
        showToast('插件已安装', 'success');
      } catch (error) {
        state.tools.error = getErrorMessage(error);
        showToast('安装插件失败', 'error');
      } finally {
        state.tools.installingId = '';
        renderSecondary();
        renderMainView();
      }
    }

    function renderToolsRecommendation() {
      const recommendation = state.tools.recommendation;
      if (!recommendation) return '';
      return [
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>插件推荐</h3></div>',
        '<div class="profileSummary"><strong class="summaryLine">' + escapeHtml(recommendation.pluginName || recommendation.pluginId) + '</strong><span class="summaryLine">' + escapeHtml(recommendation.marketplaceName || '') + '</span><span class="summaryLine">' + escapeHtml(recommendation.reason || '检测到当前任务可能需要这个插件') + '</span></div>',
        recommendation.description ? '<div class="readonlyNotice">' + escapeHtml(recommendation.description) + '</div>' : '',
        '<div class="toolbarRow"><button class="miniButton" type="button" data-tools-recommend-install="' + escapeHtml(recommendation.pluginId) + '">确认安装</button><button class="miniButton" type="button" data-tools-recommend-dismiss>暂不安装</button></div>',
        '</section>'
      ].join('');
    }

    function renderMcpToolsPanel() {
      const form = state.tools.mcpForm;
      const isStdio = form.transport === 'stdio';
      const errors = (state.tools.mcpErrors || []).map(error => '<div class="readonlyNotice">' + escapeHtml(error.scope || 'mcp') + ': ' + escapeHtml(error.message || '加载失败') + '</div>').join('');
      secondaryBody.innerHTML = [
        renderToolsViewTabs(),
        state.tools.mcpError ? '<div class="errorBox"><strong>MCP Server 操作失败</strong><div>' + escapeHtml(state.tools.mcpError) + '</div></div>' : '',
        state.tools.mcpNotice ? '<div class="readonlyNotice">' + escapeHtml(state.tools.mcpNotice) + (state.running ? '<div style="margin-top:8px"><button class="miniButton" type="button" data-tools-refresh-session>刷新会话</button></div>' : '') + '</div>' : '',
        '<div class="profileSummary"><strong class="summaryLine">' + escapeHtml(String(state.tools.mcpServers.length)) + ' 个 MCP Server</strong><span class="summaryLine">默认 user scope</span></div>',
        '<div class="toolbarRow"><button class="miniButton ' + (state.tools.mcpLoading ? 'buttonLoading' : '') + '" type="button" data-tools-mcp-refresh>' + (state.tools.mcpLoading ? '刷新中' : '刷新') + '</button></div>',
        '<section class="formSection"><div class="sectionHeader"><h3>添加 MCP Server</h3></div>',
        '<div class="field"><label for="toolsMcpName">Name</label><input id="toolsMcpName" value="' + escapeHtml(form.name) + '" autocomplete="off" placeholder="my-server"></div>',
        '<div class="splitFields">',
        '<div class="field"><label for="toolsMcpScope">Scope</label><select id="toolsMcpScope"><option value="user" ' + (form.scope === 'user' ? 'selected' : '') + '>user</option><option value="project" ' + (form.scope === 'project' ? 'selected' : '') + '>project</option><option value="local" ' + (form.scope === 'local' ? 'selected' : '') + '>local</option></select></div>',
        '<div class="field"><label for="toolsMcpTransport">Transport</label><select id="toolsMcpTransport"><option value="stdio" ' + (form.transport === 'stdio' ? 'selected' : '') + '>stdio</option><option value="http" ' + (form.transport === 'http' ? 'selected' : '') + '>http</option><option value="sse" ' + (form.transport === 'sse' ? 'selected' : '') + '>sse</option></select></div>',
        '</div>',
        isStdio ? [
          '<div class="field"><label for="toolsMcpCommand">Command</label><input id="toolsMcpCommand" value="' + escapeHtml(form.command) + '" autocomplete="off" placeholder="uvx 或 node"></div>',
          '<div class="field"><label for="toolsMcpArgs">Args</label><input id="toolsMcpArgs" value="' + escapeHtml(form.args) + '" autocomplete="off" placeholder="用空格分隔；支持引号"></div>',
          '<div class="field"><label for="toolsMcpEnv">Env</label><textarea id="toolsMcpEnv" rows="4" placeholder="KEY=value，每行一个">' + escapeHtml(form.env) + '</textarea></div>'
        ].join('') : [
          '<div class="field"><label for="toolsMcpUrl">URL</label><input id="toolsMcpUrl" value="' + escapeHtml(form.url) + '" autocomplete="off" placeholder="https://example.com/mcp"></div>',
          '<div class="field"><label for="toolsMcpHeaders">Headers</label><textarea id="toolsMcpHeaders" rows="4" placeholder="Authorization: Bearer token，每行一个">' + escapeHtml(form.headers) + '</textarea></div>'
        ].join(''),
        '<div class="readonlyNotice">MCP Registry 列表页不能直接添加。比如 https://glama.ai/mcp/servers 或 github.com/mcp/... 需要复制具体 server 的 command/args 或 HTTP/SSE endpoint。</div>',
        '<button class="secondaryAction ' + (state.tools.mcpAdding ? 'buttonLoading' : '') + '" type="button" data-tools-mcp-add ' + (state.tools.mcpAdding ? 'disabled' : '') + '>' + (state.tools.mcpAdding ? '添加中' : '添加 MCP Server') + '</button>',
        '</section>',
        errors
      ].join('');
      wireToolsViewTabs(secondaryBody);
      ['toolsMcpName', 'toolsMcpScope', 'toolsMcpCommand', 'toolsMcpArgs', 'toolsMcpEnv', 'toolsMcpUrl', 'toolsMcpHeaders'].forEach(id => {
        const element = document.getElementById(id);
        element?.addEventListener('input', syncMcpFormFromInputs);
        element?.addEventListener('change', syncMcpFormFromInputs);
      });
      const transport = document.getElementById('toolsMcpTransport');
      transport?.addEventListener('change', () => {
        syncMcpFormFromInputs();
        renderToolsPanel();
      });
      secondaryBody.querySelector('[data-tools-mcp-refresh]')?.addEventListener('click', () => refreshMcpServers());
      secondaryBody.querySelector('[data-tools-mcp-add]')?.addEventListener('click', () => addMcpServer());
      secondaryBody.querySelector('[data-tools-refresh-session]')?.addEventListener('click', () => {
        sendWs({ type: 'refresh_session' });
        state.tools.mcpNotice = '会话已刷新，MCP Server 会在下一次任务中加载。';
        renderToolsPanel();
      });
    }

    function renderToolsPanel() {
      if (state.tools.view === 'mcp') {
        renderMcpToolsPanel();
        return;
      }
      const marketplaceOptions = ['<option value="">全部 marketplace</option>'].concat((state.tools.marketplaces || []).map(item => '<option value="' + escapeHtml(item.name) + '" ' + (state.tools.marketplace === item.name ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>')).join('');
      const failures = (state.tools.failures || []).map(failure => '<div class="readonlyNotice">' + escapeHtml(failure.name) + ': ' + escapeHtml(failure.error || '加载失败') + '</div>').join('');
      secondaryBody.innerHTML = [
        renderToolsViewTabs(),
        state.tools.error ? '<div class="errorBox"><strong>插件操作失败</strong><div>' + escapeHtml(state.tools.error) + '</div></div>' : '',
        state.tools.notice ? '<div class="readonlyNotice">' + escapeHtml(state.tools.notice) + (state.running ? '<div style="margin-top:8px"><button class="miniButton" type="button" data-tools-refresh-session>刷新会话</button></div>' : '') + '</div>' : '',
        renderToolsRecommendation(),
        '<div class="profileSummary"><strong class="summaryLine">' + escapeHtml(String(state.tools.plugins.length)) + ' 个插件</strong><span class="summaryLine">' + escapeHtml(String(state.tools.marketplaces.length)) + ' 个 marketplace</span></div>',
        '<div class="toolbarRow"><button class="miniButton ' + (state.tools.loading ? 'buttonLoading' : '') + '" type="button" data-tools-refresh>' + (state.tools.loading ? '刷新中' : '刷新') + '</button></div>',
        '<div class="field"><label for="toolsSearch">搜索插件</label><input id="toolsSearch" value="' + escapeHtml(state.tools.search) + '" autocomplete="off" placeholder="名称 / 标签 / 描述"></div>',
        '<div class="splitFields">',
        '<div class="field"><label for="toolsMarketplace">Marketplace</label><select id="toolsMarketplace">' + marketplaceOptions + '</select></div>',
        '<div class="field"><label for="toolsStatus">状态</label><select id="toolsStatus"><option value="available" ' + (state.tools.status === 'available' ? 'selected' : '') + '>可安装</option><option value="installed" ' + (state.tools.status === 'installed' ? 'selected' : '') + '>已安装</option><option value="all" ' + (state.tools.status === 'all' ? 'selected' : '') + '>全部</option></select></div>',
        '</div>',
        '<button class="secondaryAction" type="button" data-tools-apply>应用筛选</button>',
        '<section class="formSection toolsMarketplaceSection"><div class="sectionHeader"><h3>添加 Marketplace</h3></div>',
        '<div class="field"><label for="toolsAddSource">Source</label><input id="toolsAddSource" value="' + escapeHtml(state.tools.addSource) + '" autocomplete="off" placeholder="owner/repo、https://... 或 ./path"></div>',
        '<button class="secondaryAction ' + (state.tools.adding ? 'buttonLoading' : '') + '" type="button" data-tools-add-marketplace ' + (state.tools.adding ? 'disabled' : '') + '>' + (state.tools.adding ? '添加中' : '添加 Marketplace') + '</button>',
        '</section>',
        failures
      ].join('');
      wireToolsViewTabs(secondaryBody);
      const search = document.getElementById('toolsSearch');
      const marketplace = document.getElementById('toolsMarketplace');
      const status = document.getElementById('toolsStatus');
      const addSource = document.getElementById('toolsAddSource');
      search?.addEventListener('input', () => { state.tools.search = search.value; });
      search?.addEventListener('keydown', event => { if (event.key === 'Enter') refreshTools(); });
      marketplace?.addEventListener('change', () => { state.tools.marketplace = marketplace.value; refreshTools(); });
      status?.addEventListener('change', () => { state.tools.status = status.value; refreshTools(); });
      addSource?.addEventListener('input', () => { state.tools.addSource = addSource.value; });
      addSource?.addEventListener('keydown', event => { if (event.key === 'Enter') addToolsMarketplace(); });
      secondaryBody.querySelector('[data-tools-refresh]')?.addEventListener('click', () => refreshTools());
      secondaryBody.querySelector('[data-tools-apply]')?.addEventListener('click', () => refreshTools());
      secondaryBody.querySelector('[data-tools-add-marketplace]')?.addEventListener('click', () => addToolsMarketplace());
      secondaryBody.querySelector('[data-tools-refresh-session]')?.addEventListener('click', () => {
        sendWs({ type: 'refresh_session' });
        state.tools.notice = '会话已刷新，新安装插件会在下一次任务中加载。';
        renderToolsPanel();
      });
      secondaryBody.querySelector('[data-tools-recommend-install]')?.addEventListener('click', event => {
        const button = event.currentTarget;
        installToolPlugin(button.dataset.toolsRecommendInstall, 'recommendation');
      });
      secondaryBody.querySelector('[data-tools-recommend-dismiss]')?.addEventListener('click', () => {
        state.tools.recommendation = null;
        renderToolsPanel();
      });
    }

    function renderToolsWorkspace() {
      if (state.tools.view === 'mcp') {
        renderMcpToolsWorkspace();
        return;
      }
      const plugins = state.tools.plugins || [];
      const selected = selectedToolPlugin();
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>工具</h2><div class="workspaceMeta">从 marketplace 查找、检查并安装插件；默认安装到 user scope</div></div><div class="toolbarRow"><button class="miniButton" type="button" data-tools-refresh-main>刷新</button></div></div>',
        renderToolsViewTabs(),
        state.tools.loading ? skeletonStack() : '',
        '<div class="toolsGrid">',
        '<div class="workspaceCard">',
        '<div class="profileSummary"><strong class="summaryLine">插件列表</strong><span class="summaryLine">' + escapeHtml(String(plugins.length)) + ' 个匹配项</span></div>',
        plugins.length ? '<div class="itemList toolsListScroll">' + plugins.map(plugin => {
          const active = selected?.pluginId === plugin.pluginId;
          const status = plugin.blocked ? '策略阻止' : plugin.installed ? '已安装' : '可安装';
          return [
            '<button class="listItem ' + (active ? 'active' : '') + '" data-tools-plugin="' + escapeHtml(plugin.pluginId) + '">',
            '<div class="listItemHeader"><strong>' + escapeHtml(plugin.name) + '</strong><span class="statusBadge">' + escapeHtml(status) + '</span></div>',
            '<span>' + escapeHtml(plugin.marketplaceName || '') + (plugin.version ? ' / v' + escapeHtml(plugin.version) : '') + '</span>',
            '<span>' + escapeHtml(plugin.description || '暂无描述') + '</span>',
            '</button>'
          ].join('');
        }).join('') + '</div>' : '<div class="ghostState">没有匹配当前筛选条件的插件。</div>',
        '</div>',
        selected ? [
          '<div class="workspaceCard">',
          '<div class="workspaceHeader"><div><h2>' + escapeHtml(selected.name) + '</h2><div class="workspaceMeta">' + escapeHtml(selected.pluginId) + '</div></div></div>',
          '<div class="tagRow">' + toolStatusTags(selected) + '</div>',
          '<div class="metaGrid">',
          '<div class="metaCard"><span>Marketplace</span><strong>' + escapeHtml(selected.marketplaceName || '-') + '</strong></div>',
          '<div class="metaCard"><span>Version</span><strong>' + escapeHtml(selected.version || '未标注') + '</strong></div>',
          '<div class="metaCard"><span>Installs</span><strong>' + escapeHtml(selected.installCount === undefined ? '未提供' : formatNumber(selected.installCount)) + '</strong></div>',
          '<div class="metaCard"><span>Scope</span><strong>user</strong></div>',
          '</div>',
          selected.tags?.length || selected.keywords?.length ? '<div class="tagRow">' + (selected.tags || []).concat(selected.keywords || []).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>' : '',
          '<div class="contentPanel toolsDescription">' + escapeHtml(selected.description || '暂无描述') + '</div>',
          selected.blocked ? '<div class="errorBox">此插件被策略阻止，无法安装。</div>' : '',
          '<div class="toolbarRow" style="margin-top:12px"><button class="miniButton ' + (state.tools.installingId === selected.pluginId ? 'buttonLoading' : '') + '" type="button" data-tools-install="' + escapeHtml(selected.pluginId) + '" ' + (selected.installed || selected.blocked || state.tools.installingId ? 'disabled' : '') + '>' + (state.tools.installingId === selected.pluginId ? '安装中' : selected.installed ? '已安装' : '安装插件') + '</button>' + (state.running ? '<button class="miniButton" type="button" data-tools-refresh-session>刷新会话</button>' : '') + '</div>',
          state.tools.notice ? '<div class="readonlyNotice">' + escapeHtml(state.tools.notice) + '</div>' : '',
          '</div>'
        ].join('') : '<div class="workspaceCard ghostState">选择一个插件查看详情。</div>',
        '</div>'
      ].join('');
      wireToolsViewTabs(workspaceView);
      workspaceView.querySelector('[data-tools-refresh-main]')?.addEventListener('click', () => refreshTools());
      workspaceView.querySelectorAll('[data-tools-plugin]').forEach(button => {
        button.addEventListener('click', () => {
          state.tools.selectedId = button.dataset.toolsPlugin || '';
          renderToolsWorkspace();
        });
      });
      workspaceView.querySelector('[data-tools-install]')?.addEventListener('click', event => {
        const button = event.currentTarget;
        installToolPlugin(button.dataset.toolsInstall, 'tools menu');
      });
      workspaceView.querySelector('[data-tools-refresh-session]')?.addEventListener('click', () => {
        sendWs({ type: 'refresh_session' });
        state.tools.notice = '会话已刷新，新安装插件会在下一次任务中加载。';
        renderSecondary();
        renderToolsWorkspace();
      });
    }

    function mcpServerTags(server) {
      const tags = [
        '<span class="tag">' + escapeHtml(server.transport || 'stdio') + '</span>',
        '<span class="tag">' + escapeHtml(server.scope || 'user') + '</span>'
      ];
      if (server.readonly) tags.push('<span class="tag warning">只读</span>');
      if (server.envKeys?.length) tags.push('<span class="tag">env: ' + escapeHtml(String(server.envKeys.length)) + '</span>');
      if (server.headerKeys?.length) tags.push('<span class="tag">headers: ' + escapeHtml(String(server.headerKeys.length)) + '</span>');
      return tags.join('');
    }

    function renderMcpToolsWorkspace() {
      const servers = state.tools.mcpServers || [];
      const selected = selectedMcpServer();
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>工具</h2><div class="workspaceMeta">管理插件 Marketplace 与 MCP Servers；MCP 默认写入 user scope</div></div><div class="toolbarRow"><button class="miniButton" type="button" data-tools-mcp-refresh-main>刷新</button></div></div>',
        renderToolsViewTabs(),
        state.tools.mcpLoading ? skeletonStack() : '',
        '<div class="toolsGrid">',
        '<div class="workspaceCard">',
        '<div class="profileSummary"><strong class="summaryLine">MCP Servers</strong><span class="summaryLine">' + escapeHtml(String(servers.length)) + ' 个配置项</span></div>',
        servers.length ? '<div class="itemList toolsListScroll">' + servers.map(server => {
          const active = selected?.name === server.name;
          const descriptor = server.command ? server.command + ' ' + (server.args || []).join(' ') : server.url || '';
          return [
            '<button class="listItem ' + (active ? 'active' : '') + '" data-tools-mcp-server="' + escapeHtml(server.name) + '">',
            '<div class="listItemHeader"><strong>' + escapeHtml(server.name) + '</strong><span class="statusBadge">' + escapeHtml(server.transport || 'stdio') + '</span></div>',
            '<span>' + escapeHtml(server.scope || 'user') + '</span>',
            '<span>' + escapeHtml(descriptor || '未提供摘要') + '</span>',
            '</button>'
          ].join('');
        }).join('') + '</div>' : '<div class="ghostState">尚未添加 MCP Server。可在左侧表单添加 stdio command/args 或远程 HTTP/SSE endpoint。</div>',
        '</div>',
        selected ? [
          '<div class="workspaceCard">',
          '<div class="workspaceHeader"><div><h2>' + escapeHtml(selected.name) + '</h2><div class="workspaceMeta">' + escapeHtml(selected.configPath || '') + '</div></div></div>',
          '<div class="tagRow">' + mcpServerTags(selected) + '</div>',
          '<div class="metaGrid">',
          '<div class="metaCard"><span>Transport</span><strong>' + escapeHtml(selected.transport || 'stdio') + '</strong></div>',
          '<div class="metaCard"><span>Scope</span><strong>' + escapeHtml(selected.scope || 'user') + '</strong></div>',
          '<div class="metaCard"><span>Env keys</span><strong>' + escapeHtml(String((selected.envKeys || []).length)) + '</strong></div>',
          '<div class="metaCard"><span>Header keys</span><strong>' + escapeHtml(String((selected.headerKeys || []).length)) + '</strong></div>',
          '</div>',
          selected.command ? '<div class="field" style="margin-top:12px"><label>Command</label><div class="contentPanel">' + escapeHtml([selected.command].concat(selected.args || []).join(' ')) + '</div></div>' : '',
          selected.url ? '<div class="field" style="margin-top:12px"><label>URL</label><div class="contentPanel">' + escapeHtml(selected.url) + '</div></div>' : '',
          selected.envKeys?.length ? '<div class="tagRow">' + selected.envKeys.map(key => '<span class="tag">' + escapeHtml(key) + '</span>').join('') + '</div>' : '',
          selected.headerKeys?.length ? '<div class="tagRow">' + selected.headerKeys.map(key => '<span class="tag">' + escapeHtml(key) + '</span>').join('') + '</div>' : '',
          selected.readonly ? '<div class="readonlyNotice">此 MCP Server 来自只读配置，不能在 Web UI 中移除。</div>' : '',
          '<div class="toolbarRow" style="margin-top:12px"><button class="miniButton ' + (state.tools.removingMcp === selected.name + '@' + selected.scope ? 'buttonLoading' : '') + '" type="button" data-tools-mcp-remove="' + escapeHtml(selected.name) + '" data-tools-mcp-remove-scope="' + escapeHtml(selected.scope || 'user') + '" ' + (selected.readonly || state.tools.removingMcp ? 'disabled' : '') + '>' + (state.tools.removingMcp === selected.name + '@' + selected.scope ? '移除中' : '移除 MCP Server') + '</button>' + (state.running ? '<button class="miniButton" type="button" data-tools-refresh-session>刷新会话</button>' : '') + '</div>',
          state.tools.mcpNotice ? '<div class="readonlyNotice">' + escapeHtml(state.tools.mcpNotice) + '</div>' : '',
          state.tools.mcpError ? '<div class="errorBox">' + escapeHtml(state.tools.mcpError) + '</div>' : '',
          '</div>'
        ].join('') : '<div class="workspaceCard ghostState">选择一个 MCP Server 查看详情。</div>',
        '</div>'
      ].join('');
      wireToolsViewTabs(workspaceView);
      workspaceView.querySelector('[data-tools-mcp-refresh-main]')?.addEventListener('click', () => refreshMcpServers());
      workspaceView.querySelectorAll('[data-tools-mcp-server]').forEach(button => {
        button.addEventListener('click', () => {
          state.tools.selectedMcpName = button.dataset.toolsMcpServer || '';
          renderMcpToolsWorkspace();
        });
      });
      workspaceView.querySelector('[data-tools-mcp-remove]')?.addEventListener('click', event => {
        const button = event.currentTarget;
        removeMcpServer(button.dataset.toolsMcpRemove, button.dataset.toolsMcpRemoveScope);
      });
      workspaceView.querySelector('[data-tools-refresh-session]')?.addEventListener('click', () => {
        sendWs({ type: 'refresh_session' });
        state.tools.mcpNotice = '会话已刷新，MCP Server 会在下一次任务中加载。';
        renderSecondary();
        renderMcpToolsWorkspace();
      });
    }

    function formatSessionTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function formatNumber(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number)) return '0';
      return new Intl.NumberFormat('zh-CN').format(number);
    }

    function syncPlatformAuthDraftFromInputs() {
      const read = (id, fallback) => {
        const element = document.getElementById(id);
        return element && 'value' in element ? element.value : fallback;
      };
      state.platformAuth.baseUrl = read('platformBaseUrl', state.platformAuth.baseUrl || state.platformAuth.status?.baseUrl || '');
      state.platformAuth.ssoAccount = read('platformSsoAccount', state.platformAuth.ssoAccount);
      state.platformAuth.ssoCode = read('platformSsoCode', state.platformAuth.ssoCode);
      state.platformAuth.username = read('platformUsername', state.platformAuth.username);
      state.platformAuth.password = read('platformPassword', state.platformAuth.password);
      state.platformAuth.captcha = read('platformCaptcha', state.platformAuth.captcha);
    }

    async function refreshPlatformAuthStatus(forceValidate) {
      syncPlatformAuthDraftFromInputs();
      state.platformAuth.loading = true;
      state.platformAuth.error = '';
      if (state.activeMenu === 'settings') renderSettingsPanel();
      try {
        const suffix = forceValidate ? '?force_validate=true' : '';
        const status = await api('/api/platform-auth/status' + suffix);
        state.platformAuth.status = status;
        state.platformAuth.baseUrl = status.baseUrl || state.platformAuth.baseUrl;
      } catch (error) {
        state.platformAuth.error = getErrorMessage(error);
      } finally {
        state.platformAuth.loading = false;
        if (state.activeMenu === 'settings') renderSettingsPanel();
      }
    }

    async function refreshPlatformUsageSummary() {
      state.platformAuth.usageError = '';
      try {
        state.platformAuth.usage = await api('/api/platform-usage/summary');
      } catch (error) {
        state.platformAuth.usageError = getErrorMessage(error);
      } finally {
        if (state.activeMenu === 'settings') renderSettingsPanel();
      }
    }

    async function refreshPlatformSettings() {
      await refreshPlatformAuthStatus(false);
      await refreshPlatformUsageSummary();
    }

    function renderSettingsPanel() {
      const auth = state.platformAuth.status || {
        authenticated: false,
        baseUrl: state.platformAuth.baseUrl || '',
        validationStatus: 'unknown',
        message: '未登录'
      };
      const baseUrl = state.platformAuth.baseUrl || auth.baseUrl || '';
      const authenticated = Boolean(auth.authenticated);
      const dotClass = authenticated ? (auth.validationStatus === 'invalid' || auth.validationStatus === 'error' ? 'error' : 'ok') : '';
      const methodLabel = auth.method === 'sso' ? 'SSO' : auth.method === 'password' ? '账号密码' : '未登录';
      const usage = state.platformAuth.usage?.payload || null;
      const tab = state.platformAuth.tab === 'password' ? 'password' : 'sso';
      secondaryBody.innerHTML = [
        state.platformAuth.error ? '<div class="errorBox"><strong>认证操作失败</strong><div>' + escapeHtml(state.platformAuth.error) + '</div></div>' : '',
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>身份认证</h3></div>',
        '<div class="profileSummary">',
        '<div class="settingsStatus"><span class="settingsDot ' + dotClass + '"></span><span>' + escapeHtml(authenticated ? '已认证' : '未登录') + '</span></div>',
        '<span class="summaryLine">服务地址：' + escapeHtml(baseUrl || '未配置') + '</span>',
        '<span class="summaryLine">方式：' + escapeHtml(methodLabel) + '</span>',
        authenticated && auth.identityName ? '<span class="summaryLine">账号：' + escapeHtml(auth.identityName) + '</span>' : '',
        auth.lastValidatedAt ? '<span class="summaryLine">校验时间：' + escapeHtml(shortTime(auth.lastValidatedAt)) + '</span>' : '',
        '<span class="summaryLine">' + escapeHtml(auth.message || '') + '</span>',
        '</div>',
        authenticated ? [
          '<div class="settingsActions">',
          '<button class="miniButton" type="button" data-platform-refresh-status ' + (state.platformAuth.loading ? 'disabled' : '') + '>刷新状态</button>',
          '<button class="miniButton danger" type="button" data-platform-logout>退出认证</button>',
          '</div>'
        ].join('') : [
          '<div class="field"><label for="platformBaseUrl">平台服务地址</label><input id="platformBaseUrl" autocomplete="off" value="' + escapeHtml(baseUrl) + '"></div>',
          '<div class="settingsTabs">',
          '<button class="miniButton ' + (tab === 'sso' ? 'active' : '') + '" type="button" data-platform-auth-tab="sso">SSO 登录</button>',
          '<button class="miniButton ' + (tab === 'password' ? 'active' : '') + '" type="button" data-platform-auth-tab="password">账号密码登录</button>',
          '</div>',
          tab === 'sso' ? [
            '<div class="field"><label for="platformSsoAccount">账号</label><input id="platformSsoAccount" autocomplete="username" value="' + escapeHtml(state.platformAuth.ssoAccount) + '"></div>',
            '<div class="splitFields">',
            '<div class="field"><label for="platformSsoCode">验证码</label><input id="platformSsoCode" autocomplete="one-time-code" value="' + escapeHtml(state.platformAuth.ssoCode) + '"></div>',
            '<div class="field"><label>&nbsp;</label><button class="miniButton" type="button" data-platform-send-sso ' + (state.platformAuth.sendingCode ? 'disabled' : '') + '>' + (state.platformAuth.sendingCode ? '发送中' : '发送验证码') + '</button></div>',
            '</div>',
            '<button class="secondaryAction" type="button" data-platform-login-sso ' + (state.platformAuth.loggingIn ? 'disabled' : '') + '>' + (state.platformAuth.loggingIn ? '登录中' : '登录') + '</button>'
          ].join('') : [
            '<div class="field"><label for="platformUsername">用户名</label><input id="platformUsername" autocomplete="username" value="' + escapeHtml(state.platformAuth.username) + '"></div>',
            '<div class="field"><label for="platformPassword">密码</label><input id="platformPassword" type="password" autocomplete="current-password" value="' + escapeHtml(state.platformAuth.password) + '"></div>',
            state.platformAuth.captchaImageBase64 ? '<div class="captchaImage"><img alt="验证码" src="data:image/png;base64,' + escapeHtml(state.platformAuth.captchaImageBase64) + '"></div>' : '<div class="captchaImage"><span>请先获取验证码</span></div>',
            '<div class="captchaRow">',
            '<div class="field"><label for="platformCaptcha">验证码</label><input id="platformCaptcha" autocomplete="off" value="' + escapeHtml(state.platformAuth.captcha) + '"></div>',
            '<div class="field"><label>&nbsp;</label><button class="miniButton" type="button" data-platform-captcha ' + (state.platformAuth.captchaLoading ? 'disabled' : '') + '>' + (state.platformAuth.captchaLoading ? '获取中' : '获取验证码') + '</button></div>',
            '</div>',
            '<button class="secondaryAction" type="button" data-platform-login-password ' + (state.platformAuth.loggingIn ? 'disabled' : '') + '>' + (state.platformAuth.loggingIn ? '登录中' : '登录') + '</button>'
          ].join('')
        ].join(''),
        '</section>',
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>数据统计上传</h3><button class="sectionToggle" type="button" data-platform-refresh-usage>刷新</button></div>',
        state.platformAuth.usageError ? '<div class="errorBox"><strong>统计加载失败</strong><div>' + escapeHtml(state.platformAuth.usageError) + '</div></div>' : '',
        '<div class="usageGrid">',
        '<div class="usageMetric"><span>本周生成</span><strong>' + formatNumber(usage?.generated_case_count_week) + '</strong></div>',
        '<div class="usageMetric"><span>累计生成</span><strong>' + formatNumber(usage?.generated_case_count_total) + '</strong></div>',
        '<div class="usageMetric"><span>本周执行</span><strong>' + formatNumber(usage?.executed_case_count_week) + '</strong></div>',
        '<div class="usageMetric"><span>累计执行</span><strong>' + formatNumber(usage?.executed_case_count_total) + '</strong></div>',
        '<div class="usageMetric"><span>本周 Token</span><strong>' + formatNumber(usage?.token_usage_week) + '</strong></div>',
        '<div class="usageMetric"><span>累计 Token</span><strong>' + formatNumber(usage?.token_usage_total) + '</strong></div>',
        '</div>',
        '<div class="profileSummary">',
        '<span class="summaryLine">本周起点：' + escapeHtml(usage?.week_start_at ? shortTime(usage.week_start_at) : '暂无') + '</span>',
        '<span class="summaryLine">上传方式：手动触发，不会自动后台上传。</span>',
        '</div>',
        '<button class="secondaryAction" type="button" data-platform-upload ' + (!authenticated || state.platformAuth.uploading ? 'disabled' : '') + '>' + (state.platformAuth.uploading ? '上传中' : '上传统计') + '</button>',
        !authenticated ? '<div class="ghostState" style="margin-top:12px">登录后才能上传统计。</div>' : '',
        '</section>'
      ].join('');

      secondaryBody.querySelectorAll('[data-platform-auth-tab]').forEach(button => {
        button.addEventListener('click', () => {
          syncPlatformAuthDraftFromInputs();
          state.platformAuth.tab = button.dataset.platformAuthTab === 'password' ? 'password' : 'sso';
          renderSettingsPanel();
        });
      });
      secondaryBody.querySelector('[data-platform-refresh-status]')?.addEventListener('click', () => {
        refreshPlatformAuthStatus(true);
      });
      secondaryBody.querySelector('[data-platform-refresh-usage]')?.addEventListener('click', () => {
        refreshPlatformUsageSummary();
      });
      secondaryBody.querySelector('[data-platform-logout]')?.addEventListener('click', async () => {
        state.platformAuth.error = '';
        try {
          const status = await api('/api/platform-auth/logout', { method: 'POST' });
          state.platformAuth.status = status;
          state.platformAuth.password = '';
          state.platformAuth.captcha = '';
          state.platformAuth.captchaKey = '';
          state.platformAuth.captchaImageBase64 = '';
          renderSettingsPanel();
          addActivity({ kind: 'status', title: '身份认证', detail: '已退出认证', at: Date.now() });
        } catch (error) {
          state.platformAuth.error = getErrorMessage(error);
          renderSettingsPanel();
        }
      });
      secondaryBody.querySelector('[data-platform-captcha]')?.addEventListener('click', async () => {
        syncPlatformAuthDraftFromInputs();
        state.platformAuth.captchaLoading = true;
        state.platformAuth.error = '';
        renderSettingsPanel();
        try {
          const result = await api('/api/platform-auth/captcha', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: state.platformAuth.baseUrl })
          });
          if (!result.success) throw new Error(result.message || '验证码获取失败');
          state.platformAuth.baseUrl = result.baseUrl || state.platformAuth.baseUrl;
          state.platformAuth.captchaKey = result.captchaKey || '';
          state.platformAuth.captchaImageBase64 = result.captchaImageBase64 || '';
          state.platformAuth.captcha = '';
        } catch (error) {
          state.platformAuth.error = getErrorMessage(error);
        } finally {
          state.platformAuth.captchaLoading = false;
          renderSettingsPanel();
        }
      });
      secondaryBody.querySelector('[data-platform-send-sso]')?.addEventListener('click', async () => {
        syncPlatformAuthDraftFromInputs();
        state.platformAuth.sendingCode = true;
        state.platformAuth.error = '';
        renderSettingsPanel();
        try {
          const result = await api('/api/platform-auth/sso/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseUrl: state.platformAuth.baseUrl,
              account: state.platformAuth.ssoAccount
            })
          });
          if (!result.success) throw new Error(result.message || '验证码发送失败');
          state.platformAuth.baseUrl = result.baseUrl || state.platformAuth.baseUrl;
          state.platformAuth.ssoUuid = result.uuid || '';
          addActivity({ kind: 'status', title: '身份认证', detail: 'SSO 验证码已发送', at: Date.now() });
        } catch (error) {
          state.platformAuth.error = getErrorMessage(error);
        } finally {
          state.platformAuth.sendingCode = false;
          renderSettingsPanel();
        }
      });
      secondaryBody.querySelector('[data-platform-login-sso]')?.addEventListener('click', async () => {
        syncPlatformAuthDraftFromInputs();
        state.platformAuth.loggingIn = true;
        state.platformAuth.error = '';
        renderSettingsPanel();
        try {
          const result = await api('/api/platform-auth/sso/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseUrl: state.platformAuth.baseUrl,
              account: state.platformAuth.ssoAccount,
              code: state.platformAuth.ssoCode,
              uuid: state.platformAuth.ssoUuid
            })
          });
          if (!result.success) throw new Error(result.message || '登录失败');
          state.platformAuth.status = result.status;
          state.platformAuth.ssoCode = '';
          await refreshPlatformUsageSummary();
          addActivity({ kind: 'status', title: '身份认证', detail: 'SSO 登录成功', at: Date.now() });
        } catch (error) {
          state.platformAuth.error = getErrorMessage(error);
        } finally {
          state.platformAuth.loggingIn = false;
          renderSettingsPanel();
        }
      });
      secondaryBody.querySelector('[data-platform-login-password]')?.addEventListener('click', async () => {
        syncPlatformAuthDraftFromInputs();
        state.platformAuth.loggingIn = true;
        state.platformAuth.error = '';
        renderSettingsPanel();
        try {
          const result = await api('/api/platform-auth/login/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseUrl: state.platformAuth.baseUrl,
              username: state.platformAuth.username,
              password: state.platformAuth.password,
              captcha: state.platformAuth.captcha,
              captchaKey: state.platformAuth.captchaKey
            })
          });
          if (!result.success) throw new Error(result.message || '登录失败');
          state.platformAuth.status = result.status;
          state.platformAuth.password = '';
          state.platformAuth.captcha = '';
          state.platformAuth.captchaKey = '';
          state.platformAuth.captchaImageBase64 = '';
          await refreshPlatformUsageSummary();
          addActivity({ kind: 'status', title: '身份认证', detail: '账号密码登录成功', at: Date.now() });
        } catch (error) {
          state.platformAuth.error = getErrorMessage(error);
        } finally {
          state.platformAuth.loggingIn = false;
          renderSettingsPanel();
        }
      });
      secondaryBody.querySelector('[data-platform-upload]')?.addEventListener('click', async () => {
        state.platformAuth.uploading = true;
        state.platformAuth.usageError = '';
        renderSettingsPanel();
        try {
          const result = await api('/api/platform-usage/report', { method: 'POST' });
          state.platformAuth.usage = { payload: result.payload };
          addActivity({ kind: 'status', title: '数据统计上传', detail: '统计上传成功', at: Date.now() });
          showToast('统计上传成功', 'success');
        } catch (error) {
          state.platformAuth.usageError = getErrorMessage(error);
          addActivity({ kind: 'error', title: '数据统计上传', detail: state.platformAuth.usageError, at: Date.now() });
        } finally {
          state.platformAuth.uploading = false;
          renderSettingsPanel();
        }
      });
    }

    function renderChatPanel() {
      const sessions = state.bootstrap?.chatSessions || [];
      if (!sessions.length) {
        secondaryBody.innerHTML = '<div class="ghostState"><strong>还没有对话</strong><div>点击加号按钮开始一个新对话。</div><div style="margin-top:10px"><button class="miniButton" type="button" data-chat-new>新建对话</button></div></div>';
        secondaryBody.querySelector('[data-chat-new]')?.addEventListener('click', () => document.getElementById('newChat').click());
        return;
      }
      secondaryBody.innerHTML = [
        '<div class="sessionList">',
        sessions.map(session => [
          '<div class="sessionItem ' + (session.id === state.activeChatSessionId ? 'active' : '') + '" data-chat-session="' + escapeHtml(session.id) + '">',
          '<button class="sessionSelect" type="button" data-select-session="' + escapeHtml(session.id) + '">',
          '<span class="sessionTitle">' + escapeHtml(session.title || '新建对话') + '</span>',
          '<span class="sessionTime">' + escapeHtml(formatSessionTime(session.updatedAt)) + '</span>',
          '</button>',
          '<button class="sessionDelete" type="button" title="删除对话" aria-label="删除对话" data-delete-session="' + escapeHtml(session.id) + '">' + iconSvg.trash + '</button>',
          '</div>'
        ].join('')).join(''),
        '</div>'
      ].join('');
      secondaryBody.querySelectorAll('[data-select-session]').forEach(button => {
        button.addEventListener('click', () => {
          const sessionId = button.dataset.selectSession;
          if (!sessionId || sessionId === state.activeChatSessionId) return;
          localStorage.setItem('opencat-active-session', sessionId);
          sendWs({ type: 'select_session', sessionId });
        });
      });
      secondaryBody.querySelectorAll('[data-delete-session]').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          const sessionId = button.dataset.deleteSession;
          if (!sessionId) return;
          sendWs({ type: 'delete_session', sessionId });
        });
      });
    }

    function renderProviderPanel() {
      const providers = state.bootstrap?.providers || [];
      const current = state.bootstrap?.profile;
      const midscene = state.bootstrap?.midsceneProfile;
      const families = [
        'doubao-vision',
        'doubao-seed',
        'qwen2.5-vl',
        'qwen3-vl',
        'qwen3.5',
        'qwen3.6',
        'gemini',
        'vlm-ui-tars',
        'vlm-ui-tars-doubao',
        'vlm-ui-tars-doubao-1.5',
        'glm-v',
        'auto-glm',
        'auto-glm-multilingual',
        'gpt-5'
      ];
      const providerOptionId = current?.provider === 'openai' ? 'openai-compatible' : current?.provider;
      const chatExpanded = !current || state.providerEditorOpen.chat;
      const midsceneExpanded = !midscene || state.providerEditorOpen.midscene;
      const summaryLine = value => '<span class="summaryLine">' + escapeHtml(value || '') + '</span>';
      const chatSummary = current
        ? [
            '<strong class="summaryLine">' + escapeHtml(current.displayName || '对话模型提供方') + '</strong>',
            summaryLine(current.model || '未设置模型'),
            summaryLine(current.baseUrl || '未设置 Base URL'),
            summaryLine(current.credentialConfigured ? 'API key 已配置' : 'API key 未配置')
          ].join('')
        : '尚未保存模型提供方配置。';
      const midsceneSummary = midscene
        ? [
            '<strong class="summaryLine">' + escapeHtml(midscene.model || 'Midscene 模型') + '</strong>',
            summaryLine(midscene.baseUrl || '未设置 Base URL'),
            summaryLine(midscene.modelFamily || '未设置模型 family'),
            summaryLine(midscene.credentialConfigured ? 'API key 已配置' : 'API key 未配置')
          ].join('')
        : '尚未保存 Midscene 配置。';
      const sectionToggle = (section, expanded, hasSavedProfile) => hasSavedProfile
        ? '<button class="sectionToggle" type="button" data-provider-section="' + section + '" aria-expanded="' + String(expanded) + '">' + (expanded ? '收起' : '编辑') + '</button>'
        : '';
      secondaryBody.innerHTML = [
        '<form id="providerForm">',
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>对话模型提供方</h3>' + sectionToggle('chat', chatExpanded, Boolean(current)) + '</div>',
        '<div class="profileSummary" id="profileSummaryBox">',
        chatSummary,
        '</div>',
        '<div class="sectionFields" ' + (chatExpanded ? '' : 'hidden') + '>',
        '<div class="field"><label for="providerSelect">Provider</label><select id="providerSelect">',
        providers.map(provider => '<option value="' + escapeHtml(provider.id) + '">' + escapeHtml(provider.label) + '</option>').join(''),
        '</select></div>',
        '<div class="field"><label for="providerBaseUrl">Base URL</label><input id="providerBaseUrl" autocomplete="off"></div>',
        '<div class="field"><label for="providerModel">Model</label><input id="providerModel" autocomplete="off"></div>',
        '<div class="field"><label for="providerApiKey">API key</label><input id="providerApiKey" type="password" autocomplete="off"></div>',
        '</div>',
        '</section>',
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>Midscene App 测试</h3>' + sectionToggle('midscene', midsceneExpanded, Boolean(midscene)) + '</div>',
        '<div class="profileSummary" id="midsceneSummaryBox">',
        midsceneSummary,
        '</div>',
        '<div class="sectionFields" ' + (midsceneExpanded ? '' : 'hidden') + '>',
        '<div class="field"><label for="midsceneBaseUrl">Base URL</label><input id="midsceneBaseUrl" autocomplete="off"></div>',
        '<div class="field"><label for="midsceneModel">Model</label><input id="midsceneModel" autocomplete="off"></div>',
        '<div class="field"><label for="midsceneModelFamily">Model family</label><select id="midsceneModelFamily">',
        families.map(family => '<option value="' + escapeHtml(family) + '">' + escapeHtml(family) + '</option>').join(''),
        '</select></div>',
        '<div class="field"><label for="midsceneApiKey">API key</label><input id="midsceneApiKey" type="password" autocomplete="off"></div>',
        '</div>',
        '</section>',
        '<button class="secondaryAction" type="submit">保存配置</button>',
        '</form>'
      ].join('');

      secondaryBody.querySelectorAll('[data-provider-section]').forEach(button => {
        button.addEventListener('click', () => {
          const section = button.dataset.providerSection;
          if (!section || !(section in state.providerEditorOpen)) return;
          state.providerEditorOpen[section] = !state.providerEditorOpen[section];
          renderProviderPanel();
        });
      });

      const select = document.getElementById('providerSelect');
      const baseUrl = document.getElementById('providerBaseUrl');
      const model = document.getElementById('providerModel');
      const apiKey = document.getElementById('providerApiKey');
      const midsceneBaseUrl = document.getElementById('midsceneBaseUrl');
      const midsceneModel = document.getElementById('midsceneModel');
      const midsceneModelFamily = document.getElementById('midsceneModelFamily');
      const midsceneApiKey = document.getElementById('midsceneApiKey');
      const updateDefaults = () => {
        const option = providers.find(provider => provider.id === select.value);
        const selectedSavedProvider = Boolean(current?.credentialConfigured && providerOptionId === select.value);
        baseUrl.value = option?.defaultBaseUrl || '';
        model.value = option?.defaultModel || '';
        apiKey.placeholder = selectedSavedProvider ? '已保存' : option?.requiresApiKey ? '本地模型除外，必填' : '不需要';
      };
      if (providerOptionId && providers.some(provider => provider.id === providerOptionId)) {
        select.value = providerOptionId;
      }
      select.addEventListener('change', updateDefaults);
      updateDefaults();
      if (current?.baseUrl) baseUrl.value = current.baseUrl;
      if (current?.model) model.value = current.model;
      midsceneBaseUrl.value = midscene?.baseUrl || '';
      midsceneModel.value = midscene?.model || '';
      midsceneModelFamily.value = midscene?.modelFamily || 'doubao-vision';
      midsceneApiKey.placeholder = midscene?.credentialConfigured ? '已保存' : '可选';

      document.getElementById('providerForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          const midsceneHasInput = Boolean(
            midscene ||
            midsceneBaseUrl.value.trim() ||
            midsceneModel.value.trim() ||
            midsceneApiKey.value.trim()
          );
          const payload = {
            provider: select.value,
            baseUrl: baseUrl.value,
            model: model.value,
            apiKey: apiKey.value
          };
          if (midsceneHasInput) {
            payload.midscene = {
              baseUrl: midsceneBaseUrl.value,
              model: midsceneModel.value,
              modelFamily: midsceneModelFamily.value,
              apiKey: midsceneApiKey.value
            };
          }
          const result = await api('/api/provider-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          apiKey.value = '';
          midsceneApiKey.value = '';
          if (result.bootstrap) {
            state.bootstrap = result.bootstrap;
          } else {
            state.bootstrap.profile = result.profile;
          }
          state.providerEditorOpen.chat = false;
          state.providerEditorOpen.midscene = false;
          setProviderSummary(state.bootstrap.profile);
          renderProviderPanel();
          sendWs({ type: 'refresh_session' });
          addActivity({ kind: 'status', title: 'Provider saved', detail: state.bootstrap.profile?.displayName || 'Configuration saved', at: Date.now() });
          addActivity({ kind: 'status', title: 'Session refreshed', detail: 'Midscene settings applied to new local CLI process', at: Date.now() });
        } catch (error) {
          addActivity({ kind: 'error', title: 'Provider save failed', detail: error.message, at: Date.now() });
        }
      });
    }

    function clearChatMessages() {
      messages.querySelectorAll('.message, .toolRow').forEach(node => node.remove());
      state.streams.clear();
      emptyState.style.display = '';
    }

    function renderLoadedMessages(loadedMessages) {
      clearChatMessages();
      (loadedMessages || []).forEach(message => {
        addMessage(
          message.role || 'assistant',
          message.content || '',
          message.messageId || ('restored-' + Date.now() + '-' + Math.random()),
          { animate: false }
        );
      });
      if ((loadedMessages || []).length) {
        emptyState.style.display = 'none';
      }
    }

    function addMessage(role, content, id, options) {
      emptyState.style.display = 'none';
      const message = document.createElement('article');
      const animate = options?.animate !== false;
      message.className = 'message ' + role + (animate ? ' isNew' : '');
      message.dataset.messageId = id;
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = role === 'user' ? '你' : 'OC';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      setBubbleContent(bubble, content || '', false);
      if (role === 'user') {
        message.appendChild(bubble);
        message.appendChild(avatar);
      } else {
        message.appendChild(avatar);
        message.appendChild(bubble);
      }
      messages.appendChild(message);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }

    function setBubbleContent(bubble, content, streaming) {
      const raw = String(content ?? '');
      bubble.dataset.rawContent = raw;
      bubble.classList.toggle('streaming', Boolean(streaming));
      bubble.setAttribute('aria-busy', streaming ? 'true' : 'false');
      if (streaming) {
        bubble.classList.remove('markdownBody');
        if (raw.trim()) {
          bubble.textContent = raw;
        } else {
          bubble.innerHTML = '<span class="oc-typing-dots" aria-label="正在生成"><span></span><span></span><span></span></span>';
        }
        return;
      }
      bubble.classList.add('markdownBody');
      bubble.innerHTML = renderMarkdownContent(raw);
    }

    function ensureStream(id) {
      let bubble = state.streams.get(id);
      if (!bubble) {
        bubble = addMessage('assistant', '', id);
        setBubbleContent(bubble, '', true);
        state.streams.set(id, bubble);
      }
      return bubble;
    }

    function toolStatusClass(status) {
      if (status === 'completed' || status === 'success') return 'success';
      if (status === 'started' || status === 'progress' || status === 'running') return 'running';
      if (status === 'failed' || status === 'error') return 'error';
      return '';
    }

    function renderJsonBlock(value) {
      if (value === undefined || value === null) return '';
      try {
        return '<pre class="jsonBlock">' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
      } catch {
        return '<pre class="jsonBlock">' + escapeHtml(String(value)) + '</pre>';
      }
    }

    function renderToolSummary(tool) {
      const parts = [];
      if (tool.summary) parts.push('<span>' + escapeHtml(tool.summary) + '</span>');
      if (tool.input !== undefined) {
        parts.push('<details class="toolDetail"><summary>查看输入</summary>' + renderJsonBlock(tool.input) + '</details>');
      }
      return parts.join('');
    }

    function addToolRow(tool) {
      emptyState.style.display = 'none';
      const row = document.createElement('div');
      const status = tool.status || 'started';
      const running = status === 'started' || status === 'progress';
      row.className = 'toolRow isNew status-' + escapeHtml(status);
      row.setAttribute('aria-busy', running ? 'true' : 'false');
      row.innerHTML = [
        '<div class="toolHeader">',
        '<span class="toolTitle">Tool: ' + escapeHtml(tool.name || '工具') + '</span>',
        '<span class="statusBadge ' + toolStatusClass(status) + '">' + (running ? '<span class="pulseDot"></span>' : '') + escapeHtml(localizeStatus(status)) + '</span>',
        '</div>',
        '<div class="toolMeta">' + renderToolSummary(tool) + '</div>'
      ].join('');
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function activityBadgeMeta(activity) {
      const title = String(activity.title || '');
      const kind = activity.kind || 'status';
      if (kind === 'error') return { label: 'error', className: 'error', running: false };
      if (/AppTest|app-test/i.test(title)) return { label: 'app-test', className: 'running', running: kind === 'preflight' };
      if (kind === 'read' || kind === 'grep' || kind === 'edit') return { label: 'file', className: '', running: false };
      if (kind === 'permission') return { label: 'tool', className: 'running', running: true };
      if (kind === 'result') return { label: 'success', className: 'success', running: false };
      if (kind === 'thinking' || kind === 'preflight' || kind === 'status') return { label: kind === 'preflight' ? 'check' : 'model', className: 'running', running: kind !== 'status' };
      return { label: kind, className: '', running: false };
    }

    function renderActivityDetail(detail) {
      const text = localizeCommonText(detail || '');
      if (!text) return '';
      if (text.length > 180) {
        return '<div class="activityDetail"><details><summary>查看详情</summary><div>' + escapeHtml(text) + '</div></details></div>';
      }
      return '<div class="activityDetail">' + escapeHtml(text) + '</div>';
    }

    function addActivity(activity) {
      const item = document.createElement('div');
      const meta = activityBadgeMeta(activity);
      item.className = 'activityItem kind-' + escapeHtml(activity.kind || 'status');
      const time = activity.at ? new Date(activity.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      item.innerHTML = '<div class="activityItemTitle"><span>' + escapeHtml(localizeCommonText(activity.title || activity.kind || 'Activity')) + '</span><span class="activityBadge ' + meta.className + '">' + (meta.running ? '<span class="pulseDot"></span>' : '') + escapeHtml(meta.label) + '</span><span>' + escapeHtml(time) + '</span></div>' +
        renderActivityDetail(activity.detail);
      activityList.prepend(item);
      while (activityList.children.length > 80) activityList.lastChild.remove();
    }

    function showPermission(request) {
      state.pendingPermission = request;
      const toolName = request.toolName || '工具授权';
      const prompt = request.prompt && request.prompt !== toolName ? toolName + ': ' + request.prompt : toolName;
      permissionPrompt.textContent = prompt;
      permissionPreview.textContent = JSON.stringify(request.input || {}, null, 2);
      modal.classList.add('open');
      setRunning(true);
    }

    function handleServerEvent(event) {
      if (event.type === 'ready') {
        state.bootstrap = event.bootstrap;
        state.activeChatSessionId = event.bootstrap.activeChatSessionId || null;
        setProviderSummary(event.bootstrap.profile);
        renderNav();
        renderSecondary();
        renderMainView();
        const sessions = event.bootstrap.chatSessions || [];
        const storedSessionId = localStorage.getItem('opencat-active-session');
        if (
          !state.requestedStoredSession &&
          storedSessionId &&
          sessions.some(session => session.id === storedSessionId)
        ) {
          state.requestedStoredSession = true;
          if (storedSessionId !== state.activeChatSessionId) {
            state.activeChatSessionId = storedSessionId;
            sendWs({ type: 'select_session', sessionId: storedSessionId });
          }
        } else if (state.activeChatSessionId) {
          localStorage.setItem('opencat-active-session', state.activeChatSessionId);
        }
      } else if (event.type === 'sessions_updated') {
        if (!state.bootstrap) state.bootstrap = {};
        state.bootstrap.chatSessions = event.sessions || [];
        state.activeChatSessionId = event.activeSessionId || null;
        if (state.activeChatSessionId) {
          localStorage.setItem('opencat-active-session', state.activeChatSessionId);
        } else {
          localStorage.removeItem('opencat-active-session');
        }
        if (state.activeMenu === 'chat') renderChatPanel();
      } else if (event.type === 'session_loaded') {
        state.activeChatSessionId = event.sessionId || null;
        if (state.activeChatSessionId) {
          localStorage.setItem('opencat-active-session', state.activeChatSessionId);
        } else {
          localStorage.removeItem('opencat-active-session');
        }
        renderLoadedMessages(event.messages || []);
        clearPendingPermission();
        setRunning(false);
        if (state.activeMenu === 'chat') renderChatPanel();
      } else if (event.type === 'status') {
        setStatus(event.status || 'Ready');
        if (event.status === 'Ready') {
          clearPendingPermission();
          setRunning(false);
        } else if (event.status === 'Running') {
          setRunning(true);
        }
        if (event.detail) addActivity({ kind: 'status', title: event.status, detail: event.detail, at: Date.now() });
      } else if (event.type === 'activity') {
        addActivity(event.activity);
      } else if (event.type === 'stream_start') {
        ensureStream(event.messageId);
        setStatus('Running');
        setRunning(true);
      } else if (event.type === 'stream_delta') {
        const bubble = ensureStream(event.messageId);
        const nextContent = (bubble.dataset.rawContent || '') + (event.delta || '');
        setBubbleContent(bubble, nextContent, true);
        messages.scrollTop = messages.scrollHeight;
      } else if (event.type === 'stream_end') {
        const bubble = ensureStream(event.messageId);
        setBubbleContent(bubble, event.content || bubble.dataset.rawContent || '', false);
        state.streams.delete(event.messageId);
      } else if (event.type === 'chat_message') {
        const existing = messages.querySelector('[data-message-id="' + CSS.escape(event.messageId) + '"] .bubble');
        if (existing) setBubbleContent(existing, event.content || '', false);
        else addMessage(event.role || 'assistant', event.content || '', event.messageId);
      } else if (event.type === 'tool') {
        addToolRow(event);
      } else if (event.type === 'permission_request') {
        showPermission(event.request);
      } else if (event.type === 'plugin_recommendation') {
        state.tools.recommendation = event.recommendation;
        addActivity({ kind: 'status', title: 'Plugin recommendation', detail: (event.recommendation?.pluginId || '') + ' from ' + (event.recommendation?.source || 'runtime'), at: Date.now() });
        showToast('检测到可选插件推荐，请到工具菜单确认安装。', 'warning');
        if (state.activeMenu === 'tools') {
          renderSecondary();
          renderMainView();
        }
      } else if (event.type === 'error') {
        addActivity({ kind: 'error', title: 'Error', detail: event.message, at: Date.now() });
        setStatus('Error');
        setRunning(false);
      }
    }

    function initStaticControls() {
      setIcon('secondaryCollapse', 'chevronLeft');
      setIcon('secondaryExpand', 'chevronRight');
      setIcon('activityCollapse', 'panelRight');
      setIcon('newChat', 'plus');
      setIcon('stopSession', 'square');
      setIcon('sendButton', 'send');
      setIcon('attachButton', 'paperclip');
      initNavControls();

      document.getElementById('secondaryCollapse').addEventListener('click', () => {
        state.secondaryCollapsed = true;
        renderLayout();
      });
      document.getElementById('secondaryExpand').addEventListener('click', () => {
        state.secondaryCollapsed = false;
        renderLayout();
      });
      document.getElementById('activityCollapse').addEventListener('click', () => {
        state.activityCollapsed = !state.activityCollapsed;
        renderLayout();
      });
      document.getElementById('newChat').addEventListener('click', () => {
        sendWs({ type: 'new_session' });
        state.activeMenu = 'chat';
        state.secondaryCollapsed = false;
        renderLayout();
        renderNav();
        renderSecondary();
        renderMainView();
        clearChatMessages();
        clearPendingPermission();
        setRunning(false);
      });
      stopSession.addEventListener('click', () => {
        if (stopSession.disabled) return;
        state.stopping = true;
        setStatus('Stopping...');
        clearPendingPermission();
        updateStopControl();
        sendWs({ type: 'abort' });
      });
      document.getElementById('composerForm').addEventListener('submit', event => {
        event.preventDefault();
        const text = composerInput.value.trim();
        if (!text && state.attachments.length === 0) return;
        if (state.attachments.some(item => item.status === 'uploading')) {
          showToast('附件仍在读取中，请稍后发送。', 'warning');
          return;
        }
        if (state.attachments.some(item => item.status === 'failed')) {
          showToast('请先移除失败的附件。', 'warning');
          return;
        }
        const attachments = state.attachments.map(item => ({
          id: item.id,
          name: item.name,
          mimeType: item.mimeType || '',
          size: item.size,
          contentBase64: item.contentBase64 || ''
        }));
        const visibleText = text || ('附件文件：' + attachments.map(item => item.name).join(', '));
        addMessage('user', visibleText, 'user-' + Date.now());
        composerInput.value = '';
        renderComposerHighlight();
        closeCommandSuggestions();
        state.attachments = [];
        renderAttachments();
        setRunning(true);
        sendWs({ type: 'send_message', text, attachments });
      });
      attachButton.addEventListener('click', () => attachmentInput.click());
      attachmentInput.addEventListener('change', event => {
        addComposerFiles(event.target.files);
        attachmentInput.value = '';
      });
      composerInput.addEventListener('keydown', event => {
        if (handleCommandSuggestionKeydown(event)) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          document.getElementById('composerForm').requestSubmit();
        }
      });
      composerInput.addEventListener('input', () => {
        renderComposerHighlight();
        scheduleCommandSuggestions();
      });
      composerInput.addEventListener('click', () => {
        renderComposerHighlight();
        scheduleCommandSuggestions();
      });
      composerInput.addEventListener('keyup', renderComposerHighlight);
      composerInput.addEventListener('scroll', syncComposerHighlightScroll);
      composerInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (!commandSuggestions.contains(document.activeElement)) closeCommandSuggestions();
        }, 0);
      });
      renderComposerHighlight();
      modal.querySelectorAll('[data-permission-action]').forEach(button => {
        button.addEventListener('click', () => {
          const pendingPermission = state.pendingPermission;
          if (!pendingPermission) return;
          clearPendingPermission();
          sendWs({
            type: 'permission_response',
            requestId: pendingPermission.requestId,
            action: button.dataset.permissionAction
          });
        });
      });
    }

    async function init() {
      initStaticControls();
      renderLayout();
      if (!state.token) {
        setStatus('Token missing');
        renderNav();
        renderSecondary();
        renderMainView();
        return;
      }
      try {
        const bootstrap = await api('/api/bootstrap');
        handleServerEvent({ type: 'ready', bootstrap });
      } catch (error) {
        setStatus('Bootstrap failed');
        addActivity({ kind: 'error', title: 'Bootstrap failed', detail: error.message, at: Date.now() });
      }
      connectWs();
    }

    init();
  })();
  </script>
</body>
</html>`
}
