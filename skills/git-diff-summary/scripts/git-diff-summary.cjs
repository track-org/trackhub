#!/usr/bin/env node
/**
 * git-diff-summary - Generate a categorized summary of git changes.
 *
 * Usage:
 *   node git-diff-summary.cjs [--staged] [--last] [--ref RANGE] [--names-only] [--json]
 *
 * Memory-safe: uses --shortstat for totals and --name-status for categorization.
 * Avoids buffering full patches. Designed for constrained environments (Raspberry Pi).
 */

const { execSync } = require('child_process');

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const last = args.includes('--last');
const namesOnly = args.includes('--names-only');
const jsonOutput = args.includes('--json');
const refIdx = args.indexOf('--ref');
const customRef = refIdx !== -1 && args[refIdx + 1] ? args[refIdx + 1] : null;

function run(cmd, maxBuffer) {
  maxBuffer = maxBuffer || 1048576;
  try { return execSync(cmd, { encoding: 'utf-8', maxBuffer: maxBuffer }).trim(); }
  catch (e) { return ''; }
}

function getDiffRefs() {
  if (customRef) {
    if (customRef.indexOf('..') !== -1) return customRef;
    return customRef + '^ ' + customRef;
  }
  if (last) return 'HEAD~1 HEAD';
  return null;
}

function parseShortStat(output) {
  var m;
  m = output.match(/(\d+) insertion/);
  var added = m ? parseInt(m[1]) : 0;
  m = output.match(/(\d+) deletion/);
  var removed = m ? parseInt(m[1]) : 0;
  m = output.match(/(\d+) file/);
  var files = m ? parseInt(m[1]) : 0;
  return { added: added, removed: removed, files: files };
}

function parseNameStatus(output) {
  var entries = [];
  var lines = output.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.trim()) continue;
    var rm = line.match(/^[RC](\d*)\t(.+)\t(.+)$/);
    if (rm) {
      entries.push({ type: 'renamed', score: parseInt(rm[1]) || 100, from: rm[2], to: rm[3] });
      continue;
    }
    var parts = line.split('\t');
    if (parts.length < 2) continue;
    var status = parts[0].charAt(0);
    var file = parts.slice(1).join('\t');
    if (status === 'A') entries.push({ type: 'added', file: file });
    else if (status === 'M') entries.push({ type: 'modified', file: file });
    else if (status === 'D') entries.push({ type: 'deleted', file: file });
    else entries.push({ type: 'modified', file: file });
  }
  return entries;
}

function getPerFileStat(file, diffArgs) {
  var output = run('git diff --shortstat ' + diffArgs + ' -- "' + file + '"');
  if (!output) return { added: 0, removed: 0 };
  var am = output.match(/(\d+) insertion/);
  var dm = output.match(/(\d+) deletion/);
  return { added: am ? parseInt(am[1]) : 0, removed: dm ? parseInt(dm[1]) : 0 };
}

function getContentExcerpt(file, diffArgs, maxLines) {
  maxLines = maxLines || 6;
  var stat = getPerFileStat(file, diffArgs);
  if (stat.added + stat.removed > 80) return '(' + (stat.added + stat.removed) + ' lines changed)';
  var output = run('git diff ' + diffArgs + ' -- "' + file + '"', 131072);
  if (!output || output.length > 80000) return '(too large)';
  var lines = output.split('\n');
  var changed = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if ((l.charAt(0) === '+' || l.charAt(0) === '-') && l.indexOf('+++') !== 0 && l.indexOf('---') !== 0) {
      if (l.length > 100) l = l.substring(0, 97) + '...';
      changed.push(l);
    }
  }
  if (changed.length === 0) return '';
  var excerpt = changed.slice(0, maxLines).join('\n');
  if (changed.length > maxLines) excerpt += '\n  ... +' + (changed.length - maxLines) + ' more';
  return excerpt;
}

function getUntracked() {
  var output = run('git ls-files --others --exclude-standard');
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

// Main
var refs = getDiffRefs();
var diffArgs = refs ? refs : (staged ? '--cached' : '');

var shortStat = parseShortStat(run('git diff --shortstat ' + diffArgs));
var nameStatusOutput = run('git diff --name-status ' + diffArgs);
var entries = parseNameStatus(nameStatusOutput);
var untracked = (!refs && !staged) ? getUntracked() : [];

var result = { added: [], modified: [], deleted: [], renamed: [], untracked: [] };

for (var i = 0; i < entries.length; i++) {
  var entry = entries[i];
  if (entry.type === 'added' || entry.type === 'modified') {
    var stats = getPerFileStat(entry.file, diffArgs);
    var obj = { file: entry.file, added: stats.added, removed: stats.removed };
    if (!namesOnly) obj.excerpt = getContentExcerpt(entry.file, diffArgs);
    result[entry.type].push(obj);
  } else if (entry.type === 'deleted') {
    result.deleted.push({ file: entry.file });
  } else if (entry.type === 'renamed') {
    result.renamed.push({ from: entry.from, to: entry.to, score: entry.score });
  }
}

for (var i = 0; i < untracked.length; i++) {
  result.untracked.push({ file: untracked[i] });
}

function formatResult(r, stat) {
  var totalFiles = r.added.length + r.modified.length + r.deleted.length + r.renamed.length + r.untracked.length;
  if (totalFiles === 0) return 'No changes detected.';

  var lines = [];
  lines.push(stat.files + ' file(s) changed  +' + stat.added + ' -' + stat.removed);
  lines.push('');

  var cats = [
    ['added', r.added, '+'],
    ['modified', r.modified, '~'],
    ['deleted', r.deleted, '-'],
    ['renamed', r.renamed, '>'],
    ['untracked', r.untracked, '?']
  ];

  for (var c = 0; c < cats.length; c++) {
    var cat = cats[c][0];
    var items = cats[c][1];
    if (items.length === 0) continue;
    lines.push(cat.toUpperCase() + ' (' + items.length + ')');
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (cat === 'renamed') {
        lines.push('  ' + item.from + ' -> ' + item.to);
      } else if (item.added !== undefined) {
        lines.push('  ' + item.file + '  (+' + item.added + ' -' + item.removed + ')');
        if (item.excerpt) {
          var excerptLines = item.excerpt.split('\n');
          for (var j = 0; j < excerptLines.length; j++) {
            lines.push('    ' + excerptLines[j]);
          }
        }
      } else {
        lines.push('  ' + item.file);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatResult(result, shortStat));
}
