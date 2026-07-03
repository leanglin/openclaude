use serde::Serialize;
use std::{
  fs,
  io::{BufRead, BufReader},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{Arc, Mutex},
  thread,
  time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
  path::BaseDirectory, AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

type SharedState = Arc<Mutex<LauncherState>>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivityEntry {
  level: String,
  message: String,
  at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdbStatus {
  configured_path: Option<String>,
  resolved_path: Option<String>,
  available: bool,
  message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSnapshot {
  status: String,
  web_url: Option<String>,
  version: String,
  adb: AdbStatus,
  last_error: Option<String>,
  activity: Vec<ActivityEntry>,
}

struct LauncherState {
  status: String,
  web_url: Option<String>,
  child: Option<Child>,
  adb_path: Option<String>,
  last_error: Option<String>,
  activity: Vec<ActivityEntry>,
}

impl Default for LauncherState {
  fn default() -> Self {
    Self {
      status: "stopped".to_string(),
      web_url: None,
      child: None,
      adb_path: None,
      last_error: None,
      activity: Vec::new(),
    }
  }
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis() as u64)
    .unwrap_or_default()
}

fn push_activity(state: &mut LauncherState, level: &str, message: impl Into<String>) {
  state.activity.insert(
    0,
    ActivityEntry {
      level: level.to_string(),
      message: message.into(),
      at: now_ms(),
    },
  );
  state.activity.truncate(80);
}

fn resource_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
  if let Ok(path) = app
    .path()
    .resolve("opencat-runtime", BaseDirectory::Resource)
  {
    if path.exists() {
      return Ok(path);
    }
  }

  let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("resources")
    .join("opencat-runtime");
  if dev_path.exists() {
    return Ok(dev_path);
  }

  Err("OpenCat runtime resources are missing. Run opencat:prepare-runtime before building the launcher.".to_string())
}

fn bundled_node_path(runtime_dir: &Path) -> PathBuf {
  if cfg!(windows) {
    runtime_dir.join("node").join("node.exe")
  } else {
    runtime_dir.join("node").join("bin").join("node")
  }
}

fn runtime_cli_path(runtime_dir: &Path) -> PathBuf {
  runtime_dir.join("dist").join("cli.mjs")
}

fn app_test_runner_path(runtime_dir: &Path) -> PathBuf {
  runtime_dir
    .join("packages")
    .join("app-test-runner")
    .join("dist")
    .join("cli.js")
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
  use std::os::windows::process::CommandExt;
  command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

fn open_web_window_with_url(app: &AppHandle, url: &str) -> Result<(), String> {
  if let Some(window) = app.get_webview_window("opencat-web") {
    window.set_focus().map_err(|error| error.to_string())?;
    return Ok(());
  }

  let parsed = url.parse().map_err(|error| format!("Invalid Web URL: {error}"))?;
  WebviewWindowBuilder::new(app, "opencat-web", WebviewUrl::External(parsed))
    .title("OpenCat Web")
    .inner_size(1280.0, 820.0)
    .min_inner_size(900.0, 620.0)
    .build()
    .map_err(|error| error.to_string())?;
  Ok(())
}

fn saved_adb_path_file(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  Ok(dir.join("adb-path.txt"))
}

fn load_saved_adb_path(app: &AppHandle) -> Option<String> {
  let path = saved_adb_path_file(app).ok()?;
  fs::read_to_string(path)
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn resolve_adb_candidate(saved: Option<&str>) -> Option<String> {
  saved
    .filter(|value| !value.trim().is_empty())
    .map(|value| value.trim().to_string())
    .or_else(|| std::env::var("OPENCAT_ADB_PATH").ok())
    .or_else(|| std::env::var("ADB_PATH").ok())
    .or_else(|| {
      std::env::var("ANDROID_HOME")
        .ok()
        .map(|root| format!("{root}/platform-tools/adb.exe"))
    })
    .or_else(|| {
      std::env::var("ANDROID_SDK_ROOT")
        .ok()
        .map(|root| format!("{root}/platform-tools/adb.exe"))
    })
}

fn detect_adb(saved: Option<&str>) -> AdbStatus {
  let resolved = resolve_adb_candidate(saved);
  let command = resolved.clone().unwrap_or_else(|| "adb".to_string());
  let mut process = Command::new(&command);
  process.arg("version").stdout(Stdio::null()).stderr(Stdio::piped());
  hide_window(&mut process);
  match process.output() {
    Ok(output) if output.status.success() => AdbStatus {
      configured_path: saved.map(ToString::to_string),
      resolved_path: Some(command),
      available: true,
      message: "ADB ready".to_string(),
    },
    Ok(output) => AdbStatus {
      configured_path: saved.map(ToString::to_string),
      resolved_path: Some(command),
      available: false,
      message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    },
    Err(error) => AdbStatus {
      configured_path: saved.map(ToString::to_string),
      resolved_path: resolved,
      available: false,
      message: format!("ADB not found: {error}"),
    },
  }
}

fn snapshot(state: &LauncherState) -> LauncherSnapshot {
  LauncherSnapshot {
    status: state.status.clone(),
    web_url: state.web_url.clone(),
    version: "7.0.0".to_string(),
    adb: detect_adb(state.adb_path.as_deref()),
    last_error: state.last_error.clone(),
    activity: state.activity.clone(),
  }
}

fn set_error(state: &SharedState, message: impl Into<String>) -> String {
  let message = message.into();
  if let Ok(mut guard) = state.lock() {
    guard.status = "error".to_string();
    guard.last_error = Some(message.clone());
    push_activity(&mut guard, "error", message.clone());
  }
  message
}

fn refresh_child_status(state: &mut LauncherState) {
  let exit_status = match state.child.as_mut() {
    Some(child) => match child.try_wait() {
      Ok(status) => status,
      Err(error) => {
        state.status = "error".to_string();
        state.last_error = Some(error.to_string());
        push_activity(state, "error", format!("OpenCat process check failed: {error}"));
        None
      }
    },
    None => {
      if state.status != "error" && state.status != "stopped" {
        state.status = "stopped".to_string();
      }
      None
    }
  };

  if let Some(status) = exit_status {
    state.child = None;
    state.web_url = None;
    if status.success() {
      state.status = "stopped".to_string();
      push_activity(state, "info", "OpenCat stopped");
    } else {
      state.status = "error".to_string();
      let message = format!("OpenCat exited with {status}");
      state.last_error = Some(message.clone());
      push_activity(state, "error", message);
    }
  }
}

fn stop_child_process(state: &SharedState) {
  let child = {
    let mut guard = state.lock().expect("launcher state poisoned");
    guard.status = "stopping".to_string();
    guard.web_url = None;
    push_activity(&mut guard, "info", "Stopping OpenCat");
    guard.child.take()
  };

  if let Some(mut child) = child {
    let _ = child.kill();
    let _ = child.wait();
  }

  let mut guard = state.lock().expect("launcher state poisoned");
  guard.status = "stopped".to_string();
  push_activity(&mut guard, "info", "OpenCat stopped");
}

#[tauri::command]
fn get_status(state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  let mut guard = state.lock().map_err(|error| error.to_string())?;
  refresh_child_status(&mut guard);
  Ok(snapshot(&guard))
}

#[tauri::command]
fn start_opencat(app: AppHandle, state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  {
    let guard = state.lock().map_err(|error| error.to_string())?;
    if guard.status == "starting" || guard.status == "ready" {
      return Ok(snapshot(&guard));
    }
  }

  let runtime_dir =
    resource_runtime_dir(&app).map_err(|error| set_error(state.inner(), error))?;
  let node_path = bundled_node_path(&runtime_dir);
  let cli_path = runtime_cli_path(&runtime_dir);
  if !node_path.exists() {
    return Err(set_error(
      state.inner(),
      format!("Bundled Node runtime is missing: {}", node_path.display()),
    ));
  }
  if !cli_path.exists() {
    return Err(set_error(
      state.inner(),
      format!("OpenCat CLI bundle is missing: {}", cli_path.display()),
    ));
  }

  let app_test_runner = app_test_runner_path(&runtime_dir);
  let browsers_path = runtime_dir.join("ms-playwright");
  let adb_path = {
    let guard = state.lock().map_err(|error| error.to_string())?;
    guard.adb_path.clone()
  };

  let mut command = Command::new(&node_path);
  command
    .arg(&cli_path)
    .args([
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--permission-mode",
      "acceptEdits",
      "--no-open",
    ])
    .current_dir(&runtime_dir)
    .env("OPENCAT_APP_TEST_NODE", &node_path)
    .env("OPENCAT_APP_TEST_RUNNER", &app_test_runner)
    .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_path)
    .env("NO_COLOR", "1")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
  if let Some(path) = adb_path.as_deref() {
    command.env("OPENCAT_ADB_PATH", path).env("ADB_PATH", path);
  }
  hide_window(&mut command);

  let mut child = command
    .spawn()
    .map_err(|error| set_error(state.inner(), error.to_string()))?;
  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "Failed to capture OpenCat stdout.".to_string())?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| "Failed to capture OpenCat stderr.".to_string())?;

  {
    let mut guard = state.lock().map_err(|error| error.to_string())?;
    guard.status = "starting".to_string();
    guard.last_error = None;
    guard.web_url = None;
    push_activity(&mut guard, "info", "Starting OpenCat");
    guard.child = Some(child);
  }

  let state_for_stdout = state.inner().clone();
  let app_for_stdout = app.clone();
  thread::spawn(move || {
    for line in BufReader::new(stdout).lines().flatten() {
      let trimmed = line.trim().to_string();
      if trimmed.is_empty() {
        continue;
      }
      let mut should_open = None;
      {
        let mut guard = state_for_stdout.lock().expect("launcher state poisoned");
        if let Some(url) = trimmed.strip_prefix("OpenCat Web: ") {
          let url = url.trim().to_string();
          guard.status = "ready".to_string();
          guard.web_url = Some(url.clone());
          push_activity(&mut guard, "success", format!("Local Web is ready at {url}"));
          should_open = Some(url);
        } else {
          push_activity(&mut guard, "info", trimmed);
        }
      }
      if let Some(url) = should_open {
        let _ = open_web_window_with_url(&app_for_stdout, &url);
      }
    }
  });

  let state_for_stderr = state.inner().clone();
  thread::spawn(move || {
    for line in BufReader::new(stderr).lines().flatten() {
      let trimmed = line.trim().to_string();
      if trimmed.is_empty() {
        continue;
      }
      let mut guard = state_for_stderr.lock().expect("launcher state poisoned");
      guard.last_error = Some(trimmed.clone());
      push_activity(&mut guard, "error", trimmed);
    }
  });

  let guard = state.lock().map_err(|error| error.to_string())?;
  Ok(snapshot(&guard))
}

