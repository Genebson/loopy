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
## F1 Fix: PR body content enrichment (2026-06-11)

**Decision**: Enrich PR body to include verifier command and test output excerpt, as required by the plan.

**Implementation**:
- Added `VerifierResult` import to `loop.ts`
- Added `lastVerifierResult` tracking variable in `processCard()` — tracks the most recent verifier result through both first-run and retry paths
- Modified `openPr()` signature to accept `verifierResult: VerifierResult | null`
- PR body now includes: issue link, verifier command in a code block, and last 2000 chars of stdout as "Test output"
- Body is truncated to 65000 chars (GitHub's limit is 65536, with 500 chars margin for metadata)
- `lastVerifierResult` is set after first verifier run and updated after each retry that passes

**Rationale**: The plan explicitly required "PR opened with body containing: issue link, verifier command, test output excerpt". The previous implementation only had `Implements #N\n\nURL`.
