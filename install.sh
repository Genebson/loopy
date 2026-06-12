#!/usr/bin/env bash
#
# install.sh — Install loopy CLI from source
#
# PLATFORM: v0.1.0 only fully supports macOS. Linux may work but is
# untested. Windows is not supported (use WSL or Git Bash).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Genebson/loopy/main/install.sh | bash
#   # Or clone and run locally:
#   bash install.sh
#
# Environment variables:
#   LOOPY_HOME  — installation directory (default: ~/.loopy/installation)
#   LOOPY_BIN   — binary symlink path   (default: ~/.local/bin/loopy)
#   LOOPY_REPO  — git remote URL        (default: https://github.com/Genebson/loopy.git)
#   LOOPY_REF   — git ref to install    (default: main)
#
set -euo pipefail

LOOPY_HOME="${LOOPY_HOME:-$HOME/.loopy/installation}"
LOOPY_BIN="${LOOPY_BIN:-$HOME/.local/bin/loopy}"
LOOPY_REPO="${LOOPY_REPO:-https://github.com/Genebson/loopy.git}"
LOOPY_REF="${LOOPY_REF:-main}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { printf "${BLUE}==>%b %s%b\n" "$NC" "$1" "$NC"; }
ok()    { printf "${GREEN}✓ %s%b\n" "$1" "$NC"; }
warn()  { printf "${YELLOW}! %s%b\n" "$1" "$NC"; }
fail()  { printf "${RED}✗ %s%b\n" "$1" "$NC" >&2; exit 1; }

detect_os() {
  local uname_out
  uname_out="$(uname -s)"
  case "$uname_out" in
    Darwin*) echo "darwin" ;;
    Linux*)  echo "linux" ;;
    *)       fail "Unsupported OS: $uname_out" ;;
  esac
}

detect_arch() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *)             fail "Unsupported architecture: $arch" ;;
  esac
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is not installed. Install Node.js >= 25.0.0 from https://nodejs.org"
  fi
  local version
  version="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$version" -lt 25 ]; then
    fail "Node.js >= 25.0.0 required, found v$(node -v). Upgrade at https://nodejs.org"
  fi
  ok "Node.js $(node -v)"
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    fail "pnpm is not installed. Install pnpm >= 10 with: corepack enable && corepack prepare pnpm@latest --activate"
  fi
  local major
  major="$(pnpm -v | cut -d. -f1)"
  if [ "$major" -lt 10 ]; then
    fail "pnpm >= 10.0.0 required, found v$(pnpm -v). Upgrade with: corepack prepare pnpm@latest --activate"
  fi
  ok "pnpm v$(pnpm -v)"
}

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    fail "git is not installed. Install git from https://git-scm.com"
  fi
  ok "git $(git --version | awk '{print $3}')"
}

check_gh() {
  if command -v gh >/dev/null 2>&1; then
    ok "gh $(gh --version | head -1 | awk '{print $3}')"
  else
    warn "gh CLI not found. Install it for 'loopy run' support: https://cli.github.com"
  fi
}

is_sha() {
  local ref="$1"
  [ "${#ref}" -eq 40 ] && echo "$ref" | grep -qE '^[0-9a-fA-F]{40}$'
}

fetch_source() {
  if [ -d "$LOOPY_HOME/.git" ]; then
    info "Updating existing installation at $LOOPY_HOME"
    git -C "$LOOPY_HOME" fetch --all --quiet
    git -C "$LOOPY_HOME" checkout "$LOOPY_REF" --quiet
    git -C "$LOOPY_HOME" pull --quiet
  else
    info "Cloning $LOOPY_REPO (ref: $LOOPY_REF)"
    if is_sha "$LOOPY_REF"; then
      git clone "$LOOPY_REPO" "$LOOPY_HOME" --quiet
      git -C "$LOOPY_HOME" checkout "$LOOPY_REF" --quiet
    else
      git clone --branch "$LOOPY_REF" "$LOOPY_REPO" "$LOOPY_HOME" --quiet
    fi
  fi
  ok "Source ready at $LOOPY_HOME"
}

build() {
  info "Installing dependencies..."
  (cd "$LOOPY_HOME" && pnpm install) || fail "pnpm install failed"

  info "Building loopy..."
  (cd "$LOOPY_HOME" && pnpm build) || fail "pnpm build failed"

  ok "Build complete"
}

create_wrapper() {
  local bin_dir
  bin_dir="$(dirname "$LOOPY_BIN")"
  mkdir -p "$bin_dir"

  local target="$LOOPY_HOME/apps/cli/dist/esm/index.js"

  if [ ! -f "$target" ]; then
    fail "Built entry point not found at $target. Build may have failed."
  fi

  cat > "$LOOPY_BIN" <<WRAPPER
#!/usr/bin/env bash
exec node "$target" "\$@"
WRAPPER

  chmod +x "$LOOPY_BIN"
  ok "Wrapper script created at $LOOPY_BIN"
}

check_path() {
  local bin_dir
  bin_dir="$(dirname "$LOOPY_BIN")"

  case ":$PATH:" in
    *":$bin_dir:"*)
      ok "$bin_dir is in PATH"
      ;;
    *)
      local shell_rc
      shell_rc="$(detect_shell_rc)"

      warn "$bin_dir is not in PATH."
      echo ""
      echo "  Add this to your $shell_rc:"
      echo ""
      echo "    export PATH=\"$bin_dir:\$PATH\""
      echo ""
      echo "  Then reload your shell:"
      echo ""
      echo "    source \"$shell_rc\""
      echo ""
      ;;
  esac
}

detect_shell_rc() {
  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"

  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)
      if [ -f "$HOME/.bash_profile" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
  esac
}

verify() {
  info "Verifying installation..."
  if "$LOOPY_BIN" --version >/dev/null 2>&1; then
    ok "loopy $("$LOOPY_BIN" --version) installed successfully"
  else
    warn "loopy --version failed, but the binary exists at $LOOPY_BIN"
  fi
}

print_getting_started() {
  echo ""
  printf "${GREEN}loopy is installed!%b\n" "$NC"
  echo ""
  echo "  Get started:"
  echo ""
  echo "    cd /path/to/your/repo"
  echo "    loopy init"
  echo "    loopy run"
  echo ""
  echo "  Uninstall:"
  echo ""
  echo "    bash $LOOPY_HOME/uninstall.sh"
  echo ""
}

main() {
  info "Installing loopy (OS: $(detect_os), Arch: $(detect_arch))"

  check_node
  check_pnpm
  check_git
  check_gh

  fetch_source
  build
  create_wrapper
  check_path
  verify
  print_getting_started
}

main "$@"