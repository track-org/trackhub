#!/usr/bin/env python3
"""
Cron Dashboard — health overview of all OpenClaw cron jobs.

Reads jobs.json and produces a formatted summary of job status,
recent runs, delivery state, and any problems.

Usage:
  python3 cron-dashboard.py [--json] [--problems-only] [--deps]

Options:
  --json           Output structured JSON instead of formatted text
  --problems-only  Only show jobs with errors, warnings, or issues
  --deps           Show API dependency map (which jobs depend on which services)

Exit codes:
  0 — all jobs healthy
  1 — one or more jobs have problems
"""

import json
import sys
import os
from datetime import datetime, timezone

# Default paths to check — supports OPENCLAW_STATE_DIR override
DEFAULT_PATHS = [
    os.path.expanduser(os.environ.get("OPENCLAW_STATE_DIR", "~/.openclaw") + "/cron/jobs.json"),
]


def load_jobs(path: str) -> dict | None:
    """Load jobs.json and return the parsed data."""
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def ms_to_iso(ms: int | None) -> str:
    """Convert epoch ms to a readable ISO timestamp."""
    if ms is None:
        return "never"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def ms_to_ago(ms: int | None) -> str:
    """Convert epoch ms to a human-readable 'ago' string."""
    if ms is None:
        return "never"
    diff = datetime.now(tz=timezone.utc).timestamp() - ms / 1000
    if diff < 60:
        return f"{int(diff)}s ago"
    elif diff < 3600:
        return f"{int(diff / 60)}m ago"
    elif diff < 86400:
        return f"{int(diff / 3600)}h ago"
    else:
        return f"{int(diff / 86400)}d ago"


def ms_to_duration(ms: int | None) -> str:
    """Convert duration in ms to a readable string."""
    if ms is None:
        return "—"
    if ms < 1000:
        return f"{ms}ms"
    return f"{ms / 1000:.1f}s"


def schedule_label(schedule: dict) -> str:
    """Human-readable schedule description."""
    kind = schedule.get("kind", "unknown")
    if kind == "cron":
        expr = schedule.get("expr", "?")
        tz = schedule.get("tz", "UTC")
        return f"{expr} ({tz})"
    elif kind == "at":
        at = schedule.get("at", "?")
        return f"once at {at}"
    elif kind == "every":
        interval = schedule.get("intervalMs", 0)
        if interval >= 3600000:
            return f"every {interval / 3600000:.1f}h"
        elif interval >= 60000:
            return f"every {interval / 60000:.0f}m"
        return f"every {interval}ms"
    return kind


def delivery_label(delivery: dict | None, state: dict) -> str:
    """Human-readable delivery status."""
    if not delivery:
        return "none"
    mode = delivery.get("mode", "none")
    if mode == "none":
        return "none (fire-and-forget)"
    delivered = state.get("lastDelivered")
    del_status = state.get("lastDeliveryStatus", "?")
    channel = delivery.get("channel", "?")
    to = delivery.get("to", "")
    if delivered:
        return f"{channel} → {to} ✅"
    elif del_status == "not-requested":
        return f"{channel} → {to} (no output)"
    else:
        return f"{channel} → {to} ⚠️ {del_status}"


# Known API service signatures — lowercase patterns to match in payload text
# Maps service name to list of keyword patterns
API_SERVICE_PATTERNS = {
    "gmail": ["gmail", "google_oauth", "gmail_access_token", "check_gmail"],
    "slack": ["slack", "slack_bot_token", "channel:", "conversations.history"],
    "attio": ["attio", "pipeline-query", "attio_api_key"],
    "supabase": ["supabase", "supabase_url", "supabase_anon_key"],
    "solis": ["solis", "solis_", "soliscloud", "solar export"],
    "emporia": ["emporia", "pyemvue", "emvue", "vue_energy"],
    "openai": ["openai", "gpt-4", "openai_api_key"],
    "open-meteo": ["open-meteo", "openmeteo", "wttr.in"],
}


def detect_api_deps(job: dict) -> list[str]:
    """Scan a job's payload text for references to known API services."""
    payload = job.get("payload", {})
    # Get all text from payload fields
    text_parts = []
    for key, val in payload.items():
        if isinstance(val, str):
            text_parts.append(val)
        elif isinstance(val, dict):
            for k, v in val.items():
                if isinstance(v, str):
                    text_parts.append(v)
    combined = " ".join(text_parts).lower()

    deps = []
    for service, patterns in API_SERVICE_PATTERNS.items():
        for pat in patterns:
            if pat.lower() in combined:
                deps.append(service)
                break
    return sorted(deps)


