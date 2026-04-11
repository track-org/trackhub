#!/usr/bin/env node
/**
 * credential-health.cjs
 *
 * Validate API credentials and tokens before they're needed.
 * Zero external dependencies. ES5 CJS for arm64 memory safety.
 *
 * Usage:
 *   node credential-health.cjs [--check gmail slack ...] [--json] [--fail-only] [--timeout N] [--generic "Name:URL:HeaderName:$ENV_VAR"]
 */

'use strict';

var https = require('https');
var http = require('http');

// ─── Minimal arg parser ──────────────────────────────────────────────

function parseArgs(argv) {
  var result = { _: [] };
  var i = 0;
  while (i < argv.length) {
    var arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      i++;
      continue;
    }
    if (arg === '--json') {
      result.json = true;
      i++;
      continue;
    }
    if (arg === '--fail-only') {
      result.failOnly = true;
      i++;
      continue;
    }
    if (arg === '--timeout') {
      result.timeout = parseInt(argv[i + 1], 10) || 5;
      i += 2;
      continue;
    }
    if (arg === '--check') {
      // All following args until next --flag are check names
      var checks = [];
      i++;
      while (i < argv.length && !argv[i].startsWith('--')) {
        checks.push(argv[i]);
        i++;
      }
      result.checks = checks;
      continue;
    }
    if (arg === '--generic') {
      result.generic = result.generic || [];
      i++;
      // Collect until next --flag
      while (i < argv.length && !argv[i].startsWith('--')) {
        result.generic.push(argv[i]);
        i++;
      }
      continue;
    }
    result._.push(arg);
    i++;
  }
  return result;
}

// ─── HTTP helper (handles both http and https) ───────────────────────

function httpRequest(urlStr, opts, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      req.destroy();
      reject(new Error('Timeout after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    var parsedUrl;
    try {
      parsedUrl = new URL(urlStr);
    } catch (e) {
      clearTimeout(timer);
      reject(new Error('Invalid URL: ' + urlStr));
      return;
    }

    var transport = parsedUrl.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    };

    var req = transport.request(reqOpts, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        clearTimeout(timer);
        resolve({ status: res.statusCode, body: body });
      });
    });

    req.on('error', function (err) {
      clearTimeout(timer);
      reject(err);
    });

    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

// ─── Service checkers ────────────────────────────────────────────────

function checkGmail(timeoutMs) {
  var token = process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_OAUTH_TOKEN;
  if (!token) {
    return Promise.resolve({ status: 'skip', detail: 'No token configured (GMAIL_ACCESS_TOKEN / GOOGLE_OAUTH_TOKEN)' });
  }
  return httpRequest('https://www.googleapis.com/oauth2/v3/userinfo', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token }
  }, timeoutMs).then(function (res) {
    if (res.status === 200) {
      try {
        var data = JSON.parse(res.body);
        return { status: 'ok', detail: 'Token valid (user: ' + (data.email || data.sub || 'unknown') + ')' };
      } catch (e) {
        return { status: 'ok', detail: 'Token valid' };
      }
    }
    if (res.status === 401) {
      return { status: 'fail', detail: 'Token expired or revoked (401)' };
    }
    return { status: 'fail', detail: 'Unexpected status ' + res.status };
  }).catch(function (err) {
    return { status: 'fail', detail: err.message };
  });
}

function checkSlack(timeoutMs) {
  var token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return Promise.resolve({ status: 'skip', detail: 'No token configured (SLACK_BOT_TOKEN)' });
  }
  return httpRequest('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/x-www-form-urlencoded' }
  }, timeoutMs).then(function (res) {
    try {
      var data = JSON.parse(res.body);
      if (data.ok) {
        return { status: 'ok', detail: 'Bot token valid (workspace: ' + (data.team || 'unknown') + ', user: ' + (data.user || 'unknown') + ')' };
      }
      return { status: 'fail', detail: 'Slack auth failed: ' + (data.error || 'unknown error') };
    } catch (e) {
      return { status: 'fail', detail: 'Invalid response from Slack' };
    }
  }).catch(function (err) {
    return { status: 'fail', detail: err.message };
  });
}

