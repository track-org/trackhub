#!/usr/bin/env node
// skill-discovery.mjs — Index and search trackhub skills by metadata
// Zero external dependencies. ES2022 compatible.

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const USAGE = `Usage: skill-discovery.mjs <command> <skills-dir> [query] [options]

Commands:
  list <dir>           List all indexed skills
  search <dir> <query> Search by keywords
  tags <dir> <tags>    Search by tags (comma-separated)
  show <dir> <name>    Show full details for one skill
  categories <dir>     Group skills by category

Options:
  --json     Output as JSON
  --limit N  Max results (default: 10)
  --all      No result limit
  --verbose  Include full description in results`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const dir = args[1];
  const query = args[2];
  const opts = {
    json: args.includes("--json"),
    limit: (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1]) || 10 : 10; })(),
    all: args.includes("--all"),
    verbose: args.includes("--verbose"),
  };
  return { command, dir, query, opts };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

function indexSkills(dir) {
  const skillsDir = resolve(dir);
  if (!existsSync(skillsDir)) {
    console.error(`Error: skills directory not found: ${skillsDir}`);
    process.exit(1);
  }
  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const content = readFileSync(skillFile, "utf8");
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name) continue;
    skills.push({
      name: fm.name,
      description: fm.description || "",
      category: fm.category || "uncategorized",
      tags: parseTags(fm.tags),
      skillType: fm["skill-type"] || "standard",
      dir: entry.name,
    });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function parseTags(raw) {
  if (!raw) return [];
  return raw.replace(/[\[\]]/g, "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
}

function matchKeywords(text, queryWords) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    if (lower.includes(w.toLowerCase())) score++;
  }
  return score;
}

function cmdList(skills, opts) {
  if (opts.json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }
  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }
  console.log(`Indexed ${skills.length} skill(s):\n`);
  for (const s of skills) {
    const tagStr = s.tags.length ? ` [${s.tags.join(", ")}]` : "";
    console.log(`  ${s.name} [${s.category}]${tagStr}`);
    console.log(`    ${s.description.substring(0, 100)}${s.description.length > 100 ? "..." : ""}`);
    console.log();
  }
}

function cmdSearch(skills, query, opts) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const scored = skills.map(s => {
    const text = `${s.name} ${s.description} ${s.tags.join(" ")} ${s.category}`;
    return { ...s, score: matchKeywords(text, words) };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  const limit = opts.all ? scored.length : opts.limit;
  const results = scored.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify({ query, count: results.length, results }, null, 2));
    return;
  }
  if (results.length === 0) {
    console.log(`No skills match "${query}".`);
    return;
  }
  console.log(`Results for "${query}" (${results.length} match${results.length !== 1 ? "es" : ""}):\n`);
  results.forEach((s, i) => {
    const tagStr = s.tags.length ? ` [${s.tags.join(", ")}]` : "";
    console.log(`  #${i + 1} ${s.name} [${s.category}]${tagStr}`);
    if (opts.verbose) {
      console.log(`     ${s.description}`);
    } else {
      console.log(`     ${s.description.substring(0, 80)}${s.description.length > 80 ? "..." : ""}`);
    }
    console.log();
  });
}

function cmdTags(skills, tagQuery, opts) {
  const searchTags = tagQuery.toLowerCase().split(",").map(t => t.trim()).filter(Boolean);
  const results = skills.filter(s => {
    return searchTags.some(t => s.tags.includes(t));
  });
  if (opts.json) {
    console.log(JSON.stringify({ tags: searchTags, count: results.length, results }, null, 2));
    return;
  }
  if (results.length === 0) {
    console.log(`No skills with tags matching: ${searchTags.join(", ")}`);
    return;
  }
  console.log(`Skills with tags matching ${searchTags.join(", ")} (${results.length}):\n`);
  results.forEach((s, i) => {
    console.log(`  ${s.name} [${s.category}]`);
    console.log(`    Tags: ${s.tags.join(", ")}`);
    console.log(`    ${s.description.substring(0, 100)}${s.description.length > 100 ? "..." : ""}`);
    console.log();
  });
}

function cmdShow(skills, name, opts) {
  const skill = skills.find(s => s.name.toLowerCase() === name.toLowerCase());
  if (!skill) {
    console.log(`Skill "${name}" not found.`);
    return;
  }
  if (opts.json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }
  console.log(`Name:      ${skill.name}`);
  console.log(`Category:  ${skill.category}`);
  console.log(`Type:      ${skill.skillType}`);
  console.log(`Directory: ${skill.dir}`);
  console.log(`Tags:      ${skill.tags.length ? skill.tags.join(", ") : "(none)"}`);
  console.log();
  console.log(`Description:`);
  console.log(`  ${skill.description}`);
}

function cmdCategories(skills, opts) {
  const cats = {};
  for (const s of skills) {
    if (!cats[s.category]) cats[s.category] = [];
    cats[s.category].push(s.name);
  }
  if (opts.json) {
    console.log(JSON.stringify(cats, null, 2));
    return;
  }
  const catNames = Object.keys(cats).sort();
  for (const cat of catNames) {
    console.log(`[${cat}] (${cats[cat].length})`);
    for (const name of cats[cat].sort()) {
      console.log(`  - ${name}`);
    }
    console.log();
  }
}

// Main
const { command, dir, query, opts } = parseArgs(process.argv);

if (!command || !dir || (["search", "tags", "show"].includes(command) && !query)) {
  console.error(USAGE);
  process.exit(1);
}

const skills = indexSkills(dir);

switch (command) {
  case "list": cmdList(skills, opts); break;
  case "search": cmdSearch(skills, query, opts); break;
  case "tags": cmdTags(skills, query, opts); break;
  case "show": cmdShow(skills, query, opts); break;
  case "categories": cmdCategories(skills, opts); break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error(USAGE);
    process.exit(1);
}
