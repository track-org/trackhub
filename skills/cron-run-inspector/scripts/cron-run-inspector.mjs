#!/usr/bin/env node

/**
 * cron-run-inspector.mjs — Deep-dive inspection of a single cron run.
 *
 * Fetches the run's metadata from `openclaw cron runs`, then pulls the full
 * session transcript via `sessions_history` (or `openclaw session history`).
 * Outputs a structured debugging report: timing, token usage, tool calls,
 * errors, and the agent's reasoning chain.
 *
 * Zero external dependencies. Node.js 18+ (built-in fetch).
 *
 * Usage:
 *   node cron-run-inspector.mjs --job-id <id> [--run-index 0] [--raw]
 *   node cron-run-inspector.mjs --session-key <key> [--raw]
 *   node cron-run-inspector.mjs --session-id <uuid> [--raw]
 *
 * Flags:
 *   --job-id <id>       Cron job UUID (fetches latest run by default)
 *   --run-index <n>     Which run to inspect (0 = latest, default: 0)
 *   --session-key <key> Direct session key (skip cron runs lookup)
 *   --session-id <uuid> Session UUID (auto-resolves session key)
 *   --raw               Output raw JSON instead of formatted report
 *   --no-transcript     Skip transcript fetch (metadata only)
 *   --tool-calls-only   Only show tool calls from the transcript
 *   --errors-only       Only show errors/failures from the transcript
 *   --json              Alias for --raw
 */

import { execSync } from "child_process";

// ── Helpers ──────────────────────────────────────────────────────────────────

function shellExec(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
    return { ok: true, data: out.trim() };
  } catch (e) {
    return { ok: false, data: e.stderr?.trim() || e.message };
  }
}

function parseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

function formatTimestamp(ms) {
  return new Date(ms).toLocaleString("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function estimateCost(tokens, model) {
  // Very rough per-MToken estimates (USD)
  const pricing = {
    "glm-5-turbo": 0.30,
    "glm-5": 2.00,
    "gpt-4o": 2.50,
    "gpt-4o-mini": 0.15,
    "claude-3.5-sonnet": 3.00,
    "claude-3-haiku": 0.25,
    "claude-sonnet-4-20250514": 3.00,
  };
  const rate = pricing[model] || 1.00; // fallback $1/MTok
  return ((tokens / 1_000_000) * rate).toFixed(4);
}

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--raw" || flag === "--json") args.raw = true;
    else if (flag === "--no-transcript") args.noTranscript = true;
    else if (flag === "--tool-calls-only") args.toolCallsOnly = true;
    else if (flag === "--errors-only") args.errorsOnly = true;
    else if (argv[i + 1]) {
      const key = flag.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i];
    }
  }
  return args;
}

// ── Fetch run metadata ──────────────────────────────────────────────────────

function getRunMetadata(jobId, runIndex = 0) {
  const result = shellExec(`openclaw cron runs --id ${jobId} --limit ${runIndex + 1}`);
  if (!result.ok) return null;
  const data = parseJson(result.data);
  if (!data?.entries?.length) return null;
  return data.entries[runIndex] || data.entries[data.entries.length - 1];
}

// ── Fetch session transcript ────────────────────────────────────────────────

function getTranscript(sessionKey, options = {}) {
  // Try sessions_history via openclaw CLI
  const result = shellExec(
    `openclaw session history --key "${sessionKey}" --limit 50`,
    { timeout: 20000 }
  );

  if (result.ok) {
    const data = parseJson(result.data);
    if (data?.messages) return data.messages;
  }

  // Fallback: try to read from the session log file
  const logResult = shellExec(`openclaw session log --key "${sessionKey}" 2>/dev/null || true`);
  if (logResult.ok && logResult.data) {
    return [{ role: "log", content: logResult.data }];
  }

  return null;
}

// ── Analyze transcript ──────────────────────────────────────────────────────

