#!/usr/bin/env node
// repo-watcher.cjs — Monitor git repos for new commits, branches, and tags
// Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// --- CLI Args ---
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repos: [],
    since: '24h',
    branch: null,
    mode: 'summary',  // summary | detail | commits
    json: false,
    stateFile: path.join(os.homedir(), '.openclaw', 'workspace', 'memory', 'repo-watcher-state.json'),
    noUpdate: false,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repos' || a === '-r') { opts.repos = args[++i].split(','); continue; }
    if (a === '--since' || a === '-s') { opts.since = args[++i]; continue; }
    if (a === '--branch' || a === '-b') { opts.branch = args[++i]; continue; }
    if (a === '--mode' || a === '-m') { opts.mode = args[++i]; continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--state-file') { opts.stateFile = args[++i]; continue; }
    if (a === '--no-update') { opts.noUpdate = true; continue; }
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    // bare path = repo
    if (a.startsWith('/') || a.startsWith('.') || a.startsWith('~')) { opts.repos.push(a); continue; }
    // shorthand: owner/repo → assume GitHub, use cached clone or remote log
    opts.repos.push(a);
  }
  return opts;
}

function showHelp() {
  console.log(`repo-watcher.cjs — Monitor git repos for new commits, branches, and tags

Usage:
  node repo-watcher.cjs --repos <path_or_remote> [options]

Arguments:
  --repos, -r    Comma-separated repo paths or GitHub owner/repo strings
                 Can also be passed as bare positional arguments
  --since, -s    Time window (default: "24h"). Examples: "1h", "6h", "7d", "2026-04-20"
  --branch, -b   Filter to specific branch (default: all branches)
  --mode, -m     Output mode: summary | detail | commits (default: summary)
  --json         Raw JSON output
  --state-file   Path to state file (default: ~/.openclaw/workspace/memory/repo-watcher-state.json)
  --no-update    Don't update the state file after checking
  --help, -h     Show this help

Examples:
  node repo-watcher.cjs ~/projects/my-repo
  node repo-watcher.cjs --repos ~/repo1,~/repo2 --since 6h
  node repo-watcher.cjs openclaw/openclaw --since 1d --mode commits
  node repo-watcher.cjs -r ~/trackhub -m detail --json

Output modes:
  summary  — One line per repo: name | commits count | branches changed | new tags
  detail   — Per-repo breakdown with commit list (hash, author, subject, date)
  commits  — Just the commit list across all repos (flat)

State file tracks last-seen commit per repo/branch for incremental monitoring.`);
}

// --- State Management ---
function loadState(stateFile) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { repos: {} };
  }
}

