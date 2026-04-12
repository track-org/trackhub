#!/usr/bin/env bash
# cred_health_with_state.sh — Run credential-health check and update graceful-degradation state
#
# Runs credential-health.cjs for specified services, then updates the credential-state.json
# with the results. Outputs JSON with both health check results and alert recommendations.
#
# Usage:
#   cred_health_with_state.sh --check <svc1,svc2> [--cooldown-hours N] [--json]
#
# Exit codes:
#   0 — all credentials healthy
#   1 — one or more credentials failing (alert may or may not be recommended)
#
# Requires: credential-health.cjs in PATH or CRED_HEALTH_SCRIPT env var
# Requires: jq

set -euo pipefail

HEALTH_SCRIPT="${CRED_HEALTH_SCRIPT:-}"
STATE_DIR="${STATE_DIR:-$HOME/.openclaw/workspace}"
STATE_SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COOLDOWN_HOURS="${CRED_COOLDOWN_HOURS:-24}"

# Find credential-health.cjs
if [ -z "$HEALTH_SCRIPT" ]; then
  for candidate in \
    "$STATE_SCRIPT_DIR/../credential-health/scripts/credential-health.cjs" \
    "$HOME/.openclaw/workspace/trackhub/skills/credential-health/scripts/credential-health.cjs" \
    "$(which credential-health.cjs 2>/dev/null)"; do
    if [ -f "$candidate" ]; then
      HEALTH_SCRIPT="$candidate"
      break
    fi
  done
fi

if [ -z "$HEALTH_SCRIPT" ] || [ ! -f "$HEALTH_SCRIPT" ]; then
  echo "ERROR: credential-health.cjs not found. Set CRED_HEALTH_SCRIPT or ensure it's on PATH." >&2
  exit 2
fi

CHECK_SERVICES=""
JSON_OUTPUT=false

while [ $# -gt 0 ]; do
  case "$1" in
    --check)
      CHECK_SERVICES="$2"
      shift 2
      ;;
    --cooldown-hours)
      COOLDOWN_HOURS="$2"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$CHECK_SERVICES" ]; then
  echo "Usage: cred_health_with_state.sh --check <svc1,svc2> [--cooldown-hours N] [--json]" >&2
  exit 2
fi

# Run credential health check
HEALTH_OUTPUT=$(CRED_COOLDOWN_HOURS="$COOLDOWN_HOURS" node "$HEALTH_SCRIPT" --check "$CHECK_SERVICES" --json 2>&1) || true

if [ "$JSON_OUTPUT" = true ]; then
  echo "$HEALTH_OUTPUT"
else
  echo "$HEALTH_OUTPUT" | jq -r '.results[]? | "\(.service): \(.status) \(.detail // "")"' 2>/dev/null || echo "$HEALTH_OUTPUT"
fi

# Update state for each result
echo "$HEALTH_OUTPUT" | jq -r '.results[]? | "\(.service)|\(.status)|\(.detail // "")"' 2>/dev/null | while IFS='|' read -r svc status detail; do
  [ -z "$svc" ] && continue
  CRED_COOLDOWN_HOURS="$COOLDOWN_HOURS" "$STATE_SCRIPT_DIR/cred_state.sh" "$svc" >/dev/null 2>&1 || true
  if [ "$status" = "fail" ]; then
    CRED_COOLDOWN_HOURS="$COOLDOWN_HOURS" "$STATE_SCRIPT_DIR/cred_state.sh" "$svc" set-failing "$detail" >/dev/null 2>&1 || true
  else
    CRED_COOLDOWN_HOURS="$COOLDOWN_HOURS" "$STATE_SCRIPT_DIR/cred_state.sh" "$svc" set-ok >/dev/null 2>&1 || true
  fi
done
