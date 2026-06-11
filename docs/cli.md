# CLI Reference

loopy provides four commands: `init`, `run`, `status`, and `stop`.

## `loopy init`

Initialize loopy configuration with an interactive wizard.

```bash
loopy init           # interactive wizard
loopy init --yes     # use all defaults
```

### What it does

1. Checks that the current directory is a git repository
2. Checks that `gh auth status` passes
3. Asks for the GitHub owner (defaults to current repo owner)
4. Asks for the project number
5. Fetches the project title and column names from the GitHub API
6. Asks you to map each column role to a column name
7. Asks for the verifier command (default: `pnpm test && pnpm lint`)
8. Asks for the verifier timeout in seconds (default: 600)
9. Asks for the max retries (default: 3)
10. Writes `loopy.config.ts` and `.loopy/cache.json`

With `--yes`, steps 3-9 use defaults without prompting.

### Exit codes

- `0` -- success
- `1` -- not a git repo, `gh` not authenticated, project not found, or config already exists (in `--yes` mode)

### Output files

- `loopy.config.ts` -- validated configuration file
- `.loopy/cache.json` -- project metadata cache (project ID, field IDs, column options)

## `loopy run`

Start the loop engine. Polls the Ready column and processes cards.

```bash
loopy run                          # start loop (foreground)
loopy run --once                   # process one card then exit
loopy run --spawn                  # auto-start opencode serve
loopy run --verbose                # enable debug logging
loopy run --config-path ./alt.ts   # use alternative config
```

### Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--spawn` | boolean | false | Start `opencode serve` as a detached child process if not already running |
| `--once` | boolean | false | Process one card then exit (5-minute timeout) |
| `--verbose` | boolean | false | Set log level to debug |
| `--config-path <path>` | string | `loopy.config.ts` | Path to config file |

### What it does

1. Creates `.loopy/` directories if they do not exist
2. Initializes the logger (writes to `.loopy/logs/`)
3. Checks for an existing loopy process (PID file at `.loopy/loopy.pid`)
4. Validates `gh auth status`
5. Loads and validates `loopy.config.ts`
6. Optionally starts `opencode serve`
7. Enters the main loop:
   - Recover worktrees (stash, prune, fast-forward)
   - List Ready cards, filter out Done/Blocked
   - Pick the first card
   - Create worktree, start opencode session, send prompt
   - Wait for opencode to finish
   - Run verifier
   - If pass: commit, push, open PR, move card to InReview
   - If fail: retry up to N times, then move card to Blocked
8. On SIGINT/SIGTERM: gracefully abort, clean up PID file

### Exit codes

- `0` -- graceful shutdown (SIGINT/SIGTERM or `--once` completed)
- `1` -- config error, `gh` not authenticated, or unexpected error

### PID file

loopy writes its process ID to `.loopy/loopy.pid` on startup and removes it on exit. If a stale PID file exists (process not running), it is cleaned up automatically.

### `--once` mode

In `--once` mode, loopy processes one card and exits. It sets a 5-minute timeout. If the card is not processed within 5 minutes, it aborts.

Use `--once` in CI pipelines or for testing single cards:

```bash
loopy run --once --verbose
```

## `loopy status`

Show the current status of all processed cards.

```bash
loopy status
```

### What it displays

A table with these columns:

| Column | Description |
|---|---|
| Issue # | The card's issue number |
| State | Current loop state (Idle, Picking, InProgress, PR, InReview, FailedRetry, Blocked, Done) |
| Branch | The git branch name (or `-` if not yet created) |
| Last Updated | Relative time since the card's state was last updated |

States are color-coded:
- Green: `Done`
- Red: `Blocked`
- Yellow: `FailedRetry`
- Cyan: all other states

### Exit codes

- `0` -- success (even if no cards are found)

## `loopy stop`

Stop a running loopy process.

```bash
loopy stop
```

### What it does

1. Reads the PID from `.loopy/loopy.pid`
2. If the PID file does not exist, prints "No running loopy process found" and exits
3. If the PID file exists but the process is not running, removes the stale PID file and exits
4. Sends SIGTERM to the process
5. Waits up to 10 seconds for the process to exit
6. If the process does not exit within 10 seconds, prints a warning

### Exit codes

- `0` -- success (including when no process is found)

## Upcoming commands (v0.2)

These commands are on the roadmap but not yet implemented:

- `loopy doctor` -- check prerequisites and config validity
- `loopy logs` -- view structured log output