#[tauri::command]
fn stop_opencat(state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  stop_child_process(state.inner());
  let guard = state.lock().map_err(|error| error.to_string())?;
  Ok(snapshot(&guard))
}

#[tauri::command]
fn restart_opencat(app: AppHandle, state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  stop_child_process(state.inner());
  start_opencat(app, state)
}

#[tauri::command]
fn open_web_window(app: AppHandle, state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  let url = {
    let guard = state.lock().map_err(|error| error.to_string())?;
    guard
      .web_url
      .clone()
      .ok_or_else(|| "OpenCat Web is not ready yet.".to_string())?
  };
  open_web_window_with_url(&app, &url)?;
  let guard = state.lock().map_err(|error| error.to_string())?;
  Ok(snapshot(&guard))
}

#[tauri::command]
fn check_updates(state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  let mut guard = state.lock().map_err(|error| error.to_string())?;
  let message = match option_env!("OPENCAT_UPDATE_MANIFEST_URL") {
    Some(url) if !url.trim().is_empty() => format!("Update source configured: {url}"),
    _ => "No update source configured".to_string(),
  };
  push_activity(&mut guard, "info", message);
  Ok(snapshot(&guard))
}

#[tauri::command]
fn save_adb_path(
  app: AppHandle,
  state: State<'_, SharedState>,
  adb_path: String,
) -> Result<LauncherSnapshot, String> {
  let normalized = adb_path.trim().to_string();
  let file = saved_adb_path_file(&app)?;
  if normalized.is_empty() {
    let _ = fs::remove_file(file);
  } else {
    fs::write(file, &normalized).map_err(|error| error.to_string())?;
  }

  let mut guard = state.lock().map_err(|error| error.to_string())?;
  guard.adb_path = if normalized.is_empty() { None } else { Some(normalized) };
  push_activity(&mut guard, "info", "ADB path saved");
  Ok(snapshot(&guard))
}

pub fn run() {
  let state: SharedState = Arc::new(Mutex::new(LauncherState::default()));
  let managed_state = state.clone();
  let cleanup_state = state.clone();

  let app = tauri::Builder::default()
    .manage(managed_state)
    .setup(|app| {
      let saved = load_saved_adb_path(app.handle());
      let state = app.state::<SharedState>();
      let mut guard = state.lock().map_err(|error| error.to_string())?;
      guard.adb_path = saved;
      push_activity(&mut guard, "info", "OpenCat launcher ready");
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_status,
      start_opencat,
      stop_opencat,
      restart_opencat,
      open_web_window,
      check_updates,
      save_adb_path
    ])
    .build(tauri::generate_context!())
    .expect("failed to build OpenCat launcher");

  app.run(move |_app_handle, event| {
    if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
      stop_child_process(&cleanup_state);
    }
  });
}
