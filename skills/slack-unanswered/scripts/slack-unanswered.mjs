#!/usr/bin/env node

/**
 * slack-unanswered.mjs
 *
 * Find unanswered messages in a Slack channel — detects dropped questions,
 * missed mentions, and messages with no replies or reactions within a
 * configurable time window.
 *
 * Uses the Slack Web API to:
 *   1. Fetch recent messages from a channel
 *   2. Check each for thread replies and reactions
 *   3. Flag messages that look like questions or explicit mentions
 *      but received no response
 *
 * Usage:
 *   node slack-unanswered.mjs --channel C0ANLG7P290 [--since "4h"] [--min-age "30m"] [--json]
 *
 * Flags:
 *   --channel     Slack channel ID (required)
 *   --since       Look back this far for messages (default: "8h")
 *   --min-age     Minimum age a message must be before flagging (default: "30m")
 *   --question    Only flag messages that look like questions (default: false)
 *   --human-only  Only check human-sent messages (default: true)
 *   --json        Output raw JSON
 *   --token       Bot token (or set SLACK_BOT_TOKEN env var)
 *   --limit       Max messages to scan (default: 50)
 *   --verbose     Show all messages, not just unanswered
 *   --help        Show help
 *
 * Requires: SLACK_BOT_TOKEN env var or --token flag
 * Zero dependencies — uses only Node.js built-in fetch (Node 18+).
 */

import { parseArgs } from 'node:util';

// ─── Time helpers ────────────────────────────────────────────────────

function parseDuration(dur) {
  const match = dur.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const [, val, unit] = match;
  const mult = { m: 60, h: 3600, d: 86400 };
  return parseInt(val) * mult[unit];
}

function formatAge(secondsAgo) {
  if (secondsAgo < 60) return 'just now';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  if (secondsAgo < 86400) {
    const h = Math.floor(secondsAgo / 3600);
    const m = Math.floor((secondsAgo % 3600) / 60);
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }
  return `${Math.floor(secondsAgo / 86400)}d ago`;
}

