#!/usr/bin/env bash
#
# uninstall.sh — Remove loopy CLI installation
#
# Usage:
#   bash ~/.loopy/installation/uninstall.sh
#   # Or non-interactive (e.g., piped from curl):
#   bash uninstall.sh
#
# Environment variables:
#   LOOPY_HOME — installation directory (default: ~/.loopy/installation)
#   LOOPY_BIN  — binary symlink path  (default: ~/.local/bin/loopy)
#
set -euo pipefail

LOOPY_HOME="${LOOPY_HOME:-$HOME/.loopy/installation}"
LOOPY_BIN="${LOOPY_BIN:-$HOME/.local/bin/loopy}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { printf "${BLUE}==>%b %s%b\n" "$NC" "$1" "$NC"; }
ok()    { printf "${GREEN}✓ %s%b\n" "$1" "$NC"; }
warn()  { printf "${YELLOW}! %s%b\n" "$1" "$NC"; }
fail()  { printf "${RED}✗ %s%b\n" "$1" "$NC" >&2; exit 1; }

remove_binary() {
  if [ -f "$LOOPY_BIN" ]; then
    rm -f "$LOOPY_BIN"
    ok "Removed $LOOPY_BIN"
  else
    warn "Binary not found at $LOOPY_BIN (already removed?)"
  fi
}

remove_installation() {
  if [ ! -d "$LOOPY_HOME" ]; then
    warn "Installation directory not found at $LOOPY_HOME (already removed?)"
    return
  fi

  if [ -t 0 ]; then
    printf "${YELLOW}Remove installation directory $LOOPY_HOME? [y/N]%b " "$NC"
    read -r answer
    case "$answer" in
      [yY]|[yY][eE][sE])
        rm -rf "$LOOPY_HOME"
        ok "Removed $LOOPY_HOME"
        ;;
      *)
        warn "Kept $LOOPY_HOME"
        ;;
    esac
  else
    rm -rf "$LOOPY_HOME"
    ok "Removed $LOOPY_HOME (non-interactive mode)"
  fi
}

remove_loopy_dir() {
  local loopy_base
  loopy_base="$(dirname "$LOOPY_HOME")"
  if [ -d "$loopy_base" ] && [ -z "$(ls -A "$loopy_base" 2>/dev/null)" ]; then
    rmdir "$loopy_base"
    ok "Removed empty $loopy_base"
  fi
}

main() {
  info "Uninstalling loopy..."
  remove_binary
  remove_installation
  remove_loopy_dir

  printf "${GREEN}loopy has been uninstalled.%b\n" "$NC"
  echo ""
  echo "  If you added ~/.local/bin to your PATH manually, you can remove it from your shell RC."
  echo ""
}

main "$@"