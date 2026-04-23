#!/usr/bin/env node

/**
 * wire-preflight.mjs
 *
 * Auto-detect which APIs a cron job depends on and inject credential-health
 * preflight checks into its payload. Prevents LLM turns from burning on dead tokens.
 *
 * Usage:
 *   node wire-preflight.mjs <job-id-or-name>          # Wire a specific job
 *   node wire-preflight.mjs --all                     # Scan all enabled jobs
 *   node wire-preflight.mjs --dry-run <job-id-or-name>  # Show what would change
 *   node wire-preflight.mjs --all --dry-run            # Scan all, show only
 *
 * Zero external dependencies. ES modules (Node 18+).
 */

import { execSync } from 'child_process';
import fs from 'fs';

// ─── Config ──────────────────────────────────────────────────────────

const CREDENTIAL_HEALTH_SCRIPT =
  '/home/delads/.openclaw/workspace/trackhub/skills/credential-health/scripts/credential-health.cjs';

// Keyword → service mapping: if payload text contains any keyword for a service,
// we inject a preflight check for it.
const SERVICE_PATTERNS = {
  gmail:       ['GMAIL_ACCESS_TOKEN', 'GOOGLE_OAUTH_TOKEN'],
  'gmail-file': ['check_gmail', 'gmail-checker', 'Gmail digest', 'gmail.json', 'credentials/gmail'],
  slack:       ['SLACK_BOT_TOKEN', 'slack tool', 'slack reactions'],
  attio:       ['attio', 'Attio', 'ATTIO', 'pipeline-query'],
  supabase:    ['supabase', 'Supabase', 'SUPABASE'],
  openai:      ['openai', 'OpenAI', 'OPENAI'],
};

// Negative patterns — if payload contains these, the service is mentioned
// but NOT actually used (e.g. "Do not post to Slack")
const NEGATIVE_PATTERNS = {
  slack: ['do not post to slack', 'don\'t post to slack', 'not to slack', 'no slack'],
};

// Preflight step template. The agent will run this first and bail if it fails.
function preflightStep(services) {
  const checks = services.join(' ');
  return [
    `## Credential Pre-flight`,
    `Run: node ${CREDENTIAL_HEALTH_SCRIPT} --check ${checks} --fail-only --json`,
    `If the result contains any entries with "status": "fail":`,
    `  - Reply with a concise summary of which credential(s) failed.`,
    `  - Do NOT proceed with the main task below.`,
    `  - Do NOT send to Slack or any other channel.`,
    `If all checks pass (or all "skip"), proceed to the main task.`,
    ``,
  ].join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // Some commands exit non-zero with valid JSON output
    if (e.stdout) return e.stdout;
    throw e;
  }
}

function getCronJobs() {
  const raw = run('openclaw cron list --json');
  return JSON.parse(raw);
}

function findJob(jobs, idOrName) {
  // Try exact ID match first
  let job = jobs.find(j => j.id === idOrName || j.id.startsWith(idOrName));
  if (!job) {
    // Try name match (case-insensitive)
    job = jobs.find(j => j.name.toLowerCase().includes(idOrName.toLowerCase()));
  }
  return job || null;
}

function detectServices(payloadText) {
  const lower = payloadText.toLowerCase();
  const detected = [];
  for (const [service, keywords] of Object.entries(SERVICE_PATTERNS)) {
    const negPatterns = NEGATIVE_PATTERNS[service] || [];
    const hasPositive = keywords.some(kw => lower.includes(kw.toLowerCase()));
    const hasNegative = negPatterns.some(np => lower.includes(np.toLowerCase()));
    if (hasPositive && !hasNegative) {
      detected.push(service);
    }
  }
  return detected;
}

function hasPreflight(payloadText) {
  // Check if payload already contains a preflight section
  return payloadText.includes('Credential Pre-flight') ||
         payloadText.includes('credential-health') ||
         payloadText.includes('pre-flight') ||
         payloadText.includes('preflight');
}

function getPayloadMessage(job) {
  if (!job.payload) return '';
  if (job.payload.kind === 'agentTurn') return job.payload.message || '';
  if (job.payload.kind === 'systemEvent') return job.payload.text || '';
  return '';
}

function injectPreflight(message, services) {
  const step = preflightStep(services);
  // Insert at the very beginning of the payload
  return step + message;
}

function applyUpdate(job, newMessage) {
  const tmpFile = `/tmp/preflight-${job.id.slice(0, 8)}.txt`;
  fs.writeFileSync(tmpFile, newMessage, 'utf8');
  try {
    const flag = job.payload?.kind === 'systemEvent' ? '--system-event' : '--message';
    run(`openclaw cron edit "${job.id}" ${flag} "$(cat ${tmpFile})"`);
    return true;
  } catch (e) {
    // If wrong kind, try the other flag
    const altFlag = job.payload?.kind === 'systemEvent' ? '--message' : '--system-event';
    try {
      run(`openclaw cron edit "${job.id}" ${altFlag} "$(cat ${tmpFile})"`);
      return true;
    } catch (e2) {
      throw e; // throw original error
    }
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─── Main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const scanAll = args.includes('--all');
const targetArg = args.find(a => !a.startsWith('--'));

if (!scanAll && !targetArg) {
  console.log('Usage: wire-preflight.mjs <job-id-or-name> | --all [--dry-run]');
  process.exit(1);
}

async function main() {
  const { jobs } = getCronJobs();
  let targets = [];

  if (scanAll) {
    targets = jobs.filter(j => j.enabled);
  } else {
    const job = findJob(jobs, targetArg);
    if (!job) {
      console.error(`❌ No cron job found matching: ${targetArg}`);
      console.error('   Run: openclaw cron list --json');
      process.exit(1);
    }
    targets = [job];
  }

  console.log(`Scanning ${targets.length} job(s) for API dependencies...\n`);

  const changes = [];

  for (const job of targets) {
    const message = getPayloadMessage(job);
    if (!message) {
      console.log(`⏭️  ${job.name} — no text payload (kind: ${job.payload?.kind || 'unknown'})`);
      continue;
    }

    if (hasPreflight(message)) {
      console.log(`✅ ${job.name} — already has preflight checks`);
      continue;
    }

    const services = detectServices(message);
    if (services.length === 0) {
      console.log(`⏭️  ${job.name} — no detectable API dependencies`);
      continue;
    }

    const newMessage = injectPreflight(message, services);

    changes.push({
      job,
      services,
      oldLength: message.length,
      newLength: newMessage.length,
      newMessage,
    });

    console.log(`🔧 ${job.name}`);
    console.log(`   Detected APIs: ${services.join(', ')}`);
    console.log(`   Payload: ${message.length} → ${newMessage.length} chars`);
    if (dryRun) {
      console.log(`   [DRY RUN — would inject preflight step]`);
    }
    console.log();
  }

  if (dryRun) {
    console.log(`[DRY RUN] ${changes.length} job(s) would be updated.`);
    return;
  }

  if (changes.length === 0) {
    console.log('Nothing to wire. All jobs either have preflight or no API deps.');
    return;
  }

  // Apply changes
  console.log('Applying changes...\n');
  for (const change of changes) {
    try {
      applyUpdate(change.job, change.newMessage);
      console.log(`✅ ${change.job.name} — updated with preflight checks`);
    } catch (e) {
      console.error(`❌ ${change.job.name} — failed to update: ${e.message}`);
    }
  }

  console.log(`\nDone! ${changes.length} job(s) wired with credential preflight.`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
