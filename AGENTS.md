# Agent Instructions

You are building "loopy" — a local CLI that runs the Loop Engineering pattern.

## Core Directives
- **NO COMMENTS**: Good code is self-explanatory. Comments are a last resort.
- **Type-Safe**: Use Zod for runtime validation. No `any` types. Use discriminated unions for state machines.
- **Error Hierarchy**: Use the domain exception classes from `@loopy/core/errors`. Never throw raw Error.
- **Structured Logging**: Use pino (imported from `@loopy/core/logger`). Never console.log.

## Build & Test Commands
- `pnpm install` — install dependencies
- `pnpm build` — build all packages (CJS + ESM)
- `pnpm typecheck` — type-check all packages
- `pnpm lint` — lint with oxlint
- `pnpm test` — run all unit tests
- `pnpm test:integration` — run integration tests
- `pnpm e2e` — run end-to-end manual script

## Architecture
- `packages/core` — loop engine, state machine, types, interfaces, config
- `packages/gh` — GitHub Projects v2 GraphQL client
- `packages/opencode` — OpenCode v2 API HTTP client
- `packages/test-utils` — mock factories for testing
- `apps/cli` — Commander CLI (init, run, status, stop, doctor, logs, reset)

## Key Patterns
- State machine: pure functions `(state, event) → newState` in `@loopy/core`
- Clients: implement interfaces from `@loopy/core` so the engine is decoupled
- Config: Zod-validated `loopy.config.ts` at repo root
- Runtime state: `.loopy/state/*.json` for crash recovery
- GH auth: `gh auth token` (never store tokens)

## CLI Flags
- `loopy run --card 42` — process a specific issue
- `loopy run --cards 42 41 40` — process multiple issues in order
- `loopy run --once` — process one card and exit

## Creating GitHub Issues / PRs
When creating issues or PRs via the `gh` CLI, **always use `--body-file`** instead of `--body`. Inline `--body` strings are interpreted by the shell, and markdown backticks trigger command substitution, injecting ANSI-colored output into the body.

## Strict Constraints
- No `any` types in production code
- No `console.log` — use pino logger
- No raw `Error` — use domain exceptions from `@loopy/core/errors`
- No barrel exports (index.ts re-exporting everything) — import directly from source files
- No default config fallbacks — fail loudly if required config is missing