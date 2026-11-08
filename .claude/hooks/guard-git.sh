#!/usr/bin/env bash
# PreToolUse on Bash. Catches the three git moves that cost us time before:
# a stash that another session can pop, a PR opened from a branch that never
# merged main, and a push to main that nobody asked for.
set -u
. "$(dirname "$0")/lib.sh"

payload=$(cat)
cmd=$(json_field command "$payload")
cwd=$(json_field cwd "$payload")
[ -n "$cmd" ] || allow
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null

# --- the shared stash stack -------------------------------------------------
# Every worktree and the main checkout share one stack, so a bare pop can take
# work belonging to a session that is still running.
case "$cmd" in
  *"git stash"*)
    case "$cmd" in
      *"git stash list"*|*"git stash show"*) ;;
      *"git stash pop"*)
        decide deny "The stash stack is shared with every other worktree and checkout of this repo, so 'git stash pop' can take a stash another session pushed. Set work aside with a WIP commit on this branch instead, or, if you must stash: git stash push -u -m \"<unique-tag>\", then restore it by its own SHA with git stash apply <sha>." ;;
      *"git stash push"*|*"git stash save"*)
        case "$cmd" in
          *" -m "*|*" --message"*) ;;
          *) decide deny "Tag the stash so it can be found again in a shared stack: git stash push -u -m \"<unique-tag>\". Untagged, no session can tell which stash@{n} is its own." ;;
        esac ;;
      *"git stash apply"*|*"git stash drop"*)
        printf '%s' "$cmd" | grep -Eq 'git stash (apply|drop)[[:space:]]+[0-9a-f]{7,40}' || \
          decide deny "Name the stash by its own SHA (git stash list --format='%H %gs' finds it). A bare stash@{n} points at whatever is on top of the shared stack right now, which may be another session's work." ;;
      *)
        decide deny "A bare 'git stash' puts work on a stack shared with every other worktree of this repo. Prefer a WIP commit on this branch; if you must stash, use git stash push -u -m \"<unique-tag>\"." ;;
    esac ;;
esac

# --- opening a PR from a branch that is behind main -------------------------
case "$cmd" in
  *"gh pr create"*)
    git fetch -q origin main 2>/dev/null
    base=$(git rev-parse -q --verify FETCH_HEAD 2>/dev/null || git rev-parse -q --verify origin/main 2>/dev/null)
    if [ -n "$base" ] && ! git merge-base --is-ancestor "$base" HEAD 2>/dev/null; then
      behind=$(git rev-list --count "HEAD..$base" 2>/dev/null)
      decide ask "This branch is $behind commit(s) behind main, so the PR will show changes that are not its own. Run 'git merge main --no-edit' here first, then open the PR."
    fi ;;
esac

# --- pushing to main --------------------------------------------------------
case "$cmd" in
  *"git push"*)
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    hits_main=no
    case "$cmd" in *" main"*|*":main"*|*"main:"*) hits_main=yes ;; esac
    [ "$branch" = "main" ] && hits_main=yes
    [ "$hits_main" = yes ] && \
      decide ask "This pushes to main. The rule in this repo is to commit on the working branch and merge or push to main only when the user says so, per change."
    ;;
esac

allow
