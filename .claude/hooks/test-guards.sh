#!/usr/bin/env bash
# Feeds JSON-encoded tool calls to the guard hooks and checks each decision.
# Run it after any change to the hooks:
#   bash .claude/hooks/test-guards.sh .claude/hooks '<repo dir in Windows form>'
hooks=$1
repo=$2
pass=0
fail=0

jenc() {   # JSON-encode a string the way Claude Code sends it
  local s=$1
  s=${s//'\'/'\\'}
  s=${s//'"'/'\"'}
  s=${s//$'\n'/'\n'}
  s=${s//$'\t'/'\t'}
  printf '%s' "$s"
}

decision() {   # decision <hook> <payload> -> deny | ask | none
  local out
  out=$(printf '%s' "$2" | bash "$hooks/$1")
  case $out in
    *'"permissionDecision":"deny"'*) echo deny ;;
    *'"permissionDecision":"ask"'*) echo ask ;;
    *) echo none ;;
  esac
}

report() {   # report <expected> <got> <label>
  if [ "$2" = "$1" ]; then pass=$((pass + 1)); echo "ok    $2  $3"; else fail=$((fail + 1)); echo "FAIL  got $2, want $1  $3"; fi
}

check() {   # check <expected> <label> <command>  -- a Bash tool call
  report "$1" "$(decision guard-git.sh "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$(jenc "$3")\"},\"cwd\":\"$(jenc "$repo")\"}")" "$2"
}

check_ps() {   # check_ps <expected> <label> <command>  -- a PowerShell tool call
  report "$1" "$(decision guard-git.sh "{\"tool_name\":\"PowerShell\",\"tool_input\":{\"command\":\"$(jenc "$3")\"},\"cwd\":\"$(jenc "$repo")\"}")" "PowerShell: $2"
}

check_edit() {   # check_edit <expected> <label> <file path>
  report "$1" "$(decision guard-worktree.sh "{\"tool_input\":{\"file_path\":\"$(jenc "$3")\"},\"cwd\":\"$(jenc "$repo")\"}")" "$2"
}

S='git stash pop'

echo "--- real commands are still caught"
check deny "bare stash pop" "$S"
check deny "stash pop after another command" "git status && $S"
check deny "stash pop inside \$( ) in double quotes" "echo \"\$($S)\""
check deny "stash pop in an unquoted here-document's \$( )" $'cat <<EOF\n$('"$S"$')\nEOF'
check deny "stash pop after a quoted here-document ends" $'cat <<\'EOF\'\nhello\nEOF\n'"$S"
check deny "stash pop after an unbalanced quote" "git commit -m \"oops $S"
check deny "stash apply by stash@{0}" "git stash apply stash@{0}"
check deny "untagged stash push" "git stash push -u"
check ask  "push to main" "git push origin main"

echo "--- text that only mentions a command passes"
check none "double-quoted commit message" "git commit -m \"note: $S is refused\""
check none "single-quoted commit message" "git commit -m 'note: $S is refused'"
check none "quoted here-document commit message" $'git commit -F - <<\'EOF\'\nRefuse '"$S"$' and git push origin main.\nEOF'
check none "PR body in a quoted here-document" $'gh pr create --title "x" --body-file - <<\'EOF\'\nThe hook refuses `'"$S"$'`.\nEOF'
check none "commit message mentioning a push to main" "git commit -m \"then git push origin main\""

echo "--- ordinary commands pass"
check none "git status" "git status"
check none "tagged stash push" "git stash push -u -m \"my-tag\""
check none "stash apply by SHA" "git stash apply 0123456789abcdef0123456789abcdef01234567"

echo "--- each stash invocation is judged on its own"
check deny "list, then pop" "git stash list; $S"
check deny "list piped on, then apply by stash@{0}" "git stash list | wc -l && git stash apply stash@{0}"
check deny "show, then untagged push" "git stash show -p && git stash push -u"
check deny "list, then bare stash" "git stash list && git stash"
check deny "list, then pop on the next line" $'git stash list\n'"$S"
check deny "list, then pop inside \$( )" "git stash list; echo \$($S)"
check deny "a tagged push does not cover an untagged one" "git stash push -u -m \"a\" && git stash push -u"
check deny "apply by SHA, then drop by stash@{1}" "git stash apply 0123456 && git stash drop stash@{1}"
check deny "pop before a list" "$S; git stash list"
check none "list, then show" "git stash list --format='%H %gs' && git stash show -p 0123456"
check none "list piped to grep" "git stash list | grep my-tag"
check none "tagged push, list, apply by SHA" "git stash push -u -m \"t\" && git stash list && git stash apply 0123456789abcdef"
check none "list, then a commit message mentioning pop" "git stash list && git commit -m \"never $S\""

echo "--- PowerShell commands are guarded too"
check_ps deny "bare stash pop" "$S"
check_ps deny "list, then pop" "git stash list; $S"
check_ps deny "list piped on, then apply by stash@{0}" "git stash list | Select-String tag; git stash apply stash@{0}"
check_ps deny "untagged stash push" "git stash push -u"
check_ps ask  "push to main" "git push origin main"
check_ps deny "pop after a single-quoted here-string" $'$msg = @\'\nnote\n\'@\ngit commit -m $msg\n'"$S"
check_ps deny "pop after the closing line of a here-string" $'@\'\nmsg\n\'@ | git commit -F -; '"$S"
check_ps deny "pop inside \$( ) in a double-quoted here-string" $'git commit -m @"\nnote $('"$S"$')\n"@'
check_ps deny "pop after a here-string that never closes" $'git commit -m @\'\nnote\n'"$S"
check_ps deny "a backslash does not escape a quote" "git commit -m \"C:\\temp\\\"; $S; echo \"\\\""
check_ps none "single-quoted here-string with an apostrophe" $'git commit -m @\'\nDon\'t run '"$S"$'; git push origin main.\n\'@'
check_ps none "double-quoted here-string commit message" $'git commit -m @"\nThe hook refuses "'"$S"$'".\n"@'
check_ps none "here-string piped to git commit" $'@\'\nRefuse '"$S"$'.\n\'@ | git commit -F -'
check_ps none "backtick-escaped quotes in a message" "git commit -m \"say \`\"$S\`\" never\""
check_ps none "doubled single quote in a message" "git commit -m 'it''s $S'"
check_ps none "stash tagged with a here-string" $'git stash push -u -m @\'\nmy-tag\n\'@'
check_ps none "list, then tagged push" "git stash list; git stash push -u -m \"ps-tag\""
check_ps none "git status" "git status"

echo "--- guard-worktree reads decoded Windows paths"
check_edit ask  "edit in the main checkout" "$repo\\CLAUDE.md"
check_edit none "edit outside any repo" "C:\\Users\\NickhaleHoban\\Downloads\\x.txt"

echo "--- $pass passed, $fail failed"
[ "$fail" = 0 ]
