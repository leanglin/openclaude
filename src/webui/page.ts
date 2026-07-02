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

    #newChat {
      width: 34px;
      padding: 0;
      justify-content: center;
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
    }

    .profileSummary strong {
      color: var(--text);
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
          <button id="newChat" class="primaryButton"></button>
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
        <button class="textButton" data-permission-action="allow-session">Allow session</button>
        <button class="allowButton" data-permission-action="allow">Allow</button>
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
      send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>'
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

    const state = {
      token: getToken(),
      ws: null,
      bootstrap: null,
      activeMenu: 'providers',
      secondaryCollapsed: false,
      activityCollapsed: false,
      streams: new Map(),
      pendingPermission: null
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
      state.ws.addEventListener('close', () => setStatus('Disconnected'));
      state.ws.addEventListener('error', () => setStatus('Connection error'));
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
        secondaryBody.innerHTML = '<div class="ghostState">Current chat controls will appear here.</div>';
      } else {
        secondaryBody.innerHTML = '<div class="ghostState">' + escapeHtml(label) + ' is ready for a future panel.</div>';
      }
    }

    function renderProviderPanel() {
      const providers = state.bootstrap?.providers || [];
      const current = state.bootstrap?.profile;
      secondaryBody.innerHTML = [
        '<div class="profileSummary" id="profileSummaryBox">',
        current ? '<strong>' + escapeHtml(current.displayName) + '</strong><br>' + escapeHtml(current.model || '') + '<br>' + escapeHtml(current.baseUrl || '') : 'No provider profile saved.',
        '</div>',
        '<form id="providerForm">',
        '<div class="field"><label for="providerSelect">Provider</label><select id="providerSelect">',
        providers.map(provider => '<option value="' + escapeHtml(provider.id) + '">' + escapeHtml(provider.label) + '</option>').join(''),
        '</select></div>',
        '<div class="field"><label for="providerBaseUrl">Base URL</label><input id="providerBaseUrl" autocomplete="off"></div>',
        '<div class="field"><label for="providerModel">Model</label><input id="providerModel" autocomplete="off"></div>',
        '<div class="field"><label for="providerApiKey">API key</label><input id="providerApiKey" type="password" autocomplete="off"></div>',
        '<button class="secondaryAction" type="submit">Save provider</button>',
        '</form>'
      ].join('');

      const select = document.getElementById('providerSelect');
      const baseUrl = document.getElementById('providerBaseUrl');
      const model = document.getElementById('providerModel');
      const apiKey = document.getElementById('providerApiKey');
      const updateDefaults = () => {
        const option = providers.find(provider => provider.id === select.value);
        baseUrl.value = option?.defaultBaseUrl || '';
        model.value = option?.defaultModel || '';
        apiKey.placeholder = option?.requiresApiKey ? 'Required unless local' : 'Not required';
      };
      select.addEventListener('change', updateDefaults);
      updateDefaults();

      document.getElementById('providerForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
          const result = await api('/api/provider-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: select.value,
              baseUrl: baseUrl.value,
              model: model.value,
              apiKey: apiKey.value
            })
          });
          apiKey.value = '';
          state.bootstrap.profile = result.profile;
          setProviderSummary(result.profile);
          renderProviderPanel();
          addActivity({ kind: 'status', title: 'Provider saved', detail: result.profile.displayName, at: Date.now() });
        } catch (error) {
          addActivity({ kind: 'error', title: 'Provider save failed', detail: error.message, at: Date.now() });
        }
      });
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
      permissionPrompt.textContent = request.prompt || request.toolName || 'Tool permission';
      permissionPreview.textContent = JSON.stringify(request.input || {}, null, 2);
      modal.classList.add('open');
    }

    function handleServerEvent(event) {
      if (event.type === 'ready') {
        state.bootstrap = event.bootstrap;
        setProviderSummary(event.bootstrap.profile);
        renderNav();
        renderSecondary();
      } else if (event.type === 'status') {
        setStatus(event.status || 'Ready');
        if (event.detail) addActivity({ kind: 'status', title: event.status, detail: event.detail, at: Date.now() });
      } else if (event.type === 'activity') {
        addActivity(event.activity);
      } else if (event.type === 'stream_start') {
        ensureStream(event.messageId);
        setStatus('Running');
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
      }
    }

    function initStaticControls() {
      setIcon('secondaryCollapse', 'chevronLeft');
      setIcon('secondaryExpand', 'chevronRight');
      setIcon('activityCollapse', 'panelRight');
      setIcon('newChat', 'plus');
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
        messages.querySelectorAll('.message, .toolRow').forEach(node => node.remove());
        emptyState.style.display = '';
        state.streams.clear();
      });
      document.getElementById('composerForm').addEventListener('submit', event => {
        event.preventDefault();
        const text = composerInput.value.trim();
        if (!text) return;
        addMessage('user', text, 'user-' + Date.now());
        composerInput.value = '';
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
          if (!state.pendingPermission) return;
          sendWs({
            type: 'permission_response',
            requestId: state.pendingPermission.requestId,
            action: button.dataset.permissionAction
          });
          state.pendingPermission = null;
          modal.classList.remove('open');
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
