---
name: supabase-rest
description: Query, insert, update, and delete data in Supabase via the REST API (PostgREST). Use when an agent needs to interact with a Supabase project's database tables, run filtered queries, paginate results, insert rows with returning IDs, update records, or manage database operations through the Supabase REST endpoint. Covers authentication, filtering, ordering, joins, and common patterns. NOT for Supabase Auth, Storage, Edge Functions, or Realtime — only the database REST API.
---

# Supabase REST API

Interact with Supabase PostgreSQL databases via PostgREST.

## Prerequisites

- `SUPABASE_URL` and `SUPABASE_KEY` must be set in environment or passed per-request
- For **read-only** operations, the `anon` key is sufficient
- For **write** operations, use the `service_role` key (bypasses RLS) — only with explicit user approval

## Endpoint

```
{SUPABASE_URL}/rest/v1/{table}
```

## Authentication

Every request needs two headers:
```
apikey: {SUPABASE_KEY}
Authorization: Bearer {SUPABASE_KEY}
```

## Operations

### Read (GET)

```bash
curl -G "{SUPABASE_URL}/rest/v1/{table}" \
  -H "apikey: {KEY}" \
  -H "Authorization: Bearer {KEY}" \
  --data-urlencode "select=*" \
  --data-urlencode "id=eq.123" \
  --data-urlencode "order=created_at.desc" \
  --data-urlencode "limit=50"
```

**Key query params:**
- `select` — columns and relationships (comma-separated; `*` for all)
- `{column}=eq.{value}` — equality filter
- `{column}=ilike.*{value}*` — case-insensitive substring search
- `{column}=in.(v1,v2,v3)` — match any of several values
- `{column}=gte.{value}` / `lte.{value}` / `gt.{value}` / `lt.{value}` — comparisons
- `{column}=is.null` / `{column}=not.is.null` — null checks
- `{column}=not.eq.{value}` — negation
- `and={col1}.eq.{v1},{col2}.eq.{v2}` — compound filters
- `order={column}.asc` / `order={column}.desc` — sorting
- `limit={n}` — max rows (default 1000, max varies by project)
- `offset={n}` — skip rows (for pagination)
- `range={start}-{end}` — Range header pagination (returns total count in `Content-Range` response header)

### Insert (POST)

```bash
curl -X POST "{SUPABASE_URL}/rest/v1/{table}" \
  -H "apikey: {KEY}" \
  -H "Authorization: Bearer {KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '[{"col1": "val1", "col2": "val2"}]'
```

- Pass an array for bulk insert, a single object for one row
- `Prefer: return=representation` returns inserted rows (with auto-generated IDs)
- `Prefer: return=minimal` returns nothing (faster for large inserts)
- Use `Prefer: resolution=merge-duplicates` with `on_conflict` param for upserts

### Update (PATCH)

```bash
curl -X PATCH "{SUPABASE_URL}/rest/v1/{table}?id=eq.123" \
  -H "apikey: {KEY}" \
  -H "Authorization: Bearer {KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"status": "active"}'
```

⚠️ **Always include a filter** — without one, ALL rows get updated.

### Delete (DELETE)

```bash
curl -X DELETE "{SUPABASE_URL}/rest/v1/{table}?id=eq.123" \
  -H "apikey: {KEY}" \
  -H "Authorization: Bearer {KEY}"
```

⚠️ **Always include a filter** — without one, ALL rows get deleted.

## Joins / Relationships

```
select=*,related_table(*)
select=id,name,orders(id,total)
select=*,notes(*)
```

Use foreign key column names to traverse relationships.

## Pagination

**Offset-based:**
```
?limit=50&offset=0
?limit=50&offset=50
```

**Range header** (recommended — returns total count):
```
-H "Range: 0-49"
```
Response header `Content-Range: 0-49/200` gives you the total.

## Common Gotchas

- Filters go in query params, not the body
- `Content-Type: application/json` is required for POST/PATCH
- `Prefer: return=representation` is needed to get inserted/updated rows back
- Boolean filters: `{col}=is.true` / `{col}=is.false`
- Date filters: `{col}=gte.2024-01-01` (ISO 8601 format)
- Array columns: `{col}=cs.{value}` (contains), `{col}=cd.{value}` (contained by)
- The default row limit is 1000 — use `limit` or Range header for more
- For large bulk inserts (>100 rows), consider batch in chunks of 500

## Error Handling

- `401` — invalid API key
- `406` — missing `apikey` header
- `400` — bad request (malformed filter, invalid JSON)
- `409` — unique constraint violation (duplicate)
- `403` — RLS policy denied access (use service_role key if intentional)
- `5xx` — server error (rate limit, schema mismatch)

## Rate Limiting

- Respect `Retry-After` header on 429 responses
- For bulk inserts, add 100-200ms delays between requests
- Batch inserts (array in POST body) are preferred over sequential single inserts
