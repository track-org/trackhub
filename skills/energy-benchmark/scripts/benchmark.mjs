#!/usr/bin/env node
/**
 * energy-benchmark — compare today's energy usage against same-day-of-week historical baseline.
 *
 * Uses the emporia-energy vendor wrapper to fetch daily kWh totals,
 * then compares the current day against the average of the last N same-weekdays.
 *
 * Usage:
 *   node benchmark.mjs [--date YYYY-MM-DD] [--weeks N] [--filter "Circuit"] [--json] [--env-file path]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else { out[key] = true; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const jsonMode = !!args.json;
const targetDate = args.date || new Date().toISOString().slice(0, 10);
const numWeeks = Math.max(2, Math.min(12, parseInt(args.weeks || '4', 10)));
const circuitFilter = args.filter || null;
const envFile = args['env-file'] || '/home/delads/.openclaw/workspace/.env';

// ── Helpers ───────────────────────────────────────────────────────────────
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sameWeekdays(target, count) {
  const dates = [];
  const d = new Date(target + 'T12:00:00Z');
  for (let i = 0; i < count; i++) {
    d.setUTCDate(d.getUTCDate() - 7);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function elapsedFraction(targetDateStr) {
  const now = new Date();
  const target = new Date(targetDateStr + 'T00:00:00');
  const isToday = targetDateStr === now.toISOString().slice(0, 10);
  if (!isToday) return 1; // past days are complete

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const elapsed = now - startOfToday;
  const fullDay = 24 * 60 * 60 * 1000;
  return Math.min(1, elapsed / fullDay);
}

function verdict(pct) {
  if (pct > 20) return 'ABOVE_NORMAL';
  if (pct < -20) return 'BELOW_NORMAL';
  return 'NORMAL';
}

function verdictEmoji(v) {
  switch (v) {
    case 'ABOVE_NORMAL': return '⚠️';
    case 'BELOW_NORMAL': return '✅';
    case 'NORMAL': return '👍';
    default: return '❓';
  }
}

// ── Fetch kWh for a single day ────────────────────────────────────────────
function fetchDayKwh(dateStr) {
  const vendorScript = path.resolve(__dirname, '..', 'emporia-energy', 'scripts', 'query_emporia_vendor.mjs');
  const cmdArgs = ['energy', '--range', 'today', '--env-file', envFile];
  if (circuitFilter) {
    cmdArgs.push('--filter', circuitFilter);
  }

  // We override the range by setting the date in the environment so the vendor script
  // picks it up, but the vendor script doesn't support arbitrary date ranges for "today".
  // Instead, we'll run the 24h command and rely on date arithmetic.
  // Actually, the vendor script only supports named ranges. For historical days we need
  // a different approach — let's query 24h periods relative to each historical date.

  // Workaround: use the PyEmVue fallback which supports date ranges, or
  // parse from the vendor's 24h endpoint with date offsets.
  //
  // Simplest approach: run the vendor energy command with --range 24h for each day
  // by temporarily overriding "now" — not possible.
  //
  // Better: use the emporia vendor script's API directly via a small inline helper.
  // Let's just query the whole month and extract the days we need.

  return null; // placeholder — will be replaced below
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  loadDotEnv(envFile);

  // Load Emporia vendor internals
  const vendorRoot = path.resolve(__dirname, '..', '..', 'emporia-energy', 'vendor', 'node_modules', '@emporiaenergy', 'emporia-mcp', 'build');
  const { loadEnvironmentConfig } = await import(path.join(vendorRoot, 'env.js'));
  const { CognitoAuthService } = await import(path.join(vendorRoot, 'services', 'auth.js'));
  const { EmporiaApiService } = await import(path.join(vendorRoot, 'services', 'api.js'));
  const { COGNITO_CLIENT_ID, COGNITO_URL } = await import(path.join(vendorRoot, 'config.js'));

  const envConfig = loadEnvironmentConfig();
  const authService = new CognitoAuthService({
    account_email: envConfig.account,
    password: envConfig.password,
    clientId: COGNITO_CLIENT_ID,
    cognitoUrl: COGNITO_URL,
  });
  await authService.initialize();
  const api = new EmporiaApiService(authService);
  const { accessToken } = await authService.getToken();

  // Get devices and channels
  const devices = await api.listDevices(accessToken);
  const channelsData = await api.getDevicesChannels(accessToken);

  // Flatten channels
  const flat = [];
  for (const dev of channelsData.deviceSummaries || []) {
    for (const c of dev.channelInfo || []) {
      flat.push({
        deviceGid: dev.deviceGid,
        manufacturerDeviceId: dev.manufacturerDeviceId,
        channelId: c.channelId,
        channelName: c.name,
      });
    }
  }

  // Filter channels if requested
  const filter = (circuitFilter || '').toLowerCase();
  const matched = filter
    ? flat.filter(x => (x.channelName || '').toLowerCase().includes(filter) || (x.manufacturerDeviceId || '').toLowerCase().includes(filter))
    : flat;

  const deviceIds = [...new Set(matched.map(x => x.manufacturerDeviceId).filter(Boolean))];
  const circuitIds = [...new Set(matched.map(x => x.channelId).filter(Boolean))];

  if (deviceIds.length === 0 || circuitIds.length === 0) {
    const msg = circuitFilter
      ? `No Emporia channels matched filter "${circuitFilter}".`
      : 'No Emporia channels found.';
    if (jsonMode) {
      console.log(JSON.stringify({ error: msg, verdict: 'INSUFFICIENT_DATA' }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  // Build date list: target day + historical same-weekdays
  const histDates = sameWeekdays(targetDate, numWeeks);
  const allDates = [targetDate, ...histDates];

  // We need to query energy for each date. The Emporia API can return daily data
  // for a range, so let's query from the earliest date to the end of the target date.
  const earliest = histDates[histDates.length - 1];
  const startDate = earliest + 'T00:00:00Z';
  const endDate = targetDate + 'T23:59:59Z';

  const energyData = await api.getDeviceEnergyUsage(accessToken, {
    device_ids: deviceIds,
    circuit_ids: circuitIds,
    start: startDate,
    end: endDate,
    energy_resolution: 'DAYS',
  });

  // Parse energy data into a map of date -> kWh
  const dailyKwh = {};
  function extractKwh(data) {
    for (const [type, payload] of Object.entries(data || {})) {
      const items = payload?.energyData?.success || payload?.energyData || [];
      for (const item of items) {
        // Items have { start, end, energy } or { date, usage } etc.
        // Normalize: look for date-like fields and energy/usage fields
        const dateStr = (item.start || item.date || item.time || '').slice(0, 10);
        const kwh = parseFloat(item.energy || item.usage || item.kwh || item.value || 0);
        if (dateStr && kwh > 0) {
          dailyKwh[dateStr] = (dailyKwh[dateStr] || 0) + kwh;
        }
      }
    }
  }

  extractKwh(energyData);

  // Build results
  const dayOfWeek = DAYS[new Date(targetDate + 'T12:00:00Z').getUTCDay()];
  const currentKwh = dailyKwh[targetDate] || 0;

  const historicalDays = histDates
    .map(d => ({ date: d, kwh: dailyKwh[d] || null }))
    .filter(d => d.kwh !== null && d.kwh > 0);

  if (historicalDays.length < 2) {
    const result = {
      date: targetDate,
      dayOfWeek,
      currentKwh,
      baselineKwh: null,
      baselineWeeks: historicalDays.length,
      verdict: 'INSUFFICIENT_DATA',
      error: `Only ${historicalDays.length} historical day(s) available; need at least 2.`,
      historicalDays,
    };
    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Energy Benchmark — ${dayOfWeek} ${targetDate}`);
      console.log('─'.repeat(40));
      console.log(`Insufficient historical data (${historicalDays.length} day(s), need 2+).`);
    }
    return;
  }

  // Compute baseline: average of historical same-weekdays
  // If the target is today and the day is incomplete, scale historical to match
  const frac = elapsedFraction(targetDate);
  const baselineKwh = historicalDays.reduce((sum, d) => sum + d.kwh, 0) / historicalDays.length;

  // Scale baseline to same elapsed fraction for fair comparison
  const scaledBaseline = baselineKwh * frac;
  const deltaKwh = currentKwh - scaledBaseline;
  const deltaPct = scaledBaseline > 0 ? Math.round((deltaKwh / scaledBaseline) * 1000) / 10 : 0;
  const v = verdict(deltaPct);
  const rangeMin = Math.min(...historicalDays.map(d => d.kwh * frac));
  const rangeMax = Math.max(...historicalDays.map(d => d.kwh * frac));

  const result = {
    date: targetDate,
    dayOfWeek,
    currentKwh: Math.round(currentKwh * 100) / 100,
    baselineKwh: Math.round(scaledBaseline * 100) / 100,
    fullDayBaselineKwh: Math.round(baselineKwh * 100) / 100,
    baselineWeeks: historicalDays.length,
    elapsedFraction: Math.round(frac * 100) / 100,
    deltaKwh: Math.round(deltaKwh * 100) / 100,
    deltaPercent: deltaPct,
    verdict: v,
    rangeMin: Math.round(rangeMin * 100) / 100,
    rangeMax: Math.round(rangeMax * 100) / 100,
    historicalDays: historicalDays.map(d => ({ ...d, kwh: Math.round(d.kwh * 100) / 100 })),
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const sign = deltaKwh >= 0 ? '+' : '';
    console.log(`Energy Benchmark — ${dayOfWeek} ${targetDate}`);
    console.log('─'.repeat(40));
    if (frac < 1) {
      console.log(`Today so far:    ${currentKwh.toFixed(1)} kWh (${Math.round(frac * 100)}% of day)`);
      console.log(`Typical ${dayOfWeek.slice(0, 3)} at this time: ${scaledBaseline.toFixed(1)} kWh (avg of last ${historicalDays.length} ${dayOfWeek}s, scaled)`);
      console.log(`Full-day typical: ${baselineKwh.toFixed(1)} kWh`);
    } else {
      console.log(`Today:           ${currentKwh.toFixed(1)} kWh`);
      console.log(`Typical ${dayOfWeek.slice(0, 3)}:  ${scaledBaseline.toFixed(1)} kWh (avg of last ${historicalDays.length} ${dayOfWeek}s)`);
    }
    console.log(`Delta:           ${sign}${deltaKwh.toFixed(1)} kWh (${sign}${deltaPct}%)`);
    console.log(`Verdict:         ${verdictEmoji(v)} ${v.replace(/_/g, ' ')}`);
    console.log(`Range:           ${rangeMin.toFixed(1)} – ${rangeMax.toFixed(1)} kWh`);
  }
}

main().catch(err => {
  const msg = String(err?.message || err || 'Unknown error');
  // Check for Emporia auth/API errors
  if (msg.includes('Not authorized') || msg.includes('length') || msg.includes('Cannot read')) {
    const hint = 'Emporia API error — token may have expired or service is unreachable. Try again later.';
    if (jsonMode) {
      console.log(JSON.stringify({ error: hint, rawError: msg, verdict: 'INSUFFICIENT_DATA' }, null, 2));
    } else {
      console.error(hint);
    }
  } else if (jsonMode) {
    console.log(JSON.stringify({ error: msg, verdict: 'INSUFFICIENT_DATA' }, null, 2));
  } else {
    console.error('Error:', msg);
  }
  process.exit(1);
});
