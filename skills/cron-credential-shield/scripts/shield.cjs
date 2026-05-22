#!/usr/bin/env node
// shield.cjs — Part of the cron-credential-shield skill
// Detect broken credentials, snooze affected cron jobs, auto-resume on recovery.
// Zero dependencies. Node.js 18+.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/root';
const SHIELD_STATE_PATH = path.join(HOME, '.openclaw', 'cron', 'shield-state.json');
const SHIELD_MAP_PATH = path.join(HOME, '.openclaw', 'cron', 'shield-map.json');
const CREDENTIAL_HEALTH_SCRIPT = path.join(
  HOME, '.openclaw', 'workspace', 'trackhub', 'skills',
  'credential-health', 'scripts', 'credential-health.cjs'
);
const CRON_SNOOZE_SCRIPT = path.join(
  HOME, '.openclaw', 'workspace', 'trackhub', 'skills',
  'cron-snooze', 'scripts', 'cron-snooze.mjs'
);

// ── CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  shield: args.includes('--shield'),
  recover: args.includes('--recover'),
  cycle: args.includes('--cycle'),
  status: args.includes('--status'),
  dryRun: args.includes('--dry-run'),
  json: args.includes('--json'),
  quiet: args.includes('--quiet') || args.includes('-q'),
  help: args.includes('--help') || args.includes('-h'),
  credential: getArg(args, '--credential', '-c'),
  duration: getArg(args, '--for') || '6h',
  reason: getArg(args, '--reason'),
};

if (opts.help || args.length === 0) {
  console.log(`cron-credential-shield — Shield cron jobs from broken credentials

Usage:
  node shield.cjs --shield [--for 6h] [--credential <name>] [--dry-run]
  node shield.cjs --recover [--dry-run]
  node shield.cjs --cycle  [--for 6h] [--dry-run]
  node shield.cjs --status [--json]

Flags:
  --shield            Check credentials and snooze affected jobs
  --recover           Check if broken credentials recovered and unsnooze
  --cycle             Run shield + recover in one pass
  --status            Show current shield state
  --credential, -c    Only check a specific credential
  --for <duration>    Snooze duration (default: 6h)
  --reason <text>     Override reason for snooze
  --dry-run           Show what would happen without executing
  --json              JSON output
  --quiet, -q         Minimal output
  --help, -h          Show this help`);
  process.exit(0);
}

// ── Main ──────────────────────────────────────────────────
function main() {
  const result = {
    actions: [],
    shielded: [],
    recovered: [],
    errors: [],
  };

  if (opts.status) {
    return showStatus();
  }

  if (opts.shield || opts.cycle) {
    const shieldResult = runShield();
    result.shielded = shieldResult.shielded;
    result.actions.push(...shieldResult.actions);
    result.errors.push(...shieldResult.errors);
  }

  if (opts.recover || opts.cycle) {
    const recoverResult = runRecover();
    result.recovered = recoverResult.recovered;
    result.actions.push(...recoverResult.actions);
    result.errors.push(...recoverResult.errors);
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!opts.quiet) {
    if (result.shielded.length > 0) {
      console.log(`🛡️  Shielded ${result.shielded.length} credential(s):`);
      result.shielded.forEach(s => console.log(`   - ${s.credential}: ${s.jobs.length} job(s) snoozed`));
    }
    if (result.recovered.length > 0) {
      console.log(`✅ Recovered ${result.recovered.length} credential(s):`);
      result.recovered.forEach(r => console.log(`   - ${r.credential}: ${r.jobs.length} job(s) resumed`));
    }
    if (result.shielded.length === 0 && result.recovered.length === 0) {
      console.log('🛡️  All clear — no credential changes.');
    }
    if (result.errors.length > 0) {
      result.errors.forEach(e => console.error(`   ⚠️  ${e}`));
    }
  }

  // Exit code 10 if we snoozed something (useful for alerting)
  if (result.shielded.length > 0) {
    process.exit(10);
  }
}

