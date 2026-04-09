#!/usr/bin/env node
/**
 * env-validator.mjs — Validate required environment variables.
 *
 * Checks that required env vars are set, non-empty, and optionally match
 * expected formats (url, email, numeric, filepath) or regex patterns.
 *
 * Zero external dependencies. Uses shared-lib for arg parsing and formatting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, showHelp } from '../../shared-lib/scripts/lib/args.mjs';
import { fmt } from '../../shared-lib/scripts/lib/fmt.mjs';

// ── Format validators ──────────────────────────────────────────────────

const FORMATS = {
  url(value) {
    return /^https?:\/\/.+/i.test(value);
  },
  email(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  },
  numeric(value) {
    return !isNaN(Number(value)) && value.trim() !== '';
  },
  filepath(value) {
    if (path.isAbsolute(value)) return fs.existsSync(value);
    return value.length > 0;
  },
};

// ── Core validation ────────────────────────────────────────────────────

/**
 * Validate a single env variable.
 *
 * @param {string} name - variable name
 * @param {{ required?: boolean, warnIfMissing?: boolean, format?: string, pattern?: string, minLength?: number, maxLength?: number, description?: string }} rule
 * @param {Record<string,string>} envSource - env vars to check against
 * @returns {{ status: 'pass'|'fail'|'warn', present: boolean, value?: string, length?: number, reason?: string, format?: string, valid?: boolean }}
 */
function validateVar(name, rule = {}, envSource = process.env) {
  const value = envSource[name];
  const present = value !== undefined && value !== null && value !== '';

  // Missing required
  if (!present) {
    if (rule.required) {
      return { status: 'fail', present: false, reason: 'required' };
    }
    if (rule.warnIfMissing) {
      return { status: 'warn', present: false, reason: 'optional but recommended' };
    }
    return { status: 'pass', present: false };
  }

  // Present — run additional checks
  const result = { status: 'pass', present: true, length: value.length };

  // Format check
  if (rule.format) {
    const validator = FORMATS[rule.format];
    if (validator) {
      const valid = validator(value);
      if (!valid) {
        result.status = 'fail';
        result.format = rule.format;
        result.valid = false;
        result.reason = `invalid ${rule.format}`;
        return result;
      }
      result.format = rule.format;
      result.valid = true;
    } else {
      result.status = 'warn';
      result.reason = `unknown format "${rule.format}" (skipped)`;
    }
  }

  // Pattern check
  if (rule.pattern && result.status === 'pass') {
    try {
      const re = new RegExp(rule.pattern);
      if (!re.test(value)) {
        result.status = 'fail';
        result.reason = `does not match pattern ${rule.pattern}`;
        return result;
      }
    } catch {
      result.status = 'warn';
      result.reason = `invalid regex pattern: ${rule.pattern}`;
    }
  }

  // Length checks
  if (rule.minLength && value.length < rule.minLength && result.status === 'pass') {
    result.status = 'fail';
    result.reason = `too short (min ${rule.minLength} chars, got ${value.length})`;
    return result;
  }

  if (rule.maxLength && value.length > rule.maxLength && result.status === 'pass') {
    result.status = 'fail';
    result.reason = `too long (max ${rule.maxLength} chars, got ${value.length})`;
    return result;
  }

  return result;
}

// ── Human-readable output ──────────────────────────────────────────────

function humanOutput(results, quiet) {
  const passed = [];
  const failed = [];
  const warnings = [];

  // Find max name length for alignment
  let maxLen = 0;
  for (const [name] of results) {
    maxLen = Math.max(maxLen, name.length);
  }
  maxLen = Math.max(maxLen, 4);

  for (const [name, result] of results) {
    const padded = name.padEnd(maxLen + 2);

    if (result.status === 'pass') {
      if (!quiet) {
        if (result.present) {
          const extra = result.format ? ` (valid ${result.format})` : '';
          console.log(`✅ ${padded} present (${result.length} chars)${extra}`);
        } else {
          console.log(`✅ ${padded} not set (optional)`);
        }
      }
      passed.push(name);
    } else if (result.status === 'warn') {
      if (!quiet) {
        console.log(`⚠️  ${padded} ${result.reason}`);
      }
      warnings.push(name);
    } else if (result.status === 'fail') {
      if (!result.present) {
        console.log(`❌ ${padded} not set (${result.reason})`);
      } else {
        console.log(`❌ ${padded} ${result.reason}`);
      }
      failed.push(name);
    }
  }

  console.log('');
  const parts = [];
  if (passed.length) parts.push(`${passed.length} passed`);
  if (failed.length) parts.push(`${failed.length} failed`);
  if (warnings.length) parts.push(`${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`);
  console.log(`Result: ${parts.join(', ')}`);

  return { passed, failed, warnings };
}

