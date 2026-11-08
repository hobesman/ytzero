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
MARK=$'\x01'

json_field() {   # json_field <name> <payload>
  local name=$1 payload=$2 re v
  re="$QT$name$QT[[:space:]]*:[[:space:]]*$QT(($BS$BS.|[^$QT$BS])*)$QT"
  [[ $payload =~ $re ]] || return 0
  v=${BASH_REMATCH[1]}
  v=${v//$BS$BS/$MARK}        # \ -> placeholder, so \" below is unambiguous
  v=${v//$BS$QT/$QT}
  printf '%s' "${v//$MARK/$BS}"
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
