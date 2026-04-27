#!/usr/bin/env node
// credential-remediation.cjs — Actionable fix steps for failed credentials
// Zero dependencies. Node.js 18+.
// Pairs with credential-health (detection) and graceful-degradation (response).

'use strict';

const remediationDB = [
  // Gmail / Google OAuth
  {
    service: 'gmail',
    keywords: ['refresh token', 'invalid', 'revoked', 'expired', 'oauth', 'google', 'gmail'],
    error_patterns: ['Bad Request', 'invalid_grant', 'token expired', 'refresh token'],
    severity: 'high',
    title: 'Gmail OAuth Refresh Token Invalid or Revoked',
    steps: [
      'Re-run the OAuth consent flow to get a fresh refresh token.',
      'If using a GCP service account, verify the JSON key file exists and is readable.',
      'Check that the OAuth client ID/secret in your config matches the GCP console.',
      'If the token was revoked, the user must re-authorize the app at: https://accounts.google.com/o/oauth2/v2/auth',
      'After re-auth, update the token file with the new credentials.',
      'Verify with: node credential-health.cjs --check gmail-file',
    ],
    env_vars: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
    docs_url: 'https://developers.google.com/identity/protocols/oauth2',
  },
  {
    service: 'gmail',
    keywords: ['credential', 'file', 'not found', 'ENOENT', 'no such file'],
    error_patterns: ['ENOENT', 'no such file', 'cannot find'],
    severity: 'medium',
    title: 'Gmail Credential File Missing',
    steps: [
      'Locate or recreate the Gmail OAuth token file (usually tokens/gmail.json or similar).',
      'Ensure the path in your config matches the actual file location.',
      'If the file was deleted, re-run the OAuth flow to generate a new one.',
    ],
    env_vars: ['GMAIL_TOKEN_FILE'],
    docs_url: 'https://developers.google.com/gmail/api/auth/about-authorization',
  },

  // Slack
  {
    service: 'slack',
    keywords: ['slack', 'bot token', 'xoxb', 'invalid_auth', 'token_expired'],
    error_patterns: ['invalid_auth', 'token_expired', 'account_inactive', 'not_authed'],
    severity: 'high',
    title: 'Slack Bot Token Invalid or Expired',
    steps: [
      'Check if the bot was removed from the workspace or the token was regenerated.',
      'Regenerate the token at: https://api.slack.com/apps → Your App → OAuth & Permissions.',
      'Ensure the bot is invited to any private channels it needs to read.',
      'Update the SLACK_BOT_TOKEN env var or config file.',
      'Verify with: node credential-health.cjs --check slack-token',
    ],
    env_vars: ['SLACK_BOT_TOKEN'],
    docs_url: 'https://api.slack.com/authentication/token-types',
  },

  // Attio CRM
  {
    service: 'attio',
    keywords: ['attio', 'api key', 'unauthorized', 'forbidden'],
    error_patterns: ['401', '403', 'unauthorized', 'forbidden', 'invalid api key'],
    severity: 'high',
    title: 'Attio API Key Invalid',
    steps: [
      'Go to https://app.attio.com/settings/api-keys to verify or regenerate your API key.',
      'Ensure the key has the required scopes (read/write as needed).',
      'Update the ATTIO_API_KEY env var or config file.',
      'Verify with: node credential-health.cjs --check attio-api',
    ],
    env_vars: ['ATTIO_API_KEY'],
    docs_url: 'https://docs.attio.com/api/introduction',
  },

  // Supabase
  {
    service: 'supabase',
    keywords: ['supabase', 'anon key', 'service role', 'JWT', 'invalid token'],
    error_patterns: ['401', 'invalid api key', 'JWT expired', 'unauthorized'],
    severity: 'high',
    title: 'Supabase API Key Invalid',
    steps: [
      'Check your project settings at https://supabase.com/dashboard → Project Settings → API.',
      'Verify the anon key or service role key matches what\'s in your config.',
      'If using a service role key, ensure it hasn\'t been rotated without updating your config.',
      'Update the SUPABASE_URL and/or SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY env vars.',
      'Verify with: node credential-health.cjs --check supabase',
    ],
    env_vars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'],
    docs_url: 'https://supabase.com/docs/guides/api/api-keys',
  },

  // OpenAI / Generic API keys
  {
    service: 'openai',
    keywords: ['openai', 'api key', 'incorrect', 'invalid', 'expired'],
    error_patterns: ['incorrect api key', 'invalid api key', 'expired', '401'],
    severity: 'high',
    title: 'OpenAI API Key Invalid',
    steps: [
      'Check your API key at https://platform.openai.com/api-keys.',
      'Ensure the key is active and has sufficient credits/quota.',
      'Update the OPENAI_API_KEY env var.',
      'Verify with: node credential-health.cjs --check openai',
    ],
    env_vars: ['OPENAI_API_KEY'],
    docs_url: 'https://platform.openai.com/docs/api-reference/authentication',
  },

  // Emporia Energy
  {
    service: 'emporia',
    keywords: ['emporia', 'vue', 'energy', 'authentication', 'login'],
    error_patterns: ['401', 'unauthorized', 'login failed', 'invalid credentials'],
    severity: 'high',
    title: 'Emporia Energy Authentication Failed',
    steps: [
      'Verify your Emporia account credentials (email/password) are correct.',
      'Check if your account is active at https://app.emporiaenergy.com.',
      'If using an API key or app token, ensure it hasn\'t expired.',
      'Update the EMPORIA_EMAIL and/or EMPORIA_PASSWORD env vars.',
      'Verify with: node credential-health.cjs --check emporia',
    ],
    env_vars: ['EMPORIA_EMAIL', 'EMPORIA_PASSWORD', 'EMPORIA_API_KEY'],
    docs_url: 'https://developer.emporiaenergy.com/',
  },

  // Solis Solar
  {
    service: 'solis',
    keywords: ['solis', 'solar', 'inverter', 'token', 'login'],
    error_patterns: ['401', 'unauthorized', 'token expired', 'login failed'],
    severity: 'medium',
    title: 'Solis Cloud API Authentication Failed',
    steps: [
      'Solis tokens expire and need periodic refresh.',
      'Re-authenticate using your Solis Cloud credentials.',
      'Check if the Solis Cloud service is reachable at https://www.soliscloud.com.',
      'Update the SOLIS_TOKEN or re-run the auth flow to get a fresh token.',
      'Verify with: node credential-health.cjs --check solis',
    ],
    env_vars: ['SOLIS_API_KEY', 'SOLIS_TOKEN', 'SOLIS_USERNAME', 'SOLIS_PASSWORD'],
    docs_url: 'https://www.soliscloud.com/',
  },

  // Generic / catch-all
  {
    service: 'generic',
    keywords: ['timeout', 'ECONNREFUSED', 'ENOTFOUND', 'network', 'unreachable'],
    error_patterns: ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'network', 'unreachable', 'fetch failed'],
    severity: 'low',
    title: 'Network Connectivity Issue',
    steps: [
      'Check internet connectivity: ping 8.8.8.8 or curl https://httpbin.org/get.',
      'If behind a proxy or VPN, ensure it\'s connected.',
      'Check if the specific API endpoint is down (try opening it in a browser).',
      'DNS issues? Try: nslookup api.example.com',
      'Firewall blocking? Check outbound rules for the relevant port (443).',
      'Retry after confirming connectivity.',
    ],
    env_vars: ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'],
    docs_url: null,
  },
];

