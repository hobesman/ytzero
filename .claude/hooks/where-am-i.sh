#!/usr/bin/env bash
# SessionStart. Says, in one line, which checkout this session woke up in and
# how far it has drifted, so the choice between "edit here" and "take a
# worktree of my own" gets made knowingly rather than by accident. No fetch:
# local refs only, so startup stays instant.
set -u
. "$(dirname "$0")/lib.sh"

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0
gitdir=$(git rev-parse --git-dir 2>/dev/null)
dirty=$(git status --porcelain 2>/dev/null | grep -c .)
behind=$(git rev-list --count "HEAD..origin/main" 2>/dev/null || echo 0)

case "$gitdir" in
  */worktrees/*) where="a worktree of its own" ;;
  *) where="the MAIN CHECKOUT (shared with every other session on this machine: edits here are not isolated, and a commit here can sweep up another session's half-finished work)" ;;
esac

note="This session is on branch '$branch' in $where, with $dirty uncommitted file(s)."
[ "${behind:-0}" -gt 0 ] && note="$note It is $behind commit(s) behind origin/main; merge main before opening a PR."
[ "$branch" = "main" ] && note="$note Work belongs on a branch, not on main."

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(jesc "$note")"
