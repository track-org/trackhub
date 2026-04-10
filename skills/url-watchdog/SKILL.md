---
name: url-watchdog
description: Monitor URLs for availability, response time, content changes, and SSL certificate expiry. Use when checking if a website or API is up, detecting changes on a page, verifying SSL health, or setting up periodic URL monitoring via cron. Read-only — never sends data to monitored endpoints.
skill-type: standard
category: monitoring
tags: [url, monitoring, health-check, ssl, uptime, cron, alerting]
available-scripts:
  - name: url-watchdog
    description: Check one or more URLs for availability, response time, content hash, and SSL status
---

# URL Watchdog 🐕

Lightweight URL monitoring — availability, response time, content change detection, and SSL certificate checks. All read-only: never POSTs data or modifies anything.

## Why

Sometimes you just need to know: "is this thing still up?" Whether it's a personal dashboard, an API endpoint, a Render deploy, or a GitHub Pages site — this skill gives you a quick answer and can track changes over time.

## How to Run

```bash
node scripts/url-watchdog.mjs                        # Check all URLs in manifest
node scripts/url-watchdog.mjs --url https://example.com  # Check a single URL
node scripts/url-watchdog.mjs --manifest urls.json  # Custom manifest path
node scripts/url-watchdog.mjs --json                # JSON output
node scripts/url-watchdog.mjs --fail-only           # Only show problems
node scripts/url-watchdog.mjs --check-ssl           # Include SSL cert expiry
node scripts/url-watchdog.mjs --check-content       # Track content hash changes
node scripts/url-watchdog.mjs --save-state          # Save results for comparison
```

## Manifest Format

Create a `urls.json` manifest to monitor multiple URLs:

```json
{
  "urls": [
    {
      "name": "My Dashboard",
      "url": "https://my-dashboard.example.com",
      "expect_status": 200,
      "timeout_ms": 10000,
      "check_ssl": true,
      "warn_ssl_days": 30,
      "check_content": true
    },
    {
      "name": "GitHub API",
      "url": "https://api.github.com/zen",
      "expect_status": 200,
      "timeout_ms": 5000
    }
  ]
}
```

### Default manifest location

```
~/.openclaw/workspace/urls.json
```

If no manifest exists and no `--url` is given, the skill outputs a helpful message about creating one.

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | — | Check a single URL (no manifest needed) |
| `--manifest <path>` | `~/.openclaw/workspace/urls.json` | Path to URL manifest |
| `--timeout <ms>` | 10000 | Global timeout override |
| `--check-ssl` | false | Check SSL certificate expiry |
| `--warn-ssl-days <n>` | 30 | Warn if cert expires within N days |
| `--check-content` | false | Compute content hash for change detection |
| `--save-state` | false | Save results to state file for comparison |
| `--json` | false | Machine-readable JSON output |
| `--fail-only` | false | Only output failing checks |
| `--no-color` | false | Disable ANSI colors |

## What It Checks

| Check | Condition | Severity |
|-------|-----------|----------|
| HTTP status | Non-2xx response | error |
| Timeout | Response exceeds timeout_ms | error |
| DNS failure | Cannot resolve hostname | error |
| SSL expiry | Certificate expires within warn_ssl_days | warn |
| SSL invalid | Certificate chain broken or expired | error |
| Content change | Hash differs from previous state (with --save-state) | info |

## Output Examples

### Single URL (text)

```
🐕 URL Watchdog

✅ My Dashboard — https://my-dashboard.example.com
   Status: 200 · Time: 245ms · Size: 12.4 KB
```

### With SSL check

```
✅ My Dashboard — https://my-dashboard.example.com
   Status: 200 · Time: 245ms · Size: 12.4 KB
   SSL: valid · Expires: 2026-09-15 (158 days)
```

### Problems

```
🐕 URL Watchdog — 2 checked

❌ Old Service — https://old.example.com
   Status: 503 · Time: 312ms
   Error: Service Unavailable

⚠️ Expiring Soon — https://expiring.example.com
   Status: 200 · Time: 189ms
   SSL: ⚠️ expires 2026-05-01 (21 days)
```

### Content change detection

```
✅ My Dashboard — https://my-dashboard.example.com
   Status: 200 · Time: 245ms · Size: 12.4 KB
   Content: ℹ️ changed since last check (previous: 2026-04-10T01:00:00Z)
```

## JSON Output Schema

```json
{
  "checked_at": "2026-04-11T00:15:00.000Z",
  "results": [
    {
      "name": "My Dashboard",
      "url": "https://my-dashboard.example.com",
      "healthy": true,
      "status_code": 200,
      "response_time_ms": 245,
      "content_length": 12740,
      "ssl": {
        "valid": true,
        "expires_at": "2026-09-15T00:00:00.000Z",
        "days_remaining": 158
      },
      "content_hash": "a1b2c3d4",
      "content_changed": true,
      "previous_check": "2026-04-10T01:00:00.000Z",
      "issues": []
    }
  ],
  "summary": {
    "total": 1,
    "healthy": 1,
    "warnings": 0,
    "errors": 0
  }
}
```

## State File

When `--save-state` is used, results are saved to:

```
~/.openclaw/workspace/url-watchdog-state.json
```

This enables content change detection across runs. The state file contains the last known hash, status, and timestamp for each URL.

## Use with Cron

Set up periodic monitoring by creating a cron job that runs the watchdog:

```bash
# Check all URLs every 6 hours
openclaw cron add \
  --name "URL health check" \
  --schedule "0 */6 * * *" \
  --tz "Europe/Dublin" \
  --session-target isolated \
  --payload '{"kind":"agentTurn","message":"Run the url-watchdog skill with --check-ssl --save-state --fail-only. If any URLs are down or SSL is expiring, alert me with the details. If everything is healthy, no need to notify."}'
```

## Use in Heartbeats

Quick check during heartbeat:

```bash
node scripts/url-watchdog.mjs --fail-only --quiet
```

Exit code 1 means something needs attention.

## Dependencies

- Node.js 18+
- Uses `shared-lib` for argument parsing and output formatting (installed in trackhub)
- No external npm packages — uses Node.js built-in `https`, `http`, `dns`, and `tls` modules

## Security Notes

- Only sends GET requests with standard headers
- Never transmits data to monitored endpoints
- Follows redirects (up to 5) but does not send cookies or auth
- Timeout prevents hanging on unresponsive servers
