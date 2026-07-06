use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
  env, fs,
  io::{BufRead, BufReader, Read, Write},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{Arc, Mutex},
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use url::form_urlencoded;

type SharedState = Arc<Mutex<LauncherState>>;
const APP_VERSION: &str = "7.0.0";
const UPDATE_PRODUCT_KEY: &str = "opencat";
#[cfg(windows)]
const UPDATE_PLATFORM: &str = "windows";
#[cfg(target_os = "macos")]
const UPDATE_PLATFORM: &str = "macos";
#[cfg(all(not(windows), not(target_os = "macos")))]
const UPDATE_PLATFORM: &str = "linux";
const UPDATE_RELEASE_CHANNEL: &str = "stable";
const DEFAULT_UPDATE_BASE_URL: &str = "http://172.21.39.142:8000";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

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
struct UpdateSnapshot {
  status: String,
  latest_version: Option<String>,
  file_name: Option<String>,
  file_size_display: Option<String>,
  release_notes: Option<String>,
  download_progress: Option<f64>,
  download_path: Option<String>,
  error: Option<String>,
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
  update: UpdateSnapshot,
}

#[derive(Clone, Debug, Default)]
struct UpdateInfo {
  update_available: bool,
  latest_version: String,
  download_url: String,
  file_name: String,
  file_size: u64,
  file_size_display: String,
  sha256: String,
  release_notes: String,
}

#[derive(Clone)]
struct LauncherUpdateState {
  status: String,
  latest_version: Option<String>,
  file_name: Option<String>,
  file_size_display: Option<String>,
  release_notes: Option<String>,
  download_progress: Option<f64>,
  download_path: Option<String>,
  error: Option<String>,
  last_info: Option<UpdateInfo>,
}

impl Default for LauncherUpdateState {
  fn default() -> Self {
    Self {
      status: "idle".to_string(),
      latest_version: None,
      file_name: None,
      file_size_display: None,
      release_notes: None,
      download_progress: None,
      download_path: None,
      error: None,
      last_info: None,
    }
  }
}

impl LauncherUpdateState {
  fn snapshot(&self) -> UpdateSnapshot {
    UpdateSnapshot {
      status: self.status.clone(),
      latest_version: self.latest_version.clone(),
      file_name: self.file_name.clone(),
      file_size_display: self.file_size_display.clone(),
      release_notes: self.release_notes.clone(),
      download_progress: self.download_progress,
      download_path: self.download_path.clone(),
      error: self.error.clone(),
    }
  }

  fn apply_info(&mut self, status: &str, info: UpdateInfo) {
    self.status = status.to_string();
    self.latest_version = non_empty_string(&info.latest_version);
    self.file_name = non_empty_string(&info.file_name);
    self.file_size_display = non_empty_string(&info.file_size_display);
    self.release_notes = non_empty_string(&info.release_notes);
    self.download_progress = None;
    self.download_path = None;
    self.error = None;
    self.last_info = Some(info);
  }
}

struct LauncherState {
  status: String,
  web_url: Option<String>,
  child: Option<Child>,
  adb_path: Option<String>,
  last_error: Option<String>,
  activity: Vec<ActivityEntry>,
  update: LauncherUpdateState,
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
      update: LauncherUpdateState::default(),
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

fn non_empty_string(value: &str) -> Option<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    None
  } else {
    Some(trimmed.to_string())
  }
}

fn resource_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let mut candidates = Vec::new();

  if let Ok(resource_dir) = app.path().resource_dir() {
    candidates.push(resource_dir.join("opencat-runtime"));
    candidates.push(resource_dir.join("resources").join("opencat-runtime"));
  }

  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(install_dir) = exe_path.parent() {
      candidates.push(install_dir.join("resources").join("opencat-runtime"));
    }
  }

  for runtime_dir in &candidates {
    if runtime_dir.exists() {
      return Ok(runtime_dir.clone());
    }
  }

  let searched = candidates
    .iter()
    .map(|path| path.display().to_string())
    .collect::<Vec<_>>()
    .join(", ");
  Err(format!("OpenCat runtime resources are missing. Searched: {searched}"))
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

