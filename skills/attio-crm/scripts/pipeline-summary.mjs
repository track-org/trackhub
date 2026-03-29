import { attioRequest } from './attio-client.mjs';

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

function summarize(records) {
  const byStage = new Map();
  let totalValue = 0;
  let currency = 'EUR';

  for (const record of records) {
    const name = getName(record);
    const stage = getStage(record);
    const value = getValue(record);
    const companyId = getCompany(record);
    totalValue += value.amount;
    currency = value.currency || currency;

    if (!byStage.has(stage)) {
      byStage.set(stage, {
        stage,
        count: 0,
        totalValue: 0,
        deals: [],
      });
    }

    const bucket = byStage.get(stage);
    bucket.count += 1;
    bucket.totalValue += value.amount;
    bucket.deals.push({
      name,
      value: value.amount,
      currency: value.currency,
      companyId,
    });
  }

  const stages = [...byStage.values()]
    .sort((a, b) => b.totalValue - a.totalValue || b.count - a.count || a.stage.localeCompare(b.stage))
    .map(stage => ({
      ...stage,
      deals: stage.deals.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)),
    }));

  return {
    totalDeals: records.length,
    totalValue,
    currency,
    stages,
  };
}

function printSummary(summary) {
  console.log(`Pipeline summary`);
  console.log(`Total deals: ${summary.totalDeals}`);
  console.log(`Total value: ${fmtMoney(summary.totalValue, summary.currency)}`);
  console.log('');

  for (const stage of summary.stages) {
    console.log(`${stage.stage}: ${stage.count} deal${stage.count === 1 ? '' : 's'} · ${fmtMoney(stage.totalValue, summary.currency)}`);
    for (const deal of stage.deals.slice(0, 10)) {
      console.log(`  - ${deal.name} · ${fmtMoney(deal.value, deal.currency)}`);
    }
    if (stage.deals.length > 10) {
      console.log(`  ... ${stage.deals.length - 10} more`);
    }
    console.log('');
  }
}

const jsonMode = process.argv.includes('--json');

try {
  const deals = await fetchAllDeals();
  const summary = summarize(deals);

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSummary(summary);
  }
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
