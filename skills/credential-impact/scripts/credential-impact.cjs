#!/usr/bin/env node
// credential-impact — One-shot credential failure impact report
// Chains credential-health → credential-remediation → cron-deps blast radius
// Zero dependencies. Node.js 18+.

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const quiet = args.includes('--quiet') || args.includes('-q');
const checkArg = args.find((a, i) => args[i - 1] === '--check');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`credential-impact — One-shot credential failure impact report

Usage: node credential-impact.cjs [options]

Options:
  --check <service>   Only check a specific service (passed to credential-health)
  --json              Output structured JSON
  --quiet, -q         Only show failures and impact (no header/padding)
  --help, -h          Show this help

Description:
  Runs credential-health to detect failures, then for each failure:
  1. Gets remediation steps from credential-remediation
  2. Computes blast radius from cron-deps (which cron jobs are affected)
  3. Outputs a consolidated report

Exit codes:
  0 — All credentials healthy (or --quiet with no failures)
  1 — One or more credential failures detected
  2 — Invalid arguments or missing dependencies`);
  process.exit(0);
}

// Resolve sibling skill script paths
const skillsDir = path.resolve(__dirname, '..', '..');
const healthScript = path.join(skillsDir, 'credential-health', 'scripts', 'credential-health.cjs');
const remediateScript = path.join(skillsDir, 'credential-remediation', 'scripts', 'remediate.cjs');
const depsScript = path.join(skillsDir, 'cron-deps', 'scripts', 'cron-deps.cjs');

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
  } catch (err) {
    // Non-zero exit is expected for failures — return stdout if available
    return err.stdout ? err.stdout.trim() : null;
  }
}

function getFailures() {
  let cmd = `node "${healthScript}" --fail-only --json`;
  if (checkArg) cmd += ` --check ${checkArg}`;
  const raw = run(cmd);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return (parsed.results || []).filter(r => r.status === 'fail');
  } catch {
    return [];
  }
}

function getRemediation(service, detail) {
  const cmd = `node "${remediateScript}" --service "${service}" --detail "${(detail || '').replace(/"/g, '\\"')}" --json`;
  const raw = run(cmd);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getBlastRadius(resource) {
  const cmd = `node "${depsScript}" --blast-radius "${resource}" --json`;
  const raw = run(cmd);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // cron-deps --blast-radius --json returns { blastRadius: { affectedJobs: [...] } }
    return parsed.blastRadius || parsed;
  } catch {
    return null;
  }
}

function main() {
  const failures = getFailures();

  if (failures.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ status: 'ok', failures: [], report: [] }, null, 2));
    } else if (!quiet) {
      console.log('✅ All credentials healthy — no impact to report.');
    }
    process.exit(0);
  }

  const reports = failures.map(f => {
    const service = f.service || 'unknown';
    const remediation = getRemediation(service, f.detail);
    const blastRadius = getBlastRadius(service);

    return {
      service,
      status: f.status,
      detail: f.detail,
      remediation,
      blastRadius,
    };
  });

  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'fail', failures: reports }, null, 2));
    process.exit(1);
  }

  // Human-readable consolidated report
  if (!quiet) {
    console.log('🔴 Credential Impact Report');
    console.log('═'.repeat(50));
    console.log();
  }

  for (const report of reports) {
    const severityEmoji = report.remediation?.severity === 'high' ? '🚨' :
                          report.remediation?.severity === 'medium' ? '⚠️' : '❌';

    console.log(`${severityEmoji} ${report.service.toUpperCase()}: ${report.detail || 'Credential check failed'}`);
    console.log('─'.repeat(50));

    // Remediation steps
    if (report.remediation && report.remediation.steps && report.remediation.steps.length > 0) {
      console.log();
      console.log('🔧 How to fix:');
      report.remediation.steps.forEach((step, i) => {
        console.log(`   ${i + 1}. ${step}`);
      });
    }

    // Blast radius
    const affected = report.blastRadius?.affectedJobs ||
                     report.blastRadius?.jobs ||
                     (Array.isArray(report.blastRadius) ? report.blastRadius : []);

    if (affected.length > 0) {
      console.log();
      console.log(`💥 ${affected.length} cron job(s) affected:`);
      affected.forEach(job => {
        const name = job.name || job.label || job.id || 'unknown';
        const rawSchedule = job.schedule || job.cron || '';
        const schedule = typeof rawSchedule === 'string'
          ? rawSchedule
          : (rawSchedule?.expr || JSON.stringify(rawSchedule));
        const disabled = job.disabled || job.enabled === false ? ' (DISABLED)' : '';
        console.log(`   • ${name}${schedule ? ' — ' + schedule : ''}${disabled}`);
      });
    } else {
      console.log();
      console.log('💥 No cron jobs directly affected by this credential.');
    }

    // Env vars to check
    if (report.remediation?.env_vars?.length > 0) {
      console.log();
      console.log(`🔑 Env vars: ${report.remediation.env_vars.join(', ')}`);
    }

    // Docs link
    if (report.remediation?.docs_url) {
      console.log(`📖 Docs: ${report.remediation.docs_url}`);
    }

    console.log();
  }

  process.exit(1);
}

try {
  main();
} catch (err) {
  if (jsonOutput) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ credential-impact: ' + err.message);
  }
  process.exit(2);
}
