#!/usr/bin/env node

// git-file-history.mjs — Trace the full change history of a file
// Zero dependencies. Node.js 18+ (uses built-in fetch if needed).

import { execFileSync } from 'child_process';
import { resolve, relative, basename } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

// ── Argument Parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    file: null,
    repo: process.cwd(),
    commits: null,
    since: null,
    author: null,
    summary: false,
    blame: false,
    stats: false,
    follow: true,
    json: false,
    diffCtx: 3,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo' && args[i + 1]) opts.repo = args[++i];
    else if (a === '--commits' && args[i + 1]) opts.commits = parseInt(args[++i]);
    else if (a === '--since' && args[i + 1]) opts.since = args[++i];
    else if (a === '--author' && args[i + 1]) opts.author = args[++i];
    else if (a === '--summary') opts.summary = true;
    else if (a === '--blame') opts.blame = true;
    else if (a === '--stats') opts.stats = true;
    else if (a === '--no-follow') opts.follow = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--diff-ctx' && args[i + 1]) opts.diffCtx = parseInt(args[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (!a.startsWith('--')) opts.file = a;
  }
  return opts;
}

// ── Git Helpers ───────────────────────────────────────────────────

function git(repo, ...args) {
  try {
    const result = execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    });
    return result.trimEnd();
  } catch (e) {
    return null;
  }
}

function gitLines(repo, ...args) {
  const out = git(repo, ...args);
  if (!out) return [];
  return out.split('\n');
}

// ── Get File History ──────────────────────────────────────────────

function getFileCommits(repo, file, opts) {
  const args = ['log', '--format=%H|%h|%an|%aI|%s'];
  if (opts.follow) args.push('--follow');
  if (opts.since) args.push('--since', opts.since);
  if (opts.author) args.push('--author', opts.author);
  if (opts.commits) args.push(`-n${opts.commits}`);
  args.push('--', file);

  const lines = gitLines(repo, ...args);
  return lines.map(line => {
    const [hash, shortHash, author, date, ...subjectParts] = line.split('|');
    return { hash, shortHash, author, date, subject: subjectParts.join('|') };
  });
}

// ── Get Diff Stats for a File in a Commit ────────────────────────

function getDiffStats(repo, file, hash) {
  const out = git(repo, 'diff-tree', '--no-commit-id', '--numstat', '-r', hash, '--', file);
  if (!out) return { added: 0, deleted: 0, isNewFile: false, isRename: false };

  const parts = out.split('\t');
  const added = parseInt(parts[0]) || 0;
  const deleted = parseInt(parts[1]) || 0;
  const isNewFile = parts[0] === '-' || parts[1] === '-';
  const isRename = parts[2] && parts[2].startsWith('{');

  return { added, deleted, isNewFile, isRename };
}

// ── Get Diff Excerpt ─────────────────────────────────────────────

function getDiffExcerpt(repo, file, hash, ctx) {
  const out = git(repo, 'show', hash, '--', file, '--unified=' + ctx, '--color=never');
  if (!out) return null;

  // Extract just the diff portion (after the commit header)
  const diffMatch = out.match(/^diff --git.*$/ms);
  return diffMatch ? diffMatch[0] : out;
}

// ── Get Blame Info ────────────────────────────────────────────────

function getBlame(repo, file) {
  const lines = gitLines(repo, 'blame', '--porcelain', file);
  if (lines.length === 0) return [];

  // Two-pass: first build hash -> author map, then parse headers
  // git blame --porcelain format:
  //   <hash> <orig-line> <result-line> [<num-lines>]
  //   author <name>
  //   author-mail <email>
  //   author-time <timestamp>
  //   author-tz <tz>
  //   committer <name>
  //   ...
  //   <tab><content>

  const authorMap = {};
  let lastHeaderHash = null;

  for (const line of lines) {
    if (/^[0-9a-f]{40}/.test(line)) {
      lastHeaderHash = line.split(/\s+/)[0].substring(0, 7);
    } else if (line.startsWith('author ') && lastHeaderHash) {
      authorMap[lastHeaderHash] = line.substring(7);
    }
  }

  // Parse headers to get line ranges
  const groups = [];

  for (const line of lines) {
    if (/^[0-9a-f]{40}/.test(line)) {
      const [hash, origLine, resultLine] = line.split(/\s+/);
      const shortHash = hash.substring(0, 7);
      const lineNum = parseInt(resultLine);

      // Check if we can merge with previous group
      const prev = groups[groups.length - 1];
      if (prev && prev.hash === shortHash && prev.startLine + prev.count === lineNum) {
        prev.count++;
      } else {
        groups.push({ hash: shortHash, startLine: lineNum, count: 1, author: authorMap[shortHash] || 'unknown' });
      }
    }
  }

  return groups;
}

// ── Get Total Line Count ─────────────────────────────────────────

