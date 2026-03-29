#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo


def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


try:
    from pyemvue import PyEmVue
    from pyemvue.enums import Scale, Unit
except Exception as exc:  # pragma: no cover
    eprint(
        "Missing dependency: pyemvue. Install it with something like `python3 -m pip install pyemvue`."
    )
    eprint(f"Import error: {exc}")
    sys.exit(2)


SCALE_MAP = {
    "minute": Scale.MINUTE,
    "15min": Scale.MINUTES_15,
    "hour": Scale.HOUR,
    "day": Scale.DAY,
    "week": Scale.WEEK,
    "month": Scale.MONTH,
    "year": Scale.YEAR,
}


def parse_args():
    p = argparse.ArgumentParser(description="Query Emporia energy usage as JSON")
    p.add_argument("--env-file", default="/home/delads/.openclaw/workspace/.env")
    p.add_argument("--username", default=os.getenv("EMPORIA_USERNAME") or os.getenv("EMPORIA_ACCOUNT"))
    p.add_argument("--password", default=os.getenv("EMPORIA_PASSWORD"))
    p.add_argument("--token-file", default=os.getenv("EMPORIA_TOKEN_FILE", "~/.config/emporia/keys.json"))
    p.add_argument("--scale", choices=sorted(SCALE_MAP.keys()), default="day")
    p.add_argument("--top", type=int, default=10)
    p.add_argument("--device-filter", help="Case-insensitive substring filter for device or channel names")
    p.add_argument("--include-balance", action="store_true", help="Include synthetic Balance channels")
    p.add_argument("--include-main", action="store_true", help="Include Main / whole-home channels")
    p.add_argument("--include-totals", action="store_true", help="Include aggregate channels like TotalUsage or MainsFromGrid")
    p.add_argument("--petrol-price", type=float, help="Optional petrol price in currency units per litre for EV savings calculations")
    p.add_argument("--json-indent", type=int, default=2)
    return p.parse_args()


def load_dotenv(path_str):
    path = Path(os.path.expanduser(path_str))
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", line)
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
            value = value[1:-1]
        os.environ.setdefault(key, value)


def channel_name(device_info, usage_channel):
    raw = getattr(usage_channel, "name", None)
    if raw and raw != "Main":
        return str(raw)
    return getattr(device_info, "device_name", None) or f"device-{getattr(device_info, 'device_gid', 'unknown')}"


def parse_hhmm(text):
    hour, minute = text.split(":", 1)
    return int(hour), int(minute)


def _default_data_dir():
    """Resolve workspace/data/ relative to this script's location."""
    return Path(__file__).resolve().parents[3] / "data"


def load_tariff_config(path_str=None):
    default_path = _default_data_dir() / "emporia-energy" / "tariff.json"
    path = Path(path_str or os.getenv("EMPORIA_TARIFF_FILE", str(default_path)))
    if not path.exists():
        return None
    return json.loads(path.read_text())


def load_vehicle_config(path_str=None):
    default_path = _default_data_dir() / "emporia-energy" / "vehicle.json"
    path = Path(path_str or os.getenv("EMPORIA_VEHICLE_FILE", str(default_path)))
    if not path.exists():
        return None
    return json.loads(path.read_text()).get("vehicle")


def rate_for_local_dt(local_dt, tariff):
    if not tariff:
        return None
    day = local_dt.strftime("%a").lower()[:3]
    t = local_dt.time()
    for rate in tariff.get("rates", []):
        days = rate.get("days") or ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
        if day not in days:
            continue
        sh, sm = parse_hhmm(rate["start"])
        eh, em = parse_hhmm(rate["end"])
        start_t = t.replace(hour=sh, minute=sm, second=0, microsecond=0)
        end_t = t.replace(hour=eh, minute=em, second=0, microsecond=0)
        current = (t.hour, t.minute)
        start_tuple = (sh, sm)
        end_tuple = (eh, em)
        if start_tuple <= end_tuple:
            if start_tuple <= current < end_tuple:
                return rate
        else:
            if current >= start_tuple or current < end_tuple:
                return rate
    return None


def litres_from_mpg(miles, mpg):
    return miles / mpg * 4.54609


