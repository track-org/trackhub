#!/usr/bin/env node
// cron-history-search.mjs — Search across all OpenClaw cron run history
// Usage: node cron-history-search.mjs <query> [options]
//
// Grep across cron run summaries and metadata for keywords/patterns.

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..', '..', 'shared-lib', 'scripts', 'lib');
const { parseArgs } = await import(join(libDir, 'args.mjs'));
const { section, ok, warn, error } = await import(join(libDir, 'fmt.mjs'));

// --- CLI ---
const argv = process.argv.slice(2);

// First positional arg is the query
let queryIndex = argv.findIndex(a => !a.startsWith('-'));
let query = '';
if (queryIndex !== -1) {
  query = argv.splice(queryIndex, 1)[0];
}
if (!query) {
  console.error('Usage: cron-history-search.mjs <query> [options]');
  console.error('');
  console.error('Search cron run history for a keyword or pattern.');
  console.error('');
  console.error('Options:');
  console.error('  --days <n>             Time window in days (default: 7)');
  console.error('  --runs <n>             Max runs per job to scan (default: 30)');
  console.error('  --limit <n>            Max results to show (default: 20)');
  console.error('  --job <name>           Fuzzy filter to specific job(s)');
  console.error('  --field <f>            Restrict search field (summary|status|delivery|model|all)');
  console.error('  --case-sensitive       Case-sensitive matching');
  console.error('  --invert               Show runs that do NOT match');
  console.error('  --context <n>          Chars of context around match (default: 0)');
  console.error('  --include-disabled     Include disabled cron jobs');
  console.error('  --json                 JSON output');
  process.exit(1);
}

const args = parseArgs(argv, {
  alias: { d: 'days', r: 'runs', l: 'limit', j: 'job', f: 'field', c: 'context', v: 'invert' },
  boolean: ['json', 'case-sensitive', 'invert', 'include-disabled'],
  string: ['days', 'runs', 'limit', 'job', 'field', 'context'],
  default: {
    days: '7',
    runs: '30',
    limit: '20',
    job: '',
    field: 'all',
    'case-sensitive': false,
    invert: false,
    context: '0',
    'include-disabled': false,
  },
});

const days = parseInt(args.days, 10) || 7;
const maxRuns = parseInt(args.runs, 10) || 30;
const maxResults = parseInt(args.limit, 10) || 20;
const nameFilter = (args.job || '').toLowerCase();
const fieldFilter = (args.field || 'all').toLowerCase();
const caseSensitive = args['case-sensitive'] || false;
const invert = args.invert || false;
const contextChars = parseInt(args.context, 10) || 0;

// --- Helpers ---
function shell(cmd, timeout) {
  try {
    const stdout = execSync(cmd, { timeout: timeout || 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim() };
  }
}

function parseCronList(raw) {
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0];
  const columns = ['ID', 'Name', 'Schedule', 'Next', 'Last', 'Status', 'Target', 'Agent ID', 'Model'];
  const positions = [];

  for (const col of columns) {
    const idx = header.indexOf(col);
    if (idx === -1) break;
    positions.push({ name: col, start: idx });
  }

  if (positions.length < 2) return [];

  const jobs = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = {};
    for (let c = 0; c < positions.length; c++) {
      const start = positions[c].start;
      const end = c + 1 < positions.length ? positions[c + 1].start : line.length;
      row[positions[c].name] = line.slice(start, end).trim();
    }

    jobs.push({
      id: row.ID,
      name: row.Name,
      schedule: row.Schedule,
      status: row.Status,
      target: row.Target,
    });
  }
  return jobs;
}

