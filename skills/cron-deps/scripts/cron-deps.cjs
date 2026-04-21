#!/usr/bin/env node
/**
 * cron-deps — Map dependencies and blast radius between cron jobs.
 *
 * Analyses all OpenClaw cron jobs to identify shared credentials, APIs,
 * channels, skill scripts, and session targets. Shows blast radius for
 * each shared resource — which jobs would be affected if a credential
 * expires or a service goes down.
 *
 * Usage:
 *   node cron-deps.cjs                          # Human-readable report
 *   node cron-deps.cjs --json                   # JSON output
 *   node cron-deps.cjs --blast-radius gmail     # Show impact of Gmail going down
 *   node cron-deps.cjs --blast-radius attio     # Show impact of Attio going down
 *   node cron-deps.cjs --resource credentials   # Group by shared credentials
 *   node cron-deps.cjs --resource channels      # Group by delivery channels
 *   node cron-deps.cjs --resource skills        # Group by skill scripts used
 *   node cron-deps.cjs --resource all           # Full dependency map (default)
 */

'use strict';

const { execSync } = require('child_process');

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = {};
const positional = [];

let i = 0;
while (i < args.length) {
  if (args[i].startsWith('--')) {
    const [key, ...rest] = args[i].slice(2).split('=');
    if (rest.length > 0) {
      flags[key] = rest.join('=');
    } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      flags[key] = args[++i];
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(args[i]);
  }
  i++;
}

if (flags.help || flags.h) {
  console.log(`cron-deps — Map dependencies and blast radius between cron jobs

Usage:
  node cron-deps.cjs [options]

Options:
  --json            Output as JSON
  --blast-radius <resource>  Show jobs affected if a resource fails
  --resource <type>  Group by: credentials, channels, skills, session-targets, all
  --help, -h        Show this help`);
  process.exit(0);
}