def estimate_ev_savings(kwh, charge_cost, vehicle, petrol_price_per_litre=None):
    if not vehicle:
        return None
    miles_per_kwh = vehicle.get("ev_efficiency_miles_per_kwh")
    petrol_mpg = vehicle.get("petrol_efficiency_mpg")
    if miles_per_kwh in (None, 0) or petrol_mpg in (None, 0):
        return None
    electric_miles = float(kwh) * float(miles_per_kwh)
    result = {
        "vehicle": vehicle.get("name"),
        "ev_efficiency_miles_per_kwh": float(miles_per_kwh),
        "petrol_efficiency_mpg": float(petrol_mpg),
        "estimated_electric_miles": electric_miles,
        "charge_cost": charge_cost,
        "petrol_price_per_litre": petrol_price_per_litre,
        "equivalent_petrol_litres": None,
        "equivalent_petrol_cost": None,
        "estimated_savings": None,
        "petrol_type": vehicle.get("petrol_type"),
        "vehicle_config_source": os.getenv("EMPORIA_VEHICLE_FILE", str(_default_data_dir() / "emporia-energy" / "vehicle.json")),
    }
    if petrol_price_per_litre not in (None, 0):
        litres = litres_from_mpg(electric_miles, float(petrol_mpg))
        petrol_cost = litres * float(petrol_price_per_litre)
        result["equivalent_petrol_litres"] = litres
        result["equivalent_petrol_cost"] = petrol_cost
        if charge_cost is not None:
            result["estimated_savings"] = petrol_cost - charge_cost
    return result


