#!/usr/bin/env node
// git-toolkit.cjs — Unified discovery and routing for git-related trackhub skills
// Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');

// ── Skill registry ──────────────────────────────────────────────────────────
// Maps intent keywords to git skills and their scripts/primary commands.
const SKILLS = [
  {
    name: 'git-activity-summary',
    aliases: ['activity', 'summary', 'standup', 'briefing', 'commits', 'who committed', 'author', 'trends', 'frequency'],
    description: 'Summarise git activity — commit frequency, author breakdown, trends, standup briefings',
    script: 'git-activity-summary/scripts/git-activity-summary.cjs',
    examples: ['git-toolkit -- activity in ./repo', 'git-toolkit -- standup for trackhub'],
  },
  {
    name: 'git-changelog',
    aliases: ['changelog', 'changes', 'release notes', 'recent commits', 'what changed'],
    description: 'Generate clean changelogs from git history (Slack/Discord/compact formats)',
    script: 'git-changelog/scripts/git-changelog.cjs',
    examples: ['git-toolkit -- changelog for trackhub', 'git-toolkit -- release notes'],
  },
  {
    name: 'git-diff-summary',
    aliases: ['diff', 'review', 'what changed in', 'staged', 'unstaged', 'working tree', 'pr diff'],
    description: 'Summarise git diffs — staged, unstaged, committed, or arbitrary ref ranges',
    script: 'git-diff-summary/scripts/git-diff-summary.cjs',
    examples: ['git-toolkit -- diff in ./repo', 'git-toolkit -- what changed in HEAD~3'],
  },
  {
    name: 'git-file-history',
    aliases: ['file history', 'blame', 'who changed', 'when was', 'line history', 'provenance', 'trace'],
    description: 'Trace file-level history — who changed it, when, blame, timeline',
    script: 'git-file-history/scripts/git-file-history.cjs',
    examples: ['git-toolkit -- who changed src/index.js', 'git-toolkit -- blame README.md'],
  },
  {
    name: 'git-repo-health',
    aliases: ['health', 'clean', 'status', 'unpushed', 'behind', 'detached', 'stashes', 'untracked'],
    description: 'Quick repo health check — working tree, unpushed commits, stashes, untracked files',
    script: 'git-repo-health/scripts/git-repo-health.cjs',
    examples: ['git-toolkit -- health of ./repo', 'git-toolkit -- is repo clean'],
  },
  {
    name: 'git-workflow',
    aliases: ['workflow', 'conventions', 'commit message', 'branching', 'pr', 'merge', 'rebase', 'conventions'],
    description: 'Git conventions and best practices for commit messages, branches, PRs',
    script: null, // No script — reference-only skill
    examples: ['git-toolkit -- commit message conventions', 'git-toolkit -- branch naming'],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function findSkillRoot() {
  // Walk up from this script to find a skills/ directory containing known git skills
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const parent = path.dirname(dir);
    const skillsDir = path.join(parent, 'skills');
    if (fs.existsSync(path.join(skillsDir, 'git-activity-summary'))) {
      return skillsDir;
    }
    dir = parent;
  }
  return null;
}

function resolveScript(skillName) {
  const skillsDir = findSkillRoot();
  if (!skillsDir) return null;
  const skill = SKILLS.find(s => s.name === skillName);
  if (!skill || !skill.script) return null;
  const fullPath = path.join(skillsDir, skill.script);
  return fs.existsSync(fullPath) ? fullPath : null;
}

function matchIntent(query) {
  const q = query.toLowerCase().trim();
  if (!q || q === 'help' || q === 'list' || q === 'ls') return null;

  // Score each skill by how many of its aliases appear in the query
  const scores = SKILLS.map(skill => {
    let score = 0;
    for (const alias of skill.aliases) {
      if (q.includes(alias)) score += 2;
      // Partial match: alias words that appear in query
      const words = alias.split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && q.includes(word)) score += 1;
      }
    }
    // Bonus for skill name match
    if (q.includes(skill.name.replace('git-', ''))) score += 3;
    return { skill, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0 ? scores[0].skill : null;
}

// ── Output formatters ───────────────────────────────────────────────────────

function formatList(json) {
  if (json) return JSON.stringify(SKILLS.map(s => ({ name: s.name, description: s.description, hasScript: !!s.script })), null, 2);

  const lines = ['🛠️  Git Toolkit — Available skills\n'];
  for (const s of SKILLS) {
    const tag = s.script ? '📦' : '📖';
    lines.push(`  ${tag} ${s.name}`);
    lines.push(`     ${s.description}`);
    if (s.aliases.length > 0) {
      lines.push(`     keywords: ${s.aliases.slice(0, 5).join(', ')}`);
    }
    lines.push('');
  }
  lines.push('Usage: git-toolkit -- <intent description>');
  lines.push('       git-toolkit -- <skill-name> <args...>');
  lines.push('       git-toolkit --list [--json]');
  return lines.join('\n');
}

function formatRouting(matched, query, json) {
  if (json) return JSON.stringify({ matched: matched.name, intent: query, script: matched.script || null, runDirectly: !!matched.script });

  const lines = [];
  lines.push(`🛠️  Git Toolkit → ${matched.name}`);
  lines.push(`   ${matched.description}\n`);
  if (matched.script) {
    const scriptPath = resolveScript(matched.name);
    lines.push(`   Script: ${scriptPath || matched.script}`);
    lines.push(`   Run: node ${matched.script} [options]`);
  } else {
    lines.push(`   This is a reference skill (SKILL.md only — no executable script).`);
  }
  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  // Flags
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');
  const list = args.includes('--list') || args.includes('-l');

  if (help) {
    console.log(formatList(false));
    process.exit(0);
  }

  if (list) {
    console.log(formatList(json));
    process.exit(0);
  }

  // Find intent query after -- or as remaining args
  let query = '';
  // Strip flags first, keep positional args and post-separator args
  const nonFlags = args.filter(a => !a.startsWith('-') || a === '--');
  const sepIdx = nonFlags.indexOf('--');
  if (sepIdx !== -1) {
    query = nonFlags.slice(sepIdx + 1).join(' ');
  } else if (nonFlags.length > 0 && !nonFlags[0].startsWith('-')) {
    query = nonFlags.join(' ');
  }

  if (!query) {
    console.log(formatList(false));
    process.exit(0);
  }

  // Try exact skill name match first
  const exactName = SKILLS.find(s => s.name === query || s.name === 'git-' + query.replace(/^git-?/, ''));
  if (exactName) {
    console.log(formatRouting(exactName, query, json));
    process.exit(0);
  }

  // Intent-based matching
  const matched = matchIntent(query);
  if (matched) {
    console.log(formatRouting(matched, query, json));
    process.exit(0);
  }

  // No match
  if (json) {
    console.log(JSON.stringify({ error: 'No matching git skill found', query, available: SKILLS.map(s => s.name) }));
  } else {
    console.log(`🛠️  Git Toolkit — No matching skill for: "${query}"`);
    console.log('Run git-toolkit --list to see available skills.');
    console.log('Or try: git-toolkit -- <description of what you need>\n');
    // Show closest matches
    const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const hints = SKILLS.map(s => {
      let score = 0;
      for (const w of qWords) {
        for (const a of s.aliases) { if (a.includes(w)) score++; }
        if (s.description.toLowerCase().includes(w)) score++;
      }
      return { name: s.name, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

    if (hints.length > 0) {
      console.log('Did you mean:');
      for (const h of hints.slice(0, 3)) {
        console.log(`  • ${h.name}`);
      }
    }
  }
  process.exit(1);
}

main();
