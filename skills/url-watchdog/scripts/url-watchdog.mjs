#!/usr/bin/env node

// url-watchdog.mjs — Lightweight URL monitoring: availability, response time, content change, SSL
// Part of the url-watchdog skill for TrackHub
// No external dependencies — uses Node.js built-ins only

import { argv, exit } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, stat } from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import tls from 'node:tls';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_LIB = resolve(__dirname, '../../shared-lib/index.mjs');
let parseArgs, formatOutput;

try {
  const mod = await import(SHARED_LIB);
  parseArgs = mod.parseArgs;
  formatOutput = mod.formatOutput;
} catch {
  // Inline minimal arg parser if shared-lib unavailable
  parseArgs = (argv) => {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
      const key = argv[i].replace(/^--/, '');
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        args[k] = v;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    }
    return args;
  };
  formatOutput = null;
}

const DEFAULT_STATE = resolve(process.env.HOME || '/tmp', '.openclaw/workspace/url-watchdog-state.json');
const DEFAULT_MANIFEST = resolve(process.env.HOME || '/tmp', '.openclaw/workspace/urls.json');
const MAX_REDIRECTS = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function color(code, text) {
  const colors = { red: 31, green: 32, yellow: 33, blue: 34, dim: 2, bold: 1, reset: 0 };
  const noColor = parsed.noColor;
  if (noColor) return text;
  return `\x1b[${colors[code] || 0}m${text}\x1b[0m`;
}

function icon(healthy, hasWarning) {
  if (hasWarning) return color('yellow', '⚠️');
  return healthy ? color('green', '✅') : color('red', '❌');
}

function daysUntil(date) {
  return Math.ceil((date - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso) {
  if (!iso) return 'never';
  return new Date(iso).toLocaleDateString('en-IE', { timeZone: 'Europe/Dublin' });
}

// ─── Fetch with redirect following ────────────────────────────────────────────

async function fetchUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const mod = url.startsWith('https') ? https : http;
    const response = await new Promise((resolve, reject) => {
      const req = mod.get(url, { 
        headers: { 'User-Agent': 'OpenClaw-URLWatchdog/1.0' },
        signal: controller.signal,
        rejectUnauthorized: true
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            location: res.headers.location
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchWithRedirects(url, timeoutMs, maxRedirects = MAX_REDIRECTS) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetchUrl(currentUrl, timeoutMs);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.location) {
      const base = new URL(currentUrl);
      currentUrl = new URL(res.location, base).href;
      continue;
    }
    return { ...res, finalUrl: currentUrl, redirects: i };
  }
  throw new Error('Too many redirects');
}

// ─── SSL Check ────────────────────────────────────────────────────────────────

function checkSSL(hostname, port = 443) {
  return new Promise((resolve) => {
    const socket = tls.connect(port, hostname, { servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (!cert || !cert.valid_to) {
        resolve({ valid: false, error: 'No certificate returned' });
        return;
      }
      const expiresAt = new Date(cert.valid_to);
      const days = daysUntil(expiresAt);
      resolve({
        valid: days > 0,
        expires_at: expiresAt.toISOString(),
        days_remaining: days,
        issuer: cert.issuer?.O || 'unknown'
      });
    });
    socket.on('error', (err) => {
      resolve({ valid: false, error: err.message });
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve({ valid: false, error: 'SSL handshake timeout' });
    });
  });
}

// ─── DNS Check ────────────────────────────────────────────────────────────────

function checkDNS(hostname) {
  return new Promise((resolve) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) resolve({ resolvable: false, error: err.code || err.message });
      else resolve({ resolvable: true, addresses });
    });
  });
}

// ─── Single URL Check ─────────────────────────────────────────────────────────

