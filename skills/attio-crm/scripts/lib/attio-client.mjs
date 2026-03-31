import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  // Check explicit env var first, then fall back to workspace/.env
  // (scripts/ → attio-crm/ → trackhub/ → workspace/)
  const envFile = process.env.ATTIO_ENV_FILE ||
    path.resolve(import.meta.dirname, '..', '..', '..', '..', '.env');

  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

const API_KEY = process.env.ATTIO_API_KEY;
const BASE_URL = process.env.ATTIO_API_BASE_URL || 'https://api.attio.com';

if (!API_KEY) {
  console.error('Missing ATTIO_API_KEY in .env');
  process.exit(1);
}

export async function attioRequest(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const err = new Error(`Attio API error ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const endpoint = process.argv[2] || '/v2/objects';
  try {
    const data = await attioRequest(endpoint);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      status: err.status || null,
      body: err.body || String(err.message || err),
    }, null, 2));
    process.exit(1);
  }
}
