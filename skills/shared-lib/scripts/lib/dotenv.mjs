#!/usr/bin/env node
/**
 * Lightweight .env loader for trackhub scripts.
 *
 * Usage:
 *   import { loadEnv, env } from './lib/dotenv.mjs';
 *   loadEnv();  // auto-discovers .env
 *   console.log(env.MY_VAR);
 *
 * Or find a .env relative to a specific script:
 *   loadEnv(import.meta.dirname);
 *
 * Discovery order:
 *   1. Explicit env var (e.g. MY_ENV_FILE)
 *   2. .env in the directory passed to loadEnv()
 *   3. Walk up to workspace root (trackhub/skills/<skill>/scripts/ → workspace/)
 *
 * Supports: unquoted values, single/double quoted values, comments, blank lines.
 * Does NOT overwrite existing env vars (first-wins).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Load .env file. Returns the loaded values (not the full process.env).
 *
 * @param {string} [envVarName] - env var holding explicit path to .env
 * @param {string} [relativeTo] - directory to start searching from
 * @returns {Record<string, string>} values that were loaded
 */
export function loadEnv(envVarName, relativeTo) {
  const loaded = {};

  // 1. Explicit env var pointing to a file
  if (envVarName && process.env[envVarName]) {
    const explicit = process.env[envVarName];
    if (fs.existsSync(explicit)) {
      return parseDotFile(explicit, loaded);
    }
  }

  // 2. Try relativeTo directory
  const searchDirs = [];
  if (relativeTo) {
    searchDirs.push(relativeTo);
  }

  // 3. Walk up from import.meta.dirname (or relativeTo) toward workspace root
  const start = relativeTo || import.meta.dirname || process.cwd();
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    searchDirs.push(dir);
    dir = path.dirname(dir);
  }

  // Deduplicate while preserving order
  const seen = new Set();
  for (const d of searchDirs) {
    const key = d.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = path.join(d, '.env');
    if (fs.existsSync(candidate)) {
      parseDotFile(candidate, loaded);
      break; // Use the first .env found walking up
    }
  }

  return loaded;
}

/**
 * Convenience: get a typed env var with fallback.
 */
export function envVar(name, fallback = undefined) {
  const val = process.env[name];
  if (val === undefined) return fallback;
  if (fallback !== undefined && typeof fallback === 'number') return Number(val);
  return val;
}

/**
 * Parse a .env file and set values into process.env (without overwriting).
 */
function parseDotFile(filePath, loaded) {
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = line.indexOf('=');
    if (idx === -1) continue;

    let key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't overwrite existing env vars
    if (!(key in process.env)) {
      process.env[key] = value;
      loaded[key] = value;
    }
  }
  return loaded;
}

/**
 * Re-export process.env for convenience (read-only view).
 * Prefer envVar() for typed access.
 */
export const env = process.env;

// Auto-load when run directly (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = loadEnv();
  if (Object.keys(result).length > 0) {
    console.log('Loaded .env variables:', Object.keys(result).join(', '));
  } else {
    console.log('No .env file found');
  }
}
