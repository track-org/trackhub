#!/usr/bin/env node
/**
 * HTTP fetch wrapper with retry, timeout, auth, and JSON parsing.
 *
 * Usage:
 *   import { http } from './lib/http.mjs';
 *
 *   const data = await http.get('https://api.example.com/data', {
 *     headers: { Authorization: 'Bearer xxx' },
 *     timeout: 10000,
 *     retries: 3,
 *   });
 *
 * Supports GET, POST, PUT, DELETE via http.get/post/put/del.
 * Automatic JSON parsing, retry on transient errors (429, 5xx, network errors).
 * Structured error class with status, body, and retry info.
 */

/**
 * HTTP error with structured details.
 */
export class HttpError extends Error {
  constructor(message, { status, body, retries, url } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retries = retries;
    this.url = url;
  }
}

/**
 * Default retry status codes (retry on these).
 */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Sleep helper.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Calculate exponential backoff with jitter.
 */
function backoff(attempt, baseMs = 1000, maxMs = 30000) {
  const delay = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  const jitter = delay * (0.5 + Math.random() * 0.5);
  return Math.round(jitter);
}

/**
 * Core fetch with retry logic.
 *
 * @param {string} url
 * @param {RequestInit & { retries?: number, timeout?: number, retryOn?: number[]|Set<number>, retryDelay?: number, maxRetryDelay?: number, baseUrl?: string }} options
 * @returns {Promise<any>} parsed JSON body (or text if not JSON)
 */
export async function fetchWithRetry(url, options = {}) {
  const {
    retries = 2,
    timeout = 30000,
    retryOn = RETRY_STATUS,
    retryDelay = 1000,
    maxRetryDelay = 30000,
    baseUrl = '',
    ...fetchOpts
  } = options;

  const fullUrl = baseUrl ? `${baseUrl}${url}` : url;
  const method = (fetchOpts.method || 'GET').toUpperCase();
  const headers = { ...fetchOpts.headers };

  // Set timeout via AbortController
  let controller;
  if (timeout > 0) {
    controller = new AbortController();
    fetchOpts.signal = controller.signal;
    // Set up timeout
    const timer = setTimeout(() => controller.abort(), timeout);
    // We'll clear this after fetch completes
    fetchOpts._timer = timer;
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (controller) {
        const timer = setTimeout(() => controller.abort(), timeout);
        fetchOpts.signal = controller.signal;
        // Re-create controller for each attempt
        const ac = new AbortController();
        const timer2 = setTimeout(() => ac.abort(), timeout);
        fetchOpts.signal = ac.signal;
      }

      const res = await fetch(fullUrl, fetchOpts);
      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      // Parse JSON if possible
      let body;
      if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else {
        body = text;
      }

      // Check if we should retry
      if (!res.ok && retryOn.has(res.status) && attempt < retries) {
        const delay = backoff(attempt + 1, retryDelay, maxRetryDelay);
        await sleep(delay);
        continue;
      }

      // Non-retryable error
      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} ${method} ${fullUrl}`, {
          status: res.status,
          body,
          retries: attempt,
          url: fullUrl,
        });
      }

      return body;
    } catch (err) {
      lastError = err;

      // Don't retry on aborts (timeout) if we've already retried
      if (err.name === 'AbortError') {
        if (attempt < retries) {
          const delay = backoff(attempt + 1, retryDelay, maxRetryDelay);
          await sleep(delay);
          continue;
        }
        throw new HttpError(`Request timeout after ${timeout}ms: ${method} ${fullUrl}`, {
          status: 0,
          body: null,
          retries: attempt,
          url: fullUrl,
        });
      }

      // Network errors — retry
      if (attempt < retries && !(err instanceof HttpError)) {
        const delay = backoff(attempt + 1, retryDelay, maxRetryDelay);
        await sleep(delay);
        continue;
      }

      // Re-throw HttpError or wrap unknown errors
      if (err instanceof HttpError) throw err;
      throw new HttpError(`Network error: ${err.message}`, {
        status: 0,
        body: null,
        retries: attempt,
        url: fullUrl,
      });
    }
  }

  throw lastError; // Should not reach here
}

/**
 * Convenience HTTP methods.
 */
export const http = {
  /**
   * GET request.
   * @param {string} url
   * @param {object} [opts] - passed to fetchWithRetry
   */
  async get(url, opts = {}) {
    return fetchWithRetry(url, { ...opts, method: 'GET' });
  },

  /**
   * POST request with optional JSON body.
   * @param {string} url
   * @param {object} [body] - will be JSON.stringify'd
   * @param {object} [opts]
   */
  async post(url, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    return fetchWithRetry(url, { ...opts, method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
  },

  /**
   * PUT request with optional JSON body.
   */
  async put(url, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    return fetchWithRetry(url, { ...opts, method: 'PUT', headers, body: body ? JSON.stringify(body) : undefined });
  },

  /**
   * DELETE request.
   */
  async del(url, opts = {}) {
    return fetchWithRetry(url, { ...opts, method: 'DELETE' });
  },

  /**
   * Raw fetchWithRetry for custom methods.
   */
  request: fetchWithRetry,
};

// Test when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const testUrl = process.argv[2] || 'https://httpbin.org/get';
  try {
    const start = Date.now();
    const data = await http.get(testUrl, { timeout: 10000 });
    const elapsed = Date.now() - start;
    console.log(`✅ GET ${testUrl} — ${elapsed}ms`);
    console.log(JSON.stringify(data, null, 2).slice(0, 500));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error(`   Status: ${err.status ?? 'N/A'} | Retries: ${err.retries ?? 'N/A'}`);
    process.exit(1);
  }
}