async function checkOneUrl(entry, opts) {
  const { url, name, expect_status = 200, timeout_ms = 10000, check_ssl: checkSSLFlag, warn_ssl_days = 30, check_content: checkContentFlag } = entry;
  const result = {
    name: name || url,
    url,
    healthy: true,
    status_code: null,
    response_time_ms: null,
    content_length: null,
    ssl: null,
    content_hash: null,
    content_changed: false,
    previous_check: null,
    issues: [],
    redirects: 0
  };

  const start = Date.now();

  // DNS check
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    result.healthy = false;
    result.issues.push('Invalid URL');
    return result;
  }

  const dnsResult = await checkDNS(hostname);
  if (!dnsResult.resolvable) {
    result.healthy = false;
    result.issues.push(`DNS: ${dnsResult.error}`);
    return result;
  }

  // HTTPS fetch
  try {
    const res = await fetchWithRedirects(url, timeout_ms);
    result.response_time_ms = Date.now() - start;
    result.status_code = res.statusCode;
    result.content_length = res.body.length;
    result.redirects = res.redirects || 0;

    if (res.statusCode !== expect_status) {
      result.healthy = false;
      result.issues.push(`Status ${res.statusCode} (expected ${expect_status})`);
    }

    if (checkContentFlag || opts.check_content) {
      result.content_hash = hashContent(res.body);
    }
  } catch (err) {
    result.response_time_ms = Date.now() - start;
    result.healthy = false;
    const msg = err.code === 'UND_ERR_CONNECT_TIMEOUT' || err.message === 'timeout'
      ? `Timeout after ${timeout_ms}ms`
      : err.message;
    result.issues.push(msg);
    return result;
  }

  // SSL check
  if ((checkSSLFlag || opts.check_ssl) && url.startsWith('https')) {
    result.ssl = await checkSSL(hostname);
    if (!result.ssl.valid) {
      result.healthy = false;
      result.issues.push(`SSL: ${result.ssl.error}`);
    } else if (result.ssl.days_remaining <= warn_ssl_days) {
      result.issues.push(`SSL expires ${formatDate(result.ssl.expires_at)} (${result.ssl.days_remaining} days)`);
    }
  }

  return result;
}

// ─── State Management ─────────────────────────────────────────────────────────

