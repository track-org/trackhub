#!/usr/bin/env node
// energy-summary.cjs — Combined daily energy report: Solis + Emporia + tariff cost.
// Zero external dependencies. Node.js 18+.
// Calls solis_status.py and query_emporia_vendor.mjs as subprocesses.

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Resolve paths ──
const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.dirname(SCRIPT_DIR);
const TRACKHUB_SKILLS = path.dirname(SKILL_DIR);
const WORKSPACE = path.dirname(path.dirname(TRACKHUB_SKILLS));

const SOLIS_SCRIPT = path.join(TRACKHUB_SKILLS, "solis-energy", "scripts", "solis_status.py");
const EMPORIA_SCRIPT = path.join(TRACKHUB_SKILLS, "emporia-energy", "scripts", "query_emporia_vendor.mjs");

// ── Tariff (same as energy-cost / TOOLS.md) ──
const TARIFF_BANDS = [
  { name: "night", rate: 0.2463, startHour: 23, endHour: 8 },
  { name: "day",   rate: 0.3833, startHour: 8,  endHour: 17 },
  { name: "peak",  rate: 0.4293, startHour: 17, endHour: 19 },
  { name: "day",   rate: 0.3833, startHour: 19, endHour: 23 },
];

function rateForHour(hour) {
  for (const band of TARIFF_BANDS) {
    if (band.startHour < band.endHour) {
      if (hour >= band.startHour && hour < band.endHour) return band.rate;
    } else {
      if (hour >= band.startHour || hour < band.endHour) return band.rate;
    }
  }
  return TARIFF_BANDS[0].rate;
}

// Average tariff rate across a day (weighted by hours per band)
function avgDayRate() {
  // night: 23-8 = 9h @ 0.2463, day: 8-17 = 9h + 19-23 = 4h = 13h @ 0.3833, peak: 17-19 = 2h @ 0.4293
  const night = 9 * 0.2463;
  const day = 13 * 0.3833;
  const peak = 2 * 0.4293;
  return (night + day + peak) / 24;
}

const AVG_RATE = avgDayRate();

// ── Args ──
function parseArgs(argv) {
  const args = {
    period: "today",
    date: null,
    json: false,
    compact: false,
    solarOnly: false,
    exportRate: null,
    quiet: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "today") { args.period = "today"; }
    else if (a === "yesterday") { args.period = "yesterday"; }
    else if (a === "--date" || a === "-d") { args.date = argv[++i]; args.period = "date"; }
    else if (a === "--json" || a === "-j") { args.json = true; }
    else if (a === "--compact" || a === "-c") { args.compact = true; }
    else if (a === "--solar-only" || a === "--no-emporia") { args.solarOnly = true; }
    else if (a === "--export-rate") { args.exportRate = parseFloat(argv[++i]); }
    else if (a === "--quiet" || a === "-q") { args.quiet = true; }
    else if (a === "--help" || a === "-h") { args.help = true; }
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
    i++;
  }
  return args;
}

function showHelp() {
  console.log(`energy-summary — Combined daily energy report

Usage:
  energy-summary today [options]
  energy-summary yesterday [options]
  energy-summary --date YYYY-MM-DD [options]

Options:
  --json, -j          JSON output
  --compact, -c       One-line compact summary
  --solar-only        Skip Emporia, solar-only report
  --export-rate <€>   Fixed export credit rate (default: average import rate)
  --quiet, -q         Only output net cost
  --help, -h          Show this help`);
  process.exit(0);
}

