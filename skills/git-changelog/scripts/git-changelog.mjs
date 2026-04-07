#!/usr/bin/env node
/**
 * git-changelog — Generate a clean changelog from git history.
 *
 * Formats commits between two refs into a platform-friendly changelog.
 * Optimised for Slack/Discord/WhatsApp delivery after trackhub pushes.
 *
 * Usage:
 *   node git-changelog.mjs                          # last 24h
 *   node git-changelog.mjs --since v1.0.0           # since tag
 *   node git-changelog.mjs --commits 10             # last 10 commits
 *   node git-changelog.mjs --scope attio-crm        # filter by scope
 *   node git-changelog.mjs --format slack           # Slack-friendly output
 *   node git-changelog.mjs --json                   # raw JSON
 */

import { execSync } from 'child_process';
import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { dates, formatDuration, daysAgo, formatHuman } from '../../shared-lib/scripts/lib/dates.mjs';
import { fmt, section, bullet, ok, warn } from '../../shared-lib/scripts/lib/fmt.mjs';

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help', n: 'commits', s: 'since', u: 'until', f: 'format', t: 'type', p: 'path' },
  boolean: ['help', 'json', 'no-merges', 'group', 'compact'],
  string: ['since', 'until', 'format', 'scope', 'type', 'path', 'commits'],
  default: {
    commits: 20,
    format: 'default',
    group: true,
    compact: false,
    'no-merges': true,
  },
});