async function loadState(statePath) {
  try {
    const data = await readFile(statePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveState(statePath, results) {
  const state = {};
  for (const r of results) {
    state[r.url] = {
      content_hash: r.content_hash,
      status_code: r.status_code,
      checked_at: r.checked_at || new Date().toISOString(),
      healthy: r.healthy
    };
  }
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
  return state;
}

function mergeState(result, prevState) {
  const prev = prevState[result.url];
  if (prev && result.content_hash && prev.content_hash) {
    result.content_changed = result.content_hash !== prev.content_hash;
    result.previous_check = prev.checked_at;
  }
  return result;
}

// ─── Output Formatting ────────────────────────────────────────────────────────

function formatTextResult(r) {
  const hasWarning = r.issues.some(i => i.startsWith('SSL expires') || i.startsWith('Content'));
  const lines = [];

  lines.push(`${icon(r.healthy, hasWarning)} ${color('bold', r.name)} — ${r.url}`);

  if (r.status_code) {
    const statusColor = r.status_code < 400 ? 'green' : 'red';
    lines.push(`   Status: ${color(statusColor, r.status_code)} · Time: ${formatDuration(r.response_time_ms)} · Size: ${r.content_length ? (r.content_length > 1024 ? (r.content_length / 1024).toFixed(1) + ' KB' : r.content_length + ' B') : '—'}`);
  }

  if (r.ssl) {
    const sslColor = r.ssl.valid ? (r.ssl.days_remaining <= 30 ? 'yellow' : 'green') : 'red';
    const sslIcon = r.ssl.valid ? (r.ssl.days_remaining <= 30 ? '⚠️' : '') : '❌';
    lines.push(`   SSL: ${color(sslColor, r.ssl.valid ? `valid${r.ssl.days_remaining <= 30 ? '' : ''}` : 'invalid')} · Expires: ${formatDate(r.ssl.expires_at)} (${r.ssl.days_remaining} days) ${sslIcon}`);
  }

  if (r.content_changed) {
    lines.push(`   Content: ${color('blue', 'ℹ️ changed since last check')} (previous: ${formatDate(r.previous_check)})`);
  }

  for (const issue of r.issues) {
    const isWarning = issue.startsWith('SSL expires') || issue.startsWith('Content');
    lines.push(`   ${isWarning ? color('yellow', '⚠️') : color('red', '❌')} ${issue}`);
  }

  return lines.join('\n');
}

function formatTextSummary(results) {
  const total = results.length;
  const healthy = results.filter(r => r.healthy && !r.issues.some(i => i.startsWith('SSL expires'))).length;
  const warnings = results.filter(r => r.healthy && r.issues.some(i => i.startsWith('SSL expires') || i.startsWith('Content'))).length;
  const errors = results.filter(r => !r.healthy).length;

  const parts = [];
  if (healthy) parts.push(`${color('green', healthy)} healthy`);
  if (warnings) parts.push(`${color('yellow', warnings)} warnings`);
  if (errors) parts.push(`${color('red', errors)} errors`);

  return `${color('bold', '🐕 URL Watchdog')} — ${total} checked · ${parts.join(' · ')}`;
}

function outputText(results, failOnly) {
  const output = failOnly ? results.filter(r => !r.healthy || r.issues.length > 0) : results;
  const lines = [formatTextSummary(results)];

  if (output.length === 0 && failOnly) {
    lines.push(color('green', 'All URLs healthy ✓'));
  } else {
    for (const r of output) {
      lines.push('');
      lines.push(formatTextResult(r));
    }
  }

  return lines.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const parsed = parseArgs(argv);

async function main() {
  let urls = [];

  // Single URL mode
  if (parsed.url) {
    urls = [{ name: parsed.url, url: parsed.url }];
  }
  // Manifest mode
  else {
    const manifestPath = parsed.manifest || DEFAULT_MANIFEST;
    try {
      const data = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(data);
      urls = manifest.urls || [];
    } catch {
      if (!parsed.json) {
        console.log(color('yellow', '🐕 URL Watchdog'));
        console.log('');
        console.log('No URL manifest found. Create one at:');
        console.log(`  ${DEFAULT_MANIFEST}`);
        console.log('');
        console.log('Or check a single URL:');
        console.log('  node url-watchdog.mjs --url https://example.com');
        console.log('');
        console.log('Manifest format:');
        console.log(JSON.stringify({ urls: [{ name: "Example", url: "https://example.com", expect_status: 200 }] }, null, 2));
        exit(0);
      }
    }
  }

  if (urls.length === 0) {
    if (!parsed.json) console.log(color('yellow', 'No URLs to check.'));
    exit(0);
  }

  const opts = {
    check_ssl: !!parsed['check-ssl'],
    check_content: !!parsed['check-content'],
    warn_ssl_days: parseInt(parsed['warn-ssl-days'] || '30', 10),
    timeout: parseInt(parsed.timeout || '10000', 10)
  };

  // Load previous state for content change detection
  const prevState = await loadState(parsed['save-state'] ? DEFAULT_STATE : '/dev/null');

  // Check all URLs
  const results = [];
  for (const entry of urls) {
    entry.timeout_ms = entry.timeout_ms || opts.timeout;
    entry.check_ssl = entry.check_ssl || opts.check_ssl;
    entry.check_content = entry.check_content || opts.check_content;
    entry.warn_ssl_days = entry.warn_ssl_days || opts.warn_ssl_days;

    const result = await checkOneUrl(entry, opts);
    result.checked_at = new Date().toISOString();

    if (opts.check_content) {
      mergeState(result, prevState);
    }

    results.push(result);
  }

  // Save state if requested
  if (parsed['save-state']) {
    try {
      await saveState(DEFAULT_STATE, results);
    } catch (err) {
      // Non-fatal
    }
  }

  // Output
  if (parsed.json) {
    const summary = {
      total: results.length,
      healthy: results.filter(r => r.healthy).length,
      warnings: results.filter(r => r.healthy && r.issues.length > 0).length,
      errors: results.filter(r => !r.healthy).length
    };
    console.log(JSON.stringify({ checked_at: new Date().toISOString(), results, summary }, null, 2));
  } else {
    const failOnly = !!parsed['fail-only'];
    console.log(outputText(results, failOnly));
  }

  // Exit code
  const hasProblems = results.some(r => !r.healthy);
  exit(hasProblems ? 1 : 0);
}

main().catch((err) => {
  console.error(color('red', `Fatal: ${err.message}`));
  exit(2);
});