def estimate_costs(vue, usage, tariff):
    if not tariff:
        return None
    if usage.get("scale") != "day":
        return {
            "available": False,
            "reason": "Cost breakdown currently requires day-scale usage so hourly data can be mapped onto tariff windows."
        }

    tz = ZoneInfo(tariff.get("timezone", "Europe/Dublin"))
    queried_at = datetime.now(tz)
    target_day = queried_at.date()
    if queried_at.hour < 8:
        target_day = (queried_at - timedelta(days=1)).date()

    device_gid = usage.get("device_gid")
    channel_num = usage.get("channel_num")
    channel = usage.get("usage_channel")
    if device_gid is None or channel_num is None or channel is None:
        return None

    start_local = datetime(target_day.year, target_day.month, target_day.day, 0, 0, 0, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    hourly_values, first = vue.get_chart_usage(
        channel,
        start=start_local.astimezone(timezone.utc),
        end=end_local.astimezone(timezone.utc),
        scale=Scale.HOUR.value,
        unit=Unit.KWH.value,
    )
    if first is None:
        return None
    first_local = first.astimezone(tz)

    hourly_breakdown = []
    total_cost = 0.0
    totals_by_rate = defaultdict(lambda: {"kwh": 0.0, "cost": 0.0, "unit_rate": None, "currency": tariff.get("currency", "EUR")})

    for i, kwh in enumerate(hourly_values):
        start_hour = first_local + timedelta(hours=i)
        rate = rate_for_local_dt(start_hour, tariff)
        rate_name = rate.get("name") if rate else None
        unit_rate = float(rate.get("unit_rate")) if rate else None
        cost = float(kwh) * unit_rate if unit_rate is not None else None
        if cost is not None:
            total_cost += cost
            totals_by_rate[rate_name]["kwh"] += float(kwh)
            totals_by_rate[rate_name]["cost"] += cost
            totals_by_rate[rate_name]["unit_rate"] = unit_rate
        hourly_breakdown.append({
            "start": start_hour.isoformat(),
            "end": (start_hour + timedelta(hours=1)).isoformat(),
            "kwh": float(kwh),
            "rate_name": rate_name,
            "unit_rate": unit_rate,
            "cost": cost,
        })

    return {
        "available": True,
        "currency": tariff.get("currency", "EUR"),
        "timezone": tariff.get("timezone", "Europe/Dublin"),
        "day": str(target_day),
        "total_cost": total_cost,
        "by_rate": dict(sorted(totals_by_rate.items())),
        "hourly": hourly_breakdown,
        "tariff_source": os.getenv("EMPORIA_TARIFF_FILE", str(_default_data_dir() / "emporia-energy" / "tariff.json")),
    }


def login(vue, username, password, token_file):
    token_file = os.path.expanduser(token_file)
    token_dir = os.path.dirname(token_file)
    if token_dir:
        os.makedirs(token_dir, exist_ok=True)
    if username and password:
        vue.login(username=username, password=password, token_storage_file=token_file)
        return
    if os.path.exists(token_file):
        with open(token_file) as f:
            data = json.load(f)
        vue.login(
            id_token=data.get("id_token"),
            access_token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            token_storage_file=token_file,
        )
        return
    raise SystemExit(
        "Need Emporia credentials. Set EMPORIA_ACCOUNT/EMPORIA_USERNAME and EMPORIA_PASSWORD, or provide a valid token file."
    )


def main():
    args = parse_args()
    load_dotenv(args.env_file)
    username = args.username or os.getenv("EMPORIA_USERNAME") or os.getenv("EMPORIA_ACCOUNT")
    password = args.password or os.getenv("EMPORIA_PASSWORD")
    vue = PyEmVue()
    login(vue, username, password, args.token_file)

    devices = vue.get_devices()
    device_gids = []
    device_info = {}
    for device in devices:
        gid = getattr(device, "device_gid", None)
        if gid is None:
            continue
        if gid not in device_info:
            device_gids.append(gid)
            device_info[gid] = device
        else:
            device_info[gid].channels += device.channels

    usage = vue.get_device_list_usage(
        deviceGids=device_gids,
        instant=None,
        scale=SCALE_MAP[args.scale].value,
        unit=Unit.KWH.value,
    )

    filt = args.device_filter.lower() if args.device_filter else None
    tariff = load_tariff_config()
    vehicle = load_vehicle_config()
    items = []
    totals_by_device = defaultdict(float)

    for gid, device_usage in usage.items():
        info = device_info.get(gid)
        for channel_num, channel in getattr(device_usage, "channels", {}).items():
            name = channel_name(info, channel)
            lname = name.lower()
            usage_value = getattr(channel, "usage", None)
            if usage_value is None:
                continue
            if not args.include_balance and lname == "balance":
                continue
            if not args.include_main and getattr(channel, "name", None) == "Main":
                continue
            if not args.include_totals and lname in {"totalusage", "mainsfromgrid", "mainstogrid", "netusage", "totalreturn"}:
                continue
            if filt and filt not in lname and filt not in str(getattr(info, "device_name", "")).lower():
                continue
            item = {
                "device_gid": gid,
                "device_name": getattr(info, "device_name", None),
                "channel_num": str(channel_num),
                "channel_name": name,
                "usage_kwh": usage_value,
            }
            items.append(item)
            totals_by_device[item["device_name"] or str(gid)] += float(usage_value)

    items.sort(key=lambda x: x["usage_kwh"], reverse=True)
    cost_estimates = None
    ev_savings = None
    if len(items) == 1:
        only = items[0]
        only["estimated_cost"] = None
        only["currency"] = tariff.get("currency", "EUR") if tariff else None
        usage_channel = usage.get(only["device_gid"]).channels.get(only["channel_num"])
        cost_estimates = estimate_costs(vue, {
            "scale": args.scale,
            "device_gid": only["device_gid"],
            "channel_num": only["channel_num"],
            "usage_channel": usage_channel,
        }, tariff)
        if cost_estimates and cost_estimates.get("available"):
            only["estimated_cost"] = cost_estimates.get("total_cost")
            if only.get("channel_name", "").lower() == "ev charger":
                ev_savings = estimate_ev_savings(
                    only["usage_kwh"],
                    cost_estimates.get("total_cost"),
                    vehicle,
                    petrol_price_per_litre=args.petrol_price,
                )
                only["ev_savings"] = ev_savings

    result = {
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "scale": args.scale,
        "unit": "kWh",
        "item_count": len(items),
        "top_items": items[: max(args.top, 0)],
        "device_totals_kwh": dict(sorted(totals_by_device.items(), key=lambda kv: kv[1], reverse=True)),
        "tariff": {
            "source": os.getenv("EMPORIA_TARIFF_FILE", str(_default_data_dir() / "emporia-energy" / "tariff.json")),
            "loaded": bool(tariff),
            "currency": tariff.get("currency") if tariff else None,
            "timezone": tariff.get("timezone") if tariff else None,
        },
        "cost_estimates": cost_estimates,
        "vehicle": {
            "loaded": bool(vehicle),
            "source": os.getenv("EMPORIA_VEHICLE_FILE", str(_default_data_dir() / "emporia-energy" / "vehicle.json")),
            "name": vehicle.get("name") if vehicle else None,
        },
        "ev_savings": ev_savings,
        "notes": [
            "Emporia data is read via the unofficial PyEmVue library against Emporia cloud endpoints.",
            "Values are aggregated at the selected scale and may include nested smart plugs/devices depending on account configuration.",
            "By default, aggregate channels like TotalUsage and MainsFromGrid are excluded to keep rankings focused on named circuits/devices.",
            "When a tariff config is present, single-channel day-scale queries also include hourly cost estimates.",
            "When the filtered channel is the EV charger, vehicle assumptions can also be applied for petrol-equivalent savings.",
        ],
    }
    print(json.dumps(result, indent=args.json_indent, sort_keys=False))


if __name__ == "__main__":
    main()
