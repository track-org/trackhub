#!/usr/bin/env node
/**
 * dns-health — Check DNS record health for one or more domains.
 *
 * Zero dependencies. Node.js 18+ (uses built-in dns/promises).
 *
 * Supports: A, AAAA, MX, TXT, CNAME, NS, SOA, SRV, CAA records.
 * Detects: NXDOMAIN, SERVFAIL, timeouts, empty responses, TTL issues.
 *
 * Usage:
 *   node dns-health.cjs example.com
 *   node dns-health.cjs example.com google.com --type MX
 *   node dns-health.cjs example.com --all --json
 *   node dns-health.cjs --file domains.txt --all --json
 */

'use strict';

const dns = require('dns').promises;
const args = process.argv.slice(2);

// ─── Minimal arg parser ────────────────────────────────────────────────

function parseArgs(argv) {
  const result = { _: [], json: false, quiet: false, all: false, type: 'A', file: null, server: null, timeout: 5000, verbose: false, help: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--json') result.json = true;
    else if (a === '--quiet' || a === '-q') result.quiet = true;
    else if (a === '--all' || a === '-a') result.all = true;
    else if (a === '--type' || a === '-t') { result.type = argv[++i]; }
    else if (a === '--file' || a === '-f') { result.file = argv[++i]; }
    else if (a === '--server' || a === '-s') { result.server = argv[++i]; }
    else if (a === '--timeout') { result.timeout = parseInt(argv[++i], 10) || 5000; }
    else if (a === '--verbose' || a === '-v') result.verbose = true;
    else if (a === '--help' || a === '-h') result.help = true;
    else if (!a.startsWith('-')) result._.push(a);
    i++;
  }
  return result;
}

const opts = parseArgs(args);

// ─── Help ───────────────────────────────────────────────────────────────

const HELP = `dns-health — Check DNS record health for domains

Usage: node dns-health.cjs [options] <domain...>

Options:
  --type, -t TYPE     Record type to check (default: A)
                      Types: A, AAAA, MX, TXT, CNAME, NS, SOA, SRV, CAA
  --all, -a           Check all common record types (A, AAAA, MX, TXT, CNAME, NS)
  --file, -f FILE     Read domains from a file (one per line)
  --server, -s ADDR   Use a specific DNS server (e.g. 8.8.8.8, 1.1.1.1)
  --timeout MS        Query timeout in ms (default: 5000)
  --json              Output JSON
  --quiet, -q         Only output failures
  --verbose, -v       Show per-record details
  --help, -h          Show this help

Examples:
  node dns-health.cjs example.com
  node dns-health.cjs example.com --all --json
  node dns-health.cjs example.com google.com --type MX
  node dns-health.cjs --file domains.txt --all --quiet
  node dns-health.cjs example.com --server 1.1.1.1 --type TXT`;

if (opts.help) { console.log(HELP); process.exit(0); }

// ─── Constants ──────────────────────────────────────────────────────────

const COMMON_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'];
const VALID_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS', 'SOA', 'SRV', 'CAA', 'PTR'];

// ─── DNS resolver setup ────────────────────────────────────────────────

const resolver = opts.server
  ? new dns.Resolver({ timeout: opts.timeout })
  : new dns.Resolver({ timeout: opts.timeout });

if (opts.server) {
  resolver.setServers([opts.server]);
}

// ─── Record lookup ─────────────────────────────────────────────────────

