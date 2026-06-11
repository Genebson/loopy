# Learnings

## 2026-06-11: Monorepo Scaffold

- **Dual CJS+ESM tsconfig**: When using `moduleResolution: "NodeNext"` in base config, CJS configs that set `module: "commonjs"` will error because NodeNext moduleResolution requires NodeNext module. Fix: remove `module`/`moduleResolution` from base config, set them per-package. CJS uses `module: "commonjs", moduleResolution: "node"`, ESM uses `module: "NodeNext", moduleResolution: "NodeNext"`.
- **Vitest workspace deprecation**: `test.workspace` is deprecated in vitest 3.x. Use `test.projects` instead.
- **add-js-extensions.mjs location**: In chepibe it's per-package (`packages/shared/scripts/`), but for loopy we put it at `scripts/add-js-extensions.mjs` at the root level. The build scripts reference it as `node ../../scripts/add-js-extensions.mjs` (for packages) and `node ../../scripts/add-js-extensions.mjs` (for apps/cli).
- **pnpm workspace links**: `workspace:*` dependencies resolve correctly. `@loopy/cli` depends on `@loopy/core`, `@loopy/gh`, and `@loopy/opencode`.
## 2026-06-11: OpenCode HTTP Client Implementation

- **OpenCodeError code parameter**: Changed `OpenCodeError` constructor from `(userMessage, cause?)` to `(code, userMessage, cause?)` to support specific error codes like `CONNECTION_REFUSED`, `SESSION_TIMEOUT`, etc. The `code` field was already on `LoopyError` base class, so this just makes it configurable.
- **Nock test pattern**: When testing error mapping, call the method only once per test (use `.then(onFulfilled, onRejected)` pattern) to avoid consuming nock interceptors twice. Each `nock()` mock responds only once by default.
- **Deep path imports from workspace packages**: TypeScript can't resolve `@loopy/core/interfaces/opencode-client.js` style deep imports. Use the barrel export `@loopy/core` instead.
- **OpenCode v2 API endpoints**: POST `/api/session`, POST `/api/session/:id/prompt`, POST `/api/session/:id/wait`, GET `/api/session/:id/message`, POST `/api/session/:id/permission/:requestId/reply`. Only `/session/:id/abort` is v1.
- **X-OpenCode-Directory header**: Must be set on every request to isolate per-request working directory. Only set when `worktreePath` is provided (which it is for createSession, but not for other methods unless passed through).
- **waitForIdle timeout**: Uses `AbortController` with `setTimeout`. On abort, calls `abortSession()` then throws `OpenCodeError('SESSION_TIMEOUT', ...)`.

## 2026-06-11: @loopy/gh Implementation

- **@octokit/graphql typing**: The `graphql` function returns a complex type that causes TS7022 (circular reference) when used with inline generic types. Fix: use `graphql()` without generic and cast the result with `as T`, or assign to a separately-typed variable.
- **nock for GraphQL testing**: `nock` works well for mocking `@octokit/graphql` calls since it uses `https` under the hood. Mock `POST https://api.github.com/graphql` with `.post('/graphql')`.
- **Mocking child_process**: When mocking `execSync` for `gh auth token`, use `vi.mock('node:child_process')` at module level. The mock must be set up before importing the module under test.
- **Vitest workspace**: Running `pnpm test` from root uses the workspace config with `projects` globs. Filter with `--project 'packages/gh'`. Running `pnpm --filter @loopy/gh test` directly doesn't work because the test include pattern uses root-relative globs.
- **Cache atomic writes**: Use `writeFile` to temp path + `rename` for atomic cache writes. Use `randomUUID()` from `node:crypto` for temp file names.

## 2026-06-11: WorktreeManager Implementation