// ── JSON output ────────────────────────────────────────────────────────

function jsonOutput(results) {
  const passed = [];
  const failed = [];
  const warnings = [];
  const all = {};

  for (const [name, result] of results) {
    all[name] = result;
    if (result.status === 'pass') passed.push(name);
    else if (result.status === 'warn') warnings.push(name);
    else failed.push(name);
  }

  const output = { passed, failed, warnings, all, exit: failed.length > 0 ? 1 : 0 };
  fmt.json(output);
  return output;
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2), {
    alias: { h: 'help', m: 'manifest', v: 'vars', f: 'format', p: 'pattern', e: 'env-file', j: 'json', q: 'quiet', s: 'strict' },
    boolean: ['help', 'json', 'quiet', 'strict'],
    string: ['manifest', 'vars', 'format', 'pattern', 'env-file'],
    default: { json: false, quiet: false, strict: false },
  });

  if (args.help) {
    showHelp('env-validator', 'Validate required environment variables.', {
      '--manifest <path>': 'JSON manifest file listing vars and rules',
      '--vars <list>': 'Comma-separated var names (no manifest)',
      '--format <var>:<type>': 'Format rule: url, email, numeric, filepath',
      '--pattern <var>:<regex>': 'Regex the value must match',
      '--env-file <path>': 'Load vars from a .env file',
      '--json': 'Output as JSON',
      '--quiet': 'Only show failures and warnings',
      '--strict': 'Treat warnings as failures (exit 1)',
    });
  }

  // Load env file if specified
  let envSource = process.env;
  if (args['env-file']) {
    const envPath = path.resolve(args['env-file']);
    if (!fs.existsSync(envPath)) {
      console.error(`❌ Env file not found: ${envPath}`);
      process.exit(1);
    }
    envSource = { ...process.env };
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      let key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in envSource)) envSource[key] = value;
    }
  }

  // Parse format overrides (--format VAR:type)
  const formatOverrides = {};
  if (args.format) {
    for (const entry of String(args.format).split(',')) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx !== -1) {
        formatOverrides[entry.slice(0, colonIdx).trim()] = entry.slice(colonIdx + 1).trim();
      }
    }
  }

  // Parse pattern overrides (--pattern VAR:regex)
  const patternOverrides = {};
  if (args.pattern) {
    for (const entry of String(args.pattern).split(',')) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx !== -1) {
        patternOverrides[entry.slice(0, colonIdx).trim()] = entry.slice(colonIdx + 1).trim();
      }
    }
  }

  // Build validation plan
  const rules = {};
  const order = [];

  if (args.manifest) {
    // Load from manifest JSON
    const manifestPath = path.resolve(args.manifest);
    if (!fs.existsSync(manifestPath)) {
      console.error(`❌ Manifest not found: ${manifestPath}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const [name, rule] of Object.entries(manifest.variables || {})) {
      rules[name] = rule;
      order.push(name);
    }
  } else if (args.vars) {
    // Inline var list
    for (const name of String(args.vars).split(',')) {
      const trimmed = name.trim();
      if (trimmed) {
        rules[trimmed] = { required: true };
        order.push(trimmed);
      }
    }
  } else {
    console.error('❌ Specify --manifest or --vars');
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  // Apply format/pattern overrides from CLI
  for (const [varName, fmt] of Object.entries(formatOverrides)) {
    if (rules[varName]) rules[varName].format = fmt;
    else { rules[varName] = { required: true, format: fmt }; order.push(varName); }
  }
  for (const [varName, pat] of Object.entries(patternOverrides)) {
    if (rules[varName]) rules[varName].pattern = pat;
    else { rules[varName] = { required: true, pattern: pat }; order.push(varName); }
  }

  // Run validation
  const results = new Map();
  for (const name of order) {
    results.set(name, validateVar(name, rules[name], envSource));
  }

  // Output
  const output = args.json ? jsonOutput(results) : humanOutput(results, args.quiet);

  // Exit code
  let exitCode = output.failed.length > 0 ? 1 : 0;
  if (exitCode === 0 && args.strict && output.warnings.length > 0) {
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
