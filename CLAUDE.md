# Working in this repository

This is the user's fork (`hobesman/ytzero`) of `Pelski/ytzero`, whose maintainer
has stepped away. Upstream's own working rules still apply:

@AGENTS.md

Several Claude sessions can work on this repo at once. `.claude/hooks/` enforces
the few rules that can be checked mechanically; the rest are here.

## Where a session may write

**A session that changes code works in a worktree of its own.** Worktrees live
under `.claude/worktrees/`, one per session, each on its own branch.

The main checkout at `C:\Users\NickhaleHoban\YTZero` is for reading: questions,
diagnosis, reading logs. Two sessions editing one checkout do not conflict in
git. They conflict in the files, and the loser's work disappears with no merge
marker and nothing in `git status` to show it happened. They also share one
branch and one index, so a commit from either sweeps up whatever the other left
half-finished.

A write into the main checkout therefore asks first. Answer yes when the user
asked for the change to happen there; otherwise take a worktree.

## Splitting work between sessions

Split by **files, not by topic**. Two sync fixes sound separate and both end up
in `app/src/refresher.ts` or `app/src/youtube.ts`. Before running two sessions in
parallel, check that their file sets do not overlap.

Two sessions must never write the same files at the same time, worktrees or not:
isolation turns a silent overwrite into a merge conflict, which is better, but
still costs time nobody planned for.

## Branches

- Commit to the working branch. Merge or push to `main` only when the user says
  so, per change, not once as a standing permission.
- **Merge `main` into the branch before opening the PR**, never after. A branch
  that is behind main produces a PR carrying changes that are not its own.
- Branch from fresh `main` and merge back to it, not from another branch.
- One branch merges at a time.
- `origin` is the fork and `upstream` is `Pelski/ytzero`. Never push to upstream
  or open a PR against it unless the user asks.

## Shipping

When the user says a change is ready ("ship it", "it can go live"), run the
**`/ship`** skill (one of the user's own skills, shared by their repos; this
repo's settings for it are in `.claude/ship.json`): it brings the branch up to
date, runs the tests, pushes, opens the PR and labels it `ship`. That is the
user's go-ahead for that change; do not merge it yourself.

The **ship steward** (the "Ship steward" scheduled task: a fresh short session
every few minutes, each one pass over every repo on the queue) merges `ship` PRs
one at a time: each up to date with `main` and passing CI on the exact commit
merged, and each release finished before the next merge. It picks the order,
sends a failure back to the PR's session, or has `main` fixed first when the
failure is `main`'s. There are no required checks on GitHub, so the steward is
the gate: never `gh pr merge --auto`, and don't merge around the queue.

Merging to `main` is releasing. The "Publish Container Image" workflow rebuilds
`ghcr.io/hobesman/ytzero:edge`, and the user's server installs it only when they
redeploy its Portainer stack with re-pull image turned on.

## The stash is shared

The stash stack is shared by the main checkout and every worktree, and other
sessions push and pop it while you work. A bare `git stash pop` can take someone
else's work.

Set work aside with a WIP commit on your own branch. If you must stash:

```
git stash push -u -m "<unique-tag>"
git stash list --format='%H %gs'      # find your own entry's SHA
git stash apply <sha>                 # never pop, never stash@{n}
```

## Running and testing

- Bun is installed on this machine with winget. A new worktree has no
  dependencies: run `bun install --frozen-lockfile` in `app/` and `ui/` first.
- Run the specific typechecks and tests a change needs (`bun run typecheck`,
  `bun run test`, or a single test file). AGENTS.md reserves the full pre-commit
  chain for the repository owner; the "Validate" workflow runs it on every PR and
  every push to `main`.
- Production runs on the user's Linux server as the `ytzero` container from
  `ghcr.io/hobesman/ytzero:edge`. Its log is `/data/logs/ytzero.log` inside the
  container, and the user runs any commands there.

## Known traps

- **File size limits.** `scripts/check-large-files.ts` caps the line count of
  the project's biggest files (`youtube.ts`, `refresher.ts`, the route files,
  `schema.sql` and more), and Validate fails on any growth, even a comment. Put
  new code in a new module rather than growing a capped file.
- **`schema.sql` is fingerprinted.** Any change to it, comments included, needs
  a new migration in `app/src/databaseMigrations.ts` for both SQLite and
  PostgreSQL. On this Windows checkout the migration check fails even when the
  file is unchanged, because `core.autocrlf` gives it CRLF endings: compare the
  hash with the CRs stripped, or rely on Validate.
- **14 app tests fail on Windows only** (download, file-permission and
  isolated-runtime suites). They pass on Linux; don't chase them for a change
  that doesn't touch those areas.
- **`user_channels.followed` defaults to 1.** A row inserted only to store a
  per-channel setting must set `followed = 0`, or it silently subscribes the
  profile to that channel.