function checkAttio(timeoutMs) {
  var key = process.env.ATTIO_API_KEY;
  if (!key) {
    return Promise.resolve({ status: 'skip', detail: 'No key configured (ATTIO_API_KEY)' });
  }
  return httpRequest('https://api.attio.com/v2/objects', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + key }
  }, timeoutMs).then(function (res) {
    if (res.status === 200) {
      return { status: 'ok', detail: 'API key valid' };
    }
    if (res.status === 401 || res.status === 403) {
      return { status: 'fail', detail: 'Invalid or expired API key (' + res.status + ')' };
    }
    return { status: 'fail', detail: 'Unexpected status ' + res.status };
  }).catch(function (err) {
    return { status: 'fail', detail: err.message };
  });
}

function checkSupabase(timeoutMs) {
  var url = process.env.SUPABASE_URL;
  var key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    return Promise.resolve({ status: 'skip', detail: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
  }
  // Use OpenAPI endpoint which requires valid anon key
  var endpoint = url.replace(/\/+$/, '') + '/rest/v1/';
  return httpRequest(endpoint, {
    method: 'GET',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
  }, timeoutMs).then(function (res) {
    // Supabase returns 200 with empty array or 406 for missing Accept header — both mean auth works
    if (res.status === 200 || res.status === 406) {
      return { status: 'ok', detail: 'Project reachable, anon key valid' };
    }
    if (res.status === 401) {
      return { status: 'fail', detail: 'Invalid anon key (401)' };
    }
    if (res.status === 0 || res.status >= 500) {
      return { status: 'fail', detail: 'Project unreachable (status ' + res.status + ')' };
    }
    return { status: 'fail', detail: 'Unexpected status ' + res.status };
  }).catch(function (err) {
    return { status: 'fail', detail: err.message };
  });
}

function checkOpenAI(timeoutMs) {
  var key = process.env.OPENAI_API_KEY;
  if (!key) {
    return Promise.resolve({ status: 'skip', detail: 'No key configured (OPENAI_API_KEY)' });
  }
  return httpRequest('https://api.openai.com/v1/models', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + key }
  }, timeoutMs).then(function (res) {
    if (res.status === 200) {
      return { status: 'ok', detail: 'API key valid' };
    }
    if (res.status === 401) {
      return { status: 'fail', detail: 'Invalid API key (401)' };
    }
    if (res.status === 429) {
      return { status: 'ok', detail: 'API key valid (rate limited)' };
    }
    return { status: 'fail', detail: 'Unexpected status ' + res.status };
  }).catch(function (err) {
    return { status: 'fail', detail: err.message };
  });
}

function parseGeneric(spec) {
  // Format: "Name:URL:HeaderName:$ENV_VAR" or "Name:URL:HeaderName:literal_value"
  var parts = spec.split(':');
  if (parts.length < 3) return null;
  var name = parts[0];
  var url = parts[1];
  var headerName = parts[2];
  var headerValue = parts.slice(3).join(':'); // rejoin in case URL had : in it... actually URL is part[1]

  // Handle env var expansion
  if (headerValue.startsWith('$')) {
    headerValue = process.env[headerValue.slice(1)] || '';
  }

  return { name: name, url: url, headerName: headerName, headerValue: headerValue };
}

