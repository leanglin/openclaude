import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  Home,
  Info,
  Play,
  RotateCw,
  Save,
  Settings,
  Square,
  Terminal,
  X,
} from 'lucide-react'
import opencatIconUrl from '../../src/webui/assets/opencat.ico'
import './styles.css'

type LauncherStatus = 'stopped' | 'starting' | 'ready' | 'stopping' | 'error'

type ActivityEntry = {
  level: 'info' | 'success' | 'error' | string
  message: string
  at: number
}

type AdbStatus = {
  configuredPath?: string | null
  resolvedPath?: string | null
  available: boolean
  message: string
}

type UpdateStatus = {
  status: 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'error' | string
  latestVersion?: string | null
  fileName?: string | null
  fileSizeDisplay?: string | null
  releaseNotes?: string | null
  downloadProgress?: number | null
  downloadPath?: string | null
  error?: string | null
}

type LauncherSnapshot = {
  status: LauncherStatus
  webUrl?: string | null
  version: string
  adb: AdbStatus
  lastError?: string | null
  activity: ActivityEntry[]
  update: UpdateStatus
}

const initialSnapshot: LauncherSnapshot = {
  status: 'stopped',
  webUrl: null,
  version: '7.0.0',
  adb: {
    configuredPath: null,
    resolvedPath: null,
    available: false,
    message: 'ADB not checked',
  },
  lastError: null,
  activity: [],
  update: {
    status: 'idle',
  },
}

function isTauriUnavailable(error: unknown): boolean {
  const message = String(error)
  return message.includes('__TAURI_INTERNALS__') || message.includes("undefined (reading 'invoke')")
}

async function callLauncher<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    if (isTauriUnavailable(error)) {
      return {
        ...initialSnapshot,
        activity: [
          {
            level: 'info',
            message: 'OpenCat launcher preview',
            at: Date.now(),
          },
        ],
      } as T
    }
    throw error
  }
}

function statusLabel(status: LauncherStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'starting':
      return 'Starting'
    case 'stopping':
      return 'Stopping'
    case 'error':
      return 'Error'
    default:
      return 'Stopped'
  }
}

function statusTone(status: LauncherStatus): string {
  if (status === 'ready') return 'ready'
  if (status === 'error') return 'error'
  if (status === 'starting' || status === 'stopping') return 'busy'
  return 'stopped'
}

function updateButtonLabel(update: UpdateStatus): string {
  if (update.status === 'checking') return 'Checking...'
  if (update.status === 'downloading') {
    return typeof update.downloadProgress === 'number'
      ? `Downloading ${Math.round(update.downloadProgress)}%`
      : 'Downloading...'
  }
  return 'Check for updates'
}

