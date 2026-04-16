#!/usr/bin/env node

/**
 * slack-channel-reader.mjs
 *
 * Read recent messages from a Slack channel via the Slack Web API.
 * Lightweight alternative for heartbeat/cron contexts where the
 * agent slack tool isn't available.
 *
 * Usage:
 *   node slack-channel-reader.mjs --channel C0ANLG7P290 [--limit 10] [--since "2h"] [--bot-only] [--json] [--token $SLACK_BOT_TOKEN]
 *
 * Flags:
 *   --channel    Slack channel ID (required)
 *   --limit      Max messages to fetch (default: 15)
 *   --since      Only messages newer than this (e.g. "30m", "2h", "1d", "2026-04-16T09:00:00Z")
 *   --bot-only   Only show bot/app messages (useful for agent channels)
 *   --human-only Only show human messages
 *   --json       Output raw JSON
 *   --token      Bot token (or set SLACK_BOT_TOKEN env var)
 *
 * Requires: SLACK_BOT_TOKEN env var or --token flag
 * Zero dependencies — uses only Node.js built-in fetch (Node 18+).
 */

import { parseArgs } from 'node:util';

// ─── Time helpers ────────────────────────────────────────────────────

function parseSince(since) {
  const now = Date.now() / 1000;
  const match = since.match(/^(\d+)(m|h|d)$/);
  if (match) {
    const [, val, unit] = match;
    const mult = { m: 60, h: 3600, d: 86400 };
    return now - (parseInt(val) * mult[unit]);
  }
  // ISO date string
  const ts = Date.parse(since);
  if (!isNaN(ts)) return ts / 1000;
  return null;
}

function formatTime(ts) {
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts) {
  const d = new Date(parseFloat(ts) * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ─── Slack API ───────────────────────────────────────────────────────

async function fetchMessages(token, channelId, limit, oldest) {
  const params = new URLSearchParams({
    channel: channelId,
    limit: String(limit),
    inclusive: 'true',
  });
  if (oldest) params.set('oldest', String(oldest));

  const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data.messages || [];
}

async function fetchUsers(token) {
  const res = await fetch('https://slack.com/api/users.list?limit=200', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const data = await res.json();
  if (!data.ok) return {};
  const map = {};
  for (const u of data.members || []) {
    map[u.id] = u.name;
  }
  return map;
}

// ─── Formatting ──────────────────────────────────────────────────────

function formatMessage(msg, users, showBotOnly, showHumanOnly) {
  const isBot = msg.subtype === 'bot_message' || msg.bot_id;
  if (showBotOnly && !isBot) return null;
  if (showHumanOnly && isBot) return null;

  const who = isBot
    ? (msg.username || msg.bot_id || 'bot')
    : (users[msg.user] || msg.user || 'unknown');

  const time = `${formatDate(msg.ts)} ${formatTime(msg.ts)}`;
  const text = (msg.text || '').replace(/\n/g, ' ').slice(0, 300);

  return { who, isBot, time, text, ts: msg.ts };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string', short: 'c' },
      limit: { type: 'string', short: 'l', default: '15' },
      since: { type: 'string', short: 's' },
      'bot-only': { type: 'boolean', default: false },
      'human-only': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      token: { type: 'string', short: 't' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`slack-channel-reader.mjs — Read recent Slack channel messages\n
Usage:
  node slack-channel-reader.mjs --channel C0ANLG7P290 [--limit 15] [--since "2h"] [--bot-only] [--json]

Flags:
  --channel, -c    Slack channel ID (required)
  --limit, -l      Max messages (default: 15)
  --since, -s      Time filter: "30m", "2h", "1d", or ISO timestamp
  --bot-only       Only bot messages
  --human-only     Only human messages
  --json           Raw JSON output
  --token, -t      Bot token (or SLACK_BOT_TOKEN env var)
  --help           Show this help`);
    process.exit(0);
  }

  const token = values.token || process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('Error: No Slack bot token. Set SLACK_BOT_TOKEN or use --token');
    process.exit(1);
  }

  if (!values.channel) {
    console.error('Error: --channel is required');
    process.exit(1);
  }

  const limit = parseInt(values.limit) || 15;
  const oldest = values.since ? parseSince(values.since) : null;

  try {
    const [messages, users] = await Promise.all([
      fetchMessages(token, values.channel, limit, oldest),
      fetchUsers(token),
    ]);

    if (values.json) {
      console.log(JSON.stringify(messages, null, 2));
      return;
    }

    if (messages.length === 0) {
      console.log('No messages found.');
      return;
    }

    const formatted = messages
      .map(m => formatMessage(m, users, values['bot-only'], values['human-only']))
      .filter(Boolean);

    if (formatted.length === 0) {
      console.log('No messages match the filter.');
      return;
    }

    console.log(`📂 ${formatted.length} message${formatted.length > 1 ? 's' : ''} in ${values.channel}\n`);
    for (const m of formatted) {
      const prefix = m.isBot ? '🤖' : '👤';
      console.log(`${prefix} [${m.time}] ${m.who}:`);
      console.log(`   ${m.text}`);
      console.log();
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
