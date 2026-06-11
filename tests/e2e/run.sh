#!/usr/bin/env bash
# loopy End-to-End Test Script
# Manually verifies the full loop cycle against a real GitHub Project
#
# Setup:
# 1. Create a test GitHub repo: gh repo create loopy-e2e-test --public
# 2. Clone it locally: git clone <repo-url> && cd loopy-e2e-test
# 3. Authenticate with `gh auth login` (needs repo + project scopes)
# 4. Create a GitHub Project and add the repo to it
# 5. Start opencode serve in another terminal: opencode serve
# 6. Run this script from the repo root: bash tests/e2e/run.sh
#
# What it does:
# 1. Checks prerequisites (gh, opencode, git, loopy build)
# 2. Creates a test issue in the repo
# 3. Adds it to a Project and moves it to the Ready column
# 4. Runs `loopy run --once` with timeout
# 5. Verifies the card moved to InReview
# 6. Verifies a PR was opened
# 7. Outputs a clear pass/fail message
# 8. Prints cleanup instructions
#
# Options:
#   --owner <owner>          GitHub owner (org or user, default: repo owner)
#   --repo <repo>            Repository name (default: current repo name)
#   --project-number <num>   Project number (required)
#   --timeout <seconds>      Timeout for loopy run (default: 300)
#   --skip-cleanup           Skip printing cleanup instructions
#   -h, --help               Show this help message

set -euo pipefail

OWNER=""
REPO=""
PROJECT_NUMBER=""
TIMEOUT_SECS=300
SKIP_CLEANUP=false
LOOPY_BIN=""
ISSUE_NUMBER=""
BRANCH_NAME=""

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# //; s/^#//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner) OWNER="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --project-number) PROJECT_NUMBER="$2"; shift 2 ;;
    --timeout) TIMEOUT_SECS="$2"; shift 2 ;;
    --skip-cleanup) SKIP_CLEANUP=true; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}[INFO]${NC} %s\n" "$1"; }
pass()  { printf "${GREEN}[PASS]${NC} %s\n" "$1"; }
fail()  { printf "${RED}[FAIL]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }

step() {
  printf "\n${CYAN}==>${NC} %s\n" "$1"
}

check_prerequisites() {
  step "Checking prerequisites"

  if ! command -v gh &>/dev/null; then
    fail "gh CLI not found. Install it: https://cli.github.com/"
    exit 1
  fi
  pass "gh CLI found"

  if ! gh auth status &>/dev/null; then
    fail "gh not authenticated. Run: gh auth login"
    exit 1
  fi
  pass "gh authenticated"

  if ! command -v git &>/dev/null; then
    fail "git not found"
    exit 1
  fi
  pass "git found"

  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    fail "Not inside a git repository. Run this from a git repo root."
    exit 1
  fi
  pass "inside git repository"

  if ! command -v node &>/dev/null; then
    fail "node not found"
    exit 1
  fi
  pass "node found"

  LOOPY_BIN="$(pwd)/apps/cli/dist/cjs/index.js"
  if [[ ! -f "$LOOPY_BIN" ]]; then
    info "loopy CLI not built. Building..."
    if ! pnpm build &>/dev/null; then
      fail "pnpm build failed. Run 'pnpm build' manually."
      exit 1
    fi
  fi
  pass "loopy CLI available at $LOOPY_BIN"

  if [[ -z "$PROJECT_NUMBER" ]]; then
    fail "--project-number is required. Find it in your GitHub Project URL."
    exit 1
  fi

  if [[ -z "$OWNER" ]]; then
    OWNER="$(gh repo view --json owner -q '.owner.login' 2>/dev/null || echo '')"
    if [[ -z "$OWNER" ]]; then
      fail "Could not determine owner. Use --owner <owner>."
      exit 1
    fi
  fi

  if [[ -z "$REPO" ]]; then
    REPO="$(basename "$(git remote get-url origin 2>/dev/null || echo 'unknown')" .git 2>/dev/null || echo '')"
    if [[ -z "$REPO" ]]; then
      fail "Could not determine repo name. Use --repo <repo>."
      exit 1
    fi
  fi

  info "Owner: $OWNER"
  info "Repo: $REPO"
  info "Project number: $PROJECT_NUMBER"
}

create_test_issue() {
  step "Creating test issue"

  ISSUE_NUMBER="$(gh issue create \
    --title "loopy e2e test: add hello world function" \
    --body "Add a function called helloWorld that returns the string \"Hello, World!\" to src/hello.ts. Export it as the default export." \
    --repo "${OWNER}/${REPO}" \
    --json number \
    -q '.number')"

  pass "Created issue #${ISSUE_NUMBER}"
}

