#!/usr/bin/env node
// morning-briefing — Aggregates system, credential, cron, and Slack status into a morning briefing
// Zero dependencies. Node.js 18+.

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const quiet = args.includes('--quiet') || args.includes('-q');
const brief = args.includes('--brief');

if (args.includes('--help') || args.includes('-h')) {
  console.log('morning-briefing — Generate a morning briefing from multiple sources');
  console.log('Usage: node morning-briefing.cjs [options]');
  console.log('');
  console.log('Options:');
  console.log('  --json     JSON output');
  console.log('  --brief    Only show warnings/issues');
  console.log('  --quiet    Suppress stdout (exit code only)');
  console.log('  --help     Show this help');
  process.exit(0);
}

// Resolve skill base directory (parent of scripts/)
const SKILL_DIR = path.resolve(__dirname, '..');
const TRACKHUB_DIR = path.resolve(SKILL_DIR, '..');

function runScript(relPath, extraArgs = []) {
  const scriptPath = path.resolve(TRACKHUB_DIR, relPath);
  try {
    const result = execSync(`node "${scriptPath}" --json ${extraArgs.join(' ')}`, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result.trim());
  } catch (err) {
    // Some scripts exit non-zero but still output JSON on stdout
    if (err.stdout) {
      try { return JSON.parse(err.stdout.trim()); } catch (_) { /* fall through */ }
    }
    return { _error: err.message.split('\n')[0] };
  }
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function main() {
  const briefing = {
    generated: new Date().toISOString(),
    sections: {},
    warnings: [],
  };

  // 1. System health
  const sysHealth = runScript('system-health/scripts/system-health.cjs');
  briefing.sections.system = sysHealth;
  if (sysHealth.memory && sysHealth.memory.pct > 85) {
    briefing.warnings.push(`Memory usage high: ${sysHealth.memory.pct.toFixed(1)}%`);
  }
  if (sysHealth.disk) {
    for (const d of (Array.isArray(sysHealth.disk) ? sysHealth.disk : [sysHealth.disk])) {
      if (d.pct > 85) briefing.warnings.push(`Disk ${d.mount} usage: ${d.pct}%`);
    }
  }
  if (sysHealth.temperature && sysHealth.temperature.celsius > 70) {
    briefing.warnings.push(`CPU temp high: ${sysHealth.temperature.celsius}°C`);
  }

  // 2. Credential health
  const credHealth = runScript('credential-health/scripts/credential-health.cjs');
  briefing.sections.credentials = credHealth;
  if (credHealth.results) {
    for (const r of credHealth.results) {
      if (r.status === 'fail') {
        briefing.warnings.push(`Credential ${r.service}: ${r.detail}`);
      }
    }
  }

  // 3. Cron health (try cron-dashboard if available)
  const cronDash = runScript('cron-dashboard/scripts/cron-dashboard.cjs', ['--json']);
  if (!cronDash._error) {
    briefing.sections.cron = cronDash;
    if (cronDash.summary) {
      if (cronDash.summary.failed > 0) {
        briefing.warnings.push(`Cron: ${cronDash.summary.failed} failed job(s)`);
      }
      if (cronDash.summary.disabled > 0) {
        briefing.warnings.push(`Cron: ${cronDash.summary.disabled} disabled job(s)`);
      }
    }
  }

  // 4. Slack recent (last 12h) — look for unanswered mentions
  let slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    try {
      const config = JSON.parse(
        execSync('cat "$HOME/.openclaw/openclaw.json"', { encoding: 'utf-8' })
      );
      slackToken = config.channels?.slack?.botToken;
    } catch (_) {}
  }
  if (slackToken) {
    try {
      const slackScript = path.resolve(TRACKHUB_DIR, 'slack-channel-reader/scripts/slack-channel-reader.mjs');
      const slackResult = execSync(
        `SLACK_BOT_TOKEN="${slackToken}" node "${slackScript}" --channel C0ANLG7P290 --since "12h" --json --limit 10`,
        { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const messages = JSON.parse(slackResult.trim());
      briefing.sections.slack = { recentCount: messages.length || 0, messages: messages };
    } catch (err) {
      if (err.stdout) {
        try {
          const msgs = JSON.parse(err.stdout.trim());
          briefing.sections.slack = { recentCount: msgs.length || 0 };
        } catch (_) {
          briefing.sections.slack = { recentCount: 0, _note: 'No messages or parse error' };
        }
      } else {
        briefing.sections.slack = { recentCount: 0 };
      }
    }
  }

  // Output
  if (jsonOut) {
    console.log(JSON.stringify(briefing, null, 2));
  } else if (!quiet) {
    printHumanBriefing(briefing);
  }

  // Exit code: 1 if warnings, 0 if clean
  process.exit(briefing.warnings.length > 0 ? 1 : 0);
}

function printHumanBriefing(b) {
  const sys = b.sections.system;
  const cred = b.sections.credentials;
  const cron = b.sections.cron;
  const slack = b.sections.slack;

  console.log('☀️ Morning Briefing');
  console.log(`   ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`);
  console.log('');

  // System
  if (sys && !sys._error) {
    console.log('🖥️  System');
    console.log(`   Uptime: ${sys.uptime?.human || 'unknown'}`);
    console.log(`   Memory: ${sys.memory?.pct?.toFixed(1) || '?'}% used`);
    console.log(`   Disk: ${sys.disk?.[0]?.pct || '?'}% used`);
    console.log(`   CPU temp: ${sys.temperature?.celsius || '?'}°C`);
    console.log('');
  }

  // Credentials
  if (cred && cred.results) {
    const fails = cred.results.filter(r => r.status === 'fail');
    const oks = cred.results.filter(r => r.status === 'ok');
    console.log('🔑 Credentials');
    console.log(`   OK: ${oks.length} | Failed: ${fails.length}`);
    for (const f of fails) {
      console.log(`   ⚠️  ${f.service}: ${f.detail}`);
    }
    console.log('');
  }

  // Cron
  if (cron && !cron._error) {
    console.log('⏰ Cron Jobs');
    if (cron.summary) {
      console.log(`   Total: ${cron.summary.total || '?'} | Failed: ${cron.summary.failed || 0} | Disabled: ${cron.summary.disabled || 0}`);
    }
    console.log('');
  }

  // Slack
  if (slack) {
    console.log('💬 Slack (shared channel)');
    console.log(`   Recent messages (12h): ${slack.recentCount || 0}`);
    console.log('');
  }

  // Warnings summary
  if (b.warnings.length > 0) {
    console.log('⚠️  Warnings');
    for (const w of b.warnings) {
      console.log(`   • ${w}`);
    }
  } else {
    console.log('✅ All clear — no warnings');
  }
}

try {
  main();
} catch (err) {
  if (jsonOut) {
    console.log(JSON.stringify({ status: 'error', error: err.message }));
  } else {
    console.error('❌ morning-briefing: ' + err.message);
  }
  process.exit(2);
}
