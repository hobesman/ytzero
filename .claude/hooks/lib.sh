# Shared helpers for the guard hooks. Sourced, never run on its own.
#
# Hooks are handed the tool call as JSON on stdin and there is no jq on this
# machine. Parsing stays inside bash on purpose: sed and friends are handed
# their patterns through MSYS argument conversion, which eats backslashes and
# turns an escape into a syntax error. A field that cannot be read comes back
# empty, and every guard reads that as "nothing to say" -- a guard that cannot
# parse its input must never block work.

BS='\'
QT='"'
SQ="'"
MARK=$'\x01'

json_field() {   # json_field <name> <payload> -> the string field, JSON escapes decoded
  local name=$1 payload=$2 re v
  re="$QT$name$QT[[:space:]]*:[[:space:]]*$QT(($BS$BS.|[^$QT$BS])*)$QT"
  [[ $payload =~ $re ]] || return 0
  v=${BASH_REMATCH[1]}
  # Quoted patterns: unquoted, "\\" would match one backslash, not an escape.
  v=${v//"$BS$BS"/$MARK}      # \\ -> placeholder, so the escapes below are unambiguous
  v=${v//"$BS$QT"/$QT}
  v=${v//"${BS}n"/$'\n'}
  v=${v//"${BS}t"/$'\t'}
  v=${v//"$BS/"/'/'}
  printf '%s' "${v//"$MARK"/"$BS"}"
}

# command_text <command>: the command minus the text it only carries --
# single- and double-quoted strings and here-document bodies -- so a commit
# message or PR description that mentions a git command is not mistaken for
# running it. Text the shell still runs is kept: a double-quoted string or an
# unquoted here-document line holding $(...) or a backtick, and an unbalanced
# quote, so a guard never goes blind to a command it cannot parse.
command_text() {
  local in=$1 line delim="" expand=0 kept="" re
  re="(^|[^<])<<-?[[:space:]]*([$QT$SQ])?([A-Za-z_][A-Za-z0-9_]*)"
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$delim" ]; then
      if [ "${line#"${line%%[![:space:]]*}"}" = "$delim" ]; then delim=""; continue; fi
      if [ "$expand" = 1 ]; then case $line in *'$('*|*'`'*) kept+="$line"$'\n' ;; esac; fi
      continue
    fi
    kept+="$line"$'\n'
    if [[ $line =~ $re ]]; then
      delim=${BASH_REMATCH[3]}
      if [ -n "${BASH_REMATCH[2]}" ]; then expand=0; else expand=1; fi
    fi
  done <<< "$in"

  local i c q="" seg="" out=""
  for (( i = 0; i < ${#kept}; i++ )); do
    c=${kept:i:1}
    if [ -z "$q" ]; then
      case $c in
        "$BS") out+=$c${kept:i+1:1}; i=$((i + 1)) ;;
        "$SQ"|"$QT") q=$c; seg="" ;;
        *) out+=$c ;;
      esac
    elif [ "$q" = "$QT" ] && [ "$c" = "$BS" ]; then
      seg+=$c${kept:i+1:1}; i=$((i + 1))
    elif [ "$c" = "$q" ]; then
      if [ "$q" = "$QT" ]; then
        case $seg in *'$('*|*'`'*) out+=$seg ;; *) out+=" " ;; esac
      else
        out+=" "
      fi
      q=""
    else
      seg+=$c
    fi
  done
  [ -n "$q" ] && out+=$seg
  printf '%s' "$out"
}

allow() { exit 0; }

decide() {       # decide <allow|deny|ask> <reason>
  local reason=$2
  reason=${reason//$BS/$BS$BS}
  reason=${reason//$QT/$BS$QT}
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$reason"
  exit 0
}

jesc() {         # jesc <text> -> the same text, safe inside a JSON string
  local s=$1
  s=${s//$BS/$BS$BS}
  printf '%s' "${s//$QT/$BS$QT}"
}
