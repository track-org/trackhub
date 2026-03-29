#!/usr/bin/env python3
"""Solis solar inverter — read-only status helper.

Env file discovery (load_env):
  1. SOLIS_ENV_FILE env var (explicit path)
  2. Fallback: .env in the OpenClaw workspace directory
     (resolved as four levels up from this script:
      scripts/ → solis-energy/ → skills/ → trackhub/ → workspace/)

This works when the skill lives inside the trackhub repo inside the
OpenClaw workspace.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import formatdate
from pathlib import Path
from typing import Any

import requests

_SCRIPT_DIR = Path(__file__).resolve().parent
# scripts/ → solis-energy/ → skills/ → trackhub/ → workspace
_WORKSPACE_DIR = _SCRIPT_DIR.parent.parent.parent.parent


def _default_env_path() -> Path:
    return _WORKSPACE_DIR / '.env'


def load_env(path: Path | None = None) -> None:
    """Load a .env file into os.environ (only sets vars not already set)."""
    if path is None:
        explicit = os.environ.get('SOLIS_ENV_FILE')
        path = Path(explicit) if explicit else _default_env_path()
    if not path.exists():
        raise SystemExit(f'Missing env file: {path}')
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith('#') or '=' not in s:
            continue
        k, v = s.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())


def require_env(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise SystemExit(f'Missing required env var: {name}')
    return value


def solis_post(resource: str, body: dict[str, Any]) -> Any:
    base = require_env('SOLIS_API_URL').rstrip('/')
    key = require_env('SOLIS_KEY_ID')
    secret = require_env('SOLIS_KEY_SECRET').encode()

    body_json = json.dumps(body, separators=(',', ':'))
    content_md5 = base64.b64encode(hashlib.md5(body_json.encode()).digest()).decode()
    content_type = 'application/json'
    date = formatdate(usegmt=True)
    sign_str = 'POST\n' + content_md5 + '\n' + content_type + '\n' + date + '\n' + resource
    signature = base64.b64encode(hmac.new(secret, sign_str.encode(), hashlib.sha1).digest()).decode()
    headers = {
        'Content-MD5': content_md5,
        'Content-Type': content_type,
        'Date': date,
        'Authorization': f'API {key}:{signature}',
    }

    retries = [0.0, 1.2, 2.5]
    last_resp = None
    for delay in retries:
        if delay:
            time.sleep(delay)
        resp = requests.post(base + resource, headers=headers, data=body_json, timeout=20)
        last_resp = resp
        if resp.status_code == 429:
            continue
        resp.raise_for_status()
        payload = resp.json()
        code = str(payload.get('code'))
        if code not in {'0', 'I0000'}:
            raise SystemExit(f"Solis API error: {payload.get('msg', 'unknown')} (code {code})")
        return payload.get('data')

    if last_resp is not None:
        last_resp.raise_for_status()
    raise SystemExit('Solis API request failed unexpectedly.')


def today_str(offset_hours: int = 0) -> str:
    now = datetime.now(timezone.utc) + timedelta(hours=offset_hours)
    return now.strftime('%Y-%m-%d')


def get_plant_id() -> int | None:
    raw = os.environ.get('SOLIS_PLANT_ID', '').strip()
    return int(raw) if raw else None


def cmd_today() -> None:
    data = solis_post('/v1/api/stationDayEnergyList', {
        'pageNo': 1,
        'pageSize': 100,
        'time': today_str(),
    })
    records = (data or {}).get('records') or []
    plant_id = str(get_plant_id()) if get_plant_id() is not None else None
    record = None
    if plant_id:
        record = next((r for r in records if str(r.get('id')) == plant_id), None)
    if record is None and records:
        record = records[0]
    if record is None:
        raise SystemExit('No Solis generation record found for today.')

    print(json.dumps({
        'date': record.get('dateStr'),
        'generation_kwh': record.get('energy'),
        'grid_sold_kwh': record.get('gridSellEnergy'),
        'grid_purchased_kwh': record.get('gridPurchasedEnergy'),
        'home_load_kwh': record.get('homeLoadEnergy'),
        'self_consumed_kwh': record.get('oneSelf'),
    }, indent=2))


def cmd_now() -> None:
    plant_id = get_plant_id()
    if plant_id is None:
        raise SystemExit('SOLIS_PLANT_ID is required for the now command.')
    data = solis_post('/v1/api/inverterDetailList', {'pageNo': 1, 'pageSize': 100})
    records = data if isinstance(data, list) else (data or {}).get('records') or []
    if not records:
        raise SystemExit('No inverter records returned.')

    record = next((r for r in records if str(r.get('stationId')) == str(plant_id)), None)
    if record is None:
        record = records[0]

    power_kw = None
    for key in ['power', 'pac', 'apparentPower', 'outputPower']:
        value = record.get(key)
        if isinstance(value, (int, float)):
            power_kw = round(value / 1000, 3) if value > 1000 else value
            break

    print(json.dumps({
        'inverter_sn': record.get('sn'),
        'status': record.get('state') or record.get('stateStr') or record.get('inverterStatus'),
        'current_power_kw': power_kw,
        'last_seen': record.get('dataTimestamp') or record.get('lastUpdateTime') or record.get('updateTimeStr'),
    }, indent=2))


def cmd_yesterday() -> None:
    date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    data = solis_post('/v1/api/stationDayEnergyList', {
        'pageNo': 1,
        'pageSize': 100,
        'time': date,
    })
    records = (data or {}).get('records') or []
    plant_id = str(get_plant_id()) if get_plant_id() is not None else None
    record = None
    if plant_id:
        record = next((r for r in records if str(r.get('id')) == plant_id), None)
    if record is None and records:
        record = records[0]
    if record is None:
        raise SystemExit('No Solis generation record found for yesterday.')

    print(json.dumps({
        'date': record.get('dateStr'),
        'generation_kwh': record.get('energy'),
        'grid_sold_kwh': record.get('gridSellEnergy'),
        'grid_purchased_kwh': record.get('gridPurchasedEnergy'),
        'home_load_kwh': record.get('homeLoadEnergy'),
        'self_consumed_kwh': record.get('oneSelf'),
    }, indent=2))


def main() -> None:
    load_env()
    parser = argparse.ArgumentParser(description='Read-only Solis status helper')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('today')
    sub.add_parser('now')
    sub.add_parser('yesterday')
    args = parser.parse_args()

    if args.command == 'today':
        cmd_today()
    elif args.command == 'now':
        cmd_now()
    elif args.command == 'yesterday':
        cmd_yesterday()
    else:
        raise SystemExit(2)


if __name__ == '__main__':
    try:
        main()
    except requests.HTTPError as e:
        detail = e.response.text[:500] if e.response is not None else str(e)
        print(f'HTTP error from Solis API: {detail}', file=sys.stderr)
        raise SystemExit(1)
