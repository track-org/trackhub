#!/usr/bin/env node

// skill-graph.mjs — Dependency and relationship mapper for trackhub skills
// Zero external dependencies. ES module. Arm64-safe (no template literals with emoji).

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';

const VERSION = '1.0.0';

// --- Helpers ---

function usage() {
  console.log('skill-graph v' + VERSION);
  console.log('');
  console.log('Usage: node skill-graph.mjs <command> <skills-dir> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  graph         Full dependency graph (text tree)');
  console.log('  relations     List all detected relationships');
  console.log('  dependents    Find what depends on a skill');
  console.log('  dependencies  Find what a skill depends on');
  console.log('  orphans       Find skills with no connections');
  console.log('  impact        What is affected if skill X changes');
  console.log('  categories    Group skills by category');
  console.log('  dot           Graphviz DOT format output');
  console.log('');
  console.log('Options:');
  console.log('  --json        Output as JSON');
  console.log('  --verbose     Include detection source');
  console.log('  --include-self Include self-references');
}

function parseArgs(argv) {
  var args = argv.slice(2);
  var cmd = args[0];
  var dir = args[1];
  var flags = {};
  for (var i = 2; i < args.length; i++) {
    var arg = args[i];
    var eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      var key = arg.substring(0, eqIdx);
      var val = arg.substring(eqIdx + 1);
      flags[key] = val;
    } else {
      flags[arg] = true;
    }
  }
  return { cmd: cmd, dir: dir, flags: flags };
}

