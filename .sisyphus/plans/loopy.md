# loopy — Local CLI Loop Runner (Loop Engineering)

## TL;DR

> **Quick Summary**: A local TypeScript CLI (`loopy`) that reads a GitHub Projects v2 board, picks "Ready" cards, dispatches each to opencode (via its HTTP server) inside a fresh git worktree, runs a shell-based verifier, opens a PR, and moves the card to "In Review" — looping until the user stops it.
>
> **Deliverables**:
> - `pnpm` monorepo with 5 packages: `core`, `cli`, `gh`, `opencode`, `test-utils`
> - `loopy init` interactive wizard (discovers GH Project + columns, writes config)
> - `loopy run` foreground loop runner with structured logging
> - `loopy status` / `loopy stop` observability commands
> - Per-repo `loopy.config.ts` (Zod-validated, type-checked)
> - `.loopy/` runtime directory: cache, state, events log
> - Comprehensive test suite: unit + integration (mocks) + manual E2E script
> - Comprehensive README + `docs/` directory with 5 deep-dive files (concepts, configuration, CLI, troubleshooting, security)
>
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES — 5 waves, max 7 tasks parallel
> **Critical Path**: Task 1 (scaffold) → Task 2 (core types/state machine) → Task 5 (loop engine) → Task 6 (CLI) → Task 8 (tests) → F1-F4 (verification)

---

## Context

### Original Request
User asked for an app based on Addy Osmani's "Loop Engineering" tweet/article (https://addyosmani.com/blog/loop-engineering/) that runs locally AND integrates with GitHub Projects.

### Interview Summary

**Key Discussions**:
- **App type**: Meta-loop runner (CLI/daemon) — multi-repo, single binary
- **Agent**: opencode + ollama (local, zero cost) — uses `opencode serve` HTTP API on port 4096
- **GH Projects model**: B — work queue + status mirror (Ready → In Progress → In Review → Done, plus Blocked)
- **Local exec**: Foreground CLI first; daemon is a v0.2 concern
- **Worktree**: Per-task worktree (Ralph style) — one branch per active task, PR from that branch
- **Done-condition**: Shell command exit code (configurable per project, e.g. `pnpm test && pnpm lint`)
- **Tech stack**: TS monorepo (pnpm) matching chepibe patterns (oxlint, vitest, pino)
- **Tests**: Tests-after discipline — unit + integration (mocks) + manual E2E script
- **Auth**: Reuse `gh` CLI token
- **PR flow**: Open PR, move card to "In Review", wait for human merge
- **Config**: Per-repo `loopy.config.ts` (Zod schema)
- **OpenCode lifecycle**: Configurable, default = assume user started it; `--spawn` flag for one-command mode
- **Failure handling**: Retry N times (default 3) → Blocked column with logs as comment → next
- **Concurrency**: Sequential (one card at a time)
- **Worktree cleanup**: Configurable per project (default: keep)
- **Dirty repo recovery**: Auto-recover where safe (stash, prune, fast-forward)
- **Init**: Interactive `loopy init` wizard
- **App name**: `loopy` (CLI binary + `@loopy/*` packages)
- **MVP scope cuts**: No web UI, no `/goal` analog, no cost tracking, no sub-task progress, no auto-add cards, no prompt customization

**Research Findings**:
- **OpenCode v2 API** (`/api/*`) is preferred over v1: `POST /api/session/:id/wait` blocks until idle (eliminates SSE need), `POST /api/session/:id/permission/:requestID/reply` enables clean auto-approval, `X-OpenCode-Directory` header isolates per-request working directory → one opencode serve handles all worktrees
- **GitHub Projects v2** uses GraphQL only (no REST), so we need `@octokit/graphql`
- **Chepibe** patterns: pnpm workspace, dual CJS+ESM build with `add-js-extensions.mjs`, vitest with manual mock factories, pino structured logging, domain exception hierarchy
- **Ralph loop** (the bash-based ancestor) used `prd.json` + `progress.txt` for state; loopy uses GH Project + `.loopy/state/*.json` instead (cloud-visible state, multi-machine observable)