function findRemediation(serviceName, errorDetail) {
  const service = serviceName.toLowerCase();
  const detail = (errorDetail || '').toLowerCase();

  // First pass: exact service name match (highest confidence)
  for (const entry of remediationDB) {
    if (entry.service !== 'generic' && service === entry.service) {
      // If there's error detail, try to narrow to the right sub-entry
      if (detail) {
        const matchesError = entry.error_patterns.some(p => detail.includes(p.toLowerCase()));
        const matchesKeyword = entry.keywords.some(k => detail.includes(k));
        if (matchesError || matchesKeyword) return entry;
      } else {
        // No detail but exact service name — return the first match for that service
        return entry;
      }
    }
  }

  // Second pass: partial service match with keyword/error matching
  for (const entry of remediationDB) {
    if (entry.service !== 'generic' && service.includes(entry.service)) {
      const matchesError = entry.error_patterns.some(p => detail.includes(p.toLowerCase()));
      const matchesKeyword = entry.keywords.some(k => detail.includes(k));
      if (matchesError || matchesKeyword) return entry;
    }
  }

  // Third pass: keyword-only match across all services (broadest)
  if (detail) {
    for (const entry of remediationDB) {
      if (entry.service !== 'generic') {
        const matchesKeyword = entry.keywords.some(k => detail.includes(k));
        if (matchesKeyword) return entry;
      }
    }
  }

  // Third pass: generic/network patterns
  const generic = remediationDB.find(e => e.service === 'generic');
  const matchesNetwork = generic.error_patterns.some(p => detail.includes(p.toLowerCase()));
  if (matchesNetwork) return generic;

  // Fallback: unknown service
  return {
    service: serviceName,
    severity: 'medium',
    title: `Unknown Credential Issue: ${serviceName}`,
    steps: [
      `Check the configuration for ${serviceName} — ensure API keys/tokens are set and valid.`,
      'Look for any recent changes to env vars or config files.',
      'Check if the service\'s status page reports any outages.',
      'Re-run credential-health to see if it\'s a transient issue.',
      'If using an OAuth flow, the token may need refreshing — re-authenticate.',
    ],
    env_vars: [],
    docs_url: null,
  };
}

