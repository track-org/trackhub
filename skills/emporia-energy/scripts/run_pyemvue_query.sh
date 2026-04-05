#!/usr/bin/env bash
set -euo pipefail
# Resolve paths relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE="${SKILL_DATA_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
VENV="$WORKSPACE/.venv-emporia"
PY="$VENV/bin/python"
SCRIPT="$SCRIPT_DIR/query_emporia.py"
if [[ ! -x "$PY" ]]; then
  echo "Missing PyEmVue virtualenv at $VENV" >&2
  echo "Create it and install pyemvue first." >&2
  exit 2
fi
exec "$PY" "$SCRIPT" "$@"
