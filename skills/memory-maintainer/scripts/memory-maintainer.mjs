#!/usr/bin/env node
/**
 * memory-maintainer — Analyse daily notes and suggest MEMORY.md updates.
 *
 * Scans a directory of daily markdown files (memory/YYYY-MM-DD.md),
 * extracts significant entries, and outputs a suggested diff or updated
 * MEMORY.md content.
 *
 * Usage:
 *   node memory-maintainer.mjs [options]
 *
 * Options:
 *   --memory-dir <path>     Path to memory/ directory (default: ./memory)
 *   --memory-file <path>    Path to MEMORY.md (default: ./MEMORY.md)
 *   --since <date>          Only scan daily files from this date (YYYY-MM-DD)
 *   --days <n>              Scan last N days of daily files (default: 7)
 *   --dry-run               Show suggestions without writing
 *   --json                  Output as JSON
 *   --quiet                 Only output errors
 *   --merge                 Auto-merge suggestions into MEMORY.md
 *   --max-age <days>        Remove entries older than N days from MEMORY.md (default: 90)
 *   -h, --help              Show this help
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help' },
  boolean: ['help', 'dry-run', 'json', 'quiet', 'merge'],
  string: ['memory-dir', 'memory-file', 'since', 'days', 'max-age'],
  default: {
    'dry-run': false,
    json: false,
    quiet: false,
    merge: false,
    'memory-dir': './memory',
    'memory-file': './MEMORY.md',
    days: '7',
    'max-age': '90',
  },
});

if (args.help) {
  showHelp('memory-maintainer', 'Analyse daily notes and suggest MEMORY.md updates.', {
    '--memory-dir <path>': 'Path to memory/ directory (default: ./memory)',
    '--memory-file <path>': 'Path to MEMORY.md (default: ./MEMORY.md)',
    '--since <date>': 'Only scan daily files from this date (YYYY-MM-DD)',
    '--days <n>': 'Scan last N days of daily files (default: 7)',
    '--dry-run': 'Show suggestions without writing',
    '--json': 'Output as JSON',
    '--quiet': 'Only output errors',
    '--merge': 'Auto-merge suggestions into MEMORY.md',
    '--max-age <days>': 'Prune entries older than N days (default: 90)',
  });
}

const memoryDir = args['memory-dir'];
const memoryFile = args['memory-file'];
const maxAge = parseInt(args['max-age'], 10);
const daysToScan = parseInt(args.days, 10);
const sinceDate = args.since ? new Date(args.since) : null;

// --- Helpers ---

/**
 * Parse date from a daily note filename (YYYY-MM-DD.md).
 * Returns null if the filename doesn't match.
 */
function parseDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const d = new Date(match[1] + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Check if a date is within the scanning window.
 */
function isInWindow(date) {
  if (sinceDate) return date >= sinceDate;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToScan);
  return date >= cutoff;
}

/**
 * Extract sections from a markdown file.
 * Returns an array of { heading, content, level }.
 */
function extractSections(text) {
  const sections = [];
  const lines = text.split('\n');
  let current = { heading: '_top', content: [], level: 0 };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      if (current.content.length > 0 || current.heading !== '_top') {
        sections.push({ ...current, content: current.content.join('\n').trim() });
      }
      current = { heading: headingMatch[2].trim(), content: [], level: headingMatch[1].length };
    } else {
      current.content.push(line);
    }
  }
  if (current.content.length > 0 || current.heading !== '_top') {
    sections.push({ ...current, content: current.content.join('\n').trim() });
  }
  return sections;
}

/**
 * Score a section for "memory worthiness".
 * Higher = more likely to be a significant long-term memory.
 * 
 * Signals that boost score:
 * - Contains decisions ("decided", "agreed", "chose")
 * - Contains lessons ("learned", "lesson", "mistake", "fixed")
 * - Contains preferences ("prefers", "likes", "dislikes")
 * - Contains relationships/people names
 * - Contains project/completion markers
 * - Longer content (substance)
 * - Not a checklist or routine log
 */
