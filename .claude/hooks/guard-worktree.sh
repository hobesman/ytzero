#!/usr/bin/env bash
# PreToolUse on the file-writing tools. Two sessions editing the same checkout
# lose each other's work silently: no conflict, no marker, nothing in git
# status. A worktree turns that into a merge, where git speaks up. So an edit
# in the main checkout asks first.
set -u
. "$(dirname "$0")/lib.sh"

payload=$(cat)
file=$(json_field file_path "$payload")
cwd=$(json_field cwd "$payload")
[ -n "$file" ] || allow

# The tools hand over a Windows path; dirname reads only forward slashes, and
# a path it cannot split resolves to "." -- which would quietly check the
# session's own directory instead of the file's and let the edit through.
file=${file//"$BS"/'/'}
dir=$(dirname "$file")
[ -d "$dir" ] || dir=${cwd//"$BS"/'/'}
[ -n "$dir" ] || allow
cd "$dir" 2>/dev/null || allow

# A worktree's git dir sits under .git/worktrees/<name>; the main checkout's
# does not. Anything outside a repo altogether is none of this hook's business.
gitdir=$(git rev-parse --git-dir 2>/dev/null) || allow
case "$gitdir" in
  *"/worktrees/"*) allow ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null)
name=$(basename "${root:-this repo}")

decide ask "This writes into the main checkout of $name, which every other session on this machine shares. Two sessions editing one checkout overwrite each other with nothing left to show for it, and they share one branch and one index, so a commit from either sweeps up whatever the other left half-finished. Unless the user asked for the change to happen here, make it in a worktree of its own."
