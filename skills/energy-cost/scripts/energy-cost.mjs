#!/usr/bin/env node
// energy-cost.mjs — Calculate energy costs from kWh readings using configurable tariff bands.
// Zero dependencies. Node.js 18+.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Default tariff (Irish residential-style) ──
const DEFAULT_TARIFF = {
  currency: "EUR",
  currencySymbol: "€",
  bands: [
    { name: "night",  rate: 0.2463, startHour: 23, endHour: 8 },
    { name: "day",    rate: 0.3833, startHour: 8,  endHour: 17 },
    { name: "peak",   rate: 0.4293, startHour: 17, endHour: 19 },
    { name: "day",    rate: 0.3833, startHour: 19, endHour: 23 },
  ],
  standingCharge: 0, // per day, 0 = not included
};

// ── Args ──
function parseArgs(argv) {
  const args = {
    kwh: [],
    json: false,
    quiet: false,
    tariffFile: null,
    from: null,
    to: null,
    period: null,
    flatRate: null,
    _help: false,
    _version: false,
  };

  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--json") { args.json = true; }
    else if (a === "--quiet" || a === "-q") { args.quiet = true; }
    else if (a === "--tariff" || a === "-t") { args.tariffFile = argv[++i]; }
    else if (a === "--from") { args.from = argv[++i]; }
    else if (a === "--to") { args.to = argv[++i]; }
    else if (a === "--period" || a === "-p") { args.period = argv[++i]; }
    else if (a === "--flat-rate" || a === "-f") { args.flatRate = parseFloat(argv[++i]); }
    else if (a === "--help" || a === "-h") { args._help = true; }
    else if (a === "--version" || a === "-v") { args._version = true; }
    else if (!a.startsWith("-") && !isNaN(parseFloat(a))) { args.kwh.push(parseFloat(a)); }
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
    i++;
  }
  return args;
}

