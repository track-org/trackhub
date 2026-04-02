/**
 * fuzzy-match.mjs — Lightweight fuzzy matching against a schema
 *
 * Matches user input against a list of known values (stage names,
 * attribute slugs, company stages, etc.) using a cascade of strategies:
 *
 *   1. Exact match (case-insensitive)
 *   2. Normalised match (strip emojis, whitespace, diacritics, lowercase)
 *   3. Substring match (input is contained in value or vice versa)
 *   4. Levenshtein distance (close typos, configurable threshold)
 *
 * Returns the best match with a confidence score and the original
 * schema value, so API calls always use the canonical form.
 *
 * Usage:
 *   import { fuzzyMatch, fuzzyMatchMultiple } from './fuzzy-match.mjs';
 *
 *   const result = fuzzyMatch('won', ['Won 🎉', 'Disqualified', 'Lead', 'Live']);
 *   // → { match: 'Won 🎉', score: 1, method: 'exact' }
 *
 *   const result = fuzzyMatch('disqulified', stageNames);
 *   // → { match: 'Disqualified', score: 0.95, method: 'levenshtein' }
 */

/**
 * Strip emojis, diacritics, and normalise whitespace.
 * "Won 🎉" → "won", "Disqualified" → "disqualified"
 */
export function normalise(str) {
  return str
    .replace(/[\u{1F300}-\u{1FAD6}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimisation
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Similarity score from 0-1 based on Levenshtein distance.
 */
function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Fuzzy match a query against a list of candidate values.
 *
 * @param {string} query - The user's input
 * @param {string[]} candidates - Array of known values from schema
 * @param {object} [opts]
 * @param {number} [opts.levenshteinThreshold=0.8] - Min similarity for levenshtein matching
 * @param {boolean} [opts.returnAll=false] - Return all matches above threshold (for ambiguity detection)
 * @returns {{ match: string, score: number, method: string, allMatches?: Array }}
 *
 * Returns null if no match found above threshold.
 * Throws if ambiguous (multiple matches at same best score).
 */
export function fuzzyMatch(query, candidates, opts = {}) {
  const {
    levenshteinThreshold = 0.8,
    returnAll = false,
  } = opts;

  if (!query || !candidates?.length) return null;

  const qNorm = normalise(query);
  const qLower = query.toLowerCase().trim();

  // Strategy 1: Exact match (case-insensitive)
  const exact = candidates.find(c => c.toLowerCase() === qLower);
  if (exact) {
    return returnAll
      ? { match: exact, score: 1, method: 'exact', allMatches: [{ value: exact, score: 1, method: 'exact' }] }
      : { match: exact, score: 1, method: 'exact' };
  }

  // Strategy 2: Normalised exact match
  const normalisedMap = new Map();
  for (const c of candidates) {
    const n = normalise(c);
    if (!normalisedMap.has(n)) normalisedMap.set(n, []);
    normalisedMap.get(n).push(c);
  }
  if (normalisedMap.has(qNorm)) {
    const matches = normalisedMap.get(qNorm);
    if (matches.length === 1) {
      return returnAll
        ? { match: matches[0], score: 1, method: 'normalised', allMatches: matches.map(v => ({ value: v, score: 1, method: 'normalised' })) }
        : { match: matches[0], score: 1, method: 'normalised' };
    }
    // Ambiguous — multiple candidates normalise to same thing
    if (returnAll) {
      return { match: matches[0], score: 1, method: 'normalised', ambiguous: true, allMatches: matches.map(v => ({ value: v, score: 1, method: 'normalised' })) };
    }
    throw new Error(`Ambiguous match for "${query}": ${matches.map(m => `"${m}"`).join(', ')}`);
  }

  // Strategy 3: Substring match (input contains value or value contains input)
  const substringMatches = candidates.filter(c => {
    const cLower = c.toLowerCase();
    const cNorm = normalise(c);
    return cLower.includes(qLower) || qLower.includes(cLower) ||
           cNorm.includes(qNorm) || qNorm.includes(cNorm);
  });

  if (substringMatches.length === 1) {
    const match = substringMatches[0];
    const score = Math.min(qNorm.length, normalise(match).length) /
                  Math.max(qNorm.length, normalise(match).length);
    return returnAll
      ? { match, score: Math.round(score * 100) / 100, method: 'substring', allMatches: [{ value: match, score, method: 'substring' }] }
      : { match, score: Math.round(score * 100) / 100, method: 'substring' };
  }

  if (substringMatches.length > 1) {
    if (returnAll) {
      const all = substringMatches.map(m => {
        const score = Math.min(qNorm.length, normalise(m).length) /
                      Math.max(qNorm.length, normalise(m).length);
        return { value: m, score, method: 'substring' };
      });
      all.sort((a, b) => b.score - a.score);
      return { match: all[0].value, score: all[0].score, method: 'substring', ambiguous: true, allMatches: all };
    }
    throw new Error(
      `Ambiguous substring match for "${query}": ${substringMatches.map(m => `"${m}"`).join(', ')}`
    );
  }

  // Strategy 4: Levenshtein distance
  const scored = candidates.map(c => {
    const s = similarity(qNorm, normalise(c));
    return { value: c, score: Math.round(s * 100) / 100 };
  }).filter(s => s.score >= levenshteinThreshold);

  if (scored.length === 0) {
    return returnAll
      ? { match: null, score: 0, method: 'none', allMatches: [] }
      : null;
  }

  scored.sort((a, b) => b.score - a.score);

  // Check for ambiguity — if top 2 are very close (within 0.05), flag it
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.05) {
    const ambiguous = scored.filter(s => s.score >= scored[0].score - 0.05);
    if (returnAll) {
      return { match: scored[0].value, score: scored[0].score, method: 'levenshtein', ambiguous: true, allMatches: ambiguous.map(s => ({ ...s, method: 'levenshtein' })) };
    }
    throw new Error(
      `Ambiguous fuzzy match for "${query}": ${ambiguous.map(s => `"${s.value}" (${s.score})`).join(', ')}`
    );
  }

  return returnAll
    ? { match: scored[0].value, score: scored[0].score, method: 'levenshtein', allMatches: [{ ...scored[0], method: 'levenshtein' }] }
    : { match: scored[0].value, score: scored[0].score, method: 'levenshtein' };
}

/**
 * Match multiple query values against candidates.
 * Useful for --exclude flags with multiple values.
 *
 * @param {string[]} queries - Array of user inputs
 * @param {string[]} candidates - Known values
 * @param {object} [opts] - Same opts as fuzzyMatch
 * @returns {Array<{ query: string, match: string|null, score: number, method: string, error?: string }>}
 */
export function fuzzyMatchMultiple(queries, candidates, opts = {}) {
  return queries.map(q => {
    try {
      const result = fuzzyMatch(q, candidates, opts);
      if (!result) {
        return { query: q, match: null, score: 0, method: 'none', error: `No match for "${q}"` };
      }
      return { query: q, match: result.match, score: result.score, method: result.method };
    } catch (err) {
      return { query: q, match: null, score: 0, method: 'error', error: err.message };
    }
  });
}