### Metis Review
**Identified Gaps** (addressed in plan):
- **Concurrency risk**: v2 API resolves it (one serve, many worktrees via header). MVP = sequential. Parallel is v0.2.
- **Permission handling**: Use v2 `/api/permission/:id/reply` API, not `--dangerously-skip-permissions` flag.
- **`/wait` blocking timeout**: Add configurable timeout (default 10 min), abort via `POST /session/:id/abort` on timeout.
- **Context exhaustion**: Fresh session per task (aligned with per-task worktree).
- **Empty diff after opencode**: Detect no-changes, post comment, move to next (don't open empty PR).
- **Crash recovery**: Persist per-card state in `.loopy/state/{number}.json`; loop reads it on resume.
- **Auth scope**: Document that PAT must have `repo` + `project` scopes (or use `gh` CLI which already has them).

---

## Work Objectives

### Core Objective
Ship a working MVP of `loopy` — a local CLI that runs the Ralph/Loop-Engineering pattern end-to-end against a real GitHub Project, using opencode (local ollama) as the agent and a shell command as the verifier.

### Concrete Deliverables
- Working `loopy` binary in `apps/cli` (we'll use `apps/` instead of `packages/` for the CLI for clarity; `packages/` for libraries)
- `packages/core` — loop engine, state machine, types, interfaces
- `packages/gh` — GitHub Projects v2 GraphQL client
- `packages/opencode` — opencode v2 API HTTP client
- `packages/test-utils` — mock implementations
- `loopy.config.ts` schema and example
- `loopy init` interactive wizard
- `loopy run` foreground loop runner
- `loopy status` / `loopy stop` commands
- Unit + integration + E2E tests
- Comprehensive README + `docs/` directory (5 files)

### Definition of Done
- [ ] `pnpm install` succeeds at root
- [ ] `pnpm typecheck` passes (0 errors)
- [ ] `pnpm lint` passes (0 errors, oxlint)
- [ ] `pnpm test` passes (all unit + integration tests)
- [ ] `pnpm build` produces `dist/` for all packages
- [ ] `node dist/apps/cli/index.js init --help` shows help
- [ ] `node dist/apps/cli/index.js run --help` shows help
- [ ] E2E script `pnpm e2e` runs end-to-end against a test repo

### Must Have
- All packages type-safe, lint-clean, test-covered
- Loop engine correctly transitions: Ready → InProgress → Verifying → PR → InReview; retry on failure; Blocked after N retries
- Verifier exits 0 = pass, non-zero = fail; respects timeout
- Worktree created per task with unique branch name `loopy/{issue-number}-{slug}`
- PR opened with body containing: issue link, verifier command, test output excerpt
- Card moved to "In Review" via GraphQL mutation
- Comments posted on the issue at every state transition
- Graceful Ctrl+C: saves state, exits 0
- Auto-recovery: stash dirty changes, prune stale worktrees, fast-forward main
- Structured pino logs to `.loopy/events.log` (JSON lines) + pretty TTY output
- `loopy init` discovers GH Project + Status field + column option IDs, caches them
- `loopy.config.ts` Zod-validated, type-checked

### Must NOT Have (Guardrails)
- ❌ Web UI / dashboard
- ❌ Daemon mode (foreground only in v0.1)
- ❌ Multi-iteration `/goal` analog (one tick per card)
- ❌ Token / cost tracking
- ❌ Sub-task progress on issues (sub-checkboxes)
- ❌ Auto-add follow-up cards to Project
- ❌ Custom prompt templates
- ❌ Parallel task processing
- ❌ Creating GH Project columns (loopy expects them to exist)
- ❌ PAT auth (use `gh auth token` only)
- ❌ Any implementation files outside `.sisyphus/` (plan + drafts only in there)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — All verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: NO (greenfield project, we create it)
- **Automated tests**: Tests after — unit, integration, and E2E
- **Framework**: vitest (matches chepibe pattern)
- **Test distribution**:
  - **Unit tests** (colocated with source, `*.test.ts`): state machine, Zod config, utility functions
  - **Integration tests** (`tests/integration/`): worktree manager against temp git repo, verifier runner, full loop cycle with mocked GH + opencode
  - **E2E tests** (`tests/e2e/`): documented manual script `pnpm e2e` that runs against a user-provided test repo (set up by `loopy init --e2e`)

### QA Policy
Every task MUST include agent-executed QA scenarios (see TODO template below).
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (`node` REPL or vitest) — Import, call functions, compare output
- **CLI commands**: Use Bash + tmux — Run `node dist/cli/index.js <cmd>`, capture stdout/stderr/exit code
- **Integration**: Use vitest with mocked HTTP servers
- **E2E**: Use Bash — run `pnpm e2e` script that exercises full path against a sandbox repo

---

## Execution Strategy

### Parallel Execution Waves

> Maximize throughput by grouping independent tasks into parallel waves.
> Each wave completes before the next begins.
> Target: 5-8 tasks per wave. Fewer than 3 per wave (except final) = under-splitting.

```
Wave 1 (Foundation — scaffold + types):
├── Task 1: Monorepo scaffold (pnpm, tsconfig refs, oxlint, vitest, build scripts)
├── Task 2: @loopy/core — types, interfaces, Zod config schema, errors
└── Task 3: @loopy/test-utils — mock factories for GH + opencode clients

Wave 2 (Clients — independent libraries):
├── Task 4: @loopy/gh — GitHub Projects v2 GraphQL client
└── Task 5: @loopy/opencode — opencode v2 API HTTP client (with /wait, /permission)

Wave 3 (Core engine + side-effect implementations):
├── Task 6: @loopy/core — loop engine (state machine + transitions)
├── Task 7: @loopy/core — WorktreeManager (git worktree per task, recovery)
└── Task 8: @loopy/core — VerifierRunner (shell command + timeout + env)

Wave 4 (CLI + integration):
├── Task 9: @loopy/cli — Commander setup, init command (wizard)
├── Task 10: @loopy/cli — run, status, stop commands + signal handling
└── Task 11: Wire everything: pino logging, .loopy/ dir, state persistence

Wave 5 (Tests + docs):
├── Task 12: Unit tests (state machine, config, clients, worktree, verifier)
├── Task 13: Integration tests (full loop cycle with mocks, recovery scenarios)
├── Task 14: E2E script + README + architecture diagram
└── Task 15: Final polish — error messages, --help, --version, examples

Wave FINAL (4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA against sandbox repo (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: 1 → 2 → 6 → 10 → 11 → 14 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Waves 1, 2, 3)
```

### Dependency Matrix

- **1**: - (none) — 2, 3, 4, 5, 6, 7, 8
- **2**: 1 — 4, 5, 6, 7, 8, 11
- **3**: 1 — 4, 5, 12, 13
- **4**: 2, 3 — 6, 9, 11, 12
- **5**: 2, 3 — 6, 10, 11, 12
- **6**: 2, 4, 5, 7, 8 — 11, 12, 13
- **7**: 2 — 6, 11, 12, 13
- **8**: 2 — 6, 11, 12, 13
- **9**: 4 — 11, 13
- **10**: 5, 6, 11 — 13
- **11**: 6, 7, 8, 9, 10 — 12, 13
- **12**: 3, 4, 5, 6, 7, 8 — 13
- **13**: 6, 9, 10, 11, 12 — 14
- **14**: 13 — F1
- **15**: 11, 14 — F1

### Agent Dispatch Summary

- **Wave 1**: Tasks 1, 2, 3 (parallel) — `quick` × 3
- **Wave 2**: Tasks 4, 5 (parallel) — `quick` × 2
- **Wave 3**: Tasks 6, 7, 8 (parallel) — `quick` for 7, 8; `unspecified-high` for 6
- **Wave 4**: Tasks 9, 10, 11 (parallel after wave 3) — `unspecified-high` for 10, 11; `quick` for 9
- **Wave 5**: Tasks 12, 13, 14, 15 (parallel after wave 4) — `deep` for 13, 14; `unspecified-high` for 12, 15
- **FINAL**: 4 parallel reviews

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

### Wave 1 — Foundation (parallel)

- [x] 1. Monorepo scaffold (pnpm, tsconfig refs, oxlint, vitest, build scripts)

  **What to do**:
  - Create `pnpm-workspace.yaml` with `apps/*` and `packages/*` entries
  - Root `package.json` with name `loopy-monorepo`, scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `clean`)
  - Root `tsconfig.json` with project references to all 5 packages
  - Root `.oxlintrc.json` (match chepibe pattern: `oxlint .`)
  - Root `vitest.config.ts` (workspace mode)
  - Root `.gitignore` (node_modules, dist, .loopy, *.log, .env)
  - `AGENTS.md` (instructs future agents: build order, test commands, no go files outside allowed paths)
  - `README.md` (skeleton — will be filled in Task 14)
  - Create empty package directories: `apps/cli/`, `packages/{core,gh,opencode,test-utils}/` each with stub `package.json`, `tsconfig.json`, `tsconfig.esm.json`, `src/index.ts`
  - Copy `add-js-extensions.mjs` script from chepibe (handles ESM import resolution)
  - Set `packageManager: pnpm@10.33.0` and `engines.node: ">=25.0.0"` in root

  **Must NOT do**:
  - Don't add cloud services, Docker, telemetry, or any infra chepibe doesn't have
  - Don't add features beyond what's needed for the build to typecheck and lint
  - Don't use `npm` or `yarn` configs

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: This is mostly file scaffolding with config files — mechanical, well-defined
  - **Skills**: `[]`
    - No specialized skills needed; just precise config file creation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7, 8
  - **Blocked By**: None (can start immediately)

  **References**:
  - **Pattern References**:
    - `freelance/fibra/chepibe/pnpm-workspace.yaml` — workspace config pattern
    - `freelance/fibra/chepibe/package.json` — root package.json structure (oxlint, scripts, packageManager)
    - `freelance/fibra/chepibe/packages/shared/package.json` — per-package conventions
    - `freelance/fibra/chepibe/packages/shared/tsconfig.json` and `tsconfig.esm.json` — dual CJS+ESM build pattern
  - **External References**:
    - pnpm workspace docs: https://pnpm.io/workspaces
    - TypeScript project references: https://www.typescriptlang.org/docs/handbook/project-references.html
    - oxlint config: https://oxc.rs/docs/guide/usage/linter.html

  **Acceptance Criteria**:
  - [ ] `pnpm install` at root succeeds with 0 errors
  - [ ] `pnpm typecheck` runs (will pass trivially since stubs are empty)
  - [ ] `pnpm lint` passes
  - [ ] All 5 package directories exist with stub `package.json`
  - [ ] `pnpm-workspace.yaml` lists `apps/*` and `packages/*`
  - [ ] `tsconfig.json` references all 5 packages
  - [ ] `AGENTS.md` exists with build/test instructions

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: pnpm install succeeds
    Tool: Bash
    Preconditions: clean directory, node >=25, pnpm >=10
    Steps:
      1. cd /Users/mauriciogenebrieres/programming/projects/freelance/loop-ap
      2. Run: pnpm install
    Expected Result: "Done" message, no errors, lockfile created
    Failure Indicators: ERR_PNPM_PEER_DEP_ISSUES, missing files, syntax errors
    Evidence: .sisyphus/evidence/task-1-pnpm-install.log

  Scenario: TypeScript project references resolve
    Tool: Bash
    Preconditions: pnpm install succeeded
    Steps:
      1. Run: pnpm typecheck
    Expected Result: Exit code 0, no errors output
    Failure Indicators: "Cannot find module", "Project reference may not be circular"
    Evidence: .sisyphus/evidence/task-1-typecheck.log

  Scenario: Workspace packages are linked
    Tool: Bash
    Preconditions: pnpm install succeeded
    Steps:
      1. Run: ls -la node_modules/@loopy/
    Expected Result: Symlinks to ../../packages/* and ../../apps/* for each package
    Failure Indicators: empty directory, no symlinks
    Evidence: .sisyphus/evidence/task-1-workspace-link.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-1-pnpm-install.log`
  - [ ] `.sisyphus/evidence/task-1-typecheck.log`
  - [ ] `.sisyphus/evidence/task-1-workspace-link.txt`

  **Commit**: YES
  - Message: `chore(scaffold): init pnpm monorepo with tsconfig refs and oxlint`
  - Files: `pnpm-workspace.yaml`, `package.json`, `tsconfig.json`, `.oxlintrc.json`, `vitest.config.ts`, `.gitignore`, `AGENTS.md`, `README.md`, `apps/cli/**`, `packages/**/package.json`, `packages/**/tsconfig*.json`
  - Pre-commit: `pnpm install && pnpm typecheck && pnpm lint`

- [x] 2. @loopy/core — types, interfaces, Zod config schema, errors

  **What to do**:
  - Define domain types in `packages/core/src/types/`:
    - `card.ts` — `GitHubCard` (id, contentId, title, body, columnId, assignees, labels, url)
    - `column.ts` — `Column` (id, name, role: 'ready'|'inProgress'|'inReview'|'done'|'blocked')
    - `worktree.ts` — `Worktree` (path, branch, issueNumber, createdAt)
    - `verifier.ts` — `VerifierResult` (passed, exitCode, stdout, stderr, durationMs)
    - `session.ts` — `OpenCodeSession` (id, url, status, messages, worktreePath)
  - Define client interfaces (so engine is decoupled from impls):
    - `GHClient` — `listReadyCards()`, `moveCard(cardId, columnId)`, `addComment(cardId, body)`, `getCard(id)`, `getFieldOptions(fieldId)`
    - `OpenCodeClient` — `createSession(worktreePath)`, `sendPrompt(sessionId, prompt)`, `waitForIdle(sessionId, timeoutMs)`, `getMessages(sessionId)`, `replyPermission(sessionId, reqId, decision)`, `abortSession(sessionId)`
    - `WorktreeManager` — `create(issueNumber, slug)`, `remove(path)`, `list()`, `recover()`
    - `VerifierRunner` — `run(command, cwd, env, timeoutMs)`
  - Define Zod schema for `loopy.config.ts`:
    ```typescript
    {
      project: z.union([z.object({owner: z.string(), number: z.number()}), z.object({id: z.string()})]),
      columns: z.object({
        ready: z.string(), inProgress: z.string(), inReview: z.string(),
        done: z.string(), blocked: z.string()
      }),
      verifier: z.object({
        command: z.string(),
        timeout: z.number().int().positive().default(600_000),
        env: z.record(z.string()).optional()
      }),
      retries: z.number().int().min(0).default(3),
      opencode: z.object({
        url: z.string().url().default('http://localhost:4096'),
        autoApprove: z.boolean().default(true),
        spawn: z.boolean().default(false)
      }),
      concurrency: z.number().int().positive().default(1),
      pollInterval: z.number().int().positive().default(60_000),
      worktree: z.object({ cleanup: z.boolean().default(false) })
    }
    ```
  - Define domain exception hierarchy in `packages/core/src/errors/`:
    - `LoopyError` (base, has `code: string`, `userMessage: string`)
    - `ConfigError`, `GHAPIError`, `OpenCodeError`, `WorktreeError`, `VerifierError`, `TimeoutError`
    - All implement `toJSON()` for structured logging

  **Must NOT do**:
  - Don't implement clients here (separate packages)
  - Don't implement engine here (Task 6)
  - Don't add Zod refinements not listed above
  - Don't use `any` types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type and schema definition, well-bounded
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 5, 6, 7, 8, 11
  - **Blocked By**: Task 1

  **References**:
  - **Pattern References**:
    - `freelance/fibra/chepibe/packages/shared/src/` — see how types are organized in a real chepibe package
    - `freelance/fibra/chepibe/packages/whatsapp-worker/` — domain exception hierarchy pattern
  - **External References**:
    - Zod documentation: https://zod.dev/
    - TypeScript interface design: prefer narrow unions over optionals

  **Acceptance Criteria**:
  - [ ] All type files compile with 0 errors
  - [ ] All interface files export their types
  - [ ] Zod schema validates a valid example config
  - [ ] Zod schema rejects an invalid config (missing required field)
  - [ ] All exception classes extend `LoopyError`
  - [ ] `pnpm typecheck` passes for `packages/core`

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Valid config passes Zod validation
    Tool: Bash (vitest)
    Preconditions: packages/core compiled
    Steps:
      1. Import the schema in a vitest test
      2. Call schema.parse() with a valid example config
      3. Assert result equals input
    Expected Result: parsed object matches input, no error thrown
    Failure Indicators: ZodError thrown
    Evidence: .sisyphus/evidence/task-2-zod-valid.json

  Scenario: Invalid config fails with clear message
    Tool: Bash (vitest)
    Steps:
      1. Call schema.parse() with config missing 'verifier.command'
      2. Assert ZodError is thrown
      3. Assert error message contains "verifier" or "command"
    Expected Result: error thrown, error message identifies the missing field
    Evidence: .sisyphus/evidence/task-2-zod-invalid.txt

  Scenario: All client interfaces are exported
    Tool: Bash
    Preconditions: package built
    Steps:
      1. Run: node -e "const c = require('./packages/core/dist/cjs'); console.log(Object.keys(c))"
    Expected Result: GHClient, OpenCodeClient, WorktreeManager, VerifierRunner all appear in output
    Failure Indicators: undefined in output
    Evidence: .sisyphus/evidence/task-2-exports.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-2-zod-valid.json`
  - [ ] `.sisyphus/evidence/task-2-zod-invalid.txt`
  - [ ] `.sisyphus/evidence/task-2-exports.txt`

  **Commit**: YES
  - Message: `feat(core): add types, interfaces, and Zod config schema`
  - Files: `packages/core/src/types/*`, `packages/core/src/interfaces/*`, `packages/core/src/config/schema.ts`, `packages/core/src/errors/*`, `packages/core/src/index.ts`
  - Pre-commit: `pnpm typecheck && pnpm test --filter @loopy/core`

- [x] 3. @loopy/test-utils — mock factories for GH and opencode clients

  **What to do**:
  - Create `packages/test-utils/src/`:
    - `mocks/gh.ts` — `createMockGHClient(overrides?)` returns object implementing `GHClient` with `vi.fn()` for all methods. Default behaviors: listReadyCards returns [], moveCard resolves, addComment resolves.
    - `mocks/opencode.ts` — `createMockOpenCodeClient(overrides?)` returns object implementing `OpenCodeClient` with `vi.fn()` defaults
    - `mocks/worktree.ts` — `createMockWorktreeManager(overrides?)` for WorktreeManager
    - `mocks/verifier.ts` — `createMockVerifierRunner(overrides?)` for VerifierRunner
    - `factories/card.ts` — `createTestCard(overrides?)` factory
    - `factories/session.ts` — `createTestSession(overrides?)` factory
    - `factories/config.ts` — `createTestConfig(overrides?)` factory (validates against Zod schema)
  - All mocks use Vitest's `vi.fn()` for call tracking
  - Export a single `index.ts` barrel for ergonomic imports: `import { createMockGHClient, createTestCard } from '@loopy/test-utils'`

  **Must NOT do**:
  - Don't add real HTTP server mocking (use vi.fn)
  - Don't add fixtures or sample data
  - Don't depend on @loopy/core's *implementations* (only the interfaces)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical factory functions
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5, 12, 13
  - **Blocked By**: Task 1

  **References**:
  - **Pattern References**:
    - `freelance/fibra/chepibe/.opencode/` — see mock patterns used in chepibe tests
    - `freelance/fibra/chepibe/packages/whatsapp-worker/src/**/__tests__/` — vitest mock factory patterns
  - **External References**:
    - Vitest mocking: https://vitest.dev/guide/mocking.html
    - `vi.fn()`: https://vitest.dev/api/vi.html#vi-fn

  **Acceptance Criteria**:
  - [ ] All mock factories export and return objects implementing the correct interface
  - [ ] Factories accept an `overrides` parameter that uses `Object.assign` to merge
  - [ ] All test data factories produce objects passing Zod validation (for config) or matching type
  - [ ] `pnpm test --filter @loopy/test-utils` passes (with a trivial smoke test)
  - [ ] `pnpm typecheck` passes for `packages/test-utils`

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: createMockGHClient returns valid GHClient
    Tool: Bash (vitest)
    Steps:
      1. Import createMockGHClient in a test
      2. Assert returned object has all 5 methods (listReadyCards, moveCard, addComment, getCard, getFieldOptions)
      3. Assert each method is a vi.fn() (has .mock.calls array)
    Expected Result: All assertions pass
    Evidence: .sisyphus/evidence/task-3-mock-gh.json

  Scenario: createTestConfig produces a Zod-valid config
    Tool: Bash (vitest)
    Steps:
      1. Import createTestConfig
      2. Call it, then validate the result with the schema from @loopy/core
      3. Assert validation succeeds
    Expected Result: no ZodError thrown
    Evidence: .sisyphus/evidence/task-3-test-config.json

  Scenario: Factory overrides are merged
    Tool: Bash (vitest)
    Steps:
      1. Call createTestCard({ title: 'Custom' })
      2. Assert the returned card has title === 'Custom' but other fields are defaults
    Expected Result: Custom title preserved, all other defaults present
    Evidence: .sisyphus/evidence/task-3-factory-override.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-3-mock-gh.json`
  - [ ] `.sisyphus/evidence/task-3-test-config.json`
  - [ ] `.sisyphus/evidence/task-3-factory-override.json`

  **Commit**: YES
  - Message: `feat(test-utils): add mock factories for GH and opencode clients`
  - Files: `packages/test-utils/src/**`, `packages/test-utils/package.json`
  - Pre-commit: `pnpm typecheck && pnpm test --filter @loopy/test-utils`

### Wave 2 — Clients (parallel)

- [x] 4. @loopy/gh — GitHub Projects v2 GraphQL client

  **What to do**:
  - Implement `GHClient` interface from `@loopy/core` in `packages/gh/src/client.ts`
  - Use `@octokit/graphql` as the underlying transport
  - Auth: read token from `gh auth token` (via `execSync('gh auth token')`); throw clear error if `gh` not installed
  - Methods to implement (all return Promises, throw `GHAPIError` on failure):
    - `getProject({ owner, number })` — fetch project by org/repo + number
    - `getFieldOptions(projectId, fieldName)` — fetch Status field options, return map of name → option ID
    - `listReadyCards(projectId, readyColumnOptionId)` — query items in Ready column, return `GitHubCard[]` (paginated)
    - `getCard(cardId)` — fetch single card with full content
    - `moveCard(cardId, columnOptionId)` — mutation: `updateProjectV2ItemFieldValue`
    - `addComment(cardId, body)` — mutation: `addComment` on the underlying issue
    - `getIssue(issueId)` — fetch issue body, title, assignees
  - Cache project ID + field option IDs in `.loopy/cache.json` (read on construction, write on fetch)
  - Map GraphQL errors to `GHAPIError` with `code` (RATE_LIMITED, NOT_FOUND, UNAUTHORIZED, etc.) and `userMessage`
  - Add 1 retry with exponential backoff on 5xx / RATE_LIMITED errors
  - Add unit tests using `nock` or `msw` to mock GraphQL responses (or use `graphql-request` mock middleware)

  **Must NOT do**:
  - Don't support PAT auth (only `gh auth token`)
  - Don't create Projects or columns (read-only on structure)
  - Don't use REST endpoints (GraphQL only for Projects v2)
  - Don't add retry logic beyond 1 retry

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Wrapper around well-documented library; mechanical mapping
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Tasks 6, 9, 11, 12
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - **External References**:
    - GitHub Projects v2 GraphQL API: https://docs.github.com/en/graphql/reference/objects#projectv2
    - `@octokit/graphql`: https://github.com/octokit/graphql.js
    - GraphQL query for Project items: https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-and-cli-for-projects
  - **Pattern References**:
    - `freelance/fibra/chepibe/packages/whatsapp-worker/src/` — how chepibe handles external API errors (typed exception hierarchy)

  **Acceptance Criteria**:
  - [ ] All `GHClient` methods implemented and exported
  - [ ] `gh auth token` is called once on construction and the token used for subsequent calls
  - [ ] `.loopy/cache.json` is read on construction, written on first API call
  - [ ] Unit tests pass with mocked GraphQL transport
  - [ ] `pnpm typecheck` and `pnpm lint` pass

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Token acquisition succeeds when gh CLI is authenticated
    Tool: Bash
    Preconditions: `gh auth status` succeeds
    Steps:
      1. Create a tiny Node script that calls the GHClient constructor
      2. Assert no error thrown, client object returned
    Expected Result: client constructed, token obtained
    Failure Indicators: "gh CLI not found" or "not authenticated" error
    Evidence: .sisyphus/evidence/task-4-gh-auth.log

  Scenario: listReadyCards returns parsed cards from mocked GraphQL
    Tool: Bash (vitest)
    Preconditions: nock or msw set up
    Steps:
      1. Mock the GraphQL endpoint with a sample response containing 2 items
      2. Call listReadyCards
      3. Assert result has length 2 and matches expected GitHubCard shape
    Expected Result: 2 cards returned, all fields populated
    Failure Indicators: empty array, malformed objects
    Evidence: .sisyphus/evidence/task-4-list-cards.json

  Scenario: moveCard issues correct GraphQL mutation
    Tool: Bash (vitest)
    Preconditions: nock intercepting
    Steps:
      1. Mock the mutation endpoint
      2. Call moveCard('item_123', 'opt_456')
      3. Assert the request body contains correct field value update
    Expected Result: mutation called with correct variables
    Evidence: .sisyphus/evidence/task-4-move-mutation.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-4-gh-auth.log`
  - [ ] `.sisyphus/evidence/task-4-list-cards.json`
  - [ ] `.sisyphus/evidence/task-4-move-mutation.json`

  **Commit**: YES
  - Message: `feat(gh): implement GitHub Projects v2 GraphQL client`
  - Files: `packages/gh/src/**`
  - Pre-commit: `pnpm typecheck && pnpm lint && pnpm test --filter @loopy/gh`

- [x] 5. @loopy/opencode — opencode v2 API HTTP client

  **What to do**:
  - Implement `OpenCodeClient` interface from `@loopy/core` in `packages/opencode/src/client.ts`
  - Use Node's built-in `fetch` (Node 22+) — no need for axios/got
  - **Use v2 API at `/api/*`** (not v1 at `/session/*`):
    - `POST /api/session` — create session; pass `X-OpenCode-Directory: <worktree-path>` header
    - `POST /api/session/:id/prompt` — body: `{ content, parts, agent?, model? }`
    - `POST /api/session/:id/wait` — body: `{ timeout? }` — BLOCKS until session is idle (this is the key insight from research)
    - `GET /api/session/:id/message?order=asc&limit=N` — paginated messages
    - `GET /api/session/:id/permission` — list pending permissions
    - `POST /api/session/:id/permission/:requestID/reply` — body: `{ decision: 'allow'|'deny' }`
    - `POST /session/:id/abort` — abort running session (note: v1 path, only place we use v1)
  - `createSession(worktreePath)` — POST /api/session with `X-OpenCode-Directory` header, return session ID
  - `sendPrompt(sessionId, prompt)` — POST /api/session/:id/prompt; don't wait
  - `waitForIdle(sessionId, timeoutMs)` — POST /api/session/:id/wait; throws `OpenCodeError` with `code: 'TIMEOUT'` if exceeds timeoutMs
  - `getMessages(sessionId, sinceMessageId?)` — GET /api/session/:id/message?order=asc
  - `replyPermission(sessionId, reqId, decision)` — POST /api/session/:id/permission/:reqId/reply
  - `abortSession(sessionId)` — POST /session/:id/abort
  - Add helper: `pollPermissionsAndApprove(sessionId, intervalMs)` — runs in background, polls /permission, auto-approves with 'allow' if `config.opencode.autoApprove === true`
  - Map all errors to `OpenCodeError` with `code` (CONNECTION_REFUSED, SESSION_TIMEOUT, etc.)
  - All requests include `X-OpenCode-Directory` header
  - Unit tests using `nock` to mock HTTP responses (or `msw`)

  **Must NOT do**:
  - Don't use SSE streaming (use /wait endpoint instead)
  - Don't use v1 endpoints except for /session/:id/abort
  - Don't depend on the `@opencode-ai/sdk` if it forces v1 patterns (write raw fetch calls)
  - Don't add WebSocket support

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: HTTP client wrapper, well-defined endpoints
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Tasks 6, 10, 11, 12
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - **External References**:
    - opencode server docs: https://dev.opencode.ai/docs/server/
    - opencode v2 API: `/api/session/*` endpoints (Effect-HttpApi based)
    - opencode CLI docs: https://dev.opencode.ai/docs/cli/ (for `opencode serve` flag reference)
  - **Pattern References**:
    - chepibe uses pino for structured logging — match that error format

  **Acceptance Criteria**:
  - [ ] All `OpenCodeClient` methods implemented
  - [ ] `waitForIdle` throws `OpenCodeError` with `code: 'TIMEOUT'` when exceeding timeoutMs
  - [ ] `X-OpenCode-Directory` header is set on every request
  - [ ] `pollPermissionsAndApprove` only auto-approves when `config.opencode.autoApprove === true`
  - [ ] Unit tests pass with mocked fetch
  - [ ] `pnpm typecheck` and `pnpm lint` pass

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: createSession sends X-OpenCode-Directory header
    Tool: Bash (vitest)
    Preconditions: nock intercepting
    Steps:
      1. Mock POST /api/session to return { id: 'sess_1' }
      2. Call createSession('/tmp/worktree-123')
      3. Assert request had header 'X-OpenCode-Directory: /tmp/worktree-123'
    Expected Result: header present in request
    Failure Indicators: header missing or different value
    Evidence: .sisyphus/evidence/task-5-header.txt

  Scenario: waitForIdle times out cleanly
    Tool: Bash (vitest)
    Preconditions: nock set to never respond (or respond after 200ms with slow())
    Steps:
      1. Call waitForIdle('sess_1', 100)
      2. Catch the thrown error
      3. Assert error.code === 'TIMEOUT' and error is OpenCodeError instance
    Expected Result: OpenCodeError thrown with code 'TIMEOUT' after ~100ms
    Evidence: .sisyphus/evidence/task-5-timeout.json

  Scenario: pollPermissionsAndApprove only auto-approves when configured
    Tool: Bash (vitest)
    Preconditions: nock intercepting /permission endpoint with 1 pending request
    Steps:
      1. Call pollPermissionsAndApprove('sess_1', 10) with autoApprove=false
      2. Assert no reply endpoint was hit
      3. Then call with autoApprove=true
      4. Assert reply endpoint was hit with decision='allow'
    Expected Result: autoApprove=false → no approval, autoApprove=true → approval sent
    Evidence: .sisyphus/evidence/task-5-auto-approve.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-5-header.txt`
  - [ ] `.sisyphus/evidence/task-5-timeout.json`
  - [ ] `.sisyphus/evidence/task-5-auto-approve.json`

  **Commit**: YES
  - Message: `feat(opencode): implement v2 API HTTP client with /wait and /permission`
  - Files: `packages/opencode/src/**`
  - Pre-commit: `pnpm typecheck && pnpm lint && pnpm test --filter @loopy/opencode`

### Wave 3 — Core engine + side-effect implementations (parallel)

- [x] 6. @loopy/core — loop engine (state machine + transitions)

  **What to do**:
  - Implement the state machine in `packages/core/src/engine/state-machine.ts` as a pure function `(state, event) → newState`:
    - **States**: `Idle`, `Picking`, `InProgress`, `Verifying`, `PR`, `InReview`, `FailedRetry`, `Blocked`, `Done`
    - **Events**: `CARD_PICKED`, `SESSION_CREATED`, `PROMPT_SENT`, `VERIFIER_PASSED`, `VERIFIER_FAILED`, `PR_OPENED`, `CARD_MOVED`, `RETRY`, `GIVE_UP`, `ERROR`
  - Implement `LoopEngine` class in `packages/core/src/engine/loop.ts`:
    - Constructor takes: `GHClient`, `OpenCodeClient`, `WorktreeManager`, `VerifierRunner`, `config`, `logger`
    - Main method: `run(signal: AbortSignal)` — loops until signal aborted
    - For each iteration:
      1. List Ready cards
      2. Pick first card (sequential)
      3. Create worktree (`worktree.create(issueNumber, slug)`)
      4. Move card to InProgress
      5. Post comment: "loopy started, branch `loopy/{n}-{slug}`"
      6. Create opencode session in worktree
      7. Send prompt (default template)
      8. Start background permission auto-approval (if configured)
      9. Wait for idle (with timeout)
      10. Stop permission polling
      11. Run verifier in worktree
      12. If passed: check `git diff main` for empty → if empty, post comment "no changes" and skip to step 16
      13. Commit changes
      14. Push branch
      15. Open PR via `gh pr create`
      16. Move card to InReview
      17. Post comment with PR link
      18. If worktree.cleanup === true, remove worktree
      19. Mark card state as `Done` in `.loopy/state/`
    - On verifier failure: increment retry count; if < retries, go to `FailedRetry` → loop back to step 5 (verifier re-runs)
    - On max retries: move to `Blocked`, post failure logs as comment, mark state as `Blocked`
  - Persist per-card state to `.loopy/state/{issue-number}.json` after every transition
  - On startup: read `.loopy/state/` and skip cards already in `Done` or `Blocked`
  - Emit events to a logger (Pino) at every state transition with card ID, from-state, to-state, duration
  - Handle errors per-card (don't crash the loop): catch error, log, mark card as `Blocked` with error message, continue to next

  **Must NOT do**:
  - Don't process cards in parallel
  - Don't add a `/goal` analog (one tick per card)
  - Don't add cost tracking
  - Don't auto-add follow-up cards
  - Don't customize the prompt template

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: State machine + multi-step orchestration is the most complex single piece
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: Tasks 11, 12, 13
  - **Blocked By**: Tasks 2, 4, 5, 7, 8

  **References**:
  - **External References**:
    - Addy Osmani's article: https://addyosmani.com/blog/loop-engineering/ (background on the concept)
    - Ralph loop reference: https://ghuntley.com/ralph/ (original bash implementation pattern)
    - State machine patterns: https://refactoring.guru/design-patterns/state
  - **Pattern References**:
    - `freelance/fibra/chepibe/packages/whatsapp-worker/src/queues/` — see how chepibe orchestrates multi-step async work

  **Acceptance Criteria**:
  - [ ] State machine is a pure function with full type coverage of all state × event combinations
  - [ ] `LoopEngine.run(signal)` runs to completion (or aborts cleanly on signal)
  - [ ] Per-card state persists to `.loopy/state/{n}.json` after every transition
  - [ ] On restart, cards already in `Done`/`Blocked` are skipped
  - [ ] Errors per card are caught, logged, and don't crash the loop
  - [ ] All transitions emit structured log events
  - [ ] Unit tests cover all happy paths AND all error paths

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: State machine: Verifier passes → Done
    Tool: Bash (vitest)
    Steps:
      1. Start in InProgress, fire VERIFIER_PASSED
      2. Assert state == Done
    Expected Result: state transition correct
    Evidence: .sisyphus/evidence/task-6-sm-pass.txt

  Scenario: State machine: Verifier fails < retries → FailedRetry
    Tool: Bash (vitest)
    Steps:
      1. Start in Verifying with retriesLeft=2, fire VERIFIER_FAILED
      2. Assert state == FailedRetry, retriesLeft=1
    Evidence: .sisyphus/evidence/task-6-sm-retry.txt

  Scenario: State machine: Verifier fails at max retries → Blocked
    Tool: Bash (vitest)
    Steps:
      1. Start in Verifying with retriesLeft=0, fire VERIFIER_FAILED
      2. Assert state == Blocked
    Evidence: .sisyphus/evidence/task-6-sm-blocked.txt

  Scenario: Full happy-path loop with mocked clients
    Tool: Bash (vitest)
    Preconditions: temp git repo, mock GH returning 1 ready card, mock opencode returning PASS, mock verifier returning exit 0
    Steps:
      1. Construct LoopEngine with mocks
      2. Call run() with AbortSignal that aborts after 1 iteration
      3. Assert: worktree was created, card was moved to InReview, PR was opened, state file shows Done
    Expected Result: all side effects called, state persisted
    Evidence: .sisyphus/evidence/task-6-full-happy.json

  Scenario: Loop continues after per-card error
    Tool: Bash (vitest)
    Preconditions: 2 ready cards, first one throws on sendPrompt, second succeeds
    Steps:
      1. Run loop for both
      2. Assert: first card is Blocked with error comment, second is Done
    Expected Result: loop doesn't crash, processes both cards
    Evidence: .sisyphus/evidence/task-6-error-recovery.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-6-sm-pass.txt`
  - [ ] `.sisyphus/evidence/task-6-sm-retry.txt`
  - [ ] `.sisyphus/evidence/task-6-sm-blocked.txt`
  - [ ] `.sisyphus/evidence/task-6-full-happy.json`
  - [ ] `.sisyphus/evidence/task-6-error-recovery.json`

  **Commit**: YES
  - Message: `feat(core): implement loop engine state machine`
  - Files: `packages/core/src/engine/**`
  - Pre-commit: `pnpm typecheck && pnpm test --filter @loopy/core`

- [x] 7. @loopy/core — WorktreeManager (git worktree per task, recovery)

  **What to do**:
  - Implement `WorktreeManager` in `packages/core/src/worktree/manager.ts`
  - Use `simple-git` library for git operations
  - Methods:
    - `create(issueNumber, slug)` — create worktree at `.loopy/worktrees/{issue-number}-{slug}` from branch `loopy/{issue-number}-{slug}`. Throws `WorktreeError` with code `ALREADY_EXISTS` if path exists.
    - `remove(path)` — git worktree remove, then prune
    - `list()` — returns existing worktrees
    - `recover()` — auto-recovery: stashes dirty changes, prunes stale worktrees whose branches are merged, fast-forwards main
    - `hasChanges(path, baseBranch)` — returns true if `git diff {baseBranch}` is non-empty
    - `commit(path, message)` — `git add -A && git commit -m`
    - `push(path)` — `git push -u origin {branch}`
    - `getCurrentBranch(path)` — returns branch name
  - All methods validate the path is inside the configured `repoPath` (security: prevent escaping)
  - `recover()` logic:
    1. Check `git status --porcelain` — if dirty, run `git stash push -u -m "loopy auto-stash"`
    2. List worktrees, for each that is stale (branch merged into main), prune
    3. `git fetch origin && git checkout main && git merge --ff-only origin/main`
  - Integration tests use a real temp git repo created with `simple-git`'s `init()` + `commit()`

  **Must NOT do**:
  - Don't allow paths outside the configured repo
  - Don't use shell `exec` for git commands (use simple-git library)
  - Don't add force-push or destructive operations beyond what's listed
  - Don't add submodules handling

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Git operations are well-defined, simple-git is a thin wrapper
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 8)
  - **Blocks**: Tasks 6 (actually 6 depends on 7), 11, 12, 13
  - **Blocked By**: Task 2

  **References**:
  - **External References**:
    - `simple-git` library: https://github.com/steveukx/git-js
    - `git worktree` docs: https://git-scm.com/docs/git-worktree
  - **Pattern References**:
    - chepibe's build system: `freelance/fibra/chepibe/scripts/` for any shell-out patterns to avoid

  **Acceptance Criteria**:
  - [ ] All WorktreeManager methods implemented
  - [ ] `create` throws `WorktreeError` with code `ALREADY_EXISTS` if path exists
  - [ ] Path validation prevents escaping repo root
  - [ ] `recover()` stashes dirty, prunes merged, fast-forwards main
  - [ ] Integration tests pass with real temp git repo
  - [ ] `pnpm typecheck` and `pnpm lint` pass

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: create() makes worktree on a new branch
    Tool: Bash (vitest)
    Preconditions: temp git repo with one commit on main
    Steps:
      1. Call create(42, 'fix-auth')
      2. Assert directory .loopy/worktrees/42-fix-auth exists
      3. Assert branch loopy/42-fix-auth exists
      4. Assert working tree is clean
    Expected Result: worktree created, on correct branch
    Evidence: .sisyphus/evidence/task-7-create.txt

  Scenario: create() throws ALREADY_EXISTS on duplicate
    Tool: Bash (vitest)
    Preconditions: temp repo, call create(42, 'fix-auth') once successfully
    Steps:
      1. Call create(42, 'fix-auth') again
      2. Assert WorktreeError thrown with code 'ALREADY_EXISTS'
    Evidence: .sisyphus/evidence/task-7-duplicate.json

  Scenario: recover() stashes dirty changes
    Tool: Bash (vitest)
    Preconditions: temp repo, modify a tracked file (uncommitted)
    Steps:
      1. Call recover()
      2. Assert working tree is clean
      3. Assert git stash list contains "loopy auto-stash"
    Expected Result: dirty changes stashed
    Evidence: .sisyphus/evidence/task-7-stash.txt

  Scenario: Path traversal attempt is rejected
    Tool: Bash (vitest)
    Steps:
      1. Call create with a crafted issueNumber that resolves to path '../../etc'
      2. Assert WorktreeError thrown with code 'INVALID_PATH'
    Evidence: .sisyphus/evidence/task-7-traversal.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-7-create.txt`
  - [ ] `.sisyphus/evidence/task-7-duplicate.json`
  - [ ] `.sisyphus/evidence/task-7-stash.txt`
  - [ ] `.sisyphus/evidence/task-7-traversal.json`

  **Commit**: YES
  - Message: `feat(core): implement WorktreeManager with auto-recovery`
  - Files: `packages/core/src/worktree/**`
  - Pre-commit: `pnpm typecheck && pnpm test --filter @loopy/core`

- [x] 8. @loopy/core — VerifierRunner (shell command + timeout + env)

  **What to do**:
  - Implement `VerifierRunner` in `packages/core/src/verifier/runner.ts`
  - Use Node's `child_process.spawn` (NOT exec) for proper signal/timeout handling
  - `run(command, cwd, env, timeoutMs)`:
    - Parse command into binary + args using `parse-cmd` or simple split
    - Spawn with `cwd`, merged env (process.env + provided env)
    - Capture stdout, stderr separately, limit to 1MB each (truncate rest)
    - Start a timer; on timeout, send SIGTERM, then SIGKILL after 5s
    - Resolve with `VerifierResult` containing: passed (exitCode === 0), exitCode, stdout, stderr, durationMs
    - Reject with `VerifierError` if spawn fails (ENOENT etc.)
  - Log command and result (truncated) to pino with `verifier.run.start` and `verifier.run.end` events
  - Integration tests use real shell commands like `node -e "process.exit(0)"` for pass, `node -e "process.exit(1)"` for fail, `sleep 10` for timeout

  **Must NOT do**:
  - Don't use `exec` (use spawn for proper timeout/kill)
  - Don't run as root or with sudo
  - Don't pipe stdin (spawn detached)
  - Don't shell-out to a shell (use spawn with arg array)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward process management
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: Tasks 6 (6 depends on 8), 11, 12, 13
  - **Blocked By**: Task 2

  **References**:
  - **External References**:
    - Node child_process: https://nodejs.org/api/child_process.html
    - `parse-cmd` (or `string-argv`) for command parsing
  - **Pattern References**:
    - chepibe's process management: search for `child_process` in `freelance/fibra/chepibe/packages/`

  **Acceptance Criteria**:
  - [ ] `run` returns `VerifierResult` for all exit codes
  - [ ] Timeout triggers SIGTERM then SIGKILL after 5s
  - [ ] stdout/stderr captured separately, truncated to 1MB
  - [ ] env merging is correct (provided env overrides process.env)
  - [ ] Integration tests pass for: pass, fail, timeout, command-not-found
  - [ ] `pnpm typecheck` and `pnpm lint` pass

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Command exiting 0 → passed=true
    Tool: Bash (vitest)
    Steps:
      1. run('node -e "process.exit(0)"', '/tmp', {}, 5000)
      2. Assert result.passed === true, exitCode === 0
    Evidence: .sisyphus/evidence/task-8-pass.json

  Scenario: Command exiting 1 → passed=false
    Tool: Bash (vitest)
    Steps:
      1. run('node -e "process.exit(1)"', '/tmp', {}, 5000)
      2. Assert result.passed === false, exitCode === 1
    Evidence: .sisyphus/evidence/task-8-fail.json

  Scenario: Timeout triggers kill
    Tool: Bash (vitest)
    Steps:
      1. run('sleep 30', '/tmp', {}, 100)
      2. Assert VerifierError thrown with code 'TIMEOUT'
      3. Assert total elapsed time is ~100ms, not 30s
    Evidence: .sisyphus/evidence/task-8-timeout.json

  Scenario: Command not found
    Tool: Bash (vitest)
    Steps:
      1. run('nonexistent-binary-xyz', '/tmp', {}, 5000)
      2. Assert VerifierError thrown with code 'COMMAND_NOT_FOUND'
    Evidence: .sisyphus/evidence/task-8-notfound.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-8-pass.json`
  - [ ] `.sisyphus/evidence/task-8-fail.json`
  - [ ] `.sisyphus/evidence/task-8-timeout.json`
  - [ ] `.sisyphus/evidence/task-8-notfound.json`

  **Commit**: YES
  - Message: `feat(core): implement VerifierRunner with timeout`
  - Files: `packages/core/src/verifier/**`
  - Pre-commit: `pnpm typecheck && pnpm test --filter @loopy/core`

### Wave 4 — CLI + integration (parallel)

- [x] 9. @loopy/cli — Commander setup, init command (wizard)

  **What to do**:
  - Set up Commander in `apps/cli/src/index.ts` as the main entry point
  - Implement `loopy init` command in `apps/cli/src/commands/init.ts`:
    - Uses `@inquirer/prompts` for interactive prompts
    - Steps:
      1. Check `gh auth status` — fail with clear message if not authenticated
      2. Prompt: "Which GitHub owner?" (default: try `gh repo view --json owner`)
      3. Prompt: "Project number?" (validate it exists via GraphQL)
      4. Fetch the Project's Status field options
      5. Prompt: "Which column is Ready?" (with column name → option ID mapping)
      6. Prompt: "Which column is In Progress?" (skip if user says "same as Ready")
      7. Prompt: "Which column is In Review?"
      8. Prompt: "Which column is Done?"
      9. Prompt: "Which column is Blocked?"
      10. Prompt: "Verifier command?" (default: `pnpm test && pnpm lint`)
      11. Prompt: "Verifier timeout in seconds?" (default: 600)
      12. Prompt: "Max retries?" (default: 3)
      13. Write `loopy.config.ts` using a template
      14. Write `.loopy/cache.json` with field IDs
      15. Print success message with next steps
  - `loopy --version` → `0.1.0`
  - `loopy --help` → shows all commands
  - `loopy init --help` → shows init options
  - Use `chalk` for colored output
  - Add `--yes` flag to skip prompts and use defaults

  **Must NOT do**:
  - Don't create GH Projects or columns (read-only on structure)
  - Don't allow init to run inside a non-git directory
  - Don't overwrite existing `loopy.config.ts` without confirmation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: CLI scaffolding + interactive prompts are well-trodden
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 10, after Wave 3)
  - **Blocks**: Tasks 11, 13
  - **Blocked By**: Tasks 1, 4

  **References**:
  - **External References**:
    - Commander.js: https://github.com/tj/commander.js
    - `@inquirer/prompts`: https://github.com/SBoudrias/Inquirer.js
    - chalk: https://github.com/chalk/chalk
  - **Pattern References**:
    - chepibe doesn't have a CLI; pattern-match from npm CLI conventions

  **Acceptance Criteria**:
  - [ ] `loopy --version` prints `0.1.0`
  - [ ] `loopy --help` lists init, run, status, stop with descriptions
  - [ ] `loopy init --help` shows wizard options
  - [ ] Init wizard prompts work in a real terminal (use `script` for non-TTY test)
  - [ ] `--yes` flag uses all defaults
  - [ ] Generated `loopy.config.ts` is valid TypeScript that typechecks
  - [ ] Generated `.loopy/cache.json` is valid JSON

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: --version prints version
    Tool: Bash
    Steps:
      1. Run: node dist/apps/cli/index.js --version
    Expected Result: outputs "0.1.0"
    Evidence: .sisyphus/evidence/task-9-version.txt

  Scenario: --help shows all commands
    Tool: Bash
    Steps:
      1. Run: node dist/apps/cli/index.js --help
    Expected Result: lists init, run, status, stop with descriptions
    Evidence: .sisyphus/evidence/task-9-help.txt

  Scenario: --yes flag uses defaults and creates config
    Tool: Bash + tmux (or script(1) for non-TTY)
    Preconditions: temp dir, git init, gh auth not required for --yes
    Steps:
      1. Run: echo "" | node dist/apps/cli/index.js init --yes
    Expected Result: loopy.config.ts created with default values
    Evidence: .sisyphus/evidence/task-9-init-yes.txt

  Scenario: Generated config typechecks
    Tool: Bash
    Steps:
      1. Run: pnpm typecheck --filter loopy-cli
    Expected Result: 0 errors (the generated config must be valid TS)
    Evidence: .sisyphus/evidence/task-9-config-typecheck.log
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-9-version.txt`
  - [ ] `.sisyphus/evidence/task-9-help.txt`
  - [ ] `.sisyphus/evidence/task-9-init-yes.txt`
  - [ ] `.sisyphus/evidence/task-9-config-typecheck.log`

  **Commit**: YES
  - Message: `feat(cli): add loopy init interactive wizard`
  - Files: `apps/cli/src/**`
  - Pre-commit: `pnpm typecheck && pnpm lint && pnpm build`

- [x] 10. @loopy/cli — run, status, stop commands + signal handling

  **What to do**:
  - Implement `loopy run` in `apps/cli/src/commands/run.ts`:
    - Load `loopy.config.ts` (use `tsx` to require it, or transpile to JS)
    - Construct all clients (GH, opencode, worktree, verifier)
    - Construct LoopEngine
    - Set up pino logger (pretty for TTY, JSON for file)
    - Set up signal handlers: SIGINT, SIGTERM → call AbortController.abort()
    - Call `engine.run(signal)`
    - On abort, print "Loop stopped gracefully" and exit 0
    - On uncaught error, print friendly message and exit 1
  - Implement `loopy status` in `apps/cli/src/commands/status.ts`:
    - Read `.loopy/state/*.json`
    - Print a table: issue number, state, last updated
    - If empty, print "No active tasks. Run `loopy run` to start."
  - Implement `loopy stop` in `apps/cli/src/commands/stop.ts`:
    - Look for a PID file at `.loopy/loopy.pid`
    - If exists and process is running, send SIGTERM
    - Wait up to 10s for clean shutdown
    - Print "Sent stop signal to PID {pid}"
    - If no PID file, print "No running loopy process found"
  - Add `--spawn` flag to `loopy run` to auto-start `opencode serve` if not running

  **Must NOT do**:
  - Don't make CLI commands do work in parallel
  - Don't add a TUI dashboard
  - Don't daemonize the process (foreground only)
  - Don't allow running multiple `loopy run` instances (check PID file, fail with clear error)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Signal handling, process management, and orchestration are tricky
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 11, after Wave 3)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 5, 6, 11

  **References**:
  - **External References**:
    - Node signals: https://nodejs.org/api/process.html#signal-events
    - AbortController: https://developer.mozilla.org/en-US/docs/Web/API/AbortController
  - **Pattern References**:
    - chepibe's process management patterns (search for `process.on('SIGINT')` in `freelance/fibra/chepibe/packages/`)

  **Acceptance Criteria**:
  - [ ] `loopy run` starts the loop, prints structured logs to TTY
  - [ ] Ctrl+C cleanly aborts the loop, prints "Loop stopped gracefully", exits 0
  - [ ] `loopy status` shows the current state of all cards
  - [ ] `loopy stop` sends SIGTERM to running process
  - [ ] `--spawn` flag starts `opencode serve` if not running
  - [ ] `loopy run` fails with clear error if `loopy.config.ts` doesn't exist
  - [ ] `loopy run` fails with clear error if `gh auth status` fails
  - [ ] `loopy run` fails with clear error if opencode serve is unreachable (unless `--spawn`)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: loopy run --help shows flags
    Tool: Bash
    Steps:
      1. Run: node dist/apps/cli/index.js run --help
    Expected Result: shows --spawn, --once (single iteration), --config-path
    Evidence: .sisyphus/evidence/task-10-run-help.txt

  Scenario: loopy run with missing config fails cleanly
    Tool: Bash
    Preconditions: temp dir, no loopy.config.ts
    Steps:
      1. Run: node dist/apps/cli/index.js run 2>&1
    Expected Result: exit 1, error message "loopy.config.ts not found in {cwd}. Run `loopy init` first."
    Evidence: .sisyphus/evidence/task-10-missing-config.txt

  Scenario: Ctrl+C aborts loop gracefully
    Tool: Bash + tmux
    Preconditions: full setup with mock opencode
    Steps:
      1. Start `loopy run` in tmux session
      2. Wait 2 seconds
      3. Send Ctrl+C (tmux send-keys C-c)
      4. Wait 5 seconds
      5. Capture tmux pane content
    Expected Result: "Loop stopped gracefully" message, exit 0
    Evidence: .sisyphus/evidence/task-10-sigint.txt

  Scenario: loopy status shows empty state correctly
    Tool: Bash
    Preconditions: fresh repo, no .loopy/state/
    Steps:
      1. Run: node dist/apps/cli/index.js status
    Expected Result: "No active tasks. Run `loopy run` to start."
    Evidence: .sisyphus/evidence/task-10-status-empty.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-10-run-help.txt`
  - [ ] `.sisyphus/evidence/task-10-missing-config.txt`
  - [ ] `.sisyphus/evidence/task-10-sigint.txt`
  - [ ] `.sisyphus/evidence/task-10-status-empty.txt`

  **Commit**: YES
  - Message: `feat(cli): add loopy run/status/stop with signal handling`
  - Files: `apps/cli/src/commands/run.ts`, `apps/cli/src/commands/status.ts`, `apps/cli/src/commands/stop.ts`
  - Pre-commit: `pnpm typecheck && pnpm lint`

- [ ] 11. Wire everything: pino logging, .loopy/ dir, state persistence

  **What to do**:
  - Set up pino logger in `apps/cli/src/lib/logger.ts`:
    - Pretty output to TTY (use `pino-pretty` transport in dev)
    - JSON to `.loopy/events.log` (one event per line)
    - Log levels: info default, `--verbose` flag enables debug
    - Child loggers per card (with `cardId` and `issueNumber` bindings)
  - Set up `.loopy/` directory initialization in `apps/cli/src/lib/setup.ts`:
    - On startup, ensure `.loopy/` exists
    - Subdirs: `state/`, `worktrees/`, `logs/`
    - Add `.loopy/` to `.gitignore` recommendation in init wizard
  - Implement state persistence in `packages/core/src/state/store.ts`:
    - `StateStore` class with `save(cardNumber, state)`, `load(cardNumber)`, `loadAll()`, `delete(cardNumber)`
    - Atomic writes (write to `.tmp`, then rename)
    - Format: `{ issueNumber, state, lastUpdated, attempts, lastError? }`
  - Wire `StateStore` into `LoopEngine` — engine reads from store on init (to skip Done/Blocked cards), writes on every transition
  - Add startup banner: `loopy v0.1.0 — Loop Engineering, locally`

  **Must NOT do**:
  - Don't use console.log for production logs
  - Don't write to .loopy/ outside the .loopy/ root
  - Don't allow state files to be edited by hand (validate on load)
  - Don't add log rotation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Wiring is where integration bugs hide
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 9, 10, after Wave 3)
  - **Parallel Group**: Wave 4
  - **Blocks**: Tasks 12, 13
  - **Blocked By**: Tasks 6, 7, 8, 9, 10

  **References**:
  - **External References**:
    - Pino: https://github.com/pinojs/pino
    - pino-pretty: https://github.com/pinojs/pino-pretty
  - **Pattern References**:
    - chepibe's logging setup: search for `pino` in `freelance/fibra/chepibe/packages/whatsapp-worker/`

  **Acceptance Criteria**:
  - [ ] Logger outputs to both TTY and `.loopy/events.log`
  - [ ] `.loopy/` directory is created on startup with `state/`, `worktrees/`, `logs/` subdirs
  - [ ] State files are written atomically
  - [ ] State files are valid JSON with the expected schema
  - [ ] Engine reads state on startup and skips Done/Blocked cards
  - [ ] `--verbose` flag enables debug logs
  - [ ] Startup banner shows on every CLI invocation

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: .loopy/ is created on startup
    Tool: Bash
    Preconditions: empty .loopy/ in test repo
    Steps:
      1. Run: node dist/apps/cli/index.js status
    Expected Result: .loopy/state/, .loopy/worktrees/, .loopy/logs/ all exist
    Evidence: .sisyphus/evidence/task-11-dir-create.txt

  Scenario: State file is written atomically
    Tool: Bash (vitest)
    Steps:
      1. Mock fs.rename
      2. Save state for issue #42
      3. Assert rename was called with temp file → real path
    Evidence: .sisyphus/evidence/task-11-atomic.json

  Scenario: Verbose flag enables debug logs
    Tool: Bash + tmux
    Steps:
      1. Run: node dist/apps/cli/index.js run --verbose (with mock loop, abort after 1s)
    Expected Result: debug-level logs visible in TTY output
    Evidence: .sisyphus/evidence/task-11-verbose.txt

  Scenario: Engine skips Done cards on restart
    Tool: Bash (vitest)
    Preconditions: state file exists for issue #42 with state=Done
    Steps:
      1. Mock GH to return same card
      2. Start engine, run 1 iteration
    Expected Result: card #42 is not processed, no worktree created
    Evidence: .sisyphus/evidence/task-11-skip-done.json
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-11-dir-create.txt`
  - [ ] `.sisyphus/evidence/task-11-atomic.json`
  - [ ] `.sisyphus/evidence/task-11-verbose.txt`
  - [ ] `.sisyphus/evidence/task-11-skip-done.json`

  **Commit**: YES
  - Message: `feat(core): wire pino logging and .loopy/ state persistence`
  - Files: `apps/cli/src/lib/**`, `packages/core/src/state/**`
  - Pre-commit: `pnpm typecheck && pnpm test`

### Wave 5 — Tests + docs (parallel)

- [ ] 12. Unit tests (state machine, config, clients, worktree, verifier)

  **What to do**:
  - Add unit tests in `*.test.ts` files colocated with source
  - Test coverage targets:
    - `packages/core/src/engine/state-machine.ts` — all state × event combinations (≥95% branch coverage)
    - `packages/core/src/config/schema.ts` — valid config, each invalid field separately
    - `packages/core/src/errors/**` — toJSON, instanceof checks
    - `packages/core/src/worktree/manager.ts` — all methods, ALREADY_EXISTS, INVALID_PATH
    - `packages/core/src/verifier/runner.ts` — pass, fail, timeout, command-not-found
    - `packages/core/src/state/store.ts` — atomic write, skip Done, load all
    - `packages/gh/src/client.ts` — listReadyCards, moveCard, addComment, getCard, getFieldOptions (with mocked GraphQL via nock/msw)
    - `packages/opencode/src/client.ts` — createSession (header), sendPrompt, waitForIdle, timeout, autoApprove
    - `packages/test-utils/src/**` — every factory produces valid output
  - Use Vitest with `describe`/`it`/`expect`
  - Test naming: `it('should <expected behavior> when <condition>')`
  - Group tests by file/component
  - No `as any` in tests (use type assertions only when unavoidable)
  - Run `pnpm test --coverage` and ensure overall coverage ≥ 80%

  **Must NOT do**:
  - Don't use real GitHub API (mock it)
  - Don't use real opencode server (mock it)
  - Don't add tests that require network access
  - Don't add snapshot tests
  - Don't add E2E tests here (Task 13/14)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive test suite requires careful design
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 13, 14, 15, after Wave 4)
  - **Parallel Group**: Wave 5
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 3, 4, 5, 6, 7, 8, 11

  **References**:
  - **Pattern References**:
    - chepibe test patterns: `freelance/fibra/chepibe/packages/whatsapp-worker/src/**/__tests__/`
    - chepibe vitest config: `freelance/fibra/chepibe/vitest.config.ts`
  - **External References**:
    - Vitest: https://vitest.dev/
    - nock: https://github.com/nock/nock
    - msw: https://mswjs.io/

  **Acceptance Criteria**:
  - [ ] All unit tests pass (`pnpm test`)
  - [ ] Coverage report shows ≥80% line coverage, ≥70% branch coverage
  - [ ] Each client (GH, opencode) has ≥10 distinct test cases
  - [ ] State machine has tests for all 9 states × 10 events
  - [ ] No flaky tests (run 3 times in a row, all pass)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: All tests pass
    Tool: Bash
    Preconditions: all source code complete
    Steps:
      1. Run: pnpm test
    Expected Result: "Test Files N passed (N)", "Tests N passed (N)", 0 failed
    Evidence: .sisyphus/evidence/task-12-test-output.log

  Scenario: Coverage meets threshold
    Tool: Bash
    Steps:
      1. Run: pnpm test --coverage
    Expected Result: All files report coverage, totals ≥80% lines, ≥70% branches
    Evidence: .sisyphus/evidence/task-12-coverage.txt

  Scenario: Tests are stable (no flakiness)
    Tool: Bash
    Steps:
      1. Run: for i in 1 2 3; do pnpm test || exit 1; done
    Expected Result: 3 consecutive successful runs
    Evidence: .sisyphus/evidence/task-12-stability.log
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-12-test-output.log`
  - [ ] `.sisyphus/evidence/task-12-coverage.txt`
  - [ ] `.sisyphus/evidence/task-12-stability.log`

  **Commit**: YES
  - Message: `test: add unit tests for state machine, config, clients`
  - Files: `packages/**/src/**/*.test.ts`, `apps/cli/src/**/*.test.ts`
  - Pre-commit: `pnpm typecheck && pnpm test`

- [ ] 13. Integration tests (full loop cycle with mocks, recovery scenarios)

  **What to do**:
  - Add integration tests in `tests/integration/` (workspace-level, not in any single package)
  - Test scenarios:
    - **Full happy path**: 1 ready card → worktree created → opencode session created → verifier passes → PR opened → card moved to InReview
    - **Verifier fails then passes**: card with verifier that fails first call, passes second → card ends in InReview
    - **Max retries reached**: card that always fails verifier → card ends in Blocked with comment
    - **Empty diff after opencode**: opencode returns success but no git changes → comment "no changes" added, card skipped
    - **Dirty repo recovery**: repo with uncommitted changes on main → `recover()` stashes them, loop proceeds
    - **Crash recovery**: state file shows card in InProgress → next run picks up correctly
    - **Multi-card sequential**: 3 ready cards → all processed one at a time
    - **GH rate limit retry**: first call returns 429, second succeeds → card still processed
  - Use `@loopy/test-utils` mocks throughout
  - Use real temp git repos for worktree tests (use Node's `os.tmpdir()` + cleanup)
  - Mock the opencode HTTP server using `nock` or by spinning up a tiny test HTTP server
  - Mock the GH GraphQL endpoint using `nock`
  - Tests should run in < 60 seconds total
  - Add to root `package.json` scripts: `"test:integration": "vitest run tests/integration"`

  **Must NOT do**:
  - Don't hit real GitHub API
  - Don't hit real opencode server
  - Don't use real ollama (mock it)
  - Don't leave temp git repos around (cleanup with `afterEach`)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Integration test design requires understanding the full system
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 14, 15, after Wave 4)
  - **Parallel Group**: Wave 5
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 6, 9, 10, 11, 12

  **References**:
  - **Pattern References**:
    - chepibe integration tests: search for `tests/integration` in `freelance/fibra/chepibe/`
  - **External References**:
    - Vitest workspace mode: https://vitest.dev/guide/workspace

  **Acceptance Criteria**:
  - [ ] All 8 integration scenarios pass
  - [ ] No temp git repos left behind after test run
  - [ ] `pnpm test:integration` completes in < 60 seconds
  - [ ] No real network calls (use `nock` to assert no unmatched requests)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: Full happy path integration
    Tool: Bash (vitest)
    Steps:
      1. Run: pnpm test:integration -- --grep "full happy path"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-13-happy-path.log

  Scenario: All integration tests pass
    Tool: Bash
    Steps:
      1. Run: pnpm test:integration
    Expected Result: All 8 scenarios pass
    Evidence: .sisyphus/evidence/task-13-all-integration.log

  Scenario: No temp files leaked
    Tool: Bash
    Preconditions: tests passed
    Steps:
      1. Run: ls /tmp/loopy-test-* 2>/dev/null
    Expected Result: empty (no leftovers)
    Evidence: .sisyphus/evidence/task-13-cleanup.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-13-happy-path.log`
  - [ ] `.sisyphus/evidence/task-13-all-integration.log`
  - [ ] `.sisyphus/evidence/task-13-cleanup.txt`

  **Commit**: YES
  - Message: `test: add integration tests for full loop cycle and recovery`
  - Files: `tests/integration/**`
  - Pre-commit: `pnpm typecheck && pnpm test:integration`

- [ ] 14. E2E script + README + architecture diagram

  **What to do**:
  - Add E2E script at `tests/e2e/run.sh` (or `tests/e2e/run.ts`):
    - Documented step-by-step: how to set up a sandbox GitHub repo, a sandbox Project, a sandbox opencode setup
    - Runs the full flow against a real (user-provided) test repo
    - Asserts the expected outcomes (card moved, PR opened, etc.)
    - Saves evidence to `.sisyphus/evidence/e2e/`
    - Documents cleanup
  - Add `pnpm e2e` script in root `package.json` that runs the E2E
  - Write comprehensive `README.md` (qualitative, not measured by line count — focus on clarity, not verbosity):
    - **Hero section**: What is loopy, one-line tagline ("The loop engineer that runs while you sleep"), Addy Osmani article link
    - **Why loopy exists**: 1 paragraph summarizing the problem (you keep typing prompts, an autonomous system can do it)
    - **Quickstart**: 4 commands (install, init, run, status) with copy-pasteable snippets
    - **Core concept walkthrough** (the conversation we just had, in writing):
      - "How does loopy know what to work on?" — explains the Project → config → local repo flow
      - "How does loopy know which repo to use?" — cwd = local repo, config = GitHub Project
      - "How are tasks prioritized?" — column order, no smart ordering in MVP
      - "How do dependencies between cards work?" — you handle them in the GitHub UI, loopy doesn't parse "blocked by"
      - "What about org vs user vs repo Projects?" — config supports all three
    - **Architecture diagram** (ASCII art): Project → Worktree → opencode → Verifier → PR. Plus a state machine diagram for the loop.
    - **Installation**: from source (MVP), global `pnpm add -g loopy` (future)
    - **Configuration reference**: every config field documented with example, default, and "when to change this"
    - **CLI reference**: every command (`init`, `run`, `status`, `stop`, `doctor`, `logs`, `reset`, `--help`, `--version`) with all flags and 1-2 example invocations each
    - **The `loopy init` wizard** — step-by-step walkthrough with screenshots (ASCII) of what each prompt looks like
    - **Loop Engineering context** — link to Addy Osmani's article, explain how loopy implements the 5 building blocks (Scheduling, Worktrees, Skills, MCP/Connectors, Sub-agents, +State). For each, point to the loopy code that does it.
    - **Lineage section** — Ralph loop (bash + prd.json), Compound Product, how loopy differs (cloud-visible state via GH Projects)
    - **Permissions & security** — what scopes you need, what the agent can do, what you should review in PRs
    - **Troubleshooting** — common errors and fixes (at least 10 entries: gh not authenticated, opencode unreachable, verifier timeout, worktree conflict, etc.)
    - **Limitations** — explicit list of what loopy does NOT do (no smart ordering, no cross-repo, no daemon in MVP, no web UI, etc.)
    - **Roadmap** — what's coming in v0.2 (daemon, web UI, smart ordering, cost tracking, /goal analog)
    - **Development**: how to run tests, how to add a new adapter, how to extend the state machine
    - **FAQ** — 10+ questions a new user might ask (the ones we covered in this interview: "How do I know what it's working on?", "Can I run it on my org?", "What if opencode makes bad code?", etc.)
  - Add a `docs/` directory with:
    - `docs/concepts.md` — deep-dive on loop engineering, the 5 building blocks, the state machine
    - `docs/configuration.md` — exhaustive config reference (lifted from README but standalone for reference)
    - `docs/cli.md` — exhaustive CLI reference (lifted from README but standalone)
    - `docs/troubleshooting.md` — common errors and fixes
    - `docs/security.md` — what the agent can/cannot do, how to review its work
  - Add `CHANGELOG.md` (just `0.1.0` entry with link to Addy Osmani article as inspiration)
  - Add `LICENSE` (MIT placeholder)
  - Add `CHANGELOG.md` (just `0.1.0` entry)
  - Add `LICENSE` (placeholder)

  **Must NOT do**:
  - Don't auto-run E2E in CI (it's manual)
  - Don't include real secrets in README
  - Don't add a "Contributing" section beyond basic pointers

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: README quality matters for adoption; E2E design is non-trivial
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13, 15, after Wave 4)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1
  - **Blocked By**: Task 13

  **References**:
  - **External References**:
    - Addy Osmani article: https://addyosmani.com/blog/loop-engineering/ (for attribution and context section)
    - Make a README: https://www.makeareadme.com/
    - ASCII architecture diagrams: search for "ascii architecture diagram" examples

  **Acceptance Criteria**:
  - [ ] `README.md` exists and is comprehensive (no line-count gate; qualitative review: does it cover all required topics clearly?)
  - [ ] README includes all 5 FAQ questions: how it knows what to work on, how repo is selected, how priority works, how dependencies work, org vs user Projects
  - [ ] `docs/concepts.md`, `docs/configuration.md`, `docs/cli.md`, `docs/troubleshooting.md`, `docs/security.md` all exist
  - [ ] `pnpm e2e` script exists and is documented in README
  - [ ] E2E script has clear setup instructions
  - [ ] E2E script cleans up after itself
  - [ ] All 5 building blocks from Addy Osmani article are referenced in README with file pointers
  - [ ] Architecture diagram is included (ASCII)
  - [ ] State machine diagram is included (ASCII)
  - [ ] Limitations section explicitly lists what loopy does NOT do
  - [ ] Roadmap section lists what's coming in v0.2

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: README covers all required topics
    Tool: Bash
    Steps:
      1. Run: grep -ciE "(quickstart|installation|configuration|cli|troubleshooting|limitations|roadmap|faq)" README.md
    Expected Result: each section heading present (count >= 8)
    Failure Indicators: missing section heading
    Evidence: .sisyphus/evidence/task-14-readme-sections.txt

  Scenario: E2E script is syntactically valid
    Tool: Bash
    Steps:
      1. Run: bash -n tests/e2e/run.sh
    Expected Result: no syntax errors
    Evidence: .sisyphus/evidence/task-14-e2e-syntax.log

  Scenario: E2E script has setup section
    Tool: Bash
    Steps:
      1. Run: grep -i "setup" tests/e2e/run.sh
    Expected Result: matches found
    Evidence: .sisyphus/evidence/task-14-e2e-setup.txt

  Scenario: pnpm e2e script defined
    Tool: Bash
    Steps:
      1. Run: grep '"e2e"' package.json
    Expected Result: matches "e2e": "..."
    Evidence: .sisyphus/evidence/task-14-pnpm-e2e.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-14-readme-sections.txt`
  - [ ] `.sisyphus/evidence/task-14-e2e-syntax.log`
  - [ ] `.sisyphus/evidence/task-14-e2e-setup.txt`
  - [ ] `.sisyphus/evidence/task-14-pnpm-e2e.txt`

  **Commit**: YES
  - Message: `docs: add README, E2E script, and architecture diagram`
  - Files: `README.md`, `CHANGELOG.md`, `LICENSE`, `tests/e2e/**`
  - Pre-commit: `pnpm typecheck`

- [ ] 15. Final polish — error messages, --help, --version, examples

  **What to do**:
  - Review every error path and ensure user-facing message is friendly and actionable
  - Add `--version` to every command
  - Add examples to `--help` output (use Commander's `.addHelpText('after', ...)`)
  - Add a `loopy doctor` command:
    - Checks: `gh` installed and authenticated, opencode reachable, `loopy.config.ts` valid, `.loopy/` writable
    - Prints a checklist with green checks / red X
  - Add a `loopy logs` command:
    - Tails `.loopy/events.log` in the TTY with pretty formatting
    - `--follow` flag to follow new entries
  - Add `loopy reset` command:
    - Removes `.loopy/state/` (use with caution — confirm prompt)
  - Run `pnpm build` and verify dist sizes are reasonable (< 5MB per package)
  - Run `pnpm audit` and document any high/critical vulnerabilities in README

  **Must NOT do**:
  - Don't add subcommands that aren't in the original spec (skip `doctor`, `logs`, `reset` if scope creep concern)
  - Don't add web UI
  - Don't add daemon mode

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Polish work requires judgment calls
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 12, 13, 14, after Wave 4)
  - **Parallel Group**: Wave 5
  - **Blocks**: F1
  - **Blocked By**: Tasks 11, 14

  **References**:
  - **Pattern References**:
    - chepibe's command patterns for consistent error messages
  - **External References**:
    - Commander examples: https://github.com/tj/commander.js#examples

  **Acceptance Criteria**:
  - [ ] `loopy doctor` works and reports status clearly
  - [ ] `loopy logs` tails the log file
  - [ ] All errors are user-friendly (no raw stack traces in default output)
  - [ ] `pnpm build` produces dist/ for all packages, each < 5MB
  - [ ] `pnpm audit` shows no high/critical vulnerabilities (or they're documented)

  **QA Scenarios (MANDATORY)**:
  ```
  Scenario: loopy doctor reports status
    Tool: Bash
    Steps:
      1. Run: node dist/apps/cli/index.js doctor
    Expected Result: checklist with ✓/✗ for gh, opencode, config, .loopy
    Evidence: .sisyphus/evidence/task-15-doctor.txt

  Scenario: Error messages are user-friendly
    Tool: Bash
    Steps:
      1. Run with invalid config: node dist/apps/cli/index.js run
    Expected Result: error includes "Try:" or "Run `loopy init`" or similar actionable advice
    Evidence: .sisyphus/evidence/task-15-error-msg.txt

  Scenario: Build size is reasonable
    Tool: Bash
    Steps:
      1. Run: pnpm build && du -sh packages/*/dist apps/*/dist
    Expected Result: each dist/ < 5MB
    Evidence: .sisyphus/evidence/task-15-build-size.txt
  ```

  **Evidence to Capture**:
  - [ ] `.sisyphus/evidence/task-15-doctor.txt`
  - [ ] `.sisyphus/evidence/task-15-error-msg.txt`
  - [ ] `.sisyphus/evidence/task-15-build-size.txt`

  **Commit**: YES
  - Message: `polish: improve error messages, --help, --version, examples`
  - Files: `apps/cli/src/**` (doctor, logs, reset commands)
  - Pre-commit: `pnpm typecheck && pnpm build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm typecheck` + `pnpm lint` + `pnpm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Set up a sandbox repo: create a fresh GitHub Project with Ready/InProgress/InReview/Done/Blocked columns, push a test repo with `package.json` + a failing test, run `loopy init`, run `loopy run`, observe card transitions and PR creation. Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `chore(scaffold): init pnpm monorepo with tsconfig refs and oxlint`
- **2**: `feat(core): add types, interfaces, and Zod config schema`
- **3**: `feat(test-utils): add mock factories for GH and opencode clients`
- **4**: `feat(gh): implement GitHub Projects v2 GraphQL client`
- **5**: `feat(opencode): implement v2 API HTTP client with /wait and /permission`
- **6**: `feat(core): implement loop engine state machine`
- **7**: `feat(core): implement WorktreeManager with auto-recovery`
- **8**: `feat(core): implement VerifierRunner with timeout`
- **9**: `feat(cli): add loopy init interactive wizard`
- **10**: `feat(cli): add loopy run/status/stop with signal handling`
- **11**: `feat(core): wire pino logging and .loopy/ state persistence`
- **12**: `test: add unit tests for state machine, config, clients`
- **13**: `test: add integration tests for full loop cycle and recovery`
- **14**: `docs: add README, E2E script, and architecture diagram`
- **15**: `polish: improve error messages, --help, --version, examples`

---

## Success Criteria

### Verification Commands
```bash
pnpm install              # Expected: no errors
pnpm typecheck            # Expected: 0 errors
pnpm lint                 # Expected: 0 errors
pnpm test                 # Expected: all tests pass
pnpm build                # Expected: dist/ produced for all packages
node dist/apps/cli/index.js --version   # Expected: 0.1.0
node dist/apps/cli/index.js --help      # Expected: shows init/run/status/stop
pnpm e2e                  # Expected: runs end-to-end against sandbox repo
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent (no web UI, no daemon, no /goal analog, etc.)
- [ ] All tests pass (unit + integration + E2E)
- [ ] `pnpm typecheck` and `pnpm lint` pass with 0 errors
- [ ] README includes: quickstart, architecture, lineage to Addy Osmani article
- [ ] E2E script documented and runnable
- [ ] No `as any` / `@ts-ignore` in production code (tests OK)
- [ ] No files outside expected structure (no stray .ts in root, no source in `dist/`)
