#!/usr/bin/env node
// openclaw-config-audit.cjs — Audit an OpenClaw configuration file for common issues
// Zero dependencies. Node.js 18+.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    config: path.join(os.homedir(), '.openclaw', 'openclaw.json'),
    check: null,
    json: false,
    failOnly: false,
    quiet: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--config' || a === '-c') { opts.config = args[++i]; continue; }
    if (a === '--check') { opts.check = args[++i].split(',').map(s => s.trim().toLowerCase()); continue; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--fail-only') { opts.failOnly = true; continue; }
    if (a === '--quiet' || a === '-q') { opts.quiet = true; continue; }
    if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return opts;
}

function printHelp() {
  console.log(`openclaw-config-audit — Audit OpenClaw configuration for common issues

Usage: node openclaw-config-audit.cjs [options]

Options:
  --config, -c <path>   Config file path (default: ~/.openclaw/openclaw.json)
  --check <cats>        Only check specific categories (comma-separated)
                        Categories: credentials, models, channels, gateway, skills, security, general
  --json                Output as JSON
  --fail-only           Only show warnings and errors
  --quiet, -q           No output, exit code only (0=clean, 1=warnings, 2=errors)
  --help, -h            Show this help`);
}

const SEVERITY = { OK: 'ok', WARN: 'warn', ERROR: 'error', INFO: 'info' };
const ICONS = { ok: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };

class AuditResult {
  constructor(category) {
    this.category = category;
    this.items = [];
  }
  ok(msg, detail) { this.items.push({ severity: SEVERITY.OK, message: msg, detail }); }
  warn(msg, detail) { this.items.push({ severity: SEVERITY.WARN, message: msg, detail }); }
  error(msg, detail) { this.items.push({ severity: SEVERITY.ERROR, message: msg, detail }); }
  info(msg, detail) { this.items.push({ severity: SEVERITY.INFO, message: msg, detail }); }

  get worstSeverity() {
    if (this.items.some(i => i.severity === SEVERITY.ERROR)) return SEVERITY.ERROR;
    if (this.items.some(i => i.severity === SEVERITY.WARN)) return SEVERITY.WARN;
    return SEVERITY.OK;
  }

  get summary() {
    const counts = { ok: 0, warn: 0, error: 0, info: 0 };
    this.items.forEach(i => counts[i.severity]++);
    return counts;
  }
}

// ── Auditors ────────────────────────────────────────────────────────────────

function auditCredentials(cfg, configPath) {
  const r = new AuditResult('Credentials');
  const channels = cfg.channels || {};
  const auth = cfg.auth || {};
  const meta = cfg.meta || {};

  // Slack
  if (channels.slack) {
    const slack = channels.slack;
    if (slack.botToken) {
      if (slack.botToken.startsWith('xoxb-')) {
        r.ok('Slack bot token present and valid format');
      } else {
        r.warn('Slack bot token present but doesn\'t start with xoxb-', `Token starts with: ${slack.botToken.substring(0, 8)}...`);
      }
    } else if (slack.userTokenReadOnly) {
      r.warn('Slack has user token but no bot token — limited functionality');
    } else {
      r.error('Slack channel configured but no bot token found');
    }
    if (slack.enabled === false) {
      r.info('Slack channel is disabled');
    }
  }

  // WhatsApp
  if (channels.whatsapp) {
    const wa = channels.whatsapp;
    if (wa.webhookPath || wa.token || wa.instanceUrl) {
      r.ok('WhatsApp channel configured');
    } else {
      r.warn('WhatsApp channel entry exists but appears incomplete');
    }
    if (wa.enabled === false) {
      r.info('WhatsApp channel is disabled');
    }
  }

  // Auth profiles
  if (auth.profiles && Array.isArray(auth.profiles)) {
    r.ok(`${auth.profiles.length} auth profile(s) configured`);
  }

  // Config age
  if (meta.lastTouchedAt) {
    const touched = new Date(meta.lastTouchedAt);
    const daysAgo = (Date.now() - touched.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo > 90) {
      r.warn(`Config last touched ${Math.round(daysAgo)} days ago — may be stale`, meta.lastTouchedAt);
    } else {
      r.info(`Config last touched ${Math.round(daysAgo)} days ago`);
    }
  }

  if (!channels.slack && !channels.whatsapp && Object.keys(channels).length === 0) {
    r.error('No channels configured — agent has no messaging surface');
  } else {
    const enabledCount = Object.values(channels).filter(c => c.enabled !== false).length;
    if (enabledCount === 0) {
      r.error('All channels are disabled — agent cannot send or receive messages');
    } else {
      r.ok(`${enabledCount} channel(s) enabled`);
    }
  }

  return r;
}