function analyzeTranscript(messages, options = {}) {
  const analysis = {
    turns: 0,
    toolCalls: [],
    errors: [],
    models: new Set(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    firstMessage: null,
    lastMessage: null,
    hasThinking: false,
  };

  if (!messages || !Array.isArray(messages)) return analysis;

  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") analysis.turns++;

    // Track models
    if (msg.model) analysis.models.add(msg.model);
    if (msg.provider) analysis.models.add(`${msg.provider}/${msg.model}`);

    // Track tokens
    if (msg.usage) {
      analysis.totalInputTokens += msg.usage.input_tokens || 0;
      analysis.totalOutputTokens += msg.usage.output_tokens || 0;
    }

    // Track timestamps
    if (msg.timestamp && !analysis.firstMessage) {
      analysis.firstMessage = new Date(msg.timestamp);
    }
    if (msg.timestamp) {
      analysis.lastMessage = new Date(msg.timestamp);
    }

    // Extract tool calls
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (block.type === "toolCall") {
        analysis.toolCalls.push({
          name: block.name,
          args: block.arguments,
          timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString().slice(11, 19) : null,
        });
      }
      if (block.type === "toolResult" && block.isError) {
        analysis.errors.push({
          toolName: block.toolCallId?.slice(0, 12) || "unknown",
          error: typeof block.content === "string" ? block.content.slice(0, 200) : "error result",
          timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString().slice(11, 19) : null,
        });
      }
      if (block.type === "thinking") {
        analysis.hasThinking = true;
      }
    }
  }

  // Deduplicate models
  analysis.models = [...analysis.models];
  return analysis;
}

// ── Format report ───────────────────────────────────────────────────────────