fn non_empty_env(name: &str) -> Option<String> {
  env::var(name)
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn opencat_config_dir() -> Result<PathBuf, String> {
  if let Some(path) = non_empty_env("OPENCAT_CONFIG_DIR") {
    return Ok(PathBuf::from(path));
  }

  if cfg!(windows) {
    if let Some(appdata) = non_empty_env("APPDATA") {
      return Ok(PathBuf::from(appdata).join("OpenCat"));
    }
    if let Some(home) = non_empty_env("USERPROFILE").or_else(|| non_empty_env("HOME")) {
      return Ok(
        PathBuf::from(home)
          .join("AppData")
          .join("Roaming")
          .join("OpenCat"),
      );
    }
  } else if cfg!(target_os = "macos") {
    if let Some(home) = non_empty_env("HOME") {
      return Ok(
        PathBuf::from(home)
          .join("Library")
          .join("Application Support")
          .join("OpenCat"),
      );
    }
  } else if let Some(xdg_config_home) = non_empty_env("XDG_CONFIG_HOME") {
    return Ok(PathBuf::from(xdg_config_home).join("OpenCat"));
  } else if let Some(home) = non_empty_env("HOME") {
    return Ok(PathBuf::from(home).join(".config").join("OpenCat"));
  }

  Err("Failed to resolve OpenCat user data directory.".to_string())
}

fn ensure_installed_data_dirs() -> Result<(PathBuf, PathBuf), String> {
  let config_dir = opencat_config_dir()?;
  let workspace_dir = config_dir.join("workspace");
  let dirs = vec![
    config_dir.clone(),
    workspace_dir.clone(),
    config_dir.join("skills"),
    config_dir.join("projects"),
    config_dir.join("webui"),
    workspace_dir.join(".opencat").join("skills"),
  ];

  for dir in dirs {
    fs::create_dir_all(&dir).map_err(|error| {
      format!(
        "Failed to create OpenCat directory {}: {error}",
        dir.display()
      )
    })?;
  }

  Ok((config_dir, workspace_dir))
}

fn update_downloads_dir() -> Result<PathBuf, String> {
  let dir = opencat_config_dir()?.join("downloads");
  fs::create_dir_all(&dir).map_err(|error| {
    format!(
      "Failed to create update download directory {}: {error}",
      dir.display()
    )
  })?;
  Ok(dir)
}

fn normalize_base_url(value: &str) -> Option<String> {
  let mut base_url = value.trim().to_string();
  if base_url.is_empty() {
    return None;
  }
  if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
    base_url = format!("http://{base_url}");
  }
  Some(base_url.trim_end_matches('/').to_string())
}

fn update_base_url_from_config_payload(payload: &serde_json::Value) -> Option<String> {
  let update_url = payload
    .get("update")
    .and_then(|value| value.as_object())
    .and_then(|value| value.get("platform_base_url"))
    .and_then(json_value_to_string)
    .and_then(|value| normalize_base_url(&value));
  if update_url.is_some() {
    return update_url;
  }

  let server_cfg = payload.get("server").and_then(|value| value.as_object())?;
  let host = server_cfg
    .get("host")
    .and_then(json_value_to_string)
    .unwrap_or_default();
  let host = host.trim();
  if host.is_empty() {
    return None;
  }
  if host.starts_with("http://") || host.starts_with("https://") {
    return normalize_base_url(host);
  }

  let protocol = server_cfg
    .get("protocol")
    .and_then(json_value_to_string)
    .unwrap_or_else(|| "http".to_string());
  let protocol = protocol.trim();
  let protocol = if protocol.is_empty() {
    "http"
  } else {
    protocol
  };
  let port = server_cfg
    .get("port")
    .and_then(json_value_to_string)
    .unwrap_or_default();
  let port = port.trim();
  let suffix = if port.is_empty() {
    String::new()
  } else {
    format!(":{port}")
  };
  normalize_base_url(&format!("{protocol}://{host}{suffix}"))
}

fn resolve_update_base_url(config_dir: &Path, runtime_dir: Option<&Path>) -> String {
  if let Some(value) =
    non_empty_env("OPENCAT_UPDATE_BASE_URL").and_then(|value| normalize_base_url(&value))
  {
    return value;
  }

  let mut candidates = vec![
    config_dir.join("config.json"),
    config_dir.join("config").join("config.json"),
  ];
  if let Some(runtime_dir) = runtime_dir {
    candidates.push(runtime_dir.join("config").join("config.json"));
    candidates.push(
      runtime_dir
        .join("third_tools")
        .join("ai_embodied_eval")
        .join("config")
        .join("config.json"),
    );
  }

  for path in candidates {
    let Ok(text) = fs::read_to_string(path) else {
      continue;
    };
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(&text) else {
      continue;
    };
    if let Some(base_url) = update_base_url_from_config_payload(&payload) {
      return base_url;
    }
  }

  DEFAULT_UPDATE_BASE_URL.to_string()
}

