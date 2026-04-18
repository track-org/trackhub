// arm64-safe: ES5 CJS, no template literals
// session-digest.cjs — Summarize a day's OpenClaw cron activity into a concise report

'use strict';

var fs = require('fs');
var path = require('path');
var child = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────

var CRON_DIR = process.env.OPENCLAW_STATE_DIR
  ? path.join(process.env.OPENCLAW_STATE_DIR, 'cron')
  : path.join(process.env.HOME || '/root', '.openclaw', 'cron');

var JOBS_FILE = path.join(CRON_DIR, 'jobs.json');
var RUNS_DIR = path.join(CRON_DIR, 'runs');

// ── Args ────────────────────────────────────────────────────────────────

var args = process.argv.slice(2);
var optJson = args.indexOf('--json') !== -1;
var optQuiet = args.indexOf('--quiet') !== -1;
var optDays = 1;
var daysIdx = args.indexOf('--days');
if (daysIdx !== -1 && args[daysIdx + 1]) {
  optDays = parseInt(args[daysIdx + 1], 10) || 1;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  var s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  s = s % 60;
  return m + 'm ' + pad(s) + 's';
}

function fmtCost(tokens) {
  // Rough estimate: glm-5-turbo ~$0.60/1M input, $2.40/1M output
  // Use a blended rate of ~$1.00/1M tokens for simplicity
  var usd = tokens / 1000000 * 1.0;
  if (usd < 0.01) return '<$0.01';
  return '$' + usd.toFixed(2);
}

function dateRange(days) {
  var now = new Date();
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  var start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}

function getJobs() {
  if (!fs.existsSync(JOBS_FILE)) return {};
  try {
    var raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    var jobs = {};
    // Handle both array and object formats
    var list = Array.isArray(raw) ? raw : (raw.jobs || []);
    list.forEach(function(j) { jobs[j.id] = j; });
    return jobs;
  } catch (e) {
    if (!optQuiet) process.stderr.write('WARN: Could not parse ' + JOBS_FILE + ': ' + e.message + '\n');
    return {};
  }
}

function getRuns(jobs, range) {
  var runs = [];
  if (!fs.existsSync(RUNS_DIR)) return runs;

  var files;
  try {
    files = fs.readdirSync(RUNS_DIR).filter(function(f) { return f.endsWith('.jsonl'); });
  } catch (e) { return runs; }

  files.forEach(function(file) {
    // Extract job ID from filename (format: <jobId>.jsonl)
    var jobId = file.replace('.jsonl', '');
    var jobName = jobs[jobId] ? (jobs[jobId].name || 'unnamed') : jobId;

    var lines;
    try {
      lines = fs.readFileSync(path.join(RUNS_DIR, file), 'utf8').split('\n');
    } catch (e) { return; }

    lines.forEach(function(line) {
      if (!line.trim()) return;
      try {
        var entry = JSON.parse(line);
        var ts = entry.ts || entry.runAtMs || 0;
        if (ts >= range.start && ts <= range.end) {
          entry._jobId = jobId;
          entry._jobName = jobName;
          runs.push(entry);
        }
      } catch (e) { /* skip malformed lines */ }
    });
  });

  return runs.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
}

function getSchedule(job) {
  var s = job.schedule || {};
  if (s.kind === 'at') {
    return 'once @ ' + (s.at || '?');
  }
  return s.cron || s.expression || '?';
}

function getDelivery(job) {
  var d = job.delivery || {};
  if (!d.mode) return 'none';
  var target = d.to || d.channel || '';
  return d.mode + ' → ' + target;
}

// ── Build Report ────────────────────────────────────────────────────────

function buildReport(jobs, runs, range) {
  var totalRuns = runs.length;
  var okRuns = 0;
  var errRuns = 0;
  var totalTokens = 0;
  var totalDuration = 0;
  var deliveredRuns = 0;
  var failedDeliveryRuns = 0;
  var perJob = {};

  runs.forEach(function(r) {
    var isOk = (r.status === 'ok' || r.status === 'success');
    if (isOk) okRuns++; else errRuns++;

    var usage = r.usage || {};
    totalTokens += (usage.total_tokens || usage.input_tokens + usage.output_tokens || 0);
    totalDuration += (r.durationMs || 0);

    if (r.delivered) deliveredRuns++;
    if (r.deliveryStatus === 'failed' || r.deliveryStatus === 'not-delivered') failedDeliveryRuns++;

    var name = r._jobName;
    if (!perJob[name]) {
      var job = jobs[r._jobId] || {};
      perJob[name] = {
        id: r._jobId,
        runs: 0,
        ok: 0,
        err: 0,
        tokens: 0,
        duration: 0,
        schedule: getSchedule(job),
        delivery: getDelivery(job),
        summaries: []
      };
    }
    perJob[name].runs++;
    if (isOk) perJob[name].ok++; else perJob[name].err++;
    perJob[name].tokens += (usage.total_tokens || usage.input_tokens + usage.output_tokens || 0);
    perJob[name].duration += (r.durationMs || 0);
    if (r.summary && perJob[name].summaries.length < 2) {
      perJob[name].summaries.push(r.summary.substring(0, 120));
    }
  });

  // Sort by run count descending
  var jobNames = Object.keys(perJob).sort(function(a, b) {
    return perJob[b].runs - perJob[a].runs;
  });

  return {
    range: range,
    totalRuns: totalRuns,
    okRuns: okRuns,
    errRuns: errRuns,
    totalTokens: totalTokens,
    totalDuration: totalDuration,
    deliveredRuns: deliveredRuns,
    failedDeliveryRuns: failedDeliveryRuns,
    jobCount: jobNames.length,
    perJob: perJob,
    jobNames: jobNames
  };
}

