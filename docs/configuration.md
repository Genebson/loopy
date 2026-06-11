# Configuration

loopy reads configuration from `loopy.config.ts` in the current working directory. The file is loaded at runtime using `jiti` (just-in-time TypeScript/ESM compilation), so you can write it in TypeScript with full type safety.

## Creating a config

Run the interactive wizard:

```bash
loopy init
```

Or with all defaults:

```bash
loopy init --yes
```

This generates `loopy.config.ts` and `.loopy/cache.json` in your repo root.

## Full config example

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
    env: {
      NODE_ENV: 'test',
    },
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

## Field reference

### `project`

Which GitHub Projects v2 board to read cards from.

Two forms:

```ts
// Org or user project by number (visible in the URL)
project: { owner: 'your-org', number: 1 }

// Any project by GraphQL node ID
project: { id: 'PVT_abc123def456' }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `owner` | `string` | yes (with `number`) | GitHub org or user login |
| `number` | `number` | yes (with `owner`) | Project number from the URL |
| `id` | `string` | yes (alone) | GraphQL node ID for any project type |

When using `{ owner, number }`, loopy fetches the project metadata at startup. When using `{ id }`, the project ID is used directly.

### `columns`

Map loopy's internal column roles to your project's actual column names.

| Field | Type | Required | Description |
|---|---|---|---|
| `ready` | `string` | yes | Column name for cards ready to be processed |
| `inProgress` | `string` | yes | Column name for cards being worked on |
| `inReview` | `string` | yes | Column name for cards with open PRs |
| `done` | `string` | yes | Column name for completed cards |
| `blocked` | `string` | yes | Column name for cards that failed processing |

The init wizard auto-detects your project's columns and pre-selects matching names.

### `verifier`

The shell command that validates the agent's output.

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | `string` | (required) | Shell command to run. Exit code 0 = pass. |
| `timeout` | `number` | `600000` | Timeout in milliseconds. After timeout, SIGTERM then SIGKILL after 5s. |
| `env` | `Record<string, string>` | `{}` | Extra environment variables merged into the verifier process. |

The command runs in the worktree directory. It inherits the parent process's environment plus `env`.

Example for a Python project:

```ts
verifier: {
  command: 'pytest && ruff check .',
  timeout: 300_000,
  env: { PYTHONPATH: 'src' },
}
```

### `retries`

| Field | Type | Default | Description |
|---|---|---|---|
| `retries` | `number` | `3` | Max verifier retries before marking a card as Blocked. Set to `0` to fail fast. |

On each retry, the verifier runs again from the same worktree. The agent is not re-prompted between retries. If you want the agent to try a different approach, you need to move the card back to Ready manually.

### `opencode`

Connection settings for the opencode v2 HTTP server.

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | `"http://localhost:4096"` | URL of the opencode v2 HTTP server. |
| `autoApprove` | `boolean` | `true` | Automatically approve opencode permission requests. Set to `false` for manual control. |
| `spawn` | `boolean` | `false` | Auto-start `opencode serve` as a child process if not running. |

**`autoApprove: true`** means loopy will poll for permission requests and approve them. This is necessary for unattended operation. If set to `false`, the loop will block waiting for manual permission approval in the opencode UI.

**`spawn: true`** is convenient for single-command startup (`loopy run --spawn`). The child process is detached and will continue running after loopy exits.

### `concurrency`

| Field | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `1` | Number of cards to process simultaneously. Currently only `1` is supported. |

v0.2 will support higher values with parallel worktree processing.

### `pollInterval`

| Field | Type | Default | Description |
|---|---|---|---|
| `pollInterval` | `number` | `60000` | Milliseconds between polling the project for new Ready cards. |

Lower values mean faster response but more API calls. The default (60s) is conservative to avoid rate limits.

### `worktree`

| Field | Type | Default | Description |
|---|---|---|---|
| `worktree.cleanup` | `boolean` | `false` | Remove the worktree after a card moves to InReview. Saves disk space but you lose the working directory for debugging. |

Worktrees are stored in `.loopy/worktrees/` relative to the repo root. Branch names follow the pattern `loopy/{issueNumber}-{slug}`.

## Config file location

loopy looks for `loopy.config.ts` in the current working directory. Override with:

```bash
loopy run --config-path ./path/to/config.ts
```

## Validation

`defineConfig()` runs Zod schema validation. If a required field is missing or a value has the wrong type, you get a clear error message:

```
Error: loopy.config.ts validation failed:
  - project: Required
  - columns.ready: Required
  - verifier.command: Required
```

## Cache

The init wizard writes `.loopy/cache.json` containing project metadata (project ID, field IDs, column options). This speeds up subsequent runs by avoiding repeated API calls. If your project columns change, delete this file:

```bash
rm .loopy/cache.json
```

## State files

loopy writes per-card state to `.loopy/state/{issueNumber}.json`. Do not edit these files manually unless you are clearing a `Blocked` state for a retry. Delete a state file to allow loopy to reprocess that card:

```bash
rm .loopy/state/42.json
```