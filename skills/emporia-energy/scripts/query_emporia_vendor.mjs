#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.resolve(__dirname, '..', 'vendor', 'node_modules', '@emporiaenergy', 'emporia-mcp', 'build');

const { loadEnvironmentConfig } = await import(path.join(vendorRoot, 'env.js'));
const { CognitoAuthService } = await import(path.join(vendorRoot, 'services', 'auth.js'));
const { EmporiaApiService } = await import(path.join(vendorRoot, 'services', 'api.js'));
const { COGNITO_CLIENT_ID, COGNITO_URL } = await import(path.join(vendorRoot, 'config.js'));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else { out[key] = true; }
  }
  return out;
}

function loadDotEnv(file) {
  if (!file || !fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let [, k, v] = m;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function iso(dt) { return new Date(dt).toISOString(); }
function startOfDay(d) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDay(d) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }
function startOfWeek(d) { const x = startOfDay(d); const day = x.getUTCDay(); const diff = (day + 6) % 7; x.setUTCDate(x.getUTCDate() - diff); return x; }
function startOfMonth(d) { const x = new Date(d); x.setUTCDate(1); x.setUTCHours(0,0,0,0); return x; }

function resolveRange(label) {
  const now = new Date();
  switch ((label || 'today').toLowerCase()) {
    case 'today': return { start: iso(startOfDay(now)), end: iso(endOfDay(now)), resolution: 'DAYS' };
    case 'yesterday': {
      const y = new Date(now); y.setUTCDate(y.getUTCDate() - 1);
      return { start: iso(startOfDay(y)), end: iso(endOfDay(y)), resolution: 'DAYS' };
    }
    case 'week':
    case 'this-week': return { start: iso(startOfWeek(now)), end: iso(now), resolution: 'DAYS' };
    case 'month':
    case 'this-month': return { start: iso(startOfMonth(now)), end: iso(now), resolution: 'DAYS' };
    case '24h': {
      const s = new Date(now.getTime() - 24*3600*1000); return { start: iso(s), end: iso(now), resolution: 'HOURS' };
    }
    default: throw new Error(`Unsupported range: ${label}`);
  }
}

function safeJson(x) { console.log(JSON.stringify(x, null, 2)); }

function flattenChannels(channelsResult) {
  const rows = [];
  for (const dev of channelsResult.deviceSummaries || []) {
    for (const c of dev.channelInfo || []) {
      rows.push({
        deviceGid: dev.deviceGid,
        manufacturerDeviceId: dev.manufacturerDeviceId,
        parentDeviceId: dev.parentDeviceId,
        channelId: c.channelId,
        channelNum: c.channelNum,
        channelName: c.name,
        channelType: c.type,
      });
    }
  }
  return rows;
}

function flattenEnergyData(result) {
  const rows = [];
  for (const [type, payload] of Object.entries(result || {})) {
    const items = payload?.energyData?.success || payload?.energyData || [];
    for (const item of items) rows.push({ deviceType: type, ...item });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'overview';
  const envFile = path.resolve(args['env-file'] || '/home/delads/.openclaw/workspace/.env');
  loadDotEnv(envFile);

  const envConfig = loadEnvironmentConfig();
  const authService = new CognitoAuthService({
    account_email: envConfig.account,
    password: envConfig.password,
    clientId: COGNITO_CLIENT_ID,
    cognitoUrl: COGNITO_URL,
  });
  await authService.initialize();
  const api = new EmporiaApiService(authService);
  const { accessToken } = await authService.getToken();

  if (cmd === 'list-devices') {
    const data = await api.listDevices(accessToken);
    return safeJson(data);
  }

  if (cmd === 'list-channels') {
    const data = await api.getDevicesChannels(accessToken);
    return safeJson({ ...data, flatChannels: flattenChannels(data) });
  }

  if (cmd === 'energy') {
    const range = resolveRange(args.range || 'today');
    const devices = await api.listDevices(accessToken);
    const channels = await api.getDevicesChannels(accessToken);
    const filter = (args.filter || '').toLowerCase();
    const flat = flattenChannels(channels);
    const matched = filter
      ? flat.filter(x => (x.channelName || '').toLowerCase().includes(filter) || (x.manufacturerDeviceId || '').toLowerCase().includes(filter))
      : flat;
    const deviceIds = [...new Set(matched.map(x => x.manufacturerDeviceId).filter(Boolean))];
    const circuitIds = [...new Set(matched.map(x => x.channelId).filter(Boolean))];
    if (deviceIds.length === 0 || circuitIds.length === 0) throw new Error('No matching Emporia channels found for the requested filter.');
    const data = await api.getDeviceEnergyUsage(accessToken, {
      device_ids: deviceIds,
      circuit_ids: circuitIds,
      start: range.start,
      end: range.end,
      energy_resolution: args.resolution || range.resolution,
    });
    return safeJson({
      command: cmd,
      range,
      filter: args.filter || null,
      matchedChannels: matched,
      devicesSummary: devices.deviceCount,
      energy: data,
      flatEnergy: flattenEnergyData(data),
    });
  }

  if (cmd === 'overview') {
    const devices = await api.listDevices(accessToken);
    const channels = await api.getDevicesChannels(accessToken);
    return safeJson({
      customer: devices.customerInfo,
      deviceCount: devices.deviceCount,
      devices: devices.devices,
      channelCount: flattenChannels(channels).length,
      flatChannels: flattenChannels(channels),
      notes: [
        'This wrapper uses the official @emporiaenergy/emporia-mcp npm package internals locally.',
        'Use the energy command with --filter and --range for targeted usage lookups.',
      ],
    });
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch(err => {
  const msg = String(err?.message || err || 'Unknown error');
  if (msg.includes('Not authorized for the requested resource')) {
    console.error([
      'Emporia authenticated the account but denied access to the customer device API.',
      'Likely causes:',
      '- this is a Google/Apple-linked Emporia account rather than a native email/password account',
      '- the account has no shared devices / no customer-cloud access for the requested resource',
      '- Emporia changed beta MCP/API permissions',
      '',
      'Recommended next step: use a native Emporia account and share devices to it, or fall back to the PyEmVue path if that works for your account.'
    ].join('\n'));
  } else {
    console.error(err?.stack || msg);
  }
  process.exit(1);
});