function formatOutput(result) {
  const lines = [];
  lines.push(`🔴 ${result.title}`);
  lines.push(`   Severity: ${result.severity.toUpperCase()}`);
  if (result.env_vars.length > 0) {
    lines.push(`   Env vars to check: ${result.env_vars.join(', ')}`);
  }
  lines.push('');
  lines.push('   Steps to fix:');
  result.steps.forEach((step, i) => {
    lines.push(`   ${i + 1}. ${step}`);
  });
  if (result.docs_url) {
    lines.push('');
    lines.push(`   📖 Docs: ${result.docs_url}`);
  }
  return lines.join('\n');
}

function formatJSON(result) {
  return JSON.stringify(result, null, 2);
}

// CLI
function printUsage() {
  console.log(`
credential-remediation — Actionable fix steps for failed credentials

Usage:
  node remediate.cjs --service <name> [--detail "<error message>"] [--json] [--quiet]

Flags:
  --service, -s    Service name (e.g. gmail, slack, attio, supabase, emporia, solis)
  --detail, -d     Error detail or message from credential-health (optional, improves matching)
  --json           Output as JSON
  --quiet, -q      Only output the remediation steps, no header/severity
  --help           Show this help

Examples:
  node remediate.cjs --service gmail --detail "Refresh token invalid or revoked: Bad Request"
  node remediate.cjs --service slack --json
  node remediate.cjs --service attio --detail "401 unauthorized" --quiet

Pipe from credential-health:
  node credential-health.cjs --check gmail-file --fail-only --json | node remediate.cjs --stdin
  `);
}

function parseArgs(argv) {
  const args = {
    service: null,
    detail: null,
    json: false,
    quiet: false,
    stdin: false,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--service': case '-s': args.service = argv[++i]; break;
      case '--detail': case '-d': args.detail = argv[++i]; break;
      case '--json': args.json = true; break;
      case '--quiet': case '-q': args.quiet = true; break;
      case '--stdin': args.stdin = true; break;
      case '--help': case '-h': args.help = true; break;
      default:
        if (arg.startsWith('--') && arg.includes('=')) {
          const [key, ...rest] = arg.slice(2).split('=');
          const val = rest.join('=');
          if (key === 'service') args.service = val;
          else if (key === 'detail') args.detail = val;
        }
        break;
    }
  }
  return args;
}

function parseCredentialHealthStdin(data) {
  try {
    const parsed = JSON.parse(data);
    if (parsed.results && Array.isArray(parsed.results)) {
      return parsed.results
        .filter(r => r.status === 'fail')
        .map(r => ({
          service: r.service,
          detail: r.detail || '',
        }));
    }
    return [];
  } catch {
    return [];
  }
}

// Main
function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // --stdin mode: read credential-health JSON output
  if (args.stdin) {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      const failures = parseCredentialHealthStdin(input);
      if (failures.length === 0) {
        console.log('No credential failures found in input.');
        process.exit(0);
      }
      const results = failures.map(f => findRemediation(f.service, f.detail));
      if (args.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        results.forEach((r, i) => {
          if (i > 0) console.log('\n---\n');
          console.log(formatOutput(r));
        });
      }
    });
    return;
  }

  if (!args.service) {
    console.error('Error: --service is required (or use --stdin to pipe from credential-health).');
    console.error('Run with --help for usage.');
    process.exit(1);
  }

  const result = findRemediation(args.service, args.detail);

  if (args.json) {
    console.log(formatJSON(result));
  } else if (args.quiet) {
    result.steps.forEach((step, i) => console.log(`${i + 1}. ${step}`));
    if (result.docs_url) console.log(`\nDocs: ${result.docs_url}`);
  } else {
    console.log(formatOutput(result));
  }
}

main();
