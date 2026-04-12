#!/usr/bin/env bash
# cred_state.sh — Read/write credential failure state for graceful degradation
# Usage:
#   cred_state.sh <service> [action] [value]
#
# Actions:
#   (none)       Print current state JSON (creates default if missing)
#   set-failing  Mark service as failing with reason
#   set-ok       Mark service as recovered
#   should-alert Check if alert should be sent (respects cooldown)
#   mark-alerted Record that an alert was sent
#   status       Human-readable one-liner status
#
# State file: <portable-path>workspace/credential-state.json
# Zero external dependencies. Pure bash + jq.

set -euo pipefail

STATE_DIR="${STATE_DIR:-$HOME/.openclaw/workspace}"
STATE_FILE="$STATE_DIR/credential-state.json"
COOLDOWN_DEFAULT="${CRED_COOLDOWN_HOURS:-24}"

usage() {
  echo "Usage: cred_state.sh <service> [action] [value]" >&2
  echo "Actions: (read), set-failing, set-ok, should-alert, mark-alerted, status" >&2
  exit 1
}

[ $# -lt 1 ] && usage
SERVICE="$1"
ACTION="${2:-}"
VALUE="${3:-}"

init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    printf '{"services":{}}\n' > "$STATE_FILE"
  fi
}

now_epoch() {
  date +%s
}

get_field() {
  jq -r ".services[\"$SERVICE\"].$1 // empty" "$STATE_FILE" 2>/dev/null || echo ""
}

set_state() {
  _gs_tmp=$(mktemp)
  jq --arg svc "$SERVICE" --arg key "$1" --arg val "$2" \
    '.services[$svc][$key] = $val' "$STATE_FILE" > "$_gs_tmp" && mv "$_gs_tmp" "$STATE_FILE"
}

case "$ACTION" in
  "")
    init_state
    jq ".services[\"$SERVICE\"] // {}" "$STATE_FILE"
    ;;

  set-failing)
    init_state
    set_state "status" "failing"
    set_state "reason" "${VALUE:-unknown}"
    set_state "since" "$(now_epoch)"
    set_state "lastAlertAt" "0"
    echo "OK: $SERVICE marked as failing (reason: ${VALUE:-unknown})"
    ;;

  set-ok)
    init_state
    set_state "status" "ok"
    set_state "reason" ""
    set_state "since" "$(now_epoch)"
    echo "OK: $SERVICE marked as recovered"
    ;;

  should-alert)
    init_state
    _sa_status=$(get_field "status")
    [ "$_sa_status" != "failing" ] && echo "no" && exit 0
    _sa_last_alert=$(get_field "lastAlertAt")
    _sa_now=$(now_epoch)
    _sa_cooldown_secs=$((COOLDOWN_DEFAULT * 3600))
    if [ -z "$_sa_last_alert" ] || [ "$_sa_last_alert" = "0" ] || [ $((_sa_now - _sa_last_alert)) -ge $_sa_cooldown_secs ]; then
      echo "yes"
    else
      _sa_remaining=$(( _sa_cooldown_secs - (_sa_now - _sa_last_alert) ))
      _sa_remaining_h=$(( _sa_remaining / 3600 ))
      echo "no (cooldown: ${_sa_remaining_h}h remaining)"
    fi
    ;;

  mark-alerted)
    init_state
    set_state "lastAlertAt" "$(now_epoch)"
    echo "OK: $SERVICE alert timestamp updated"
    ;;

  status)
    init_state
    _st_status=$(get_field "status")
    _st_reason=$(get_field "reason")
    _st_since=$(get_field "since")
    if [ -z "$_st_status" ] || [ "$_st_status" = "ok" ]; then
      echo "$SERVICE: ok"
    else
      _st_since_human=$(date -d "@${_st_since}" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")
      echo "$SERVICE: FAILING since $_st_since_human — $_st_reason"
    fi
    ;;

  *)
    usage
    ;;
esac
