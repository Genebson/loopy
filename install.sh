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
ok()    { printf "${GREEN}✓%b %s%b\n" "$NC" "$1" "$NC"; }
warn()  { printf "${YELLOW}!%b %s%b\n" "$NC" "$1" "$NC"; }
fail()  { printf "${RED}✗%b %s%b\n" "$NC" "$1" "$NC" >&2; exit 1; }

step() { printf "   %-30s" "$1"; }

check_node() {
  step "Checking Node.js"
  if ! command -v node >/dev/null 2>&1; then
    echo "✗ FAILED"
    fail "Node.js is not installed. Install Node.js >= 25.0.0 from https://nodejs.org"
  fi
  local version
  version="$(node -v | sed 's/v//' | cut -d. -f1)"
  if [ "$version" -lt 25 ]; then
    echo "✗ FAILED"
    fail "Node.js >= 25.0.0 required, found v$(node -v). Upgrade at https://nodejs.org"
  fi
  echo "✓ $(node -v)"
}

check_pnpm() {
  step "Checking pnpm"
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "✗ FAILED"
    fail "pnpm is not installed. Install pnpm >= 10 with: corepack enable && corepack prepare pnpm@latest --activate"
  fi
  local major
  major="$(pnpm -v | cut -d. -f1)"
  if [ "$major" -lt 10 ]; then
    echo "✗ FAILED"
    fail "pnpm >= 10.0.0 required, found v$(pnpm -v). Upgrade with: corepack prepare pnpm@latest --activate"
  fi
  echo "✓ $(pnpm -v)"
}

check_git() {
  step "Checking git"
  if ! command -v git >/dev/null 2>&1; then
    echo "✗ FAILED"
    fail "git is not installed. Install git from https://git-scm.com"
  fi
  echo "✓ $(git --version | awk '{print $3}')"
}

check_gh() {
  step "Checking gh CLI"
  if command -v gh >/dev/null 2>&1; then
    echo "✓ $(gh --version | head -1 | awk '{print $3}')"
  else
    echo "✓ (not found - optional)"
  fi
}

is_sha() {
  local ref="$1"
  [ "${#ref}" -eq 40 ] && echo "$ref" | grep -qE '^[0-9a-fA-F]{40}$'
}

fetch_source() {
  step "Fetching source"
  if [ -d "$LOOPY_HOME/.git" ]; then
    git -C "$LOOPY_HOME" fetch --all --quiet
    git -C "$LOOPY_HOME" checkout "$LOOPY_REF" --quiet
    git -C "$LOOPY_HOME" reset --hard "origin/$LOOPY_REF" --quiet
  else
    if is_sha "$LOOPY_REF"; then
      git clone "$LOOPY_REPO" "$LOOPY_HOME" --quiet
      git -C "$LOOPY_HOME" checkout "$LOOPY_REF" --quiet
    else
      git clone --branch "$LOOPY_REF" "$LOOPY_REPO" "$LOOPY_HOME" --quiet
    fi
  fi
  echo "✓ $LOOPY_REF"
}

install_deps() {
  step "Installing dependencies"
  if ! (cd "$LOOPY_HOME" && pnpm install > /dev/null 2>&1); then
    echo "✗ FAILED"
    fail "pnpm install failed"
  fi
  echo "✓"
}

build() {
  step "Building"
  if ! (cd "$LOOPY_HOME" && pnpm build > /dev/null 2>&1); then
    echo "✗ FAILED"
    fail "pnpm build failed"
  fi
  echo "✓"
}

create_wrapper() {
  step "Creating wrapper script"
  local bin_dir
  bin_dir="$(dirname "$LOOPY_BIN")"
  mkdir -p "$bin_dir"

  local target="$LOOPY_HOME/apps/cli/dist/esm/index.js"

  if [ ! -f "$target" ]; then
    echo "✗ FAILED"
    fail "Built entry point not found at $target. Build may have failed."
  fi

  cat > "$LOOPY_BIN" <<WRAPPER
#!/usr/bin/env bash
exec node "$target" "\$@"
WRAPPER

  chmod +x "$LOOPY_BIN"
  echo "✓ $LOOPY_BIN"
}

check_path() {
  local bin_dir
  bin_dir="$(dirname "$LOOPY_BIN")"

  step "Setting up PATH"
  case ":$PATH:" in
    *":$bin_dir:"*)
      echo "✓ (already in PATH)"
      ;;
    *)
      local shell_rc
      shell_rc="$(detect_shell_rc)"
      echo "" >> "$shell_rc"
      echo "export PATH=\"$bin_dir:\$PATH\"" >> "$shell_rc"
      echo "✓ (added to $shell_rc)"
      echo ""
      echo "  Run 'source $shell_rc' to reload your PATH"
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
  step "Verifying"
  if "$LOOPY_BIN" --version >/dev/null 2>&1; then
    echo "✓ $(tput bold)$("$LOOPY_BIN" --version)$(tput sgr0) installed!"
  else
    echo "✗ FAILED"
    warn "loopy --version failed, but binary exists at $LOOPY_BIN"
  fi
}

main() {
  echo ""
  info "Installing loopy $(tput bold)v0.1.0$(tput sgr0)"
  echo ""

  check_node
  check_pnpm
  check_git
  check_gh

  echo ""
  fetch_source
  install_deps
  build
  create_wrapper
  check_path

  echo ""
  verify

  echo ""
  printf "${GREEN}✓ loopy is ready!%b\n" "$NC"
  echo ""
  echo "  Run 'loopy --version' to verify, then:"
  echo ""
  echo "    cd /path/to/your/repo"
  echo "    loopy init"
  echo "    loopy run"
  echo ""
}

main "$@"
