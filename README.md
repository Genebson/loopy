# loopy

The loop engineer that runs while you sleep. [Loop Engineering](https://addyosmani.com/blog/loop-engineering/) meets your local machine.

## Why loopy exists

You keep typing prompts for an agent, reviewing output, and iterating. That is a loop. An autonomous system can run that loop for you. loopy implements the Loop Engineering pattern locally, wiring a GitHub Project to your repo so each card in the Ready column becomes a branch, an opencode session, a verifier run, and a pull request -- without you touching the keyboard.

## Quickstart

```bash
pnpm install
pnpm --filter @loopy/cli build && node apps/cli/dist/cjs/index.js init
node apps/cli/dist/cjs/index.js run
node apps/cli/dist/cjs/index.js status
```

After `init`, edit `loopy.config.ts` to match your project. After `run`, loopy picks the first Ready card, implements it, runs your verifier, and opens a PR.

## Core concept walkthrough

### How does loopy know what to work on?

loopy reads the Ready column of a GitHub Projects v2 board. Each card that appears there is a task. When loopy finishes processing a card (success or failure), it moves the card out of Ready and picks the next one.

### How does loopy know which repo to use?

loopy runs inside a local git repository. That working directory is the repo it operates on. The GitHub Project is configured in `loopy.config.ts` so loopy knows which board to read from and which org/user owns it.

### How are tasks prioritized?

In the MVP, loopy processes cards in the order the GitHub API returns them. There is no smart ordering. If you need specific sequencing, arrange the cards in your project board before running loopy.

### How do dependencies between cards work?

loopy does not parse "blocked by" or dependency fields. If card A must complete before card B, move card B out of Ready until A is done, then move B back. You manage dependencies in the GitHub UI.

### What about org vs user vs repo Projects?

The config supports all three. Use `{ owner, number }` to reference an org or user project by its visible number. Use `{ id }` to reference any project by its GraphQL node ID (which you can find via the GitHub API explorer).

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  GitHub Project │    │  Local Git Repo  │    │   opencode v2   │
│  (Ready column) │───▶│  (cwd)           │───▶│   HTTP server   │
└─────────────────┘    │                  │    │   (port 4096)   │
      ▲                │  ┌────────────┐  │    └─────────────────┘
      │                │  │  Worktree  │  │            │
      │                │  │  per card  │  │            ▼
      │                │  └────────────┘  │    ┌─────────────────┐
      │                │        │         │    │  Verifier cmd   │
      │                │        ▼         │    │  (pnpm test...) │
      │                │  ┌────────────┐  │    └─────────────────┘
      │                │  │  opencode  │  │            │
      │                │  │  session   │  │            ▼
      │                │  └────────────┘  │    ┌─────────────────┐
      │                │        │         │    │  PR created     │
      │                │        ▼         │    │  via gh pr      │
      │                │  ┌────────────┐  │    └─────────────────┘
      │                │  │  git diff  │  │            │
      │                │  │  check     │  │            ▼
      │                │  └────────────┘  │    ┌─────────────────┐
      │                └──────────────────┘    │  Card → InReview│
      │                                         └─────────────────┘
      └─────── state file: .loopy/state/{n}.json
```

Each card follows this pipeline:

1. **Pick** a Ready card from the project
2. **Create** a git worktree and branch (`loopy/{issueNumber}-{slug}`)
3. **Send** the card title and body as a prompt to opencode v2
4. **Wait** for opencode to finish (auto-approving permissions if configured)
5. **Build** the project (runs `pnpm build` to catch compilation errors)
6. **Run** the verifier command (e.g., `pnpm test && pnpm lint`)
7. **If** verifier passes: commit, push, open a PR, move card to InReview
8. **If** verifier fails: retry up to N times, then move card to Blocked
9. **Build errors** block immediately without consuming retries (they're structural issues)

## State machine

```
┌──────┐  CARD_PICKED   ┌─────────┐  SESSION_CREATED   ┌────────────┐
│ Idle │ ──────────────▶│ Picking │ ─────────────────▶│ InProgress │
└──────┘                └─────────┘                    └────────────┘
                              │                               │
                              │ ERROR                         │ VERIFIER_PASSED
                              ▼                               ▼
                        ┌──────────┐  PR_OPENED         ┌────────┐
                        │ Blocked  │  ┌──────────┐      │  PR    │
                        └──────────┘  │ InReview │◀─────┤        │
                             ▲       └──────────┘      └────────┘
                             │             │               ▲
                             │             │ CARD_MOVED   │ VERIFIER_FAILED
                             │             ▼               │ retries > 0
                             │       ┌──────────┐          │
                             │       │   Done   │    ┌──────────┐
                             │       └──────────┘    │FailedRetry│
                             │                       └──────────┘
                             │                             │ RETRY
                             └─────── GIVE_UP ────────────┘
```

The state machine is a pure function: `transition(state, event) → newState`. Every transition is persisted to `.loopy/state/{issueNumber}.json` for crash recovery. Cards in `Done` or `Blocked` are skipped on subsequent loops.

## Installation

### Quick install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Genebson/loopy/main/install.sh | bash
```

This installs `loopy` to `~/.local/bin/loopy`. Make sure `~/.local/bin` is in your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify:
```bash
loopy --version
```

### From source

```bash
git clone <your-repo-url> && cd loopy
pnpm install
pnpm build
```

The CLI is at `apps/cli/dist/esm/index.js`. You can alias it:

```bash
alias loopy="node $(pwd)/apps/cli/dist/esm/index.js"
```

### Uninstallation

```bash
bash ~/.loopy/installation/uninstall.sh
```

### Environment variables (for the installer)

- `LOOPY_HOME` — installation directory (default: `~/.loopy/installation`)
- `LOOPY_BIN` — binary location (default: `~/.local/bin/loopy`)
- `LOOPY_REPO` — git URL (default: `https://github.com/Genebson/loopy.git`)
- `LOOPY_REF` — git ref to install (default: `main`)

### Requirements

- **Platform**: macOS only (v0.1.0). Linux may work but is untested. Windows is not supported.
- **Node.js** >= 25.0.0
- **pnpm** >= 10.0.0
- **git** (in PATH)
- **gh** CLI, authenticated (`gh auth login`) — required for `loopy run`
- **opencode** v2, running (`opencode serve`) — required for `loopy run`

## Configuration reference

loopy reads `loopy.config.ts` from the current working directory. Use `defineConfig` for type checking:

```ts
import { defineConfig } from '@loopy/core';

export default defineConfig({
  project: { owner: 'your-org', number: 1 },
  columns: {
    ready: 'Ready',
    inProgress: 'In Progress',
    inReview: 'In Review',
    done: 'Done',
    blocked: 'Blocked',
  },
  verifier: {
    command: 'pnpm test && pnpm lint',
    timeout: 600_000,
    env: {},
  },
  retries: 3,
  opencode: {
    url: 'http://localhost:4096',
    autoApprove: true,
    spawn: false,
  },
  concurrency: 1,
  pollInterval: 60_000,
  worktree: {
    cleanup: false,
  },
});
```

| Field | Type | Default | Description |
|---|---|---|---|
| `project.owner` | `string` | (required) | GitHub org or user that owns the project. Use with `number`. |
| `project.number` | `number` | (required) | Visible project number from the GitHub Projects URL. |
| `project.id` | `string` | (required if no owner/number) | GraphQL node ID. Use when referencing repo-level projects. |
| `columns.ready` | `string` | (required) | Column name for cards ready to be processed. |
| `columns.inProgress` | `string` | (required) | Column name for cards being worked on. |
| `columns.inReview` | `string` | (required) | Column name for cards with open PRs. |
| `columns.done` | `string` | (required) | Column name for completed cards. |
| `columns.blocked` | `string` | (required) | Column name for cards that failed processing. |
| `verifier.command` | `string` | (required) | Shell command to verify changes. Exit code 0 = pass. |
| `verifier.timeout` | `number` | `600000` | Timeout in milliseconds for the verifier. After timeout, SIGTERM then SIGKILL after 5s. |
| `verifier.env` | `Record<string, string>` | `{}` | Extra environment variables for the verifier process. |
| `verifier.build` | `object` | `{}` | Build step config: `{ command, timeout, skipIfUnchanged }`. Runs before verifier command to catch compilation errors. Build errors block immediately without consuming retries. |
| `retries` | `number` | `3` | Max retries on verifier failure before marking card as Blocked. |
| `opencode.url` | `string` | `"http://localhost:4096"` | URL of the opencode v2 HTTP server. |
| `opencode.autoApprove` | `boolean` | `true` | Automatically approve opencode permission requests. |
| `opencode.spawn` | `boolean` | `false` | Auto-start `opencode serve` if not running. |
| `concurrency` | `number` | `1` | Number of cards to process in parallel. MVP supports 1 only. |
| `pollInterval` | `number` | `60000` | Milliseconds between polling the project for new Ready cards. |
| `worktree.cleanup` | `boolean` | `false` | Remove worktree after card moves to InReview. |

**When to change defaults:**

- Set `worktree.cleanup: true` on CI or short-lived runners to save disk space.
- Set `opencode.autoApprove: false` if you want manual control over what the agent does.
- Increase `verifier.timeout` if your test suite is slow.
- Set `retries: 0` to fail fast without retries.

## CLI reference

### `loopy init`

Initialize loopy configuration with an interactive wizard.

```bash
loopy init           # interactive wizard
loopy init --yes     # use all defaults
```

The wizard checks for git repo, `gh` auth, fetches your project columns, and writes `loopy.config.ts` and `.loopy/cache.json`.

### `loopy run`

Start the loop engine. Polls the Ready column and processes cards.

```bash
loopy run                          # start loop
loopy run --once                   # process one card then exit
loopy run --card 42                # process issue #42 specifically
loopy run --cards 42 41 40         # process multiple issues in order
loopy run --retry 35               # retry a blocked card #35
loopy run --spawn                  # auto-start opencode serve
loopy run --verbose                # debug logging
loopy run --config-path ./alt.ts   # use alternative config
```

Flags:
- `--spawn` -- Start `opencode serve` as a child process if not already running.
- `--once` -- Process one card then exit (5-minute timeout).
- `--card <number>` -- Process a specific issue by number instead of picking from Ready.
- `--cards <numbers...>` -- Process multiple specific issues in order.
- `--retry <number>` -- Retry a blocked card by issue number. Moves the card back to Ready and re-processes it.
- `--verbose` -- Set log level to debug.
- `--config-path <path>` -- Path to config file (default: `loopy.config.ts`).

### `loopy status`

Show the current status of all processed cards.

```bash
loopy status
```

Displays a table of all cards with their issue number, state, branch, and last updated time.

### `loopy stop`

Stop a running loopy process.

```bash
loopy stop
```

Sends SIGTERM to the PID recorded in `.loopy/loopy.pid`. Waits up to 10 seconds for the process to exit.

### `loopy doctor`

Diagnose loopy setup and dependencies.

```bash
loopy doctor
loopy doctor --config-path ./my-config.ts
```

Checks: gh CLI installed, gh authenticated, git installed, loopy.config.ts exists, config valid, .loopy/ writable, opencode reachable. Prints a checklist with green checkmarks for passing checks and red crosses for failures.

### `loopy logs`

View loopy event logs.

```bash
loopy logs
loopy logs --lines 100
loopy logs --follow
```

Displays the last N lines from `.loopy/logs/events.log` with pretty formatting (colored log levels, timestamps). Use `--follow` to stream new entries in real time (Ctrl+C to stop).

## `loopy init` wizard walkthrough

1. **Git check** -- loopy verifies you are inside a git repository. If not, it exits.
2. **gh auth check** -- loopy verifies `gh auth status` passes. If not, it tells you to run `gh auth login`.
3. **Owner** -- asks for the GitHub owner (org or user). Defaults to the current repo owner.
4. **Project number** -- asks for the project number from the GitHub Projects URL.
5. **Project fetch** -- loopy fetches the project title and columns from the GitHub API.
6. **Column mapping** -- for each column role (Ready, In Progress, In Review, Done, Blocked), loopy asks you to pick from the project's actual column names. It pre-selects columns whose role matches.
7. **Verifier command** -- asks for the shell command to verify changes (default: `pnpm test && pnpm lint`).
8. **Verifier timeout** -- asks for the timeout in seconds (default: 600).
9. **Max retries** -- asks for the number of retries on failure (default: 3).
10. **Config written** -- writes `loopy.config.ts` and `.loopy/cache.json`.

With `--yes`, all steps use defaults without prompting.

## Loop Engineering context

[Loop Engineering](https://addyosmani.com/blog/loop-engineing/) is a pattern where an autonomous agent iterates on tasks without human intervention. The five building blocks map to loopy's codebase:

| Building Block | loopy Implementation |
|---|---|
| Scheduling | `packages/core/src/engine/loop.ts` -- polls Ready column, picks cards sequentially |
| Worktrees | `packages/core/src/worktree/manager.ts` -- isolated git worktree per card |
| Skills | Config-driven verifier command + opencode prompt (the "skill" is your verifier) |
| MCP/Connectors | `packages/gh/src/client.ts` (GitHub Projects v2) + `packages/opencode/src/client.ts` (opencode v2 HTTP API) |
| State | `packages/core/src/state/store.ts` -- persisted card state in `.loopy/state/{issueNumber}.json` |

## Lineage

loopy draws from two predecessors:

- **Ralph loop** -- an early autonomous agent loop that processed tasks from a queue. loopy replaces the custom queue with GitHub Projects v2.
- **Compound Product** -- a production system that used a similar pattern for automated PR generation. loopy differs by keeping state visible on a cloud-accessible project board instead of a hidden internal queue.

The key difference: loopy's state is cloud-visible. You can see exactly which card is being worked on, which ones failed, and which ones have open PRs -- all from the GitHub Projects UI.

## Permissions and security

### What loopy can do

- Read your GitHub Projects v2 board (via `gh auth token`)
- Create branches and push commits (via git worktrees)
- Open pull requests (via `gh pr create`)
- Move cards between columns
- Post comments on issues
- Send prompts to opencode v2
- Run your verifier command in a worktree

### What loopy cannot do

- Merge PRs (it only opens them)
- Push to protected branches directly
- Access repos outside the one it runs in
- Modify your main branch (all work is in worktrees)

### How to review its work

Every PR loopy opens includes the issue URL in the body. Review the diff, run your own checks, and merge only when satisfied. The verifier is your safety net -- it must pass before loopy opens a PR.

### Token scope

loopy uses `gh auth token` to authenticate with the GitHub API. Your token needs these scopes:

- `repo` -- read repository content, create branches, push
- `project` -- read and modify GitHub Projects v2

### Threat model

loopy runs on your machine. It inherits the permissions of the user running it. It does not have elevated privileges. The opencode agent running inside the worktree has the same filesystem access as the worktree user.

## Troubleshooting

### `gh` not authenticated

```bash
gh auth login
```

loopy requires `gh auth status` to pass. Run `gh auth login` and follow the prompts. Your token needs `repo` and `project` scopes.

### opencode unreachable

loopy connects to opencode v2 at `http://localhost:4096` by default. Make sure `opencode serve` is running:

```bash
opencode serve
```

Or use `loopy run --spawn` to auto-start it.

### Verifier timeout

If your verifier command takes longer than the configured timeout (default 10 minutes), loopy will kill it. Increase the timeout in your config:

```ts
verifier: {
  command: 'pnpm test && pnpm lint',
  timeout: 1_200_000,  // 20 minutes
}
```

### Worktree conflict

If a worktree already exists for a card (e.g., from a previous failed run), loopy will throw `ALREADY_EXISTS`. Remove the stale worktree:

```bash
git worktree remove .loopy/worktrees/{issueNumber}-{slug}
git worktree prune
```

Or delete `.loopy/worktrees/` entirely and re-run.

### Cache stale

loopy caches project metadata in `.loopy/cache.json`. If your project columns change, delete this file and re-run `loopy init`.

### `.loopy/` permissions

If loopy cannot write to `.loopy/state/` or `.loopy/cache.json`, check permissions:

```bash
ls -la .loopy/
chmod 755 .loopy .loopy/state
```

### `pnpm install` fails

Make sure you have the correct Node.js and pnpm versions:

```bash
node -v   # >= 25.0.0
pnpm -v   # >= 10.0.0
```

If you see workspace resolution errors, try:

```bash
pnpm install --no-frozen-lockfile
```

### Build fails

The monorepo build must be sequential. Use the root build script:

```bash
pnpm build
```

Do not use `pnpm -r --parallel build` -- it causes race conditions with workspace dependencies.

### PR creation fails

`gh pr create` needs a remote named `origin`. Verify your git remote:

```bash
git remote -v
```

Also ensure the branch has been pushed before `gh pr create` runs. loopy pushes before creating the PR, but if push fails, the PR will fail too.

### State file corrupted

If `.loopy/state/{issueNumber}.json` is invalid JSON, loopy will skip that card on the next loop. Delete the corrupted file:

```bash
rm .loopy/state/{issueNumber}.json
```

Then move the card back to Ready in your project.

### Verifier command not found

If your verifier command (e.g., `pnpm`) is not in PATH when loopy runs, it will throw `COMMAND_NOT_FOUND`. Make sure the binary is available in your shell environment, or use an absolute path:

```ts
verifier: {
  command: '/usr/local/bin/pnpm test && /usr/local/bin/pnpm lint',
}
```

### loopy keeps reprocessing the same card

If a card is in the Ready column but has a state file in `.loopy/state/` with state `Blocked`, loopy skips it. Use `loopy run --retry <number>` to retry a blocked card.

## Limitations

- **macOS only** -- v0.1.0 only fully supports macOS. Linux may work but is untested. Windows is not supported. The install script is bash-only, and the app has known Windows compatibility issues (simple-git paths, pino-pretty colors, gh CLI quoting). Use WSL or Git Bash if you must run on Windows.
- **No smart ordering** -- Cards are processed in API order, not by priority or dependency.
- **No cross-repo** -- loopy works on one repo at a time, the one it is running in.
- **No daemon mode** -- The MVP runs in the foreground. Use `nohup` or `tmux` for background execution.
- **No web UI** -- All status is via the CLI and the GitHub Project board.
- **No /goal analog** -- loopy sends the card title and body as a prompt. There is no separate goal or context injection.
- **No cost tracking** -- loopy does not track opencode API usage or cost.
- **No parallel processing** -- `concurrency: 1` is the only supported value in v0.1.0.
- **No custom prompt templates** -- The prompt sent to opencode is `Implement this issue: {title}\n\n{body}\n\nURL: {url}`.

## Roadmap (v0.2)

- **Daemon mode** -- background process with `loopy start` / `loopy stop`
- **Web UI** -- local dashboard showing loop progress
- **Smart ordering** -- priority field and dependency graph
- **Cost tracking** -- token usage and estimated cost per card
- **/goal analog** -- configurable prompt templates and context injection
- **Parallel processing** -- `concurrency > 1` support

## Development

### Running tests

```bash
pnpm test                # unit tests
pnpm test:integration    # integration tests (requires git)
pnpm e2e                 # end-to-end test (requires gh + opencode)
```

### Type checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Adding adapters

loopy uses interfaces from `@loopy/core` for its external dependencies:

- `GHClient` (`packages/core/src/interfaces/gh-client.ts`) -- GitHub Projects v2 operations
- `OpenCodeClient` (`packages/core/src/interfaces/opencode-client.ts`) -- opencode v2 HTTP API
- `WorktreeManager` (`packages/core/src/interfaces/worktree-manager.ts`) -- git worktree operations
- `VerifierRunner` (`packages/core/src/interfaces/verifier-runner.ts`) -- command execution

Implement these interfaces to swap out a dependency (e.g., use a different agent instead of opencode).

### Extending the state machine

The state machine is in `packages/core/src/engine/state-machine.ts`. It is a pure function:

```ts
transition(state: LoopState, event: LoopEvent): LoopState
```

To add a new state or event, update the `LoopState` union, the `LoopEvent` discriminated union, and the switch cases in `transition()`.

## FAQ

### How do I know what it is working on?

Run `loopy status` to see all processed cards with their current state, branch, and last update time. The GitHub Project board also shows which column each card is in.

### Can I run it on my org?

Yes. Use `project: { owner: 'your-org', number: N }` in your config. Your `gh auth` token needs org-level project access.

### What if opencode makes bad code?

That is what the verifier is for. If `pnpm test` or your custom verifier fails, loopy retries up to `N` times. If it still fails, the card moves to Blocked and you can review the worktree changes yourself.

### How much does it cost?

loopy is free and open source. The cost comes from whatever API the agent (opencode) uses. loopy does not track token usage in v0.1.0.

### Which platforms are supported?

v0.1.0 only fully supports **macOS**. The install script is bash-only and will not run on Windows natively. The app has known issues on Windows (simple-git path handling, pino-pretty color codes, gh CLI command quoting). Linux may work but has not been tested beyond CI unit tests. v0.2 will add proper cross-platform support with CI matrix testing on macOS, Linux, and Windows.

### Can I use a different agent (not opencode)?

Not in v0.1.0. The `OpenCodeClient` interface is designed for the opencode v2 HTTP API. To use a different agent, implement the `OpenCodeClient` interface from `@loopy/core` and wire it in the CLI run command.

### Can I customize the prompt?

Not in v0.1.0. The prompt is `Implement this issue: {title}\n\n{body}\n\nURL: {url}`. Prompt templates are on the v0.2 roadmap.

### What if my verifier needs network access?

The verifier command runs in the worktree directory with your configured environment variables. If your tests need network access (e.g., to call a staging API), they will have it. Use `verifier.env` to pass API URLs or tokens.

### How do I debug a failed card?

1. Check `loopy status` for the card state and branch name.
2. Look at the worktree in `.loopy/worktrees/{issueNumber}-{slug}/`.
3. Check `.loopy/state/{issueNumber}.json` for the error message.
4. Move the card back to Ready in the GitHub UI and re-run loopy.

### Is my code safe?

loopy operates in git worktrees, which are isolated copies of your repo. It never modifies your main working directory. All changes are on branches with the `loopy/` prefix. PRs are never auto-merged -- you review and merge.

### What happens if loopy crashes?

loopy persists state to `.loopy/state/{issueNumber}.json` after each state transition. On restart, it skips cards that are already in `Done` or `Blocked` state. Cards that were mid-processing will be retried.

### Can I run multiple loopy instances?

Not in v0.1.0. The PID file (`.loopy/loopy.pid`) prevents multiple instances from running simultaneously. v0.2 will support parallel processing within a single instance.