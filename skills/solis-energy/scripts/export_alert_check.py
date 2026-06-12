#!/usr/bin/env python3
"""Solis solar export alert checker.

Determines whether conditions are right to nudge Don to charge his EV:
  - Solar output ≥ 0.2 kW
  - Grid export ≥ 0.5 kW
  - No alert delivered in the last 4 hours

Outputs JSON with should_alert boolean and an optional message.

Cron job ID (for cooldown lookup):
  - EXPORT_ALERT_CRON_JOB_ID env var
  - Or --cron-job-id CLI argument
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Ensure the scripts directory is importable so `from solis_status import …` works
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from solis_status import load_env, solis_post  # noqa: E402

COOLDOWN_SECONDS = 4 * 60 * 60
MIN_SOLAR_KW = 0.2
MIN_EXPORT_KW = 0.5


def _get_cron_job_id() -> str:
    """Resolve the cron job ID from CLI arg or env var."""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--cron-job-id', dest='cron_job_id')
    args, _ = parser.parse_known_args()
    if args.cron_job_id:
        return args.cron_job_id
    env_id = os.environ.get('EXPORT_ALERT_CRON_JOB_ID', '').strip()
    if env_id:
        return env_id
    raise SystemExit(
        'Cron job ID required: set EXPORT_ALERT_CRON_JOB_ID env var '
        'or pass --cron-job-id <id>'
    )


_STATE_FILE = _SCRIPT_DIR / '.export_alert_cooldown.json'


def get_last_delivered_alert_ts(job_id: str) -> int:  # noqa: ARG001
    """Read the timestamp of the last delivered alert from a local state file.

    Uses a flat JSON file instead of `openclaw cron runs` because main-session
    systemEvent jobs report deliveryStatus="not-requested" and never expose a
    ``delivered: true`` entry.
    """
    try:
        if _STATE_FILE.is_file():
            data = json.loads(_STATE_FILE.read_text())
            return int(data.get('last_alert_ts', 0))
    except Exception:
        pass
    return 0


def record_alert_delivered() -> None:
    """Persist the current timestamp so future calls can enforce the cooldown."""
    _STATE_FILE.write_text(json.dumps({'last_alert_ts': int(time.time())}))


def main() -> None:
    job_id = _get_cron_job_id()
    load_env()
    data = solis_post('/v1/api/inverterDetailList', {'pageNo': 1, 'pageSize': 100})
    records = data if isinstance(data, list) else (data or {}).get('records') or []
    if not records:
        raise SystemExit('No inverter records returned from Solis.')
    record = records[0]

    grid = (record.get('gridDetailVo') or {}).get('gridPower')
    solar_kw = record.get('pac')
    load_kw = record.get('familyLoadPower') or record.get('totalLoadPower')
    now_ts = int(time.time())

    # Observed sign convention here: negative gridPower means importing, positive means exporting.
    export_kw = float(grid) if isinstance(grid, (int, float)) and grid > 0 else 0.0
    solar_kw = float(solar_kw) if isinstance(solar_kw, (int, float)) else 0.0
    load_kw = float(load_kw) if isinstance(load_kw, (int, float)) else None

    last_alert_ts = get_last_delivered_alert_ts(job_id)
    cooldown_remaining = max(0, COOLDOWN_SECONDS - (now_ts - last_alert_ts))

    daylight_like = solar_kw >= MIN_SOLAR_KW
    exporting = export_kw >= MIN_EXPORT_KW
    cooldown_ok = cooldown_remaining == 0
    should_alert = daylight_like and exporting and cooldown_ok

    message = None
    if should_alert:
        msg = [
            'You are exporting solar to the grid right now.',
            f'Export: {export_kw:.2f} kW',
            f'Solar output: {solar_kw:.2f} kW',
        ]
        if load_kw is not None:
            msg.append(f'House load: {load_kw:.2f} kW')
        msg.append('Might be a good time to plug in the car.')
        message = '\n'.join(msg)
        record_alert_delivered()

    print(json.dumps({
        'timestamp': now_ts,
        'daylight_like': daylight_like,
        'exporting': exporting,
        'cooldown_ok': cooldown_ok,
        'should_alert': should_alert,
        'cooldown_remaining_seconds': cooldown_remaining,
        'solar_output_kw': solar_kw,
        'export_kw': export_kw,
        'house_load_kw': load_kw,
        'last_delivered_alert_ts': last_alert_ts or None,
        'message': message,
    }, indent=2))


if __name__ == '__main__':
    main()
