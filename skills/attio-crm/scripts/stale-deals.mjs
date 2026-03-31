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

function getCreatedAt(record) {
  return record?.values?.created_at?.[0]?.value || null;
}

function daysSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
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

function summarize(records, minDays = 14) {
  const excludedStages = new Set(['Won 🎉', 'Disqualified']);

  return records
    .map(record => {
      const createdAt = getCreatedAt(record);
      const ageDays = daysSince(createdAt);
      const value = getValue(record);
      return {
        name: getName(record),
        stage: getStage(record),
        value: value.amount,
        currency: value.currency,
        createdAt,
        ageDays,
      };
    })
    .filter(deal => !excludedStages.has(deal.stage))
    .filter(deal => deal.ageDays !== null && deal.ageDays >= minDays)
    .sort((a, b) => b.ageDays - a.ageDays || b.value - a.value || a.name.localeCompare(b.name));
}

function printDeals(deals, minDays) {
  console.log(`Stale deals (${minDays}+ days old, excluding won/disqualified)`);
  console.log(`Count: ${deals.length}`);
  console.log('');

  for (const deal of deals) {
    console.log(`- ${deal.name} · ${deal.stage} · ${fmtMoney(deal.value, deal.currency)} · ${deal.ageDays} days old`);
  }
}

const minDaysArg = process.argv.find(arg => arg.startsWith('--days='));
const minDays = minDaysArg ? Number(minDaysArg.split('=')[1]) : 14;
const jsonMode = process.argv.includes('--json');

try {
  const deals = await fetchAllDeals();
  const staleDeals = summarize(deals, minDays);

  if (jsonMode) {
    console.log(JSON.stringify({ minDays, count: staleDeals.length, deals: staleDeals }, null, 2));
  } else {
    printDeals(staleDeals, minDays);
  }
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
