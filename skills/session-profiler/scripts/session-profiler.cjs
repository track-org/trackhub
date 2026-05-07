#!/usr/bin/env node
/**
 * session-profiler.cjs — Analyze cron run performance metrics
 *
 * Parses openclaw cron run JSON (stdin) and computes latency,
 * token efficiency, cost estimates, and trend indicators.
 *
 * Zero dependencies. Node.js 18+. ES5 CJS for arm64 safety.
 */

'use strict';

// ── Pricing table (per 1M tokens, USD) ──
var PRICING = {
  'zai/glm-5-turbo':      { input: 0.50, output: 1.50 },
  'zai/glm-5':            { input: 2.00, output: 8.00 },
  'openai/gpt-4o':        { input: 2.50, output: 10.00 },
  'openai/gpt-4o-mini':   { input: 0.15, output: 0.60 },
  'openai/gpt-4.1':       { input: 2.00, output: 8.00 },
  'openai/gpt-4.1-mini':  { input: 0.40, output: 1.60 },
  'openai/gpt-4.1-nano':  { input: 0.10, output: 0.40 },
  'anthropic/claude-sonnet': { input: 3.00, output: 15.00 },
  'anthropic/claude-haiku':  { input: 0.25, output: 1.25 },
  'google/gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-pro':   { input: 1.25, output: 10.00 },
};

// ── CLI Args ──
function parseArgs(argv) {
  var args = { _: [] };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--report' || a === '-r') { args.report = true; }
    else if (a === '--json' || a === '-j') { args.json = true; }
    else if (a === '--by-model') { args.byModel = true; }
    else if (a === '--failures-only') { args.failuresOnly = true; }
    else if (a === '--summary') { args.summary = true; }
    else if (a === '--since' || a === '-s') { args.since = argv[++i]; }
    else if (a === '--top' || a === '-n') { args.top = parseInt(argv[++i], 10) || 10; }
    else if (a === '--cost-input') { args.costInput = parseFloat(argv[++i]); }
    else if (a === '--cost-output') { args.costOutput = parseFloat(argv[++i]); }
    else if (a === '--help' || a === '-h') { args.help = true; }
    else if (a.startsWith('--')) { console.error('Unknown flag: ' + a); process.exit(1); }
    else { args._.push(a); }
  }
  return args;
}

