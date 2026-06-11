# Changelog

All notable changes to loopy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.0 (2026-06-11)

Initial release. Implements Addy Osmani's Loop Engineering pattern locally with GitHub Projects v2.

### Features

- Foreground loop runner reading from a GitHub Project v2 board
- Per-task git worktrees for isolated changes
- Integration with opencode v2 HTTP API for autonomous code generation
- Shell-command verifier with configurable timeout and retries
- Automatic PR creation via `gh pr create`
- State persistence in `.loopy/state/` for crash recovery
- Interactive init wizard (`loopy init`) with `--yes` flag for defaults
- `loopy run` with `--spawn`, `--once`, `--verbose`, `--config-path` flags
- `loopy status` table showing card states and branches
- `loopy stop` with graceful SIGTERM and 10-second wait
- PID file (`.loopy/loopy.pid`) to prevent duplicate instances
- Configurable columns (Ready, In Progress, In Review, Done, Blocked)
- Auto-approve opencode permissions or manual control

### Architecture

- `@loopy/core` -- loop engine, state machine, config schema, types, interfaces
- `@loopy/gh` -- GitHub Projects v2 GraphQL client
- `@loopy/opencode` -- opencode v2 HTTP API client
- `@loopy/test-utils` -- mock factories for testing
- `@loopy/cli` -- Commander CLI (init, run, status, stop)

Inspired by: https://addyosmani.com/blog/loop-engineering/