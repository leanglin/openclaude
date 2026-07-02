export function renderWebUiPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenCat Web</title>
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
      --danger: #b73b48;
      --coral: #c7563f;
      --indigo: #4757a6;
      --shadow: 0 18px 45px rgba(23, 33, 38, 0.08);
      --rail: 56px;
      --secondary: 300px;
      --activity: 280px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }
    html, body, #app { width: 100%; height: 100%; margin: 0; }
    body {
      color: var(--text);
      background: var(--bg);
      overflow: hidden;
    }

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

    .shell {
      height: 100%;
      display: grid;
      grid-template-columns: var(--rail) var(--secondary) minmax(0, 1fr) var(--activity);
      grid-template-rows: 100%;
      transition: grid-template-columns 180ms ease;
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
    }

    .navButton.active {
      background: #e7f4f1;
      color: #0b514c;
    }

    .navButton svg, .iconButton svg {
      width: 19px;
      height: 19px;
      stroke-width: 2;
    }

    .secondary {
      min-width: 0;
      border-right: 1px solid var(--border);
      background: var(--surface);
      overflow: hidden;
      transition: opacity 160ms ease;
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
    }

    .chat {
      min-width: 0;
      display: flex;
      flex-direction: column;
      background: var(--bg);
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
    }

    .primaryButton:hover { background: #253438; }

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
    }

    .empty {
      margin: auto;
      width: min(520px, 100%);
      text-align: center;
      color: var(--muted);
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

    .message.user .bubble {
      background: #f0f2ff;
      border-color: #ced4f2;
    }

    .toolRow {
      max-width: 900px;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 34px;
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfbf9;
      color: var(--muted);
      font-size: 13px;
      overflow: hidden;
    }

    .toolRow strong {
      color: var(--text);
      font-weight: 700;
    }

    .composer {
      padding: 14px 18px 18px;
      border-top: 1px solid var(--border);
      background: rgba(255,255,255,0.86);
      backdrop-filter: blur(16px);
    }

    .composerBox {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 40px;
      gap: 10px;
      max-width: 980px;
      margin: 0 auto;
      align-items: end;
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
      box-shadow: 0 0 0 3px rgba(20,125,116,0.16);
    }

    .sendButton {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: var(--accent);
      color: white;
    }

    .sendButton:hover { background: #0f6962; }

    .activity {
      border-left: 1px solid var(--border);
      background: #faf8f3;
      overflow: hidden;
      min-width: 0;
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

    .activityDetail {
      margin-top: 4px;
      color: var(--muted);
      overflow-wrap: anywhere;
      line-height: 18px;
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
      padding: 0 10px;
      color: var(--text);
      background: var(--surface);
      outline: none;
      min-width: 0;
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
    }

    .ghostState {
      color: var(--muted);
      padding: 22px 4px;
      line-height: 21px;
      font-size: 14px;
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
    }

    .sessionItem.active {
      border-color: #a7d5cf;
      background: var(--accent-soft);
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
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(16,25,29,0.36);
      padding: 20px;
      z-index: 20;
    }

    .permissionModal.open {
      display: flex;
    }

    .permissionBox {
      width: min(520px, 100%);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      padding: 18px;
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
    <nav class="rail" aria-label="Primary">
      <div class="railBrand"><img src="/assets/opencat.ico" alt=""></div>
      <button class="navButton" data-menu="chat" title="Chat" aria-label="Chat"></button>
      <button class="navButton active" data-menu="providers" title="Providers" aria-label="Providers"></button>
      <button class="navButton" data-menu="sessions" title="Sessions" aria-label="Sessions"></button>
      <button class="navButton" data-menu="tools" title="Tools" aria-label="Tools"></button>
      <button class="navButton" data-menu="settings" title="Settings" aria-label="Settings"></button>
    </nav>

    <aside class="secondary" aria-label="Secondary">
      <div class="secondaryInner">
        <div class="panelHeader">
          <h2 id="secondaryTitle">Providers</h2>
          <button id="secondaryCollapse" class="iconButton" title="Collapse panel" aria-label="Collapse panel"></button>
        </div>
        <div id="secondaryBody" class="panelBody"></div>
      </div>
    </aside>

    <main class="chat">
      <header class="topbar">
        <div class="brand">
          <button id="secondaryExpand" class="iconButton" title="Show panel" aria-label="Show panel"></button>
          <img src="/assets/opencat.ico" alt="">
          <h1>OpenCat Web</h1>
        </div>
        <div class="topMeta">
          <span class="pill"><span id="statusDot" class="dot"></span><span id="statusText">Ready</span></span>
          <span id="providerSummary" class="pill">No provider profile</span>
          <button id="stopSession" class="primaryButton" title="Stop" aria-label="Stop" disabled hidden></button>
          <button id="newChat" class="primaryButton" title="New chat" aria-label="New chat"></button>
        </div>
      </header>

      <section id="messages" class="messages" aria-live="polite">
        <div id="emptyState" class="empty">
          <div class="emptyTitle">Ask OpenCat anything</div>
          <div>Configure a provider, then start a local chat session.</div>
        </div>
      </section>

      <footer class="composer">
        <form id="composerForm" class="composerBox">
          <label class="srOnly" for="composerInput">Ask OpenCat</label>
          <textarea id="composerInput" placeholder="Ask OpenCat..." rows="1"></textarea>
          <button id="sendButton" class="sendButton" title="Send" aria-label="Send"></button>
        </form>
      </footer>
    </main>

    <aside id="activityPanel" class="activity" aria-label="Activity">
      <div class="activityInner">
        <div class="panelHeader">
          <h2 class="activityTitle">Activity</h2>
          <button id="activityCollapse" class="iconButton" title="Collapse activity" aria-label="Collapse activity"></button>
        </div>
        <div id="activityList" class="activityList"></div>
      </div>
    </aside>
  </div>

  <div id="permissionModal" class="permissionModal" role="dialog" aria-modal="true" aria-labelledby="permissionTitle">
    <div class="permissionBox">
      <h3 id="permissionTitle">Permission requested</h3>
      <div id="permissionPrompt" class="profileSummary"></div>
      <div id="permissionPreview" class="permissionPreview"></div>
      <div class="permissionActions">
        <button class="dangerButton" data-permission-action="deny">Deny</button>
        <button class="textButton" data-permission-action="allow-session">Allow and remember</button>
        <button class="allowButton" data-permission-action="allow">Allow once</button>
      </div>
    </div>
  </div>

  <script>
  (() => {
    const iconSvg = {
      "message-square": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
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
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>'
    };

    const app = document.getElementById('app');
    const messages = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
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
    const stopSession = document.getElementById('stopSession');

    const state = {
      token: getToken(),
      ws: null,
      bootstrap: null,
      activeChatSessionId: null,
      requestedStoredSession: false,
      activeMenu: 'providers',
      secondaryCollapsed: false,
      activityCollapsed: false,
      running: false,
      stopping: false,
      streams: new Map(),
      pendingPermission: null,
      providerEditorOpen: { chat: false, midscene: false }
    };

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

    function setStatus(text) {
      statusText.textContent = text;
    }

    function updateStopControl() {
      const visible = state.running || Boolean(state.pendingPermission);
      stopSession.hidden = !visible;
      stopSession.disabled = !visible || state.stopping;
    }

    function setRunning(running) {
      state.running = running;
      if (!running) state.stopping = false;
      updateStopControl();
    }

    function clearPendingPermission() {
      state.pendingPermission = null;
      modal.classList.remove('open');
      updateStopControl();
    }

    function setProviderSummary(profile) {
      if (!profile) {
        providerSummary.textContent = 'No provider profile';
        return;
      }
      providerSummary.textContent = [profile.displayName, profile.model].filter(Boolean).join(' / ');
    }

    function authHeaders(extra) {
      return Object.assign({ Authorization: 'Bearer ' + state.token }, extra || {});
    }

    async function api(path, options) {
      if (!state.token) throw new Error('Missing local session token.');
      const response = await fetch(path, Object.assign({}, options || {}, {
        headers: authHeaders((options && options.headers) || {})
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Request failed.');
      return data;
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
        button.addEventListener('click', () => selectMenu(menu));
      });
    }

    function selectMenu(menu) {
      state.activeMenu = menu;
      state.secondaryCollapsed = false;
      renderLayout();
      renderSecondary();
      renderNav();
    }

    function renderLayout() {
      app.classList.toggle('secondaryCollapsed', state.secondaryCollapsed);
      app.classList.toggle('activityCollapsed', state.activityCollapsed);
      activityPanel.classList.toggle('activityCollapsed', state.activityCollapsed);
    }

    function renderSecondary() {
      const label = state.bootstrap?.primaryMenus?.find(item => item.id === state.activeMenu)?.label || 'Providers';
      secondaryTitle.textContent = label;
      if (state.activeMenu === 'providers') {
        renderProviderPanel();
      } else if (state.activeMenu === 'chat') {
        renderChatPanel();
      } else {
        secondaryBody.innerHTML = '<div class="ghostState">' + escapeHtml(label) + ' is ready for a future panel.</div>';
      }
    }

    function formatSessionTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    function renderChatPanel() {
      const sessions = state.bootstrap?.chatSessions || [];
      if (!sessions.length) {
        secondaryBody.innerHTML = '<div class="ghostState">No chats yet. Use the plus button to start one.</div>';
        return;
      }
      secondaryBody.innerHTML = [
        '<div class="sessionList">',
        sessions.map(session => [
          '<div class="sessionItem ' + (session.id === state.activeChatSessionId ? 'active' : '') + '" data-chat-session="' + escapeHtml(session.id) + '">',
          '<button class="sessionSelect" type="button" data-select-session="' + escapeHtml(session.id) + '">',
          '<span class="sessionTitle">' + escapeHtml(session.title || 'New chat') + '</span>',
          '<span class="sessionTime">' + escapeHtml(formatSessionTime(session.updatedAt)) + '</span>',
          '</button>',
          '<button class="sessionDelete" type="button" title="Delete chat" aria-label="Delete chat" data-delete-session="' + escapeHtml(session.id) + '">' + iconSvg.trash + '</button>',
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
            '<strong class="summaryLine">' + escapeHtml(current.displayName || 'Chat provider') + '</strong>',
            summaryLine(current.model || 'Model not set'),
            summaryLine(current.baseUrl || 'Base URL not set'),
            summaryLine(current.credentialConfigured ? 'API key configured' : 'API key not configured')
          ].join('')
        : 'No provider profile saved.';
      const midsceneSummary = midscene
        ? [
            '<strong class="summaryLine">' + escapeHtml(midscene.model || 'Midscene model') + '</strong>',
            summaryLine(midscene.baseUrl || 'Base URL not set'),
            summaryLine(midscene.modelFamily || 'Model family not set'),
            summaryLine(midscene.credentialConfigured ? 'API key configured' : 'API key not configured')
          ].join('')
        : 'No Midscene profile saved.';
      const sectionToggle = (section, expanded, hasSavedProfile) => hasSavedProfile
        ? '<button class="sectionToggle" type="button" data-provider-section="' + section + '" aria-expanded="' + String(expanded) + '">' + (expanded ? 'Collapse' : 'Edit') + '</button>'
        : '';
      secondaryBody.innerHTML = [
        '<form id="providerForm">',
        '<section class="formSection">',
        '<div class="sectionHeader"><h3>Chat provider</h3>' + sectionToggle('chat', chatExpanded, Boolean(current)) + '</div>',
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
        '<div class="sectionHeader"><h3>Midscene App Test</h3>' + sectionToggle('midscene', midsceneExpanded, Boolean(midscene)) + '</div>',
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
        '<button class="secondaryAction" type="submit">Save configuration</button>',
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
        apiKey.placeholder = selectedSavedProvider ? 'Saved' : option?.requiresApiKey ? 'Required unless local' : 'Not required';
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
      midsceneApiKey.placeholder = midscene?.credentialConfigured ? 'Saved' : 'Optional';

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
        addMessage(message.role || 'assistant', message.content || '', message.messageId || ('restored-' + Date.now() + '-' + Math.random()));
      });
      if ((loadedMessages || []).length) {
        emptyState.style.display = 'none';
      }
    }

    function addMessage(role, content, id) {
      emptyState.style.display = 'none';
      const message = document.createElement('article');
      message.className = 'message ' + role;
      message.dataset.messageId = id;
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = role === 'user' ? 'You' : 'OC';
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = content;
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

    function ensureStream(id) {
      let bubble = state.streams.get(id);
      if (!bubble) {
        bubble = addMessage('assistant', '', id);
        state.streams.set(id, bubble);
      }
      return bubble;
    }

    function addToolRow(tool) {
      emptyState.style.display = 'none';
      const row = document.createElement('div');
      row.className = 'toolRow';
      row.innerHTML = '<strong>' + escapeHtml(tool.name || 'Tool') + '</strong><span>' + escapeHtml(tool.status || '') + '</span><span>' + escapeHtml(tool.summary || '') + '</span>';
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function addActivity(activity) {
      const item = document.createElement('div');
      item.className = 'activityItem';
      const time = activity.at ? new Date(activity.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      item.innerHTML = '<div class="activityItemTitle"><span>' + escapeHtml(activity.title || activity.kind || 'Activity') + '</span><span>' + escapeHtml(time) + '</span></div>' +
        (activity.detail ? '<div class="activityDetail">' + escapeHtml(activity.detail) + '</div>' : '');
      activityList.prepend(item);
      while (activityList.children.length > 80) activityList.lastChild.remove();
    }

    function showPermission(request) {
      state.pendingPermission = request;
      const toolName = request.toolName || 'Tool permission';
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
        bubble.textContent += event.delta || '';
        messages.scrollTop = messages.scrollHeight;
      } else if (event.type === 'stream_end') {
        const bubble = ensureStream(event.messageId);
        if (event.content) bubble.textContent = event.content;
        state.streams.delete(event.messageId);
      } else if (event.type === 'chat_message') {
        const existing = messages.querySelector('[data-message-id="' + CSS.escape(event.messageId) + '"] .bubble');
        if (existing) existing.textContent = event.content || '';
        else addMessage(event.role || 'assistant', event.content || '', event.messageId);
      } else if (event.type === 'tool') {
        addToolRow(event);
      } else if (event.type === 'permission_request') {
        showPermission(event.request);
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
        if (!text) return;
        addMessage('user', text, 'user-' + Date.now());
        composerInput.value = '';
        setRunning(true);
        sendWs({ type: 'send_message', text });
      });
      composerInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          document.getElementById('composerForm').requestSubmit();
        }
      });
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
