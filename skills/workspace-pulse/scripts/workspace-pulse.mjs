#!/usr/bin/env node
/**
 * workspace-pulse.mjs — Quick workspace health snapshot
 *
 * Checks memory freshness, stale daily notes, cron health summary,
 * workspace file counts, and git status.
 *
 * Usage:
 *   node workspace-pulse.mjs [options]
 *
 * Options:
 *   --json         Output as JSON
 *   --quiet        Only show warnings/errors
 *   --stale-days N Days before memory is considered stale (default: 3)
 *   --no-git       Skip git status check
 *   --no-cron      Skip cron health check
 *   --no-memory    Skip memory freshness check
 */

import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';

const args = parseArgs(process.argv.slice(2), {
  alias: { j: 'json', q: 'quiet', s: 'stale-days' },
  boolean: ['json', 'quiet', 'no-git', 'no-cron', 'no-memory', 'help'],
  default: { 'stale-days': 3, quiet: false },
});

if (args.help) showHelp('workspace-pulse — Quick workspace health snapshot');

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// ── Helpers ──────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function daysAgo(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.floor(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
}

function severity(age, staleDays) {
  if (age === 0) return 'fresh';
  if (age === 1) return 'recent';
  if (age <= staleDays) return 'ok';
  if (age <= staleDays * 2) return 'warn';
  return 'stale';
}

const SEV_ICONS = {
  fresh: '🟢',
  recent: '🟢',
  ok: '🟡',
  warn: '🟠',
  stale: '🔴',
};

// ── Find workspace root ─────────────────────────────────────────────

function findWorkspace() {
  // Check common locations
  const candidates = [
    process.env.OPENCLAW_WORKSPACE,
    process.env.HOME && join(process.env.HOME, '.openclaw', 'workspace'),
    process.cwd(),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, 'SOUL.md'))) {
      return resolve(dir);
    }
  }
  // Fallback: try to find AGENTS.md walking up
  let cwd = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(cwd, 'AGENTS.md'))) return resolve(cwd);
    const parent = resolve(cwd, '..');
    if (parent === cwd) break;
    cwd = parent;
  }
  return resolve(process.cwd());
}

// ── Memory freshness check ──────────────────────────────────────────

function checkMemory(workspace, staleDays) {
  const memDir = join(workspace, 'memory');
  const memoryMd = join(workspace, 'MEMORY.md');
  const results = {
    memoryMd: null,
    dailyNotes: [],
    oldestNote: null,
    missingDays: [],
  };

  // MEMORY.md
  if (existsSync(memoryMd)) {
    const stat = statSync(memoryMd);
    const age = daysAgo(stat.mtime);
    results.memoryMd = {
      exists: true,
      lastModified: stat.mtime.toISOString(),
      ageDays: age,
      sizeBytes: stat.size,
      severity: severity(age, staleDays),
    };
  } else {
    results.memoryMd = { exists: false, severity: 'warn' };
  }

  // Daily notes
  if (existsSync(memDir)) {
    const files = readdirSync(memDir)
      .filter(f => f.endsWith('.md') && f !== 'heartbeat-state.json')
      .sort()
      .reverse();

    for (const file of files) {
      const filePath = join(memDir, file);
      const stat = statSync(filePath);
      const age = daysAgo(stat.mtime);
      results.dailyNotes.push({
        file,
        lastModified: stat.mtime.toISOString(),
        ageDays: age,
        sizeBytes: stat.size,
        severity: severity(age, staleDays),
      });
    }

    if (results.dailyNotes.length > 0) {
      results.oldestNote = results.dailyNotes[results.dailyNotes.length - 1];
    }

    // Check for missing recent days
    const today = new Date();
    for (let i = 1; i <= staleDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const filename = d.toISOString().split('T')[0] + '.md';
      if (!files.includes(filename)) {
        results.missingDays.push(filename);
      }
    }
  }

  return results;
}

// ── Cron health summary ─────────────────────────────────────────────