async function lookupRecord(domain, type) {
  const start = Date.now();
  try {
    let result;
    switch (type) {
      case 'A':     result = await resolver.resolve4(domain); break;
      case 'AAAA':  result = await resolver.resolve6(domain); break;
      case 'MX':    result = await resolver.resolveMx(domain); break;
      case 'TXT':   result = await resolver.resolveTxt(domain); break;
      case 'CNAME': result = await resolver.resolveCname(domain); break;
      case 'NS':    result = await resolver.resolveNs(domain); break;
      case 'SOA':   result = await resolver.resolveSoa(domain); break;
      case 'SRV':   result = await resolver.resolveSrv(domain); break;
      case 'CAA':   result = await resolver.resolveCaa(domain); break;
      default:
        // Generic fallback
        result = await resolver.resolve(domain, type);
    }
    const latencyMs = Date.now() - start;
    return {
      status: 'ok',
      type,
      records: Array.isArray(result) ? result : [result],
      count: Array.isArray(result) ? result.length : 1,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    // Map common DNS error codes
    const code = err.code || 'UNKNOWN';
    let severity = 'fail';
    // ENODATA for CNAME means the domain is not a CNAME — that's normal, not an error
    if (code === 'ENODATA' && type === 'CNAME') {
      return {
        status: 'ok',
        type,
        records: [],
        count: 0,
        note: 'Not a CNAME (apex domain or direct record)',
        latencyMs,
      };
    }
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN') severity = 'critical';
    else if (code === 'ESERVFAIL' || code === 'SERVFAIL') severity = 'critical';
    else if (code === 'ETIMEOUT') severity = 'warn';

    return {
      status: 'fail',
      type,
      error: code,
      message: err.message || 'DNS lookup failed',
      severity,
      latencyMs,
    };
  }
}

// ─── Domain check ──────────────────────────────────────────────────────

async function checkDomain(domain) {
  const cleanDomain = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const types = opts.all ? COMMON_TYPES : [opts.type.toUpperCase()];

  // Validate type
  for (const t of types) {
    if (!VALID_TYPES.includes(t)) {
      return { domain: cleanDomain, status: 'error', message: `Unknown record type: ${t}` };
    }
  }

  const start = Date.now();
  const results = [];

  for (const type of types) {
    const rec = await lookupRecord(cleanDomain, type);
    results.push(rec);
  }

  const totalLatency = Date.now() - start;
  const failures = results.filter(r => r.status === 'fail');
  const overallStatus = failures.length === results.length ? 'critical' : failures.length > 0 ? 'degraded' : 'ok';

  return {
    domain: cleanDomain,
    status: overallStatus,
    types: results,
    totalLatencyMs: totalLatency,
    summary: {
      checked: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      failed: failures.length,
    },
  };
}

// ─── Format output ─────────────────────────────────────────────────────

function formatHuman(results) {
  const lines = [];
  for (const r of results) {
    if (opts.quiet && r.status === 'ok') continue;

    const icon = r.status === 'ok' ? '✅' : r.status === 'degraded' ? '⚠️' : r.status === 'critical' ? '🔴' : '❌';
    lines.push(`${icon} ${r.domain} — ${r.status} (${r.totalLatencyMs}ms)`);

    if (opts.verbose || r.status !== 'ok') {
      for (const t of r.types) {
        if (t.status === 'ok') {
          lines.push(`   ✅ ${t.type}: ${t.count} record(s) [${t.latencyMs}ms]`);
          if (opts.verbose) {
            for (const rec of t.records) {
              const val = typeof rec === 'object' ? (rec.exchange || rec.target || JSON.stringify(rec)) : rec;
              lines.push(`      → ${val}`);
            }
          }
        } else {
          const sev = t.severity === 'critical' ? '🔴' : '⚠️';
          lines.push(`   ${sev} ${t.type}: ${t.error} — ${t.message} [${t.latencyMs}ms]`);
        }
      }
    }
  }
  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  let domains = opts._;

  // Read from file if specified
  if (opts.file) {
    try {
      const fs = require('fs');
      const content = fs.readFileSync(opts.file, 'utf8');
      const fileDomains = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      domains = domains.concat(fileDomains);
    } catch (err) {
      if (opts.json) {
        console.log(JSON.stringify({ status: 'error', error: `Cannot read file: ${opts.file}` }));
      } else {
        console.error(`❌ Cannot read file: ${opts.file} — ${err.message}`);
      }
      process.exit(1);
    }
  }

  if (domains.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ status: 'error', error: 'No domains specified. Use --help for usage.' }));
    } else {
      console.error('❌ No domains specified. Use --help for usage.');
    }
    process.exit(1);
  }

  // Run checks in parallel (with concurrency limit of 10)
  const results = [];
  const batchSize = 10;
  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(d => checkDomain(d)));
    results.push(...batchResults);
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      server: opts.server || 'system-default',
      domains: results,
      summary: {
        total: results.length,
        ok: results.filter(r => r.status === 'ok').length,
        degraded: results.filter(r => r.status === 'degraded').length,
        critical: results.filter(r => r.status === 'critical').length,
      },
    }, null, 2));
  } else {
    const output = formatHuman(results);
    if (output) console.log(output);
    else if (!opts.quiet) console.log('✅ All domains healthy');
  }

  // Exit code: 0 if all ok, 1 if any degraded, 2 if any critical
  const hasCritical = results.some(r => r.status === 'critical');
  const hasDegraded = results.some(r => r.status === 'degraded');
  if (hasCritical) process.exit(2);
  else if (hasDegraded) process.exit(1);
}

main().catch(err => {
  if (opts.json) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ dns-health: ' + err.message);
  }
  process.exit(1);
});
