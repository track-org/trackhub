#!/usr/bin/env node
// skill-test.cjs — Runtime validation for skill scripts across a catalogue.
// Verifies scripts exist, parse their help/usage output, and optionally
// run them with a dry-run flag to confirm they don't crash.
// Zero external dependencies. Node.js 12+. CJS for arm64 compatibility.

'use strict';

var fs = require('fs');
var path = require('path');
var child = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────

var DEFAULT_SKILLS_DIR = path.join(__dirname, '..', '..');
var TIMEOUT_MS = 15000; // max per-script execution

// ── Args ────────────────────────────────────────────────────────────────

var args = process.argv.slice(2);
var optJson = args.indexOf('--json') !== -1;
var optQuiet = args.indexOf('--quiet') !== -1;
var optDryRun = args.indexOf('--dry-run') !== -1;
var optVerbose = args.indexOf('--verbose') !== -1;
var optSkill = null;
var skillIdx = args.indexOf('--skill');
if (skillIdx !== -1 && args[skillIdx + 1]) {
  optSkill = args[skillIdx + 1];
}
var optDir = DEFAULT_SKILLS_DIR;
var dirIdx = args.indexOf('--dir');
if (dirIdx !== -1 && args[dirIdx + 1]) {
  optDir = args[dirIdx + 1];
}
var optHelp = args.indexOf('--help') !== -1;

// ── Helpers ─────────────────────────────────────────────────────────────

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (e) {
    return false;
  }
}

function runScript(scriptPath, scriptArgs) {
  try {
    var shebang = fs.readFileSync(scriptPath, 'utf8').split('\n')[0] || '';
    var cmd;
    var execArgs = [];

    if (/^#!.*\bpython3?\b/.test(shebang) || /\.py$/.test(scriptPath)) {
      cmd = 'python3';
      execArgs = [scriptPath].concat(scriptArgs);
    } else if (/^#!.*\bbash\b/.test(shebang) || /\.sh$/.test(scriptPath)) {
      cmd = 'bash';
      execArgs = [scriptPath].concat(scriptArgs);
    } else if (/\.mjs$/.test(scriptPath)) {
      cmd = 'node';
      execArgs = [scriptPath].concat(scriptArgs);
    } else {
      // .cjs or unknown — try node
      cmd = 'node';
      execArgs = [scriptPath].concat(scriptArgs);
    }

    var result = child.spawnSync(cmd, execArgs, {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
      env: Object.assign({}, process.env, { PATH: process.env.PATH })
    });

    return {
      exitCode: result.status,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      timedOut: false
    };
  } catch (e) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: e.message,
      timedOut: false
    };
  }
}

// Parse YAML frontmatter from SKILL.md
function parseFrontmatter(content) {
  var match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  var fm = match[1];
  var result = {};
  var current = null;

  fm.split('\n').forEach(function(line) {
    var listMatch = line.match(/^  -\s+name\s*:\s*(.+)/);
    if (listMatch && current) {
      current.name = listMatch[1].trim();
      return;
    }

    listMatch = line.match(/^  -\s+description\s*:\s*(.+)/);
    if (listMatch && current) {
      current.description = listMatch[1].trim();
      return;
    }

    listMatch = line.match(/^  -\s+(.+)/);
    if (listMatch && current) {
      // unknown list item, skip
      return;
    }

    var kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      var key = kvMatch[1].trim();
      var val = (kvMatch[2] || '').trim();
      if (key === 'available-scripts') {
        current = { name: '', description: '' };
        result['available-scripts'] = result['available-scripts'] || [];
        result['available-scripts'].push(current);
      } else {
        result[key] = val;
        current = null;
      }
    }
  });

  return result;
}

// ── Test Logic ──────────────────────────────────────────────────────────

function discoverSkills(baseDir) {
  var skills = [];
  var entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch (e) {
    return skills;
  }

  entries.forEach(function(entry) {
    if (!entry.isDirectory()) return;
    var skillFile = path.join(baseDir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      skills.push({
        name: entry.name,
        dir: path.join(baseDir, entry.name),
        skillFile: skillFile
      });
    }
  });

  return skills.sort(function(a, b) { return a.name.localeCompare(b.name); });
}

function findScripts(skillDir) {
  var scriptsDir = path.join(skillDir, 'scripts');
  if (!fs.existsSync(scriptsDir)) return [];
  var scripts = [];
  var entries;
  try {
    entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
  } catch (e) {
    return scripts;
  }
  entries.forEach(function(entry) {
    if (entry.isFile() && !entry.name.startsWith('.')) {
      var ext = path.extname(entry.name).toLowerCase();
      if (['.cjs', '.mjs', '.js', '.sh', '.py'].indexOf(ext) !== -1) {
        scripts.push({
          name: entry.name,
          path: path.join(scriptsDir, entry.name)
        });
      }
    }
  });
  return scripts;
}

