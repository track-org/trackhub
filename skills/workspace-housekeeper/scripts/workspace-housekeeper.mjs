#!/usr/bin/env node

'use strict';

// Workspace Housekeeper — lightweight workspace & system cleanup reporter
// Zero external dependencies. Node.js 18+.

import { readdir, stat, readFile, unlink, rm, access } from 'node:fs/promises';
import { join, resolve, dirname, parse, format } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    clean: false,
    check: true,
    json: false,
    quiet: false,
    threshold: 80,
    workspace: resolve(join(homedir(), '.openclaw/workspace')),
    openclawRoot: resolve(join(homedir(), '.openclaw')),
    categories: null,
    maxAge: null,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--clean') { args.clean = true; args.check = false; }
    else if (a === '--check' || a === '--dry-run') { args.check = true; args.clean = false; }
    else if (a === '--json') args.json = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--threshold' && argv[i + 1]) args.threshold = parseInt(argv[++i], 10);
    else if (a === '--categories' && argv[i + 1]) args.categories = argv[++i].split(',').map(s => s.trim());
    else if (a === '--max-age' && argv[i + 1]) args.maxAge = parseInt(argv[++i], 10);
    else if (a === '--workspace' && argv[i + 1]) args.workspace = resolve(argv[++i]);
    else if (a === '--openclaw-root' && argv[i + 1]) args.openclawRoot = resolve(argv[++i]);
  }

  return args;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bytesHuman(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function daysBetween(date, now = Date.now()) {
  return (now - date.getTime()) / 86400000;
}

function ageLabel(days) {
  if (days < 1) return 'today';
  if (days < 2) return '1 day ago';
  return `${Math.floor(days)} days ago`;
}

async function dirSize(dirPath, maxDepth = 3) {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules' && maxDepth < 3) continue;
      const full = join(dirPath, e.name);
      if (e.isDirectory() && maxDepth > 0) {
        total += await dirSize(full, maxDepth - 1);
      } else if (e.isFile()) {
        try { total += (await stat(full)).size; } catch { /* skip */ }
      }
    }
  } catch { /* dir doesn't exist or not readable */ }
  return total;
}

async function walkFiles(dir, opts = {}) {
  const { maxAgeDays, extension, minDepth = 0, maxDepth = 5 } = opts;
  const results = [];
  const now = Date.now();

  async function walk(d, depth) {
    try {
      const entries = await readdir(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') && depth === 0) continue;
        const full = join(d, e.name);
        if (e.isDirectory() && depth < maxDepth) {
          await walk(full, depth + 1);
        } else if (e.isFile()) {
          if (depth < minDepth) continue;
          try {
            const s = await stat(full);
            const age = daysBetween(s.mtime, now);
            if (maxAgeDays !== undefined && age < maxAgeDays) continue;
            if (extension && !e.name.endsWith(extension)) continue;
            results.push({ path: full, size: s.size, mtime: s.mtime, age });
          } catch { /* skip */ }
        }
      }
    } catch { /* not readable */ }
  }

  await walk(dir, 0);
  return results;
}

async function safeStat(p) {
  try { return await stat(p); } catch { return null; }
}

// ─── Checkers ────────────────────────────────────────────────────────────────

async function checkDisk(args) {
  const results = [];

  // Use df output
  try {
    const { execSync } = await import('node:child_process');
    const dfOutput = execSync('df -B1 --output=target,size,used,pcent 2>/dev/null || df -k', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    const lines = dfOutput.trim().split('\n');
    const entries = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts.length < 4) continue;

      const target = parts[0];
      if (target === 'Mounted' || target === 'Filesystem') continue;

      // Try to parse percentage from the line
      const pctMatch = lines[i].match(/(\d+)%/);
      const pctStr = pctMatch ? pctMatch[1] : null;

      const sizeStr = parts[1];
      const usedStr = parts[2];

      // We use df -B1, so values are always in bytes
      var totalBytes = parseInt(sizeStr, 10);
      var usedBytes = parseInt(usedStr, 10);

      if (isNaN(totalBytes) || isNaN(usedBytes) || totalBytes === 0) continue;

      const pct = pctStr ? parseInt(pctStr, 10) : Math.round((usedBytes / totalBytes) * 100);
      const freeBytes = totalBytes - usedBytes;

      entries.push({
        path: target,
        totalBytes,
        usedBytes,
        freeBytes,
        pct,
      });
    }

    // Filter to interesting filesystems
    const interesting = entries.filter(e =>
      e.path === '/' || e.path.startsWith('/boot') || e.path.startsWith('/home') ||
      e.path.includes('rootfs') || e.path === '/data'
    );

    for (const entry of interesting) {
      const warning = entry.pct >= args.threshold;
      results.push({
        path: entry.path,
        pct: entry.pct,
        usedBytes: entry.usedBytes,
        totalBytes: entry.totalBytes,
        freeBytes: entry.freeBytes,
        warning,
        message: warning
          ? `${entry.pct}% used (${bytesHuman(entry.usedBytes)} / ${bytesHuman(entry.totalBytes)}) — WARNING above ${args.threshold}%`
          : `${entry.pct}% used (${bytesHuman(entry.usedBytes)} / ${bytesHuman(entry.totalBytes)}) — OK`,
      });
    }

    // If no interesting FS found, use the root entry
    if (interesting.length === 0 && entries.length > 0) {
      const root = entries.find(e => e.path === '/') || entries[0];
      const warning = root.pct >= args.threshold;
      results.push({
        path: root.path,
        pct: root.pct,
        usedBytes: root.usedBytes,
        totalBytes: root.totalBytes,
        freeBytes: root.freeBytes,
        warning,
        message: warning
          ? `${root.pct}% used (${bytesHuman(root.usedBytes)} / ${bytesHuman(root.totalBytes)}) — WARNING above ${args.threshold}%`
          : `${root.pct}% used (${bytesHuman(root.usedBytes)} / ${bytesHuman(root.totalBytes)}) — OK`,
      });
    }
  } catch {
    results.push({ path: '/', status: 'error', message: 'Could not read disk usage' });
  }

  return results;
}

