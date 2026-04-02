#!/usr/bin/env node
/**
 * pipeline-query.mjs — Unified Attio pipeline query tool
 *
 * A single script with multiple query modes for CRM pipeline analysis.
 * Uses schema-cached fuzzy matching so the LLM doesn't need to know
 * exact stage names or field slugs.
 *
 * Usage:
 *   node pipeline-query.mjs --mode <mode> [options]
 *   node pipeline-query.mjs --help
 *   node pipeline-query.mjs --refresh-schema
 *
 * Modes:
 *   snapshot    — Pipeline overview grouped by stage
 *   stale       — Deals that haven't moved stage in N days
 *   forecast    — Weighted pipeline, deals closing soon, slipped deals
 *   health      — Deals at risk (no activity, missing data)
 *   win-loss    — Closed won/lost analysis by period
 *   hygiene     — Data quality issues (missing fields, zombies)
 *   movements   — Recent stage changes
 *   help        — Show available modes, flags, and intent mapping
 */

import { attioRequest } from './lib/attio-client.mjs';
import { loadSchema, refreshSchema } from './lib/schema-cache.mjs';
import { fuzzyMatch, fuzzyMatchMultiple } from './lib/fuzzy-match.mjs';

// ── Helpers ──────────────────────────────────────────────────────────

function getName(r) { return r?.values?.name?.[0]?.value || 'Untitled deal'; }
function getStage(r) { return r?.values?.stage?.[0]?.status?.title || 'Unknown'; }
function getStageChanged(r) { return r?.values?.stage?.[0]?.active_from || null; }
function getStageId(r) { return r?.values?.stage?.[0]?.status?.id?.status_id || null; }
function getCompanyId(r) { return r?.values?.associated_company?.[0]?.target_record_id || null; }
function getOwnerId(r) { return r?.values?.owner?.[0]?.referenced_actor_id || null; }
function getCreatedAt(r) { return r?.values?.created_at?.[0]?.value || null; }
function getCompanyStage(r) { return r?.values?.company_stage?.[0]?.status?.title || null; }

function getValue(r) {
  const raw = r?.values?.value?.[0];
  if (!raw) return { amount: 0, currency: 'EUR' };
  return {
    amount: Number(raw.currency_value ?? raw.value ?? 0),
    currency: raw.currency_code || 'EUR',
  };
}

function fmtMoney(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function hoursSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function parsePeriod(period) {
  const p = (period || 'month').toLowerCase();
  const now = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (p === 'week' || p === 'w') {
    start.setDate(start.getDate() - start.getDay() + 1); // Monday
  } else if (p === 'month' || p === 'm') {
    start.setDate(1);
  } else if (p === 'quarter' || p === 'q') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    start.setMonth(qMonth, 1);
  } else if (p === 'year' || p === 'y') {
    start.setMonth(0, 1);
  }
  return { start, end: now, label: p };
}

function isClosedStage(stage) {
  const s = stage.toLowerCase();
  return s.includes('won') || s.includes('lost') || s.includes('disqualif') || s.includes('closed');
}

// ── Data Fetching ────────────────────────────────────────────────────