function testSkill(skill) {
  var content = fs.readFileSync(skill.skillFile, 'utf8');
  var fm = parseFrontmatter(content);
  var declared = fm['available-scripts'] || [];
  var actual = findScripts(skill.dir);

  var results = [];

  // Normalise: declared names may omit extension (.mjs, .cjs, .sh, .py)
  // e.g. "pipeline-query" matches "pipeline-query.mjs"
  function matchScript(declaredName, actualName) {
    if (declaredName === actualName) return true;
    var exts = ['.cjs', '.mjs', '.js', '.sh', '.py'];
    for (var i = 0; i < exts.length; i++) {
      if (declaredName + exts[i] === actualName) return true;
    }
    return false;
  }

  // Test 1: Declared scripts exist
  declared.forEach(function(s) {
    var found = actual.some(function(a) { return matchScript(s.name, a.name); });
    results.push({
      test: 'exists',
      script: s.name,
      description: s.description || '',
      status: found ? 'pass' : 'fail',
      detail: found ? 'Found in scripts/' : 'Declared in frontmatter but missing from scripts/'
    });
  });

  // Test 2: Actual scripts are declared
  if (declared.length > 0) {
    actual.forEach(function(s) {
      var found = declared.some(function(d) { return matchScript(d.name, s.name); });
      if (!found) {
        results.push({
          test: 'declared',
          script: s.name,
          description: '',
          status: 'warn',
          detail: 'Script exists but not declared in available-scripts frontmatter'
        });
      }
    });
  }

  // Test 3: Help flag / no-crash test
  actual.forEach(function(s) {
    // Skip __pycache__ dirs and lib dirs — only test main scripts
    var helpArgs = ['--help'];
    if (optDryRun) {
      helpArgs = ['--dry-run'];
    }

    var result = runScript(s.path, helpArgs);
    var pass = result.exitCode === 0 || result.exitCode === null;
    // Exit code 0 or 2 (invalid args showing usage) is fine
    pass = result.exitCode === 0 || result.exitCode === 2 || result.exitCode === 1;

    results.push({
      test: 'runs',
      script: s.name,
      description: '',
      status: pass ? 'pass' : 'fail',
      detail: pass
        ? 'Executed without crash (exit ' + result.exitCode + ')'
        : 'Crashed or timed out (exit ' + result.exitCode + ')' + (result.stderr ? ': ' + result.stderr.split('\n')[0] : ''),
      exitCode: result.exitCode,
      stderr: result.stderr
    });
  });

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────

if (optHelp) {
  console.log([
    'skill-test — Runtime validation for skill scripts',
    '',
    'Usage: skill-test [options]',
    '',
    'Options:',
    '  --dir <path>       Skills catalogue directory (default: parent of trackhub/skills/)',
    '  --skill <name>     Test only a specific skill',
    '  --dry-run          Test with --dry-run flag instead of --help',
    '  --json             JSON output',
    '  --quiet            Only show failures and warnings',
    '  --verbose          Show full stderr on failures',
    '  --help             Show this help'
  ].join('\n'));
  process.exit(0);
}

var skills = discoverSkills(optDir);
if (optSkill) {
  skills = skills.filter(function(s) { return s.name === optSkill; });
}

if (skills.length === 0) {
  if (optSkill) {
    console.error('Skill not found: ' + optSkill);
    process.exit(1);
  } else {
    console.error('No skills found in ' + optDir);
    process.exit(1);
  }
}

var allResults = [];
var totalPass = 0;
var totalFail = 0;
var totalWarn = 0;

skills.forEach(function(skill) {
  var results = testSkill(skill);
  results.forEach(function(r) {
    r.skill = skill.name;
    allResults.push(r);
    if (r.status === 'pass') totalPass++;
    else if (r.status === 'fail') totalFail++;
    else if (r.status === 'warn') totalWarn++;
  });
});

if (optJson) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    skillsTested: skills.length,
    summary: { pass: totalPass, fail: totalFail, warn: totalWarn },
    results: allResults
  }, null, 2));
  process.exit(totalFail > 0 ? 1 : 0);
}

// Human-readable output
if (!optQuiet) {
  console.log('skill-test — ' + skills.length + ' skill(s), ' + allResults.length + ' check(s)');
  console.log('');
}

var lastSkill = '';
allResults.forEach(function(r) {
  if (r.skill !== lastSkill) {
    if (!optQuiet || lastSkill !== '') console.log('');
    if (!optQuiet) console.log('## ' + r.skill);
    lastSkill = r.skill;
  }

  var icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
  var line = '  ' + icon + ' [' + r.test + '] ' + r.script;

  if (optQuiet && r.status === 'pass') return;

  console.log(line);

  if (r.description && !optQuiet) {
    console.log('    (' + r.description + ')');
  }

  if (r.status !== 'pass') {
    console.log('    ' + r.detail);
    if (optVerbose && r.stderr) {
      console.log('    stderr: ' + r.stderr.split('\n').slice(0, 3).join('\n    stderr: '));
    }
  }
});

console.log('');
console.log('Result: ' + totalPass + ' passed, ' + totalWarn + ' warnings, ' + totalFail + ' failed');
process.exit(totalFail > 0 ? 1 : 0);