function readSkillFile(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function parseFrontmatter(content) {
  var match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  var fm = {};
  var lines = match[1].split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    var key = line.substring(0, colonIdx).trim();
    var val = line.substring(colonIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
        (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")) {
      val = val.substring(1, val.length - 1);
    }
    fm[key] = val;
  }
  return fm;
}

function parseTagsFromFrontmatter(content) {
  var match = content.match(/^---\n[\s\S]*?\n---/);
  if (!match) return [];
  var tagLine = match[0].match(/tags:\s*\[([^\]]*)\]/);
  if (!tagLine) return [];
  return tagLine[1].split(',')
    .map(function(t) { return t.trim().replace(/['"]/g, ''); })
    .filter(function(t) { return t.length > 0; });
}

function parseCategoryFromFrontmatter(content) {
  var match = content.match(/^---\n[\s\S]*?\n---/);
  if (!match) return 'unknown';
  var catLine = match[0].match(/category:\s*(.+)/);
  if (!catLine) return 'unknown';
  var cat = catLine[1].trim();
  if ((cat.charAt(0) === '"' && cat.charAt(cat.length - 1) === '"') ||
      (cat.charAt(0) === "'" && cat.charAt(cat.length - 1) === "'")) {
    cat = cat.substring(1, cat.length - 1);
  }
  return cat;
}

function getBody(content) {
  var match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : content;
}

// --- Relationship Detection ---

var RELATION_PATTERNS = [
  { regex: /pairs?\s+with\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'depends' },
  { regex: /depends?\s+on\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'depends' },
  { regex: /requires?\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'depends' },
  { regex: /uses?\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'depends' },
  { regex: /extends?\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'extends' },
  { regex: /enhances?\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'extends' },
  { regex: /builds?\s+on\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'extends' },
  { regex: /see\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'references' },
  { regex: /refer\s+to\s+the?\s+`?([a-z][\w-]*)`?\s+skill/gi, type: 'references' },
  // Also catch bare mentions in backticks that match known skill names
];

function detectRelationships(body, skillName, allSkillNames, includeSelf) {
  var relations = [];

  // Pattern-based detection
  for (var p = 0; p < RELATION_PATTERNS.length; p++) {
    var pattern = RELATION_PATTERNS[p];
    var re = new RegExp(pattern.regex.source, 'gi');
    var m;
    while ((m = re.exec(body)) !== null) {
      var target = m[1].toLowerCase();
      if (target === skillName && !includeSelf) continue;
      if (allSkillNames.indexOf(target) !== -1) {
        // Find the line number for verbose output
        var lineNum = body.substring(0, m.index).split('\n').length;
        var lineText = body.split('\n')[lineNum - 1] || '';
        relations.push({
          from: skillName,
          to: target,
          type: pattern.type,
          source: lineText.trim(),
          line: lineNum
        });
      }
    }
  }

  // Bare backtick mention detection (references)
  var backtickRe = /`([a-z][\w-]+)`/g;
  var btMatch;
  while ((btMatch = backtickRe.exec(body)) !== null) {
    var mention = btMatch[1].toLowerCase();
    if (mention === skillName && !includeSelf) continue;
    if (allSkillNames.indexOf(mention) !== -1) {
      // Only add if not already detected by pattern matching
      var alreadyDetected = relations.some(function(r) { return r.to === mention; });
      if (!alreadyDetected) {
        var btLineNum = body.substring(0, btMatch.index).split('\n').length;
        var btLineText = body.split('\n')[btLineNum - 1] || '';
        relations.push({
          from: skillName,
          to: mention,
          type: 'references',
          source: btLineText.trim(),
          line: btLineNum
        });
      }
    }
  }

  // Deduplicate
  var seen = {};
  relations = relations.filter(function(r) {
    var key = r.from + '>' + r.to + '>' + r.type;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });

  return relations;
}

// --- Scanning ---

function scanSkills(dir) {
  var skills = [];
  if (!existsSync(dir)) {
    console.error('Error: skills directory not found: ' + dir);
    process.exit(1);
  }

  var entries = readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var skillPath = join(dir, entry, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    if (!statSync(skillPath).isFile()) continue;

    var content = readSkillFile(skillPath);
    if (!content) continue;

    var fm = parseFrontmatter(content);
    var tags = parseTagsFromFrontmatter(content);
    var category = parseCategoryFromFrontmatter(content);
    var body = getBody(content);

    skills.push({
      name: (fm.name || entry).toLowerCase(),
      dir: entry,
      description: fm.description || '',
      category: category,
      tags: tags,
      body: body,
      content: content
    });
  }

  return skills;
}

function buildGraph(skills, includeSelf) {
  var allNames = skills.map(function(s) { return s.name; });
  var relations = [];

  for (var i = 0; i < skills.length; i++) {
    var skill = skills[i];
    var detected = detectRelationships(skill.body, skill.name, allNames, includeSelf);
    relations = relations.concat(detected);
  }

  return relations;
}

// --- Output Formatters ---

function buildAdjacency(relations) {
  var adj = {}; // skill -> { depends: [], extends: [], references: [] }
  for (var i = 0; i < relations.length; i++) {
    var r = relations[i];
    if (!adj[r.from]) adj[r.from] = { depends: [], extends: [], references: [] };
    if (!adj[r.to]) adj[r.to] = { depends: [], extends: [], references: [] };
    if (adj[r.from][r.type].indexOf(r.to) === -1) {
      adj[r.from][r.type].push(r.to);
    }
  }
  return adj;
}

function formatGraph(skills, relations, adj, verbose) {
  var lines = [];
  lines.push('Skill Dependency Graph');
  lines.push('======================');
  lines.push('');

  var connected = {};
  for (var i = 0; i < relations.length; i++) {
    connected[relations[i].from] = true;
    connected[relations[i].to] = true;
  }

  for (var j = 0; j < skills.length; j++) {
    var s = skills[j];
    var node = adj[s.name];
    var hasOutgoing = node && (node.depends.length > 0 || node.extends.length > 0 || node.references.length > 0);
    var hasIncoming = false;
    for (var k = 0; k < relations.length; k++) {
      if (relations[k].to === s.name) { hasIncoming = true; break; }
    }

    if (!hasOutgoing && !hasIncoming) continue;

    lines.push(s.name + ' [' + s.category + ']');
    if (node) {
      for (var d = 0; d < node.depends.length; d++) {
        lines.push('  +-- depends --> ' + node.depends[d]);
      }
      for (var e = 0; e < node.extends.length; e++) {
        lines.push('  +-- extends --> ' + node.extends[e]);
      }
      for (var rr = 0; rr < node.references.length; rr++) {
        lines.push('  +-- references --> ' + node.references[rr]);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatRelations(relations, verbose) {
  var lines = [];
  lines.push('All Detected Relationships (' + relations.length + ')');
  lines.push('===================================');
  lines.push('');

  // Group by type
  var groups = { depends: [], extends: [], references: [] };
  for (var i = 0; i < relations.length; i++) {
    var r = relations[i];
    if (groups[r.type]) groups[r.type].push(r);
    else groups[r.type] = [r];
  }

  var types = ['depends', 'extends', 'references'];
  var typeLabels = { depends: 'Depends On', extends: 'Extends', references: 'References' };
  for (var t = 0; t < types.length; t++) {
    var type = types[t];
    var items = groups[type];
    if (!items || items.length === 0) continue;
    lines.push(typeLabels[type] + ' (' + items.length + ')');
    lines.push('---');
    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      var entry = '  ' + item.from + ' --> ' + item.to;
      if (verbose) {
        entry += '  [line ' + item.line + ': ' + item.source + ']';
      }
      lines.push(entry);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatDependents(relations, skillName, verbose) {
  var targets = relations.filter(function(r) { return r.to === skillName; });
  var lines = [];
  lines.push('Skills that depend on ' + skillName + ' (' + targets.length + ')');
  lines.push('==========================================');
  lines.push('');

  if (targets.length === 0) {
    lines.push('  No dependents found.');
    return lines.join('\n');
  }

  // Deduplicate by from+type
  var seen = {};
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var key = t.from + ':' + t.type;
    if (seen[key]) continue;
    seen[key] = true;
    var entry = '  ' + t.from + ' (' + t.type + ')';
    if (verbose) {
      entry += '  [line ' + t.line + ': ' + t.source + ']';
    }
    lines.push(entry);
  }

  return lines.join('\n');
}

function formatDependencies(relations, skillName, verbose) {
  var sources = relations.filter(function(r) { return r.from === skillName; });
  var lines = [];
  lines.push(skillName + ' dependencies (' + sources.length + ')');
  lines.push('================================');
  lines.push('');

  if (sources.length === 0) {
    lines.push('  No dependencies found.');
    return lines.join('\n');
  }

  var seen = {};
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i];
    var key = s.to + ':' + s.type;
    if (seen[key]) continue;
    seen[key] = true;
    var entry = '  ' + s.type + ': ' + s.to;
    if (verbose) {
      entry += '  [line ' + s.line + ': ' + s.source + ']';
    }
    lines.push(entry);
  }

  return lines.join('\n');
}

function formatOrphans(skills, relations) {
  var connected = {};
  for (var i = 0; i < relations.length; i++) {
    connected[relations[i].from] = true;
    connected[relations[i].to] = true;
  }

  var orphans = skills.filter(function(s) { return !connected[s.name]; });
  var lines = [];
  lines.push('Orphan skills (no connections to/from other skills) (' + orphans.length + ')');
  lines.push('================================================================');
  lines.push('');

  if (orphans.length === 0) {
    lines.push('  No orphans found. All skills are connected.');
    return lines.join('\n');
  }

  for (var j = 0; j < orphans.length; j++) {
    lines.push('  - ' + orphans[j].name + ' [' + orphans[j].category + ']');
  }

  return lines.join('\n');
}

function formatImpact(skills, relations, skillName, adj, verbose) {
  // BFS to find all transitively affected skills
  var visited = {};
  var queue = [skillName];
  visited[skillName] = true;

  while (queue.length > 0) {
    var current = queue.shift();
    var dependents = relations.filter(function(r) { return r.to === current; });
    for (var i = 0; i < dependents.length; i++) {
      var d = dependents[i].from;
      if (!visited[d]) {
        visited[d] = true;
        queue.push(d);
      }
    }
  }

  delete visited[skillName];
  var affected = Object.keys(visited);

  var lines = [];
  lines.push('Impact analysis for ' + skillName);
  lines.push('=================================');
  lines.push('');
  lines.push('Direct dependents:');
  var direct = relations.filter(function(r) { return r.to === skillName; });
  var directNames = [];
  for (var j = 0; j < direct.length; j++) {
    if (directNames.indexOf(direct[j].from) === -1) {
      directNames.push(direct[j].from);
    }
  }
  if (directNames.length === 0) {
    lines.push('  None');
  } else {
    for (var k = 0; k < directNames.length; k++) {
      lines.push('  - ' + directNames[k]);
    }
  }

  lines.push('');
  lines.push('Transitively affected (' + affected.length + '):');
  if (affected.length === 0) {
    lines.push('  None');
  } else {
    for (var a = 0; a < affected.length; a++) {
      lines.push('  - ' + affected[a]);
    }
  }

  lines.push('');
  lines.push('Total: ' + (directNames.length + affected.length) + ' skill(s) may be affected by changes to ' + skillName);

  return lines.join('\n');
}

function formatCategories(skills) {
  var groups = {};
  for (var i = 0; i < skills.length; i++) {
    var cat = skills[i].category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(skills[i].name);
  }

  var cats = Object.keys(groups).sort();
  var lines = [];
  lines.push('Skill Categories (' + cats.length + ')');
  lines.push('========================');
  lines.push('');

  for (var c = 0; c < cats.length; c++) {
    var cat = cats[c];
    var items = groups[cat].sort();
    lines.push(cat + ' (' + items.length + ')');
    for (var j = 0; j < items.length; j++) {
      lines.push('  - ' + items[j]);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatDot(skills, relations) {
  var lines = [];
  lines.push('digraph skill_graph {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded, fontname=Helvetica];');
  lines.push('');

  // Group nodes by category with subgraphs
  var catGroups = {};
  for (var i = 0; i < skills.length; i++) {
    var cat = skills[i].category.replace(/[^a-z0-9]/gi, '_');
    if (!catGroups[cat]) catGroups[cat] = [];
    catGroups[cat].push(skills[i].name);
  }

  var cats = Object.keys(catGroups).sort();
  for (var c = 0; c < cats.length; c++) {
    lines.push('  subgraph cluster_' + cats[c] + ' {');
    lines.push('    label="' + cats[c] + '";');
    lines.push('    style=dashed;');
    for (var j = 0; j < catGroups[cats[c]].length; j++) {
      lines.push('    "' + catGroups[cats[c]][j] + '";');
    }
    lines.push('  }');
    lines.push('');
  }

  // Edges by type with different styles
  var edgeStyles = {
    depends: '[color=red, penwidth=2]',
    extends: '[color=blue, penwidth=2, style=dashed]',
    references: '[color=gray, penwidth=1, style=dotted]'
  };

  var seen = {};
  for (var e = 0; e < relations.length; e++) {
    var r = relations[e];
    var key = r.from + '->' + r.to + ':' + r.type;
    if (seen[key]) continue;
    seen[key] = true;
    var style = edgeStyles[r.type] || '[color=gray]';
    lines.push('  "' + r.from + '" -> "' + r.to + '" ' + style + ';');
  }

  lines.push('}');
  return lines.join('\n');
}

// --- Main ---

function main() {
  var parsed = parseArgs(process.argv);

  if (!parsed.cmd || !parsed.dir || parsed.cmd === 'help') {
    usage();
    process.exit(parsed.cmd === 'help' ? 0 : 1);
  }

  var skills = scanSkills(parsed.dir);
  if (skills.length === 0) {
    console.log('No skills found in: ' + parsed.dir);
    process.exit(0);
  }

  var relations = buildGraph(skills, !!parsed.flags['--include-self']);
  var adj = buildAdjacency(relations);
  var verbose = !!parsed.flags['--verbose'];
  var json = !!parsed.flags['--json'];

  var output = '';
  var jsonData = null;

  switch (parsed.cmd) {
    case 'graph':
      output = formatGraph(skills, relations, adj, verbose);
      jsonData = { skills: skills.map(function(s) { return { name: s.name, category: s.category, description: s.description }; }), relations: relations };
      break;
    case 'relations':
      output = formatRelations(relations, verbose);
      jsonData = relations;
      break;
    case 'dependents':
      if (!parsed.flags['--_skillName']) {
        console.error('Error: specify a skill name for dependents command');
        console.error('Usage: node skill-graph.mjs dependents <skills-dir> <skill-name>');
        process.exit(1);
      }
      output = formatDependents(relations, parsed.flags['--_skillName'], verbose);
      break;
    case 'dependencies':
      if (!parsed.flags['--_skillName']) {
        console.error('Error: specify a skill name for dependencies command');
        console.error('Usage: node skill-graph.mjs dependencies <skills-dir> <skill-name>');
        process.exit(1);
      }
      output = formatDependencies(relations, parsed.flags['--_skillName'], verbose);
      break;
    case 'orphans':
      output = formatOrphans(skills, relations);
      jsonData = { orphans: skills.filter(function(s) {
        var connected = false;
        for (var i = 0; i < relations.length; i++) {
          if (relations[i].from === s.name || relations[i].to === s.name) { connected = true; break; }
        }
        return !connected;
      }).map(function(s) { return s.name; }) };
      break;
    case 'impact':
      if (!parsed.flags['--_skillName']) {
        console.error('Error: specify a skill name for impact command');
        console.error('Usage: node skill-graph.mjs impact <skills-dir> <skill-name>');
        process.exit(1);
      }
      output = formatImpact(skills, relations, parsed.flags['--_skillName'], adj, verbose);
      break;
    case 'categories':
      output = formatCategories(skills);
      jsonData = {};
      skills.forEach(function(s) {
        if (!jsonData[s.category]) jsonData[s.category] = [];
        jsonData[s.category].push(s.name);
      });
      break;
    case 'dot':
      output = formatDot(skills, relations);
      // DOT output never goes to JSON
      break;
    default:
      console.error('Unknown command: ' + parsed.cmd);
      usage();
      process.exit(1);
  }

  if (json && jsonData) {
    console.log(JSON.stringify(jsonData, null, 2));
  } else {
    console.log(output);
  }
}

// Handle positional skill name arg for dependents/dependencies/impact
var realArgs = process.argv.slice(2);
var needsSkillName = ['dependents', 'dependencies', 'impact'];

if (needsSkillName.indexOf(realArgs[0]) !== -1 && realArgs.length >= 3) {
  // realArgs = [cmd, dir, skillName, ...flags]
  // The skill name is the 3rd positional arg (index 2)
  // Flags start at index 3
  var skillName = realArgs[2];
  var flags = [];
  for (var fi = 3; fi < realArgs.length; fi++) {
    if (realArgs[fi].startsWith('--')) flags.push(realArgs[fi]);
  }
  // Rewrite process.argv: [node, script, cmd, dir, --flags..., --_skillName=name]
  process.argv = process.argv.slice(0, 2).concat([realArgs[0], realArgs[1]]).concat(flags).concat(['--_skillName=' + skillName]);
}

main();
