import { attioRequest } from './attio-client.mjs';

function getName(record) {
  return record?.values?.name?.[0]?.value || 'Untitled deal';
}

function getStageEntry(record) {
  return record?.values?.stage?.[0] || null;
}

function getStageTitle(record) {
  return getStageEntry(record)?.status?.title || 'Unknown';
}

function getValue(record) {
  const raw = record?.values?.value?.[0];
  if (!raw) return { amount: 0, currency: 'EUR' };
  return {
    amount: Number(raw.currency_value ?? raw.value ?? 0),
    currency: raw.currency_code || 'EUR',
  };
}

function getCompanyId(record) {
  return record?.values?.associated_company?.[0]?.target_record_id || null;
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

async function fetchAllRecords(objectSlug) {
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await attioRequest(`/v2/objects/${objectSlug}/records/query`, {
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

function hoursSince(iso) {
  const then = new Date(iso).getTime();
  return (Date.now() - then) / (1000 * 60 * 60);
}

function buildCompanyLookup(companies) {
  const map = new Map();
  for (const company of companies) {
    const id = company?.id?.record_id || null;
    const name = company?.values?.name?.[0]?.value || null;
    if (id && name) map.set(id, name);
  }
  return map;
}

function collectRecentStageChanges(records, companyLookup, withinHours = 24) {
  return records
    .map(record => {
      const stage = getStageEntry(record);
      const changedAt = stage?.active_from || null;
      const value = getValue(record);
      const companyId = getCompanyId(record);
      return {
        name: getName(record),
        company: companyId ? companyLookup.get(companyId) || null : null,
        stage: getStageTitle(record),
        changedAt,
        hoursAgo: changedAt ? hoursSince(changedAt) : null,
        value: value.amount,
        currency: value.currency,
        webUrl: record?.web_url || null,
      };
    })
    .filter(deal => deal.changedAt && deal.hoursAgo !== null && deal.hoursAgo >= 0 && deal.hoursAgo <= withinHours)
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
}

function groupByStage(changes) {
  const grouped = new Map();
  for (const change of changes) {
    if (!grouped.has(change.stage)) {
      grouped.set(change.stage, { stage: change.stage, count: 0, totalValue: 0, deals: [] });
    }
    const bucket = grouped.get(change.stage);
    bucket.count += 1;
    bucket.totalValue += change.value;
    bucket.deals.push(change);
  }
  return [...grouped.values()].sort((a, b) => b.totalValue - a.totalValue || b.count - a.count || a.stage.localeCompare(b.stage));
}

function formatDealLine(deal) {
  const when = `${Math.max(0, Math.round(deal.hoursAgo))}h ago`;
  const label = deal.company && deal.company !== deal.name ? `${deal.name} (${deal.company})` : deal.name;
  const name = deal.webUrl ? `<${deal.webUrl}|${label}>` : label;
  return `• ${name} · ${fmtMoney(deal.value, deal.currency)} · ${when}`;
}

function formatSlackReport(changes, withinHours = 24) {
  if (changes.length === 0) {
    return `No deal stage changes in the last ${withinHours} hours.`;
  }

  const totalValue = changes.reduce((sum, d) => sum + d.value, 0);
  const grouped = groupByStage(changes);
  const lines = [
    `*Attio daily stage changes*`,
    `${changes.length} deal${changes.length === 1 ? '' : 's'} changed stage in the last ${withinHours} hours · ${fmtMoney(totalValue, changes[0]?.currency || 'EUR')}`,
    '',
  ];

  for (const group of grouped) {
    lines.push(`*${group.stage}* — ${group.count} deal${group.count === 1 ? '' : 's'} · ${fmtMoney(group.totalValue, changes[0]?.currency || 'EUR')}`);
    for (const deal of group.deals) {
      lines.push(formatDealLine(deal));
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

const jsonMode = process.argv.includes('--json');
const hoursArg = process.argv.find(arg => arg.startsWith('--hours='));
const withinHours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;

try {
  const [deals, companies] = await Promise.all([
    fetchAllRecords('deals'),
    fetchAllRecords('companies'),
  ]);
  const companyLookup = buildCompanyLookup(companies);
  const changes = collectRecentStageChanges(deals, companyLookup, withinHours);

  if (jsonMode) {
    console.log(JSON.stringify({ withinHours, count: changes.length, changes, message: formatSlackReport(changes, withinHours) }, null, 2));
  } else {
    console.log(formatSlackReport(changes, withinHours));
  }
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: err.status || null,
    error: err.body || String(err.message || err),
  }, null, 2));
  process.exit(1);
}
