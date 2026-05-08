#!/usr/bin/env node
// prompt-library.cjs — Manage, search, compose, and validate reusable prompt templates
// Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function die(msg, code = 1) {
  console.error(`❌ ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (key === 'help' || key === 'h') { flags.help = true; continue; }
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else if (args[i].startsWith('-') && args[i].length === 2) {
      const key = args[i].slice(1);
      if (key === 'h') { flags.help = true; continue; }
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { command: positional[0] || 'list', arg: positional[1] || null, flags };
}

function showHelp() {
  console.log(`📚 Prompt Library — Manage reusable prompt templates

Usage: node prompt-library.cjs <command> [args] [flags]

Commands:
  list [query]        List all templates (optionally filter by query)
  search <query>      Search templates by keyword
  compose <t1,t2,..>  Compose multiple templates into one payload
  validate [name]     Validate templates for issues
  show <name>         Display a specific template
  create <name>       Create a new template skeleton
  stats               Show library statistics
  diff <name>         Show git diff for a template

Flags:
  --prompts-dir, -p   Prompts directory (default: ./prompts/)
  --json              JSON output
  --full              Include full content in listings
  --tag, -t <tag>     Filter by tag
  --desc "..."        Description for create command
  --help, -h          Show this help
`);
}

function resolvePromptsDir(flags) {
  const dir = flags.p || flags['prompts-dir'] || path.join(__dirname, '..', 'prompts');
  return path.resolve(dir);
}

function loadTemplate(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { raw, frontmatter: {}, content: raw.trim(), parseError: 'No frontmatter found' };
  }
  const fm = {};
  fmMatch[1].split('\n').forEach(line => {
    const [key, ...rest] = line.split(': ');
    if (key && rest.length) {
      const val = rest.join(': ').trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        fm[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      } else {
        fm[key] = val;
      }
    }
  });
  return {
    raw,
    frontmatter: fm,
    content: fmMatch[2].trim(),
    name: fm.name || path.basename(filePath, '.md'),
    parseError: null,
    filePath
  };
}

function getAllTemplates(promptsDir) {
  if (!fs.existsSync(promptsDir)) return [];
  return fs.readdirSync(promptsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => loadTemplate(path.join(promptsDir, f)))
    .filter(t => !t.parseError);
}

function getTemplateByName(promptsDir, name) {
  const filePath = path.join(promptsDir, `${name}.md`);
  if (!fs.existsSync(filePath)) return null;
  return loadTemplate(filePath);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdList(promptsDir, flags) {
  const templates = getAllTemplates(promptsDir);
  if (!templates.length) {
    console.log('📚 Prompt Library — empty (no templates found)');
    return templates;
  }

  if (flags.json) return templates.map(t => ({
    name: t.name,
    description: t.frontmatter.description || '',
    tags: t.frontmatter.tags || [],
    version: t.frontmatter.version || '1.0.0',
    size: t.content.length
  }));

  console.log(`📚 Prompt Library — ${templates.length} template${templates.length !== 1 ? 's' : ''} in ${promptsDir}\n`);
  for (const t of templates) {
    const tags = (t.frontmatter.tags || []).join(', ');
    const tagStr = tags ? `  [${tags}]` : '';
    if (flags.full) {
      console.log(`  📄 ${t.name}${tagStr}`);
      console.log(`     ${t.frontmatter.description || 'No description'}`);
      console.log(`     ${t.content.split('\n').length} lines · ${t.content.length} chars`);
      console.log(`     ─────────────────────────────────────────`);
      console.log(t.content);
      console.log(`     ─────────────────────────────────────────\n`);
    } else {
      console.log(`  ${t.name.padEnd(28)}${(t.frontmatter.description || 'No description').slice(0, 45)}${tagStr ? `  [${tags}]` : ''}`);
    }
  }
  return templates;
}

function cmdSearch(promptsDir, query, flags) {
  if (!query) die('search requires a query');
  const templates = getAllTemplates(promptsDir);
  const q = query.toLowerCase();
  const tag = flags.tag || flags.t || null;

  let results = templates.filter(t => {
    const matchesQuery = !q ||
      t.name.toLowerCase().includes(q) ||
      (t.frontmatter.description || '').toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q);
    const matchesTag = !tag || (t.frontmatter.tags || []).includes(tag);
    return matchesQuery && matchesTag;
  });

  if (flags.json) return results.map(t => ({
    name: t.name,
    description: t.frontmatter.description || '',
    tags: t.frontmatter.tags || [],
    score: t.name.toLowerCase().includes(q) ? 3 :
           (t.frontmatter.description || '').toLowerCase().includes(q) ? 2 : 1
  }));

  if (!results.length) {
    console.log(`🔍 No templates matching "${query}"${tag ? ` with tag "${tag}"` : ''}`);
    return [];
  }

  console.log(`🔍 Found ${results.length} template${results.length !== 1 ? 's' : ''} matching "${query}"${tag ? ` [tag: ${tag}]` : ''}\n`);
  for (const t of results) {
    const tags = (t.frontmatter.tags || []).join(', ');
    console.log(`  📄 ${t.name}${tags ? `  [${tags}]` : ''}`);
    console.log(`     ${t.frontmatter.description || 'No description'}`);
  }
  return results;
}

function cmdCompose(promptsDir, arg, flags) {
  if (!arg) die('compose requires comma-separated template names, e.g. compose preflight,quiet-hours');

  const names = arg.split(',').map(s => s.trim()).filter(Boolean);
  const templates = [];
  const missing = [];

  for (const name of names) {
    const t = getTemplateByName(promptsDir, name);
    if (t) templates.push(t);
    else missing.push(name);
  }

  if (missing.length) die(`Templates not found: ${missing.join(', ')}`);

  const composed = templates.map(t => t.content).join('\n\n');
  const placeholderRe = /\{\{(\w+)\}\}/g;
  const placeholders = [];
  let match;
  while ((match = placeholderRe.exec(composed)) !== null) {
    if (!placeholders.includes(match[1])) placeholders.push(match[1]);
  }

  if (flags.json) return {
    templates: names,
    composed,
    placeholders,
    totalChars: composed.length,
    totalLines: composed.split('\n').length
  };

  console.log(`📋 Composed payload (${templates.length} templates):`);
  console.log(`   ${names.join(' + ')}\n`);
  console.log('─────────────────────────────────────');
  console.log(composed);
  console.log('─────────────────────────────────────');

  if (placeholders.length) {
    console.log(`\n⚠️  ${placeholders.length} unresolved placeholder${placeholders.length !== 1 ? 's' : ''}: ${placeholders.map(p => `{{${p}}}`).join(', ')}`);
  }

  return { templates: names, composed, placeholders };
}

function cmdValidate(promptsDir, name, flags) {
  const issues = [];
  let templates;

  if (name) {
    const t = getTemplateByName(promptsDir, name);
    if (!t) die(`Template "${name}" not found`);
    templates = [t];
  } else {
    templates = getAllTemplates(promptsDir);
  }

  const allTags = new Map();

  for (const t of templates) {
    const fm = t.frontmatter;

    // Missing required frontmatter
    if (!fm.name) issues.push({ template: t.name, level: 'error', msg: 'Missing "name" in frontmatter' });
    if (!fm.description) issues.push({ template: t.name, level: 'warn', msg: 'Missing "description" in frontmatter' });
    if (!fm.tags || !fm.tags.length) issues.push({ template: t.name, level: 'warn', msg: 'No tags defined' });

    // Empty content
    if (!t.content.trim()) issues.push({ template: t.name, level: 'error', msg: 'Template has empty content' });

    // Long template warning
    if (t.content.length > 2000) {
      issues.push({ template: t.name, level: 'warn', msg: `Content exceeds 2000 chars (${t.content.length} chars)` });
    }

    // Track tags for duplicate detection
    for (const tag of (fm.tags || [])) {
      if (!allTags.has(tag)) allTags.set(tag, []);
      allTags.get(tag).push(t.name);
    }
  }

  // Cross-template checks
  if (!name) {
    for (const [tag, names] of allTags) {
      // No issue for shared tags — that's normal
    }
  }

  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warn');

  if (flags.json) return { total: templates.length, errors, warnings, valid: errors.length === 0 };

  if (issues.length === 0) {
    console.log(`✅ ${templates.length}/${templates.length} template${templates.length !== 1 ? 's' : ''} valid`);
  } else {
    if (warnings.length) {
      const okCount = templates.length - new Set(warnings.map(w => w.template)).size;
      console.log(`✅ ${okCount}/${templates.length} template${templates.length !== 1 ? 's' : ''} valid`);
    }
    for (const w of warnings) {
      console.log(`⚠️  ${w.template}: ${w.msg}`);
    }
    for (const e of errors) {
      console.log(`❌ ${e.template}: ${e.msg}`);
    }
  }

  return issues;
}

function cmdShow(promptsDir, name, flags) {
  if (!name) die('show requires a template name');
  const t = getTemplateByName(promptsDir, name);
  if (!t) die(`Template "${name}" not found`);

  if (flags.json) return {
    name: t.name,
    frontmatter: t.frontmatter,
    content: t.content,
    size: t.content.length,
    lines: t.content.split('\n').length
  };

  const tags = (t.frontmatter.tags || []).join(', ');
  console.log(`📄 ${t.name}${tags ? `  [${tags}]` : ''}`);
  console.log(`   ${t.frontmatter.description || 'No description'}`);
  if (t.frontmatter.version) console.log(`   Version: ${t.frontmatter.version}`);
  console.log(`   ${t.content.split('\n').length} lines · ${t.content.length} chars\n`);
  console.log(t.content);

  return t;
}

function cmdCreate(promptsDir, name, flags) {
  if (!name) die('create requires a template name');
  if (!/^[a-z0-9-]+$/.test(name)) die('Template name must be kebab-case (lowercase, hyphens, numbers)');

  const dir = promptsDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${name}.md`);
  if (fs.existsSync(filePath)) die(`Template "${name}" already exists at ${filePath}`);

  const desc = flags.desc || flags.d || '';
  const template = `---
name: ${name}
description: ${desc}
tags: []
version: 1.0.0
---

`;

  fs.writeFileSync(filePath, template.trim() + '\n');
  console.log(`✅ Created template "${name}" at ${filePath}`);
  console.log(`   Edit it to add your prompt content.`);

  return { name, filePath };
}