function parseCronRuns(raw) {
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function fuzzyMatch(jobName, filter) {
  if (!filter) return true;
  return jobName.toLowerCase().includes(filter);
}

function formatTimestamp(ms) {
  return new Date(ms).toLocaleString('en-IE', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm ' + ((ms % 60000) / 1000).toFixed(0) + 's';
}

function formatTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function extractContext(text, matchIndex, queryLen, chars) {
  if (!chars || chars <= 0) return null;
  const start = Math.max(0, matchIndex - chars);
  const end = Math.min(text.length, matchIndex + queryLen + chars);
  let ctx = '';
  if (start > 0) ctx += '...';
  ctx += text.slice(start, end);
  if (end < text.length) ctx += '...';
  return ctx;
}

// Build searchable text for a run based on field filter
function getSearchText(run, field) {
  const parts = [];

  switch (field) {
    case 'summary':
      return run.summary || '';
    case 'status':
      return run.status || '';
    case 'delivery':
      return run.deliveryStatus || '';
    case 'model':
      return [run.provider, run.model].filter(Boolean).join('/');
    case 'all':
    default:
      if (run.summary) parts.push(run.summary);
      if (run.status) parts.push(run.status);
      if (run.deliveryStatus) parts.push(run.deliveryStatus);
      if (run.provider || run.model) parts.push([run.provider, run.model].filter(Boolean).join('/'));
      return parts.join(' ');
  }
}

function searchRun(run, query, caseSensitive, invert, contextChars) {
  const text = getSearchText(run, fieldFilter);
  if (!text) return null;

  const flags = caseSensitive ? 'g' : 'gi';
  let regex;
  try {
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch {
    // If regex fails, fall back to literal string match
    const idx = caseSensitive ? text.indexOf(query) : text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return invert ? { matched: false, inverted: true, text } : null;
    const context = extractContext(text, idx, query.length, contextChars);
    return { matched: true, index: idx, context, text };
  }

  const match = regex.exec(text);
  if (match) {
    if (invert) return null;
    const context = extractContext(text, match.index, match[0].length, contextChars);
    return { matched: true, index: match.index, context, text };
  }

  // No match found
  if (invert && text) return { matched: false, inverted: true, text };
  return null;
}

// --- Main ---
const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

const listResult = shell('openclaw cron list');
if (!listResult.ok) {
  error('Failed to list cron jobs: ' + listResult.stderr);
  process.exit(2);
}

const jobs = parseCronList(listResult.stdout);
const results = [];

for (const job of jobs) {
  if (!args['include-disabled'] && job.status === 'disabled') continue;
  if (!fuzzyMatch(job.name, nameFilter)) continue;

  const runsResult = shell('openclaw cron runs --id ' + job.id + ' --limit ' + maxRuns);
  const runs = parseCronRuns(runsResult.ok ? runsResult.stdout : '');

  for (const run of runs) {
    // Time filter
    if (run.runAtMs < cutoff) continue;

    const searchResult = searchRun(run, query, caseSensitive, invert, contextChars);

    if (searchResult) {
      results.push({
        jobName: job.name,
        jobId: job.id,
        runAtMs: run.runAtMs,
        status: run.status,
        delivered: run.delivered,
        deliveryStatus: run.deliveryStatus,
        model: [run.provider, run.model].filter(Boolean).join('/'),
        durationMs: run.durationMs,
        totalTokens: run.usage ? run.usage.total_tokens : 0,
        summary: run.summary || '',
        sessionId: run.sessionId,
        matched: searchResult.matched,
        inverted: searchResult.inverted || false,
        context: searchResult.context || null,
      });
    }
  }
}

// Sort by recency (newest first)
results.sort((a, b) => b.runAtMs - a.runAtMs);

// --- Output ---
if (args.json) {
  process.stdout.write(JSON.stringify({
    query,
    options: { days, field: fieldFilter, caseSensitive, invert, jobFilter: nameFilter },
    totalScanned: jobs.filter(j => fuzzyMatch(j.name, nameFilter)).length,
    matches: results.slice(0, maxResults),
    matchCount: results.length,
    timestamp: new Date().toISOString(),
  }, null, 2) + '\n');
  process.exit(0);
}

// Human-readable output
const shown = results.slice(0, maxResults);

section('Cron History Search');

const invertLabel = invert ? ' (inverted)' : '';
const jobLabel = nameFilter ? ' in job "' + nameFilter + '"' : '';
const fieldLabel = fieldFilter !== 'all' ? ' [' + fieldFilter + ']' : '';
process.stdout.write('Query: "' + query + '"' + invertLabel + ' · ' + days + '-day window' + jobLabel + fieldLabel + '\n');

if (shown.length === 0) {
  process.stdout.write('\n');
  ok('No matching runs found');
  process.exit(0);
}

process.stdout.write('\nFound ' + results.length + ' matching run' + (results.length !== 1 ? 's' : '') + ':\n\n');

for (let i = 0; i < shown.length; i++) {
  const r = shown[i];
  const num = i + 1;

  const statusIcon = r.status === 'ok' ? '✅' : '❌';
  const deliveryIcon = r.deliveryStatus === 'delivered' ? '📤' : r.deliveryStatus === 'failed' ? '🚫' : '📦';

  process.stdout.write(num + '. [' + formatTimestamp(r.runAtMs) + '] ' + r.jobName + '\n');
  process.stdout.write('   ' + statusIcon + ' ' + r.status + ' · ' + deliveryIcon + ' ' + (r.deliveryStatus || 'n/a') + '\n');
  process.stdout.write('   Model: ' + r.model + ' · Tokens: ' + formatTokens(r.totalTokens) + ' · Duration: ' + formatDuration(r.durationMs) + '\n');

  if (r.context) {
    process.stdout.write('   Match: "' + r.context + '"\n');
  } else if (r.summary) {
    // Show truncated summary
    const trunc = r.summary.length > 100 ? r.summary.slice(0, 100) + '...' : r.summary;
    process.stdout.write('   ' + trunc + '\n');
  }

  process.stdout.write('\n');
}

if (results.length > maxResults) {
  process.stdout.write('(' + maxResults + ' of ' + results.length + ' shown — use --limit to see more)\n');
}

process.stdout.write('\n');
ok('Tip: use `cron-run-inspector --job-id <id>` to deep-dive into any matching run');