function formatReport(run, analysis) {
  const lines = [];

  lines.push("═".repeat(60));
  lines.push("📋 CRON RUN INSPECTOR");
  lines.push("═".repeat(60));
  lines.push("");

  // Run metadata
  lines.push("▶ RUN METADATA");
  lines.push(`  Job ID:     ${run.jobId?.slice(0, 12)}…`);
  lines.push(`  Run time:   ${formatTimestamp(run.runAtMs)}`);
  lines.push(`  Duration:   ${formatDuration(run.durationMs)}`);
  lines.push(`  Status:     ${run.status === "ok" ? "✅ OK" : "❌ FAILED"}`);
  lines.push(`  Delivered:  ${run.delivered ? "✅ Yes" : "❌ No"} (${run.deliveryStatus || "unknown"})`);
  lines.push(`  Model:      ${run.provider}/${run.model}`);
  lines.push(`  Session ID: ${run.sessionId?.slice(0, 12)}…`);
  lines.push("");

  // Token usage
  if (run.usage) {
    lines.push("▶ TOKEN USAGE");
    lines.push(`  Input:      ${formatTokens(run.usage.input_tokens)} tokens`);
    lines.push(`  Output:     ${formatTokens(run.usage.output_tokens)} tokens`);
    lines.push(`  Total:      ${formatTokens(run.usage.total_tokens)} tokens`);
    lines.push(`  Est. cost:  ~$${estimateCost(run.usage.total_tokens, run.model)}`);
    lines.push("");
  }

  // Summary
  if (run.summary) {
    lines.push("▶ AGENT SUMMARY");
    // Word-wrap summary
    const words = run.summary.split(" ");
    let line = "  ";
    for (const word of words) {
      if ((line + word + " ").length > 70) {
        lines.push(line.trim());
        line = "  ";
      }
      line += word + " ";
    }
    if (line.trim()) lines.push(line.trim());
    lines.push("");
  }

  if (!analysis) {
    lines.push("  (Transcript not available — run with --no-transcript to skip)");
    return lines.join("\n");
  }

  // Transcript analysis
  lines.push("▶ TRANSCRIPT ANALYSIS");
  lines.push(`  Turns:       ${analysis.turns}`);
  lines.push(`  Tool calls:  ${analysis.toolCalls.length}`);
  lines.push(`  Errors:      ${analysis.errors.length}`);
  lines.push(`  Thinking:    ${analysis.hasThinking ? "Yes" : "No"}`);

  if (analysis.firstMessage && analysis.lastMessage) {
    lines.push(`  First msg:   ${analysis.firstMessage.toLocaleTimeString("en-IE")}`);
    lines.push(`  Last msg:    ${analysis.lastMessage.toLocaleTimeString("en-IE")}`);
  }
  lines.push("");

  // Tool call timeline
  if (analysis.toolCalls.length > 0) {
    lines.push("▶ TOOL CALL TIMELINE");
    for (const tc of analysis.toolCalls) {
      const time = tc.timestamp ? `[${tc.timestamp}]` : "";
      const argsPreview = Object.entries(tc.args || {})
        .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`)
        .join(", ");
      lines.push(`  ${time} ${tc.name}(${argsPreview})`);
    }
    lines.push("");
  }

  // Errors
  if (analysis.errors.length > 0) {
    lines.push("▶ ERRORS / FAILURES");
    for (const err of analysis.errors) {
      const time = err.timestamp ? `[${err.timestamp}]` : "";
      lines.push(`  ${time} ${err.error}`);
    }
    lines.push("");
  }

  // Next run
  if (run.nextRunAtMs) {
    lines.push(`▶ NEXT SCHEDULED RUN: ${formatTimestamp(run.nextRunAtMs)}`);
  }

  lines.push("");
  lines.push("═".repeat(60));
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);

let run = null;
let sessionKey = null;

// Determine session key
if (args.sessionKey) {
  sessionKey = args.sessionKey;
} else if (args.sessionId) {
  // Try to find the session key from a job's runs
  // If jobId provided, search there; otherwise try direct
  if (args.jobId) {
    run = getRunMetadata(args.jobId, parseInt(args.runIndex || "0", 10));
    if (run?.sessionKey) sessionKey = run.sessionKey;
  }
  // If no match from job runs, construct a likely session key pattern
  if (!sessionKey && args.sessionId) {
    // Can't reliably construct, inform user
    console.error(`Error: Could not resolve session key from session-id "${args.sessionId}". Provide --job-id or --session-key directly.`);
    process.exit(1);
  }
} else if (args.jobId) {
  const idx = parseInt(args.runIndex || "0", 10);
  run = getRunMetadata(args.jobId, idx);
  if (!run) {
    console.error(`Error: No run found for job ${args.jobId} at index ${idx}.`);
    process.exit(1);
  }
  sessionKey = run.sessionKey;
} else {
  console.error("Usage: cron-run-inspector.mjs --job-id <id> [--run-index 0]");
  console.error("       cron-run-inspector.mjs --session-key <key>");
  console.error("       cron-run-inspector.mjs --session-id <uuid> --job-id <id>");
  process.exit(1);
}

// Fetch transcript
let analysis = null;
if (!args.noTranscript && sessionKey) {
  const messages = getTranscript(sessionKey);
  analysis = analyzeTranscript(messages, args);
}

// If we only have sessionKey and no run metadata, build a minimal run object
if (!run) {
  run = {
    jobId: "unknown",
    runAtMs: analysis?.firstMessage?.getTime() || Date.now(),
    durationMs: analysis?.firstMessage && analysis?.lastMessage
      ? analysis.lastMessage.getTime() - analysis.firstMessage.getTime()
      : 0,
    status: analysis?.errors?.length > 0 ? "has-errors" : "ok",
    delivered: false,
    deliveryStatus: "unknown",
    model: analysis?.models?.[0]?.split("/").pop() || "unknown",
    provider: analysis?.models?.[0]?.split("/")[0] || "unknown",
    usage: analysis ? {
      input_tokens: analysis.totalInputTokens,
      output_tokens: analysis.totalOutputTokens,
      total_tokens: analysis.totalInputTokens + analysis.totalOutputTokens,
    } : null,
    summary: "(direct session key — no cron run metadata)",
    sessionKey,
    sessionId: sessionKey.split(":run:").pop()?.split(":")[0] || "unknown",
  };
}

if (args.raw) {
  console.log(JSON.stringify({ run, analysis }, null, 2));
} else {
  console.log(formatReport(run, analysis));
}