fn normalize_version(value: &str) -> Vec<u64> {
  let mut parts = Vec::new();
  let mut current = String::new();
  let text = value
    .trim()
    .strip_prefix('v')
    .or_else(|| value.trim().strip_prefix('V'))
    .unwrap_or_else(|| value.trim());
  for ch in text.chars() {
    if ch.is_ascii_digit() {
      current.push(ch);
    } else if !current.is_empty() {
      parts.push(current.parse::<u64>().unwrap_or(u64::MAX));
      current.clear();
    }
  }
  if !current.is_empty() {
    parts.push(current.parse::<u64>().unwrap_or(u64::MAX));
  }
  if parts.is_empty() {
    parts.push(0);
  }
  parts
}

fn is_newer_version(latest_version: &str, current_version: &str) -> bool {
  let mut latest = normalize_version(latest_version);
  let mut current = normalize_version(current_version);
  let width = latest.len().max(current.len());
  latest.resize(width, 0);
  current.resize(width, 0);
  latest > current
}

fn json_value_to_string(value: &serde_json::Value) -> Option<String> {
  match value {
    serde_json::Value::String(value) => Some(value.clone()),
    serde_json::Value::Number(value) => Some(value.to_string()),
    serde_json::Value::Bool(value) => Some(value.to_string()),
    _ => None,
  }
}

fn json_object_string(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
  data
    .get(key)
    .and_then(json_value_to_string)
    .unwrap_or_default()
}

fn json_object_u64(data: &serde_json::Map<String, serde_json::Value>, key: &str) -> u64 {
  match data.get(key) {
    Some(serde_json::Value::Number(value)) => value.as_u64().unwrap_or_default(),
    Some(value) => json_value_to_string(value)
      .and_then(|value| value.trim().parse::<u64>().ok())
      .unwrap_or_default(),
    None => 0,
  }
}

fn join_update_url(base_url: &str, value: &str) -> Result<String, String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return Ok(String::new());
  }
  if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
    return Ok(trimmed.to_string());
  }
  let base = Url::parse(&format!("{}/", base_url.trim_end_matches('/')))
    .map_err(|error| format!("Invalid update base URL: {error}"))?;
  base
    .join(trimmed)
    .map(|url| url.to_string())
    .map_err(|error| format!("Invalid update download URL: {error}"))
}

fn fetch_text(url: &str, timeout: Duration) -> Result<String, String> {
  let response = ureq::get(url)
    .timeout(timeout)
    .call()
    .map_err(|error| format!("Update request failed: {error}"))?;
  let mut text = String::new();
  response
    .into_reader()
    .read_to_string(&mut text)
    .map_err(|error| format!("Failed to read update response: {error}"))?;
  Ok(text)
}

fn check_for_update(
  current_version: &str,
  config_dir: &Path,
  runtime_dir: Option<&Path>,
) -> Result<UpdateInfo, String> {
  let base_url = resolve_update_base_url(config_dir, runtime_dir);
  check_for_update_with_fetch(current_version, &base_url, |url| {
    fetch_text(url, UPDATE_CHECK_TIMEOUT)
  })
}