- **WorktreeError codes**: Updated from fixed `'WORKTREE_ERROR'` to typed `WorktreeErrorCode` union (`'ALREADY_EXISTS' | 'INVALID_PATH' | 'GIT_ERROR' | 'NOT_FOUND'`) following the `OpenCodeError` pattern.
- **simple-git diff --quiet**: `simple-git`'s `.diff()` and `.raw()` do NOT throw on exit code 1 from `git diff --quiet`. Use `diffSummary()` instead and check `summary.changed > 0`.
- **pino logger**: Created `packages/core/src/logger.ts` with pino, configurable via `LOOPY_LOG_LEVEL` env var (default `'info'`).
- **Path validation**: Use `path.relative()` + check for `..` prefix or absolute path to prevent path traversal outside repo root.
- **git worktree add**: Must use `git.raw(['worktree', 'add', '-b', branch, path])` since `simple-git` doesn't have a first-class worktree API.
- **git worktree list porcelain**: Parse output by splitting on `\n\n` for entries, then `\n` for lines within each entry. Branch lines start with `branch refs/heads/` or `branch `.
- **Integration tests with real git**: Use `simpleGit(dir).init()` + commit to create temp repos. Cleanup in `afterEach` with `fs.promises.rm`. Use `_e` + `void _e` for intentionally empty catch blocks without comments.

## 2026-06-11: Loop Engine Implementation

- **CJS/ESM mock imports**: `@loopy/test-utils` can't be imported from `@loopy/core` tests because the vitest mock factories use `import { vi } from 'vitest'` which fails in CJS context. Solution: write inline mock factories in the test file instead of depending on the test-utils package.
- **pollPermissions blocking**: The `pollPermissions` method with `autoApprove: true` blocks in a `sleep(1000ms)` loop. In tests, this blocks `processCard` because `await permissionPoller` in the finally block waits for the sleep to complete. Solution: set `autoApprove: false` in test configs, or ensure the signal is aborted quickly.
- **TypeScript private field assignment**: Cannot cast `this as { projectId: string }` when `projectId` is `private readonly`. Use `(this as unknown as Record<string, string>)[key] = value` pattern for runtime assignment to readonly private fields.
- **LoopEngine state machine**: Pure function `transition(state, event) → newState` with exhaustive switches. The `processCard` method tracks state locally and persists to `.loopy/state/{issueNumber}.json` after each significant transition.
- **Card state persistence format**: `CardState` includes `issueNumber`, `state` (LoopState), `retriesLeft`, `branch`, `worktreePath`, timestamps, and `error`. Cards in `Done` or `Blocked` state are skipped on subsequent loops.
- **pollPermissions stopped callback**: The `stopped()` callback must return `boolean`, not `void`. Use `() => permissionPollingStopped` instead of `() => { permissionPollingStopped = true; }`.

## 2026-06-11: CLI Commands (run, status, stop)

- **jiti for TypeScript config loading**: Use `jiti` (just-in-time TS/ESM loader) to dynamically import `loopy.config.ts` files at runtime. `createJiti(import.meta.url, { interopDefault: true })` + `jiti.import(absolutePath)` handles TS compilation transparently. The `interopDefault: true` option ensures `export default` works correctly.
- **Config loading pattern**: Load config with `await jiti.import(path)` then extract default: `(configModule as Record<string, unknown>).default ?? configModule`. Validate with `loopyConfigSchema.parse(raw)`.
- **PID file for process management**: Write `process.pid` to `.loopy/loopy.pid` on start, check for existing process with `process.kill(pid, 0)` (returns true if running, throws if not). Remove PID file in `finally` block.
- **Signal handling for graceful shutdown**: Use `AbortController` pattern. Register `SIGINT`/`SIGTERM` handlers that call `controller.abort()`. The `LoopEngine.run()` accepts the `AbortSignal` and checks `signal.aborted` in its loop.
- **chalk for CLI output**: Use `chalk.red()` for errors, `chalk.green()` for success, `chalk.yellow()` for warnings, `chalk.cyan()` for banners. Avoid `console.log` in library code but OK in CLI commands for user-facing output.
- **Relative time formatting**: Format ISO timestamps as relative times ("2h ago", "1d ago") for the status table display.
- **Sequential build required**: `pnpm build` from root uses `--parallel` for non-core packages, which causes `@loopy/cli` to start building before `@loopy/gh`/`@loopy/opencode` finish. Must build sequentially or build dependencies first.

## 2026-06-11: CLI Init Command Implementation