function getLineCount(repo, file) {
  const out = git(repo, 'show', `HEAD:${file}`);
  if (!out) return 0;
  return out.split('\n').length;
}

// ── Format Relative Date ─────────────────────────────────────────

function relativeDate(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

// ── Format Date ───────────────────────────────────────────────────

function shortDate(dateStr) {
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

// ── Shared-lib Compatibility ─────────────────────────────────────

// Check for shared-lib and use its output helpers if available
let sharedLib = null;
try {
  const slPath = resolve(import.meta.dirname, '../../shared-lib/dist/index.mjs');
  if (existsSync(slPath)) {
    sharedLib = await import(slPath);
  }
} catch {}

function color(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

const c = {
  dim: (t) => color('2', t),
  bold: (t) => color('1', t),
  cyan: (t) => color('36', t),
  yellow: (t) => color('33', t),
  green: (t) => color('32', t),
  red: (t) => color('31', t),
};

// ── Output: Full History ──────────────────────────────────────────

function outputFull(commits, repo, file, opts) {
  const authors = {};
  let totalAdded = 0, totalDeleted = 0;
  let firstCommit = commits[commits.length - 1];
  let lastCommit = commits[0];
  const span = commits.length > 1
    ? Math.ceil((new Date(firstCommit.date).getTime() - new Date(lastCommit.date).getTime()) / 86400000)
    : 0;

  for (const commit of commits) {
    authors[commit.author] = (authors[commit.author] || 0) + 1;
  }

  console.log(c.bold(`📜 File History: ${file}`) + c.dim(` — ${commits.length} commit${commits.length !== 1 ? 's' : ''}`));
  console.log();

  // Summary line
  const authorList = Object.entries(authors).map(([a, n]) => `${a} (${n})`).join(', ');
  const parts = [`📊 ${commits.length} commits · ${Object.keys(authors).length} author${Object.keys(authors).length !== 1 ? 's' : ''}`];
  if (span > 0) parts.push(`${span} days span`);
  if (firstCommit) parts.push(`Created: ${shortDate(firstCommit.date)} by ${firstCommit.author}`);
  if (lastCommit) parts.push(`Last changed: ${shortDate(lastCommit.date)} by ${lastCommit.author}`);
  console.log(c.dim(parts.join(' · ')));

  const lineCount = getLineCount(repo, file);
  if (lineCount > 0) console.log(c.dim(`   Current: ${lineCount} lines`));
  console.log();

  const separator = c.dim('─'.repeat(46));
  console.log(separator);

  commits.forEach((commit, i) => {
    const stats = getDiffStats(repo, file, commit.hash);
    totalAdded += stats.added;
    totalDeleted += stats.deleted;

    console.log();
    console.log(c.cyan(`${i + 1}. [${commit.shortHash}]`) + c.dim(` ${shortDate(commit.date)} · ${commit.author} (${relativeDate(commit.date)})`));
    console.log(c.dim(`   ${commit.subject}`));

    if (stats.isNewFile) {
      console.log(c.green('   (new file)'));
    } else if (stats.isRename) {
      console.log(c.yellow('   (renamed)'));
    } else {
      console.log(c.dim(`   ${stats.added > 0 ? c.green(`+${stats.added}`) : ''} ${stats.deleted > 0 ? c.red(`-${stats.deleted}`) : ''}`));
    }

    if (!opts.summary) {
      const excerpt = getDiffExcerpt(repo, file, commit.hash, opts.diffCtx);
      if (excerpt) {
        // Trim to reasonable length
        const excerptLines = excerpt.split('\n');
        const maxLines = 15;
        if (excerptLines.length > maxLines) {
          const trimmed = excerptLines.slice(0, maxLines).join('\n');
          console.log(c.dim('     ' + trimmed.split('\n').join('\n     ')));
          console.log(c.dim(`     ... (${excerptLines.length - maxLines} more lines)`));
        } else {
          console.log(c.dim('     ' + excerpt.split('\n').join('\n     ')));
        }
      }
    }

    console.log(separator);
  });

  console.log();
  console.log(c.dim(`📌 Created in commit ${firstCommit.shortHash} (${shortDate(firstCommit.date)}) by ${firstCommit.author}`));
  if (opts.stats) {
    console.log(c.dim(`   Net changes: +${totalAdded} -${totalDeleted} lines`));
  }
}

// ── Output: Summary ───────────────────────────────────────────────

function outputSummary(commits, repo, file) {
  const authors = {};
  let totalAdded = 0, totalDeleted = 0;

  for (const commit of commits) {
    authors[commit.author] = (authors[commit.author] || 0) + 1;
    const stats = getDiffStats(repo, file, commit.hash);
    totalAdded += stats.added;
    totalDeleted += stats.deleted;
  }

  const firstCommit = commits[commits.length - 1];
  const lastCommit = commits[0];
  const authorList = Object.entries(authors).map(([a, n]) => `${a} (${n})`).join(', ');

  console.log(c.bold(`📜 ${file}`) + c.dim(` — ${commits.length} commits over ${commits.length > 1
    ? Math.ceil((new Date(firstCommit.date).getTime() - new Date(lastCommit.date).getTime()) / 86400000) + ' days'
    : '0 days'}`));
  console.log(c.dim(`   Authors: ${authorList}`));
  console.log(c.dim(`   Created: ${shortDate(firstCommit.date)} by ${firstCommit.author}`));
  console.log(c.dim(`   Last:    ${shortDate(lastCommit.date)} by ${lastCommit.author}`));
  console.log(c.dim(`   Net:     +${totalAdded} -${totalDeleted} lines`));
}

// ── Output: Blame ─────────────────────────────────────────────────

function outputBlame(blameGroups, file) {
  const lineCount = blameGroups.reduce((sum, g) => sum + g.count, 0);
  console.log(c.bold(`📜 Blame: ${file}`) + c.dim(` (${lineCount} lines)`));
  console.log();

  for (const group of blameGroups) {
    const endLine = group.startLine + group.count - 1;
    const lineRange = group.count > 1 ? `L${group.startLine}-${endLine}` : `L${group.startLine}`;
    console.log(c.cyan(`  ${group.author.padEnd(10)}`) +
      c.dim(`[${group.hash}]  `.padEnd(12)) +
      c.dim(`${lineRange}:`.padEnd(12)) +
      c.dim(`${group.count} line${group.count > 1 ? 's' : ''}`));
  }
}

// ── Output: JSON ──────────────────────────────────────────────────

function outputJson(commits, repo, file) {
  const authors = {};
  let totalAdded = 0, totalDeleted = 0;

  const commitData = commits.map(commit => {
    authors[commit.author] = (authors[commit.author] || 0) + 1;
    const stats = getDiffStats(repo, file, commit.hash);
    totalAdded += stats.added;
    totalDeleted += stats.deleted;

    return {
      hash: commit.hash,
      shortHash: commit.shortHash,
      author: commit.author,
      date: commit.date,
      subject: commit.subject,
      added: stats.added,
      deleted: stats.deleted,
      isNewFile: stats.isNewFile,
      isRename: stats.isRename,
      diffExcerpt: stats.isNewFile ? null : getDiffExcerpt(repo, file, commit.hash, 3),
    };
  });

  const firstCommit = commits[commits.length - 1];
  const lastCommit = commits[0];

  console.log(JSON.stringify({
    file,
    totalCommits: commits.length,
    authors,
    createdIn: firstCommit ? { hash: firstCommit.hash, author: firstCommit.author, date: firstCommit.date } : null,
    lastChanged: lastCommit ? { hash: lastCommit.hash, author: lastCommit.author, date: lastCommit.date } : null,
    netLines: { added: totalAdded, deleted: totalDeleted },
    commits: commitData,
  }, null, 2));
}

// ── Help ──────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
📜 git-file-history — Trace the full change history of a file

Usage: git-file-history <file> [options]

Options:
  --repo <path>       Git repo path (default: cwd)
  --commits <n>       Limit to N most recent commits
  --since <date>      Show commits since date expression
  --author <name>     Filter by author
  --summary           Summary only (no diff excerpts)
  --blame             Show current line-level blame
  --stats             Include net line change stats
  --no-follow         Don't follow renames
  --json              Output as JSON
  --diff-ctx <n>      Lines of diff context (default: 3)
  -h, --help          Show this help

Examples:
  git-file-history src/config.ts
  git-file-history src/config.ts --summary
  git-file-history src/config.ts --blame
  git-file-history src/config.ts --since "1 week ago" --author shelldon
  git-file-history src/config.ts --commits 5 --json
`);
}

// ── Main ──────────────────────────────────────────────────────────

const opts = parseArgs(process.argv);

if (opts.help || !opts.file) {
  showHelp();
  process.exit(opts.help ? 0 : 1);
}

const repo = resolve(opts.repo);
const file = opts.file;

// Verify we're in a git repo
if (!git(repo, 'rev-parse', '--git-dir')) {
  console.error(`❌ Not a git repo: ${repo}`);
  process.exit(1);
}

// Blame mode
if (opts.blame) {
  const groups = getBlame(repo, file);
  if (groups.length === 0) {
    console.error(`❌ No blame data for: ${file}`);
    process.exit(1);
  }
  outputBlame(groups, file);
  process.exit(0);
}

const commits = getFileCommits(repo, file, opts);
if (commits.length === 0) {
  console.error(`❌ No commits found for: ${file}`);
  process.exit(1);
}

if (opts.json) {
  outputJson(commits, repo, file);
} else if (opts.summary) {
  outputSummary(commits, repo, file);
} else {
  outputFull(commits, repo, file, opts);
}