function formatTimestamp(ts) {
  const d = new Date(parseFloat(ts) * 1000);
  return d.toLocaleString('en-GB', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Question detection ─────────────────────────────────────────────

function looksLikeQuestion(text) {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  // Ends with question mark
  if (t.endsWith('?')) return true;
  // Starts with question words
  if (/^(what|who|where|when|why|how|can|could|would|should|is|are|do|does|did|has|have|will|shall|anyone|any|anybody)\b/.test(t)) return true;
  return false;
}

// ─── Slack API ───────────────────────────────────────────────────────

async function slackApi(token, method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  return data;
}

async function fetchMessages(token, channelId, limit, oldestTs) {
  const data = await slackApi(token, 'conversations.history', {
    channel: channelId,
    limit: String(limit),
    oldest: oldestTs ? String(oldestTs) : undefined,
    inclusive: 'true',
  });
  return data.messages || [];
}

async function fetchThreadReplies(token, channelId, threadTs) {
  const data = await slackApi(token, 'conversations.replies', {
    channel: channelId,
    ts: threadTs,
    limit: '10',
  });
  // The parent message is included, so >1 means there are replies
  return (data.messages || []).length - 1;
}

async function fetchUsers(token) {
  const data = await slackApi(token, 'users.list', { limit: '200' });
  const map = {};
  for (const u of data.members || []) {
    map[u.id] = { name: u.name, displayName: u.profile?.display_name || u.name };
  }
  return map;
}

// ─── Message analysis ───────────────────────────────────────────────

function isHuman(msg) {
  return !msg.bot_id && msg.subtype !== 'bot_message';
}

function isBot(msg) {
  return !!(msg.bot_id || msg.subtype === 'bot_message');
}

function hasReactions(msg) {
  return (msg.reactions || []).length > 0;
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      channel: { type: 'string', short: 'c' },
      since: { type: 'string', short: 's', default: '8h' },
      'min-age': { type: 'string', default: '30m' },
      question: { type: 'boolean', default: false },
      'human-only': { type: 'boolean', default: true },
      'include-bots': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      token: { type: 'string', short: 't' },
      limit: { type: 'string', short: 'l', default: '50' },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`slack-unanswered.mjs — Find unanswered Slack messages

Usage:
  node slack-unanswered.mjs --channel C0ANLG7P290 [--since "4h"] [--min-age "30m"]

Flags:
  --channel, -c       Slack channel ID (required)
  --since, -s         How far back to look (default: "8h")
  --min-age           Min age before flagging a message (default: "30m")
  --question          Only flag question-like messages
  --human-only        Only check human messages (default: true)
  --include-bots      Include bot messages (overrides --human-only)
  --json              JSON output
  --limit, -l         Max messages to scan (default: 50)
  --verbose           Show all messages with their status
  --token, -t         Bot token (or SLACK_BOT_TOKEN env var)
  --help              Show this help

Output:
  Lists messages that have no thread replies AND no reactions,
  sorted oldest first. Each entry shows sender, time, age, and
  whether it looks like a question.

Exit codes:
  0 — success (may or may not have unanswered messages)
  1 — error`);
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

  const sinceSec = parseDuration(values.since);
  if (!sinceSec) {
    console.error(`Error: Invalid --since duration "${values.since}". Use format like "30m", "4h", "1d"`);
    process.exit(1);
  }

  const minAgeSec = parseDuration(values['min-age']);
  if (!minAgeSec) {
    console.error(`Error: Invalid --min-age duration "${values['min-age']}"`);
    process.exit(1);
  }

  const limit = parseInt(values.limit) || 50;
  const humanOnly = values['human-only'] && !values['include-bots'];
  const now = Date.now() / 1000;
  const oldestTs = now - sinceSec;
  const minAgeTs = now - minAgeSec;

  // Filter out file-only messages, join/leave, etc.
  const skipSubtypes = new Set([
    'channel_join', 'channel_leave', 'channel_topic',
    'channel_purpose', 'channel_name', 'group_join',
    'group_leave', 'bot_add', 'bot_remove',
    'message_changed', 'message_deleted', 'message_replied',
  ]);

  try {
    const [messages, users] = await Promise.all([
      fetchMessages(token, values.channel, limit, oldestTs),
      fetchUsers(token),
    ]);

    if (messages.length === 0) {
      if (values.json) {
        console.log(JSON.stringify({ channel: values.channel, unanswered: [], total: 0 }, null, 2));
      } else {
        console.log('No messages found in the time window.');
      }
      return;
    }

    // Filter messages
    const candidates = messages.filter(msg => {
      // Skip system subtypes
      if (skipSubtypes.has(msg.subtype)) return false;
      // Skip very new messages (might still get replies)
      if (parseFloat(msg.ts) > minAgeTs) return false;
      // Skip if only human messages wanted and this is a bot
      if (humanOnly && isBot(msg)) return false;
      // Skip deleted/hidden
      if (msg.hidden) return false;
      return true;
    });

    // Sort oldest first
    candidates.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    // Check each candidate for replies and reactions
    const results = [];
    for (const msg of candidates) {
      const question = looksLikeQuestion(msg.text);
      if (values.question && !question) continue;

      const replied = (msg.reply_count || 0) > 0;
      const reacted = hasReactions(msg);

      // If verbose or unanswered, include
      const answered = replied || reacted;
      if (!values.verbose && answered) continue;

      // For unanswered, optionally fetch actual thread count as double-check
      // (reply_count from history can sometimes be stale)
      let replyCount = msg.reply_count || 0;
      if (!replied && !reacted && candidates.length <= 30) {
        // Only do the extra API call for small result sets to avoid rate limits
        try {
          replyCount = await fetchThreadReplies(token, values.channel, msg.ts);
        } catch {
          // Rate limited or other error — trust the history data
        }
      }

      const hasRepliesAfterCheck = replyCount > 0;
      if (!values.verbose && hasRepliesAfterCheck) continue;

      const sender = isBot(msg)
        ? (msg.username || 'bot')
        : (users[msg.user]?.displayName || users[msg.user]?.name || msg.user || 'unknown');

      const ageSec = now - parseFloat(msg.ts);
      const text = (msg.text || '').replace(/\n/g, ' ').slice(0, 200);
      const reactionEmoji = (msg.reactions || []).map(r => r.name).join(', ');

      results.push({
        ts: msg.ts,
        sender,
        isBot: isBot(msg),
        text,
        question,
        replies: Math.max(replyCount, msg.reply_count || 0),
        reactions: reactionEmoji || null,
        age: formatAge(ageSec),
        ageSec,
        answered: hasRepliesAfterCheck || reacted,
        time: formatTimestamp(msg.ts),
      });
    }

    if (values.json) {
      console.log(JSON.stringify({
        channel: values.channel,
        window: values.since,
        minAge: values['min-age'],
        total: messages.length,
        scanned: candidates.length,
        unanswered: results.filter(r => !r.answered),
        all: values.verbose ? results : undefined,
      }, null, 2));
      return;
    }

    const unanswered = results.filter(r => !r.answered);

    if (values.verbose) {
      console.log(`📋 Message scan: ${values.channel} (last ${values.since})`);
      console.log(`   ${messages.length} total, ${candidates.length} scanned, ${unanswered.length} unanswered\n`);
      for (const r of results) {
        const status = r.answered ? '✅' : '❌';
        const qTag = r.question ? '❓' : '  ';
        const botTag = r.isBot ? '🤖' : '👤';
        console.log(`${status} ${qTag} ${botTag} [${r.time}] ${r.sender}:`);
        console.log(`     ${r.text}`);
        if (r.replies) console.log(`     ↳ ${r.replies} replies`);
        if (r.reactions) console.log(`     ↳ reactions: ${r.reactions}`);
        console.log();
      }
      return;
    }

    if (unanswered.length === 0) {
      console.log(`✅ No unanswered messages in ${values.channel} (last ${values.since})`);
      return;
    }

    console.log(`🔍 ${unanswered.length} unanswered message${unanswered.length > 1 ? 's' : ''} in ${values.channel} (last ${values.since})\n`);
    for (const r of unanswered) {
      const qTag = r.question ? '❓' : '💬';
      const botTag = r.isBot ? '🤖' : '👤';
      console.log(`${qTag} ${botTag} [${r.time}, ${r.age}] ${r.sender}:`);
      console.log(`   ${r.text}`);
      console.log();
    }

  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