// ── Tariff loading ──
function loadTariff(filePath) {
  if (!filePath) return DEFAULT_TARIFF;
  if (!existsSync(filePath)) {
    console.error(`Tariff file not found: ${filePath}`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return {
    currency: raw.currency || "EUR",
    currencySymbol: raw.currencySymbol || "€",
    bands: raw.bands || [],
    standingCharge: raw.standingCharge || 0,
  };
}

// ── Resolve a tariff file relative to script dir ──
function resolveTariffFile(arg) {
  if (!arg) return null;
  if (existsSync(arg)) return arg;
  const relative = join(__dirname, "..", arg);
  if (existsSync(relative)) return relative;
  return arg; // let loadTariff handle the error
}

// ── Rate for a given hour ──
function rateForHour(tariff, hour) {
  for (const band of tariff.bands) {
    if (band.startHour < band.endHour) {
      if (hour >= band.startHour && hour < band.endHour) return { rate: band.rate, name: band.name };
    } else {
      // wraps midnight (e.g. 23-8)
      if (hour >= band.startHour || hour < band.endHour) return { rate: band.rate, name: band.name };
    }
  }
  return { rate: tariff.bands[0]?.rate || 0, name: "unknown" };
}

// ── Parse time string ──
function parseTime(str) {
  // Accept HH:MM or HH
  const parts = str.split(":");
  return {
    hour: parseInt(parts[0], 10),
    minute: parts[1] ? parseInt(parts[1], 10) : 0,
  };
}

// ── Calculate cost for a single reading ──
function calcReading(tariff, kwh, hour, minute = 0) {
  const { rate, name } = rateForHour(tariff, hour);
  const cost = kwh * rate;
  return { kwh, rate, name, cost, hour, minute };
}

// ── Calculate cost for a range (simple: split evenly across hours in range) ──
function calcRange(tariff, kwh, fromHour, fromMinute, toHour, toMinute) {
  const from = fromHour * 60 + fromMinute;
  const to = toHour * 60 + toMinute;
  let totalMinutes = to > from ? to - from : (1440 - from) + to;
  if (totalMinutes <= 0) totalMinutes = 1440; // full day fallback

  const kwhPerMinute = kwh / totalMinutes;
  const breakdown = {};
  let totalCost = 0;

  for (let m = 0; m < totalMinutes; m++) {
    const absMin = (from + m) % 1440;
    const h = Math.floor(absMin / 60);
    const { rate, name } = rateForHour(tariff, h);
    if (!breakdown[name]) breakdown[name] = { kwh: 0, cost: 0, minutes: 0, rate };
    breakdown[name].kwh += kwhPerMinute;
    breakdown[name].cost += kwhPerMinute * rate;
    breakdown[name].minutes++;
    totalCost += kwhPerMinute * rate;
  }

  return { totalKwh: kwh, totalCost, breakdown, totalMinutes };
}

// ── Resolve preset periods ──
function resolvePeriod(period) {
  const presets = {
    "day":     { from: "00:00", to: "23:59" },
    "night":   { from: "23:00", to: "07:59" },
    "morning": { from: "08:00", to: "11:59" },
    "afternoon": { from: "12:00", to: "16:59" },
    "peak":    { from: "17:00", to: "18:59" },
    "evening": { from: "19:00", to: "22:59" },
  };
  const key = period.toLowerCase();
  if (presets[key]) return presets[key];
  return null;
}

// ── Format currency ──
function fmtCurrency(val, sym) {
  return `${sym}${val.toFixed(2)}`;
}

// ── Main ──
function main() {
  const args = parseArgs(process.argv);

  if (args._version) {
    console.log("energy-cost 1.0.0");
    process.exit(0);
  }

  if (args._help) {
    console.log(`energy-cost — Calculate energy costs from kWh readings

Usage:
  energy-cost <kwh> [--from HH:MM] [--to HH:MM] [--period <name>]
  energy-cost <kwh> --flat-rate <rate>
  energy-cost --period <name> <kwh>

Arguments:
  kwh                     One or more kWh values to cost

Options:
  --from HH:MM            Start time for time-of-use calculation
  --to HH:MM              End time for time-of-use calculation
  --period, -p <name>     Preset period: day, night, morning, afternoon, peak, evening
  --flat-rate, -f <rate>  Use a single flat rate (€/kWh) instead of tariff bands
  --tariff, -t <file>     Load tariff from JSON file (relative to skill dir or absolute)
  --json                  Output JSON
  --quiet, -q             Quiet mode: only output the total cost
  --help, -h              Show this help
  --version, -v           Show version

Examples:
  energy-cost 3.5 --from 14:00 --to 16:30
  energy-cost 12.3 --period night
  energy-cost 5.0 --flat-rate 0.35
  energy-cost 2.1 4.7 1.3 --from 09:00 --to 15:00
  energy-cost 8.2 --period day --json

Tariff file format (JSON):
  {
    "currency": "EUR",
    "currencySymbol": "€",
    "bands": [
      { "name": "night", "rate": 0.2463, "startHour": 23, "endHour": 8 },
      { "name": "day",   "rate": 0.3833, "startHour": 8,  "endHour": 17 },
      { "name": "peak",  "rate": 0.4293, "startHour": 17, "endHour": 19 },
      { "name": "day",   "rate": 0.3833, "startHour": 19, "endHour": 23 }
    ],
    "standingCharge": 0.55
  }

Without --from/--to/--period: treats each kWh reading as instantaneous at the current hour.`);
    process.exit(0);
  }

  const tariffFile = resolveTariffFile(args.tariffFile);
  const tariff = args.flatRate != null
    ? { ...DEFAULT_TARIFF, bands: [{ name: "flat", rate: args.flatRate, startHour: 0, endHour: 24 }] }
    : loadTariff(tariffFile);
  const sym = tariff.currencySymbol;

  // Resolve preset period
  if (args.period && !args.from && !args.to) {
    const preset = resolvePeriod(args.period);
    if (!preset) {
      console.error(`Unknown period: ${args.period}. Use: day, night, morning, afternoon, peak, evening`);
      process.exit(1);
    }
    args.from = preset.from;
    args.to = preset.to;
  }

  // No kWh provided — show current tariff summary
  if (args.kwh.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ currency: tariff.currency, symbol: sym, bands: tariff.bands, standingCharge: tariff.standingCharge }, null, 2));
    } else if (!args.quiet) {
      console.log(`⚡ Energy Tariff (${tariff.currency})`);
      console.log("");
      const seen = new Set();
      for (const band of tariff.bands) {
        if (seen.has(band.name)) continue;
        seen.add(band.name);
        const hours = tariff.bands.filter(b => b.name === band.name).map(b => `${b.startHour}:00–${b.endHour}:00`);
        console.log(`  ${band.name.padEnd(12)} ${fmtCurrency(band.rate, sym)}/kWh  (${hours.join(", ")})`);
      }
      if (tariff.standingCharge > 0) {
        console.log(`  standing     ${fmtCurrency(tariff.standingCharge, sym)}/day`);
      }
    }
    process.exit(0);
  }

  // Mode: time range calculation
  if (args.from && args.to) {
    const f = parseTime(args.from);
    const t = parseTime(args.to);
    const results = [];
    let grandKwh = 0, grandCost = 0;

    for (const kwh of args.kwh) {
      const r = calcRange(tariff, kwh, f.hour, f.minute, t.hour, t.minute);
      results.push(r);
      grandKwh += r.totalKwh;
      grandCost += r.totalCost;
    }

    if (args.json) {
      console.log(JSON.stringify({ totalKwh: grandKwh, totalCost: grandCost, currency: sym, readings: results }, null, 2));
    } else if (args.quiet) {
      console.log(fmtCurrency(grandCost, sym));
    } else {
      // Merge breakdowns across readings
      const merged = {};
      for (const r of results) {
        for (const [name, data] of Object.entries(r.breakdown)) {
          if (!merged[name]) merged[name] = { kwh: 0, cost: 0, minutes: 0, rate: data.rate };
          merged[name].kwh += data.kwh;
          merged[name].cost += data.cost;
          merged[name].minutes += data.minutes;
        }
      }

      console.log(`⚡ Energy Cost (${args.from} – ${args.to})`);
      console.log("");
      for (const [name, data] of Object.entries(merged)) {
        const pct = grandKwh > 0 ? ((data.kwh / grandKwh) * 100).toFixed(0) : 0;
        console.log(`  ${name.padEnd(12)} ${data.kwh.toFixed(2).padStart(8)} kWh  ${fmtCurrency(data.cost, sym).padStart(8)}  (${fmtCurrency(data.rate, sym)}/kWh, ${pct}%)`);
      }
      console.log("");
      console.log(`  ${"total".padEnd(12)} ${grandKwh.toFixed(2).padStart(8)} kWh  ${fmtCurrency(grandCost, sym).padStart(8)}`);
      if (tariff.standingCharge > 0) {
        console.log(`  ${"standing".padEnd(12)} ${"".padEnd(8)}     ${fmtCurrency(tariff.standingCharge, sym).padStart(8)}`);
        console.log(`  ${"grand total".padEnd(12)} ${"".padEnd(8)}     ${fmtCurrency(grandCost + tariff.standingCharge, sym).padStart(8)}`);
      }
    }
    process.exit(0);
  }

  // Mode: instantaneous (current hour or no time context)
  const now = new Date();
  const currentHour = now.getHours();
  const results = [];
  let grandKwh = 0, grandCost = 0;

  for (const kwh of args.kwh) {
    const r = calcReading(tariff, kwh, currentHour);
    results.push(r);
    grandKwh += r.kwh;
    grandCost += r.cost;
  }

  if (args.json) {
    console.log(JSON.stringify({ totalKwh: grandKwh, totalCost: grandCost, currency: sym, hour: currentHour, band: results[0]?.name, readings: results }, null, 2));
  } else if (args.quiet) {
    console.log(fmtCurrency(grandCost, sym));
  } else {
    const band = results[0]?.name || "unknown";
    const rate = results[0]?.rate || 0;
    console.log(`⚡ Energy Cost (current: ${band} @ ${fmtCurrency(rate, sym)}/kWh, ${currentHour}:00)`);
    console.log("");
    if (args.kwh.length === 1) {
      console.log(`  ${grandKwh.toFixed(2).padStart(8)} kWh × ${fmtCurrency(rate, sym)} = ${fmtCurrency(grandCost, sym)}`);
    } else {
      for (const r of results) {
        console.log(`  ${r.kwh.toFixed(2).padStart(8)} kWh × ${fmtCurrency(r.rate, sym)} = ${fmtCurrency(r.cost, sym)}`);
      }
      console.log("");
      console.log(`  Total: ${grandKwh.toFixed(2)} kWh = ${fmtCurrency(grandCost, sym)}`);
    }
  }
}

main();
