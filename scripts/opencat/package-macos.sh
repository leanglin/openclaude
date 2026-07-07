#!/usr/bin/env bash

set -euo pipefail

ARCH="all"
CHECK_ONLY=0
CLEAN_RUNTIME_CACHE=0
CLEAN_PLAYWRIGHT_CACHE=0

usage() {
  cat <<'EOF'
Usage: bash scripts/opencat/package-macos.sh [options]

Options:
  --arch arm64|x64|all       macOS architecture to package (default: all)
  --check-only               check packaging prerequisites without building
  --clean-runtime-cache      rebuild the cached production node_modules
  --clean-playwright-cache   rebuild the cached Playwright Chromium bundle
  -h, --help                 show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      if [[ $# -lt 2 ]]; then
        echo "--arch requires a value" >&2
        exit 1
      fi
      ARCH="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    --clean-runtime-cache)
      CLEAN_RUNTIME_CACHE=1
      shift
      ;;
    --clean-playwright-cache)
      CLEAN_PLAYWRIGHT_CACHE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$ARCH" in
  arm64|x64|all) ;;
  *)
    echo "--arch must be arm64, x64, or all" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="$REPO_ROOT/launcher/src-tauri/target"
RUNTIME_DIR="$REPO_ROOT/launcher/src-tauri/resources/opencat-runtime"
LOG_PATH="$TARGET_DIR/opencat-package-macos.log"
BUILD_CACHE_DIR="${OPENCAT_BUILD_CACHE_DIR:-"$HOME/Library/Caches/OpenCatBuildCache"}"
MINIMUM_NODE_MAJOR=22

if [[ "$ARCH" == "all" ]]; then
  ARCHES=(arm64 x64)
else
  ARCHES=("$ARCH")
fi

step() {
  printf '\n==> %s\n' "$1"
}

info() {
  printf '    %s\n' "$1"
}

fail() {
  echo "[OpenCat package] $1" >&2
  exit 1
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

require_command() {
  local name="$1"
  local hint="$2"
  if [[ -z "$(command_path "$name")" ]]; then
    fail "$name was not found. $hint"
  fi
}

rust_target_for_arch() {
  case "$1" in
    arm64) echo "aarch64-apple-darwin" ;;
    x64) echo "x86_64-apple-darwin" ;;
    *) fail "Unsupported macOS architecture: $1" ;;
  esac
}

node_label_for_arch() {
  case "$1" in
    arm64) echo "arm64" ;;
    x64) echo "x86_64" ;;
    *) fail "Unsupported macOS architecture: $1" ;;
  esac
}

ensure_node() {
  step "Checking Node.js"
  require_command node "Install Node.js $MINIMUM_NODE_MAJOR or newer before packaging."
  local version_text
  version_text="$(node --version)"
  local major
  major="${version_text#v}"
  major="${major%%.*}"
  if [[ "$major" -lt "$MINIMUM_NODE_MAJOR" ]]; then
    fail "Node.js $version_text found, but OpenCat packaging requires Node.js $MINIMUM_NODE_MAJOR or newer."
  fi
  info "Node.js $version_text at $(command_path node)"
}

ensure_bun() {
  step "Checking Bun"
  require_command bun "Install Bun using https://bun.sh before packaging."
  info "Bun $(bun --version) at $(command_path bun)"
}

ensure_npm() {
  step "Checking npm"
  require_command npm "Install Node.js with npm before packaging."
  info "npm $(npm --version) at $(command_path npm)"
}

ensure_xcode_tools() {
  step "Checking Xcode command line tools"
  require_command xcode-select "Install Xcode command line tools with xcode-select --install."
  require_command xcrun "Install Xcode command line tools with xcode-select --install."
  xcode-select -p >/dev/null 2>&1 || fail "Xcode command line tools are not selected. Run xcode-select --install."
  xcrun --find clang >/dev/null 2>&1 || fail "clang was not found through xcrun. Run xcode-select --install."
  info "Xcode tools at $(xcode-select -p)"
}

ensure_system_tools() {
  step "Checking macOS packaging tools"
  require_command hdiutil "hdiutil is required to create DMG packages."
  require_command ditto "ditto is required to stage the app bundle for DMG packaging."
  require_command shasum "shasum is required to print package hashes."
  require_command file "file is required to verify bundled runtime architecture."
  require_command tar "tar is required to extract downloaded Node.js runtimes."
}