function auditModels(cfg) {
  const r = new AuditResult('Models');
  const models = cfg.models || {};
  const providers = models.providers || {};
  const mode = models.mode || 'single';

  if (Object.keys(providers).length === 0) {
    r.error('No model providers configured');
    return r;
  }

  r.ok(`${Object.keys(providers).length} model provider(s) configured`);
  r.info(`Model mode: ${mode}`);

  for (const [name, provider] of Object.entries(providers)) {
    if (!provider.model && !provider.models) {
      r.warn(`Provider "${name}" has no model specified`);
      continue;
    }

    // Check for API key
    if (provider.apiKey !== undefined) {
      if (typeof provider.apiKey === 'string' && provider.apiKey.length > 0 && !provider.apiKey.includes('YOUR_') && !provider.apiKey.includes('placeholder')) {
        r.ok(`Provider "${name}" has API key set`);
      } else if (typeof provider.apiKey === 'string' && (provider.apiKey.includes('YOUR_') || provider.apiKey.includes('placeholder') || provider.apiKey === '')) {
        r.warn(`Provider "${name}" has placeholder/empty API key`);
      } else {
        // Could be an env var reference or object — just note it
        r.info(`Provider "${name}" API key configured`);
      }
    } else if (provider.baseURL && !provider.apiKey) {
      r.warn(`Provider "${name}" has baseURL but no API key — may use env vars`);
    }
  }

  // Check agents.defaults model
  const agents = cfg.agents || {};
  const defaults = agents.defaults || {};
  const defaultModel = defaults.model
    ? (typeof defaults.model === 'string' ? defaults.model : defaults.model.primary || null)
    : null;
  if (defaultModel) {
    r.info(`Default agent model: ${defaultModel}`);
    // Try to resolve it
    const parts = String(defaultModel).split('/');
    if (parts.length >= 2) {
      const providerName = parts[0];
      if (providers[providerName]) {
        r.ok(`Default model resolves to provider "${providerName}"`);
      } else {
        r.warn(`Default model references provider "${providerName}" which is not in config`, 'May be an alias or remote provider');
      }
    }
  } else {
    r.info('No default agent model specified — uses OpenClaw built-in default');
  }

  return r;
}

function auditChannels(cfg) {
  const r = new AuditResult('Channels');
  const channels = cfg.channels || {};

  if (Object.keys(channels).length === 0) {
    r.error('No channels configured');
    return r;
  }

  for (const [name, ch] of Object.entries(channels)) {
    if (ch.enabled === false) {
      r.info(`Channel "${name}" is disabled`);
      continue;
    }

    // Check for allowFrom
    if (ch.allowFrom) {
      if (Array.isArray(ch.allowFrom)) {
        r.info(`Channel "${name}": ${ch.allowFrom.length} allowed sender(s)`);
      } else if (ch.allowFrom === '*' || ch.allowFrom === true) {
        r.warn(`Channel "${name}" accepts all senders — consider restricting allowFrom`);
      }
    }

    // Check streaming config
    if (ch.streaming && !ch.nativeStreaming) {
      r.info(`Channel "${name}": streaming enabled without nativeStreaming`);
    }

    // Channel-specific checks
    if (name === 'slack') {
      if (ch.channels && typeof ch.channels === 'object') {
        r.info(`Slack: ${Object.keys(ch.channels).length} channel mapping(s)`);
      }
      if (!ch.webhookPath) {
        r.info('Slack: no webhookPath — may use socket mode');
      }
    }
  }

  r.ok(`${Object.keys(channels).length} channel(s) defined`);
  return r;
}

function auditGateway(cfg) {
  const r = new AuditResult('Gateway');
  const gw = cfg.gateway || {};

  if (Object.keys(gw).length === 0) {
    r.info('No gateway configuration found');
    return r;
  }

  // Port
  if (gw.port) {
    if (gw.port > 0 && gw.port <= 65535) {
      r.info(`Gateway port: ${gw.port}`);
    } else {
      r.error(`Invalid gateway port: ${gw.port}`);
    }
  }

  // Auth
  if (gw.auth) {
    if (gw.auth.token || gw.auth.password || gw.auth.type) {
      r.ok('Gateway auth configured');
    } else {
      r.warn('Gateway auth object exists but appears empty');
    }
  } else {
    r.warn('No gateway auth configured — control interface may be open');
  }

  // Bind
  if (gw.bind) {
    if (gw.bind === '0.0.0.0' && !gw.auth) {
      r.warn('Gateway bound to 0.0.0.0 without auth — accessible from network');
    }
  }

  // Tailscale
  if (gw.tailscale && gw.tailscale.enabled) {
    r.info('Tailscale integration enabled');
  }

  // Nodes
  const nodes = gw.nodes || [];
  if (nodes.length > 0) {
    r.info(`${nodes.length} gateway node(s) configured`);
  }

  // Control UI
  if (gw.controlUi && gw.controlUi.enabled) {
    if (!gw.auth) {
      r.warn('Control UI enabled without gateway auth');
    } else {
      r.info('Control UI enabled (auth present)');
    }
  }

  return r;
}