// ── Text Output ─────────────────────────────────────────────────────────

function renderText(report) {
  var range = report.range;
  var startD = new Date(range.start);
  var endD = new Date(range.end);
  var dayLabel = report.jobNames.length === 0 ? 'today' :
    (report.jobNames.length <= 1 ? 'today' :
    startD.toISOString().split('T')[0] + ' to ' + endD.toISOString().split('T')[0]);

  var lines = [];
  lines.push('Session Digest — ' + dayLabel);
  lines.push('');

  if (report.totalRuns === 0) {
    lines.push('No cron activity found for this period.');
    return lines.join('\n');
  }

  // Summary line
  var healthIcon = report.errRuns === 0 ? 'All healthy' : report.errRuns + ' error(s)';
  lines.push(report.totalRuns + ' runs across ' + report.jobCount + ' jobs — ' + healthIcon);
  lines.push('Tokens: ' + report.totalTokens.toLocaleString() + ' (' + fmtCost(report.totalTokens) + ')');
  lines.push('Total runtime: ' + fmtDuration(report.totalDuration));
  if (report.failedDeliveryRuns > 0) {
    lines.push('Delivery issues: ' + report.failedDeliveryRuns);
  }
  lines.push('');

  // Per-job breakdown
  report.jobNames.forEach(function(name) {
    var j = report.perJob[name];
    var icon = j.err > 0 ? '⚠️' : '✅';
    lines.push(icon + ' ' + name);
    lines.push('   Runs: ' + j.runs + ' (' + j.ok + ' ok, ' + j.err + ' err) — ' + fmtDuration(j.duration) + ' total');
    lines.push('   Tokens: ' + j.tokens.toLocaleString() + ' (' + fmtCost(j.tokens) + ')');
    lines.push('   Schedule: ' + j.schedule);
    if (j.delivery !== 'none') {
      lines.push('   Delivery: ' + j.delivery);
    }
    if (j.summaries.length > 0) {
      lines.push('   Latest: ' + j.summaries[j.summaries.length - 1]);
    }
    lines.push('');
  });

  // Issues summary
  var issues = report.jobNames.filter(function(n) { return report.perJob[n].err > 0; });
  if (issues.length > 0) {
    lines.push('Issues:');
    issues.forEach(function(n) {
      var j = report.perJob[n];
      lines.push('  - ' + n + ': ' + j.err + ' error(s) out of ' + j.runs + ' run(s)');
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ── JSON Output ─────────────────────────────────────────────────────────

function renderJson(report) {
  var out = {
    period: {
      start: new Date(report.range.start).toISOString(),
      end: new Date(report.range.end).toISOString()
    },
    summary: {
      total_runs: report.totalRuns,
      ok: report.okRuns,
      errors: report.errRuns,
      total_tokens: report.totalTokens,
      estimated_cost_usd: report.totalTokens / 1000000 * 1.0,
      total_duration_ms: report.totalDuration,
      delivery_ok: report.deliveredRuns,
      delivery_failed: report.failedDeliveryRuns,
      unique_jobs: report.jobCount
    },
    jobs: {}
  };
  report.jobNames.forEach(function(name) {
    var j = report.perJob[name];
    out.jobs[name] = {
      id: j.id,
      runs: j.runs,
      ok: j.ok,
      errors: j.err,
      tokens: j.tokens,
      duration_ms: j.duration,
      schedule: j.schedule,
      delivery: j.delivery,
      latest_summary: j.summaries.length > 0 ? j.summaries[j.summaries.length - 1] : null
    };
  });
  return JSON.stringify(out, null, 2);
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  var jobs = getJobs();
  var range = dateRange(optDays);
  var runs = getRuns(jobs, range);
  var report = buildReport(jobs, runs, range);

  if (optJson) {
    process.stdout.write(renderJson(report) + '\n');
  } else {
    process.stdout.write(renderText(report) + '\n');
  }
}

main();