fn check_for_update_with_fetch<F>(
  current_version: &str,
  base_url: &str,
  fetcher: F,
) -> Result<UpdateInfo, String>
where
  F: Fn(&str) -> Result<String, String>,
{
  let platform_base_url =
    normalize_base_url(base_url).unwrap_or_else(|| DEFAULT_UPDATE_BASE_URL.to_string());
  let query = form_urlencoded::Serializer::new(String::new())
    .append_pair("product_key", UPDATE_PRODUCT_KEY)
    .append_pair("current_version", current_version)
    .append_pair("platform", UPDATE_PLATFORM)
    .append_pair("channel", UPDATE_RELEASE_CHANNEL)
    .finish();
  let url = format!("{platform_base_url}/api/system/download_center/check_update/?{query}");
  let payload = fetcher(&url)?;
  let payload = serde_json::from_str::<serde_json::Value>(&payload)
    .map_err(|error| format!("Invalid update response JSON: {error}"))?;
  let data = payload
    .get("data")
    .and_then(|value| value.as_object())
    .cloned()
    .unwrap_or_default();

  let latest_version = json_object_string(&data, "latest_version");
  let raw_download_url = json_object_string(&data, "download_url");
  let download_url = join_update_url(&platform_base_url, &raw_download_url)?;
  let mut update_available = data
    .get("update_available")
    .and_then(|value| value.as_bool())
    .unwrap_or(false);
  if !latest_version.trim().is_empty() {
    update_available = update_available || is_newer_version(&latest_version, current_version);
  }
  let file_name = {
    let value = json_object_string(&data, "file_name");
    if value.trim().is_empty() {
      default_update_file_name(&latest_version)
    } else {
      value
    }
  };

  Ok(UpdateInfo {
    update_available,
    latest_version,
    download_url,
    file_name,
    file_size: json_object_u64(&data, "file_size"),
    file_size_display: json_object_string(&data, "file_size_display"),
    sha256: json_object_string(&data, "sha256")
      .trim()
      .to_ascii_lowercase(),
    release_notes: json_object_string(&data, "release_notes"),
  })
}

fn safe_download_name(file_name: &str, latest_version: &str) -> String {
  let base_name = file_name
    .trim()
    .rsplit(['/', '\\'])
    .next()
    .unwrap_or_default()
    .trim();
  let name = if base_name.is_empty() {
    default_update_file_name(latest_version)
  } else {
    base_name.to_string()
  };

  name
    .chars()
    .map(|ch| {
      if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
        '_'
      } else {
        ch
      }
    })
    .collect()
}

fn default_update_file_name(latest_version: &str) -> String {
  let suffix = if latest_version.trim().is_empty() {
    String::new()
  } else {
    format!("_{}", latest_version.trim())
  };
  let extension = if cfg!(target_os = "macos") {
    "dmg"
  } else if cfg!(windows) {
    "exe"
  } else {
    "tar.gz"
  };
  format!("OpenCat_Setup{suffix}.{extension}")
}

fn bytes_to_lower_hex(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut output = String::with_capacity(bytes.len() * 2);
  for byte in bytes {
    output.push(HEX[(byte >> 4) as usize] as char);
    output.push(HEX[(byte & 0x0f) as usize] as char);
  }
  output
}

fn verify_file_sha256(path: &Path, expected_sha256: &str) -> Result<bool, String> {
  let expected = expected_sha256.trim().to_ascii_lowercase();
  if expected.is_empty() {
    return Ok(true);
  }
  let mut file = fs::File::open(path)
    .map_err(|error| format!("Failed to open update file {}: {error}", path.display()))?;
  let mut digest = Sha256::new();
  let mut buffer = [0_u8; 1024 * 1024];
  loop {
    let read = file
      .read(&mut buffer)
      .map_err(|error| format!("Failed to read update file {}: {error}", path.display()))?;
    if read == 0 {
      break;
    }
    digest.update(&buffer[..read]);
  }
  Ok(bytes_to_lower_hex(&digest.finalize()) == expected)
}

fn download_update_package<F>(
  update: &UpdateInfo,
  download_dir: &Path,
  mut progress_callback: F,
) -> Result<PathBuf, String>
where
  F: FnMut(u64, u64),
{
  if update.download_url.trim().is_empty() {
    return Err("Missing update download URL".to_string());
  }
  fs::create_dir_all(download_dir).map_err(|error| {
    format!(
      "Failed to create update download directory {}: {error}",
      download_dir.display()
    )
  })?;
  if let Some(target_path) = verified_existing_update_file(update, download_dir)? {
    let total = update.file_size.max(
      target_path
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or_default(),
    );
    progress_callback(total, total);
    return Ok(target_path);
  }

  let response = ureq::get(&update.download_url)
    .timeout(UPDATE_DOWNLOAD_TIMEOUT)
    .call()
    .map_err(|error| format!("Failed to download update: {error}"))?;
  let total = response
    .header("Content-Length")
    .and_then(|value| value.parse::<u64>().ok())
    .unwrap_or(update.file_size);
  let mut reader = response.into_reader();
  download_update_from_reader(update, download_dir, &mut reader, total, progress_callback)
}

