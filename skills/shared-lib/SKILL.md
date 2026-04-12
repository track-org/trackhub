# Shared Library

Reusable, zero-dependency modules for trackhub scripts. Import these instead of re-implementing common patterns.

## Modules

### `lib/args.mjs` — CLI Argument Parser

```js
import { parseArgs, showHelp, requireArg } from './lib/args.mjs';

const args = parseArgs(process.argv.slice(2), {
  alias: { h: 'help', v: 'verbose' },
  boolean: ['help', 'verbose', 'json'],
  default: { verbose: false },
});
```

Supports `--flag`, `-f`, `--key value`, `--key=value`, `-abc` (multiple booleans), positional args in `args._`.

### `lib/http.mjs` — HTTP Client with Retry

```js
import { http } from './lib/http.mjs';

const data = await http.get('https://api.example.com/data', {
  headers: { Authorization: 'Bearer xxx' },
  timeout: 10000,
  retries: 3,
});
```

Auto-retries on 429/5xx with exponential backoff + jitter. Returns parsed JSON. Throws `HttpError` with status/body/retries.

### `lib/dotenv.mjs` — .env File Loader

```js
import { loadEnv, envVar } from './lib/dotenv.mjs';

loadEnv();              // auto-discovers .env walking up from script dir
const key = envVar('MY_API_KEY');  // typed access with optional fallback
```

Doesn't overwrite existing env vars. First-wins semantics.

### `lib/dates.mjs` — Date/Time Helpers

```js
import { dates } from './lib/dates.mjs';

dates.today();                          // Date at midnight UTC
dates.range('last7');                   // { start, end } ISO strings
dates.formatDuration(90123);            // "1m 30s"
dates.formatHuman(new Date());          // "Fri 3 Apr 2026"
```

Range labels: `today`, `yesterday`, `last7`, `last14`, `last30`, `last90`, `this_week`, `last_week`, `this_month`, `last_month`, `this_year`, `YYYY-MM-DD..YYYY-MM-DD`.

### `lib/fmt.mjs` — Output Formatting

```js
import { fmt } from './lib/fmt.mjs';

fmt.ok('All checks passed');
fmt.warn('Something looks off');
fmt.table([{ name: 'Solar', kwh: 4.2 }]);
fmt.summary({ total: 12.5, cost: '€4.79' });
fmt.currency(4.79);     // "€4.79"
fmt.bytes(1048576);      // "1.0 MB"
```

### `lib/index.mjs` — Barrel Export

```js
import * as lib from './lib/index.mjs';
lib.http.get(url);
lib.dates.range('last7');
```

## Import Paths

Scripts inside trackhub skills can import using relative paths. The standard structure is:

```
trackhub/skills/<skill>/scripts/<script>.mjs
trackhub/skills/shared-lib/scripts/lib/<module>.mjs
```

From a script in another skill:

```js
import { http, dates, fmt, loadEnv } from '../../shared-lib/scripts/lib/index.mjs';
```

Or import individual modules:

```js
import { parseArgs } from '../../shared-lib/scripts/lib/args.mjs';
```

## Design Principles

- **Zero dependencies** — Node.js built-ins only
- **No overwriting** — env vars use first-wins, never clobber
- **Fail loudly** — structured errors with context, not silent failures
- **Testable standalone** — every module runs `node <module>.mjs` for a quick smoke test
- **Small and focused** — each module does one thing well

## Arm64-Safe Scripting

TrackHub runs on Raspberry Pi arm64. Node.js is more memory-sensitive there. Before writing scripts, read [`references/arm64-scripting.md`](references/arm64-scripting.md) for patterns that prevent OOM crashes. Key rules: use ES5 CJS for data-processing scripts, avoid template literals with interpolation in hot paths, stream instead of buffer, and set a memory ceiling.

## Module Map

| Module | Exports | Key Functions |
|--------|---------|---------------|
| `args.mjs` | `parseArgs`, `showHelp`, `requireArg` | CLI parsing with aliases, booleans, defaults |
| `http.mjs` | `http`, `fetchWithRetry`, `HttpError` | GET/POST/PUT/DELETE with retry + backoff |
| `dotenv.mjs` | `loadEnv`, `envVar`, `env` | .env discovery + loading |
| `dates.mjs` | `dates`, `range`, `formatDuration` | UTC date math + range parsing |
| `fmt.mjs` | `fmt`, `table`, `summary`, `ok/warn/error` | Structured console output |