def deps_map(results: list[dict], all_results_raw: list[dict] | None = None) -> str:
    """Build a service→jobs dependency map."""
    if all_results_raw is None:
        all_results_raw = results
    service_jobs: dict[str, list[str]] = {}
    for r in all_results_raw:
        for dep in r.get("api_deps", []):
            service_jobs.setdefault(dep, []).append(r["name"])
    if not service_jobs:
        return "📡 No API dependencies detected in any job payloads."

    lines = ["📡 API Dependency Map", ""]
    for service in sorted(service_jobs):
        jobs = service_jobs[service]
        lines.append(f"  **{service}** ({len(jobs)} job{'s' if len(jobs) != 1 else ''})")
        for j in jobs:
            lines.append(f"    • {j}")
        lines.append("")
    return "\n".join(lines).strip()


def analyze_job(job: dict) -> dict:
    """Analyze a single job for health issues."""
    issues = []
    state = job.get("state", {})
    schedule = job.get("schedule", {})

    status = state.get("lastRunStatus", "unknown")
    errors = state.get("consecutiveErrors", 0)
    delivery = job.get("delivery")
    enabled = job.get("enabled", True)

    if not enabled:
        issues.append("DISABLED")

    if status == "error" or errors > 0:
        issues.append(f"{errors} consecutive error{'s' if errors != 1 else ''}")

    if status == "unknown" and state.get("lastRunAtMs") is None:
        issues.append("never run")

    # Check if delivery was requested but failed
    if delivery and delivery.get("mode") != "none":
        del_status = state.get("lastDeliveryStatus", "?")
        if del_status not in ("delivered", "not-requested", "not-delivered"):
            issues.append(f"delivery: {del_status}")

    # Check if schedule is a one-shot that already ran
    if schedule.get("kind") == "at" and job.get("deleteAfterRun"):
        if state.get("lastRunStatus") == "ok":
            issues.append("one-shot completed (should be cleaned up)")

    return {
        "name": job.get("name", "unnamed"),
        "id": job.get("id", "?"),
        "enabled": enabled,
        "schedule": schedule_label(schedule),
        "session_target": job.get("sessionTarget", "?"),
        "last_run": ms_to_ago(state.get("lastRunAtMs")),
        "last_status": status,
        "duration": ms_to_duration(state.get("lastDurationMs")),
        "delivery": delivery_label(delivery, state),
        "consecutive_errors": errors,
        "issues": issues,
        "healthy": len(issues) == 0,
        "api_deps": detect_api_deps(job),
    }


def format_text(results: list[dict], problems_only: bool = False) -> str:
    """Format results as readable text."""
    if problems_only:
        results = [r for r in results if not r["healthy"]]
        if not results:
            return "✅ All cron jobs healthy — no issues found."

    total = len(results)
    healthy = sum(1 for r in results if r["healthy"])
    problems = total - healthy

    lines = []
    lines.append(f"📋 Cron Dashboard — {total} job{'s' if total != 1 else ''}")
    if problems > 0:
        lines.append(f"⚠️  {problems} job{'s' if problems != 1 else ''} with issues, {healthy} healthy")
    else:
        lines.append(f"✅ All {total} jobs healthy")
    lines.append("")

    for r in results:
        status_icon = "✅" if r["healthy"] else "⚠️"
        if not r["enabled"]:
            status_icon = "🚫"

        lines.append(f"{status_icon} **{r['name']}**")
        lines.append(f"   Schedule: {r['schedule']}")
        lines.append(f"   Last run: {r['last_run']} — {r['last_status']} ({r['duration']})")
        lines.append(f"   Delivery: {r['delivery']}")
        if r.get("api_deps"):
            lines.append(f"   API deps: {', '.join(r['api_deps'])}")
        if r["issues"]:
            lines.append(f"   Issues: {', '.join(r['issues'])}")
        lines.append("")

    return "\n".join(lines).strip()


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    problems_only = "--problems-only" in args
    show_deps = "--deps" in args

    # Find and load jobs
    data = None
    for path in DEFAULT_PATHS:
        data = load_jobs(path)
        if data:
            break

    if not data:
        print(json.dumps({"error": "No jobs.json found", "checked": DEFAULT_PATHS}) if as_json else "❌ No cron jobs found (jobs.json not found at default paths)")
        sys.exit(1)

    jobs = data.get("jobs", [])
    if not jobs:
        print(json.dumps({"error": "No jobs defined", "path": path}) if as_json else "❌ No cron jobs defined")
        sys.exit(1)

    results = [analyze_job(job) for job in jobs]

    # Sort: problems first, then by name
    results.sort(key=lambda r: (r["healthy"], r["name"].lower()))

    if show_deps:
        print(deps_map(results))
        sys.exit(0)
    elif as_json:
        print(json.dumps(results, indent=2))
    else:
        print(format_text(results, problems_only))

    has_problems = any(not r["healthy"] for r in results)
    sys.exit(1 if has_problems else 0)


if __name__ == "__main__":
    main()