if (args.help) {
  showHelp('git-changelog', 'Generate a changelog from git history', {
    '--since <ref/date>': 'Start ref, tag, or date (e.g. v1.0.0, 2026-04-01, "2 days ago")',
    '--until <ref/date>': 'End ref or date (default: HEAD)',
    '--commits <n>': 'Max commits to include (default: 20)',
    '--scope <name>': 'Filter by conventional commit scope',
    '--type <type>': 'Filter by conventional commit type (feat, fix, docs, ...)',
    '--format <fmt>': 'Output format: default, slack, discord, compact (default: default)',
    '--path <path>': 'Only show changes touching this path',
    '--group': 'Group commits by type (default: true)',
    '--compact': 'One-line per commit, no grouping',
    '--no-merges': 'Exclude merge commits (default: true)',
    '--json': 'Output raw JSON',
  }, `  node git-changelog.mjs --since v1.0.0 --format slack
  node git-changelog.mjs --commits 5 --compact
  node git-changelog.mjs --scope cron-health --since "3 days ago"`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function git(rawArgs) {
  try {
    return execSync(rawArgs, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    // Return empty on failure — some refs may not exist
    return '';
  }
}

function gitLines(rawArgs) {
  const output = git(rawArgs);
  return output ? output.split('\n') : [];
}

function parseCommit(line) {
  // Format: hash|shortHash|authorName|authorDate|type|scope|subject
  const parts = line.split('|');
  if (parts.length < 5) return null;

  return {
    hash: parts[0],
    shortHash: parts[1],
    author: parts[2],
    date: parts[3],
    type: parts[4] || 'other',
    scope: parts[5] || '',
    subject: parts[6] || '',
  };
}

function gitLog(since, until, maxCommits, noMergges, path) {
  const format = '%H|%h|%an|%aI|%s';

  let cmd = `git log --format="${format}" -${maxCommits}`;
  if (noMergges) cmd += ' --no-merges';
  if (path) cmd += ` -- ${path}`;

  if (since) {
    // Check if since is a valid ref (tag, branch, commit hash)
    const refOutput = git(`git rev-parse --verify "${since}"`);
    if (refOutput) {
      // It's a ref — use range syntax
      cmd = `git log --format="${format}" ${since}..${until || 'HEAD'} -${maxCommits}`;
      if (noMergges) cmd += ' --no-merges';
      if (path) cmd += ` -- ${path}`;
    } else {
      // It's a time expression — use --since flag
      cmd += ` --since="${since}"`;
      if (until && until !== 'HEAD') cmd += ` --until="${until}"`;
    }
  } else if (until && until !== 'HEAD') {
    cmd += ` ${until}`;
  }

  return gitLines(cmd)
    .map(line => {
      // Extract type and scope from conventional commit subject
      const match = line.match(/^([a-f0-9]+)\|([a-f0-9]+)\|(.+?)\|(.+?)\|(.+)$/);
      if (!match) return null;

      const [, hash, shortHash, author, date, subject] = match;
      const commitMatch = subject.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);

      return {
        hash,
        shortHash,
        author,
        date,
        type: commitMatch ? commitMatch[1] : 'other',
        scope: commitMatch ? (commitMatch[2] || '') : '',
        subject: commitMatch ? commitMatch[3] : subject,
      };
    })
    .filter(Boolean);
}

function parseConventionalType(type) {
  const typeMap = {
    feat: { label: 'Features', emoji: '✨' },
    fix: { label: 'Bug Fixes', emoji: '🐛' },
    docs: { label: 'Documentation', emoji: '📝' },
    refactor: { label: 'Refactoring', emoji: '♻️' },
    perf: { label: 'Performance', emoji: '⚡' },
    chore: { label: 'Maintenance', emoji: '🔧' },
    test: { label: 'Tests', emoji: '🧪' },
    ci: { label: 'CI/CD', emoji: '🔄' },
    style: { label: 'Style', emoji: '💅' },
    other: { label: 'Other', emoji: '📌' },
  };
  return typeMap[type] || typeMap.other;
}

function timeAgo(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

// ── Filters ──────────────────────────────────────────────────────────────────

function filterCommits(commits, scope, type) {
  return commits.filter(c => {
    if (scope && c.scope.toLowerCase() !== scope.toLowerCase()) return false;
    if (type && c.type.toLowerCase() !== type.toLowerCase()) return false;
    return true;
  });
}

// ── Formatters ───────────────────────────────────────────────────────────────

function formatDefault(commits, grouped) {
  if (!commits.length) {
    console.log('No commits found in range.');
    return;
  }

  const lines = [];
  const byType = {};

  if (grouped) {
    for (const c of commits) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }
  } else {
    byType['all'] = commits;
  }

  const dateRange = `${timeAgo(commits[commits.length - 1].date)} — ${timeAgo(commits[0].date)}`;
  lines.push(`Changelog (${commits.length} commits, ${dateRange})`);
  lines.push('─'.repeat(50));

  const typeOrder = ['feat', 'fix', 'docs', 'refactor', 'perf', 'chore', 'test', 'ci', 'style', 'other'];

  if (byType['all']) {
    // Ungrouped: list all commits chronologically
    for (const c of commits) {
      const info = parseConventionalType(c.type);
      const scope = c.scope ? `[${c.scope}] ` : '';
      lines.push(`${info.emoji} ${scope}${c.subject} (${c.shortHash}, ${timeAgo(c.date)})`);
    }
  } else {
    for (const type of typeOrder) {
      const items = byType[type];
      if (!items || !items.length) continue;

      const info = parseConventionalType(type);
      lines.push('');
      lines.push(`${info.emoji} ${info.label}`);
      for (const c of items) {
        const scope = c.scope ? `[${c.scope}] ` : '';
        lines.push(`  • ${scope}${c.subject} (${c.shortHash}, ${timeAgo(c.date)})`);
      }
    }
  }

  console.log(lines.join('\n'));
}

function formatSlack(commits, grouped) {
  if (!commits.length) {
    console.log('No commits found in range.');
    return;
  }

  const lines = [];
  const byType = {};

  if (grouped) {
    for (const c of commits) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }
  } else {
    byType['all'] = commits;
  }

  lines.push(`📦 *Changelog* — ${commits.length} commit${commits.length > 1 ? 's' : ''}`);

  const typeOrder = ['feat', 'fix', 'docs', 'refactor', 'perf', 'chore', 'test', 'ci', 'style', 'other'];

  if (byType['all']) {
    for (const c of commits) {
      const info = parseConventionalType(c.type);
      const scope = c.scope ? `\`${c.scope}\` ` : '';
      lines.push(`${info.emoji} ${scope}${c.subject} — \`${c.shortHash}\``);
    }
  } else {
    for (const type of typeOrder) {
      const items = byType[type];
      if (!items || !items.length) continue;

      const info = parseConventionalType(type);
      lines.push(`\n${info.emoji} *${info.label}*`);
      for (const c of items) {
        const scope = c.scope ? `\`${c.scope}\` ` : '';
        lines.push(`• ${scope}${c.subject} — \`${c.shortHash}\``);
      }
    }
  }

  console.log(lines.join('\n'));
}

function formatDiscord(commits, grouped) {
  if (!commits.length) {
    console.log('No commits found in range.');
    return;
  }

  const lines = [];
  const byType = {};

  if (grouped) {
    for (const c of commits) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    }
  } else {
    byType['all'] = commits;
  }

  lines.push(`**📦 Changelog** — ${commits.length} commit${commits.length > 1 ? 's' : ''}`);

  const typeOrder = ['feat', 'fix', 'docs', 'refactor', 'perf', 'chore', 'test', 'ci', 'style', 'other'];

  if (byType['all']) {
    for (const c of commits) {
      const info = parseConventionalType(c.type);
      const scope = c.scope ? `\`${c.scope}\` ` : '';
      lines.push(`${info.emoji} ${scope}${c.subject} — \`${c.shortHash}\``);
    }
  } else {
    for (const type of typeOrder) {
      const items = byType[type];
      if (!items || !items.length) continue;

      const info = parseConventionalType(type);
      lines.push(`\n${info.emoji} **${info.label}**`);
      for (const c of items) {
        const scope = c.scope ? `\`${c.scope}\` ` : '';
        lines.push(`• ${scope}${c.subject} — \`${c.shortHash}\``);
      }
    }
  }

  console.log(lines.join('\n'));
}

function formatCompact(commits) {
  if (!commits.length) {
    console.log('No commits found.');
    return;
  }

  for (const c of commits) {
    const scope = c.scope ? `(${c.scope})` : '';
    const info = parseConventionalType(c.type);
    console.log(`${info.emoji} ${c.type}${scope}: ${c.subject} [${c.shortHash}]`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const since = args.since || null;
const until = args.until || null;
const maxCommits = parseInt(args.commits, 10) || 20;
const noMerges = args['no-merges'];
const grouped = args.group && !args.compact;
const path = args.path || '';

let commits = gitLog(since, until || 'HEAD', maxCommits, noMerges, path);

// Apply filters
commits = filterCommits(commits, args.scope, args.type);

// Reverse to chronological order (newest first — git log default)
if (args.json) {
  console.log(JSON.stringify(commits, null, 2));
  process.exit(0);
}

const format = (args.format || 'default').toLowerCase();
const formatters = {
  default: formatDefault,
  slack: formatSlack,
  discord: formatDiscord,
  compact: formatCompact,
};

const formatter = formatters[format] || formatDefault;
formatter(commits, grouped);