function scoreSection(section) {
  const text = section.content.toLowerCase();
  const heading = section.heading.toLowerCase();
  const combined = heading + ' ' + text;
  let score = 0;

  // Decision signals
  const decisionWords = ['decided', 'agreed', 'chose', 'confirmed', 'settled on', 'went with'];
  for (const w of decisionWords) {
    if (combined.includes(w)) score += 3;
  }

  // Lesson/error signals
  const lessonWords = ['learned', 'lesson', 'mistake', 'bug', 'fixed', 'broke', 'wrong', 'don\'t', 'avoid'];
  for (const w of lessonWords) {
    if (combined.includes(w)) score += 2;
  }

  // Preference signals
  const prefWords = ['prefers', 'prefers to', 'likes', 'dislikes', 'hates', 'loves', 'enjoys'];
  for (const w of prefWords) {
    if (combined.includes(w)) score += 2;
  }

  // Project/completion signals
  const projWords = ['shipped', 'released', 'deployed', 'completed', 'finished', 'launched', 'built'];
  for (const w of projWords) {
    if (combined.includes(w)) score += 2;
  }

  // Relationship/context signals
  const relWords = ['introduced', 'met with', 'partner', 'team', 'manager', 'client', 'colleague'];
  for (const w of relWords) {
    if (combined.includes(w)) score += 1;
  }

  // Configuration/tool signals
  const configWords = ['configured', 'set up', 'installed', 'migrated', 'upgraded', 'changed'];
  for (const w of configWords) {
    if (combined.includes(w)) score += 1;
  }

  // Content length bonus (substance)
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > 20) score += 1;
  if (wordCount > 50) score += 1;

  // Penalty for routine/checklist content
  const routineWords = ['completion checklist', 'todo', 'daily standup', 'routine'];
  for (const w of routineWords) {
    if (heading.includes(w)) score -= 2;
  }

  // Penalty for already-in-MEMORY markers
  if (combined.includes('already in memory') || combined.includes('no action needed')) {
    score -= 3;
  }

  return Math.max(0, score);
}

/**
 * Parse existing MEMORY.md entries to avoid duplicates.
 * Returns a set of normalized content fingerprints.
 */
function parseExistingEntries(memoryText) {
  const entries = new Set();
  const lines = memoryText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet entries: "- 2026-XX-XX: ..."
    if (trimmed.startsWith('- ')) {
      // Normalize: lowercase, strip date prefix for comparison
      const content = trimmed.replace(/^-\s*\d{4}-\d{2}-\d{2}:\s*/i, '').toLowerCase().trim();
      if (content.length > 10) {
        entries.add(content);
      }
    }
  }
  return entries;
}

/**
 * Check if a suggested entry is likely a duplicate of an existing one.
 */
function isDuplicate(suggestion, existingEntries) {
  const normalized = suggestion.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  
  // Exact match on normalized content
  if (existingEntries.has(normalized)) return true;
  
  // Fuzzy: check if >70% of words overlap with any existing entry
  const words = new Set(normalized.split(/\s+/).filter(w => w.length > 3));
  if (words.size < 3) return false;
  
  for (const existing of existingEntries) {
    const existingNorm = existing.replace(/[^a-z0-9\s]/g, '').trim();
    const existingWords = new Set(existingNorm.split(/\s+/).filter(w => w.length > 3));
    let overlap = 0;
    for (const w of words) {
      if (existingWords.has(w)) overlap++;
    }
    if (overlap / words.size > 0.7) return true;
  }
  
  return false;
}

/**
 * Generate a concise one-line memory entry from a section.
 */
function generateEntry(date, section) {
  const heading = section.heading.replace(/^#+\s*/, '').trim();
  const sentences = section.content.split(/[.\n]/).filter(s => s.trim().length > 15);
  
  // Try to use the first substantive sentence
  let summary = '';
  for (const s of sentences) {
    let trimmed = s.trim();
    // Skip checklist items and routine lines
    if (trimmed.startsWith('- [x]') || trimmed.startsWith('- [ ]')) continue;
    // Strip leading markdown bullets
    trimmed = trimmed.replace(/^[-*]\s+/, '');
    if (trimmed.length > 20 && trimmed.length < 200) {
      summary = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      break;
    }
  }
  
  if (!summary && sentences.length > 0) {
    summary = sentences[0].trim();
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  }
  
  // Truncate if too long
  if (summary.length > 180) {
    summary = summary.slice(0, 177) + '...';
  }
  
  if (!summary) return null;
  
  return `- ${date}: ${summary}`;
}

/**
 * Parse MEMORY.md and find entries older than maxAge days.
 */
function findStaleEntries(memoryText, maxAgeDays) {
  const lines = memoryText.split('\n');
  const stale = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^-\s*(\d{4}-\d{2}-\d{2}):\s*/);
    if (match) {
      const entryDate = new Date(match[1] + 'T00:00:00');
      if (!isNaN(entryDate.getTime()) && entryDate < cutoff) {
        stale.push({ line: i, date: match[1], content: lines[i].trim() });
      }
    }
  }
  
  return stale;
}

// --- Main ---

