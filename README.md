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

## Repo structure

Each connector is a folder. `manifest.json` is a **compiled artifact** built from
them by CI — never hand-edit it.

```
connectors/
  jira/connector.json          # icon: { "slug": "jira" }  (fetched from Simple Icons)
  canva/
    connector.json             # icon: { "file": "icon.svg" }
    icon.svg
manifest.json                  # COMPILED — do not edit by hand
schema.json                    # validates a single connector.json
logos/                         # generated: <slug>.svg (Simple Icons, normalized)
scripts/
  fetch-logos.mjs              # icon.slug -> logos/<slug>.svg
  build-manifest.mjs           # connectors/* -> manifest.json (inlines sanitized icon)
  svg-sanitize.mjs             # SVG allowlist (build + CI gate)
  validate.mjs                 # validates folders + drift-checks manifest.json
```

## How install works in Cairn

1. Cairn fetches `manifest.json` (ETag-cached, refreshable from **Settings → Tools → Browse Community**).
2. You pick an entry; Cairn shows the **exact `baseUrl`/headers before installing**.
3. On install, the entry's `definition` is copied into your local workspace with `source: "community"` and the entry `version` recorded (for "update available" checks).
4. **Secrets** in headers are prompted for at install and stored in your OS keychain — never in the manifest, never in the app database.
5. **OAuth** connectors (`authMode: "oauth"`, e.g. Jira/Linear/Notion) install disabled; you click **Connect** to run the standard OAuth 2.1 flow (PKCE + dynamic client registration) locally. No tokens ever pass through this registry.
6. The connector's logo (`iconSvg`) is compiled into the manifest already sanitized, so Cairn renders it inline (tinted with `brandColor`) — no runtime logo fetch.

## Adding a connector

Create one folder — `connectors/<id>/connector.json`:

```jsonc
{
  "kind": "mcp",                         // "mcp" | "service"
  "author": "your-github-handle",
  "version": "1.0.0",                    // SemVer of THIS entry; bump to push an update
  "category": "Project management",      // ONE of the fixed categories (see below) — the Browse chip
  "tags": ["issues", "atlassian"],       // freeform keywords for SEARCH only (not shown as chips)
  "blurb": "Search, create, and update Jira issues.",
  "brandColor": "#0052cc",
  "homepage": "https://www.atlassian.com/software/jira",
  "icon": { "slug": "jira" },            // see "Logos" below
  "definition": {
    "name": "Jira",
    "description": "Atlassian Jira — issues, projects, and boards.",
    "transport": "http",                 // "http" (streamable-HTTP) | "sse"
    "baseUrl": "https://mcp.atlassian.com/v1/mcp",
    "authMode": "oauth",                 // "oauth" | "none"
    "oauthScope": "",
    "enabled": true
  }
}
```

An HTTP-service `definition` uses `apiUrl` / `method` / `headers` / `toolDefinition`
(stringified OpenAI tool JSON) / `responseKeys` / `apiKeyUrl` instead.

### Logos

Set `icon` to exactly one of:
- `{ "slug": "jira" }` — a [Simple Icons](https://simpleicons.org) slug. CI fetches + normalizes it. Easiest; use it whenever the brand is on Simple Icons.
- `{ "file": "icon.svg" }` — a `.svg` you commit beside `connector.json` (for brands not on Simple Icons).
- `{ "svg": "<svg …>" }` — inline SVG markup.
- omit `icon` — the app shows a generic fallback (MCP glyph for MCP servers, a plug for services).

Every icon is run through an **allowlist sanitizer** at build/CI time (no scripts,
event handlers, external refs, or `<foreignObject>`), so only safe, single-color
markup ships. Use `fill="currentColor"` so Cairn can tint with `brandColor`.

### Secrets — placeholders only

**Never commit a real credential.** If a header needs a secret, use one of these
placeholder tokens; Cairn prompts the user at install and stores it in the OS keychain:

```
<API_KEY>   <TOKEN>   <ACCESS_TOKEN>   YOUR_API_KEY
```

Prefer `authMode: "oauth"` when the vendor supports it — then no secret is needed.
CI **rejects** any header that looks like a credential but isn't a placeholder.

### Rules

- `baseUrl` / `apiUrl` / `homepage` / `apiKeyUrl` must be **https**.
- `category` must be one of: **Project management · Dev & Code · Docs & Knowledge · CRM & Support · Search & Web · Finance · Design · Automation · Utilities**. It's the chip a connector groups under in Browse Community. `tags` are freeform and used for **search only** (not shown as chips).
- `name` must be unique within its kind (case-insensitive).
- `toolDefinition` (services) must be valid stringified OpenAI tool JSON with a `name`.
- Bump the entry `version` when you change a `definition` so installed users see an update.

## Contributing

1. Add/edit `connectors/<id>/connector.json` (and an `icon.svg` if not using a slug).
2. Build + validate locally:
   ```sh
   npm install                 # ajv + ajv-formats
   npm run fetch-logos         # materialize logos/ for any icon.slug
   npm run build               # regenerate manifest.json from the folders
   npm run validate            # sanitize icons, validate, drift-check manifest.json
   ```
3. Commit the regenerated `manifest.json` too. Open a PR — CI runs the same steps and
   a maintainer reviews the `baseUrl`/headers for safety before merging.

## Logos & trademarks

Brand logos are sourced from [Simple Icons](https://simpleicons.org) (**CC0 1.0**,
public domain — no attribution required) and normalized to `currentColor`. The
underlying brand marks remain the **trademarks of their respective owners**; they are
used here nominatively, only to identify the service each connector integrates with.

## License

MIT — see [LICENSE](./LICENSE). (Logo files: CC0, per above.)