async function fetchAllDeals() {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await attioRequest('/v2/objects/deals/records/query', {
      method: 'POST',
      body: JSON.stringify({ limit: 100, offset }),
    });
    const batch = data?.data || [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

async function fetchAllCompanies() {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await attioRequest('/v2/objects/companies/records/query', {
      method: 'POST',
      body: JSON.stringify({ limit: 100, offset }),
    });
    const batch = data?.data || [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return all;
}

function buildCompanyLookup(companies) {
  const map = new Map();
  for (const c of companies) {
    const id = c?.id?.record_id;
    const name = c?.values?.name?.[0]?.value;
    if (id && name) map.set(id, name);
  }
  return map;
}

// ── Shared deal normalisation ────────────────────────────────────────

function normaliseDeal(r, companyLookup) {
  const value = getValue(r);
  const companyId = getCompanyId(r);
  return {
    id: r?.id?.record_id,
    name: getName(r),
    stage: getStage(r),
    stageChangedAt: getStageChanged(r),
    companyId,
    company: companyId ? companyLookup?.get(companyId) || null : null,
    owner: getOwnerId(r),
    value: value.amount,
    currency: value.currency,
    createdAt: getCreatedAt(r),
    companyStage: getCompanyStage(r),
    webUrl: r?.web_url || null,
    daysSinceCreation: daysSince(getCreatedAt(r)),
    daysSinceStageChange: daysSince(getStageChanged(r)),
    hoursSinceStageChange: hoursSince(getStageChanged(r)),
    isClosed: isClosedStage(getStage(r)),
  };
}

// ── Mode: Snapshot ───────────────────────────────────────────────────

function modeSnapshot(deals, opts) {
  const byStage = new Map();
  let totalValue = 0;
  let currency = 'EUR';

  for (const d of deals) {
    totalValue += d.value;
    currency = d.currency || currency;
    if (!byStage.has(d.stage)) byStage.set(d.stage, { stage: d.stage, count: 0, totalValue: 0, deals: [] });
    const bucket = byStage.get(d.stage);
    bucket.count++;
    bucket.totalValue += d.value;
    bucket.deals.push(d);
  }

  const stages = [...byStage.values()]
    .sort((a, b) => b.totalValue - a.totalValue)
    .map(s => ({ ...s, deals: s.deals.sort((a, b) => b.value - a.value) }));

  const result = { totalDeals: deals.length, totalValue, currency, stages };
  if (opts.json) return result;

  const lines = [
    `*Pipeline Snapshot*`,
    `${result.totalDeals} deals · ${fmtMoney(result.totalValue, result.currency)} total`,
    '',
  ];
  for (const s of stages) {
    lines.push(`*${s.stage}* — ${s.count} deal${s.count === 1 ? '' : 's'} · ${fmtMoney(s.totalValue, result.currency)}`);
    for (const d of s.deals.slice(0, 8)) {
      const label = d.company && d.company !== d.name ? `${d.name} (${d.company})` : d.name;
      lines.push(`  • ${label} · ${fmtMoney(d.value, d.currency)}`);
    }
    if (s.deals.length > 8) lines.push(`  ... ${s.deals.length - 8} more`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ── Mode: Stale ──────────────────────────────────────────────────────

function modeStale(deals, opts) {
  const days = opts.days || 14;
  const excluded = new Set(opts.exclude || []);

  const stale = deals
    .filter(d => !d.isClosed && !excluded.has(d.stage))
    .filter(d => d.daysSinceStageChange !== null && d.daysSinceStageChange >= days)
    .sort((a, b) => b.daysSinceStageChange - a.daysSinceStageChange || b.value - a.value);

  const result = { minDays: days, count: stale.length, deals: stale };
  if (opts.json) return result;

  if (stale.length === 0) return `No deals stuck for ${days}+ days.`;

  const lines = [
    `*Stale Deals* (${days}+ days without stage change)`,
    `${stale.length} deal${stale.length === 1 ? '' : 's'}`,
    '',
  ];
  for (const d of stale) {
    const label = d.company ? `${d.name} (${d.company})` : d.name;
    lines.push(`• ${label} · ${d.stage} · ${fmtMoney(d.value, d.currency)} · ${d.daysSinceStageChange}d in stage`);
  }
  return lines.join('\n').trim();
}

// ── Mode: Forecast ───────────────────────────────────────────────────

function modeForecast(deals, opts) {
  const period = parsePeriod(opts.period);
  const openDeals = deals.filter(d => !d.isClosed);

  // Stage probability weights (configurable per workspace)
  const stageWeights = {
    'lead': 0.1,
    'live': 0.4,
    // Won/Disqualified don't matter — they're closed
  };

  // Weighted pipeline
  let weightedValue = 0;
  let totalOpenValue = 0;
  const byStage = new Map();

  for (const d of openDeals) {
    totalOpenValue += d.value;
    const weight = stageWeights[d.stage.toLowerCase()] || 0.2; // default 20%
    weightedValue += d.value * weight;
    if (!byStage.has(d.stage)) byStage.set(d.stage, { stage: d.stage, count: 0, value: 0, weighted: 0 });
    const b = byStage.get(d.stage);
    b.count++;
    b.value += d.value;
    b.weighted += d.value * weight;
  }

  // Deals created this period
  const createdThisPeriod = deals.filter(d => {
    if (!d.createdAt) return false;
    return new Date(d.createdAt) >= period.start && new Date(d.createdAt) <= period.end;
  });

  // Recently closed won this period
  const wonThisPeriod = deals.filter(d => {
    if (!d.stage.toLowerCase().includes('won')) return false;
    if (!d.stageChangedAt) return false;
    return new Date(d.stageChangedAt) >= period.start;
  });

  const result = {
    period: period.label,
    totalOpenValue,
    weightedValue,
    openDealCount: openDeals.length,
    createdThisPeriod: createdThisPeriod.length,
    createdValue: createdThisPeriod.reduce((s, d) => s + d.value, 0),
    wonThisPeriod: wonThisPeriod.length,
    wonValue: wonThisPeriod.reduce((s, d) => s + d.value, 0),
    stages: [...byStage.values()].sort((a, b) => b.value - a.value),
  };

  if (opts.json) return result;

  const lines = [
    `*Pipeline Forecast* (${period.label})`,
    '',
    `Open pipeline: ${fmtMoney(totalOpenValue)} across ${openDeals.length} deals`,
    `Weighted value: ${fmtMoney(weightedValue)}`,
    '',
    `*This ${period.label}:*`,
    `• New deals: ${createdThisPeriod.length} (${fmtMoney(result.createdValue)})`,
    `• Closed won: ${wonThisPeriod.length} (${fmtMoney(result.wonValue)})`,
    '',
    `*By stage:*`,
  ];
  for (const s of result.stages) {
    const w = stageWeights[s.stage.toLowerCase()] || 0.2;
    lines.push(`  ${s.stage}: ${s.count} deals · ${fmtMoney(s.value)} · ${Math.round(w * 100)}% → ${fmtMoney(s.weighted)}`);
  }
  return lines.join('\n').trim();
}

// ── Mode: Health ─────────────────────────────────────────────────────

function modeHealth(deals, opts) {
  const openDeals = deals.filter(d => !d.isClosed);
  const issues = [];

  for (const d of openDeals) {
    const dealIssues = [];

    if (d.value === 0 || d.value === null) dealIssues.push('no value set');
    if (!d.company) dealIssues.push('no company linked');
    if (!d.companyStage) dealIssues.push('no company stage');
    if (d.daysSinceStageChange !== null && d.daysSinceStageChange >= 30) dealIssues.push(`stale ${d.daysSinceStageChange}d in stage`);

    if (dealIssues.length > 0) {
      issues.push({ ...d, issues: dealIssues });
    }
  }

  issues.sort((a, b) => b.value - a.value);

  const result = { totalOpen: openDeals.length, unhealthyCount: issues.length, deals: issues };
  if (opts.json) return result;

  if (issues.length === 0) return `All ${openDeals.length} open deals look healthy ✓`;

  const lines = [
    `*Deal Health Check*`,
    `${issues.length} of ${openDeals.length} open deals have issues`,
    '',
  ];
  for (const d of issues) {
    const label = d.company ? `${d.name} (${d.company})` : d.name;
    lines.push(`• ${label} · ${d.stage} · ${fmtMoney(d.value, d.currency)}`);
    lines.push(`  ⚠ ${d.issues.join(', ')}`);
  }
  return lines.join('\n').trim();
}

// ── Mode: Win/Loss ───────────────────────────────────────────────────

function modeWinLoss(deals, opts) {
  const period = parsePeriod(opts.period);

  const won = deals.filter(d => {
    if (!d.stage.toLowerCase().includes('won')) return false;
    if (!d.stageChangedAt) return false;
    return new Date(d.stageChangedAt) >= period.start;
  });

  const lost = deals.filter(d => {
    const s = d.stage.toLowerCase();
    if (!s.includes('disqualif') && !s.includes('lost') && !s.includes('closed')) return false;
    if (!d.stageChangedAt) return false;
    return new Date(d.stageChangedAt) >= period.start;
  });

  const wonValue = won.reduce((s, d) => s + d.value, 0);
  const lostValue = lost.reduce((s, d) => s + d.value, 0);
  const winRate = (won.length + lost.length) > 0
    ? Math.round((won.length / (won.length + lost.length)) * 100)
    : 0;
  const avgWon = won.length > 0 ? Math.round(wonValue / won.length) : 0;
  const avgLost = lost.length > 0 ? Math.round(lostValue / lost.length) : 0;

  const result = {
    period: period.label,
    won: { count: won.length, value: wonValue, avgSize: avgWon },
    lost: { count: lost.length, value: lostValue, avgSize: avgLost },
    winRate,
    netValue: wonValue - lostValue,
  };

  if (opts.json) return result;

  const lines = [
    `*Win/Loss Analysis* (${period.label})`,
    '',
    `Won: ${won.length} deals · ${fmtMoney(wonValue)} · avg ${fmtMoney(avgWon)}`,
    `Lost: ${lost.length} deals · ${fmtMoney(lostValue)} · avg ${fmtMoney(avgLost)}`,
    `Win rate: ${winRate}%`,
    `Net: ${fmtMoney(result.netValue)}`,
  ];

  if (won.length > 0) {
    lines.push('', `*Won deals:*`);
    for (const d of won.sort((a, b) => b.value - a.value)) {
      const label = d.company ? `${d.name} (${d.company})` : d.name;
      lines.push(`  ✅ ${label} · ${fmtMoney(d.value, d.currency)}`);
    }
  }

  if (lost.length > 0) {
    lines.push('', `*Lost deals:*`);
    for (const d of lost.sort((a, b) => b.value - a.value)) {
      const label = d.company ? `${d.name} (${d.company})` : d.name;
      lines.push(`  ❌ ${label} · ${fmtMoney(d.value, d.currency)}`);
    }
  }

  return lines.join('\n').trim();
}

// ── Mode: Hygiene ────────────────────────────────────────────────────

function modeHygiene(deals, opts) {
  const openDeals = deals.filter(d => !d.isClosed);
  const issues = {
    noValue: [],
    noCompany: [],
    noOwner: [],
    zombies: [],
    firstStageDwellers: [],
  };

  const stages = [...new Set(deals.map(d => d.stage))];
  // Heuristic: first stage is the one with the oldest created_at that isn't closed
  const nonClosedStages = stages.filter(s => !isClosedStage(s));
  const firstStage = nonClosedStages.length > 0 ? nonClosedStages[0] : null;

  for (const d of openDeals) {
    if (d.value === 0) issues.noValue.push(d);
    if (!d.company) issues.noCompany.push(d);
    if (!d.owner) issues.noOwner.push(d);
    if (d.daysSinceCreation !== null && d.daysSinceCreation >= 90) issues.zombies.push(d);
    if (firstStage && d.stage === firstStage && d.daysSinceStageChange !== null && d.daysSinceStageChange >= 21) {
      issues.firstStageDwellers.push(d);
    }
  }

  const result = {
    totalOpen: openDeals.length,
    noValue: issues.noValue.length,
    noCompany: issues.noCompany.length,
    noOwner: issues.noOwner.length,
    zombies: issues.zombies.length,
    firstStageDwellers: issues.firstStageDwellers.length,
    deals: { noValue: issues.noValue, noCompany: issues.noCompany, noOwner: issues.noOwner, zombies: issues.zombies, firstStageDwellers: issues.firstStageDwellers },
  };

  if (opts.json) return result;

  const totalIssues = result.noValue + result.noCompany + result.noOwner + result.zombies + result.firstStageDwellers;
  if (totalIssues === 0) return `Pipeline hygiene looks clean ✓ (${openDeals.length} open deals)`;

  const lines = [
    `*Pipeline Hygiene*`,
    `${totalIssues} issues across ${openDeals.length} open deals`,
    '',
  ];

  function listSection(title, list) {
    if (list.length === 0) return;
    lines.push(`*${title}* (${list.length})`);
    for (const d of list.sort((a, b) => b.value - a.value).slice(0, 10)) {
      const label = d.company ? `${d.name} (${d.company})` : d.name;
      lines.push(`  • ${label} · ${d.stage} · ${fmtMoney(d.value, d.currency)}`);
    }
    if (list.length > 10) lines.push(`  ... ${list.length - 10} more`);
    lines.push('');
  }

  listSection('No value set', issues.noValue);
  listSection('No company linked', issues.noCompany);
  listSection('No owner', issues.noOwner);
  listSection('Zombies (90+ days old)', issues.zombies);
  listSection(`Stuck in ${firstStage} (21+ days)`, issues.firstStageDwellers);

  return lines.join('\n').trim();
}

// ── Mode: Movements ──────────────────────────────────────────────────

function modeMovements(deals, opts) {
  const days = opts.days || 7;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

  const moved = deals
    .filter(d => d.stageChangedAt && new Date(d.stageChangedAt).getTime() >= cutoff)
    .sort((a, b) => new Date(b.stageChangedAt).getTime() - new Date(a.stageChangedAt).getTime());

  const byStage = new Map();
  for (const d of moved) {
    if (!byStage.has(d.stage)) byStage.set(d.stage, { stage: d.stage, count: 0, totalValue: 0, deals: [] });
    const b = byStage.get(d.stage);
    b.count++;
    b.totalValue += d.value;
    b.deals.push(d);
  }

  const result = { days, count: moved.length, changes: moved };
  if (opts.json) return result;

  if (moved.length === 0) return `No stage changes in the last ${days} days.`;

  const lines = [
    `*Stage Movements* (last ${days} days)`,
    `${moved.length} deal${moved.length === 1 ? '' : 's'} moved stage`,
    '',
  ];

  for (const group of [...byStage.values()].sort((a, b) => b.totalValue - a.totalValue)) {
    lines.push(`*${group.stage}* — ${group.count} deal${group.count === 1 ? '' : 's'} · ${fmtMoney(group.totalValue)}`);
    for (const d of group.deals) {
      const label = d.company ? `${d.name} (${d.company})` : d.name;
      const when = d.hoursSinceStageChange !== null ? `${Math.max(0, Math.round(d.hoursSinceStageChange))}h ago` : '';
      const name = d.webUrl ? `<${d.webUrl}|${label}>` : label;
      lines.push(`  • ${name} · ${fmtMoney(d.value, d.currency)} · ${when}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

// ── Help Mode ────────────────────────────────────────────────────────

function modeHelp() {
  return {
    name: 'pipeline-query',
    description: 'Unified Attio pipeline query tool with fuzzy matching',
    modes: [
      { mode: 'snapshot', description: 'Pipeline overview grouped by stage', flags: ['--stage <name>', '--exclude <name>', '--json'] },
      { mode: 'stale', description: 'Deals that haven\'t moved stage in N days', flags: ['--days=N (default: 14)', '--exclude <name>', '--json'] },
      { mode: 'forecast', description: 'Weighted pipeline, new deals, closed won this period', flags: ['--period=week|month|quarter|year', '--json'] },
      { mode: 'health', description: 'Deals at risk (no value, no company, stale)', flags: ['--json'] },
      { mode: 'win-loss', description: 'Closed won/lost analysis', flags: ['--period=week|month|quarter|year', '--json'] },
      { mode: 'hygiene', description: 'Data quality issues (missing fields, zombies)', flags: ['--json'] },
      { mode: 'movements', description: 'Recent stage changes', flags: ['--days=N (default: 7)', '--json'] },
    ],
    globalFlags: [
      '--json',
      '--refresh-schema',
      '--help',
    ],
    fuzzyMatching: {
      description: 'Stage names, company stages, and other filter values are fuzzy-matched against the cached schema. Typos and partial matches are handled automatically.',
      examples: [
        { input: 'won', matches: 'Won 🎉' },
        { input: 'disqulified', matches: 'Disqualified' },
        { input: 'lead', matches: 'Lead' },
      ],
    },
    intentMap: [
      { userSays: 'pipeline overview / total value / show me the pipeline', use: '--mode snapshot' },
      { userSays: 'stuck deals / aging deals / not moving', use: '--mode stale' },
      { userSays: 'forecast / weighted pipeline / closing this month', use: '--mode forecast' },
      { userSays: 'deal health / at risk / missing data', use: '--mode health' },
      { userSays: 'win rate / won vs lost / closed deals', use: '--mode win-loss' },
      { userSays: 'data quality / missing fields / clean up', use: '--mode hygiene' },
      { userSays: 'recent changes / stage movements / what moved', use: '--mode movements' },
    ],
  };
}

// ── Argument Parsing ─────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    mode: null,
    json: false,
    refreshSchema: false,
    stage: null,
    exclude: [],
    days: null,
    period: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--refresh-schema') opts.refreshSchema = true;
    else if (arg === '--help' || arg === '-h') opts.mode = 'help';
    else if (arg === '--mode' && args[i + 1]) opts.mode = args[++i];
    else if (arg === '--stage' && args[i + 1]) opts.stage = args[++i];
    else if (arg === '--exclude' && args[i + 1]) opts.exclude.push(args[++i]);
    else if (arg === '--days' && args[i + 1]) opts.days = parseInt(args[++i], 10);
    else if (arg === '--period' && args[i + 1]) opts.period = args[++i];
    else if (!opts.mode && !arg.startsWith('--')) opts.mode = arg; // positional mode
  }

  return opts;
}

// ── Main ─────────────────────────────────────────────────────────────

const opts = parseArgs();

// Handle help and schema refresh immediately
if (opts.mode === 'help' || (!opts.mode && !opts.refreshSchema)) {
  console.log(JSON.stringify(modeHelp(), null, 2));
  process.exit(0);
}

if (opts.refreshSchema) {
  try {
    const schema = await refreshSchema();
    console.log(JSON.stringify({ ok: true, message: 'Schema refreshed', meta: schema.meta }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err.message || err) }, null, 2));
    process.exit(1);
  }
  process.exit(0);
}

// Validate mode
const validModes = ['snapshot', 'stale', 'forecast', 'health', 'win-loss', 'hygiene', 'movements'];
const modeMatch = fuzzyMatch(opts.mode, validModes);
if (!modeMatch) {
  console.error(JSON.stringify({
    ok: false,
    error: `Unknown mode "${opts.mode}". Valid modes: ${validModes.join(', ')}`,
  }, null, 2));
  process.exit(1);
}
opts.mode = modeMatch.match;

try {
  // Load schema for fuzzy matching (used by stage/exclude filters)
  const schema = await loadSchema();
  const stageNames = schema.stageOptions.map(s => s.title);

  // Resolve stage filter via fuzzy match
  if (opts.stage) {
    const match = fuzzyMatch(opts.stage, stageNames);
    if (!match) {
      console.error(JSON.stringify({
        ok: false,
        error: `No stage matching "${opts.stage}". Available: ${stageNames.join(', ')}`,
      }, null, 2));
      process.exit(1);
    }
    opts.stage = match.match;
  }

  // Resolve exclude filters via fuzzy match
  if (opts.exclude.length > 0) {
    const resolved = fuzzyMatchMultiple(opts.exclude, stageNames);
    const errors = resolved.filter(r => !r.match);
    if (errors.length > 0) {
      console.error(JSON.stringify({
        ok: false,
        error: `Could not match exclude values: ${errors.map(e => e.error).join('; ')}`,
      }, null, 2));
      process.exit(1);
    }
    opts.exclude = resolved.map(r => r.match);
  }

  // Fetch data
  const [dealsRaw, companiesRaw] = await Promise.all([
    fetchAllDeals(),
    fetchAllCompanies(),
  ]);
  const companyLookup = buildCompanyLookup(companiesRaw);
  const deals = dealsRaw.map(r => normaliseDeal(r, companyLookup));

  // Apply stage filter to all modes
  let filteredDeals = deals;
  if (opts.stage) {
    filteredDeals = filteredDeals.filter(d => d.stage === opts.stage);
  }
  if (opts.exclude.length > 0) {
    const excludeSet = new Set(opts.exclude);
    filteredDeals = filteredDeals.filter(d => !excludeSet.has(d.stage));
  }

  // Run the selected mode
  let result;
  switch (opts.mode) {
    case 'snapshot':   result = modeSnapshot(filteredDeals, opts); break;
    case 'stale':      result = modeStale(filteredDeals, opts); break;
    case 'forecast':   result = modeForecast(filteredDeals, opts); break;
    case 'health':     result = modeHealth(filteredDeals, opts); break;
    case 'win-loss':   result = modeWinLoss(filteredDeals, opts); break;
    case 'hygiene':    result = modeHygiene(filteredDeals, opts); break;
    case 'movements':  result = modeMovements(filteredDeals, opts); break;
    default:
      console.error(JSON.stringify({ ok: false, error: `Unhandled mode: ${opts.mode}` }, null, 2));
      process.exit(1);
  }

  console.log(opts.json && typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
