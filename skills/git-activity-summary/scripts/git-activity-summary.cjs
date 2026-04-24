#!/usr/bin/env node
/**
 * git-activity-summary — Summarise git activity across one or more repos.
 *
 * Provides commit frequency, author breakdown, active branches,
 * file change stats, and trend analysis. Designed for standup notes,
 * daily briefings, and heartbeat summaries.
 *
 * Zero dependencies. Node.js 18+. Uses git CLI.
 */

"use strict";

const { execSync, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────

function git(repo, argsArray, opts = {}) {
  const timeout = opts.timeout || 15000;
  try {
    return execFileSync("git", argsArray, {
      cwd: repo,
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      shell: false,
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.silent) return "";
    process.stderr.write(`git error in ${repo}: ${err.message.split("\n")[0]}\n`);
    return "";
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    repos: [],
    since: null,
    until: null,
    author: null,
    branch: null,
    format: "default",
    json: false,
    verbose: false,
    help: false,
    topN: 5,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--verbose" || a === "-v") opts.verbose = true;
    else if (a === "--since" || a === "-s") opts.since = args[++i];
    else if (a === "--until" || a === "-u") opts.until = args[++i];
    else if (a === "--author" || a === "-a") opts.author = args[++i];
    else if (a === "--branch" || a === "-b") opts.branch = args[++i];
    else if (a === "--format" || a === "-f") opts.format = args[++i];
    else if (a === "--top" || a === "-n") opts.topN = parseInt(args[++i], 10) || 5;
    else if (a === "--repo" || a === "-r") opts.repos.push(args[++i]);
    else if (!a.startsWith("-")) opts.repos.push(a);
  }

  return opts;
}

function isGitRepo(dir) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function repoName(dir) {
  return path.basename(path.resolve(dir));
}

// ── Data Collection ──────────────────────────────────────────────────

function buildSinceArg(since) {
  if (!since) return [];
  return ["--since", since];
}

function buildUntilArg(until) {
  if (!until) return [];
  return ["--until", until];
}

function getCommitLog(repo, opts) {
  const parts = [
    "log",
    "--no-merges",
    "--pretty=format:%H|%an|%aI|%s",
    "--shortstat",
    ...buildSinceArg(opts.since),
    ...buildUntilArg(opts.until),
  ];
  if (opts.author) parts.push("--author", opts.author);
  if (opts.branch) parts.push(opts.branch);

  const raw = git(repo, parts, { silent: true });
  if (!raw) return [];

  const commits = [];
  const lines = raw.split("\n");
  let current = null;

  for (const line of lines) {
    // Commit header line
    if (line.includes("|")) {
      if (current) commits.push(current);
      const [hash, author, date, ...subjectParts] = line.split("|");
      current = {
        hash: hash.substring(0, 8),
        author,
        date,
        subject: subjectParts.join("|"),
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
    }
    // Shortstat line
    else if (current && line.startsWith(" ")) {
      const m = line.match(/(\d+) file(?:s)? changed(?:, (\d+) insertion(?:s)?\([^)]*\))?(?:, (\d+) deletion(?:s)?\([^)]*\))?/);
      if (m) {
        current.filesChanged = parseInt(m[1], 10) || 0;
        current.insertions = parseInt(m[2], 10) || 0;
        current.deletions = parseInt(m[3], 10) || 0;
      }
    }
  }
  if (current) commits.push(current);
  return commits;
}

function getActiveBranches(repo) {
  const raw = git(repo, ["branch", "-a", "--sort=-committerdate"], { silent: true });
  if (!raw) return [];
  return raw
    .split("\n")
    .slice(0, 10)
    .map((b) => b.trim().replace(/^\* /, "").replace("remotes/origin/", ""));
}

function getStashes(repo) {
  const raw = git(repo, ["stash", "list"], { silent: true });
  if (!raw) return 0;
  return raw.split("\n").filter(Boolean).length;
}

function getUncommitted(repo) {
  const status = git(repo, ["status", "--porcelain"], { silent: true });
  if (!status) return { modified: 0, untracked: 0 };
  const lines = status.split("\n").filter(Boolean);
  const modified = lines.filter((l) => !l.startsWith("?")).length;
  const untracked = lines.filter((l) => l.startsWith("?")).length;
  return { modified, untracked };
}

function analyzeRepo(repo, opts) {
  const commits = getCommitLog(repo, opts);
  const branches = getActiveBranches(repo);
  const stashes = getStashes(repo);
  const uncommitted = getUncommitted(repo);

  // Author breakdown
  const authorMap = {};
  for (const c of commits) {
    if (!authorMap[c.author]) authorMap[c.author] = { count: 0, insertions: 0, deletions: 0 };
    authorMap[c.author].count++;
    authorMap[c.author].insertions += c.insertions;
    authorMap[c.author].deletions += c.deletions;
  }

  // Sort authors by commit count
  const authors = Object.entries(authorMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.count - a.count);

  // Day-of-week breakdown
  const dayMap = {};
  for (const c of commits) {
    const d = new Date(c.date);
    const day = d.toLocaleDateString("en-US", { weekday: "short" });
    if (!dayMap[day]) dayMap[day] = 0;
    dayMap[day]++;
  }

  // Time-of-day breakdown (hour buckets)
  const hourMap = {};
  for (const c of commits) {
    const h = new Date(c.date).getHours();
    const bucket = `${String(h).padStart(2, "0")}:00`;
    if (!hourMap[bucket]) hourMap[bucket] = 0;
    hourMap[bucket]++;
  }

  // Total stats
  const totals = commits.reduce(
    (acc, c) => {
      acc.filesChanged += c.filesChanged;
      acc.insertions += c.insertions;
      acc.deletions += c.deletions;
      return acc;
    },
    { filesChanged: 0, insertions: 0, deletions: 0 },
  );

  // Commit type breakdown (conventional commits)
  const typeMap = {};
  for (const c of commits) {
    const m = c.subject.match(/^(\w+)(?:\(.+?\))?:/);
    const type = m ? m[1] : "other";
    typeMap[type] = (typeMap[type] || 0) + 1;
  }

  return {
    repo: repoName(repo),
    path: path.resolve(repo),
    totalCommits: commits.length,
    totals,
    authors,
    days: dayMap,
    hours: hourMap,
    types: typeMap,
    branches,
    stashes,
    uncommitted,
    commits,
  };
}

// ── Formatting ───────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatNumber(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function bar(value, max, width = 20) {
  if (max === 0) return "▏";
  const filled = Math.round((value / max) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatDefault(results, opts) {
  const lines = [];

  for (const r of results) {
    lines.push(`📊 ${r.repo} — ${r.totalCommits} commits`);

    if (r.totalCommits === 0) {
      lines.push("  (no commits in range)\n");
      continue;
    }

    // Time range from commits
    if (r.commits.length > 0) {
      const first = new Date(r.commits[r.commits.length - 1].date);
      const last = new Date(r.commits[0].date);
      const fmt = (d) => d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
      lines.push(`  📅 ${fmt(first)} → ${fmt(last)}`);
    }

    // Totals
    lines.push(
      `  📝 ${formatNumber(r.totals.insertions)}+ ${formatNumber(r.totals.deletions)}- across ${r.totals.filesChanged} files`,
    );

    // Top authors
    if (r.authors.length > 0) {
      lines.push("  👥 Authors:");
      const topN = r.authors.slice(0, opts.topN);
      const maxCount = topN[0].count;
      for (const a of topN) {
        const b = bar(a.count, maxCount, 12);
        lines.push(`     ${a.name.padEnd(16)} ${b} ${a.count}`);
      }
    }

    // Commit types
    if (Object.keys(r.types).length > 1) {
      const typeEmojis = {
        feat: "✨",
        fix: "🐛",
        docs: "📝",
        refactor: "♻️",
        perf: "⚡",
        chore: "🔧",
        test: "🧪",
        ci: "🔄",
      };
      lines.push("  🏷️  Types:");
      const sortedTypes = Object.entries(r.types).sort(([, a], [, b]) => b - a);
      for (const [type, count] of sortedTypes.slice(0, 6)) {
        const emoji = typeEmojis[type] || "📌";
        lines.push(`     ${emoji} ${type.padEnd(10)} ${count}`);
      }
    }

    // Activity by day of week
    if (Object.keys(r.days).length > 1) {
      const dayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      lines.push("  📆 By day:");
      const dayEntries = dayOrder.filter((d) => r.days[d]);
      const maxDay = Math.max(...dayEntries.map((d) => r.days[d]));
      for (const d of dayEntries) {
        lines.push(`     ${d.padEnd(4)} ${bar(r.days[d], maxDay, 10)} ${r.days[d]}`);
      }
    }

    // Branches
    if (r.branches.length > 0) {
      lines.push(`  🌿 Branches: ${r.branches.slice(0, 5).join(", ")}`);
      if (r.branches.length > 5) lines.push(`     ... and ${r.branches.length - 5} more`);
    }

    // Uncommitted work
    if (r.uncommitted.modified > 0 || r.uncommitted.untracked > 0) {
      lines.push(`  ⚠️  Working tree: ${r.uncommitted.modified} modified, ${r.uncommitted.untracked} untracked`);
    }
    if (r.stashes > 0) {
      lines.push(`  📦 Stashes: ${r.stashes}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatCompact(results) {
  const lines = [];
  for (const r of results) {
    const authorStr = r.authors.slice(0, 3).map((a) => `${a.name} (${a.count})`).join(", ");
    lines.push(
      `${r.repo}: ${r.totalCommits} commits | ${formatNumber(r.totals.insertions)}+ ${formatNumber(r.totals.deletions)}- | ${authorStr}`,
    );
  }
  return lines.join("\n");
}

function formatBriefing(results) {
  // Human-readable briefing format for standups/daily summaries
  const lines = [];
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  lines.push(`📋 Git Activity Briefing — ${dateStr}`);
  lines.push("");

  for (const r of results) {
    lines.push(`**${r.repo}**`);
    if (r.totalCommits === 0) {
      lines.push("  No activity in this period.");
      lines.push("");
      continue;
    }

    // Top contributors
    if (r.authors.length > 0) {
      const topAuthors = r.authors.slice(0, 3).map((a) => a.name).join(", ");
      lines.push(`  Activity by: ${topAuthors} (${r.totalCommits} commits)`);
    }

    // Recent commit subjects
    const recentCommits = r.commits.slice(0, 3);
    if (recentCommits.length > 0) {
      lines.push("  Latest:");
      for (const c of recentCommits) {
        const date = new Date(c.date).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
        lines.push(`  • ${c.subject} (${date})`);
      }
    }

    // Net lines
    const net = r.totals.insertions - r.totals.deletions;
    const netStr = net >= 0 ? `+${formatNumber(net)}` : formatNumber(net);
    lines.push(`  Net: ${netStr} lines across ${r.totals.filesChanged} files`);

    // Flags
    const flags = [];
    if (r.uncommitted.modified > 0) flags.push(`${r.uncommitted.modified} uncommitted changes`);
    if (r.stashes > 0) flags.push(`${r.stashes} stashes`);
    if (flags.length > 0) lines.push(`  ⚠️  ${flags.join(", ")}`);

    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    console.log(`git-activity-summary — Summarise git activity across repos

Usage:
  git-activity-summary [repo...] [options]

Options:
  --repo, -r <path>   Add a repo to analyse (can specify multiple times)
  --since, -s <date>  Start of range (e.g. "1 week ago", "2026-04-01")
  --until, -u <date>  End of range
  --author, -a <name> Filter by author
  --branch, -b <name> Filter by branch
  --format, -f <fmt>  Output format: default, compact, briefing (default: default)
  --top, -n <num>     Number of top authors to show (default: 5)
  --json              Output as JSON
  --verbose, -v       Include individual commits in output
  --help, -h          Show this help

Examples:
  git-activity-summary ./my-project
  git-activity-summary --since "1 week ago"
  git-activity-summary -r ./repo1 -r ./repo2 --format briefing
  git-activity-summary --since "2026-04-01" --author shelldon --json
  git-activity-summary . --format compact --since "3 days ago"

Repos:
  Pass repo paths as positional arguments or via --repo.
  If no repos given, analyses the current directory.`);
    process.exit(0);
  }

  // Default to CWD if no repos specified
  if (opts.repos.length === 0) {
    opts.repos.push(process.cwd());
  }

  // Validate repos
  const validRepos = [];
  for (const repo of opts.repos) {
    const resolved = path.resolve(repo);
    if (!fs.existsSync(resolved)) {
      process.stderr.write(`⚠️  Not found: ${resolved}\n`);
      continue;
    }
    if (!isGitRepo(resolved)) {
      process.stderr.write(`⚠️  Not a git repo: ${resolved}\n`);
      continue;
    }
    validRepos.push(resolved);
  }

  if (validRepos.length === 0) {
    process.stderr.write("No valid git repos to analyse.\n");
    process.exit(1);
  }

  // Analyse each repo
  const results = [];
  for (const repo of validRepos) {
    const analysis = analyzeRepo(repo, opts);
    results.push(analysis);
  }

  if (opts.json) {
    // Strip commits from JSON unless verbose
    if (!opts.verbose) {
      for (const r of results) delete r.commits;
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  let output;
  switch (opts.format) {
    case "compact":
      output = formatCompact(results);
      break;
    case "briefing":
      output = formatBriefing(results);
      break;
    default:
      output = formatDefault(results, opts);
  }

  console.log(output);
}

main();