function checkCron() {
  const output = run('openclaw cron list');
  if (!output) return { error: 'Could not run openclaw cron list', jobs: [] };

  const lines = output.split('\n');
  const jobs = [];

  // Find header line and extract column positions
  let headerIdx = -1;
  let cols = {};
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('ID') && lines[i].includes('Name') && lines[i].includes('Status')) {
      headerIdx = i;
      // Extract column start positions from header
      const colNames = ['ID', 'Name', 'Schedule', 'Next', 'Last', 'Status', 'Target'];
      for (const name of colNames) {
        const idx = lines[i].indexOf(name);
        if (idx >= 0) cols[name] = idx;
      }
      break;
    }
  }

  if (headerIdx < 0 || Object.keys(cols).length < 4) {
    // Fallback: try split-based parsing
    return { error: 'Could not parse cron list header', jobs: [] };
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.includes('─')) continue;

    const extract = (name, nextName) => {
      const start = cols[name];
      const end = nextName ? cols[nextName] : line.length;
      if (start === undefined) return '';
      return line.substring(start, end).trim();
    };

    const id = extract('ID', 'Name');
    const name = extract('Name', 'Schedule');
    const lastStr = extract('Last', 'Status');
    const status = extract('Status', 'Target') || 'unknown';

    let nextRun = null;
    let lastRun = null;
    let sinceLastRun = null;

    if (lastStr !== 'never') {
      if (lastStr.endsWith('m ago') || lastStr.endsWith('h ago') || lastStr.endsWith('d ago')) {
        const match = lastStr.match(/(\d+)\s*(m|h|d)/);
        if (match) {
          const val = parseInt(match[1]);
          const unit = match[2];
          if (unit === 'm') sinceLastRun = val;
          else if (unit === 'h') sinceLastRun = val * 60;
          else if (unit === 'd') sinceLastRun = val * 60 * 24;
        }
      }
    }

    let sev = 'ok';
    if (status === 'error') sev = 'error';
    else if (status === 'disabled') sev = 'disabled';
    else if (sinceLastRun !== null && sinceLastRun > 1440) sev = 'warn'; // >24h

    jobs.push({
      id,
      name: name.length > 30 ? name.slice(0, 27) + '...' : name,
      status,
      lastRun: lastStr,
      sinceLastRunMin: sinceLastRun,
      severity: sev,
    });
  }

  return {
    jobs,
    total: jobs.length,
    errors: jobs.filter(j => j.severity === 'error').length,
    warnings: jobs.filter(j => j.severity === 'warn').length,
  };
}

// ── Git status ──────────────────────────────────────────────────────

function checkGit(workspace) {
  // Check for trackhub repo
  const trackhub = join(workspace, 'trackhub');
  const results = [];

  if (existsSync(join(trackhub, '.git'))) {
    const status = run('git status --porcelain', { cwd: trackhub });
    const branch = run('git branch --show-current', { cwd: trackhub });
    const lastCommit = run('git log -1 --format="%h %s (%cr)"', { cwd: trackhub });
    const unpushed = run('git log @{u}..HEAD --oneline', { cwd: trackhub });

    results.push({
      repo: 'trackhub',
      branch,
      lastCommit,
      dirty: status && status.length > 0,
      uncommittedFiles: status ? status.split('\n').length : 0,
      unpushedCommits: unpushed ? unpushed.split('\n').length : 0,
      severity: (status && status.length > 0) ? 'warn' : 'ok',
    });
  }

  // Check workspace itself
  if (existsSync(join(workspace, '.git'))) {
    const status = run('git status --porcelain', { cwd: workspace });
    const branch = run('git branch --show-current', { cwd: workspace });

    if (branch) {
      results.push({
        repo: 'workspace',
        branch,
        dirty: status && status.length > 0,
        uncommittedFiles: status ? status.split('\n').length : 0,
        severity: (status && status.length > 0) ? 'warn' : 'ok',
      });
    }
  }

  return results;
}

// ── Workspace file inventory ────────────────────────────────────────

function inventoryWorkspace(workspace) {
  const files = {};
  const check = (name, path) => {
    if (existsSync(path)) {
      const stat = statSync(path);
      files[name] = {
        exists: true,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      };
    } else {
      files[name] = { exists: false };
    }
  };

  check('AGENTS.md', join(workspace, 'AGENTS.md'));
  check('SOUL.md', join(workspace, 'SOUL.md'));
  check('USER.md', join(workspace, 'USER.md'));
  check('MEMORY.md', join(workspace, 'MEMORY.md'));
  check('TOOLS.md', join(workspace, 'TOOLS.md'));
  check('HEARTBEAT.md', join(workspace, 'HEARTBEAT.md'));
  check('IDENTITY.md', join(workspace, 'IDENTITY.md'));

  const memDir = join(workspace, 'memory');
  files.memoryDir = {
    exists: existsSync(memDir),
    fileCount: existsSync(memDir) ? readdirSync(memDir).filter(f => f.endsWith('.md')).length : 0,
  };

  const skillsDir = join(workspace, 'trackhub', 'skills');
  files.trackhubSkills = {
    exists: existsSync(skillsDir),
    skillCount: existsSync(skillsDir) ? readdirSync(skillsDir).filter(d => {
      return existsSync(join(skillsDir, d, 'SKILL.md'));
    }).length : 0,
  };

  return files;
}