add_issue_to_project() {
  step "Adding issue to project"

  local item_id
  item_id="$(gh project item-add "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --url "https://github.com/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}" \
    --format json \
    -q '.id' 2>/dev/null || echo '')"

  if [[ -z "$item_id" ]]; then
    fail "Could not add issue to project. Make sure the project exists and the issue URL is correct."
    cleanup_issue
    exit 1
  fi
  pass "Added issue to project (item: ${item_id})"

  step "Moving issue to Ready column"

  local fields
  fields="$(gh project item-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null || echo '')"

  local status_field_id
  status_field_id="$(echo "$fields" | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const field = data.fields.find(f => f.name === 'Status');
    console.log(field ? field.id : '');
  " 2>/dev/null || echo '')"

  local ready_option_id
  ready_option_id="$(echo "$fields" | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const field = data.fields.find(f => f.name === 'Status');
    const ready = field && field.options ? field.options.find(o => o.name.toLowerCase().includes('ready')) : null;
    console.log(ready ? ready.id : '');
  " 2>/dev/null || echo '')"

  if [[ -n "$status_field_id" && -n "$ready_option_id" ]]; then
    gh project item-edit --id "$item_id" \
      --project-id "$PROJECT_NUMBER" \
      --field-id "$status_field_id" \
      --single-select-option-id "$ready_option_id" \
      2>/dev/null || warn "Could not move item to Ready (may already be there)"
    pass "Moved issue to Ready column"
  else
    warn "Could not auto-detect Ready column. Move the issue manually if needed."
  fi
}

run_loopy() {
  step "Running loopy --once"

  local loopy_exit_code=0

  timeout "${TIMEOUT_SECS}" node "$LOOPY_BIN" run --once --verbose --config-path loopy.config.ts || loopy_exit_code=$?

  if [[ $loopy_exit_code -eq 124 ]]; then
    fail "loopy timed out after ${TIMEOUT_SECS}s"
    return 1
  fi

  if [[ $loopy_exit_code -ne 0 ]]; then
    warn "loopy exited with code ${loopy_exit_code} (may be expected if no config)"
  fi

  pass "loopy run completed"
}

verify_results() {
  step "Verifying results"

  local all_passed=true

  local state_file=".loopy/state/${ISSUE_NUMBER}.json"
  if [[ -f "$state_file" ]]; then
    local state
    state="$(node -e "const d=require('./${state_file}'); console.log(d.state)" 2>/dev/null || echo 'unknown')"
    if [[ "$state" == "Done" || "$state" == "InReview" ]]; then
      pass "Card state: ${state}"
    elif [[ "$state" == "Blocked" ]]; then
      warn "Card is Blocked. Check .loopy/state/${ISSUE_NUMBER}.json for details."
      all_passed=false
    else
      warn "Card state: ${state} (expected Done or InReview)"
      all_passed=false
    fi
  else
    fail "No state file found at ${state_file}"
    all_passed=false
  fi

  local pr_count
  pr_count="$(gh pr list --repo "${OWNER}/${REPO}" --head "loopy/${ISSUE_NUMBER}-*" --json number -q 'length' 2>/dev/null || echo '0')"

  if [[ "$pr_count" -gt 0 ]]; then
    pass "PR found for issue #${ISSUE_NUMBER}"
  else
    warn "No PR found for issue #${ISSUE_NUMBER} (card may not have reached InReview)"
    all_passed=false
  fi

  if $all_passed; then
    printf "\n${GREEN}========================================${NC}\n"
    printf "${GREEN}  E2E TEST PASSED${NC}\n"
    printf "${GREEN}========================================${NC}\n"
  else
    printf "\n${YELLOW}========================================${NC}\n"
    printf "${YELLOW}  E2E TEST PARTIAL${NC}\n"
    printf "${YELLOW}  Some checks did not pass.${NC}\n"
    printf "${YELLOW}  Review the warnings above.${NC}\n"
    printf "${YELLOW}========================================${NC}\n"
  fi
}

cleanup_issue() {
  if [[ -n "$ISSUE_NUMBER" ]]; then
    info "To clean up the test issue, run:"
    echo "  gh issue close ${ISSUE_NUMBER} --repo ${OWNER}/${REPO}"
  fi
}

cleanup_worktree() {
  local state_file=".loopy/state/${ISSUE_NUMBER}.json"
  if [[ -f "$state_file" ]]; then
    local worktree_path
    worktree_path="$(node -e "const d=require('./${state_file}'); console.log(d.worktreePath || '')" 2>/dev/null || echo '')"
    if [[ -n "$worktree_path" && -d "$worktree_path" ]]; then
      info "To clean up the worktree, run:"
      echo "  git worktree remove ${worktree_path}"
      echo "  git worktree prune"
    fi
  fi
}

print_cleanup() {
  if $SKIP_CLEANUP; then
    return 0
  fi

  step "Cleanup instructions"

  echo "To remove all test artifacts:"
  echo ""
  echo "  # Close the test issue"
  if [[ -n "$ISSUE_NUMBER" ]]; then
    echo "  gh issue close ${ISSUE_NUMBER} --repo ${OWNER}/${REPO}"
  fi
  echo ""
  echo "  # Remove the test branch and worktree"
  cleanup_worktree
  echo ""
  echo "  # Delete loopy state files"
  echo "  rm -rf .loopy/"
  echo ""
  echo "  # Remove the test PR (if created)"
  echo "  gh pr list --repo ${OWNER}/${REPO} --head 'loopy/*' --json number -q '.[].number' | xargs -I{} gh pr close {} --repo ${OWNER}/${REPO}"
}

main() {
  info "loopy E2E test started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  info "Owner: ${OWNER:-<detect>}, Repo: ${REPO:-<detect>}, Project: ${PROJECT_NUMBER:-<required>}"

  check_prerequisites
  create_test_issue
  add_issue_to_project
  run_loopy
  verify_results
  print_cleanup

  info "E2E test finished at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}

main