# Security

loopy runs on your local machine and interacts with GitHub and an opencode agent. Understanding what it can and cannot do is important for safe operation.

## What loopy can do

- **Read your GitHub Projects v2 board** -- list cards, read titles and bodies, check column positions
- **Create git branches and push commits** -- using git worktrees in `.loopy/worktrees/`, branches are prefixed with `loopy/`
- **Open pull requests** -- using `gh pr create`, PRs include the issue URL in the body
- **Move cards between columns** -- Ready to In Progress, In Progress to In Review or Blocked
- **Post comments on issues** -- status comments like "loopy started" and "PR opened: <url>"
- **Send prompts to opencode v2** -- the card title and body are sent as a prompt
- **Approve opencode permission requests** -- when `autoApprove: true`, loopy polls for and approves permission requests
- **Run your verifier command** -- in the worktree directory with configured environment variables

## What loopy cannot do

- **Merge PRs** -- loopy only opens PRs. Review and merge are manual steps.
- **Push to protected branches** -- all work is done on `loopy/*` branches in isolated worktrees
- **Access repos outside the one it runs in** -- the working directory determines the repo
- **Modify your main working directory** -- git worktrees are separate copies
- **Execute arbitrary commands outside the verifier** -- the verifier command is explicitly configured
- **Access secrets or credentials beyond `gh auth token`** -- loopy uses the `gh` CLI's existing auth

## Authentication

loopy authenticates with GitHub through the `gh` CLI:

```bash
gh auth login   # set up authentication
gh auth status  # verify it works
gh auth token   # used internally by the GraphQL client
```

Required token scopes:

- `repo` -- read repository content, create branches, push
- `project` -- read and modify GitHub Projects v2

loopy does not store or manage tokens itself. It calls `gh auth token` each time it needs to authenticate.

## The opencode agent

loopy sends a prompt to opencode and waits for it to finish. The prompt contains:

- The card title
- The card body (the issue description)
- The issue URL

When `autoApprove: true`, loopy approves any permission request from opencode. This means the agent can:

- Read and write files in the worktree
- Run commands (if the agent requests shell access)
- Access network resources (if the agent makes HTTP requests)

**Risk:** If you do not trust the agent's output, set `autoApprove: false` and manually approve permission requests in the opencode UI.

## The verifier

The verifier command runs in the worktree directory with your configured environment variables:

```ts
verifier: {
  command: 'pnpm test && pnpm lint',
  timeout: 600_000,
  env: { NODE_ENV: 'test' },
}
```

**Security considerations:**

- The verifier runs as your user with your PATH
- It has the same filesystem access as you
- `env` variables are merged with the parent process environment
- The verifier command is a shell command -- do not construct it from untrusted input

## Network access

loopy makes these network requests:

| Destination | Purpose | Authentication |
|---|---|---|
| `api.github.com` | GitHub Projects v2 GraphQL API | `gh auth token` |
| `localhost:4096` (default) | opencode v2 HTTP API | None (local) |
| `github.com` | `git push` and `gh pr create` | SSH key or `gh auth token` |

All requests use HTTPS except the opencode local API (HTTP by default). If opencode is on a different host, configure `opencode.url` accordingly.

## State files

loopy writes state to `.loopy/state/{issueNumber}.json`. These files contain:

- Issue number and current loop state
- Git branch name and worktree path
- Timestamps (started, completed)
- Error messages (if the card failed)

**These files do not contain secrets.** They are JSON files with loop metadata. Add `.loopy/state/` to `.gitignore` to prevent accidental commits.

## Git worktrees

Worktrees are created in `.loopy/worktrees/` by default. Each worktree is a full copy of the repository at the point the card was picked. The agent modifies files in this worktree only.

**Isolation:** Your main working directory is never modified. Changes are committed on the `loopy/*` branch and pushed to the remote for PR creation.

**Cleanup:** If `worktree.cleanup: true` in your config, worktrees are deleted after a card moves to InReview. Otherwise, they remain for debugging.

## Reviewing agent output

loopy does not auto-merge PRs. Every PR it creates requires manual review. The PR body includes the issue URL for context. Review steps:

1. Check the PR diff for unexpected changes
2. Run your own test suite against the PR branch
3. Verify the changes address the issue description
4. Merge only when satisfied

## Threat model

| Threat | Mitigation |
|---|---|
| Malicious agent code | Verifier must pass before PR creation; manual review required |
| Unauthorized repo access | `gh auth token` scoped to `repo` + `project`; no elevated privileges |
| State file corruption | Atomic writes (temp + rename); skip corrupted files on load |
| PID file race condition | `process.kill(pid, 0)` check before starting; stale PID cleanup |
| Worktree escape | Path validation prevents worktrees outside the repo root |
| Verifier timeout | SIGTERM after timeout, SIGKILL after 5s |
| Infinite agent loop | `waitForIdle` timeout with abort |

## Recommended `.gitignore`

```gitignore
.loopy/state/
.loopy/cache.json
.loopy/logs/
.loopy/worktrees/
.loopy/loopy.pid
```