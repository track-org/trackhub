# Runtime Contract

A shared skill should document the local bindings it expects.

## Typical runtime bindings

### Self identity

- canonical name
- aliases
- display names
- platform IDs when relevant

### Peer identity

- peer agent names
- optional aliases

### Humans in context

- names or roles if relevant

### Environment

- required env vars
- required binaries
- filesystem assumptions
- writable output locations

### Policy

- read-only vs write-capable API usage
- timing overrides
- channel modes
- approval boundaries

## Rule

Document the shape of the required local config, not one specific machine's private values.

## Example pattern

```yaml
runtime_contract:
  identity:
    self:
      canonical_name: <local>
      aliases: <local>
    peers: <local>
  env:
    required:
      - SOME_API_KEY
  policy:
    api_mode: read-only
```

The exact storage format can vary. The point is to make required local bindings explicit.
