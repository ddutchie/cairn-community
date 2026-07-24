# Cairn Community Registry

The catalog of community-contributed **MCP servers** and **HTTP services** that
[Cairn](https://github.com/ddutchie/cairn) can browse and install with one click —
no app update required. Cairn fetches [`manifest.json`](./manifest.json) from this
repo at runtime, so merging a PR here makes a new integration available to everyone.

> This registry belongs to Cairn. (It is the successor concept to the Pinch app's
> community registry, but a **separate repo with its own schema** — do not cross-wire
> the two.)

## What's in it

| Type | What it is | Example |
|------|------------|---------|
| **MCP server** | A remote [Model Context Protocol](https://modelcontextprotocol.io) server the Cairn agent connects to as a client (SSE or streamable-HTTP). | Jira, Linear, Notion, monday.com |
| **HTTP service** | A single REST endpoint exposed to the agent as one function-calling tool. | a web-search or weather API |

Skills (prompt templates) are **not** part of this registry yet — planned for a later release.

## How install works in Cairn

1. Cairn fetches `manifest.json` (ETag-cached, refreshable from **Settings → Tools → Browse Community**).
2. You pick an entry; Cairn shows the **exact `baseUrl`/headers before installing**.
3. On install, the entry's `definition` is copied into your local workspace with `source: "community"` and the entry `version` recorded (for "update available" checks).
4. **Secrets** in headers (see below) are prompted for at install and stored in your OS keychain — never in the manifest, never in the app database.
5. **OAuth** connectors (`authMode: "oauth"`, e.g. Jira/Linear/Notion) install disabled; you click **Connect** to run the standard OAuth 2.1 flow (PKCE + dynamic client registration) locally. No tokens ever pass through this registry.

## Manifest format

Validated against [`schema.json`](./schema.json). Each entry has registry metadata
plus a `definition` that mirrors Cairn's own config shape (so install is a near-direct copy):

```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-24T00:00:00Z",
  "mcpServers": [
    {
      "author": "your-github-handle",
      "version": "1.0.0",          // SemVer of THIS entry — bump to push an update
      "tags": ["issues", "atlassian"],
      "blurb": "Search, create, and update Jira issues.",
      "logo": "jira",              // maps to a bundled SVG in Cairn; "" = fallback
      "brandColor": "#0052cc",
      "homepage": "https://www.atlassian.com/software/jira",
      "definition": {
        "name": "Jira",
        "description": "Atlassian Jira — issues, projects, and boards.",
        "transport": "http",       // "http" (streamable-HTTP) | "sse"
        "baseUrl": "https://mcp.atlassian.com/v1/mcp",
        "authMode": "oauth",       // "oauth" | "none"
        "oauthScope": "",
        "enabled": true
      }
    }
  ],
  "services": [
    {
      "author": "your-github-handle",
      "version": "1.0.0",
      "tags": ["search"],
      "blurb": "Web search results.",
      "logo": "",
      "brandColor": "#6b7280",
      "definition": {
        "name": "Web Search",
        "apiUrl": "https://api.example.com/search",
        "method": "GET",
        "headers": { "Authorization": "Bearer <API_KEY>" },
        "toolDefinition": "{\"name\":\"web_search\",\"description\":\"Search the web\",\"parameters\":{\"type\":\"object\",\"properties\":{\"q\":{\"type\":\"string\"}},\"required\":[\"q\"]}}",
        "responseKeys": ["results", "title", "url", "snippet"],
        "apiKeyUrl": "https://example.com/get-a-key",
        "enabled": true
      }
    }
  ]
}
```

### Secrets — placeholders only

**Never commit a real credential.** If a header needs a secret, use one of these
placeholder tokens as the value; Cairn detects them and prompts the user at install:

```
<API_KEY>   <TOKEN>   <ACCESS_TOKEN>   YOUR_API_KEY
```

Prefer `authMode: "oauth"` when the vendor's MCP server supports it — then no secret
is needed at all. The CI validator **rejects** any header that looks like a credential
but isn't a placeholder.

### Rules

- `baseUrl` / `apiUrl` must be **https**.
- Entry `name` must be unique within its type (case-insensitive).
- `toolDefinition` (services) must be valid stringified OpenAI tool JSON with a `name`.
- Bump the entry's `version` (and the top-level `updatedAt`) when you change a definition,
  so installed users see an update.

## Contributing

1. Fork and add/edit your entry in `manifest.json`.
2. Run the validator locally:
   ```sh
   npm install        # ajv + ajv-formats
   npm run validate
   ```
3. Open a PR. CI runs the same validation. A maintainer reviews the `baseUrl`/headers
   for safety and merges.

## License

MIT — see [LICENSE](./LICENSE).
