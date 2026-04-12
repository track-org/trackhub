#!/usr/bin/env node
/**
 * Task Runner — execute a batch of shell commands with per-task timeouts,
 * sequential/parallel groups, and clean reporting.
 *
 * Designed for agents that need to maximise productivity within heartbeat
 * or cron windows by batching multiple checks into a single invocation.
 *
 * Usage:
 *   node task-runner.mjs --manifest tasks.json
 *   node task-runner.mjs --timeout 30 --task "echo hello"
 *   echo '[{"cmd":"ls"}]' | node task-runner.mjs --stdin
 */

import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';
import { spawn } from 'child_process';

const args = parseArgs(process.argv.slice(2), {
  alias: { m: 'manifest', t: 'timeout', T: 'task', h: 'help' },
  boolean: ['help', 'json', 'fail-fast', 'stdin', 'quiet'],
  string: ['manifest', 'timeout', 'task', 'parallel', 'name'],
  default: { timeout: '30', json: false, 'fail-fast': false, stdin: false, quiet: false },
});

if (args.help) {
  showHelp('task-runner', 'Batch shell command runner with timeouts and reporting.', {
    '--manifest, -m': 'Path to JSON manifest file',
    '--stdin': 'Read task manifest from stdin',
    '--task, -T': 'Single task command (quick mode)',
    '--name': 'Name for single task (with --task)',
    '--timeout, -t': 'Default timeout in seconds (default: 30)',
    '--parallel': 'Max parallel tasks (default: 1 = sequential)',
    '--fail-fast': 'Stop on first failure',
    '--json': 'Output results as JSON',
    '--quiet': 'No output, exit code only',
  });
}

// --- Manifest schema ---
// Array of:
// {
//   "name": "Human-readable name",
//   "cmd": "shell command",
//   "timeout": 10,           // optional, seconds
//   "group": "check",        // optional, tasks in same group run in parallel
//   "continueOnError": false // optional, default false
// }
// OR simple string: "echo hello"

function parseManifest(raw) {
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error('Manifest must be a JSON array of tasks');
  }

  return parsed.map((t, i) => {
    if (typeof t === 'string') {
      return { name: `task-${i + 1}`, cmd: t, timeout: null, group: null, continueOnError: false };
    }
    if (!t.cmd) throw new Error(`Task #${i + 1} missing "cmd" field`);
    return {
      name: t.name || `task-${i + 1}`,
      cmd: t.cmd,
      timeout: t.timeout || null,
      group: t.group || null,
      continueOnError: t.continueOnError || false,
    };
  });
}

// --- Task execution ---

function runTask(task, defaultTimeout) {
  const timeout = (task.timeout || defaultTimeout) * 1000;

  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    let stdout = '';
    let stderr = '';

    const proc = spawn('bash', ['-c', task.cmd], {
      timeout,
      cwd: process.cwd(),
      env: { ...process.env },
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({
          name: task.name,
          cmd: task.cmd,
          status: 'timeout',
          exitCode: null,
          durationMs: Date.now() - start,
          stdout: stdout.slice(-500),
          stderr: stderr.slice(-500),
        });
      }
    }, timeout + 500); // small buffer after spawn timeout

    proc.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          name: task.name,
          cmd: task.cmd,
          status: code === 0 ? 'ok' : 'error',
          exitCode: code,
          durationMs: Date.now() - start,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-1000),
        });
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          name: task.name,
          cmd: task.cmd,
          status: 'error',
          exitCode: -1,
          durationMs: Date.now() - start,
          stdout: '',
          stderr: err.message.slice(-1000),
        });
      }
    });
  });
}

// --- Grouping ---

function groupTasks(tasks) {
  const groups = new Map();
  const noGroup = [];

  for (const task of tasks) {
    if (task.group) {
      if (!groups.has(task.group)) groups.set(task.group, []);
      groups.get(task.group).push(task);
    } else {
      noGroup.push(task);
    }
  }

  // Interleave: no-group tasks run sequentially, group tasks run in parallel batches
  const ordered = [];
  for (const task of noGroup) {
    ordered.push([task]); // sequential = group of 1
  }
  for (const [, group] of groups) {
    ordered.push(group); // parallel batch
  }

  return ordered;
}

// --- Report formatting ---

function formatReport(results, totalTimeMs) {
  const ok = results.filter((r) => r.status === 'ok').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const timeouts = results.filter((r) => r.status === 'timeout').length;

  fmt.section(`Task Results — ${ok} ok, ${errors} failed, ${timeouts} timed out (${(totalTimeMs / 1000).toFixed(1)}s total)`);

  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'timeout' ? '⏱️' : '❌';
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    const detail = r.status !== 'ok' && r.stderr ? ` — ${r.stderr.split('\n')[0].slice(0, 80)}` : '';

    fmt.info(`${icon} ${r.name} [${time}]${detail}`);
  }
}

// --- Main ---

async function main() {
  let tasks;
  const defaultTimeout = parseInt(args.timeout, 10);

  // Build task list
  if (args.task) {
    tasks = [{ name: args.name || 'inline', cmd: args.task, timeout: null, group: null, continueOnError: false }];
  } else if (args.stdin) {
    const raw = await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
    tasks = parseManifest(raw);
  } else if (args.manifest) {
    const fs = await import('fs');
    const raw = fs.readFileSync(args.manifest, 'utf8');
    tasks = parseManifest(raw);
  } else {
    console.error('Error: provide --manifest, --stdin, or --task');
    process.exit(1);
  }

  const maxParallel = args.parallel ? parseInt(args.parallel, 10) : null;
  const start = Date.now();
  const results = [];

  // Determine execution order
  let batches;
  if (maxParallel && maxParallel > 1) {
    // Simple parallel: chunk tasks into groups of maxParallel
    batches = [];
    for (let i = 0; i < tasks.length; i += maxParallel) {
      batches.push(tasks.slice(i, i + maxParallel));
    }
  } else {
    // Use group-based execution
    batches = groupTasks(tasks);
  }

  // Execute batches
  let failed = false;
  for (const batch of batches) {
    const batchResults = await Promise.all(batch.map((t) => runTask(t, defaultTimeout)));
    results.push(...batchResults);

    for (const r of batchResults) {
      if (r.status !== 'ok') {
        failed = true;
        if (args['fail-fast']) {
          break;
        }
      }
    }

    if (failed && args['fail-fast']) break;
  }

  const totalTimeMs = Date.now() - start;

  // Output
  if (args.json) {
    fmt.json({ results, totalTimeMs, summary: { ok: results.filter((r) => r.status === 'ok').length, failed: results.filter((r) => r.status !== 'ok').length } });
  } else if (!args.quiet) {
    formatReport(results, totalTimeMs);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
