# Arm64-Safe Node.js Scripting (Raspberry Pi)

TrackHub runs on Raspberry Pi arm64 with ~8GB RAM. Node.js on arm64 is more memory-sensitive than x86. These rules prevent OOM crashes in cron jobs and agent scripts.

## Core Rules

### 1. Avoid template literals with emoji in hot paths

```js
// ❌ BAD — V8 allocates huge intermediate strings on arm64
const msg = `📊 Result: ${data.length} items processed in ${duration}ms ✅`;

// ✅ GOOD — string concatenation, emoji at the end
var msg = 'Result: ' + data.length + ' items processed in ' + duration + 'ms ✅';
```

### 2. Use ES5 CJS for any script that processes data

```js
// ✅ ES5 CJS — safe on arm64
var fs = require('fs');
var data = JSON.parse(fs.readFileSync('/tmp/big.json', 'utf8'));

// ❌ ESM + template literals — OOM risk on large data
import fs from 'fs';
const msg = `Processing ${data.length} records...`;
```

### 3. Stream large outputs, don't buffer

```js
// ❌ BAD — buffers entire git diff in memory
const { execSync } = require('child_process');
const diff = execSync('git diff', { maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer!

// ✅ GOOD — use --stat or --name-status instead of full patches
const stats = execSync('git diff --shortstat').toString();
const files = execSync('git diff --name-status').toString();
```

### 4. Process data in chunks

```js
// ❌ BAD — map entire array, build giant string
const result = items.map(i => `• ${i.name}: ${i.value}`).join('\n');

// ✅ GOOD — write incrementally
items.forEach(function(item) {
  process.stdout.write('• ' + item.name + ': ' + item.value + '\n');
});
```

### 5. Set a memory ceiling

Add to any script that processes variable-size input:

```js
// Fail fast instead of OOM
if (process.memoryUsage().heapUsed > 200 * 1024 * 1024) {
  console.error('ERROR: Memory limit exceeded (200MB). Input too large.');
  process.exit(1);
}
```

### 6. Prefer `--stat` / `--name-status` over full patches

When running git commands in scripts:

| Command | Memory | Use when |
|---------|--------|----------|
| `git diff --shortstat` | ~1KB | Just need counts |
| `git diff --name-status` | ~10KB | Need file list |
| `git diff --stat` | ~20KB | Need per-file stats |
| `git diff` (full) | ~50MB+ | Almost never needed |

### 7. Avoid large regex on large strings

```js
// ❌ BAD — regex on entire file content
const matches = content.match(/some complex pattern/g);

// ✅ GOOD — process line by line
content.split('\n').forEach(function(line) {
  if (/pattern/.test(line)) { /* ... */ }
});
```

## File Conventions

- Use `.cjs` extension for ES5 CommonJS scripts (makes intent explicit)
- Use `.mjs` for ESM only when the script is tiny (< 50 lines) and processes no data
- Add a comment at the top: `// arm64-safe: ES5 CJS, no template literals`

## Quick Checklist

Before committing a script to trackhub:

- [ ] No template literals with interpolation in data-processing paths
- [ ] Uses `var` or `function` declarations (not `const`/`let` in loops)
- [ ] Streams or avoids buffering large outputs
- [ ] Has a memory ceiling check if processing variable-size input
- [ ] Tested on arm64 (or uses patterns known to be safe)
