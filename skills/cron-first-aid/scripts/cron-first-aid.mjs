#!/usr/bin/env node
/**
 * Cron First Aid 🩹
 *
 * Analyze OpenClaw cron job failures and suggest safe repairs.
 * Detects common failure patterns: missing scripts, expired credentials,
 * delivery misconfigurations, stale payloads, and more.
 *
 * Usage:
 *   node cron-first-aid.mjs                      # Full diagnosis of all jobs
 *   node cron-first-aid.mjs --fail-only          # Only show problems
 *   node cron-first-aid.mjs --job <id>           # Diagnose specific job
 *   node cron-first-aid.mjs --repair --dry-run   # Suggest repairs without applying
 *   node cron-first-aid.mjs --repair             # Apply safe repairs
 *   node cron-first-aid.mjs --json               # JSON output
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// ── Arg parsing (inline, no deps) ──────────────────────────────────

function parseArgs(argv) {
  const result = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let key, val;
      if (eq !== -1) { key = arg.slice(2, eq); val = arg.slice(eq + 1); }
      else { key = arg.slice(2); }
      if (val === undefined) {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { val = next; i++; }
      }
      result[key] = val === undefined ? true : val;
    } else {
      result._.push(arg);
    }
    i++;
  }
  return result;
}

// ── OpenClaw CLI helpers ───────────────────────────────────────────

function runOpenclaw(args, timeout = 15000) {
  try {
    const out = execSync(`openclaw ${args}`, {
      encoding: 'utf8',
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, data: out.trim() };
  } catch (e) {
    return { ok: false, data: e.stderr?.trim() || e.message };
  }
}

function getCronJobs() {
  const r = runOpenclaw('cron list --json');
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.data);
    return parsed.jobs || [];
  } catch {
    return [];
  }
}

function getJobRuns(jobId, limit = 5) {
  const r = runOpenclaw(`cron runs --id ${jobId} --limit ${limit}`);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.data);
    return parsed.entries || [];
  } catch {
    return [];
  }
}

// ── Diagnosis engine ───────────────────────────────────────────────

/**
 * Extract script paths from a payload message string.
 */