// ── Load cron jobs ────────────────────────────────────────────────────
function loadCronJobs() {
  try {
    const raw = execSync('openclaw cron list --json', {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const data = JSON.parse(raw);
    return data.jobs || [];
  } catch (err) {
    console.error('Error: Could not load cron jobs. Is the gateway running?');
    console.error(err.message);
    process.exit(1);
  }
}

// ── Extract dependencies from a job ───────────────────────────────────

// Known credential check patterns in payloads
const CREDENTIAL_PATTERNS = [
  { regex: /--check\s+(\w[\w-]*)/g, type: 'preflight-check' },
  { regex: /GMAIL_ACCESS_TOKEN|GOOGLE_OAUTH_TOKEN|gmail\.json/i, resource: 'gmail', type: 'env-var' },
  { regex: /ATTIO_API_KEY|attio/i, resource: 'attio', type: 'env-var' },
  { regex: /SLACK_BOT_TOKEN|xoxb-/i, resource: 'slack', type: 'env-var' },
  { regex: /SOLIS_API_KEY|SOLIS_INVERTER_SN|solis/i, resource: 'solis', type: 'env-var' },
  { regex: /SUPABASE.*KEY|supabase\.co/i, resource: 'supabase', type: 'env-var' },
  { regex: /EMPORIA.*TOKEN|pyemvue|emporia/i, resource: 'emporia', type: 'env-var' },
];

// Known skill script patterns
const SKILL_PATTERNS = [
  /trackhub\/skills\/([\w-]+)\/scripts\/([\w.-]+)/g,
  /workspace\/skills\/([\w-]+)\/scripts\/([\w.-]+)/g,
  /workspace\/projects\/([\w-]+)\/([\w.-]+)/g,
];

// Known API/domain patterns
const API_PATTERNS = [
  { regex: /supabase\.co/, resource: 'supabase-api' },
  { regex: /googleapis\.com|accounts\.google/i, resource: 'google-api' },
  { regex: /slack\.com|api\.slack/i, resource: 'slack-api' },
  { regex: /soliscloud\.com|solis.*api/i, resource: 'solis-api' },
  { regex: /emporiaenergy\.com|emporia.*api/i, resource: 'emporia-api' },
  { regex: /api\.attio\.io|attio\.com/i, resource: 'attio-api' },
];

function extractPayloadText(job) {
  const payload = job.payload || {};
  if (payload.text) return payload.text;
  if (payload.message) return payload.message;
  return '';
}

function extractDependencies(job) {
  const deps = {
    credentials: new Set(),
    skills: new Set(),
    apis: new Set(),
    channels: new Set(),
    sessionTarget: job.sessionTarget || 'unknown',
    deliveryChannel: null,
    preflightChecks: new Set(),
  };

  const payloadText = extractPayloadText(job);

  // Credential patterns
  for (const pat of CREDENTIAL_PATTERNS) {
    if (pat.resource) {
      if (pat.regex.test(payloadText)) {
        deps.credentials.add(pat.resource);
        pat.regex.lastIndex = 0; // reset
      }
    }
    // preflight --check patterns
    const checkRegex = /--check\s+(\w[\w-]*)/g;
    let match;
    while ((match = checkRegex.exec(payloadText)) !== null) {
      deps.preflightChecks.add(match[1].toLowerCase());
      // Also add to credentials if it matches known services
      deps.credentials.add(match[1].toLowerCase());
    }
  }

  // Skill scripts
  for (const pat of SKILL_PATTERNS) {
    let match;
    while ((match = pat.exec(payloadText)) !== null) {
      deps.skills.add(`${match[1]}/${match[2]}`);
    }
  }

  // API domains
  for (const pat of API_PATTERNS) {
    if (pat.regex.test(payloadText)) {
      deps.apis.add(pat.resource);
      pat.regex.lastIndex = 0;
    }
  }

  // Delivery channel
  const delivery = job.delivery || {};
  if (delivery.channel) {
    deps.deliveryChannel = delivery.channel;
    deps.channels.add(delivery.channel);
    if (delivery.to) {
      deps.channels.add(delivery.to);
    }
  }

  // Session key hints at channel context
  if (job.sessionKey) {
    if (job.sessionKey.includes('whatsapp')) deps.channels.add('whatsapp');
    if (job.sessionKey.includes('slack')) deps.channels.add('slack');
    if (job.sessionKey.includes('signal')) deps.channels.add('signal');
  }

  return deps;
}

// ── Build dependency map ──────────────────────────────────────────────
function buildDependencyMap(jobs) {
  const resourceMap = {
    credentials: {},  // resource -> [jobs]
    skills: {},       // skill -> [jobs]
    apis: {},         // api -> [jobs]
    channels: {},     // channel -> [jobs]
    sessionTargets: {}, // target -> [jobs]
  };

  const jobDeps = new Map();

  for (const job of jobs) {
    const deps = extractDependencies(job);
    jobDeps.set(job.id, { job, deps });

    for (const cred of deps.credentials) {
      if (!resourceMap.credentials[cred]) resourceMap.credentials[cred] = [];
      resourceMap.credentials[cred].push(job.name);
    }
    for (const skill of deps.skills) {
      if (!resourceMap.skills[skill]) resourceMap.skills[skill] = [];
      resourceMap.skills[skill].push(job.name);
    }
    for (const api of deps.apis) {
      if (!resourceMap.apis[api]) resourceMap.apis[api] = [];
      resourceMap.apis[api].push(job.name);
    }
    for (const ch of deps.channels) {
      if (!resourceMap.channels[ch]) resourceMap.channels[ch] = [];
      resourceMap.channels[ch].push(job.name);
    }
    const target = deps.sessionTarget;
    if (!resourceMap.sessionTargets[target]) resourceMap.sessionTargets[target] = [];
    resourceMap.sessionTargets[target].push(job.name);
  }

  return { resourceMap, jobDeps };
}

// ── Blast radius ──────────────────────────────────────────────────────
function computeBlastRadius(jobs, resourceMap, resourceName) {
  const resource = resourceName.toLowerCase();
  const affected = new Set();

  // Check across all resource types
  for (const type of Object.keys(resourceMap)) {
    for (const [key, jobNames] of Object.entries(resourceMap[type])) {
      if (key.toLowerCase().includes(resource) || resource.includes(key.toLowerCase())) {
        jobNames.forEach(n => affected.add(n));
      }
    }
  }

  // Also check job names and descriptions
  for (const job of jobs) {
    const text = `${job.name} ${job.description || ''} ${extractPayloadText(job)}`.toLowerCase();
    if (text.includes(resource)) {
      affected.add(job.name);
    }
  }

  return [...affected];
}

// ── Formatters ────────────────────────────────────────────────────────
function formatReport(jobs, resourceMap, jobDeps) {
  const lines = [];
  lines.push('📊 Cron Job Dependency Map');
  lines.push('═'.repeat(50));

  // Summary
  lines.push(`\n📦 ${jobs.length} cron jobs analysed`);
  const enabledJobs = jobs.filter(j => j.enabled);
  const disabledJobs = jobs.filter(j => !j.enabled);
  if (disabledJobs.length > 0) {
    lines.push(`   ${enabledJobs.length} enabled, ${disabledJobs.length} disabled`);
  }

  // Shared credentials
  const sharedCreds = Object.entries(resourceMap.credentials).filter(([, j]) => j.length > 0);
  if (sharedCreds.length > 0) {
    lines.push('\n🔑 Shared Credentials (blast radius):');
    for (const [cred, jobNames] of sharedCreds) {
      const icon = jobNames.length > 1 ? '⚠️' : '  ';
      lines.push(`${icon} ${cred}: ${jobNames.length} job(s)`);
      for (const name of jobNames) {
        lines.push(`   └─ ${name}`);
      }
    }
  }

  // Shared APIs
  const sharedApis = Object.entries(resourceMap.apis).filter(([, j]) => j.length > 0);
  if (sharedApis.length > 0) {
    lines.push('\n🌐 Shared API Dependencies:');
    for (const [api, jobNames] of sharedApis) {
      lines.push(`   ${api}: ${jobNames.length} job(s)`);
      for (const name of jobNames) {
        lines.push(`   └─ ${name}`);
      }
    }
  }

  // Shared skills
  const sharedSkills = Object.entries(resourceMap.skills).filter(([, j]) => j.length > 0);
  if (sharedSkills.length > 0) {
    lines.push('\n🛠️ Skill Scripts Used:');
    for (const [skill, jobNames] of sharedSkills) {
      lines.push(`   ${skill}: used by ${jobNames.join(', ')}`);
    }
  }

  // Channels
  const sharedChannels = Object.entries(resourceMap.channels).filter(([, j]) => j.length > 0);
  if (sharedChannels.length > 0) {
    lines.push('\n📡 Delivery Channels:');
    for (const [ch, jobNames] of sharedChannels) {
      lines.push(`   ${ch}: ${jobNames.length} job(s)`);
      for (const name of jobNames) {
        lines.push(`   └─ ${name}`);
      }
    }
  }

  // Session targets
  const sharedTargets = Object.entries(resourceMap.sessionTargets);
  if (sharedTargets.length > 0) {
    lines.push('\n🎯 Session Targets:');
    for (const [target, jobNames] of sharedTargets) {
      lines.push(`   ${target}: ${jobNames.join(', ')}`);
    }
  }

  // Per-job detail
  lines.push('\n📋 Per-Job Dependencies:');
  for (const [id, { job, deps }] of jobDeps) {
    const status = job.enabled ? '✅' : '❌ disabled';
    lines.push(`\n${status} ${job.name} (${job.id.slice(0, 8)})`);
    if (deps.credentials.size > 0) lines.push(`   Credentials: ${[...deps.credentials].join(', ')}`);
    if (deps.preflightChecks.size > 0) lines.push(`   Preflight:    ${[...deps.preflightChecks].join(', ')}`);
    if (deps.apis.size > 0) lines.push(`   APIs:         ${[...deps.apis].join(', ')}`);
    if (deps.skills.size > 0) lines.push(`   Skills:       ${[...deps.skills].join(', ')}`);
    if (deps.channels.size > 0) lines.push(`   Channels:     ${[...deps.channels].join(', ')}`);
    lines.push(`   Session:      ${deps.sessionTarget}`);
    const cronExpr = job.schedule?.expr || '?';
    const tz = job.schedule?.tz || 'local';
    lines.push(`   Schedule:     ${cronExpr} (${tz})`);
  }

  // Risk summary
  lines.push('\n⚡ Risk Summary:');
  const multiCredResources = sharedCreds.filter(([, j]) => j.length > 1);
  if (multiCredResources.length > 0) {
    for (const [cred, jobNames] of multiCredResources) {
      lines.push(`   ⚠️  ${cred} failure affects ${jobNames.length} jobs: ${jobNames.join(', ')}`);
    }
  } else {
    lines.push('   ✅ No single credential failure affects multiple jobs');
  }

  // Check for jobs without preflight
  const jobsWithPreflight = [...jobDeps.values()].filter(({ deps }) => deps.preflightChecks.size > 0);
  const jobsWithoutPreflight = [...jobDeps.values()].filter(({ deps }) => deps.preflightChecks.size === 0 && deps.credentials.size > 0);
  if (jobsWithoutPreflight.length > 0) {
    lines.push(`\n   ⚠️  ${jobsWithoutPreflight.length} job(s) use credentials but have no preflight check:`);
    for (const { job } of jobsWithoutPreflight) {
      lines.push(`      - ${job.name}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

function formatBlastRadius(jobs, resourceMap, resourceName, affected) {
  const lines = [];
  lines.push(`💥 Blast Radius: "${resourceName}"`);
  lines.push('═'.repeat(40));

  if (affected.length === 0) {
    lines.push('\n✅ No cron jobs depend on this resource.');
  } else {
    lines.push(`\n🚨 ${affected.length} job(s) would be affected:\n`);
    for (const name of affected) {
      const job = jobs.find(j => j.name === name);
      const status = job?.enabled ? '✅' : '❌';
      const schedule = job?.schedule?.expr || '?';
      const target = job?.sessionTarget || '?';
      lines.push(`${status} ${name}`);
      lines.push(`   Schedule: ${schedule} | Session: ${target}`);
      const deps = job ? extractDependencies(job) : null;
      if (deps) {
        if (deps.credentials.size > 0) lines.push(`   Credentials: ${[...deps.credentials].join(', ')}`);
        if (deps.deliveryChannel) lines.push(`   Delivers to: ${deps.deliveryChannel}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function formatResourceGroup(resourceMap, type) {
  const validTypes = ['credentials', 'channels', 'skills', 'apis', 'session-targets'];
  if (!validTypes.includes(type)) {
    console.error(`Error: Unknown resource type "${type}". Valid: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  const key = type;
  const map = resourceMap[key] || {};
  const lines = [];

  const titles = {
    credentials: '🔑 Credentials',
    channels: '📡 Channels',
    skills: '🛠️ Skill Scripts',
    apis: '🌐 API Endpoints',
    'session-targets': '🎯 Session Targets',
  };

  lines.push(`${titles[type] || type}`);
  lines.push('═'.repeat(40));

  const entries = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  if (entries.length === 0) {
    lines.push('\nNo dependencies found for this category.');
  } else {
    for (const [resource, jobNames] of entries) {
      lines.push(`\n${resource} (${jobNames.length} job${jobNames.length > 1 ? 's' : ''}):`);
      for (const name of jobNames) {
        lines.push(`  • ${name}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────
function main() {
  const jobs = loadCronJobs();

  if (jobs.length === 0) {
    console.log('No cron jobs found.');
    process.exit(0);
  }

  const { resourceMap, jobDeps } = buildDependencyMap(jobs);

  if (flags.json) {
    // JSON output: full structured data
    const output = {
      totalJobs: jobs.length,
      generatedAt: new Date().toISOString(),
      resourceMap: {},
      jobs: []
    };

    // Convert Sets to arrays for JSON
    for (const [type, map] of Object.entries(resourceMap)) {
      output.resourceMap[type] = {};
      for (const [key, val] of Object.entries(map)) {
        output.resourceMap[type][key] = val;
      }
    }

    for (const [id, { job, deps }] of jobDeps) {
      output.jobs.push({
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        schedule: job.schedule,
        sessionTarget: job.sessionTarget,
        credentials: [...deps.credentials],
        preflightChecks: [...deps.preflightChecks],
        skills: [...deps.skills],
        apis: [...deps.apis],
        channels: [...deps.channels],
        deliveryChannel: deps.deliveryChannel,
      });
    }

    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Blast radius mode
  if (flags['blast-radius']) {
    const affected = computeBlastRadius(jobs, resourceMap, flags['blast-radius']);
    console.log(formatBlastRadius(jobs, resourceMap, flags['blast-radius'], affected));
    return;
  }

  // Resource group mode
  if (flags.resource) {
    console.log(formatResourceGroup(resourceMap, flags.resource));
    return;
  }

  // Default: full report
  console.log(formatReport(jobs, resourceMap, jobDeps));
}

main();
