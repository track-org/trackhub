# Platform Formatting Cheat Sheet

Quick reference for formatting constraints per platform. Use this when writing a report and you're not sure what the target platform supports.

## Markdown Support Matrix

| Feature | Slack | WhatsApp | Discord | Telegram |
|---------|-------|----------|---------|----------|
| Bold | `*text*` | `*text*` | `**text**` | `*text*` |
| Italic | `_text_` | `_text_` | `*text*` | `_text_` |
| Code | `` `code` `` | `` `code` `` | `` `code` `` | `` `code` `` |
| Code block | ````` ``` ````` | ````` ``` ````` | `````lang ``` ````` | ````` ``` ````` |
| Headers | yes | ❌ | yes | yes |
| Tables | yes | ❌ | yes | ❌ |
| Lists | yes | yes (bullets) | yes | yes |
| Blockquotes | `>` | ❌ | `>` | ❌ |
| Link text | `<url\|text>` | ❌ (bare URLs) | `[text](url)` | `[text](url)` |
| Spoilers | ❌ | ❌ | `\|\|text\|\|` | ❌ |
| User mention | `<@U123>` | ❌ | `<@id>` | ❌ |
| Channel link | `<#C123\|name>` | ❌ | `<#id>` | ❌ |
| Emoji | ✅ native + custom | ✅ native | ✅ native + custom | ✅ native |
| Strikethrough | `~text~` | ❌ | `~~text~~` | ❌ |

## Message Length Guidelines

| Platform | Hard limit | Comfortable | Recommended max |
|----------|-----------|-------------|-----------------|
| Slack | 40,000 chars | ~2,000 chars | 2,000 chars (thread longer) |
| WhatsApp | 65,536 chars | ~500 chars | 1,000 chars |
| Discord | 2,000 chars | ~1,500 chars | 1,900 chars (split longer) |
| Telegram | 4,096 chars | ~1,000 chars | 4,000 chars |

## Section Divider Patterns

### Slack
```
———

### Section Title
```

### WhatsApp
```
*SECTION TITLE*
```
Or use emoji: `📊`, `📅`, `📬`, `⚠️`, `✅`, `❌`

### Discord
```
### Section Title
```
Or use `———` as a divider.

### Telegram
```
*Section Title*
```

## Link Handling

### Slack — suppress preview
```
<https://example.com|Example Site>
<https://example.com>              ← still suppresses preview
```

### Discord — suppress embed
```
<https://example.com>
```

### WhatsApp — bare URL only
```
https://example.com
```
No link text. The platform auto-previews.

### Telegram — link text supported
```
[Example Site](https://example.com)
```

## Date/Time Formatting

Always include timezone. Prefer:
- Relative: "2 hours ago", "yesterday at 14:30"
- Absolute with tz: "2026-03-31 09:00 IST"
- Avoid: "09:00" alone (ambiguous)