ensure_rust() {
  step "Checking Rust/Cargo"
  require_command cargo "Install Rust stable with rustup before packaging."
  require_command rustc "Install Rust stable with rustup before packaging."
  require_command rustup "Install Rust with rustup so package targets can be installed."
  info "$(cargo --version)"
  info "$(rustc --version)"

  local arch
  for arch in "${ARCHES[@]}"; do
    local target
    target="$(rust_target_for_arch "$arch")"
    if rustup target list --installed | grep -qx "$target"; then
      info "Rust target ready: $target"
    else
      info "Installing Rust target: $target"
      rustup target add "$target"
    fi
  done
}

ensure_arch_can_run() {
  local arch="$1"
  local host_arch
  host_arch="$(uname -m)"
  case "$host_arch:$arch" in
    arm64:arm64|x86_64:x64)
      return
      ;;
    arm64:x64)
      if /usr/bin/arch -x86_64 /usr/bin/true >/dev/null 2>&1; then
        return
      fi
      fail "Building the x64 DMG on Apple Silicon requires Rosetta 2 so the x64 bundled Node can install Playwright Chromium."
      ;;
    *)
      fail "This host ($host_arch) cannot run the Node runtime needed for a $arch DMG. Build that architecture on matching macOS hardware."
      ;;
  esac
}

ensure_prerequisites() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "This packaging script only supports macOS."
  fi

  ensure_node
  ensure_bun
  ensure_npm
  ensure_xcode_tools
  ensure_system_tools
  ensure_rust

  local arch
  for arch in "${ARCHES[@]}"; do
    ensure_arch_can_run "$arch"
  done
}

prepare_runtime() {
  local arch="$1"
  step "Preparing OpenCat runtime staging for macOS $arch"
  info "Build cache: $BUILD_CACHE_DIR"

  export OPENCAT_RUNTIME_PLATFORM=darwin
  export OPENCAT_RUNTIME_ARCH="$arch"
  export OPENCAT_BUILD_CACHE_DIR="$BUILD_CACHE_DIR"
  if [[ "$CLEAN_RUNTIME_CACHE" == "1" ]]; then
    export OPENCAT_CLEAN_RUNTIME_CACHE=1
  else
    unset OPENCAT_CLEAN_RUNTIME_CACHE || true
  fi
  if [[ "$CLEAN_PLAYWRIGHT_CACHE" == "1" ]]; then
    export OPENCAT_CLEAN_PLAYWRIGHT_CACHE=1
  else
    unset OPENCAT_CLEAN_PLAYWRIGHT_CACHE || true
  fi

  (cd "$REPO_ROOT" && bun run opencat:prepare-runtime)
}

assert_runtime_staging() {
  local arch="$1"
  local node_path="$RUNTIME_DIR/node/bin/node"
  local cli_path="$RUNTIME_DIR/dist/cli.mjs"
  local node_modules="$RUNTIME_DIR/node_modules"
  local manifest="$RUNTIME_DIR/opencat-runtime.json"
  local expected_label
  expected_label="$(node_label_for_arch "$arch")"

  step "Checking staged OpenCat runtime for macOS $arch"
  [[ -x "$node_path" ]] || fail "Bundled Node runtime is missing or not executable: $node_path"
  [[ -f "$cli_path" ]] || fail "OpenCat CLI bundle is missing: $cli_path"
  [[ -d "$node_modules" ]] || fail "Runtime node_modules is missing: $node_modules"
  [[ -f "$manifest" ]] || fail "Runtime manifest is missing: $manifest"

  local node_file
  node_file="$(file "$node_path")"
  info "$node_file"
  if [[ "$node_file" != *"$expected_label"* ]]; then
    fail "Bundled Node architecture does not match $arch: $node_file"
  fi

  local version
  version="$("$node_path" "$cli_path" --version)"
  info "runtime version = $version"
  if [[ "$version" != "7.0.1 (OpenCat)" ]]; then
    fail "Unexpected runtime version output: $version"
  fi
}

