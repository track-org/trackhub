# Solis Cloud API Notes

Implementation notes for the Solis Cloud v1 API as used by this skill.

## Authentication: HMAC Signing

Every POST request must include these headers:

| Header | Value |
|---|---|
| `Content-MD5` | Base64-encoded MD5 hash of the JSON body |
| `Content-Type` | `application/json` |
| `Date` | RFC 2822 timestamp in GMT (via `email.utils.formatdate(usegmt=True)`) |
| `Authorization` | `API <KEY_ID>:<SIGNATURE>` |

### Signature Calculation

```
string_to_sign = "POST\n" + Content-MD5 + "\n" + Content-Type + "\n" + Date + "\n" + <resource_path>
signature = Base64(HMAC-SHA1(key_secret_bytes, string_to_sign_bytes))
```

- Key secret is the raw bytes of `SOLIS_KEY_SECRET`
- HMAC uses SHA-1 (yes, SHA-1 — this is the Solis Cloud API spec)
- Resource path is the URL path only (e.g. `/v1/api/inverterDetailList`)

## API Endpoints Used

| Endpoint | Purpose | Key Fields |
|---|---|---|
| `/v1/api/stationDayEnergyList` | Daily energy totals (generation, export, import, self-consumption) | `energy`, `gridSellEnergy`, `gridPurchasedEnergy`, `homeLoadEnergy`, `oneSelf` |
| `/v1/api/inverterDetailList` | Live inverter data (power output, grid status, load) | `pac`, `gridDetailVo.gridPower`, `familyLoadPower`, `sn`, `state` |

## Rate Limiting & Retry

- The API returns HTTP 429 when rate limited
- Scripts retry up to 3 times with increasing delays: **0s → 1.2s → 2.5s**
- Non-429 errors fail immediately
- After 3 consecutive 429s, the script exits with failure

## Data Conventions

### Grid Power Sign Convention
- **Negative** `gridPower` = importing from the grid
- **Positive** `gridPower` = exporting to the grid

### Power Units
- The `pac` field in `/v1/api/inverterDetailList` returns values in **kW** (not watts), based on observed values from Don's inverter. The `cmd_now()` function still applies a heuristic: if the raw value exceeds 1000, it divides by 1000 as a safety net.
- `familyLoadPower` / `totalLoadPower` appear to also be in kW.

### Timezone Handling
- The API returns dates in local time for the plant's configured timezone
- `today_str()` uses UTC + offset_hours for date calculation
- Energy totals are per calendar day in the plant's local timezone

## Error Codes

The API returns a JSON envelope with `code` and `msg`. Successful codes are `"0"` or `"I0000"`. Any other code triggers an error exit with the API's error message.