function auditSkills(cfg, configDir) {
  const r = new AuditResult('Skills');
  const skills = cfg.skills || {};
  const loadCfg = skills.load || {};
  const entries = skills.entries || {};

  // Extract load paths — could be array or object with extraDirs
  const loadPaths = Array.isArray(loadCfg)
    ? loadCfg
    : (loadCfg.extraDirs || []).concat(loadCfg.dirs || []);

  if (loadPaths.length === 0 && Object.keys(entries).length === 0) {
    r.info('No skills configured in config');
    return r;
  }

  // Check load paths
  const validPaths = [];
  const missingPaths = [];
  for (const lp of loadPaths) {
    const resolved = path.isAbsolute(lp) ? lp : path.resolve(configDir, lp);
    if (fs.existsSync(resolved)) {
      validPaths.push(resolved);
    } else {
      missingPaths.push(lp);
    }
  }

  if (validPaths.length > 0) {
    r.ok(`${validPaths.length} skill load path(s) valid`);
  }
  if (missingPaths.length > 0) {
    r.warn(`${missingPaths.length} skill load path(s) not found`, missingPaths.join(', '));
  }

  // Check skill entries
  const entryCount = Object.keys(entries).length;
  if (entryCount > 0) {
    r.info(`${entryCount} skill entries declared`);
  }

  return r;
}

function auditSecurity(cfg) {
  const r = new AuditResult('Security');
  const gw = cfg.gateway || {};
  const tools = cfg.tools || {};

  // Control UI without auth
  if (gw.controlUi && gw.controlUi.enabled && !gw.auth) {
    r.error('Control UI enabled without gateway auth — exposed to network');
  }

  // Bind without auth
  if (gw.bind === '0.0.0.0' && !gw.auth) {
    r.warn('Gateway bound to all interfaces without auth');
  }

  // Trusted proxies
  if (gw.trustedProxies) {
    if (Array.isArray(gw.trustedProxies) && gw.trustedProxies.includes('*')) {
      r.warn('Trusted proxies set to wildcard — all proxies trusted');
    }
  }

  // Tool profile
  if (tools.profile) {
    const profile = typeof tools.profile === 'string' ? tools.profile : JSON.stringify(tools.profile);
    if (profile === 'full' || profile.includes('"allowAll"') || profile.includes('*')) {
      r.info('Tool profile is permissive — all tools available');
    } else {
      r.ok('Tool profile configured');
    }
  }

  // Session DM scope
  const session = cfg.session || {};
  if (session.dmScope === '*' || session.dmScope === 'anyone') {
    r.warn('DM scope is open — anyone can start sessions');
  }

  return r;
}

function auditGeneral(cfg, configPath) {
  const r = new AuditResult('General');
  const meta = cfg.meta || {};

  // Known top-level keys
  const knownKeys = new Set([
    'meta', 'wizard', 'auth', 'models', 'agents', 'tools', 'commands',
    'session', 'hooks', 'channels', 'gateway', 'skills', 'plugins'
  ]);
  const unknownKeys = Object.keys(cfg).filter(k => !knownKeys.has(k));
  if (unknownKeys.length > 0) {
    r.info(`${unknownKeys.length} unknown top-level key(s)`, unknownKeys.join(', '));
  }

  // Version
  if (meta.lastTouchedVersion) {
    r.info(`Config last touched by OpenClaw v${meta.lastTouchedVersion}`);
    // Try to detect installed version
    try {
      const installedRaw = execSync('openclaw --version 2>/dev/null', { timeout: 3000 }).toString().trim();
      if (installedRaw) {
        // Extract just the version number from strings like "OpenClaw 2026.3.13 (61d171a)"
        const installed = installedRaw.replace(/^.*?\s+/, '').replace(/\s*\(.*\)\s*$/, '');
        if (installed && installed !== meta.lastTouchedVersion) {
          r.warn(`Config version (v${meta.lastTouchedVersion}) differs from installed (${installed})`, 'Consider running openclaw setup to update config');
        }
      }
    } catch {
      // openclaw CLI not available, skip version check
    }
  }

  return r;
}