assert_app_bundle_runtime() {
  local arch="$1"
  local app_path="$2"
  local resources_dir="$app_path/Contents/Resources"
  local runtime_dir="$resources_dir/opencat-runtime"
  local nested_runtime_dir="$resources_dir/resources/opencat-runtime"
  local node_path="$runtime_dir/node/bin/node"
  local cli_path="$runtime_dir/dist/cli.mjs"
  local node_modules="$runtime_dir/node_modules"
  local manifest="$runtime_dir/opencat-runtime.json"
  local expected_label
  expected_label="$(node_label_for_arch "$arch")"

  step "Checking bundled OpenCat runtime in app bundle for macOS $arch"
  if [[ -d "$nested_runtime_dir" ]]; then
    fail "OpenCat runtime was bundled at the legacy nested path: $nested_runtime_dir. Expected: $runtime_dir"
  fi

  [[ -d "$runtime_dir" ]] || fail "OpenCat runtime directory is missing from app bundle: $runtime_dir"
  [[ -x "$node_path" ]] || fail "Bundled Node runtime is missing or not executable in app bundle: $node_path"
  [[ -f "$cli_path" ]] || fail "OpenCat CLI bundle is missing from app bundle: $cli_path"
  [[ -d "$node_modules" ]] || fail "Runtime node_modules is missing from app bundle: $node_modules"
  [[ -f "$manifest" ]] || fail "Runtime manifest is missing from app bundle: $manifest"

  local node_file
  node_file="$(file "$node_path")"
  info "$node_file"
  if [[ "$node_file" != *"$expected_label"* ]]; then
    fail "Bundled app Node architecture does not match $arch: $node_file"
  fi

  local version
  version="$("$node_path" "$cli_path" --version)"
  info "bundled runtime version = $version"
  if [[ "$version" != "7.0.1 (OpenCat)" ]]; then
    fail "Unexpected bundled runtime version output: $version"
  fi
}

build_source() {
  step "Installing source dependencies"
  (cd "$REPO_ROOT" && bun install)

  step "Building app-test-runner"
  (cd "$REPO_ROOT" && npm --prefix packages/app-test-runner install)
  (cd "$REPO_ROOT" && npm --prefix packages/app-test-runner run build)

  step "Building OpenCat CLI bundles"
  (cd "$REPO_ROOT" && bun run build)
}

build_dmg() {
  local arch="$1"
  local rust_target
  rust_target="$(rust_target_for_arch "$arch")"
  local app_path="$TARGET_DIR/$rust_target/release/bundle/macos/OpenCat.app"

  prepare_runtime "$arch"
  assert_runtime_staging "$arch"

  step "Building Tauri app bundle for macOS $arch"
  rm -rf "$app_path"
  (
    cd "$REPO_ROOT"
    bun run --cwd launcher tauri build \
      --target "$rust_target" \
      --bundles app \
      --no-sign \
      --config src-tauri/tauri.macos.conf.json
  )

  [[ -d "$app_path" ]] || fail "Tauri build finished, but no app bundle was found: $app_path"
  assert_app_bundle_runtime "$arch" "$app_path"

  step "Creating simple DMG for macOS $arch"
  local dmg_dir="$TARGET_DIR/$rust_target/release/bundle/dmg"
  local dmg="$dmg_dir/OpenCat_7.0.1_${rust_target%%-*}.dmg"
  local dmg_root
  dmg_root="$(mktemp -d)"
  mkdir -p "$dmg_dir"
  rm -f "$dmg"
  ditto "$app_path" "$dmg_root/OpenCat.app"
  ln -s /Applications "$dmg_root/Applications"
  if ! hdiutil create \
    -volname OpenCat \
    -srcfolder "$dmg_root" \
    -ov \
    -format UDZO \
    "$dmg"; then
    rm -rf "$dmg_root"
    fail "Failed to create DMG for $arch."
  fi
  rm -rf "$dmg_root"

  local size
  size="$(stat -f%z "$dmg")"
  local sha
  sha="$(shasum -a 256 "$dmg" | awk '{print $1}')"
  step "OpenCat macOS $arch package ready"
  info "DMG: $dmg"
  info "Size: $size bytes"
  info "SHA256: $sha"
}

main() {
  mkdir -p "$TARGET_DIR"
  : > "$LOG_PATH"
  exec > >(tee -a "$LOG_PATH") 2>&1

  step "OpenCat macOS DMG packaging"
  info "Repository: $REPO_ROOT"
  info "Log: $LOG_PATH"
  info "Build cache: $BUILD_CACHE_DIR"
  info "Architectures: ${ARCHES[*]}"

  ensure_prerequisites
  if [[ "$CHECK_ONLY" == "1" ]]; then
    step "CheckOnly complete"
    info "All macOS packaging prerequisites are ready."
    return
  fi

  build_source

  local arch
  for arch in "${ARCHES[@]}"; do
    build_dmg "$arch"
  done
}

main