function extractScriptPaths(payloadText) {
  if (!payloadText) return [];
  const paths = [];
  // Match patterns like: Run: node /path/to/script.mjs
  // Or: node /path/to/script.mjs --flags
  const patterns = [
    /(?:Run:|run:)\s*(?:node|python3?|bash|sh)\s+(\S+)/gi,
    /(?:node|python3?|bash|sh)\s+([\S]+\.m?js|[\S]+\.py|[\S]+\.sh)/gi,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(payloadText)) !== null) {
      let p = m[1];
      // Strip trailing flags/options
      p = p.split(/\s+/)[0];
      if (p && !paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

/**
 * Check if a path exists on disk.
 */
function checkPath(pathStr) {
  // Resolve relative to common base paths
  const candidates = [
    resolve(pathStr),
    resolve(process.cwd(), pathStr),
    resolve(process.env.HOME || '/root', pathStr),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { exists: true, resolved: c };
  }
  return { exists: false, resolved: pathStr };
}

/**
 * Diagnose a single cron job.
 */
function diagnoseJob(job, recentRuns = []) {
  const findings = [];

  // 1. Check for consecutive errors
  const errors = recentRuns.filter(r => r.status === 'error' || r.status === 'fail');
  if (errors.length > 0) {
    findings.push({
      severity: errors.length >= 3 ? 'error' : 'warn',
      code: 'consecutive_errors',
      message: `${errors.length} consecutive error(s) in recent runs`,
      detail: `Last error: ${errors[0]?.summary || 'no summary'}`,
      repairable: false,
    });
  }

  // 2. Check delivery status
  const lastRun = recentRuns[0];
  if (lastRun) {
    if (lastRun.deliveryStatus === 'not-delivered' && lastRun.delivered === false) {
      // Check if this is expected (NO_REPLY) or a real problem
      // Only flag if output is substantial (> 300 tokens) — lower is likely NO_REPLY
      const outputTokens = lastRun.usage?.output_tokens || 0;
      if (outputTokens > 300) {
        // Output was significant but not delivered — real problem
        findings.push({
          severity: 'warn',
          code: 'delivery_failed',
          message: 'Last run produced output but was not delivered',
          detail: `Output: ${lastRun.usage?.output_tokens} tokens (likely meaningful, not NO_REPLY)`,
          repairable: true,
        });
      }
      // Low output + not-delivered is likely NO_REPLY — skip
    }

    // 3. Check for suspiciously short runs (possible script errors)
    if (lastRun.durationMs && lastRun.durationMs < 2000 && lastRun.usage?.output_tokens < 50) {
      findings.push({
        severity: 'warn',
        code: 'suspicious_run',
        message: 'Last run was very short with minimal output — possible silent failure',
        detail: `Duration: ${lastRun.durationMs}ms, Output: ${lastRun.usage?.output_tokens} tokens`,
        repairable: false,
      });
    }
  }

  // 4. Check referenced scripts exist
  const payloadText = job.payload?.message || job.payload?.text || '';
  const scriptPaths = extractScriptPaths(payloadText);
  for (const sp of scriptPaths) {
    const check = checkPath(sp);
    if (!check.exists) {
      findings.push({
        severity: 'error',
        code: 'missing_script',
        message: `Referenced script does not exist: ${sp}`,
        detail: `Script path in payload not found on disk`,
        repairable: true,
        missingPath: sp,
      });
    }
  }

  // 5. Check for common payload anti-patterns
  if (payloadText) {
    // Vague payload (no numbered steps, no script reference)
    if (!payloadText.match(/\d\./) && !payloadText.match(/Run:/i) && !payloadText.match(/node |python/i)) {
      if (payloadText.length < 200) {
        findings.push({
          severity: 'warn',
          code: 'vague_payload',
          message: 'Payload appears vague — no numbered steps or script references',
          detail: 'Isolated sessions need complete, explicit instructions',
          repairable: false,
        });
      }
    }

    // Missing NO_REPLY instruction for conditional output jobs
    if (payloadText.includes('If') && payloadText.includes('empty') && !payloadText.includes('NO_REPLY')) {
      findings.push({
        severity: 'info',
        code: 'missing_no_reply',
        message: 'Payload has conditional logic but no NO_REPLY instruction',
        detail: 'Consider adding "reply exactly NO_REPLY" for the empty/no-change case to save tokens',
        repairable: true,
      });
    }
  }

  // 6. Check delivery config
  if (job.delivery?.mode === 'announce') {
    if (!job.delivery?.channel) {
      findings.push({
        severity: 'error',
        code: 'missing_delivery_channel',
        message: 'Delivery mode is "announce" but no channel specified',
        detail: 'When multiple channels are configured, the channel must be explicit',
        repairable: true,
      });
    }
  }

  // 7. Check for stale jobs (never run or very old last run)
  if (!lastRun && job.enabled) {
    findings.push({
      severity: 'warn',
      code: 'never_run',
      message: 'Job is enabled but has never run',
      detail: 'Check schedule expression and scheduler status',
      repairable: false,
    });
  }

  // 8. Check for credential-related errors in summaries
  const credErrorPatterns = [
    /invalid_grant/i,
    /token.*expir/i,
    /unauthorized/i,
    /401/i,
    /403/i,
    /auth/i,
    /credential/i,
  ];
  for (const run of recentRuns.slice(0, 3)) {
    const summary = run.summary || '';
    for (const pat of credErrorPatterns) {
      if (pat.test(summary)) {
        findings.push({
          severity: 'error',
          code: 'credential_error',
          message: `Credential/auth error detected in recent run`,
          detail: `Run summary: "${summary.slice(0, 200)}"`,
          repairable: false,
        });
        break;
      }
    }
  }

  return findings;
}

// ── Repair suggestions ────────────────────────────────────────────

function suggestRepairs(job, findings) {
  const repairs = [];

  for (const f of findings) {
    switch (f.code) {
      case 'missing_script': {
        // Try to find a similar script in the same directory
        const missing = f.missingPath;
        const dir = missing.substring(0, missing.lastIndexOf('/'));
        const baseName = missing.substring(missing.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

        if (existsSync(dir)) {
          try {
            const files = execSync(`ls ${dir}/*.mjs ${dir}/*.js ${dir}/*.py ${dir}/*.sh 2>/dev/null`, { encoding: 'utf8' })
              .trim().split('\n').filter(Boolean);
            // Find files with similar names
            const similar = files.filter(f => {
              const name = f.split('/').pop().replace(/\.[^.]+$/, '');
              return name !== baseName && (name.includes(baseName) || baseName.includes(name));
            });
            if (similar.length > 0) {
              repairs.push({
                finding: f.code,
                action: 'replace_script',
                description: `Found similar script(s): ${similar.join(', ')}`,
                confidence: 'medium',
                command: `openclaw cron edit ${job.id} --payload.message "$(echo '${job.payload?.message || ''}' | sed 's|${missing}|${similar[0]}|g')"`,
                manual: `Consider replacing "${missing}" with "${similar[0]}" in the job payload`,
              });
            }
          } catch {
            // directory listing failed, skip
          }
        }
        repairs.push({
          finding: f.code,
          action: 'manual_review',
          description: `Script "${missing}" needs to be created or the payload needs updating`,
          confidence: 'high',
          manual: `Check if the script was renamed or moved. Update the payload to reference the correct path.`,
        });
        break;
      }

      case 'missing_delivery_channel': {
        repairs.push({
          finding: f.code,
          action: 'set_channel',
          description: 'Add explicit channel to delivery config',
          confidence: 'high',
          command: `openclaw cron edit ${job.id} --delivery.channel slack`,
          manual: `Set delivery.channel to "slack", "whatsapp", or the appropriate channel`,
        });
        break;
      }

      case 'missing_no_reply': {
        repairs.push({
          finding: f.code,
          action: 'add_no_reply',
          description: 'Add NO_REPLY instruction for the no-change case',
          confidence: 'high',
          manual: `Add "If no changes found, reply exactly NO_REPLY" to the payload`,
        });
        break;
      }

      case 'credential_error': {
        repairs.push({
          finding: f.code,
          action: 'check_credentials',
          description: 'Run credential-health check for the affected service',
          confidence: 'high',
          command: 'node trackhub/skills/credential-health/scripts/credential-health.cjs --check all --json',
          manual: `Re-authenticate the affected credential and verify it works`,
        });
        break;
      }

      case 'delivery_failed': {
        repairs.push({
          finding: f.code,
          action: 'check_delivery',
          description: 'Verify delivery channel config and try a manual run',
          confidence: 'medium',
          command: `openclaw cron run --id ${job.id}`,
          manual: `Run the job manually with --debug to see why delivery failed`,
        });
        break;
      }

      default: {
        if (f.repairable) {
          repairs.push({
            finding: f.code,
            action: 'manual_review',
            description: f.message,
            confidence: 'low',
            manual: f.detail,
          });
        }
      }
    }
  }

  return repairs;
}

// ── Report formatting ──────────────────────────────────────────────

function formatReport(results) {
  const total = results.length;
  const problems = results.filter(r => r.findings.some(f => f.severity === 'error' || f.severity === 'warn'));
  const errors = results.reduce((n, r) => n + r.findings.filter(f => f.severity === 'error').length, 0);
  const warnings = results.reduce((n, r) => n + r.findings.filter(f => f.severity === 'warn').length, 0);
  const infos = results.reduce((n, r) => n + r.findings.filter(f => f.severity === 'info').length, 0);
  const clean = total - problems.length;

  console.log('');
  console.log('══ Cron First Aid Report ══');
  console.log(`${clean} healthy · ${warnings} warning(s) · ${errors} error(s) · ${infos} info · ${total} total`);
  console.log('');

  if (problems.length === 0) {
    console.log('✅ All jobs look healthy!');
    return;
  }

  for (const result of results) {
    if (result.findings.length === 0) continue;

    const { job, findings, repairs } = result;
    const worstSeverity = findings.some(f => f.severity === 'error') ? 'error' : 'warn';
    const icon = worstSeverity === 'error' ? '❌' : '⚠️';

    console.log(`${icon} ${job.name}`);
    console.log(`   ID: ${job.id}`);
    console.log(`   Schedule: ${job.schedule?.expr || 'N/A'} @ ${job.schedule?.tz || 'UTC'}`);
    if (!job.enabled) console.log('   Status: DISABLED');
    console.log('');

    for (const f of findings) {
      const sevIcon = f.severity === 'error' ? '🔴' : f.severity === 'warn' ? '🟡' : '🔵';
      console.log(`   ${sevIcon} [${f.code}] ${f.message}`);
      if (f.detail) console.log(`      ${f.detail}`);
      console.log('');
    }

    if (repairs.length > 0) {
      console.log('   🩹 Repairs:');
      for (const r of repairs) {
        console.log(`      • ${r.description}`);
        if (r.manual) console.log(`        → ${r.manual}`);
        if (r.confidence) console.log(`        Confidence: ${r.confidence}`);
        console.log('');
      }
    }

    console.log('─'.repeat(60));
    console.log('');
  }
}

function formatJson(results) {
  const output = results.map(r => ({
    job: {
      id: r.job.id,
      name: r.job.name,
      enabled: r.job.enabled,
      schedule: r.job.schedule,
    },
    findings: r.findings,
    repairs: r.repairs,
  }));
  console.log(JSON.stringify(output, null, 2));
}

// ── Main ───────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(`Cron First Aid 🩹 — Diagnose and suggest repairs for broken cron jobs

Usage: node cron-first-aid.mjs [options]

Options:
  --job <id>          Diagnose a specific job only
  --fail-only         Only show jobs with problems
  --repair            Apply safe repairs (interactive confirmation)
  --dry-run           Show what repairs would be applied without doing anything
  --json              JSON output
  --max-runs <n>      Recent runs to check per job (default: 5)
  -h, --help          Show this help

Examples:
  node cron-first-aid.mjs
  node cron-first-aid.mjs --fail-only
  node cron-first-aid.mjs --job 10782216-8d1b-4834-9d38-4732be0c5c88
  node cron-first-aid.mjs --repair --dry-run
  node cron-first-aid.mjs --json`);
    process.exit(0);
  }

  const jobs = getCronJobs();
  if (jobs.length === 0) {
    console.log('No cron jobs found.');
    process.exit(0);
  }

  // Filter by specific job
  let targetJobs = jobs;
  if (args.job) {
    targetJobs = jobs.filter(j => j.id === args.job || j.name.includes(args.job));
    if (targetJobs.length === 0) {
      console.error(`Job not found: ${args.job}`);
      process.exit(1);
    }
  }

  const maxRuns = parseInt(args['max-runs'] || '5', 10);
  const results = [];

  for (const job of targetJobs) {
    if (!job.enabled && !args.job) continue; // Skip disabled unless targeted

    const runs = getJobRuns(job.id, maxRuns);
    const findings = diagnoseJob(job, runs);
    const repairs = args.repair || args['dry-run'] ? suggestRepairs(job, findings) : [];

    results.push({ job, findings, repairs, runs });
  }

  // Filter: fail-only
  const filtered = args['fail-only']
    ? results.filter(r => r.findings.some(f => f.severity === 'error' || f.severity === 'warn'))
    : results;

  if (args.json) {
    formatJson(filtered);
  } else {
    formatReport(filtered);
  }

  // Exit code
  const hasErrors = filtered.some(r => r.findings.some(f => f.severity === 'error'));
  const hasWarnings = filtered.some(r => r.findings.some(f => f.severity === 'warn'));
  if (hasErrors) process.exit(2);
  if (hasWarnings) process.exit(1);
  process.exit(0);
}

main();