function main() {
  if (!existsSync(memoryDir)) {
    if (!args.quiet) fmt.warn(`Memory directory not found: ${memoryDir}`);
    if (args.json) fmt.json({ error: 'memory_dir_not_found', path: memoryDir });
    process.exit(0);
  }

  // Read existing MEMORY.md if it exists
  let memoryText = '';
  if (existsSync(memoryFile)) {
    memoryText = readFileSync(memoryFile, 'utf-8');
  }
  const existingEntries = parseExistingEntries(memoryText);

  // Scan daily files
  let files;
  try {
    files = readdirSync(memoryDir).filter(f => f.endsWith('.md'));
  } catch {
    if (!args.quiet) fmt.error(`Cannot read directory: ${memoryDir}`);
    process.exit(1);
  }

  // Filter by date window
  const relevantFiles = [];
  for (const f of files) {
    const date = parseDateFromFilename(f);
    if (!date) continue;
    if (isInWindow(date)) {
      relevantFiles.push({ filename: f, date, dateStr: f.replace('.md', '') });
    }
  }

  // Sort newest first
  relevantFiles.sort((a, b) => b.date - a.date);

  if (relevantFiles.length === 0) {
    if (!args.quiet) fmt.info('No daily notes found in the scanning window.');
    if (args.json) fmt.json({ suggestions: [], stale: [], scanned: 0 });
    process.exit(0);
  }

  // Extract and score sections
  const suggestions = [];
  for (const { filename, dateStr } of relevantFiles) {
    const filepath = join(memoryDir, filename);
    const text = readFileSync(filepath, 'utf-8');
    const sections = extractSections(text);

    for (const section of sections) {
      if (section.content.length < 20) continue;
      
      const score = scoreSection(section);
      if (score < 3) continue; // Threshold: only significant items
      
      const entry = generateEntry(dateStr, section);
      if (!entry) continue;
      if (isDuplicate(entry, existingEntries)) continue;
      
      suggestions.push({
        date: dateStr,
        source: filename,
        heading: section.heading,
        score,
        entry,
      });
    }
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  // Find stale entries in MEMORY.md
  const stale = findStaleEntries(memoryText, maxAge);

  // Output
  if (args.json) {
    fmt.json({
      scanned: relevantFiles.length,
      suggestions: suggestions.map(s => ({
        date: s.date,
        source: s.source,
        heading: s.heading,
        score: s.score,
        entry: s.entry,
      })),
      stale: stale.map(s => ({
        date: s.date,
        line: s.line,
        content: s.content,
      })),
    });
    process.exit(0);
  }

  if (args.quiet) process.exit(0);

  // Human-readable output
  fmt.section('Memory Maintenance Report');
  fmt.info(`Scanned ${relevantFiles.length} daily note(s)`);

  if (suggestions.length > 0) {
    fmt.section(`Suggested Additions (${suggestions.length})`);
    for (const s of suggestions) {
      fmt.bullet(`[${s.score}pts] ${s.entry}  (from ${s.source}: ${s.heading})`);
    }
  } else {
    fmt.ok('No new memory suggestions — MEMORY.md is up to date.');
  }

  if (stale.length > 0) {
    fmt.section(`Stale Entries (${stale.length}, older than ${maxAge} days)`);
    for (const s of stale.slice(0, 20)) {
      fmt.bullet(`${s.content}`);
    }
    if (stale.length > 20) {
      fmt.bullet(`... and ${stale.length - 20} more`);
    }
  } else {
    fmt.ok('No stale entries found.');
  }

  // Auto-merge
  if (args.merge && suggestions.length > 0) {
    if (args['dry-run']) {
      fmt.section('Dry Run — would merge:');
      for (const s of suggestions) {
        console.log(s.entry);
      }
    } else {
      const newEntries = suggestions.map(s => s.entry).join('\n');
      const separator = memoryText.trim() ? '\n' : '';
      const updatedMemory = memoryText.trimEnd() + separator + '\n' + newEntries + '\n';
      writeFileSync(memoryFile, updatedMemory, 'utf-8');
      fmt.ok(`Merged ${suggestions.length} entries into ${memoryFile}`);
    }
  }

  // Prune stale entries
  if (args.merge && stale.length > 0 && !args['dry-run']) {
    const lines = memoryText.split('\n');
    const staleLines = new Set(stale.map(s => s.line));
    const pruned = lines.filter((_, i) => !staleLines.has(i));
    writeFileSync(memoryFile, pruned.join('\n'), 'utf-8');
    fmt.ok(`Pruned ${stale.length} stale entries from ${memoryFile}`);
  }
}

main();
