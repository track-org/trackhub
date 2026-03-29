#!/usr/bin/env bash
set -euo pipefail
VENV="/home/delads/.openclaw/workspace/.venv-emporia"
PY="$VENV/bin/python"
SCRIPT="/home/delads/.openclaw/workspace/skills/emporia-energy/scripts/query_emporia.py"
if [[ ! -x "$PY" ]]; then
  echo "Missing PyEmVue virtualenv at $VENV" >&2
  echo "Create it and install pyemvue first." >&2
  exit 2
fi
exec "$PY" "$SCRIPT" "$@"
