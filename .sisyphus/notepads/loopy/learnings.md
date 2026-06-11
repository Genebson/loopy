# Loopy — Learnings

## 2026-06-11 Session Start
- Project is greenfield (empty directory except .sisyphus/)
- Chepibe patterns: pnpm monorepo, dual CJS+ESM build, oxlint, vitest, pino, domain exception hierarchy
- OpenCode v2 API is the target (`/api/*`), NOT v1 (`/session/*`)
- Key endpoints: POST /api/session (create), POST /api/session/:id/prompt (send), POST /api/session/:id/wait (block until idle), POST /api/session/:id/permission/:reqId/reply (auto-approve)
- X-OpenCode-Directory header lets one opencode serve instance handle multiple worktrees
- GH Projects v2 is GraphQL-only (no REST)
- Auth via `gh auth token` (needs `repo` + `project` scopes)
- Node >= 25, pnpm >= 10