// ── Format output ───────────────────────────────────────────────────

function formatResults(data, quiet) {
  const lines = [];

  lines.push('📊 Workspace Pulse');
  lines.push('─'.repeat(40));

  // Memory section
  if (data.memory) {
    lines.push('');
    lines.push('🧠 Memory');
    if (data.memory.memoryMd) {
      const mm = data.memory.memoryMd;
      const icon = mm.exists ? SEV_ICONS[mm.severity] : '🔴';
      if (!mm.exists) {
        lines.push(`  ${icon} MEMORY.md — missing`);
      } else {
        lines.push(`  ${icon} MEMORY.md — ${mm.ageDays}d old, ${(mm.sizeBytes / 1024).toFixed(1)}KB`);
      }
    }

    const recent = (data.memory.dailyNotes || []).slice(0, 5);
    for (const note of recent) {
      const icon = SEV_ICONS[note.severity];
      lines.push(`  ${icon} ${note.file} — ${note.ageDays}d old, ${(note.sizeBytes / 1024).toFixed(1)}KB`);
    }

    if (data.memory.missingDays && data.memory.missingDays.length > 0) {
      lines.push(`  🟠 Missing daily notes: ${data.memory.missingDays.join(', ')}`);
    }

    if (data.memory.oldestNote) {
      lines.push(`  📁 Oldest note: ${data.memory.oldestNote.file} (${data.memory.oldestNote.ageDays}d)`);
    }
  }

  // Cron section
  if (data.cron) {
    lines.push('');
    if (!data.cron || !data.cron.jobs) {
      lines.push('  ⚠️ Could not check cron (gateway unavailable?)');
    } else {
      lines.push(`⏰ Cron Jobs (${data.cron.total} total)`);
      if (data.cron.errors > 0) lines.push(`  🔴 ${data.cron.errors} error(s)`);
      if (data.cron.warnings > 0) lines.push(`  🟠 ${data.cron.warnings} warning(s)`);
      if (data.cron.errors === 0 && data.cron.warnings === 0) lines.push('  🟢 All healthy');

      for (const job of data.cron.jobs) {
        if (quiet && job.severity === 'ok') continue;
      const icon = job.severity === 'error' ? '🔴' : job.severity === 'warn' ? '🟠' : job.severity === 'disabled' ? '⚪' : '🟢';
      lines.push(`  ${icon} ${job.name} [${job.status}] last: ${job.lastRun}`);
    }
    }
  }

  // Git section
  if (data.git && data.git.length > 0) {
    lines.push('');
    lines.push('📦 Git Status');
    for (const repo of data.git) {
      const icon = repo.dirty ? '🟠' : '🟢';
      const dirty = repo.dirty ? ` (${repo.uncommittedFiles} uncommitted)` : '';
      const unpushed = repo.unpushedCommits > 0 ? ` (${repo.unpushedCommits} unpushed)` : '';
      lines.push(`  ${icon} ${repo.repo}/${repo.branch}${dirty}${unpushed}`);
      if (repo.lastCommit) lines.push(`     ${repo.lastCommit}`);
    }
  }

  // Workspace files
  if (data.inventory) {
    lines.push('');
    lines.push('📁 Workspace Files');
    const core = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md', 'IDENTITY.md'];
    for (const name of core) {
      const f = data.inventory[name];
      const icon = f.exists ? '✅' : '⚠️';
      lines.push(`  ${icon} ${name}${f.exists ? ` (${(f.sizeBytes / 1024).toFixed(1)}KB)` : ' — missing'}`);
    }
    const mem = data.inventory.memoryDir;
    if (mem.exists) {
      lines.push(`  📝 memory/ — ${mem.fileCount} daily notes`);
    }
    const skills = data.inventory.trackhubSkills;
    if (skills.exists) {
      lines.push(`  🛠️ trackhub/skills — ${skills.skillCount} skills`);
    }
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────

const workspace = findWorkspace();
const staleDays = parseInt(args['stale-days']) || 3;

const results = {
  timestamp: new Date().toISOString(),
  workspace,
};

if (!args['no-memory']) {
  results.memory = checkMemory(workspace, staleDays);
}
if (!args['no-cron']) {
  results.cron = checkCron();
}
if (!args['no-git']) {
  results.git = checkGit(workspace);
}
results.inventory = inventoryWorkspace(workspace);

if (args.json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(formatResults(results, args.quiet));
}
