# Integration Paths — Emporia Energy

Detailed comparison of the three integration approaches.

## 1. Local vendor wrapper (`query_emporia_vendor.mjs`)

Uses Emporia's official npm package `@emporiaenergy/emporia-mcp` locally, reusing the vendor auth and API implementation without requiring OpenClaw to register arbitrary MCP servers natively.

**Best fit when you have:**
- A native Emporia email/password account
- The workspace `.env` file available
- An OpenClaw build without general MCP server registration in config

**Benefits:**
- Still uses vendor-maintained auth/API logic
- Uses username/password via `.env`
- Avoids unsupported OpenClaw MCP config
- Less brittle than reverse-engineered cloud calls

## 2. Hosted Emporia MCP server (later / optional)

Emporia exposes remote MCP endpoints such as `https://mcp.emporiaenergy.com/streamable`. Their README indicates remote auth is OAuth-based.

Use this path only when the runtime has remote MCP support plus OAuth/token wiring in place.

## 3. Local PyEmVue fallback (`query_emporia.py`)

The bundled Python script. Use when the vendor wrapper is unavailable or temporarily broken. Relies on the `pyemvue` library — an unofficial community package.
