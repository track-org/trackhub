/**
 * schema-cache.mjs — TTL-cached Attio workspace schema
 *
 * Fetches and caches deal object metadata + attribute definitions.
 * On first run (or when cache is stale), hits the Attio API and saves
 * to workspace/data/attio-crm/. Subsequent runs load from disk.
 *
 * Also extracts status option values (stage names, company_stage values)
 * by scanning all deal records — Attio's attribute API doesn't include
 * status options, so we discover them from actual data.
 *
 * Usage:
 *   import { loadSchema, refreshSchema, getStageNames, getCompanyStages } from './schema-cache.mjs';
 */

import fs from 'node:fs';
import path from 'node:path';
import { attioRequest } from './attio-client.mjs';

// Schema data lives in the workspace data directory, not in trackhub.
// From scripts/lib/ → attio-crm/ → skills/ → trackhub/ → workspace/data/
const SCHEMA_DIR = path.resolve(
  import.meta.dirname, '..', '..', '..', '..', '..', 'data', 'attio-crm'
);
const SCHEMA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Resolve the schema directory, creating it if needed.
 */
function ensureDir() {
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });
  return SCHEMA_DIR;
}

/**
 * Load a cached JSON file if it exists and is fresh.
 * Returns null if missing or expired.
 */
function loadCached(filename, forceRefresh = false) {
  const filePath = path.join(SCHEMA_DIR, filename);
  if (forceRefresh || !fs.existsSync(filePath)) return null;

  const stat = fs.statSync(filePath);
  const age = Date.now() - stat.mtimeMs;
  if (age > SCHEMA_TTL_MS) return null; // stale

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save JSON to the schema cache directory.
 */
function saveCached(filename, data) {
  const dir = ensureDir();
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Extract unique status option values from deal records.
 * Scans all deals and collects status titles for a given field.
 */
async function discoverStatusOptions(fieldSlug) {
  const all = [];
  let offset = 0;
  while (true) {
    const data = await attioRequest('/v2/objects/deals/records/query', {
      method: 'POST',
      body: JSON.stringify({ limit: 100, offset }),
    });
    const batch = data?.data || [];
    all.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }

  const options = new Map(); // title → { id, is_archived }
  for (const r of all) {
    const entry = r?.values?.[fieldSlug]?.[0];
    if (entry?.status?.title) {
      const title = entry.status.title;
      if (!options.has(title)) {
        options.set(title, {
          id: entry.status.id?.status_id || null,
          is_archived: entry.status.is_archived || false,
        });
      }
    }
  }

  return {
    options: [...options.entries()].map(([title, meta]) => ({ title, ...meta })),
    totalRecords: all.length,
  };
}

/**
 * Load the full schema (object + attributes + status options).
 * Returns { object, attributes, stageOptions, companyStageOptions, meta }
 */
export async function loadSchema(forceRefresh = false) {
  // Try loading everything from cache
  const cachedObj = loadCached('deals-object.json', forceRefresh);
  const cachedAttrs = loadCached('deals-attributes.json', forceRefresh);
  const cachedStages = loadCached('deals-stage-options.json', forceRefresh);
  const cachedCompanyStages = loadCached('deals-company-stage-options.json', forceRefresh);

  if (cachedObj && cachedAttrs && cachedStages && cachedCompanyStages) {
    return {
      object: cachedObj.data,
      attributes: cachedAttrs.data,
      stageOptions: cachedStages,
      companyStageOptions: cachedCompanyStages,
      meta: { source: 'cache', fetchedAt: null },
    };
  }

  // Fetch from API
  const [objRes, attrRes] = await Promise.all([
    attioRequest('/v2/objects/deals'),
    attioRequest('/v2/objects/deals/attributes'),
  ]);

  saveCached('deals-object.json', objRes);
  saveCached('deals-attributes.json', attrRes);

  // Discover status options from actual records
  const [stageOpts, companyStageOpts] = await Promise.all([
    discoverStatusOptions('stage'),
    discoverStatusOptions('company_stage'),
  ]);

  saveCached('deals-stage-options.json', stageOpts.options);
  saveCached('deals-company-stage-options.json', companyStageOpts.options);

  return {
    object: objRes.data,
    attributes: attrRes.data,
    stageOptions: stageOpts.options,
    companyStageOptions: companyStageOpts.options,
    meta: {
      source: 'api',
      fetchedAt: new Date().toISOString(),
      recordsScanned: stageOpts.totalRecords,
    },
  };
}

/**
 * Force refresh the schema cache (ignores TTL).
 */
export async function refreshSchema() {
  return loadSchema(true);
}

/**
 * Get stage names from the cache without a full schema load.
 * Returns an array of stage option objects or null.
 */
export function getStageNames() {
  const cached = loadCached('deals-stage-options.json');
  return cached || null;
}

/**
 * Get company stage names from cache.
 */
export function getCompanyStages() {
  const cached = loadCached('deals-company-stage-options.json');
  return cached || null;
}

/**
 * Get attribute definitions from cache.
 */
export function getAttributes() {
  const cached = loadCached('deals-attributes.json');
  return cached?.data || null;
}

/**
 * Get the schema cache directory path (for testing/logging).
 */
export function getSchemaDir() {
  return SCHEMA_DIR;
}
