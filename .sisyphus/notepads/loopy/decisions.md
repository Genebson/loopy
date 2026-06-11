# Loopy — Decisions

## 2026-06-11
- App name: loopy (CLI binary `loopy`, packages `@loopy/*`)
- Tech stack: TS monorepo (pnpm) matching chepibe patterns
- Agent runtime: opencode v2 HTTP API (local ollama)
- GH Projects mode: B (work queue + status mirror)
- Local exec: Foreground CLI first, daemon later
- Worktree: Per-task (Ralph style)
- Done-condition: Shell command exit code
- Verifier default: `pnpm test && pnpm lint`
- Test strategy: Tests after — unit + integration (mocks) + manual E2E
- GH auth: Reuse `gh auth token`
- PR flow: Open PR, move to In Review, wait for human merge
- Config: Per-repo `loopy.config.ts` (Zod)
- OpenCode lifecycle: Configurable (default = assume running, --spawn flag)
- Failure: Retry N (default 3) → Blocked → next
- Concurrency: Sequential (one card at a time)
- Worktree cleanup: Configurable (default: keep)
- Dirty repo recovery: Auto-recover (stash, prune, fast-forward)
- Init: Interactive wizard (discovers GH Project + column IDs)
- Smart ordering: Not in MVP (column order only)
- Documentation: Comprehensive README + docs/ directory (5 files), no JSDoc requirement