function clippedReleaseNotes(value?: string | null): string {
  const notes = String(value || '').trim()
  return notes.length > 800 ? `${notes.slice(0, 800)}...` : notes
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function StatusDot({ tone }: { tone: string }) {
  return <span className={`statusDot ${tone}`} aria-hidden="true" />
}

function IconButton({
  active,
  children,
  label,
}: {
  active?: boolean
  children: React.ReactNode
  label: string
}) {
  return (
    <button className={`railButton ${active ? 'active' : ''}`} aria-label={label} title={label}>
      {children}
    </button>
  )
}

function ActionButton({
  variant = 'secondary',
  disabled,
  icon,
  label,
  onClick,
}: {
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className={`actionButton ${variant}`} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function MetricColumn({
  title,
  tone,
  status,
  detail,
  link,
}: {
  title: string
  tone: string
  status: string
  detail: string
  link?: string | null
}) {
  return (
    <section className="metricColumn">
      <h2>{title}</h2>
      <div className="metricStatus">
        <StatusDot tone={tone} />
        <span>{status}</span>
      </div>
      {link ? (
        <button className="linkButton" onClick={() => window.open(link)}>
          <span>{link}</span>
          <ExternalLink size={16} />
        </button>
      ) : (
        <p>{detail}</p>
      )}
    </section>
  )
}

function UpdatePanel({
  currentVersion,
  dismissedVersion,
  onDismiss,
  onDownload,
  update,
}: {
  currentVersion: string
  dismissedVersion: string | null
  onDismiss: (version: string | null) => void
  onDownload: () => void
  update: UpdateStatus
}) {
  const latestVersion = update.latestVersion || null
  const notes = clippedReleaseNotes(update.releaseNotes)
  const showAvailable = update.status === 'available' && latestVersion && dismissedVersion !== latestVersion
  const showDownloaded = update.status === 'downloaded' && update.downloadPath
  const showError = update.status === 'error' && update.error

  if (!showAvailable && !showDownloaded && !showError) return null

  return (
    <section className={`updatePanel ${showError ? 'error' : ''}`}>
      <div className="updatePanelHeader">
        <div>
          <h2>
            {showAvailable
              ? 'OpenCat update available'
              : showDownloaded
                ? 'Update downloaded'
                : 'Update check failed'}
          </h2>
          <p>
            {showAvailable
              ? `Current ${currentVersion} · Latest ${latestVersion}`
              : showDownloaded
                ? update.downloadPath
                : update.error}
          </p>
        </div>
        {showAvailable ? (
          <button
            className="iconOnlyButton"
            aria-label="Dismiss update"
            title="Dismiss update"
            onClick={() => onDismiss(latestVersion)}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {showAvailable ? (
        <>
          <dl className="updateDetails">
            <div>
              <dt>Installer</dt>
              <dd>{update.fileName || 'OpenCat_Setup.exe'}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{update.fileSizeDisplay || 'Unknown'}</dd>
            </div>
          </dl>
          {notes ? <p className="updateNotes">{notes}</p> : null}
          <div className="updatePanelActions">
            <button className="iconTextButton compact" onClick={onDownload}>
              <Download size={18} />
              <span>Download installer</span>
            </button>
          </div>
        </>
      ) : null}

      {showDownloaded ? (
        <p className="updateNotes">Run the downloaded installer manually to complete the update.</p>
      ) : null}
    </section>
  )
}

function App() {
  const [snapshot, setSnapshot] = useState<LauncherSnapshot>(initialSnapshot)
  const [adbPath, setAdbPath] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    const next = await callLauncher<LauncherSnapshot>('get_status')
    setSnapshot(next)
    setAdbPath(current => current || next.adb.configuredPath || '')
  }, [])

  useEffect(() => {
    void refreshStatus()
    const timer = window.setInterval(() => void refreshStatus(), 1500)
    return () => window.clearInterval(timer)
  }, [refreshStatus])

  const runAction = useCallback(async (command: string, args?: Record<string, unknown>) => {
    setBusyAction(command)
    try {
      const next = await callLauncher<LauncherSnapshot>(command, args)
      setSnapshot(next)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSnapshot(current => ({
        ...current,
        status: 'error',
        lastError: message,
        activity: [
          { level: 'error', message, at: Date.now() },
          ...current.activity,
        ].slice(0, 80),
      }))
    } finally {
      setBusyAction(null)
    }
  }, [])

  const tone = statusTone(snapshot.status)
  const canStart = snapshot.status === 'stopped' || snapshot.status === 'error'
  const canStop = snapshot.status === 'starting' || snapshot.status === 'ready'
  const canOpen = snapshot.status === 'ready' && Boolean(snapshot.webUrl)
  const midsceneReady = snapshot.adb.available || snapshot.status === 'ready'
  const updateBusy = snapshot.update.status === 'checking' || snapshot.update.status === 'downloading'

  const providerDetail = useMemo(() => {
    if (snapshot.status === 'ready') return 'OpenCat local profile'
    if (snapshot.status === 'error') return snapshot.lastError || 'Needs attention'
    return 'Waiting for local service'
  }, [snapshot.lastError, snapshot.status])

  return (
    <main className="appShell">
      <aside className="sideRail" aria-label="OpenCat sections">
        <div className="railBrand"><img src={opencatIconUrl} alt="" aria-hidden="true" /></div>
        <IconButton active label="Home"><Home size={25} /></IconButton>
        <IconButton label="Settings"><Settings size={25} /></IconButton>
        <IconButton label="Metrics"><BarChart3 size={25} /></IconButton>
        <IconButton label="Console"><Terminal size={25} /></IconButton>
        <div className="railSpacer" />
        <IconButton label="About"><Info size={25} /></IconButton>
      </aside>

      <section className="content">
        <header className="heroRow">
          <div>
            <div className="brandLine">
              <h1>OpenCat</h1>
              <span>{snapshot.version}</span>
            </div>
            <div className="serviceState">
              <StatusDot tone={tone} />
              <strong>{statusLabel(snapshot.status)}</strong>
            </div>
            <p className="stateText">
              {snapshot.status === 'ready'
                ? 'OpenCat is running and ready.'
                : snapshot.status === 'starting'
                  ? 'OpenCat is starting.'
                  : snapshot.status === 'error'
                    ? snapshot.lastError || 'OpenCat needs attention.'
                    : 'OpenCat is stopped.'}
            </p>
          </div>

          <div className="primaryActions">
            <ActionButton
              variant="primary"
              disabled={!canStart || busyAction !== null}
              icon={<Play size={25} fill="currentColor" />}
              label={snapshot.status === 'ready' ? 'OpenCat Ready' : 'Start OpenCat'}
              onClick={() => void runAction('start_opencat')}
            />
            <ActionButton
              disabled={!canOpen || busyAction !== null}
              icon={<ExternalLink size={24} />}
              label="Open Web"
              onClick={() => void runAction('open_web_window')}
            />
            <div className="secondaryActions">
              <ActionButton
                disabled={!canStop || busyAction !== null}
                icon={<Square size={20} />}
                label="Stop"
                onClick={() => void runAction('stop_opencat')}
              />
              <ActionButton
                disabled={busyAction !== null}
                icon={<RotateCw size={21} />}
                label="Restart"
                onClick={() => void runAction('restart_opencat')}
              />
            </div>
          </div>
        </header>

        <div className="divider" />

        <section className="metricsGrid">
          <MetricColumn
            title="Local Web"
            tone={canOpen ? 'ready' : tone}
            status={canOpen ? 'Ready' : statusLabel(snapshot.status)}
            detail={snapshot.status === 'stopped' ? 'Not running' : 'Waiting for local URL'}
            link={snapshot.webUrl}
          />
          <MetricColumn
            title="Midscene"
            tone={midsceneReady ? 'ready' : 'stopped'}
            status={midsceneReady ? 'Ready' : 'ADB pending'}
            detail={snapshot.adb.message}
          />
          <MetricColumn
            title="Provider"
            tone={snapshot.status === 'ready' ? 'ready' : 'stopped'}
            status={snapshot.status === 'ready' ? 'Ready' : 'Waiting'}
            detail={providerDetail}
          />
        </section>

        <div className="divider" />

        <section className="settingsRow">
          <div className="settingGroup">
            <label htmlFor="adbPath">ADB path</label>
            <div className="inputRow">
              <input
                id="adbPath"
                value={adbPath}
                onChange={event => setAdbPath(event.target.value)}
                placeholder={snapshot.adb.resolvedPath || 'adb'}
              />
              <button
                className="iconTextButton"
                disabled={busyAction !== null}
                onClick={() => void runAction('save_adb_path', { adbPath })}
              >
                <Save size={18} />
                <span>Save</span>
              </button>
            </div>
          </div>
          <button
            className="iconTextButton updateButton"
            disabled={busyAction !== null || updateBusy}
            onClick={() => void runAction('check_updates')}
          >
            {snapshot.update.status === 'downloading' ? <Download size={19} /> : <CheckCircle2 size={19} />}
            <span>{updateButtonLabel(snapshot.update)}</span>
          </button>
        </section>

        <UpdatePanel
          currentVersion={snapshot.version}
          dismissedVersion={dismissedUpdateVersion}
          onDismiss={setDismissedUpdateVersion}
          onDownload={() => void runAction('download_update')}
          update={snapshot.update}
        />

        <section className="activityPanel">
          <div className="sectionTitle">
            <h2>Activity</h2>
            <Activity size={20} />
          </div>
          <div className="activityList">
            {snapshot.activity.length ? snapshot.activity.map((entry, index) => (
              <div className="activityItem" key={`${entry.at}-${index}`}>
                <StatusDot tone={entry.level === 'error' ? 'error' : entry.level === 'success' ? 'ready' : 'stopped'} />
                <time>{formatTime(entry.at)}</time>
                <span>{entry.message}</span>
              </div>
            )) : (
              <div className="activityItem empty">
                <StatusDot tone="stopped" />
                <time>--:--:--</time>
                <span>No activity yet</span>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
