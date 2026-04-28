#!/usr/bin/env node
// skill-usage.mjs — Scan cron jobs and skill SKILL.md files to report
// which trackhub skills are actively used, referenced, or orphaned.
// Zero external dependencies. Node.js 18+.

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";

const USAGE = `\
skill-usage — Report which trackhub skills are used, referenced, or orphaned.

Usage:
  skill-usage.mjs [options]

Options:
  --cron <path>       Path to cron jobs.json (default: ~/.openclaw/cron/jobs.json)
  --skills <path>     Path to skills directory (default: ./skills)
  --json              JSON output
  --quiet             Warnings only (orphans + unused)
  --active-only       Only show actively-used skills
  --orphans-only      Only show orphaned skills
  --help              Show this help
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { console.log(USAGE); process.exit(0); }
    if (a === "--json") { opts.json = true; continue; }
    if (a === "--quiet") { opts.quiet = true; continue; }
    if (a === "--active-only") { opts.activeOnly = true; continue; }
    if (a === "--orphans-only") { opts.orphansOnly = true; continue; }
    if (a === "--cron" && argv[i + 1]) { opts.cronPath = argv[++i]; continue; }
    if (a === "--skills" && argv[i + 1]) { opts.skillsPath = argv[++i]; continue; }
  }
  return opts;
}

function loadCronJobs(path) {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const arr = raw.jobs || raw;
  if (!Array.isArray(arr)) return [];
  return arr;
}

function discoverSkills(skillsDir) {
  const skills = [];
  if (!existsSync(skillsDir)) return skills;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, "utf-8");
    // Extract name from frontmatter or directory
    const fmMatch = content.match(/^---\s*\n[\s\S]*?^name:\s*(.+)$/m);
    const name = (fmMatch ? fmMatch[1].trim() : entry.name).toLowerCase();
    // Extract description from frontmatter (handles single-line and folded > scalars)
    let description = "";
    const fmBlock = content.match(/^---\s*\n([\s\S]*?\n)---/);
    if (fmBlock) {
      const fm = fmBlock[1];
      // Single-line: description: Some text
      const singleMatch = fm.match(/^description:\s*(.+)$/m);
      if (singleMatch) {
        description = singleMatch[1].replace(/^["'>]+/, "").trim();
      }
      // Folded block: description: >\n  line1\n  line2
      const foldMatch = fm.match(/^description:\s*>\s*\n((?:  .+\n?)*)/m);
      if (foldMatch) {
        description = foldMatch[1]
          .split("\n")
          .map((l) => l.replace(/^  ?/, ""))
          .join(" ")
          .trim();
      }
    }
    // Extract declared scripts
    const scripts = [];
    const scriptRe = /available-scripts:\s*\n((?:\s+- .+\n)+)/g;
    let m;
    while ((m = scriptRe.exec(content)) !== null) {
      const nameMatch = m[1].match(/name:\s*(.+)/);
      if (nameMatch) scripts.push(nameMatch[1].trim().toLowerCase());
    }
    // Also look for script file references in the doc body
    const bodyScripts = [];
    const bodyRe = /(?:scripts\/|\.\/scripts\/)(\S+\.(?:mjs|cjs|js|py|sh))/g;
    while ((m = bodyRe.exec(content)) !== null) {
      bodyScripts.push(m[1].toLowerCase());
    }
    const allScripts = [...new Set([...scripts, ...bodyScripts])];

    skills.push({
      name,
      dirName: entry.name,
      description,
      scripts: allScripts,
      frontmatter: content.split("\n---\n")[1]?.split("\n---\n")[0] || "",
    });
  }
  return skills;
}

function extractSkillRefsFromJob(job) {
  const payload = job.payload || {};
  const text = (payload.text || "") + (payload.message || "");
  const refs = new Set();

  // Match skill directory names referenced in paths
  const pathRe = /(?:trackhub\/skills|skills)\/([a-z0-9_-]+)/gi;
  let m;
  while ((m = pathRe.exec(text)) !== null) {
    refs.add(m[1].toLowerCase());
  }

  // Match skill names mentioned in text
  const skillsDir = resolve(import.meta.dirname, "..", "..");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name.toLowerCase();
      // Only match if it's a plausible skill name (3+ chars, contains hyphen or is a known pattern)
      if (name.length < 3) continue;
      const regex = new RegExp(`\\b${name.replace(/[-/]/g, "[-/]")}\\b`, "i");
      if (regex.test(text)) {
        refs.add(name);
      }
    }
  }

  return [...refs];
}

function main() {
  const opts = parseArgs(process.argv);
  const home = process.env.HOME || "/root";
  const cronPath = opts.cronPath || join(home, ".openclaw", "cron", "jobs.json");
  const skillsDir = opts.skillsPath || resolve(import.meta.dirname, "..", "..");

  const jobs = loadCronJobs(cronPath);
  const skills = discoverSkills(skillsDir);
  const skillNames = new Map(skills.map((s) => [s.name, s]));

  // Map skill dir names too
  skills.forEach((s) => skillNames.set(s.dirName.toLowerCase(), s));

  // Build usage map
  const usage = new Map(); // skillName -> { jobs: [...], refs: Set }
  for (const s of skills) {
    usage.set(s.name, { skill: s, jobs: [], refSources: new Set() });
  }

  const enabledJobs = jobs.filter((j) => j.enabled !== false);

  for (const job of enabledJobs) {
    const refs = extractSkillRefsFromJob(job);
    const jobName = job.name || job.id?.slice(0, 8) || "unknown";
    for (const ref of refs) {
      // Try to match to a known skill
      let matched = skillNames.get(ref);
      if (!matched) {
        // Partial match
        for (const [key, s] of skillNames) {
          if (key.includes(ref) || ref.includes(key)) {
            matched = s;
            break;
          }
        }
      }
      if (matched) {
        const entry = usage.get(matched.name);
        if (entry) {
          entry.jobs.push(jobName);
          entry.refSources.add(ref);
        }
      }
    }
  }

  // Classify
  const active = []; // used by at least one enabled cron job
  const referenced = []; // mentioned in payloads but not directly used
  const orphaned = []; // not referenced by any cron job

  for (const [, entry] of usage) {
    if (entry.jobs.length > 0) {
      active.push(entry);
    } else {
      orphaned.push(entry);
    }
  }

  active.sort((a, b) => b.jobs.length - a.jobs.length);
  orphaned.sort((a, b) => a.skill.name.localeCompare(b.skill.name));

  if (opts.json) {
    const out = {
      totalSkills: skills.length,
      active: active.length,
      orphaned: orphaned.length,
      totalJobs: jobs.length,
      enabledJobs: enabledJobs.length,
      active: active.map((e) => ({
        name: e.skill.name,
        dirName: e.skill.dirName,
        usedBy: e.jobs,
      })),
      orphaned: orphaned.map((e) => ({
        name: e.skill.name,
        dirName: e.skill.dirName,
        description: e.skill.description.slice(0, 100),
      })),
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (opts.quiet && orphaned.length === 0) {
    process.exit(0);
  }

  // Human-readable output
  const header = `📊 Skill Usage Report`;
  const summary = `${skills.length} skills · ${active.length} active · ${orphaned.length} orphaned · ${enabledJobs.length}/${jobs.length} jobs enabled`;

  if (opts.activeOnly) {
    if (active.length === 0) {
      console.log("No skills actively used by cron jobs.");
      return;
    }
    console.log(header);
    console.log(summary);
    console.log("");
    console.log("🟢 Active Skills (used by cron jobs):");
    for (const e of active) {
      const jobList = e.jobs.join(", ");
      console.log(`   ${e.skill.name} → ${jobList}`);
    }
    return;
  }

  if (opts.orphansOnly) {
    if (orphaned.length === 0) {
      if (!opts.quiet) console.log("No orphaned skills found.");
      return;
    }
    console.log(`⚠️  Orphaned Skills (${orphaned.length}):`);
    for (const e of orphaned) {
      console.log(`   ${e.skill.name}${e.skill.description ? " — " + e.skill.description.slice(0, 80) : ""}`);
    }
    return;
  }

  console.log(header);
  console.log(summary);
  console.log("");

  if (active.length > 0) {
    console.log(`🟢 Active Skills (${active.length}):`);
    for (const e of active) {
      const jobList = e.jobs.join(", ");
      console.log(`   ${e.skill.name} → ${jobList}`);
    }
    console.log("");
  }

  if (orphaned.length > 0) {
    console.log(`⚪ Orphaned Skills (${orphaned.length} — not referenced by any cron job):`);
    for (const e of orphaned) {
      const desc = e.skill.description ? ` — ${e.skill.description.slice(0, 70)}` : "";
      console.log(`   ${e.skill.name}${desc}`);
    }
    console.log("");
  }

  if (opts.quiet) return;

  // Additional stats
  const disabledJobs = jobs.filter((j) => j.enabled === false);
  if (disabledJobs.length > 0) {
    console.log(`📋 ${disabledJobs.length} disabled jobs (excluded from analysis)`);
  }
}

main();