function cmdStats(promptsDir, flags) {
  const templates = getAllTemplates(promptsDir);
  const tagCounts = new Map();
  let totalChars = 0;
  let totalLines = 0;

  for (const t of templates) {
    totalChars += t.content.length;
    totalLines += t.content.split('\n').length;
    for (const tag of (t.frontmatter.tags || [])) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (flags.json) return {
    totalTemplates: templates.length,
    totalChars,
    totalLines,
    avgChars: templates.length ? Math.round(totalChars / templates.length) : 0,
    avgLines: templates.length ? Math.round(totalLines / templates.length) : 0,
    uniqueTags: tagCounts.size,
    topTags: Object.fromEntries(topTags)
  };

  console.log(`📊 Prompt Library Stats`);
  console.log(`   Templates: ${templates.length}`);
  console.log(`   Total content: ${totalLines} lines · ${(totalChars / 1024).toFixed(1)} KB`);
  console.log(`   Avg per template: ${templates.length ? Math.round(totalChars / templates.length) : 0} chars`);
  console.log(`   Unique tags: ${tagCounts.size}`);
  if (topTags.length) {
    console.log(`\n   Top tags:`);
    for (const [tag, count] of topTags) {
      console.log(`     ${tag.padEnd(20)} ${count} template${count !== 1 ? 's' : ''}`);
    }
  }

  return { totalTemplates: templates.length, totalChars, uniqueTags: tagCounts.size };
}

function cmdDiff(promptsDir, name, flags) {
  if (!name) die('diff requires a template name');
  const t = getTemplateByName(promptsDir, name);
  if (!t) die(`Template "${name}" not found`);

  const { execSync } = require('child_process');
  const repoRoot = findGitRoot(path.dirname(promptsDir));

  if (!repoRoot) {
    console.log('ℹ️  Not in a git repository — cannot diff');
    return null;
  }

  try {
    const relPath = path.relative(repoRoot, t.filePath);
    const diff = execSync(`git diff HEAD -- "${relPath}"`, {
      cwd: repoRoot,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024
    });
    if (!diff.trim()) {
      console.log(`📄 ${name}: no uncommitted changes`);
    } else {
      console.log(diff);
    }
    return diff;
  } catch {
    console.log(`📄 ${name}: not tracked by git or no changes`);
    return null;
  }
}

function findGitRoot(dir) {
  let current = dir;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { command, arg, flags } = parseArgs(process.argv);

  if (flags.help) { showHelp(); process.exit(0); }

  const promptsDir = resolvePromptsDir(flags);

  switch (command) {
    case 'list': return cmdList(promptsDir, flags);
    case 'search': return cmdSearch(promptsDir, arg, flags);
    case 'compose': return cmdCompose(promptsDir, arg, flags);
    case 'validate': return cmdValidate(promptsDir, arg, flags);
    case 'show': return cmdShow(promptsDir, arg, flags);
    case 'create': return cmdCreate(promptsDir, arg, flags);
    case 'stats': return cmdStats(promptsDir, flags);
    case 'diff': return cmdDiff(promptsDir, arg, flags);
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

main();