// ── Output ───────────────────────────────────────────────────────────────────

function formatText(results, configPath, opts) {
  const lines = [];
  lines.push('══ OpenClaw Config Audit ══');
  lines.push(configPath);

  // Version info
  try {
    const ver = execSync('openclaw --version 2>/dev/null', { timeout: 3000 }).toString().trim();
    if (ver) lines.push(`${ver} · ${os.type()} ${os.arch()}`);
  } catch {
    lines.push(`${os.type()} ${os.arch()}`);
  }
  lines.push('');

  let totalOk = 0, totalWarn = 0, totalError = 0, totalInfo = 0;

  for (const result of results) {
    if (opts.failOnly) {
      const items = result.items.filter(i => i.severity !== SEVERITY.OK && i.severity !== SEVERITY.INFO);
      if (items.length === 0) continue;
    }

    const worst = result.worstSeverity;
    const icon = worst === SEVERITY.ERROR ? ICONS.error : worst === SEVERITY.WARN ? ICONS.warn : ICONS.ok;
    lines.push(`  ${icon} ${result.category}`);

    for (const item of result.items) {
      if (opts.failOnly && (item.severity === SEVERITY.OK || item.severity === SEVERITY.INFO)) continue;
      const i = ICONS[item.severity] || '  ';
      lines.push(`     ${i} ${item.message}`);
      if (item.detail) lines.push(`        ↳ ${item.detail}`);
    }
    lines.push('');

    const s = result.summary;
    totalOk += s.ok;
    totalWarn += s.warn;
    totalError += s.error;
    totalInfo += s.info;
  }

  if (!opts.failOnly) {
    lines.push(`Summary: ${totalOk} ok · ${totalWarn} warnings · ${totalError} errors · ${totalInfo} info`);
  }

  return lines.join('\n');
}

function formatJson(results, configPath) {
  return JSON.stringify({
    configPath,
    timestamp: new Date().toISOString(),
    categories: results.map(r => ({
      category: r.category,
      severity: r.worstSeverity,
      summary: r.summary,
      items: r.items,
    })),
    totals: results.reduce((acc, r) => {
      const s = r.summary;
      acc.ok += s.ok; acc.warn += s.warn; acc.error += s.error; acc.info += s.info;
      return acc;
    }, { ok: 0, warn: 0, error: 0, info: 0 }),
  }, null, 2);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv);

  // Read config
  if (!fs.existsSync(opts.config)) {
    console.error(`Error: Config file not found: ${opts.config}`);
    process.exit(2);
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(opts.config, 'utf8'));
  } catch (e) {
    console.error(`Error: Failed to parse config: ${e.message}`);
    process.exit(2);
  }

  const configDir = path.dirname(opts.config);
  const allCategories = ['credentials', 'models', 'channels', 'gateway', 'skills', 'security', 'general'];

  // Determine which categories to run
  const categories = opts.check || allCategories;

  const auditors = {
    credentials: () => auditCredentials(cfg, configDir),
    models: () => auditModels(cfg),
    channels: () => auditChannels(cfg),
    gateway: () => auditGateway(cfg),
    skills: () => auditSkills(cfg, configDir),
    security: () => auditSecurity(cfg),
    general: () => auditGeneral(cfg, opts.config),
  };

  const results = [];
  for (const cat of categories) {
    const auditor = auditors[cat];
    if (!auditor) {
      console.error(`Error: Unknown category "${cat}". Valid: ${allCategories.join(', ')}`);
      process.exit(2);
    }
    results.push(auditor());
  }

  // Output
  if (opts.quiet) {
    const hasError = results.some(r => r.worstSeverity === SEVERITY.ERROR);
    const hasWarn = results.some(r => r.worstSeverity === SEVERITY.WARN);
    process.exit(hasError ? 2 : hasWarn ? 1 : 0);
  }

  if (opts.json) {
    console.log(formatJson(results, opts.config));
  } else {
    console.log(formatText(results, opts.config, opts));
  }

  // Exit code
  const hasError = results.some(r => r.worstSeverity === SEVERITY.ERROR);
  const hasWarn = results.some(r => r.worstSeverity === SEVERITY.WARN);
  process.exit(hasError ? 2 : hasWarn ? 1 : 0);
}

main();
