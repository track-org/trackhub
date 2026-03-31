import { attioRequest } from './lib/attio-client.mjs';

function getName(record) {
  return record?.values?.name?.[0]?.value || 'Untitled deal';
}

function getStage(record) {
  return record?.values?.stage?.[0]?.status?.title || 'Unknown';
}

function getValue(record) {
  const raw = record?.values?.value?.[0];
  if (!raw) return { amount: 0, currency: 'EUR' };
  return {
    amount: Number(raw.currency_value ?? raw.value ?? 0),
    currency: raw.currency_code || 'EUR',
  };
}

function getCompany(record) {
  const ref = record?.values?.associated_company?.[0];
  return ref?.target_record_id || null;
}

function getStageChanged(record) {
  const raw = record?.values?.stage?.[0]?.active_from;
  return raw || null;
}

function fmtMoney(amount, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    stage: null,
    excludeStages: [],
    json: false,
    format: 'grouped', // 'grouped' | 'flat' | 'names'
    minAgeHours: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--stage' && args[i + 1]) {
      opts.stage = args[++i];
    } else if (arg === '--exclude' && args[i + 1]) {
      opts.excludeStages.push(args[++i]);
    } else if (arg === '--format' && args[i + 1]) {
      opts.format = args[++i];
    } else if (arg === '--min-age-hours' && args[i + 1]) {
      opts.minAgeHours = parseInt(args[++i], 10);
    }
  }

  return opts;
}

async function fetchAllDeals() {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await attioRequest('/v2/objects/deals/records/query', {
      method: 'POST',
      body: JSON.stringify({ limit, offset }),
    });

    const batch = data?.data || [];
    all.push(...batch);

    if (batch.length < limit) break;
    offset += limit;
  }

  return all;
}

function filterDeals(records, opts) {
  let filtered = records;

  if (opts.stage) {
    // Partial match — "won" matches "Won 🎉", "lead" matches "Lead"
    const target = opts.stage.toLowerCase();
    filtered = filtered.filter(r => getStage(r).toLowerCase().includes(target));
  }

  if (opts.excludeStages.length > 0) {
    const excludes = opts.excludeStages.map(s => s.toLowerCase());
    filtered = filtered.filter(r => {
      const stage = getStage(r).toLowerCase();
      return !excludes.some(ex => stage.includes(ex));
    });
  }

  if (opts.minAgeHours !== null) {
    const cutoff = Date.now() - (opts.minAgeHours * 60 * 60 * 1000);
    filtered = filtered.filter(r => {
      const changed = getStageChanged(r);
      if (!changed) return true; // no timestamp = keep it
      return new Date(changed).getTime() <= cutoff;
    });
  }

  return filtered;
}

function formatGrouped(records, jsonMode) {
  const byStage = new Map();
  let totalValue = 0;
  let currency = 'EUR';

  for (const record of records) {
    const name = getName(record);
    const stage = getStage(record);
    const value = getValue(record);
    totalValue += value.amount;
    currency = value.currency || currency;

    if (!byStage.has(stage)) {
      byStage.set(stage, { stage, count: 0, totalValue: 0, deals: [] });
    }

    const bucket = byStage.get(stage);
    bucket.count += 1;
    bucket.totalValue += value.amount;
    bucket.deals.push({
      name,
      value: value.amount,
      currency: value.currency,
    });
  }

  const stages = [...byStage.values()]
    .sort((a, b) => b.totalValue - a.totalValue || a.stage.localeCompare(b.stage));

  const result = {
    totalDeals: records.length,
    totalValue,
    currency,
    stages: stages.map(s => ({
      stage: s.stage,
      count: s.count,
      totalValue: s.totalValue,
      deals: s.deals.sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`${result.totalDeals} deals · ${fmtMoney(result.totalValue, result.currency)} total\n`);

  for (const stage of result.stages) {
    console.log(`${stage.stage} (${stage.count}) — ${fmtMoney(stage.totalValue, result.currency)}`);
    for (const deal of stage.deals) {
      console.log(`  • ${deal.name} · ${fmtMoney(deal.value, deal.currency)}`);
    }
    console.log('');
  }
}

function formatFlat(records, jsonMode) {
  const deals = records.map(r => ({
    name: getName(r),
    stage: getStage(r),
    value: getValue(r),
  }));

  if (jsonMode) {
    console.log(JSON.stringify({ totalDeals: deals.length, deals }, null, 2));
    return;
  }

  for (const deal of deals.sort((a, b) => a.stage.localeCompare(b.stage) || a.name.localeCompare(b.name))) {
    console.log(`${deal.name} · ${deal.stage} · ${fmtMoney(deal.value.amount, deal.value.currency)}`);
  }
}

function formatNames(records, jsonMode) {
  const names = records.map(r => getName(r)).sort();

  if (jsonMode) {
    console.log(JSON.stringify({ totalDeals: names.length, names }, null, 2));
    return;
  }

  console.log(names.join('\n'));
}

const opts = parseArgs();

try {
  const deals = await fetchAllDeals();
  const filtered = filterDeals(deals, opts);

  if (filtered.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ totalDeals: 0, deals: [] }));
    } else {
      console.log('No deals found matching criteria.');
    }
    process.exit(0);
  }

  switch (opts.format) {
    case 'flat':
      formatFlat(filtered, opts.json);
      break;
    case 'names':
      formatNames(filtered, opts.json);
      break;
    case 'grouped':
    default:
      formatGrouped(filtered, opts.json);
      break;
  }
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