fn download_update_from_reader<R, F>(
  update: &UpdateInfo,
  download_dir: &Path,
  reader: &mut R,
  total: u64,
  mut progress_callback: F,
) -> Result<PathBuf, String>
where
  R: Read,
  F: FnMut(u64, u64),
{
  fs::create_dir_all(download_dir).map_err(|error| {
    format!(
      "Failed to create update download directory {}: {error}",
      download_dir.display()
    )
  })?;
  let file_name = safe_download_name(&update.file_name, &update.latest_version);
  let target_path = download_dir.join(&file_name);
  let tmp_path = download_dir.join(format!("{file_name}.part"));
  let mut file = fs::File::create(&tmp_path).map_err(|error| {
    format!(
      "Failed to create update file {}: {error}",
      tmp_path.display()
    )
  })?;
  let mut digest = Sha256::new();
  let mut downloaded = 0_u64;
  let mut buffer = [0_u8; 1024 * 1024];

  loop {
    let read = match reader.read(&mut buffer) {
      Ok(read) => read,
      Err(error) => {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Failed to read update download: {error}"));
      }
    };
    if read == 0 {
      break;
    }
    if let Err(error) = file.write_all(&buffer[..read]) {
      let _ = fs::remove_file(&tmp_path);
      return Err(format!(
        "Failed to write update file {}: {error}",
        tmp_path.display()
      ));
    }
    digest.update(&buffer[..read]);
    downloaded += read as u64;
    progress_callback(downloaded, total);
  }

  if let Err(error) = file.flush() {
    let _ = fs::remove_file(&tmp_path);
    return Err(format!(
      "Failed to flush update file {}: {error}",
      tmp_path.display()
    ));
  }
  drop(file);

  let actual_sha256 = bytes_to_lower_hex(&digest.finalize());
  let expected_sha256 = update.sha256.trim().to_ascii_lowercase();
  if !expected_sha256.is_empty() && actual_sha256 != expected_sha256 {
    let _ = fs::remove_file(&tmp_path);
    return Err(format!(
      "SHA256 mismatch: expected {expected_sha256}, got {actual_sha256}"
    ));
  }

  fs::rename(&tmp_path, &target_path).map_err(|error| {
    let _ = fs::remove_file(&tmp_path);
    format!(
      "Failed to finalize update file {}: {error}",
      target_path.display()
    )
  })?;
  Ok(target_path)
}

fn verified_existing_update_file(
  update: &UpdateInfo,
  download_dir: &Path,
) -> Result<Option<PathBuf>, String> {
  let file_name = safe_download_name(&update.file_name, &update.latest_version);
  let target_path = download_dir.join(file_name);
  if target_path.exists() && verify_file_sha256(&target_path, &update.sha256)? {
    Ok(Some(target_path))
  } else {
    Ok(None)
  }
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
  use std::os::windows::process::CommandExt;
  command.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}

fn open_web_window_with_url(app: &AppHandle, url: &str) -> Result<(), String> {
  let parsed: Url = url
    .parse()
    .map_err(|error| format!("Invalid Web URL: {error}"))?;

  if let Some(window) = app.get_webview_window("opencat-web") {
    match window
      .navigate(parsed.clone())
      .and_then(|_| window.show())
      .and_then(|_| window.set_focus())
    {
      Ok(()) => return Ok(()),
      Err(_) => {
        let _ = window.destroy();
      }
    }
  }

  let window = WebviewWindowBuilder::new(app, "opencat-web", WebviewUrl::External(parsed))
    .title("OpenCat Web")
    .inner_size(1280.0, 820.0)
    .min_inner_size(900.0, 620.0)
    .build()
    .map_err(|error| error.to_string())?;
  let window_on_close = window.clone();
  window.on_window_event(move |event| {
    if let WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();
      let _ = window_on_close.hide();
    }
  });
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
}

