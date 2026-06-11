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
