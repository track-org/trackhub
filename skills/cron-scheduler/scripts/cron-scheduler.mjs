#!/usr/bin/env node
// cron-scheduler.mjs — Analyze OpenClaw cron job schedules for timing conflicts and suggest optimizations
// Zero dependencies. Node.js 18+.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const USAGE = `
Usage: cron-scheduler.mjs [options]

Options:
  --conflict-window, -w <min>   Minutes within which overlaps are flagged (default: 10)
  --window <duration>           Analysis window: 1h, 6h, 12h, 24h, 7d (default: 24h)
  --resource, -r <name>         Filter to jobs referencing a specific resource
  --suggest                     Generate scheduling optimization suggestions
  --verbose, -v                 Include reasoning for suggestions
  --json                        Structured JSON output
  --help                        Show this help
`.trim();

function parseArgs(argv) {
  const args = {};
  const flags = ['suggest', 'verbose', 'json', 'help'];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (a === '--suggest') { args.suggest = true; continue; }
    if (a === '--verbose' || a === '-v') { args.verbose = true; continue; }
    if (a === '--json') { args.json = true; continue; }
    if ((a === '--conflict-window' || a === '-w') && argv[i + 1]) { args.conflictWindow = parseInt(argv[++i]); continue; }
    if (a === '--window' && argv[i + 1]) { args.window = argv[++i]; continue; }
    if ((a === '--resource' || a === '-r') && argv[i + 1]) { args.resource = argv[++i]; continue; }
    console.error(`Unknown arg: ${a}`);
    process.exit(1);
  }
  args.conflictWindow = args.conflictWindow || 10;
  args.window = args.window || '24h';
  return args;
}

function parseDuration(d) {
  const match = d.match(/^(\d+)(h|d)$/);
  if (!match) return 24 * 60; // default 24h in minutes
  const num = parseInt(match[1]);
  return match[2] === 'h' ? num * 60 : num * 24 * 60;
}

function loadJobs() {
  const candidates = [
    join(homedir(), '.openclaw/cron/jobs.json'),
    join(process.env.OPENCLAW_ROOT || '', 'cron/jobs.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        // Jobs may be nested under a "jobs" key (schema versioning)
        if (data && !Array.isArray(data) && Array.isArray(data.jobs)) return data.jobs;
        if (Array.isArray(data)) return data;
      } catch { /* continue */ }
    }
  }
  return [];
}

function parseCronExpr(expr) {
  // Return array of minute-of-day values this cron fires at (simplified: handle hourly/daily patterns)
  // We do a simplified next-N-firetimes approach
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return [];
  const [min, hour, dom, mon, dow] = parts;

  // Simple cases we handle well:
  // - Exact times: "0 7 * * *" (daily at 7:00)
  // - Multi-minute: "0,30 7 * * *" (7:00 and 7:30)
  // - Every N hours: "0 */2 * * *" (every 2 hours)
  // - Every N minutes: "*/15 * * * *" (every 15 min)

  const minutes = [];
  const hours = expandField(hour, 0, 23);
  const mins = expandField(min, 0, 59);

  for (const h of hours) {
    for (const m of mins) {
      minutes.push(h * 60 + m);
    }
  }
  return minutes.sort((a, b) => a - b);
}

function expandField(field, min, max) {
  if (field === '*') return [min]; // only one representative for wildcard
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2));
    const vals = [];
    for (let i = min; i <= max; i += step) vals.push(i);
    return vals;
  }
  return field.split(',').map(v => {
    const n = parseInt(v);
    return isNaN(n) ? min : n;
  });
}

function getTimeSlots(jobs, windowMinutes) {
  const slots = [];
  for (const job of jobs) {
    if (!job.enabled) continue;
    if (job.schedule?.kind !== 'cron') continue;
    const times = parseCronExpr(job.schedule.expr || '');
    for (const t of times) {
      if (t < windowMinutes) { // only within the analysis window (minutes from midnight)
        slots.push({ job, minuteOfDay: t });
      }
    }
  }
  return slots.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}

function extractResources(job) {
  const resources = new Set();
  const text = [
    job.payload?.text || '',
    job.payload?.message || '',
    job.description || '',
    job.name || '',
  ].join(' ').toLowerCase();

  // Delivery channel
  const ch = job.delivery?.channel;
  if (ch) resources.add(ch);

  // Common API/service patterns
  const patterns = {
    gmail: /\bgmail\b|\bgoogle\b|googleapis\.com|userinfo/,
    slack: /\bslack\b|xoxb-|slack\.com/,
    attio: /\battio\b|attio\.com/,
    supabase: /\bsupabase\b|supabase\.co/,
    solis: /\bsolis\b|solar\b|inverter/,
    emporia: /\bemporia\b|emporia\.energy|vue/,
    weather: /\bweather\b|wttr\.in|open-meteo/,
    github: /\bgithub\b|api\.github\.com/,
  };

  for (const [name, regex] of Object.entries(patterns)) {
    if (regex.test(text)) resources.add(name);
  }

  // Skill script paths
  const scriptMatches = text.match(/\/skills\/([\w-]+)\//g);
  if (scriptMatches) {
    for (const m of scriptMatches) {
      const skillName = m.split('/')[2];
      resources.add(`skill:${skillName}`);
    }
  }

  // Session target
  resources.add(`target:${job.sessionTarget || 'main'}`);

  return [...resources];
}

function findConflicts(slots, conflictWindow) {
  const conflicts = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const gap = slots[j].minuteOfDay - slots[i].minuteOfDay;
      if (gap > conflictWindow) break;
      const shared = new Set([...extractResources(slots[i].job), ...extractResources(slots[j].job)]);
      const sharedArr = [...shared].filter(r => !r.startsWith('target:'));
      if (sharedArr.length > 0) {
        conflicts.push({
          jobA: slots[i].job.name || slots[i].job.id?.slice(0, 8),
          jobB: slots[j].job.name || slots[j].job.id?.slice(0, 8),
          timeA: formatMinute(slots[i].minuteOfDay),
          timeB: formatMinute(slots[j].minuteOfDay),
          gapMinutes: gap,
          sharedResources: sharedArr,
        });
      }
    }
  }
  return conflicts;
}

function formatMinute(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function buildResourceMap(jobs) {
  const map = {};
  for (const job of jobs) {
    if (!job.enabled || job.schedule?.kind !== 'cron') continue;
    const resources = extractResources(job);
    const times = parseCronExpr(job.schedule.expr || '');
    const name = job.name || job.id?.slice(0, 8);
    for (const r of resources) {
      if (r.startsWith('target:')) continue;
      if (!map[r]) map[r] = { jobs: [], times: [] };
      map[r].jobs.push(name);
      map[r].times.push(...times.map(formatMinute));
    }
  }
  return map;
}

function generateSuggestions(jobs, conflicts, resourceMap, verbose) {
  const suggestions = [];

  // Stagger conflicting jobs
  const seen = new Set();
  for (const c of conflicts) {
    const key = [c.jobA, c.jobB].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const jobA = jobs.find(j => (j.name || j.id?.slice(0, 8)) === c.jobA);
    const jobB = jobs.find(j => (j.name || j.id?.slice(0, 8)) === c.jobB);

    // Stagger the second job by 15-30 min
    if (jobB?.schedule?.expr) {
      const currentMin = jobB.schedule.expr.split(/\s+/)[0];
      const staggerMin = parseInt(currentMin) + 15;
      const staggeredExpr = jobB.schedule.expr.replace(/^\S+/, String(staggerMin % 60));
      suggestions.push({
        type: 'stagger',
        job: c.jobB,
        current: c.timeB,
        suggested: formatMinute(parseCronExpr(staggeredExpr)[0] || (parseInt(currentMin) + 15)),
        reason: `Avoids overlap with ${c.jobA} (${c.timeB} → +15min)`,
        sharedResources: c.sharedResources,
        verbose: `Both ${c.jobA} and ${c.jobB} fire within ${c.gapMinutes}min and share ${c.sharedResources.join(', ')}. Staggering ${c.jobB} by 15 minutes reduces resource contention. Current expr: "${jobB.schedule.expr}" → "${staggeredExpr}"`,
      });
    }
  }

  // Spread clustered jobs on the same resource
  for (const [resource, info] of Object.entries(resourceMap)) {
    if (info.jobs.length < 2) continue;
    // Check if multiple jobs fire at the same time
    const timeCounts = {};
    for (const t of info.times) {
      timeCounts[t] = (timeCounts[t] || 0) + 1;
    }
    for (const [time, count] of Object.entries(timeCounts)) {
      if (count >= 2) {
        suggestions.push({
          type: 'spread',
          resource,
          time,
          count,
          reason: `${count} jobs on ${resource} all fire at ${time}`,
          verbose: `Resource "${resource}" has ${count} jobs (${info.jobs.join(', ')}) scheduled at ${time}. Consider spreading them across a 30-60 minute window to reduce contention and spread token cost.`,
        });
      }
    }
  }

  return suggestions;
}

function outputText(jobs, slots, conflicts, resourceMap, suggestions, args) {
  const lines = [];
  lines.push(`📅 Cron Schedule Analysis — ${args.window} window`);
  lines.push(`   ${jobs.filter(j => j.enabled && j.schedule?.kind === 'cron').length} active cron jobs\n`);

  // Timeline
  lines.push('## Timeline (within window)');
  if (slots.length === 0) {
    lines.push('   No cron jobs found.');
  } else {
    for (const s of slots) {
      const resources = extractResources(s.job).filter(r => !r.startsWith('target:'));
      lines.push(`   ${s.minuteOfDay === 0 ? '00:00' : formatMinute(s.minuteOfDay)}  ${s.job.name || s.job.id?.slice(0, 8)}`);
      if (resources.length > 0) {
        lines.push(`           ↳ ${resources.join(', ')}`);
      }
    }
  }
  lines.push('');

  // Conflicts
  lines.push('## Conflicting Jobs');
  if (conflicts.length === 0) {
    lines.push('   ✅ No scheduling conflicts detected.');
  } else {
    for (const c of conflicts) {
      lines.push(`   ⚠️  ${c.timeA}  [${c.jobA}, ${c.jobB}] → ${c.gapMinutes}min apart, share: ${c.sharedResources.join(', ')}`);
    }
  }
  lines.push('');

  // Resource contention
  lines.push('## Resource Contention');
  const nonTargetResources = Object.entries(resourceMap).filter(([k]) => !k.startsWith('target:'));
  if (nonTargetResources.length === 0) {
    lines.push('   No shared resources detected.');
  } else {
    for (const [resource, info] of nonTargetResources) {
      const timeClusters = {};
      for (const t of info.times) {
        const bucket = t; // already formatted HH:MM
        timeClusters[bucket] = (timeClusters[bucket] || 0) + 1;
      }
      const clusters = Object.entries(timeClusters)
        .filter(([, count]) => count >= 2)
        .map(([time, count]) => `${time}: ${count} jobs`)
        .join(', ');
      lines.push(`   🔑 ${resource}: ${info.jobs.length} job(s)${clusters ? ` (${clusters})` : ''}`);
    }
  }
  lines.push('');

  // Suggestions
  if (args.suggest && suggestions.length > 0) {
    lines.push('## Suggested Optimizations');
    suggestions.forEach((s, i) => {
      lines.push(`   ${i + 1}. [${s.type.toUpperCase()}] ${s.reason}`);
      if (args.verbose && s.verbose) {
        lines.push(`      ${s.verbose}`);
      }
    });
  } else if (args.suggest) {
    lines.push('## Suggested Optimizations');
    lines.push('   ✅ Schedule looks good — no optimizations needed.');
  }

  return lines.join('\n');
}

function outputJSON(jobs, slots, conflicts, resourceMap, suggestions) {
  return JSON.stringify({
    window: args.window,
    totalJobs: jobs.filter(j => j.enabled && j.schedule?.kind === 'cron').length,
    timeline: slots.map(s => ({
      time: formatMinute(s.minuteOfDay),
      job: s.job.name || s.job.id?.slice(0, 8),
      resources: extractResources(s.job).filter(r => !r.startsWith('target:')),
    })),
    conflicts,
    resourceContention: Object.fromEntries(
      Object.entries(resourceMap).filter(([k]) => !k.startsWith('target:'))
    ),
    suggestions,
  }, null, 2);
}

// Main
const args = parseArgs(process.argv);
if (args.help) { console.log(USAGE); process.exit(0); }

const jobs = loadJobs();
if (!jobs.length) {
  console.error('No cron jobs found. Run from a machine with OpenClaw installed.');
  process.exit(1);
}

// Filter by resource if specified
let filteredJobs = jobs;
if (args.resource) {
  filteredJobs = jobs.filter(j => {
    const resources = extractResources(j);
    return resources.some(r => r.includes(args.resource.toLowerCase()));
  });
  if (!filteredJobs.length) {
    console.error(`No jobs found referencing resource: ${args.resource}`);
    process.exit(1);
  }
}

const windowMinutes = parseDuration(args.window);
const slots = getTimeSlots(filteredJobs, windowMinutes);
const conflicts = findConflicts(slots, args.conflictWindow);
const resourceMap = buildResourceMap(filteredJobs);
const suggestions = args.suggest ? generateSuggestions(jobs, conflicts, resourceMap, args.verbose) : [];

if (args.json) {
  console.log(outputJSON(jobs, slots, conflicts, resourceMap, suggestions));
} else {
  console.log(outputText(jobs, slots, conflicts, resourceMap, suggestions, args));
}