fn saved_adb_path_file(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_config_dir()
    .map_err(|error| error.to_string())?;
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
  process
    .arg("version")
    .stdout(Stdio::null())
    .stderr(Stdio::piped());
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
    version: APP_VERSION.to_string(),
    adb: detect_adb(state.adb_path.as_deref()),
    last_error: state.last_error.clone(),
    activity: state.activity.clone(),
    update: state.update.snapshot(),
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
        push_activity(
          state,
          "error",
          format!("OpenCat process check failed: {error}"),
        );
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
fn start_opencat(
  app: AppHandle,
  state: State<'_, SharedState>,
) -> Result<LauncherSnapshot, String> {
  {
    let guard = state.lock().map_err(|error| error.to_string())?;
    if guard.status == "starting" || guard.status == "ready" {
      return Ok(snapshot(&guard));
    }
  }

  let runtime_dir = resource_runtime_dir(&app).map_err(|error| set_error(state.inner(), error))?;
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
  let (config_dir, workspace_dir) =
    ensure_installed_data_dirs().map_err(|error| set_error(state.inner(), error))?;

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
    .arg("--cwd")
    .arg(&workspace_dir)
    .current_dir(&runtime_dir)
    .env("OPENCAT_CONFIG_DIR", &config_dir)
    .env("OPENCAT_BOOTSTRAP_WEB_DIRS", "1")
    .env("OPENCAT_LEGACY_WEB_CWD", &runtime_dir)
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
    push_activity(
      &mut guard,
      "info",
      format!("Runtime: {}", runtime_dir.display()),
    );
    push_activity(
      &mut guard,
      "info",
      format!("Config: {}", config_dir.display()),
    );
    push_activity(
      &mut guard,
      "info",
      format!("Workspace: {}", workspace_dir.display()),
    );
    push_activity(&mut guard, "info", format!("CLI: {}", cli_path.display()));
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
          push_activity(
            &mut guard,
            "success",
            format!("Local Web is ready at {url}"),
          );
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
fn restart_opencat(
  app: AppHandle,
  state: State<'_, SharedState>,
) -> Result<LauncherSnapshot, String> {
  stop_child_process(state.inner());
  start_opencat(app, state)
}

#[tauri::command]
fn open_web_window(
  app: AppHandle,
  state: State<'_, SharedState>,
) -> Result<LauncherSnapshot, String> {
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
fn check_updates(
  app: AppHandle,
  state: State<'_, SharedState>,
) -> Result<LauncherSnapshot, String> {
  {
    let mut guard = state.lock().map_err(|error| error.to_string())?;
    if guard.update.status == "checking" {
      push_activity(&mut guard, "info", "Already checking for updates");
      return Ok(snapshot(&guard));
    }
    if guard.update.status == "downloading" {
      push_activity(&mut guard, "info", "Update download is already in progress");
      return Ok(snapshot(&guard));
    }
    guard.update.status = "checking".to_string();
    guard.update.download_progress = None;
    guard.update.download_path = None;
    guard.update.error = None;
    push_activity(&mut guard, "info", "Checking for updates");
  }

  let state_for_worker = state.inner().clone();
  let runtime_dir = resource_runtime_dir(&app).ok();
  thread::spawn(move || {
    let result = opencat_config_dir()
      .map_err(|error| format!("Failed to resolve OpenCat config directory: {error}"))
      .and_then(|config_dir| check_for_update(APP_VERSION, &config_dir, runtime_dir.as_deref()));

    let mut guard = state_for_worker.lock().expect("launcher state poisoned");
    match result {
      Ok(info) if info.update_available => {
        let latest_version = info.latest_version.clone();
        let file_name = if info.file_name.trim().is_empty() {
          "OpenCat_Setup.exe".to_string()
        } else {
          info.file_name.clone()
        };
        let file_size = if info.file_size_display.trim().is_empty() {
          if info.file_size > 0 {
            format!("{} bytes", info.file_size)
          } else {
            "unknown size".to_string()
          }
        } else {
          info.file_size_display.clone()
        };
        guard.update.apply_info("available", info);
        push_activity(
          &mut guard,
          "success",
          format!("OpenCat update available: {latest_version} ({file_name}, {file_size})"),
        );
      }
      Ok(info) => {
        guard.update.apply_info("latest", info);
        push_activity(
          &mut guard,
          "success",
          format!("OpenCat {APP_VERSION} is up to date"),
        );
      }
      Err(error) => {
        guard.update.status = "error".to_string();
        guard.update.error = Some(error.clone());
        guard.update.download_progress = None;
        push_activity(&mut guard, "error", format!("Update check failed: {error}"));
      }
    }
  });

  let guard = state.lock().map_err(|error| error.to_string())?;
  Ok(snapshot(&guard))
}

#[tauri::command]
fn download_update(state: State<'_, SharedState>) -> Result<LauncherSnapshot, String> {
  let update = {
    let mut guard = state.lock().map_err(|error| error.to_string())?;
    if guard.update.status == "downloading" {
      push_activity(&mut guard, "info", "Update download is already in progress");
      return Ok(snapshot(&guard));
    }
    let Some(update) = guard.update.last_info.clone() else {
      guard.update.status = "error".to_string();
      guard.update.error = Some("No update has been checked yet".to_string());
      push_activity(&mut guard, "error", "No update has been checked yet");
      return Ok(snapshot(&guard));
    };
    if !update.update_available {
      guard.update.status = "latest".to_string();
      guard.update.error = None;
      push_activity(
        &mut guard,
        "info",
        format!("OpenCat {APP_VERSION} is already up to date"),
      );
      return Ok(snapshot(&guard));
    }
    guard.update.status = "downloading".to_string();
    guard.update.download_progress = Some(0.0);
    guard.update.download_path = None;
    guard.update.error = None;
    push_activity(
      &mut guard,
      "info",
      format!("Downloading OpenCat update {}", update.latest_version),
    );
    update
  };

  let state_for_worker = state.inner().clone();
  thread::spawn(move || {
    let result = update_downloads_dir().and_then(|download_dir| {
      download_update_package(&update, &download_dir, |downloaded, total| {
        if let Ok(mut guard) = state_for_worker.lock() {
          guard.update.status = "downloading".to_string();
          guard.update.download_progress = if total > 0 {
            Some((downloaded as f64 * 100.0 / total as f64).clamp(0.0, 100.0))
          } else {
            None
          };
        }
      })
    });

    let mut guard = state_for_worker.lock().expect("launcher state poisoned");
    match result {
      Ok(target_path) => {
        guard.update.status = "downloaded".to_string();
        guard.update.download_progress = Some(100.0);
        guard.update.download_path = Some(target_path.display().to_string());
        guard.update.error = None;
        push_activity(
          &mut guard,
          "success",
          format!(
            "OpenCat {} installer downloaded to {}",
            update.latest_version,
            target_path.display()
          ),
        );
      }
      Err(error) => {
        guard.update.status = "error".to_string();
        guard.update.error = Some(error.clone());
        guard.update.download_progress = None;
        push_activity(
          &mut guard,
          "error",
          format!("Update download failed: {error}"),
        );
      }
    }
  });

  let guard = state.lock().map_err(|error| error.to_string())?;
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
  guard.adb_path = if normalized.is_empty() {
    None
  } else {
    Some(normalized)
  };
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
      download_update,
      save_adb_path
    ])
    .build(tauri::generate_context!())
    .expect("failed to build OpenCat launcher");

  app.run(move |_app_handle, event| {
    if matches!(
      event,
      tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
    ) {
      stop_child_process(&cleanup_state);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{io::Cursor, process};

  fn temp_dir(name: &str) -> PathBuf {
    let dir = env::temp_dir().join(format!(
      "opencat-launcher-{name}-{}-{}",
      process::id(),
      now_ms()
    ));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
  }

  fn sha256_hex(content: &[u8]) -> String {
    bytes_to_lower_hex(&Sha256::digest(content))
  }

  #[test]
  fn newer_version_compares_numeric_parts() {
    assert!(is_newer_version("5.4.13", "5.4.12"));
    assert!(is_newer_version("v5.10.0", "5.9.99"));
    assert!(!is_newer_version("5.4.12", "5.4.12"));
    assert!(!is_newer_version("5.4.9", "5.4.12"));
  }

  #[test]
  fn update_base_url_reads_update_config() {
    let payload = serde_json::json!({
      "update": {
        "platform_base_url": "172.21.39.142:8000"
      }
    });

    assert_eq!(
      update_base_url_from_config_payload(&payload),
      Some("http://172.21.39.142:8000".to_string())
    );
  }

  #[test]
  fn update_base_url_falls_back_to_server_config() {
    let payload = serde_json::json!({
      "server": {
        "protocol": "https",
        "host": "updates.example.test",
        "port": 9443
      }
    });

    assert_eq!(
      update_base_url_from_config_payload(&payload),
      Some("https://updates.example.test:9443".to_string())
    );
  }

  #[test]
  fn check_for_update_parses_backend_response() {
    let payload = serde_json::json!({
      "code": 2000,
      "data": {
        "update_available": true,
        "current_version": "5.4.12",
        "latest_version": "5.4.13",
        "download_url": "/api/system/download_center/20/download/",
        "file_name": "OpenCat_Setup_5.4.13.exe",
        "file_size": 123,
        "file_size_display": "123 B",
        "sha256": "ABC",
        "release_notes": "fix"
      }
    });

    let info = check_for_update_with_fetch(
      "5.4.12",
      "http://example.test",
      |url| {
        assert_eq!(
          url,
          format!(
            "http://example.test/api/system/download_center/check_update/?product_key=opencat&current_version=5.4.12&platform={UPDATE_PLATFORM}&channel=stable"
          )
        );
        Ok(payload.to_string())
      },
    )
    .expect("parse update response");

    assert!(info.update_available);
    assert_eq!(info.latest_version, "5.4.13");
    assert_eq!(
      info.download_url,
      "http://example.test/api/system/download_center/20/download/"
    );
    assert_eq!(info.sha256, "abc");
  }

  #[test]
  fn safe_download_name_removes_path_and_invalid_characters() {
    assert_eq!(
      safe_download_name("..\\OpenCat:Setup?.exe", "5.4.13"),
      "OpenCat_Setup_.exe"
    );
    assert_eq!(
      safe_download_name("", "5.4.13"),
      default_update_file_name("5.4.13")
    );
  }

  #[test]
  fn download_update_writes_file_and_checks_sha256() {
    let dir = temp_dir("download-ok");
    let content = b"opencat installer bytes";
    let expected_sha = sha256_hex(content);
    let info = UpdateInfo {
      update_available: true,
      latest_version: "5.4.13".to_string(),
      download_url: "http://example.test/download".to_string(),
      file_name: "OpenCat_Setup_5.4.13.exe".to_string(),
      file_size: content.len() as u64,
      sha256: expected_sha,
      ..UpdateInfo::default()
    };
    let mut progress = Vec::new();
    let mut reader = Cursor::new(content);

    let target = download_update_from_reader(
      &info,
      &dir,
      &mut reader,
      content.len() as u64,
      |downloaded, total| {
        progress.push((downloaded, total));
      },
    )
    .expect("download update");

    assert_eq!(
      target.file_name().and_then(|name| name.to_str()),
      Some("OpenCat_Setup_5.4.13.exe")
    );
    assert_eq!(fs::read(&target).expect("read target"), content);
    assert_eq!(
      progress.last().copied(),
      Some((content.len() as u64, content.len() as u64))
    );
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn download_update_rejects_sha256_mismatch() {
    let dir = temp_dir("download-sha-fail");
    let content = b"opencat installer bytes";
    let info = UpdateInfo {
      update_available: true,
      latest_version: "5.4.13".to_string(),
      download_url: "http://example.test/download".to_string(),
      file_name: "OpenCat_Setup_5.4.13.exe".to_string(),
      file_size: content.len() as u64,
      sha256: "deadbeef".to_string(),
      ..UpdateInfo::default()
    };
    let mut reader = Cursor::new(content);

    let error = download_update_from_reader(
      &info,
      &dir,
      &mut reader,
      content.len() as u64,
      |_downloaded, _total| {},
    )
    .expect_err("sha mismatch should fail");

    assert!(error.contains("SHA256 mismatch"));
    assert!(!dir.join("OpenCat_Setup_5.4.13.exe.part").exists());
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn existing_verified_download_is_reused() {
    let dir = temp_dir("download-reuse");
    let content = b"already downloaded";
    let file = dir.join("OpenCat_Setup_5.4.13.exe");
    fs::write(&file, content).expect("write existing file");
    let info = UpdateInfo {
      latest_version: "5.4.13".to_string(),
      file_name: "OpenCat_Setup_5.4.13.exe".to_string(),
      sha256: sha256_hex(content),
      ..UpdateInfo::default()
    };

    let existing = verified_existing_update_file(&info, &dir)
      .expect("verify existing")
      .expect("existing file should be reused");

    assert_eq!(existing, file);
    let _ = fs::remove_dir_all(dir);
  }
}
