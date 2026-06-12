# Troubleshooting

## Wrong platform (Linux/Windows)

v0.1.0 only fully supports **macOS**.

If you are on Linux:
- The `install.sh` script should work, but is untested beyond CI unit tests
- The app code uses POSIX-compliant APIs but has not been manually tested on any Linux distro

If you are on Windows:
- `install.sh` will not run natively. Use WSL (Windows Subsystem for Linux) or Git Bash
- The app has known issues: simple-git Windows path handling, pino-pretty color codes, gh CLI command quoting
- v0.2 will add proper cross-platform support

## `gh` not authenticated

**Symptom:** `Error: gh CLI not authenticated. Run 'gh auth login' first.`

**Fix:**

```bash
gh auth login
```

Follow the prompts. Your token needs `repo` and `project` scopes. Verify with:

```bash
gh auth status
```

## opencode unreachable

**Symptom:** `OpenCodeError: CONNECTION_REFUSED` or `Failed to connect to OpenCode at http://localhost:4096`

**Fix:** Start the opencode server:

```bash
opencode serve
```

Or use `loopy run --spawn` to auto-start it.

If opencode is running on a different port, update your config:

```ts
opencode: {
  url: 'http://localhost:YOUR_PORT',
}
```

## Verifier timeout

**Symptom:** Verifier process killed after the configured timeout. Card moves to Blocked.

**Fix:** Increase the timeout in your config. The default is 600,000ms (10 minutes):

```ts
verifier: {
  command: 'pnpm test && pnpm lint',
  timeout: 1_200_000,  // 20 minutes
}
```

## Worktree conflict

**Symptom:** `WorktreeError: ALREADY_EXISTS - Worktree path already exists: .loopy/worktrees/42-some-task`

**Fix:** A previous run left a stale worktree. Remove it:

```bash
git worktree remove .loopy/worktrees/42-some-task
git worktree prune
```

Or remove all loopy worktrees:

```bash
rm -rf .loopy/worktrees/
git worktree prune
```

## Cache stale

**Symptom:** loopy uses old column names after you renamed them in the GitHub UI.

**Fix:** Delete the cache file and re-initialize:

```bash
rm .loopy/cache.json
loopy init
```

## `.loopy/` permissions

**Symptom:** `EACCES: permission denied` when writing to `.loopy/state/` or `.loopy/cache.json`

**Fix:** Check and fix permissions:

```bash
ls -la .loopy/
chmod 755 .loopy .loopy/state
```

If `.loopy/` does not exist, loopy creates it on startup. If the parent directory has restrictive permissions, fix those instead.

## `pnpm install` fails

**Symptom:** Workspace resolution errors or `ERR_PNPM_*` errors during `pnpm install`.

**Fix:** Verify Node.js and pnpm versions:

```bash
node -v   # must be >= 25.0.0
pnpm -v   # must be >= 10.0.0
```

Clear the store and reinstall:

```bash
pnpm store prune
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

If you see lockfile conflicts:

```bash
pnpm install --no-frozen-lockfile
```

## Build fails

**Symptom:** TypeScript errors or `Cannot find module` errors during `pnpm build`.

**Fix:** Build dependencies sequentially. The root `pnpm build` script handles this:

```bash
pnpm build
```

Do not use `pnpm -r --parallel build` -- it causes race conditions where `@loopy/cli` starts building before `@loopy/core`, `@loopy/gh`, or `@loopy/opencode` finish.

If you see specific package errors, build that package first:

```bash
pnpm --filter @loopy/core build
pnpm --filter @loopy/gh build
pnpm --filter @loopy/opencode build
pnpm --filter @loopy/cli build
```

## PR creation fails

**Symptom:** `Failed to create PR via gh CLI` or `gh pr create` exits with an error.

**Fix:** Check these conditions:

1. Your git remote is named `origin`:
   ```bash
   git remote -v
   ```

2. The branch has been pushed to the remote:
   ```bash
   git branch -r | grep loopy/
   ```

3. You have push access to the repository.

4. The `gh` CLI is authenticated:
   ```bash
   gh auth status
   ```

## State file corrupted

**Symptom:** Cards are skipped or have unexpected state values.

**Fix:** Check the state file for that card:

```bash
cat .loopy/state/42.json
```

If the JSON is invalid, delete it and move the card back to Ready:

```bash
rm .loopy/state/42.json
# Then move card #42 to Ready in the GitHub UI
```

## Verifier command not found

**Symptom:** `VerifierError: COMMAND_NOT_FOUND - Command not found: pnpm`

**Fix:** The verifier command runs in the worktree directory with your current PATH. If `pnpm` (or any other binary) is not in PATH, use an absolute path:

```ts
verifier: {
  command: '/usr/local/bin/pnpm test && /usr/local/bin/pnpm lint',
}
```

Or ensure your shell profile (`.bashrc`, `.zshrc`) adds the binary to PATH before running loopy.

## loopy keeps reprocessing the same card

**Symptom:** A card in Ready is processed repeatedly, even though it should be in Blocked or Done.

**Fix:** This happens if the state file was deleted but the card was not moved out of Ready. Check the state file:

```bash
ls .loopy/state/
```

If the card has a state file with `Blocked` or `Done`, loopy skips it. If the file is missing, loopy will reprocess the card. Either:

1. Move the card out of Ready in the GitHub UI, or
2. Delete the card from the project entirely.

## opencode session timeout

**Symptom:** `OpenCodeError: SESSION_TIMEOUT` after the configured verifier timeout.

**Fix:** The `waitForIdle` call times out when opencode takes too long to finish. This can happen if:

1. The agent is stuck in a loop. Check the opencode UI for the session status.
2. The task is too large for the agent to complete within the timeout. Increase `verifier.timeout` in your config.
3. opencode itself has crashed. Restart `opencode serve`.

## loopy exits immediately with no output

**Symptom:** `loopy run` exits silently with code 1.

**Fix:** Run with verbose logging to see the error:

```bash
loopy run --verbose
```

Common causes:
- `loopy.config.ts` is missing or invalid
- `gh auth status` fails
- Another loopy process is already running (check `.loopy/loopy.pid`)