// ── Shield: check credentials and snooze ──────────────────
function runShield() {
  const result = { shielded: [], actions: [], errors: [] };

  // Run credential-health
  const healthResult = runCredentialHealth();
  if (!healthResult) {
    result.errors.push('Could not run credential-health check');
    return result;
  }

  const failures = healthResult.filter(r => r.status === 'fail');
  if (failures.length === 0) {
    return result;
  }

  // Filter to specific credential if requested
  const targetFailures = opts.credential
    ? failures.filter(f => f.service === opts.credential)
    : failures;

  // Load or auto-discover job mapping
  const jobMap = loadShieldMap();

  for (const failure of targetFailures) {
    const mappedJobs = getJobsForCredential(failure.service, jobMap);
    if (mappedJobs.length === 0) {
      result.actions.push(`No jobs mapped for credential '${failure.service}' — skipping`);
      continue;
    }

    const reason = opts.reason || failure.detail || `Credential ${failure.service} failed`;

    if (opts.dryRun) {
      result.shielded.push({
        credential: failure.service,
        jobs: mappedJobs,
        reason,
        dryRun: true,
      });
      result.actions.push(`[DRY RUN] Would snooze ${mappedJobs.length} job(s) for ${failure.service}: ${mappedJobs.join(', ')}`);
    } else {
      const snoozedJobs = [];
      for (const jobRef of mappedJobs) {
        try {
          execSync(
            `node "${CRON_SNOOZE_SCRIPT}" "${jobRef}" --for ${opts.duration} --reason "${reason.replace(/"/g, '\\"')}"`,
            { stdio: 'pipe', timeout: 15000 }
          );
          snoozedJobs.push(jobRef);
          result.actions.push(`Snoozed '${jobRef}' for ${opts.duration} (reason: ${failure.service} failed)`);
        } catch (err) {
          result.errors.push(`Failed to snooze '${jobRef}': ${err.message}`);
        }
      }

      if (snoozedJobs.length > 0) {
        result.shielded.push({
          credential: failure.service,
          jobs: snoozedJobs,
          reason,
        });

        // Update shield state
        saveShieldState(failure.service, {
          snoozedAt: new Date().toISOString(),
          credentialStatus: 'fail',
          detail: failure.detail,
          snoozedJobs,
          snoozeDuration: opts.duration,
          reason,
        });
      }
    }
  }

  return result;
}

// ── Recover: check if credentials recovered and unsnooze ──
function runRecover() {
  const result = { recovered: [], actions: [], errors: [] };

  const state = loadShieldState();
  const shieldedCredentials = Object.keys(state.shielded || {});
  if (shieldedCredentials.length === 0) {
    return result;
  }

  // Run credential-health for shielded credentials
  const healthResult = runCredentialHealth();
  if (!healthResult) {
    result.errors.push('Could not run credential-health check for recovery');
    return result;
  }

  for (const cred of shieldedCredentials) {
    const credCheck = healthResult.find(r => r.service === cred);

    // If credential is now OK (or not in results = not checked = probably OK)
    if (credCheck && credCheck.status === 'fail') {
      result.actions.push(`Credential '${cred}' still failing — keeping jobs snoozed`);
      continue;
    }

    // Credential recovered!
    const shieldInfo = state.shielded[cred];
    const jobs = shieldInfo.snoozedJobs || [];

    if (opts.dryRun) {
      result.recovered.push({
        credential: cred,
        jobs,
        dryRun: true,
      });
      result.actions.push(`[DRY RUN] Would unsnooze ${jobs.length} job(s) for ${cred}`);
    } else {
      const unsnoozedJobs = [];
      for (const jobRef of jobs) {
        try {
          execSync(
            `node "${CRON_SNOOZE_SCRIPT}" --unsnooze "${jobRef}"`,
            { stdio: 'pipe', timeout: 15000 }
          );
          unsnoozedJobs.push(jobRef);
          result.actions.push(`Unsnoozed '${jobRef}' (${cred} recovered)`);
        } catch (err) {
          result.errors.push(`Failed to unsnooze '${jobRef}': ${err.message}`);
        }
      }

      if (unsnoozedJobs.length > 0) {
        result.recovered.push({
          credential: cred,
          jobs: unsnoozedJobs,
        });
      }

      // Remove from shield state
      clearShieldState(cred);
    }
  }

  return result;
}

