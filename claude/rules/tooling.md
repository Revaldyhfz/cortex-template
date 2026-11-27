# Tooling — what to reach for

Only entries that change what Claude *does*. Edit this to match the tools you have installed.

## Documentation before memory

When coding against any third-party library, check current docs **before** relying on
recall. The `context7` MCP server is good for this:
`claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp`

## Web access — "site is blocked" is usually about the tool, not the site

| Surface | Good for |
|---|---|
| WebFetch | Quick reads of ordinary pages |
| `curl` | APIs, not consumer websites (often 403 bot-detection) |
| A real browser (Playwright MCP, Claude in Chrome) | Anything a fetcher refuses; JavaScript-heavy pages |

Before recording a source as unreachable, try a real browser.

## Accounts with write access

If you connect Gmail, Calendar, or anything that can send, buy or delete on your behalf,
treat every write as outward-facing: **prepare and draft freely, dispatch only on my word.**
The guardrail hook's `outward-facing-action` rule enforces this with an approval prompt.

## Security tooling worth having

| Tool | Reach for it when |
|---|---|
| `gitleaks` | Before any repo goes public: scans the full git history for secrets |
| `osv-scanner` | "Am I affected by this advisory?" — dependency vulnerability matching |
| `semgrep` | Static analysis for common bug classes |

<!-- Personalise: list your MCP servers, CLIs and their gotchas here. -->
