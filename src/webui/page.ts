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

    .workspaceView {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 22px max(20px, 4vw);
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
    }

    .miniButton:hover {
      border-color: var(--border-strong);
      background: var(--surface-soft);
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

    .splitFields {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
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
    }

    .listItem.active {
      border-color: #a7d5cf;
      background: var(--accent-soft);
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

      .splitFields {
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
      <button class="navButton active" data-menu="providers" title="模型提供方" aria-label="模型提供方"></button>
      <button class="navButton" data-menu="sessions" title="会话" aria-label="会话"></button>
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
          <label class="srOnly" for="composerInput">向 OpenCat 提问</label>
          <textarea id="composerInput" placeholder="向 OpenCat 提问..." rows="1"></textarea>
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

  <script>
  (() => {
    const iconSvg = {
      "message-square": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>',
      brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9.5 2A3.5 3.5 0 0 0 6 5.5v.2A4 4 0 0 0 4 13a4 4 0 0 0 3.5 6H9V2z"/><path d="M14.5 2A3.5 3.5 0 0 1 18 5.5v.2A4 4 0 0 1 20 13a4 4 0 0 1-3.5 6H15V2z"/><path d="M9 8H7"/><path d="M15 8h2"/><path d="M9 14H7"/><path d="M15 14h2"/></svg>',
      package: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m21 8-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>',
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
        newDraft: false
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
        editing: false
      }
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

    const menuLabels = {
      chat: '对话',
      memory: '记忆',
      assets: '资产',
      providers: '模型提供方',
      sessions: '会话',
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
      return menu === 'memory' || menu === 'assets';
    }

    function renderMainView() {
      const workspaceActive = isWorkspaceMenu(state.activeMenu);
      workspaceView.hidden = !workspaceActive;
      messages.hidden = workspaceActive;
      composer.hidden = workspaceActive;
      if (state.activeMenu === 'memory') {
        renderMemoryWorkspace();
      } else if (state.activeMenu === 'assets') {
        renderAssetsWorkspace();
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
        button.addEventListener('click', () => selectMenu(menu));
      });
    }

    function selectMenu(menu) {
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
      } else {
        secondaryBody.innerHTML = '<div class="ghostState">' + escapeHtml(label) + ' 面板尚未开放。</div>';
      }
    }

    async function refreshMemory() {
      try {
        state.memory.error = '';
        const status = await api('/api/memory/status');
        const files = await api('/api/memory/files');
        state.memory.status = status;
        state.memory.files = files.files || [];
        if (!state.memory.selectedId && state.memory.files.length) {
          state.memory.selectedId = state.memory.files[0].id;
        }
        renderSecondary();
        renderMainView();
        if (state.memory.selectedId && !state.memory.selectedFile && !state.memory.newDraft) {
          await loadMemoryFile(state.memory.selectedId);
        }
      } catch (error) {
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
      const fileButton = file => [
        '<button class="listItem ' + (state.memory.selectedId === file.id ? 'active' : '') + '" data-memory-file="' + escapeHtml(file.id) + '">',
        '<strong>' + escapeHtml(file.title || file.name) + '</strong>',
        '<span>' + escapeHtml(file.relativePath) + '</span>',
        '<span>' + escapeHtml([file.kind, formatBytes(file.sizeBytes), shortTime(file.updatedAt)].filter(Boolean).join(' / ')) + '</span>',
        '</button>'
      ].join('');
      const searchResults = state.memory.searchResults || [];
      secondaryBody.innerHTML = [
        state.memory.error ? '<div class="errorBox">' + escapeHtml(state.memory.error) + '</div>' : '',
        '<div class="profileSummary">',
        status ? [
          '<strong class="summaryLine">' + escapeHtml(status.autoMemoryEnabled ? '自动记忆已启用' : '自动记忆已禁用') + '</strong>',
          '<span class="summaryLine">' + escapeHtml(status.memoryDir || '') + '</span>',
          '<span class="summaryLine">' + escapeHtml((status.memoryFileCount || 0) + ' 个文件 / ' + formatBytes(status.totalBytes || 0)) + '</span>'
        ].join('') : '正在加载记忆状态...',
        '</div>',
        '<div class="toolbarRow">',
        '<button class="miniButton" type="button" data-memory-refresh>刷新</button>',
        '<button class="miniButton" type="button" data-memory-new>新建记忆</button>',
        '</div>',
        '<div class="field"><label for="memorySearch">搜索</label><input id="memorySearch" value="' + escapeHtml(state.memory.search) + '" autocomplete="off"></div>',
        '<button class="secondaryAction" type="button" data-memory-search>搜索记忆</button>',
        searchResults.length ? '<section class="formSection"><div class="sectionHeader"><h3>结果</h3></div><div class="itemList">' + searchResults.map(result => [
          '<button class="listItem" data-memory-file="' + escapeHtml(result.fileId) + '">',
          '<strong>' + escapeHtml(result.relativePath) + '</strong>',
          '<span>' + escapeHtml(result.snippet) + '</span>',
          '</button>'
        ].join('')).join('') + '</div></section>' : '',
        '<section class="formSection"><div class="sectionHeader"><h3>索引</h3></div><div class="itemList">' + indexFiles.map(fileButton).join('') + '</div></section>',
        '<section class="formSection"><div class="sectionHeader"><h3>主题文件</h3></div><div class="itemList">' + (topicFiles.length ? topicFiles.map(fileButton).join('') : '<div class="ghostState">还没有主题记忆。</div>') + '</div></section>',
        dailyLogs.length ? '<section class="formSection"><div class="sectionHeader"><h3>每日日志</h3></div><div class="itemList">' + dailyLogs.map(fileButton).join('') + '</div></section>' : '',
        '<section class="formSection"><div class="sectionHeader"><h3>知识</h3></div><div class="itemList"><button class="listItem ' + (state.memory.selectedId === 'knowledge-graph' ? 'active' : '') + '" data-memory-graph><strong>Knowledge Graph</strong><span>' + escapeHtml(status ? String(status.knowledgeGraphStats.entityCount) + ' 个实体 / ' + String(status.knowledgeGraphStats.summaryCount) + ' 条摘要' : '图谱状态') + '</span></button></div></section>'
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
      secondaryBody.querySelector('[data-memory-refresh]')?.addEventListener('click', () => refreshMemory());
      secondaryBody.querySelector('[data-memory-new]')?.addEventListener('click', () => {
        state.memory.newDraft = true;
        state.memory.selectedId = null;
        state.memory.selectedFile = null;
        state.memory.graph = null;
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
          '<button class="primaryButton" type="submit">创建记忆</button>',
          '</form>'
        ].join('');
        document.getElementById('memoryCreateForm').addEventListener('submit', async event => {
          event.preventDefault();
          try {
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
            await refreshMemory();
          } catch (error) {
            state.memory.error = getErrorMessage(error);
            renderSecondary();
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
      workspaceView.innerHTML = [
        '<div class="workspaceHeader"><div><h2>' + escapeHtml(file.title || file.name) + '</h2><div class="workspaceMeta">' + escapeHtml(file.relativePath) + '</div></div>',
        '<div class="toolbarRow">',
        '<button class="miniButton" type="button" data-memory-save ' + (readonly ? 'disabled' : '') + '>保存</button>',
        file.kind !== 'index' && file.kind !== 'daily-log' ? '<button class="miniButton danger" type="button" data-memory-delete>删除</button>' : '',
        '</div></div>',
        (file.warnings || []).map(warning => '<div class="readonlyNotice">' + escapeHtml(warning) + '</div>').join(''),
        readonly ? '<div class="readonlyNotice">此记忆文件在 Web UI 中为只读。</div>' : '',
        '<div class="workspaceCard">',
        '<div class="tagRow"><span class="tag">' + escapeHtml(file.kind) + '</span><span class="tag">' + escapeHtml(formatBytes(file.sizeBytes)) + '</span><span class="tag">' + escapeHtml(shortTime(file.updatedAt)) + '</span></div>',
        '<div class="field" style="margin-top:12px"><label for="memoryEditor">Markdown</label><textarea id="memoryEditor" class="editorArea" ' + (readonly ? 'readonly' : '') + '>' + escapeHtml(file.content || '') + '</textarea></div>',
        '</div>'
      ].join('');
      workspaceView.querySelector('[data-memory-save]')?.addEventListener('click', async () => {
        try {
          const result = await api('/api/memory/files/' + encodeURIComponent(file.id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: document.getElementById('memoryEditor').value })
          });
          state.memory.selectedFile = result.file;
          await refreshMemory();
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
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
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
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
        summaries: graph.summaries.map(summary => '<tr><td>' + escapeHtml(shortTime(summary.timestamp)) + '</td><td>' + escapeHtml(summary.content) + '</td><td>' + escapeHtml((summary.keywords || []).join(', ')) + '</td></tr>').join(''),
        rules: graph.rules.map(rule => '<tr><td>' + escapeHtml(rule) + '</td></tr>').join('')
      };
      const headers = {
        entities: '<tr><th>类型</th><th>名称</th><th>属性</th></tr>',
        relations: '<tr><th>来源</th><th>类型</th><th>目标</th></tr>',
        summaries: '<tr><th>时间</th><th>内容</th><th>关键词</th></tr>',
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
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
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
        } catch (error) {
          state.memory.error = getErrorMessage(error);
          renderSecondary();
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
        renderSecondary();
        renderMainView();
        if (loadSelected !== false && state.assets.selectedId && !state.assets.selectedAsset && !state.assets.newDraft) {
          await loadAssetDetail(state.assets.selectedId);
        }
      } catch (error) {
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
      secondaryBody.innerHTML = [
        state.assets.error ? '<div class="errorBox">' + escapeHtml(state.assets.error) + '</div>' : '',
        '<div class="profileSummary">',
        '<strong class="summaryLine">' + escapeHtml(String(assets.length)) + ' 个资产</strong>',
        state.assets.roots ? '<span class="summaryLine">用户：' + escapeHtml(state.assets.roots.userSkillsDir || '') + '</span><span class="summaryLine">项目：' + escapeHtml(state.assets.roots.projectSkillsDir || '') + '</span>' : '',
        '</div>',
        '<div class="toolbarRow">',
        '<button class="miniButton" type="button" data-assets-reload>重新加载</button>',
        '<button class="miniButton" type="button" data-assets-new>新建 Skill</button>',
        '<button class="miniButton" type="button" data-assets-import>导入 SKILL.md</button>',
        '<input id="assetImportFile" type="file" accept=".md,text/markdown" hidden>',
        '</div>',
        '<div class="field"><label for="assetSearch">搜索</label><input id="assetSearch" value="' + escapeHtml(state.assets.query) + '" autocomplete="off"></div>',
        '<div class="splitFields">',
        '<div class="field"><label for="assetKind">类型</label><select id="assetKind"><option value="">全部</option>' + kinds.map(kind => '<option value="' + escapeHtml(kind) + '" ' + (state.assets.kind === kind ? 'selected' : '') + '>' + escapeHtml(kind) + '</option>').join('') + '</select></div>',
        '<div class="field"><label for="assetSource">来源</label><select id="assetSource"><option value="">全部</option>' + sources.map(source => '<option value="' + escapeHtml(source) + '" ' + (state.assets.source === source ? 'selected' : '') + '>' + escapeHtml(source) + '</option>').join('') + '</select></div>',
        '</div>',
        '<button class="secondaryAction" type="button" data-assets-filter>应用筛选</button>',
        '<div class="itemList" style="margin-top:14px">',
        assets.length ? assets.map(asset => [
          '<button class="listItem ' + (state.assets.selectedId === asset.id ? 'active' : '') + '" data-asset-id="' + escapeHtml(asset.id) + '">',
          '<strong>' + escapeHtml(asset.displayName || asset.name) + '</strong>',
          '<span>' + escapeHtml(asset.kind + ' / ' + asset.source + (asset.readonly ? ' / 只读' : ' / 可编辑')) + '</span>',
          '<span>' + escapeHtml(asset.description || '') + '</span>',
          '</button>'
        ].join('')).join('') : '<div class="ghostState">没有匹配当前筛选条件的资产。</div>',
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
      secondaryBody.querySelector('[data-assets-reload]')?.addEventListener('click', async () => {
        try {
          await api('/api/assets/reload', { method: 'POST' });
          await refreshAssets(false);
        } catch (error) {
          state.assets.error = getErrorMessage(error);
          renderAssetsPanel();
        }
      });
      secondaryBody.querySelector('[data-assets-new]')?.addEventListener('click', () => {
        state.assets.newDraft = true;
        state.assets.editing = false;
        state.assets.selectedId = null;
        state.assets.selectedAsset = null;
        renderMainView();
      });
      secondaryBody.querySelector('[data-assets-import]')?.addEventListener('click', () => {
        document.getElementById('assetImportFile')?.click();
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
          } catch (error) {
            state.assets.error = getErrorMessage(error);
            renderAssetsPanel();
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
        '<form id="skillForm" class="workspaceCard">',
        isEdit ? '' : '<div class="field"><label for="skillScope">范围</label><select id="skillScope"><option value="project">项目</option><option value="user">用户</option></select></div>',
        isEdit ? '' : '<div class="field"><label for="skillName">名称</label><input id="skillName" autocomplete="off"></div>',
        isEdit ? '' : '<div class="field"><label for="skillDescription">描述</label><input id="skillDescription" autocomplete="off"></div>',
        isEdit ? '' : '<div class="field"><label for="skillWhen">使用时机</label><input id="skillWhen" autocomplete="off"></div>',
        isEdit ? '' : '<div class="splitFields"><div class="field"><label for="skillTools">允许的工具</label><input id="skillTools" autocomplete="off" placeholder="Read, Grep, Bash"></div><div class="field"><label for="skillContext">上下文</label><select id="skillContext"><option value="">未设置</option><option value="inline">Inline</option><option value="fork">Fork</option></select></div></div>',
        isEdit ? '' : '<div class="field"><label for="skillModel">模型</label><input id="skillModel" autocomplete="off" placeholder="inherit"></div>',
        '<div class="field"><label for="skillContent">SKILL.md</label><textarea id="skillContent" class="editorArea">' + escapeHtml(content) + '</textarea></div>',
        '<button class="primaryButton" type="submit">' + (isEdit ? '保存 Skill' : '创建 Skill') + '</button>',
        '</form>'
      ].join('');
      document.getElementById('skillForm').addEventListener('submit', async event => {
        event.preventDefault();
        try {
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
          await refreshAssets(false);
          renderMainView();
        } catch (error) {
          state.assets.error = getErrorMessage(error);
          renderSecondary();
        }
      });
    }

    function renderAssetsWorkspace() {
      if (state.assets.newDraft) {
        renderSkillForm('new');
        return;
      }
      const asset = state.assets.selectedAsset;
      if (!asset) {
        workspaceView.innerHTML = '<div class="workspaceCard ghostState">选择一个资产查看内容。</div>';
        return;
      }
      if (state.assets.editing && !asset.readonly) {
        renderSkillForm('edit', asset);
        return;
      }
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
        '<div class="tagRow"><span class="tag">' + escapeHtml(asset.kind) + '</span><span class="tag">' + escapeHtml(asset.source) + '</span><span class="tag">' + escapeHtml(asset.enabled ? '已启用' : '已禁用') + '</span></div>',
        '<div class="profileSummary" style="margin-top:12px">',
        '<strong class="summaryLine">' + escapeHtml(asset.description || '暂无描述') + '</strong>',
        asset.whenToUse ? '<span class="summaryLine">' + escapeHtml(asset.whenToUse) + '</span>' : '',
        asset.allowedTools?.length ? '<span class="summaryLine">工具：' + escapeHtml(asset.allowedTools.join(', ')) + '</span>' : '',
        asset.model ? '<span class="summaryLine">模型：' + escapeHtml(asset.model) + '</span>' : '',
        asset.context ? '<span class="summaryLine">上下文：' + escapeHtml(asset.context) + '</span>' : '',
        '</div>',
        asset.content !== undefined ? '<div class="field"><label for="assetContent">内容</label><textarea id="assetContent" class="editorArea" readonly>' + escapeHtml(asset.content || '') + '</textarea></div>' : '<div class="ghostState">此资产没有可显示的文件内容。</div>',
        '</div>'
      ].join('');
      workspaceView.querySelector('[data-asset-edit]')?.addEventListener('click', () => {
        state.assets.editing = true;
        renderAssetsWorkspace();
      });
      workspaceView.querySelector('[data-asset-delete]')?.addEventListener('click', async () => {
        if (!confirm('确定删除这个 Skill 吗？')) return;
        try {
          await api('/api/assets/skills/' + encodeURIComponent(asset.id), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirm: true })
          });
          state.assets.selectedId = null;
          state.assets.selectedAsset = null;
          await refreshAssets();
        } catch (error) {
          state.assets.error = getErrorMessage(error);
          renderSecondary();
          renderMainView();
        }
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

    function renderChatPanel() {
      const sessions = state.bootstrap?.chatSessions || [];
      if (!sessions.length) {
        secondaryBody.innerHTML = '<div class="ghostState">还没有对话。点击加号按钮开始一个新对话。</div>';
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
      avatar.textContent = role === 'user' ? '你' : 'OC';
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
      row.innerHTML = '<strong>' + escapeHtml(tool.name || '工具') + '</strong><span>' + escapeHtml(localizeStatus(tool.status || '')) + '</span><span>' + escapeHtml(tool.summary || '') + '</span>';
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function addActivity(activity) {
      const item = document.createElement('div');
      item.className = 'activityItem';
      const time = activity.at ? new Date(activity.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      item.innerHTML = '<div class="activityItemTitle"><span>' + escapeHtml(localizeCommonText(activity.title || activity.kind || 'Activity')) + '</span><span>' + escapeHtml(time) + '</span></div>' +
        (activity.detail ? '<div class="activityDetail">' + escapeHtml(localizeCommonText(activity.detail)) + '</div>' : '');
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