// ── Run subprocess ──
function run(cmd, label) {
  try {
    const result = execSync(cmd, { timeout: 30000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true, data: result.trim() };
  } catch (err) {
    const stderr = err.stderr?.trim() || err.message;
    return { ok: false, error: stderr, label };
  }
}

// ── Format helpers ──
function fmtEuro(val) {
  return `€${val.toFixed(2)}`;
}

function fmtKwh(val) {
  return `${val.toFixed(1)} kWh`;
}

function fmtPct(val) {
  return `${Math.round(val)}%`;
}

function dateForDisplay(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// ── Main ──
function main() {
  const args = parseArgs(process.argv);
  if (args.help) showHelp();

  const solisCmd = args.period === "yesterday" ? "yesterday" : args.period === "date" ? "today" : "today";

  // 1. Fetch Solis data
  const solisResult = run(`python3 "${SOLIS_SCRIPT}" ${solisCmd}`, "Solis");
  let solis = null;
  if (solisResult.ok) {
    try {
      solis = JSON.parse(solisResult.data);
    } catch (_) { /* ignore parse failure */ }
  }

  // 2. Fetch Emporia data (unless --solar-only)
  let emporiaTotalKwh = null;
  if (!args.solarOnly) {
    const range = (args.period === "yesterday") ? "yesterday" : "today";
    const emporiaResult = run(`node "${EMPORIA_SCRIPT}" energy --range ${range}`, "Emporia");
    if (emporiaResult.ok) {
      try {
        const emporiaData = JSON.parse(emporiaResult.data);
        // Extract total kWh from the energy data
        const flat = emporiaData.flatEnergy || [];
        let total = 0;
        for (const entry of flat) {
          if (entry.value !== undefined && entry.value !== null) {
            total += parseFloat(entry.value) || 0;
          }
        }
        if (total > 0) emporiaTotalKwh = total;
      } catch (_) { /* ignore parse failure */ }
    }
  }

  // 3. Calculate
  const generated = solis?.generation_kwh || 0;
  const exported = solis?.grid_sold_kwh || 0;
  const gridImport = solis?.grid_purchased_kwh || 0;
  const selfConsumed = generated - exported; // what solar covered locally
  const selfConsumedPct = generated > 0 ? (selfConsumed / generated) * 100 : 0;

  // Total consumption: prefer Emporia, fall back to Solis home_load
  const totalConsumption = emporiaTotalKwh || solis?.home_load_kwh || (gridImport + selfConsumed);
  const fromSolar = Math.min(selfConsumed, totalConsumption);
  const fromGrid = totalConsumption - fromSolar;
  const solarFraction = totalConsumption > 0 ? (fromSolar / totalConsumption) * 100 : 0;

  // Costs — use average day rate as approximation (we don't have hourly breakdown from Solis/Emporia daily totals)
  const importCost = fromGrid * AVG_RATE;
  const expRate = args.exportRate !== null ? args.exportRate : AVG_RATE;
  const exportCredit = exported * expRate;
  const netCost = importCost - exportCredit;

  const dateStr = solis?.date || args.date || new Date().toISOString().split("T")[0];

  // Track data completeness
  const warnings = [];
  if (!solis) warnings.push("Solis data unavailable");
  if (!args.solarOnly && emporiaTotalKwh === null) warnings.push("Emporia data unavailable");

  // 4. Output
  if (args.quiet) {
    console.log(fmtEuro(netCost));
    process.exit(warnings.length > 0 ? 1 : 0);
  }

  if (args.json) {
    const result = {
      date: dateStr,
      solar: {
        generated_kwh: Math.round(generated * 100) / 100,
        self_consumed_kwh: Math.round(selfConsumed * 100) / 100,
        exported_kwh: Math.round(exported * 100) / 100,
        self_consumption_pct: Math.round(selfConsumedPct),
      },
      consumption: {
        total_kwh: Math.round(totalConsumption * 100) / 100,
        from_solar_kwh: Math.round(fromSolar * 100) / 100,
        from_grid_kwh: Math.round(fromGrid * 100) / 100,
        solar_fraction_pct: Math.round(solarFraction),
        source: emporiaTotalKwh ? "emporia" : (solis?.home_load_kwh ? "solis" : "calculated"),
      },
      cost: {
        grid_import_eur: Math.round(importCost * 100) / 100,
        export_credit_eur: Math.round(exportCredit * 100) / 100,
        net_cost_eur: Math.round(netCost * 100) / 100,
        avg_rate_used: Math.round(AVG_RATE * 10000) / 10000,
      },
    };
    if (warnings.length > 0) result.warnings = warnings;
    console.log(JSON.stringify(result, null, 2));
    process.exit(warnings.length > 0 ? 1 : 0);
  }

  if (args.compact) {
    const parts = [];
    parts.push(dateForDisplay(dateStr).replace(/^/, "⚡ "));
    if (generated > 0) {
      parts.push(`Solar ${fmtKwh(generated)} (${fmtPct(selfConsumedPct)} self-used, ${fmtKwh(exported)} exported).`);
    }
    parts.push(`Used ${fmtKwh(totalConsumption)} total.`);
    if (fromGrid > 0 || generated === 0) {
      parts.push(`Grid cost ${fmtEuro(importCost)} – export credit ${fmtEuro(exportCredit)} = ${fmtEuro(netCost)} net.`);
    } else {
      parts.push(`${fmtEuro(exportCredit)} export credit.`);
    }
    if (warnings.length > 0) parts.push(`⚠ ${warnings.join(", ")}`);
    console.log(parts.join(" "));
    process.exit(warnings.length > 0 ? 1 : 0);
  }

  // Human-readable default
  const lines = [];
  lines.push(`⚡ Energy Summary — ${dateForDisplay(dateStr)}`);
  lines.push("");

  if (generated > 0) {
    lines.push("Solar");
    lines.push(`  Generated:      ${fmtKwh(generated)}`);
    lines.push(`  Self-consumed:  ${fmtKwh(selfConsumed)} (${fmtPct(selfConsumedPct)})`);
    lines.push(`  Exported:       ${fmtKwh(exported)} → ${fmtEuro(exportCredit)} credit`);
    lines.push("");
  }

  lines.push("Consumption");
  lines.push(`  Total:          ${fmtKwh(totalConsumption)}${emporiaTotalKwh ? " (Emporia)" : solis?.home_load_kwh ? " (Solis)" : " (estimated)"}`);
  if (generated > 0) {
    lines.push(`  From solar:     ${fmtKwh(fromSolar)} (${fmtPct(solarFraction)})`);
  }
  lines.push(`  From grid:      ${fmtKwh(fromGrid)} → ${fmtEuro(importCost)}`);
  lines.push("");
  lines.push(`  Net cost: ${fmtEuro(netCost)}${netCost < 0 ? " (net gain! 🎉)" : ""}`);

  if (warnings.length > 0) {
    lines.push("");
    lines.push(`⚠ ${warnings.join("; ")}`);
  }

  console.log(lines.join("\n"));
  process.exit(warnings.length > 0 ? 1 : 0);
}

main();
