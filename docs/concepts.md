# Concepts

This document explains the ideas behind loopy and how they map to the codebase.

## Loop Engineering

Loop Engineering is a pattern described by [Addy Osmani](https://addyosmani.com/blog/loop-engineering/). The core idea: instead of manually prompting an AI agent for each task, you define a loop that picks tasks, sends them to the agent, verifies the output, and creates deliverables -- all without human intervention.

The loop has five building blocks:

### 1. Scheduling

**Code:** `packages/core/src/engine/loop.ts`

Scheduling decides *what* to work on next. In loopy, the scheduler polls a GitHub Projects v2 board's Ready column at a configurable interval (`pollInterval`). It picks the first card, skipping any that are already in `Done` or `Blocked` state (persisted in `.loopy/state/`).

The loop is a simple `while (!signal.aborted)` with a sleep between iterations. There is no priority queue or dependency graph in v0.1.0.

### 2. Worktrees

**Code:** `packages/core/src/worktree/manager.ts`

Each card gets an isolated git worktree. This means:

- The main working directory is never modified
- Multiple cards could theoretically be worked on in parallel (v0.2)
- Each worktree gets a branch named `loopy/{issueNumber}-{slug}`
- Worktrees live in `.loopy/worktrees/` by default

The `WorktreeManager` handles creation, removal, change detection (`diffSummary`), committing, and pushing. On startup, it calls `recover()` to stash dirty changes, prune stale worktrees, and fast-forward the main branch.

### 3. Skills

In loopy, "skills" are config-driven:

- **Verifier** -- a shell command (e.g., `pnpm test && pnpm lint`) that determines if the agent's output is acceptable
- **Prompt** -- the text sent to opencode, constructed from the card title and body

The verifier runs in the worktree directory with configurable environment variables and timeout. Exit code 0 means pass; anything else means fail.

### 4. MCP/Connectors

**Code:** `packages/gh/src/client.ts` and `packages/opencode/src/client.ts`

Connectors are how loopy talks to external systems:

- **GHProjectClient** implements `GHClient` from `@loopy/core`. It uses `@octokit/graphql` with `gh auth token` for authentication. Operations include:
  - `getProject()` -- fetch project metadata
  - `getFieldOptions()` -- get column options for the Status field
  - `listReadyCards()` -- list cards in the Ready column
  - `moveCard()` -- move a card to a different column
  - `addComment()` -- comment on an issue

- **OpenCodeHTTPClient** implements `OpenCodeClient` from `@loopy/core`. It connects to the opencode v2 HTTP server. Operations include:
  - `createSession()` -- create a new session with a working directory
  - `sendPrompt()` -- send a prompt to the session
  - `waitForIdle()` -- block until the session finishes or times out
  - `replyPermission()` -- approve or deny permission requests
  - `abortSession()` -- abort a running session

Both clients are injected into the `LoopEngine` constructor, making them swappable via the interface contracts.

### 5. State

**Code:** `packages/core/src/state/store.ts`

State persistence is how loopy survives crashes and avoids reprocessing. The `StateStore` writes JSON files to `.loopy/state/{issueNumber}.json`:

```json
{
  "issueNumber": 42,
  "state": "InReview",
  "retriesLeft": 2,
  "branch": "loopy/42-add-hello-function",
  "worktreePath": "/path/to/.loopy/worktrees/42-add-hello-function",
  "startedAt": "2026-06-11T10:00:00.000Z",
  "completedAt": "2026-06-11T10:15:00.000Z",
  "error": null
}
```

State files are written atomically (write to temp + rename) to prevent corruption from partial writes. On startup, `loadAll()` reads all `.json` files in the state directory. Cards in `Done` or `Blocked` state are skipped.

## State machine

**Code:** `packages/core/src/engine/state-machine.ts`

The state machine is a pure function: `transition(state, event) → newState`. It uses exhaustive switch cases so adding a new state or event requires updating all relevant branches (TypeScript enforces this).

### States

| State | Meaning |
|---|---|
| `Idle` | Starting state, no card picked |
| `Picking` | A card has been selected, setting up worktree |
| `InProgress` | Worktree created, opencode session started |
| `Verifying` | (unused in current flow, verifier runs during InProgress) |
| `PR` | Verifier passed, preparing to open PR |
| `InReview` | PR opened, card moved to review column |
| `FailedRetry` | Verifier failed, retries remaining |
| `Blocked` | Unrecoverable failure or max retries exceeded |
| `Done` | Card fully processed, PR opened or no changes detected |

### Events

| Event | Trigger |
|---|---|
| `CARD_PICKED` | Loop picks a card from Ready column |
| `SESSION_CREATED` | Worktree and opencode session ready |
| `PROMPT_SENT` | Issue content sent to opencode |
| `VERIFIER_PASSED` | Verifier command exited 0 |
| `VERIFIER_FAILED` | Verifier command exited non-0 |
| `PR_OPENED` | `gh pr create` succeeded |
| `CARD_MOVED` | Card moved to InReview column |
| `RETRY` | Retrying after verifier failure |
| `GIVE_UP` | Abandoning a Blocked card |
| `ERROR` | Unexpected error |

### Transition table

```
Idle       --CARD_PICKED-->  Picking
Picking    --SESSION_CREATED-->  InProgress
Picking    --ERROR-->  Blocked
InProgress --PROMPT_SENT-->  InProgress
InProgress --VERIFIER_PASSED-->  PR
InProgress --VERIFIER_FAILED(retries>0)-->  FailedRetry
InProgress --VERIFIER_FAILED(retries=0)-->  Blocked
PR         --PR_OPENED-->  InReview
InReview   --CARD_MOVED-->  Done
FailedRetry --RETRY-->  InProgress
Blocked    --GIVE_UP-->  Idle
```

## The loop lifecycle

A single iteration of the loop processes one card:

1. **Recover** -- stash dirty changes, prune stale worktrees, fast-forward main
2. **List** -- fetch Ready cards from the project
3. **Filter** -- skip cards in `Done` or `Blocked` state
4. **Pick** -- take the first remaining card
5. **Process** -- run the state machine for that card:
   - Create worktree → create opencode session → send prompt → wait for idle → run verifier → handle result
6. **Sleep** -- wait for `pollInterval` milliseconds before checking again

If the abort signal fires (SIGINT/SIGTERM), the loop exits after the current card finishes its current state transition.

## Configuration loading

loopy uses `jiti` to load `loopy.config.ts` at runtime. This means you can write your config in TypeScript with full type checking:

```ts
import { defineConfig } from '@loopy/core';

export default defineConfig({
  // ... type-safe config
});
```

`defineConfig` runs the Zod schema validation, providing runtime error messages for missing or invalid fields.

## Error hierarchy

All errors in loopy extend `LoopyError` (`packages/core/src/errors/base.ts`):

```
LoopyError
├── ConfigError       -- config file missing or invalid
├── GHAPIError        -- GitHub API failures
├── OpenCodeError     -- opencode v2 connection/response errors
├── VerifierError     -- verifier command failures
├── TimeoutError      -- operation timeouts
└── WorktreeError     -- git worktree operation failures
```

Each error has a `code` string (e.g., `CONNECTION_REFUSED`, `COMMAND_NOT_FOUND`, `ALREADY_EXISTS`) and a `userMessage` suitable for CLI output.