// ── Math helpers ──
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce(function(s, v) { return s + v; }, 0) / arr.length;
}
function median(arr) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function p95(arr) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function(a, b) { return a - b; });
  var idx = Math.ceil(0.95 * s.length) - 1;
  return s[Math.max(0, idx)];
}
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed ? n.toFixed(n % 1 === 0 ? 0 : 1) : String(n);
}
function fmtDur(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  var m = Math.floor(ms / 60000);
  var s = ((ms % 60000) / 1000).toFixed(0);
  return m + 'm ' + s + 's';
}
function fmtCost(usd) {
  if (usd < 0.01) return '$' + (usd * 1000).toFixed(1) + 'm';
  return '$' + usd.toFixed(2);
}
function fmtDate(ts) {
  var d = new Date(ts);
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

// ── Time filtering ──
function parseSince(since) {
  if (!since || since === 'all') return null;
  var ms;
  var now = Date.now();
  if (since.match(/^\d+d$/)) {
    ms = now - parseInt(since, 10) * 86400000;
  } else if (since.match(/^\d{4}-\d{2}-\d{2}$/)) {
    ms = new Date(since).getTime();
  } else {
    console.error('Invalid --since format. Use "7d", "30d", or "YYYY-MM-DD"');
    process.exit(1);
  }
  return ms;
}

// ── Cost estimation ──
function getCost(run, customInput, customOutput) {
  var model = (run.provider || '') + '/' + (run.model || '');
  var pricing = PRICING[model];
  var inPrice = customInput != null ? customInput / 1e6 : (pricing ? pricing.input / 1e6 : 0.002 / 1e6);
  var outPrice = customOutput != null ? customOutput / 1e6 : (pricing ? pricing.output / 1e6 : 0.008 / 1e6);
  var u = run.usage || {};
  var inTok = u.input_tokens || 0;
  var outTok = u.output_tokens || 0;
  return (inTok * inPrice) + (outTok * outPrice);
}

// ── Trend detection (simple linear regression slope) ──
function trendSlope(values) {
  if (values.length < 3) return null;
  var n = values.length;
  var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (var i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  var denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Anomaly detection ──
function findAnomalies(runs) {
  var anomalies = [];
  if (runs.length < 5) return anomalies;

  var durations = runs.map(function(r) { return r.durationMs || 0; });
  var tokens = runs.map(function(r) { return (r.usage || {}).total_tokens || 0; });

  var dMed = median(durations);
  var tMed = median(tokens);

  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var d = r.durationMs || 0;
    var t = (r.usage || {}).total_tokens || 0;
    var dt = fmtDate(r.runAtMs || r.ts);

    if (d > dMed * 1.8 && d > 5000) {
      anomalies.push({ type: 'slow', run: r, detail: fmtDur(d) + ' (median ' + fmtDur(dMed) + ')', date: dt });
    }
    if (t > tMed * 1.8 && t > 0) {
      anomalies.push({ type: 'token_spike', run: r, detail: fmtNum(t) + ' tokens (median ' + fmtNum(tMed) + ')', date: dt });
    }
    if (r.status === 'error') {
      anomalies.push({ type: 'error', run: r, detail: 'Run failed', date: dt });
    }
    if (r.delivered === false) {
      anomalies.push({ type: 'delivery', run: r, detail: 'Not delivered', date: dt });
    }
  }
  return anomalies;
}

// ── Read stdin ──
function readStdin(cb) {
  var chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function(c) { chunks.push(c); });
  process.stdin.on('end', function() {
    var raw = chunks.join('');
    try { cb(JSON.parse(raw)); }
    catch (e) { console.error('Failed to parse JSON from stdin'); process.exit(1); }
  });
}

// ── Extract runs from various input formats ──
function extractRuns(data) {
  // openclaw cron runs output
  if (data.entries && Array.isArray(data.entries)) return data.entries;
  // Array of runs directly
  if (Array.isArray(data)) return data;
  // Single run
  if (data.ts && data.jobId) return [data];
  console.error('Cannot find runs in input. Expected openclaw cron runs JSON output.');
  process.exit(1);
}

// ── Profile runs ──
function profile(runs, opts) {
  var sinceMs = parseSince(opts.since);

  // Filter
  var filtered = runs.filter(function(r) {
    if (sinceMs && (r.runAtMs || r.ts) < sinceMs) return false;
    if (opts.failuresOnly && r.status === 'ok') return false;
    return true;
  });

  if (!filtered.length) {
    console.log('No runs found matching filters.');
    return;
  }

  // Basic stats
  var durations = filtered.map(function(r) { return r.durationMs || 0; });
  var inTokens = filtered.map(function(r) { return (r.usage || {}).input_tokens || 0; });
  var outTokens = filtered.map(function(r) { return (r.usage || {}).total_tokens || 0; });
  var costs = filtered.map(function(r) { return getCost(r, opts.costInput, opts.costOutput); });
  var successes = filtered.filter(function(r) { return r.status === 'ok'; }).length;
  var delivered = filtered.filter(function(r) { return r.delivered !== false; }).length;

  var totalCost = costs.reduce(function(s, c) { return s + c; }, 0);
  var totalTokens = outTokens.reduce(function(s, t) { return s + t; }, 0);

  // Date range
  var timestamps = filtered.map(function(r) { return r.runAtMs || r.ts || 0; }).sort();
  var dateStart = timestamps[0] ? fmtDate(timestamps[0]) : '?';
  var dateEnd = timestamps[timestamps.length - 1] ? fmtDate(timestamps[timestamps.length - 1]) : '?';

  // Unique models
  var models = {};
  filtered.forEach(function(r) {
    var m = (r.provider || '?') + '/' + (r.model || '?');
    models[m] = (models[m] || 0) + 1;
  });

  // Duration trend (on last 10 runs, sorted chronologically)
  var sortedRuns = filtered.slice().sort(function(a, b) { return (a.runAtMs || a.ts) - (b.runAtMs || b.ts); });
  var recentDurations = sortedRuns.slice(-10).map(function(r) { return r.durationMs || 0; });
  var durSlope = trendSlope(recentDurations);
  var durTrend;
  if (durSlope === null) durTrend = 'insufficient data';
  else if (durSlope > 100) durTrend = 'increasing (+' + (durSlope / 1000).toFixed(1) + 's/run)';
  else if (durSlope < -100) durTrend = 'decreasing (' + (durSlope / 1000).toFixed(1) + 's/run)';
  else durTrend = 'stable';

  // Output/Input ratio
  var meanIn = mean(inTokens);
  var meanOut = mean(outTokens);
  var oiRatio = meanIn > 0 ? (meanOut / meanIn * 100).toFixed(1) + '%' : 'N/A';

  // Token/sec throughput
  var throughputs = filtered.filter(function(r) { return r.durationMs > 0; }).map(function(r) {
    return ((r.usage || {}).total_tokens || 0) / (r.durationMs / 1000);
  });
  var meanThroughput = mean(throughputs);

  // Daily cost estimate
  var daySpan = Math.max(1, (timestamps[timestamps.length - 1] - timestamps[0]) / 86400000);
  var dailyCost = totalCost / daySpan;
  var monthlyProj = dailyCost * 30;

  var metrics = {
    totalRuns: filtered.length,
    dateRange: dateStart + ' -> ' + dateEnd,
    models: models,
    successRate: (successes / filtered.length * 100).toFixed(1) + '%',
    deliveryRate: (delivered / filtered.length * 100).toFixed(1) + '%',
    latency: {
      mean: mean(durations),
      median: median(durations),
      p95: p95(durations),
      min: Math.min.apply(null, durations),
      max: Math.max.apply(null, durations),
      trend: durTrend,
    },
    tokens: {
      meanInput: mean(inTokens),
      meanOutput: mean(outTokens),
      outputInputRatio: oiRatio,
      total: totalTokens,
    },
    throughput: meanThroughput,
    cost: {
      perRun: filtered.length > 0 ? totalCost / filtered.length : 0,
      daily: dailyCost,
      monthlyProjection: monthlyProj,
      total: totalCost,
    },
    anomalies: findAnomalies(filtered),
    topSlowest: sortedRuns.slice().sort(function(a, b) { return (b.durationMs || 0) - (a.durationMs || 0); }).slice(0, opts.top || 10),
    topExpensive: filtered.slice().sort(function(a, b) { return getCost(b, opts.costInput, opts.costOutput) - getCost(a, opts.costInput, opts.costOutput); }).slice(0, opts.top || 10),
  };

  return metrics;
}

// ── Report output ──
function printReport(metrics) {
  var lat = metrics.latency;
  var tok = metrics.tokens;
  var cost = metrics.cost;

  console.log('');
  console.log('━━━ Session Performance Report ━━━');
  console.log('');
  console.log('Overview');
  console.log('   Total runs analyzed: ' + metrics.totalRuns);
  console.log('   Date range: ' + metrics.dateRange);
  var modelList = Object.keys(metrics.models);
  console.log('   Models used: ' + (modelList.length === 1 ? modelList[0] + ' (all runs)' : modelList.join(', ')));
  console.log('   Success rate: ' + metrics.successRate);
  console.log('   Delivery rate: ' + metrics.deliveryRate);
  console.log('');

  console.log('Latency');
  console.log('   Mean: ' + fmtDur(lat.mean) + ' | Median: ' + fmtDur(lat.median) + ' | P95: ' + fmtDur(lat.p95));
  console.log('   Fastest: ' + fmtDur(lat.min) + ' | Slowest: ' + fmtDur(lat.max));
  console.log('   Throughput: ' + fmtNum(Math.round(metrics.throughput)) + ' tokens/s');
  console.log('   Trend: ' + lat.trend);
  console.log('');

  console.log('Token Efficiency');
  console.log('   Mean input: ' + fmtNum(Math.round(tok.meanInput)) + ' | Mean total: ' + fmtNum(Math.round(tok.meanOutput)));
  console.log('   Output/Input ratio: ' + tok.outputInputRatio);
  console.log('   Total tokens: ' + fmtNum(tok.total));
  console.log('');

  console.log('Cost Estimate');
  console.log('   Per run: ' + fmtCost(cost.perRun) + ' | Daily avg: ' + fmtCost(cost.daily));
  console.log('   Monthly projection: ' + fmtCost(cost.monthlyProjection));
  console.log('   Total (period): ' + fmtCost(cost.total));
  console.log('');

  if (metrics.anomalies.length > 0) {
    console.log('Anomalies (' + metrics.anomalies.length + ')');
    metrics.anomalies.forEach(function(a, i) {
      var icon = a.type === 'error' ? 'ERROR' : a.type === 'delivery' ? 'DELIVERY' : a.type === 'token_spike' ? 'SPIKE' : 'SLOW';
      console.log('   ' + (i + 1) + '. [' + icon + '] ' + a.date + ' — ' + a.detail);
    });
    console.log('');
  } else {
    console.log('Anomalies: none detected');
    console.log('');
  }

  if (metrics.topSlowest.length > 0) {
    console.log('Top ' + metrics.topSlowest.length + ' Slowest Runs');
    metrics.topSlowest.forEach(function(r, i) {
      var d = fmtDate(r.runAtMs || r.ts);
      var dur = fmtDur(r.durationMs || 0);
      var tok = fmtNum((r.usage || {}).total_tokens || 0);
      console.log('   ' + (i + 1) + '. ' + d + ' — ' + dur + ' (' + tok + ' tokens)');
    });
    console.log('');
  }
}

// ── Summary output (one-liner) ──
function printSummary(metrics) {
  var lat = metrics.latency;
  var cost = metrics.cost;
  console.log(
    metrics.totalRuns + ' runs | ' + metrics.dateRange + ' | ' +
    'Success: ' + metrics.successRate + ' | ' +
    'Median: ' + fmtDur(lat.median) + ' (P95: ' + fmtDur(lat.p95) + ') | ' +
    'Trend: ' + lat.trend + ' | ' +
    'Cost: ' + fmtCost(cost.total) + ' (' + fmtCost(cost.monthlyProjection) + '/mo)'
  );
}

// ── By-model comparison ──
function printByModel(runs, opts) {
  var groups = {};
  runs.forEach(function(r) {
    var m = (r.provider || '?') + '/' + (r.model || '?');
    if (!groups[m]) groups[m] = [];
    groups[m].push(r);
  });

  var sinceMs = parseSince(opts.since);
  var modelNames = Object.keys(groups).sort();
  console.log('');
  console.log('Model Comparison');
  console.log('─'.repeat(80));

  modelNames.forEach(function(m) {
    var g = groups[m].filter(function(r) {
      return !sinceMs || (r.runAtMs || r.ts) >= sinceMs;
    });
    if (!g.length) return;
    var dur = g.map(function(r) { return r.durationMs || 0; });
    var tok = g.map(function(r) { return (r.usage || {}).total_tokens || 0; });
    var costs = g.map(function(r) { return getCost(r, opts.costInput, opts.costOutput); });
    var totalCost = costs.reduce(function(s, c) { return s + c; }, 0);
    var ok = g.filter(function(r) { return r.status === 'ok'; }).length;

    console.log('');
    console.log('  ' + m + ' (' + g.length + ' runs)');
    console.log('    Latency:  median ' + fmtDur(median(dur)) + ' | mean ' + fmtDur(mean(dur)));
    console.log('    Tokens:   mean ' + fmtNum(Math.round(mean(tok))) + ' | total ' + fmtNum(tok.reduce(function(s, t) { return s + t; }, 0)));
    console.log('    Cost:     per-run ' + fmtCost(totalCost / g.length) + ' | total ' + fmtCost(totalCost));
    console.log('    Success:  ' + (ok / g.length * 100).toFixed(1) + '%');
  });
  console.log('');
}

// ── Main ──
function main() {
  var args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log('session-profiler — Analyze cron run performance');
    console.log('');
    console.log('Usage: openclaw cron runs --id <job> --json | node session-profiler.cjs [options]');
    console.log('       openclaw cron list --json | node session-profiler.cjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --report, -r        Full human-readable report');
    console.log('  --json, -j          Output metrics as JSON');
    console.log('  --by-model          Group metrics by model');
    console.log('  --failures-only     Only analyze failed runs');
    console.log('  --since, -s <val>   Time filter: "7d", "30d", "YYYY-MM-DD"');
    console.log('  --summary           One-line summary');
    console.log('  --top, -n <n>       Number of top items (default: 10)');
    console.log('  --cost-input <n>    Custom input price per 1M tokens (USD)');
    console.log('  --cost-output <n>   Custom output price per 1M tokens (USD)');
    console.log('  --help, -h          Show this help');
    process.exit(0);
  }

  readStdin(function(data) {
    var runs = extractRuns(data);

    if (args.byModel) {
      printByModel(runs, args);
      return;
    }

    var metrics = profile(runs, args);

    if (args.json) {
      console.log(JSON.stringify(metrics, null, 2));
    } else if (args.summary) {
      printSummary(metrics);
    } else if (args.report) {
      printReport(metrics);
    } else {
      // Default: compact overview
      printSummary(metrics);
      if (metrics.anomalies.length > 0) {
        console.log('');
        console.log('Anomalies (' + metrics.anomalies.length + '):');
        metrics.anomalies.forEach(function(a) {
          console.log('  - ' + a.date + ': ' + a.detail);
        });
      }
    }
  });
}

main();
