# Emporia MCP setup for OpenClaw

## Recommendation

Use a **local wrapper over Emporia's official npm MCP package** with the workspace `.env` file.

Why this is the best fit right now:
- uses Emporia's official vendor-maintained package
- works with email/password via `.env`
- avoids depending on remote OAuth support in the current runtime
- avoids unsupported native MCP registration in this OpenClaw build

## Important auth note

Emporia's hosted remote MCP endpoints (`/streamable` and `/sse`) are intended for **OAuth-based remote auth**.

Emporia's README says username/password via environment variables or `.env` is supported for the **local MCP server only**.

So if Don has:
- Emporia email/password -> use local MCP server
- remote OAuth token/client support -> remote MCP is possible later

## Private credential file

Use the existing workspace credential file:
- `/home/delads/.openclaw/workspace/.env`

Add:

```env
EMPORIA_ACCOUNT=your-email@example.com
EMPORIA_PASSWORD=your-password
```

Do not store real credentials in the skill directory.

## Why not native MCP config in OpenClaw?

Emporia's official README shows a standard MCP client config pattern, but this OpenClaw build rejects a root `mcp` config block as an unknown key.

So instead of native MCP registration, use the local wrapper script:

```bash
node skills/emporia-energy/scripts/query_emporia_vendor.mjs overview
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-devices
node skills/emporia-energy/scripts/query_emporia_vendor.mjs list-channels
node skills/emporia-energy/scripts/query_emporia_vendor.mjs energy --range today --filter dryer
```

Under the hood, that script imports the official `@emporiaenergy/emporia-mcp` package and reuses its auth/API implementation directly.

## What this enables

Expected tools from Emporia MCP include:
- `listDevices`
- `getDeviceDetails`
- `getDevicesChannels`
- `getDeviceEnergyUsage`
- `getDevicePowerUsage`
- `getBatteryStateOfCharge`
- `getEVChargingReport`
- `getEVChargerSessions`

## Good first prompts once connected

- List my Emporia devices
- Show my home energy usage today
- Which circuits used the most energy this week?
- Compare EV charger vs dryer energy use this month
- Show my battery state of charge over the last 24 hours

## Practical next step

Use the local PyEmVue workflow first:
1. run a day-scale query
2. confirm top channels/devices look sensible
3. try a named device/circuit filter
4. ask a natural-language summary question

Keep the vendor wrapper around for later retesting if Emporia fixes the authorization issue.
tate of charge over the last 24 hours

## Practical next step

Once the runtime has Emporia MCP configured, test in this order:
1. list devices
2. list channels
3. query energy for a short recent time window
4. try a natural-language summary question