async function checkCronLogs(args) {
  const cronDir = join(args.openclawRoot, 'cron');
  const maxAge = args.maxAge ?? 30;
  const results = [];

  const files = await walkFiles(cronDir, { maxAgeDays: maxAge, extension: '.jsonl' });

  let totalSize = 0;
  let toClean = [];

  for (const f of files) {
    totalSize += f.size;
    if (args.clean && f.age >= maxAge) {
      toClean.push(f);
    }
  }

  // Remove files
  let cleanedCount = 0;
  let cleanedSize = 0;
  for (const f of toClean) {
    try {
      await unlink(f.path);
      cleanedCount++;
      cleanedSize += f.size;
    } catch (err) {
      results.push({ path: f.path, status: 'error', message: `Failed to remove: ${err.message}` });
    }
  }

  results.push({
    category: 'cron-logs',
    totalFiles: files.length,
    totalSize,
    toCleanCount: toClean.length + cleanedCount,
    toCleanSize: (toClean.reduce((s, f) => s + f.size, 0)),
    cleanedCount,
    cleanedSize,
    message: args.clean
      ? `Cleaned ${cleanedCount} files (${bytesHuman(cleanedSize)})`
      : `${files.length} files, ${bytesHuman(totalSize)} (${toClean.length} older than ${maxAge} days to clean)`,
  });

  return results;
}

async function checkTempFiles(args) {
  const maxAge = args.maxAge ?? 7;
  const dirs = [tmpdir(), join(homedir(), 'tmp')];
  const allFiles = [];
  const results = [];

  for (const dir of dirs) {
    const files = await walkFiles(dir, { maxAgeDays: maxAge, maxDepth: 3 });
    allFiles.push(...files);
  }

  let totalSize = allFiles.reduce((s, f) => s + f.size, 0);
  let toClean = allFiles;

  let cleanedCount = 0;
  let cleanedSize = 0;
  if (args.clean) {
    for (const f of toClean) {
      try {
        await unlink(f.path);
        cleanedCount++;
        cleanedSize += f.size;
      } catch (err) {
        results.push({ path: f.path, status: 'error', message: `Failed to remove: ${err.message}` });
      }
    }
  }

  results.push({
    category: 'temp-files',
    totalFiles: allFiles.length,
    totalSize,
    toCleanCount: toClean.length,
    toCleanSize: toClean.reduce((s, f) => s + f.size, 0),
    cleanedCount,
    cleanedSize,
    message: args.clean
      ? `Cleaned ${cleanedCount} files (${bytesHuman(cleanedSize)})`
      : `${allFiles.length} files, ${bytesHuman(totalSize)} (${toClean.length} older than ${maxAge} days to clean)`,
  });

  return results;
}