function checkGeneric(spec, timeoutMs) {
  var parsed = parseGeneric(spec);
  if (!parsed) {
    return Promise.resolve({ status: 'fail', detail: 'Invalid generic spec format (expected "Name:URL:HeaderName:$ENV_VAR")' });
  }
  if (!parsed.headerValue) {
    return Promise.resolve({ status: 'skip', detail: 'No value for ' + parsed.name + ' (env var not set or empty)' });
  }
  var headers = {};
  headers[parsed.headerName] = parsed.headerValue;
  return httpRequest(parsed.url, {
    method: 'HEAD',
    headers: headers
  }, timeoutMs).then(function (res) {
    if (res.status < 500) {
      return { status: 'ok', detail: 'Endpoint reachable (' + res.status + ')' };
    }
    return { status: 'fail', detail: 'Server error (' + res.status + ')' };
  }).catch(function (err) {
    // Some servers don't support HEAD — try GET
    return httpRequest(parsed.url, {
      method: 'GET',
      headers: headers
    }, timeoutMs).then(function (res2) {
      if (res2.status < 500) {
        return { status: 'ok', detail: 'Endpoint reachable (' + res2.status + ' via GET)' };
      }
      return { status: 'fail', detail: 'Server error (' + res2.status + ')' };
    }).catch(function (err2) {
      return { status: 'fail', detail: err2.message };
    });
  });
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  var args = parseArgs(process.argv.slice(2));
  var timeoutMs = (args.timeout || 5) * 1000;

  if (args.help) {
    console.log('Credential Health Checker');
    console.log('');
    console.log('Validate API credentials before they are needed.');
    console.log('');
    console.log('Usage: node credential-health.cjs [options]');
    console.log('');
    console.log('Options:');
    console.log('  --check <services>    Check specific services (gmail, slack, attio, supabase, openai)');
    console.log('  --generic <spec>      Generic check: "Name:URL:HeaderName:$ENV_VAR"');
    console.log('  --json                Output JSON');
    console.log('  --fail-only           Only show failures');
    console.log('  --timeout <seconds>   Request timeout (default: 5)');
    console.log('  --help                Show this help');
    process.exit(0);
  }

  var serviceNames = {
    gmail: 'Gmail OAuth',
    slack: 'Slack Bot',
    attio: 'Attio API',
    supabase: 'Supabase',
    openai: 'OpenAI'
  };

  var checkers = {
    gmail: checkGmail,
    slack: checkSlack,
    attio: checkAttio,
    supabase: checkSupabase,
    openai: checkOpenAI
  };

  // Determine which checks to run
  var servicesToCheck = args.checks || Object.keys(checkers);

  var promises = servicesToCheck.map(function (svc) {
    var checker = checkers[svc];
    if (!checker) return Promise.resolve({ service: svc, status: 'fail', detail: 'Unknown service: ' + svc });
    var start = Date.now();
    return checker(timeoutMs).then(function (result) {
      result.service = svc;
      result.label = serviceNames[svc] || svc;
      result.latencyMs = Date.now() - start;
      return result;
    });
  });

  // Add generic checks
  if (args.generic) {
    args.generic.forEach(function (spec) {
      var start = Date.now();
      promises.push(
        checkGeneric(spec, timeoutMs).then(function (result) {
          var parsed = parseGeneric(spec);
          result.service = parsed ? parsed.name : 'generic';
          result.label = parsed ? parsed.name : 'generic';
          result.latencyMs = Date.now() - start;
          return result;
        })
      );
    });
  }

  Promise.all(promises).then(function (results) {
    if (args.json) {
      var summary = { ok: 0, fail: 0, skip: 0 };
      results.forEach(function (r) {
        if (summary[r.status] !== undefined) summary[r.status]++;
      });
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        results: results.map(function (r) {
          return { service: r.service, status: r.status, detail: r.detail, latencyMs: r.latencyMs };
        }),
        summary: summary
      }, null, 2));
      process.exit(results.some(function (r) { return r.status === 'fail'; }) ? 1 : 0);
      return;
    }

    // Human-readable output
    var okCount = 0, failCount = 0, skipCount = 0;
    var lines = [];
    lines.push('Credential Health Check');
    lines.push('───────────────────────');

    results.forEach(function (r) {
      var icon = r.status === 'ok' ? '✅' : r.status === 'fail' ? '❌' : '⏭️ ';
      var label = (r.label || r.service).padEnd(14);
      var detail = r.detail + (r.latencyMs ? ' (' + r.latencyMs + 'ms)' : '');

      if (r.status === 'ok') {
        okCount++;
        if (!args.failOnly) lines.push(icon + ' ' + label + ' ' + detail);
      } else if (r.status === 'fail') {
        failCount++;
        lines.push(icon + ' ' + label + ' ' + detail);
      } else {
        skipCount++;
        if (!args.failOnly) lines.push(icon + ' ' + label + ' ' + detail);
      }
    });

    if (args.failOnly && failCount === 0) {
      // Silent — nothing to report
      process.exit(0);
      return;
    }

    lines.push('');
    var statusWord = failCount > 0 ? 'FAIL' : 'OK';
    lines.push('Result: ' + failCount + ' failure(s), ' + okCount + ' healthy, ' + skipCount + ' untested [' + statusWord + ']');

    console.log(lines.join('\n'));
    process.exit(failCount > 0 ? 1 : 0);
  }).catch(function (err) {
    console.error('Unexpected error: ' + err.message);
    process.exit(2);
  });
}

main();