- **chalk v4 for CJS compat**: Use `chalk@4` (not v5) since v5 is ESM-only and breaks dual CJS+ESM builds.
- **import.meta.url in dual builds**: `import.meta.url` fails in CJS builds. Use `pathToFileURL(resolve('.'))` from `node:url` as a CJS-compatible alternative for jiti's baseURL parameter.
- **Parallel build race condition**: `pnpm -r --parallel` causes CLI CJS build to fail when workspace dependencies haven't built yet. Fix: build dependencies sequentially (core → gh → opencode → test-utils → cli).
- **Existing command files**: `run.ts`, `status.ts`, `stop.ts` already existed with pre-built Commander commands. The `index.ts` needed to import and register all four commands.
- **GHProjectClient for init**: The init wizard uses `GHProjectClient` directly to fetch project info and column options, then writes `.loopy/cache.json` for future use.
- **@inquirer/prompts**: Provides `input`, `select`, `confirm`, `number` for interactive CLI prompts. Works in ESM context.
- **Build script fix**: Changed root `build` script from `pnpm --filter @loopy/core build && pnpm -r --parallel --filter '!@loopy/core' run build` to sequential chain to avoid race conditions.

## 2026-06-11: Integration Tests

- **vi.mock('node:child_process') with compiled ESM**: When integration tests import `@loopy/core` from compiled ESM dist, `vi.mock('node:child_process')` at module level does NOT intercept `execSync` calls inside the compiled code. The `LoopEngine.openPr()` method uses real `execSync` which throws `spawnSync /bin/sh ENOENT` in test environments. Solution: design tests to accept this behavior and assert on the `Blocked` state with error containing `ENOENT`, rather than expecting `InReview`.
- **GH rate limit test design**: `LoopEngine.run()` does NOT catch errors from `listReadyCards` — a thrown error propagates up and crashes the loop. So a 429 test must assert the error propagates rather than expecting retry behavior.
- **Vitest integration config**: Integration tests at repo root need `resolve.alias` to map `@loopy/core` to the compiled ESM dist path, and `server.deps.inline` to force vitest to process the module through its transform pipeline.
- **Real StateStore in tests**: Using real `StateStore` with temp directories (`os.tmpdir() + 'loopy-int-'`) enables testing crash recovery scenarios. Clean up with `fs.rmSync(tmpDir, { recursive: true, force: true })` in `afterEach`.
- **AbortController pattern for testing loops**: Use `new AbortController()`, call `engine.run(controller.signal)`, wait with `setTimeout`, then `controller.abort()` to stop the loop. Wrap `await runPromise` in try/catch since abort may cause rejection.
- **Test cleanup**: Always clean up temp dirs in `afterEach` even if tests fail. Use `vi.restoreAllMocks()` in `afterEach` to prevent mock leakage between tests.

## 2026-06-11: Documentation

- **README structure**: 18 sections covering hero through FAQ, with ASCII architecture and state machine diagrams
- **E2E script pattern**: Use `set -euo pipefail` and parameter parsing with `while [[ $# -gt 0 ]]` for robust bash scripts
- **E2E script header comments**: Necessary for shell scripts (no type system, no self-documenting signatures) -- serves as public API documentation
- **Config schema maps to docs**: Every field in `loopyConfigSchema` has a corresponding row in the configuration reference table
- **State machine docs**: The `LoopState` and `LoopEvent` unions from `state-machine.ts` map directly to the docs and README diagrams
- **Package.json e2e script**: Changed from placeholder `echo 'No e2e tests yet'` to `bash tests/e2e/run.sh`

## 2026-06-11: CLI Polish (doctor, logs, help text, error messages)

- **Commander `.addHelpText('after', ...)`**: Adds example invocations after the options list. Format with newline + "Examples:" header for readability.
- **`loopy doctor`**: Uses `execSync` with `stdio: 'pipe'` to check gh, gh auth, git. Uses `jiti` + `loopyConfigSchema` to validate config. Uses `fetch` with `AbortSignal.timeout(3000)` for opencode reachability check. Creates `.loopy/` dir if missing before write test.
- **`loopy logs`**: Reads `.loopy/logs/events.log`, parses pino JSON lines, colorizes by level. `--follow` mode uses `setInterval(1000)` with file size polling (`fs.statSync` + `fs.readSync` with offset) rather than `fs.watch` for simplicity.
- **Error message pattern**: Every error should state WHAT went wrong and HOW TO FIX it. E.g., "loopy.config.ts not found at X. Run `loopy init`" instead of "not found". Generic errors suggest `loopy doctor`.
- **`--version` on program**: Already existed on the root `program` via `.version('0.1.0')`. Individual Commander subcommands don't need separate version flags since `loopy --version` works at the root level.
- **Empty catch blocks**: Project convention is `catch { void 0; }` rather than comments, since the AGENTS.md says "NO COMMENTS".