async function checkNodeModules(args) {
  const LARGE_THRESHOLD = 500 * 1024 * 1024; // 500 MB
  const dirs = [
    args.workspace,
    join(homedir(), '.openclaw'),
    join(homedir(), 'projects'),
    join(homedir(), 'repos'),
  ];
  const results = [];
  let totalDirs = 0;
  let totalSize = 0;
  let warnings = 0;

  for (const dir of dirs) {
    const nmPath = join(dir, 'node_modules');
    const s = await safeStat(nmPath);
    if (s && s.isDirectory()) {
      const size = await dirSize(nmPath, 2);
      totalDirs++;
      totalSize += size;
      if (size > LARGE_THRESHOLD) {
        warnings++;
        results.push({
          path: nmPath,
          size,
          warning: true,
          message: `${bytesHuman(size)} — large (>${bytesHuman(LARGE_THRESHOLD)})`,
        });
      }
    }
  }

  results.unshift({
    category: 'node-modules',
    totalDirs,
    totalSize,
    warnings,
    message: warnings > 0
      ? `${totalDirs} dirs, ${bytesHuman(totalSize)} total — ${warnings} large`
      : `${totalDirs} dirs, ${bytesHuman(totalSize)} total — OK`,
  });

  return results;
}

async function checkMemoryFiles(args) {
  const memDir = join(args.workspace, 'memory');
  const SIZE_WARNING = 50 * 1024; // 50 KB
  const results = [];

  const files = await walkFiles(memDir, { extension: '.md', maxDepth: 1 });
  let totalSize = 0;
  let warnings = 0;

  for (const f of files) {
    totalSize += f.size;
    if (f.size > SIZE_WARNING) {
      warnings++;
      results.push({
        path: f.path,
        size: f.size,
        warning: true,
        message: `${bytesHuman(f.size)} — large (>${bytesHuman(SIZE_WARNING)})`,
      });
    }
  }

  results.unshift({
    category: 'memory-files',
    totalFiles: files.length,
    totalSize,
    warnings,
    message: warnings > 0
      ? `${files.length} files, ${bytesHuman(totalSize)} — ${warnings} large`
      : `${files.length} files, ${bytesHuman(totalSize)} — OK`,
  });

  return results;
}

async function checkOldLogs(args) {
  const maxAge = args.maxAge ?? 14;
  const dirs = [args.workspace, args.openclawRoot, homedir()];
  const allFiles = [];
  const results = [];

  for (const dir of dirs) {
    const files = await walkFiles(dir, { maxAgeDays: maxAge, extension: '.log', maxDepth: 3 });
    allFiles.push(...files);
  }

  let totalSize = allFiles.reduce((s, f) => s + f.size, 0);

  let cleanedCount = 0;
  let cleanedSize = 0;
  if (args.clean) {
    for (const f of allFiles) {
      try {
        await unlink(f.path);
        cleanedCount++;
        cleanedSize += f.size;
      } catch (err) {
        results.push({ path: f.path, status: 'error', message: `Failed to remove: ${err.message}` });
      }
    }
  }

  results.push({
    category: 'old-logs',
    totalFiles: allFiles.length,
    totalSize,
    cleanedCount,
    cleanedSize,
    message: args.clean
      ? `Cleaned ${cleanedCount} files (${bytesHuman(cleanedSize)})`
      : `${allFiles.length} files, ${bytesHuman(totalSize)} (${allFiles.length} older than ${maxAge} days)`,
  });

  return results;
}

async function checkTrash(args) {
  const maxAge = args.maxAge ?? 30;
  const trashDirs = [
    join(homedir(), '.local/share/Trash/files'),
    join(homedir(), '.trash'),
  ];
  const allFiles = [];
  const results = [];

  for (const dir of trashDirs) {
    if (!existsSync(dir)) continue;
    const files = await walkFiles(dir, { maxAgeDays: maxAge, maxDepth: 3 });
    allFiles.push(...files);
  }

  let totalSize = allFiles.reduce((s, f) => s + f.size, 0);

  let cleanedCount = 0;
  let cleanedSize = 0;
  if (args.clean) {
    for (const f of allFiles) {
      try {
        await unlink(f.path);
        cleanedCount++;
        cleanedSize += f.size;
      } catch (err) {
        results.push({ path: f.path, status: 'error', message: `Failed to remove: ${err.message}` });
      }
    }
  }

  results.push({
    category: 'trash',
    totalFiles: allFiles.length,
    totalSize,
    cleanedCount,
    cleanedSize,
    message: args.clean
      ? `Cleaned ${cleanedCount} items (${bytesHuman(cleanedSize)})`
      : `${allFiles.length} items, ${bytesHuman(totalSize)} (${allFiles.length} older than ${maxAge} days to clean)`,
  });

  return results;
}