// ── Status ────────────────────────────────────────────────
function showStatus() {
  const state = loadShieldState();
  const entries = Object.entries(state.shielded || {});

  if (opts.json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log('🛡️  No credentials currently shielded.');
    return;
  }

  console.log(`🛡️  ${entries.length} credential(s) currently shielded:`);
  for (const [cred, info] of entries) {
    const ago = timeSince(info.snoozedAt);
    console.log(`   ${cred}: ${info.snoozedJobs.length} job(s) snoozed (${ago})`);
    console.log(`      Reason: ${info.reason || info.detail}`);
    console.log(`      Jobs: ${info.snoozedJobs.join(', ')}`);
  }
}

// ── Helpers ───────────────────────────────────────────────

function getArg(args, flag, short) {
  const idx = args.findIndex(a => a === flag || (short && a === short));
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function runCredentialHealth() {
  try {
    const output = execSync(
      `node "${CREDENTIAL_HEALTH_SCRIPT}" --json 2>&1`,
      { stdio: 'pipe', timeout: 30000, encoding: 'utf8' }
    );
    const parsed = JSON.parse(output);
    return parsed.results || [];
  } catch (err) {
    // credential-health exits non-zero on failures, but stdout still has results
    try {
      const output = err.stdout || '';
      const parsed = JSON.parse(output);
      return parsed.results || [];
    } catch {
      return null;
    }
  }
}

function loadShieldMap() {
  try {
    if (fs.existsSync(SHIELD_MAP_PATH)) {
      return JSON.parse(fs.readFileSync(SHIELD_MAP_PATH, 'utf8'));
    }
  } catch {}
  return { maps: {} };
}

function getJobsForCredential(credential, shieldMap) {
  // Check explicit map first
  if (shieldMap.maps && shieldMap.maps[credential]) {
    return shieldMap.maps[credential].jobs || [];
  }

  // Auto-discover: list cron jobs and match by keyword
  try {
    const listOutput = execSync('openclaw cron list --json 2>/dev/null', {
      stdio: 'pipe', timeout: 10000, encoding: 'utf8',
    });
    const parsed = JSON.parse(listOutput);
    const jobs = parsed.jobs || parsed;
    const keyword = credential.split('-')[0].toLowerCase(); // e.g. "gmail" from "gmail-file"
    return jobs
      .filter(j => {
        const name = (j.name || '').toLowerCase();
        const payload = typeof j.payload === 'string' ? j.payload.toLowerCase() : '';
        return name.includes(keyword) || payload.includes(keyword);
      })
      .map(j => j.name || j.id);
  } catch {
    return [];
  }
}

function loadShieldState() {
  try {
    if (fs.existsSync(SHIELD_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(SHIELD_STATE_PATH, 'utf8'));
    }
  } catch {}
  return { shielded: {} };
}

function saveShieldState(credential, info) {
  const state = loadShieldState();
  state.shielded[credential] = info;
  const dir = path.dirname(SHIELD_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SHIELD_STATE_PATH, JSON.stringify(state, null, 2));
}

function clearShieldState(credential) {
  const state = loadShieldState();
  delete state.shielded[credential];
  const dir = path.dirname(SHIELD_STATE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SHIELD_STATE_PATH, JSON.stringify(state, null, 2));
}

function timeSince(isoString) {
  const then = new Date(isoString).getTime();
  const diff = Date.now() - then;
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ago`;
  if (hours > 0) return `${hours}h ${mins}m ago`;
  return `${mins}m ago`;
}

// ── Run ───────────────────────────────────────────────────
try {
  main();
} catch (err) {
  if (opts.json) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ cron-credential-shield: ' + err.message);
  }
  process.exit(1);
}
