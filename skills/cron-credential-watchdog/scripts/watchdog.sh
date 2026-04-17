#!/usr/bin/env bash
# cron-credential-watchdog — runs credential-health + graceful-degradation in one pass
# Usage: watchdog.sh [--json] [--services svc1 svc2] [--timeout N]
#
# Exit codes:
#   0 = all healthy (or all failures in cooldown)
#   1 = new failures that should be alerted
#   2 = script/config error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKHUB="$(cd "$SCRIPT_DIR/../.." && pwd)"
CRED_HEALTH="$TRACKHUB/credential-health/scripts/credential-health.cjs"
CRED_STATE="$TRACKHUB/graceful-degradation/scripts/cred_state.sh"

# Defaults
JSON_OUTPUT=false
SERVICES=()
TIMEOUT=10

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON_OUTPUT=true; shift ;;
    --services) shift; SERVICES=("$@"); break ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Validate dependencies
if [[ ! -f "$CRED_HEALTH" ]]; then
  echo "ERROR: credential-health script not found at $CRED_HEALTH" >&2
  exit 2
fi
if [[ ! -f "$CRED_STATE" ]]; then
  echo "ERROR: cred_state.sh not found at $CRED_STATE" >&2
  exit 2
fi

# Build credential-health command
CRED_ARGS=(--json --fail-only --timeout "$TIMEOUT")
if [[ ${#SERVICES[@]} -gt 0 ]]; then
  CRED_ARGS+=(--check "${SERVICES[@]}")
fi

# Run credential health check
CRED_OUTPUT=$(node "$CRED_HEALTH" "${CRED_ARGS[@]}" 2>&1) || true

if $JSON_OUTPUT; then
  # Check if node produced valid JSON
  if ! echo "$CRED_OUTPUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
    echo "$CRED_OUTPUT" >&2
    echo '{"error":"credential-health script failed","results":[],"summary":{"ok":0,"fail":0,"skip":0}}'
    exit 2
  fi
fi

# Parse results — extract failed services
FAILED_SERVICES=()
if echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r.get('status') == 'fail':
        print(r['service'])
" 2>/dev/null; then
  while IFS= read -r svc; do
    [[ -n "$svc" ]] && FAILED_SERVICES+=("$svc")
  done < <(echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r.get('status') == 'fail':
        print(r['service'])
" 2>/dev/null)
fi

# Check for recovered services (previously failing, now passing)
RECOVERED_SERVICES=()
if echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r.get('status') == 'ok':
        print(r['service'])
" 2>/dev/null; then
  while IFS= read -r svc; do
    [[ -n "$svc" ]] || continue
    # Check if this service was previously marked as failing
    STATE_FILE="${XDG_STATE_DIR:-$HOME/.local/state}/openclaw/credential-state.json"
    if [[ -f "$STATE_FILE" ]] && python3 -c "
import json, sys
state = json.load(open('$STATE_FILE'))
svc_state = state.get('$svc', {}).get('status', '')
sys.exit(0 if svc_state == 'failing' else 1)
" 2>/dev/null; then
      RECOVERED_SERVICES+=("$svc")
      # Mark as recovered
      bash "$CRED_STATE" "$svc" set-ok >/dev/null 2>&1 || true
    fi
  done < <(echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r.get('status') == 'ok':
        print(r['service'])
" 2>/dev/null)
fi

# If no failures, we're done
if [[ ${#FAILED_SERVICES[@]} -eq 0 ]]; then
  if $JSON_OUTPUT; then
    echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['summary']['recovered'] = ${#RECOVERED_SERVICES[@]}
print(json.dumps(data, indent=2))
"
  fi
  exit 0
fi

# Check which failures should trigger alerts (respect cooldown)
NEW_ALERTS=()
for svc in "${FAILED_SERVICES[@]}"; do
  SHOULD_ALERT=$(bash "$CRED_STATE" "$svc" should-alert 2>/dev/null || echo "yes")
  if [[ "$SHOULD_ALERT" == yes* ]]; then
    NEW_ALERTS+=("$svc")
    bash "$CRED_STATE" "$svc" mark-alerted >/dev/null 2>&1 || true
  fi
done

if $JSON_OUTPUT; then
  echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
# Annotate results with shouldAlert
new_alerts = $(python3 -c "import json; print(json.dumps(${NEW_ALERTS[@]+$(printf '%s,' "${NEW_ALERTS[@]}" | sed 's/,$//')}))" 2>/dev/null || echo '[]')
na_set = set(new_alerts) if isinstance(new_alerts, list) else set()
for r in data.get('results', []):
    if r.get('status') == 'fail':
        r['shouldAlert'] = r['service'] in na_set
data['summary']['newAlerts'] = len(na_set)
data['summary']['recovered'] = ${#RECOVERED_SERVICES[@]}
print(json.dumps(data, indent=2))
" 2>/dev/null || echo "$CRED_OUTPUT"
elif [[ ${#NEW_ALERTS[@]} -eq 0 ]]; then
  # All failures in cooldown — silent
  exit 0
else
  # Human-readable alert
  echo "Credential Watchdog Report"
  echo "══════════════════════════"
  for svc in "${NEW_ALERTS[@]}"; do
    DETAIL=$(echo "$CRED_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for r in data.get('results', []):
    if r['service'] == '$svc':
        print(r.get('detail', 'Unknown error'))
        break
" 2>/dev/null || echo "Unknown error")
    echo "⚠️  $svc — $DETAIL"
  done
  if [[ ${#RECOVERED_SERVICES[@]} -gt 0 ]]; then
    echo ""
    echo "✅ Recovered:"
    for svc in "${RECOVERED_SERVICES[@]}"; do
      echo "   $svc — back to normal"
    done
  fi
fi

[[ ${#NEW_ALERTS[@]} -gt 0 ]] && exit 1 || exit 0