async function checkDocker(args) {
  const results = [];

  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('docker system df --format "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}" 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10000,
    });

    if (output.trim()) {
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          results.push({
            type: parts[0],
            size: parts[1],
            reclaimable: parts[2] || '—',
          });
        }
      }
    }

    results.unshift({
      category: 'docker',
      available: true,
      message: results.length > 1
        ? `Docker disk usage reported (${results.length - 1} categories)`
        : 'Docker available but no usage data',
    });
  } catch {
    results.push({
      category: 'docker',
      available: false,
      message: 'Docker not available or not running',
    });
  }

  return results;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatReport(categories, args) {
  const lines = [];
  const warnings = [];
  let totalToClean = 0;
  let totalToCleanSize = 0;

  lines.push('🏠 Workspace Housekeeper Report');
  lines.push('');

  for (const { key, label, icon, items } of categories) {
    const summary = items.find(i => i.message);
    const details = items.filter(i => i !== summary && !i.status?.startsWith('error'));

    if (summary) {
      const isWarning = summary.warning || summary.pct >= args.threshold;
      if (isWarning) warnings.push(`${icon} ${label}: ${summary.message}`);

      if (args.quiet && !isWarning) continue;

      lines.push(`${icon} ${label}: ${summary.message}`);

      for (const d of details) {
        if (d.warning || d.pct >= args.threshold) {
          lines.push(`   ⚠️ ${d.path || d.type || 'item'} — ${d.message}`);
        }
      }

      if (args.clean && summary.cleanedCount > 0) {
        lines.push(`   ✅ Cleaned: ${summary.cleanedCount} items (${bytesHuman(summary.cleanedSize)})`);
      } else if (!args.clean && summary.toCleanCount > 0) {
        lines.push(`   Would remove: ${summary.toCleanCount} items (${bytesHuman(summary.toCleanSize)})`);
      }
      lines.push('');
    }

    if (summary?.toCleanCount) {
      totalToClean += summary.toCleanCount;
      totalToCleanSize += summary.toCleanSize || 0;
    }
    if (summary?.cleanedCount) {
      totalToClean += summary.cleanedCount;
      totalToCleanSize += summary.cleanedSize || 0;
    }
  }

  // Error items
  for (const { items } of categories) {
    for (const item of items) {
      if (item.status === 'error' && item.message) {
        lines.push(`❌ Error: ${item.path || 'unknown'} — ${item.message}`);
      }
    }
  }

  if (totalToClean > 0 && !args.clean) {
    lines.push('---');
    lines.push(`Summary: ${totalToClean} items to clean (${bytesHuman(totalToCleanSize)}) | ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`);
    lines.push('Run with --clean to perform cleanup');
  } else if (args.clean) {
    lines.push('---');
    lines.push(`Cleanup complete. ${warnings.length} warning${warnings.length !== 1 ? 's' : ''} remaining.`);
  } else if (warnings.length > 0) {
    lines.push('---');
    lines.push(`${warnings.length} warning${warnings.length !== 1 ? 's' : ''}:`);
    for (const w of warnings) lines.push(`  ${w}`);
  } else {
    lines.push('✨ Everything looks tidy!');
  }

  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log(`Usage: workspace-housekeeper [options]

Options:
  --check              Show report without changes (default)
  --clean              Perform cleanup
  --categories <list>  Comma-separated categories to process (default: all)
  --threshold <pct>    Disk usage warning threshold (default: 80)
  --max-age <days>     Override max age for all categories
  --json               Output as JSON
  --quiet              Only show warnings and errors
  --workspace <path>   Workspace root (default: ~/.openclaw/workspace)
  --openclaw-root <path> OpenClaw root (default: ~/.openclaw)
  --help, -h           Show this help

Categories: disk, cron-logs, temp-files, node-modules, memory-files, old-logs, trash, docker`);
    process.exit(0);
  }

  const allCategories = [
    { key: 'disk', label: 'Disk Usage', icon: '💾', fn: checkDisk },
    { key: 'cron-logs', label: 'Cron Logs', icon: '📋', fn: checkCronLogs },
    { key: 'temp-files', label: 'Temp Files', icon: '📂', fn: checkTempFiles },
    { key: 'node-modules', label: 'Node Modules', icon: '📦', fn: checkNodeModules },
    { key: 'memory-files', label: 'Memory Files', icon: '📝', fn: checkMemoryFiles },
    { key: 'old-logs', label: 'Old Logs', icon: '📜', fn: checkOldLogs },
    { key: 'trash', label: 'Trash', icon: '🗑️', fn: checkTrash },
    { key: 'docker', label: 'Docker', icon: '🐳', fn: checkDocker },
  ];

  const categories = args.categories
    ? allCategories.filter(c => args.categories.includes(c.key))
    : allCategories;

  const results = [];
  for (const cat of categories) {
    try {
      const items = await cat.fn(args);
      results.push({ key: cat.key, label: cat.label, icon: cat.icon, items });
    } catch (err) {
      results.push({
        key: cat.key, label: cat.label, icon: cat.icon,
        items: [{ status: 'error', message: err.message }],
      });
    }
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatReport(results, args));
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