function saveState(stateFile, state) {
  const dir = path.dirname(stateFile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// --- Git Operations ---
function git(repoPath, ...args) {
  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (e) {
    return null;
  }
}

function isLocalRepo(p) {
  return fs.existsSync(path.resolve(p.replace(/^~/, os.homedir()), '.git'));
}

function resolvePath(p) {
  return p.replace(/^~/, os.homedir());
}

// --- Repo Analysis ---
function analyzeRepo(repoPath, since, branch) {
  const resolved = resolvePath(repoPath);
  const name = path.basename(resolved);

  if (!isLocalRepo(resolved)) {
    return { name: repoPath, error: 'Not a local git repo or path does not exist', commits: [], branches: [], tags: [] };
  }

  const result = { name, path: resolved, commits: [], branches: [], tags: [], currentBranch: null };

  // Current branch
  result.currentBranch = git(resolved, 'rev-parse', '--abbrev-ref', 'HEAD');

  // Fetch latest (non-bare, with timeout)
  const remote = git(resolved, 'remote');
  if (remote) {
    try {
      execSync('git fetch --quiet --all 2>/dev/null', { cwd: resolved, timeout: 30000 });
    } catch {
      // fetch failed, continue with local data
    }
  }

  // New commits
  const branchRef = branch || '--all';
  const logCmd = branch
    ? `git log ${branch} --since="${since}" --pretty=format:"%H|%an|%ae|%aI|%s" --no-merges`
    : `git log --all --since="${since}" --pretty=format:"%H|%an|%ae|%aI|%s" --no-merges`;
  try {
    const logOutput = execSync(logCmd, { cwd: resolved, encoding: 'utf8', timeout: 15000 });
    result.commits = logOutput.trim().split('\n').filter(Boolean).map(line => {
      const [hash, author, email, date, ...subjectParts] = line.split('|');
      return { hash: hash.substring(0, 8), author, email, date, subject: subjectParts.join('|') };
    });
  } catch {
    result.commits = [];
  }

  // Branch changes (recently created or updated)
  try {
    const branchOutput = execSync(
      `git for-each-ref --sort=-committerdate refs/heads/ --format="%(refname:short)|%(committerdate:iso8601)|%(committerdate:relative)"`,
      { cwd: resolved, encoding: 'utf8', timeout: 15000 }
    );
    const sinceDate = parseSince(since);
    result.branches = branchOutput.trim().split('\n').filter(Boolean).map(line => {
      const [name, date, relative] = line.split('|');
      return { name, date, relative };
    }).filter(b => {
      if (!b.date) return false;
      try { return new Date(b.date) >= sinceDate; } catch { return false; }
    });
  } catch {
    result.branches = [];
  }

  // New tags
  try {
    const tagOutput = execSync(
      `git tag --sort=-creatordate --format="%(refname:short)|%(creatordate:iso8601)" --merged HEAD`,
      { cwd: resolved, encoding: 'utf8', timeout: 15000 }
    );
    const allTags = tagOutput.trim().split('\n').filter(Boolean).map(line => {
      const [name, date] = line.split('|');
      return { name, date };
    });
    // Filter to only those created within the since window
    result.tags = allTags.filter(t => {
      if (!t.date) return false;
      try {
        const tagDate = new Date(t.date);
        const sinceDate = parseSince(since);
        return tagDate >= sinceDate;
      } catch {
        return false;
      }
    });
  } catch {
    result.tags = [];
  }

  return result;
}

function parseSince(since) {
  const now = new Date();
  // Support: 1h, 6h, 1d, 7d, 30m, ISO date
  const match = since.match(/^(\d+)([mhd])$/);
  if (match) {
    const val = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
      case 'm': return new Date(now.getTime() - val * 60000);
      case 'h': return new Date(now.getTime() - val * 3600000);
      case 'd': return new Date(now.getTime() - val * 86400000);
    }
  }
  // Try ISO date
  const d = new Date(since);
  return isNaN(d.getTime()) ? new Date(now.getTime() - 86400000) : d;
}

// --- Formatting ---
function formatSummary(results) {
  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`⚠ ${r.name} — ${r.error}`);
      continue;
    }
    const parts = [`${r.name}`];
    const c = r.commits.length;
    const b = r.branches.length;
    const t = r.tags.length;
    if (c > 0) parts.push(`${c} commit${c > 1 ? 's' : ''}`);
    if (b > 0) parts.push(`${b} branch update${b > 1 ? 's' : ''}`);
    if (t > 0) parts.push(`${t} new tag${t > 1 ? 's' : ''}`);
    if (c === 0 && b === 0 && t === 0) parts.push('no changes');
    lines.push(`✅ ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

function formatDetail(results) {
  const lines = [];
  for (const r of results) {
    if (r.error) {
      lines.push(`⚠ ${r.name} — ${r.error}\n`);
      continue;
    }
    lines.push(`📦 ${r.name}${r.currentBranch ? ` (${r.currentBranch})` : ''}`);
    lines.push(`   Path: ${r.path}`);
    if (r.commits.length > 0) {
      lines.push(`   Commits (${r.commits.length}):`);
      for (const c of r.commits.slice(0, 10)) {
        lines.push(`   • ${c.hash} ${c.author} — ${c.subject}`);
      }
      if (r.commits.length > 10) lines.push(`   ... and ${r.commits.length - 10} more`);
    }
    if (r.branches.length > 0) {
      lines.push(`   Branch updates:`);
      for (const b of r.branches) {
        lines.push(`   • ${b.name} (${b.relative})`);
      }
    }
    if (r.tags.length > 0) {
      lines.push(`   New tags:`);
      for (const t of r.tags) {
        lines.push(`   • ${t.name} (${t.date})`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function formatCommits(results) {
  const lines = [];
  for (const r of results) {
    if (r.error || r.commits.length === 0) continue;
    for (const c of r.commits) {
      lines.push(`[${r.name}] ${c.hash} ${c.author} ${c.date} — ${c.subject}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No commits found in the given time window.';
}

// --- Main ---
function main() {
  const opts = parseArgs();
  if (opts.help) { showHelp(); process.exit(0); }
  if (opts.repos.length === 0) {
    console.error('Error: No repos specified. Use --repos <path,...> or pass paths as arguments.');
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Validate mode
  if (!['summary', 'detail', 'commits'].includes(opts.mode)) {
    console.error(`Error: Invalid mode "${opts.mode}". Use: summary, detail, or commits.`);
    process.exit(1);
  }

  const results = [];
  for (const repo of opts.repos) {
    const analysis = analyzeRepo(repo, opts.since, opts.branch);
    results.push(analysis);
  }

  // Update state
  if (!opts.noUpdate) {
    const state = loadState(opts.stateFile);
    for (const r of results) {
      if (r.error) continue;
      const repoKey = r.path || r.name;
      if (!state.repos[repoKey]) state.repos[repoKey] = {};
      // Track latest commit hash per branch
      if (r.commits.length > 0) {
        state.repos[repoKey].lastSeen = {
          hash: r.commits[0].hash,
          date: r.commits[0].date,
          checkedAt: new Date().toISOString(),
        };
      } else {
        state.repos[repoKey].lastSeen = {
          checkedAt: new Date().toISOString(),
        };
      }
    }
    state.lastRun = new Date().toISOString();
    saveState(opts.stateFile, state);
  }

  // Output
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    switch (opts.mode) {
      case 'summary': console.log(formatSummary(results)); break;
      case 'detail': console.log(formatDetail(results)); break;
      case 'commits': console.log(formatCommits(results)); break;
    }
  }

  // Exit code: 1 if any repo had an error
  const hasErrors = results.some(r => r.error);
  process.exit(hasErrors ? 1 : 0);
}

main();
