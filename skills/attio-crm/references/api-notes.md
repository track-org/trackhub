# Attio REST API v2 — Reference Notes

Generic API documentation for the Attio CRM integration. This does NOT contain workspace-specific schema — use `test-attio.mjs` to discover your workspace's objects and attributes.

## Base URL and Authentication

```
Base URL: https://api.attio.com
Auth: Bearer token in Authorization header
```

```bash
curl -H "Authorization: Bearer $ATTIO_API_KEY" \
     -H "Content-Type: application/json" \
     https://api.attio.com/v2/objects
```

## Key Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v2/objects` | GET | List all CRM objects |
| `/v2/objects/{slug}/records/query` | POST | Query records for an object |
| `/v2/objects/{slug}/records/{record_id}` | GET | Get a specific record |

## Pagination Pattern

Attio uses offset-based pagination with a maximum of 100 records per request.

```json
{
  "limit": 100,
  "offset": 0
}
```

- Each response returns up to `limit` records in `data[]`.
- If fewer than `limit` records are returned, you've reached the last page.
- Increment `offset` by `limit` for each subsequent request.

## Common Field Accessors

Attio stores field values as arrays (multi-value pattern). Access the first entry:

```js
record.values.name[0].value          // Deal or company name
record.values.stage[0].status.title   // Current stage label
record.values.stage[0].active_from   // ISO timestamp of last stage change
record.values.value[0].currency_value // Deal value (number)
record.values.value[0].currency_code // Currency code (e.g. "EUR")
record.values.associated_company[0].target_record_id  // Linked company
record.values.created_at[0].value    // Creation timestamp
```

## Error Handling

Scripts follow a consistent error pattern:

```json
{
  "ok": false,
  "status": 429,
  "error": { "message": "Rate limit exceeded" }
}
```

Non-OK responses are caught and emitted as structured JSON to stderr, then the script exits with code 1.

## Rate Limits

Attio enforces API rate limits. If you hit 429 errors:
- Add delays between batch requests (e.g., 200ms between pages)
- Avoid making redundant queries in tight loops
- Cache results when running multiple scripts in sequence

## Discovering Your Schema

Use the test script to list all objects:

```bash
node scripts/test-attio.mjs
```

To discover attributes for a specific object, query its definition:

```bash
node scripts/attio-client.mjs /v2/objects/deals
```

The response contains all attribute definitions including field types, allowed values, and relationships.
