---
name: dns-health
description: Check DNS record health for domains — verify A, AAAA, MX, TXT, CNAME, NS records resolve correctly. Detect expired domains, misconfigured records, propagation delays, and DNSSEC issues. Use when diagnosing why a domain isn't resolving, checking mail records, verifying SSL cert DNS prerequisites, or proactive DNS monitoring via cron/heartbeat.
---

# DNS Health Checker

Verify DNS records are resolving correctly for one or more domains. Catches NXDOMAIN, SERVFAIL, timeouts, and missing records before they cause outages.

## Why

DNS issues are a common silent failure mode. A domain expires, a record gets deleted by mistake, or propagation delays leave some resolvers returning stale data. This skill catches those problems early — complementing `url-watchdog` (HTTP-level checks) with DNS-level visibility.

## Script

`scripts/dns-health.cjs` — Zero dependencies. Node.js 18+ (uses built-in `dns/promises`).

## Usage

```bash
# Check A records for a domain
node dns-health.cjs example.com

# Check all common record types
node dns-health.cjs example.com --all

# Check specific record type
node dns-health.cjs example.com --type MX

# Multiple domains
node dns-health.cjs example.com google.com github.com --all

# Use a specific DNS server (useful for propagation checks)
node dns-health.cjs example.com --server 8.8.8.8
node dns-health.cjs example.com --server 1.1.1.1

# Read domains from a file
node dns-health.cjs --file domains.txt --all

# JSON output for programmatic use
node dns-health.cjs example.com --all --json

# Quiet mode: only show failures
node dns-health.cjs --file domains.txt --all --quiet

# Verbose: show individual record values
node dns-health.cjs example.com --all --verbose
```

## Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--type TYPE` | `-t` | `A` | Record type: A, AAAA, MX, TXT, CNAME, NS, SOA, SRV, CAA |
| `--all` | `-a` | false | Check all common types (A, AAAA, MX, TXT, CNAME, NS) |
| `--file FILE` | `-f` | — | Read domains from file (one per line, # comments) |
| `--server ADDR` | `-s` | system | Use specific DNS server (e.g. 8.8.8.8, 1.1.1.1) |
| `--timeout MS` | | 5000 | Query timeout in milliseconds |
| `--json` | | false | JSON output |
| `--quiet` | `-q` | false | Only show failures |
| `--verbose` | `-v` | false | Show individual record values |
| `--help` | `-h` | | Show usage |

## Output

### Human-readable

```
✅ google.com — ok (40ms)
   ✅ A: 6 record(s) [7ms]
   ✅ AAAA: 4 record(s) [2ms]
   ✅ MX: 1 record(s) [5ms]
   ✅ TXT: 13 record(s) [15ms]
   ✅ CNAME: 0 record(s) [5ms]
   ✅ NS: 4 record(s) [6ms]
```

### Failure example

```
🔴 thisdomaindoesnotexist12345.com — critical (26ms)
   🔴 A: ENOTFOUND — queryA ENOTFOUND thisdomaindoesnotexist12345.com [26ms]
```

### JSON

```json
{
  "timestamp": "2026-05-07T23:03:01.624Z",
  "server": "system-default",
  "domains": [...],
  "summary": { "total": 1, "ok": 0, "degraded": 0, "critical": 1 }
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All domains healthy |
| 1 | At least one domain degraded (some records failed) |
| 2 | At least one domain critical (NXDOMAIN, SERVFAIL) |

## Integration

### Heartbeat

Use in heartbeat checks to monitor important domains:

```bash
node dns-health.cjs mydomain.com api.mydomain.com --all --quiet --json
```

Quiet mode suppresses healthy domains, JSON makes it easy to parse failures.

### Cron

Set up periodic DNS monitoring:

```bash
# Check critical domains every 6 hours
node dns-health.cjs --file /path/to/critical-domains.txt --all --quiet --json
```

### Propagation Check

Compare results across DNS servers to detect propagation delays:

```bash
# Check against Cloudflare vs Google
node dns-health.cjs newdomain.com --server 1.1.1.1 --type A --json
node dns-health.cjs newdomain.com --server 8.8.8.8 --type A --json
```

### Pairs well with

- **url-watchdog** — DNS checks the layer below HTTP. If DNS is healthy but url-watchdog fails, the issue is upstream of DNS.
- **system-health** — Combine with system checks for a full infrastructure health picture.
- **smart-notifier** — Alert on DNS failures with deduplication and cooldowns.

## Limitations

- Read-only — only queries DNS, never modifies records
- No DNSSEC validation (checks records exist, not cryptographic validity)
- Uses Node.js built-in resolver — may differ from system `dig`/`nslookup` in edge cases
- CNAME ENODATA for apex domains is handled gracefully (not flagged as failure)
- Concurrent lookups limited to 10 parallel to avoid flooding resolvers
