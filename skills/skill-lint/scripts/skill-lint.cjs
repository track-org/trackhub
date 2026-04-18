#!/usr/bin/env node
// skill-lint.cjs — Lint SKILL.md files across a skill catalogue for quality and consistency.
// Zero external dependencies. Node.js 12+. CJS for arm64 compatibility.

'use strict';

var fs = require('fs');
var path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
var DEFAULT_SKILLS_DIR = path.join(__dirname, '..', '..');

var RULES = {
  // Each rule: { id, severity, check(skillDir, content) → null | message }
  frontmatter: {
    id: 'frontmatter',
    severity: 'error',
    description: 'SKILL.md must have YAML frontmatter with at least name and description',
    check: function(dir, content) {
      if (!/^---\s*\n/.test(content)) {
        return 'Missing YAML frontmatter block (---)';
      }
      var match = content.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) {
        return 'Malformed frontmatter block';
      }
      var fm = match[1];
      if (!/^name\s*:/m.test(fm)) {
        return 'Frontmatter missing required field: name';
      }
      if (!/^description\s*:/m.test(fm)) {
        return 'Frontmatter missing required field: description';
      }
      // Check name matches directory name
      var dirName = path.basename(dir);
      var nameMatch = fm.match(/^name\s*:\s*(.+)/m);
      if (nameMatch) {
        var name = nameMatch[1].trim().toLowerCase();
        if (name !== dirName.toLowerCase()) {
          return 'Frontmatter name "' + nameMatch[1].trim() + '" does not match directory "' + dirName + '"';
        }
      }
      return null;
    }
  },

  hasContent: {
    id: 'has-content',
    severity: 'error',
    description: 'SKILL.md must have content beyond frontmatter',
    check: function(dir, content) {
      var fmEnd = content.indexOf('---', 3); // skip opening ---
      if (fmEnd === -1) return null;
      var body = content.substring(fmEnd + 3).trim();
      if (body.length < 50) {
        return 'SKILL.md body is very short (' + body.length + ' chars) — may need more detail';
      }
      return null;
    }
  },

  descriptionQuality: {
    id: 'description-quality',
    severity: 'warn',
    description: 'Frontmatter description should be 20-300 chars and end without trailing period',
    check: function(dir, content) {
      var match = content.match(/^description\s*:\s*(.+)/m);
      if (!match) return null;
      var desc = match[1].trim();
      if (desc.length < 20) {
        return 'Description is very short (' + desc.length + ' chars) — add more context for skill discovery';
      }
      if (desc.length > 300) {
        return 'Description is very long (' + desc.length + ' chars) — consider trimming for readability';
      }
      if (/\.\s*$/.test(desc)) {
        return 'Description ends with a period — consider removing for cleaner skill listings';
      }
      return null;
    }
  },

  scriptExists: {
    id: 'script-exists',
    severity: 'info',
    description: 'Check if referenced scripts actually exist',
    check: function(dir, content) {
      var issues = [];
      // Look for script references in common patterns
      var patterns = [
        /`scripts\/([^`]+)`/g,
        /`([^`]+\.(cjs|mjs|js|sh|py))`/g
      ];
      patterns.forEach(function(re) {
        var m;
        while ((m = re.exec(content)) !== null) {
          var scriptName = m[1];
          // Try to find it in the skill dir
          var candidates = [
            path.join(dir, 'scripts', scriptName),
            path.join(dir, scriptName)
          ];
          var found = candidates.some(function(p) {
            try { return fs.statSync(p).isFile(); } catch(e) { return false; }
          });
          if (!found) {
            issues.push('Referenced script not found: scripts/' + scriptName);
          }
        }
      });
      return issues.length > 0 ? issues.join('; ') : null;
    }
  },

  headingStructure: {
    id: 'heading-structure',
    severity: 'info',
    description: 'SKILL.md should have an H1 heading matching the skill name',
    check: function(dir, content) {
      var fmEnd = content.indexOf('---', 3);
      if (fmEnd === -1) return null;
      var body = content.substring(fmEnd + 3);
      var h1Match = body.match(/^#\s+(.+)/m);
      if (!h1Match) {
        return 'No H1 heading found in SKILL.md body';
      }
      var dirName = path.basename(dir);
      var heading = h1Match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      var dirNorm = dirName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (heading !== dirNorm && heading !== dirName.toLowerCase()) {
        return 'H1 heading "' + h1Match[1].trim() + '" may not match skill name "' + dirName + '"';
      }
      return null;
    }
  },

  noTODOs: {
    id: 'no-todos',
    severity: 'warn',
    description: 'SKILL.md should not contain TODO/FIXME/HACK markers',
    check: function(dir, content) {
      // Strip frontmatter, code blocks, and table rows before scanning
      var body = content.replace(/^---[\s\S]*?---\n/, '');
      body = body.replace(/```[\s\S]*?```/g, '');
      body = body.replace(/^\|.+\|$/gm, '');
      var matches = body.match(/\b(TODO|FIXME|HACK|XXX)\b/gi);
      if (matches && matches.length > 0) {
        return 'Found ' + matches.length + ' TODO/FIXME/HACK marker(s) — consider resolving or moving to a task tracker';
      }
      return null;
    }
  },

  consistentSectionOrder: {
    id: 'section-order',
    severity: 'info',
    description: 'Common sections (Why, Usage, Script, Requirements) should appear in a consistent order',
    check: function(dir, content) {
      var sections = ['Why', 'Script', 'Usage', 'Requirements', 'Examples', 'Configuration', 'Limitations'];
      var found = {};
      var lines = content.split('\n');
      var order = [];
      lines.forEach(function(line, i) {
        sections.forEach(function(s) {
          var re = new RegExp('^##\\s+' + s + '\\b', 'i');
          if (re.test(line)) {
            if (!found[s]) {
              found[s] = i;
              order.push(s);
            }
          }
        });
      });
      // Check if order makes sense: "Why" before "Usage" before "Examples"
      var issues = [];
      if (found['Why'] && found['Usage'] && found['Why'] > found['Usage']) {
        issues.push('"Why" section appears after "Usage" — consider moving earlier');
      }
      if (found['Script'] && found['Usage'] && found['Script'] > found['Usage']) {
        issues.push('"Script" section appears after "Usage" — consider moving earlier');
      }
      return issues.length > 0 ? issues.join('; ') : null;
    }
  },

  referencesValid: {
    id: 'references-valid',
    severity: 'info',
    description: 'Check for references to other trackhub skills',
    check: function(dir, content) {
      var issues = [];
      var skillsDir = path.dirname(dir);
      var re = /(?:skill|skills?)\s+`([^`]+)`/gi;
      var m;
      while ((m = re.exec(content)) !== null) {
        var refName = m[1].trim();
        // Check if this skill directory exists
        var refPath = path.join(skillsDir, refName);
        try {
          var stat = fs.statSync(refPath);
          if (!stat.isDirectory()) {
            issues.push('Referenced skill "' + refName + '" exists but is not a directory');
          }
        } catch(e) {
          // Might be a partial name match
          var dirs = [];
          try { dirs = fs.readdirSync(skillsDir); } catch(e2) {}
          var match = dirs.filter(function(d) {
            return d.toLowerCase() === refName.toLowerCase() ||
                   d.toLowerCase().indexOf(refName.toLowerCase()) !== -1;
          });
          if (match.length === 0) {
            issues.push('Referenced skill "' + refName + '" not found in skills directory');
          }
        }
      }
      return issues.length > 0 ? issues.join('; ') : null;
    }
  }
};

// ── CLI ─────────────────────────────────────────────────────────────────────
var args = process.argv.slice(2);

function printUsage() {
  console.log('Usage: skill-lint.cjs [options] [skill-dir ...]');
  console.log('');
  console.log('Lint SKILL.md files for quality and consistency.');
  console.log('');
  console.log('Options:');
  console.log('  --dir <path>       Skills directory to scan (default: parent of skills/)');
  console.log('  --rule <id>        Only run a specific rule');
  console.log('  --severity <s>     Only show issues at or above this severity: error|warn|info');
  console.log('  --json             JSON output');
  console.log('  --quiet            Only show skills with issues');
  console.log('  --fix              Auto-fix what we can (description period, TODOs flagged)');
  console.log('  --list-rules       List all available rules');
  console.log('  --help             Show this help');
  console.log('');
  console.log('Severity levels: error > warn > info');
}

if (args.indexOf('--help') !== -1 || args.indexOf('-h') !== -1) {
  printUsage();
  process.exit(0);
}

if (args.indexOf('--list-rules') !== -1) {
  console.log('Available rules:');
  Object.keys(RULES).forEach(function(id) {
    var r = RULES[id];
    console.log('  ' + id.padEnd(22) + '[' + r.severity.padEnd(5) + '] ' + r.description);
  });
  process.exit(0);
}

var opts = {
  skillsDir: DEFAULT_SKILLS_DIR,
  onlyRule: null,
  minSeverity: 'info',
  json: false,
  quiet: false,
  fix: false,
  targetSkills: []
};

for (var i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--dir':
      opts.skillsDir = args[++i];
      break;
    case '--rule':
      opts.onlyRule = args[++i];
      break;
    case '--severity':
      opts.minSeverity = args[++i];
      break;
    case '--json':
      opts.json = true;
      break;
    case '--quiet':
      opts.quiet = true;
      break;
    case '--fix':
      opts.fix = true;
      break;
    default:
      if (args[i].charAt(0) !== '-') {
        opts.targetSkills.push(args[i]);
      }
  }
}

var SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

function severityAtLeast(s, min) {
  return (SEVERITY_ORDER[s] || 99) <= (SEVERITY_ORDER[min] || 99);
}

// ── Lint ────────────────────────────────────────────────────────────────────
function lintSkill(skillDir) {
  var skillFile = path.join(skillDir, 'SKILL.md');
  var results = [];

  try {
    var stat = fs.statSync(skillFile);
    if (!stat.isFile()) return { dir: path.basename(skillDir), issues: [], error: 'SKILL.md is not a file' };
  } catch(e) {
    return { dir: path.basename(skillDir), issues: [], error: 'No SKILL.md found' };
  }

  var content = fs.readFileSync(skillFile, 'utf8');
  var rules = opts.onlyRule ? { _: RULES[opts.onlyRule] } : RULES;

  Object.keys(rules).forEach(function(ruleId) {
    var rule = rules[ruleId];
    if (!rule) return;
    try {
      var issue = rule.check(skillDir, content);
      if (issue) {
        results.push({
          rule: rule.id,
          severity: rule.severity,
          message: issue
        });
      }
    } catch(e) {
      results.push({
        rule: rule.id,
        severity: 'error',
        message: 'Rule threw an error: ' + e.message
      });
    }
  });

  return { dir: path.basename(skillDir), issues: results };
}

// ── Fix ─────────────────────────────────────────────────────────────────────
function fixSkill(skillDir) {
  var skillFile = path.join(skillDir, 'SKILL.md');
  try {
    var content = fs.readFileSync(skillFile, 'utf8');
    var original = content;

    // Fix trailing period on description
    content = content.replace(
      /^(description\s*:\s*)(.*\.)\s*$/m,
      '$1$2'.replace(/\.\s*$/, '')
    );
    // Actually that regex is wrong for the replacement. Let me do it properly.
    content = original.replace(
      /^(description\s*:\s*)([^\n]+?)\.\s*$/m,
      function(match, prefix, desc) {
        return prefix + desc.replace(/\.+$/, '');
      }
    );

    if (content !== original) {
      fs.writeFileSync(skillFile, content, 'utf8');
      return true;
    }
  } catch(e) {
    // silent
  }
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  var skillsDir = opts.skillsDir;
  var skillDirs = [];

  if (opts.targetSkills.length > 0) {
    opts.targetSkills.forEach(function(name) {
      skillDirs.push(path.join(skillsDir, name));
    });
  } else {
    try {
      var entries = fs.readdirSync(skillsDir);
      entries.forEach(function(entry) {
        var full = path.join(skillsDir, entry);
        try {
          if (fs.statSync(full).isDirectory() && entry.charAt(0) !== '.') {
            skillDirs.push(full);
          }
        } catch(e) {}
      });
    } catch(e) {
      console.error('Error reading skills directory: ' + e.message);
      process.exit(1);
    }
  }

  skillDirs.sort();

  var allResults = [];
  var totalIssues = 0;
  var fixed = 0;

  skillDirs.forEach(function(dir) {
    if (opts.fix) {
      if (fixSkill(dir)) fixed++;
    }
    var result = lintSkill(dir);
    var filtered = result.issues.filter(function(i) {
      return severityAtLeast(i.severity, opts.minSeverity);
    });
    result.issues = filtered;
    totalIssues += filtered.length;
    if (!opts.quiet || filtered.length > 0) {
      allResults.push(result);
    }
  });

  if (opts.json) {
    console.log(JSON.stringify({ skills: allResults, totalIssues: totalIssues, fixed: fixed }, null, 2));
    return;
  }

  // Text output
  var skillsWithIssues = allResults.filter(function(r) { return r.issues.length > 0; });
  var skillsOk = allResults.filter(function(r) { return r.issues.length === 0 && !r.error; });

  if (opts.fix && fixed > 0) {
    console.log('🔧 Fixed ' + fixed + ' skill(s)');
    console.log('');
  }

  if (skillsWithIssues.length === 0) {
    console.log('✅ All ' + allResults.length + ' skills pass lint (' + Object.keys(RULES).length + ' rules)');
  } else {
    console.log('📋 ' + skillsWithIssues.length + '/' + allResults.length + ' skills have issues (' + totalIssues + ' total)');
    console.log('');

    skillsWithIssues.forEach(function(r) {
      if (r.error) {
        console.log('❌ ' + r.dir + ': ' + r.error);
        return;
      }
      console.log('⚠️  ' + r.dir + ':');
      r.issues.forEach(function(issue) {
        var icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warn' ? '🟡' : '🔵';
        console.log('   ' + icon + ' [' + issue.rule + '] ' + issue.message);
      });
      console.log('');
    });

    if (skillsOk.length > 0 && !opts.quiet) {
      console.log('✅ ' + skillsOk.length + ' skill(s) with no issues');
    }
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main();
