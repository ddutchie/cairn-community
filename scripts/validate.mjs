#!/usr/bin/env node
/**
 * Validates manifest.json against schema.json, plus a few registry-specific
 * rules the JSON Schema can't express:
 *   - unique tool names (case-insensitive) within each artifact type
 *   - baseUrl / apiUrl must be https
 *   - any secret-looking header value must be a PLACEHOLDER, never a real secret
 *   - toolDefinition must be valid stringified JSON with a `name`
 *
 * Run: npm run validate
 * Exits non-zero on any error (used by CI).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.json");
const schemaPath = path.join(root, "schema.json");

const errors = [];
const fail = (msg) => errors.push(msg);

// ── load ──────────────────────────────────────────────────────────────────
let manifest, schema;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (e) {
  console.error(`✗ manifest.json is not valid JSON: ${e.message}`);
  process.exit(1);
}
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  console.error(`✗ schema.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

// ── JSON Schema validation (via ajv when available) ─────────────────────────
try {
  const { default: Ajv } = await import("ajv");
  const { default: addFormats } = await import("ajv-formats");
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) {
    for (const err of validate.errors ?? []) {
      fail(`schema: ${err.instancePath || "(root)"} ${err.message}`);
    }
  }
} catch {
  console.warn("⚠ ajv not installed — skipping full JSON-Schema validation (run `npm i` for it). Continuing with structural checks.");
  if (typeof manifest.version !== "number") fail("version must be a number");
  if (typeof manifest.updatedAt !== "string") fail("updatedAt must be a string");
  if (!Array.isArray(manifest.mcpServers)) fail("mcpServers must be an array");
  if (!Array.isArray(manifest.services)) fail("services must be an array");
}

// ── registry-specific rules ─────────────────────────────────────────────────
const PLACEHOLDER = /<API_KEY>|<TOKEN>|<ACCESS_TOKEN>|YOUR_API_KEY/;
// A header value that looks like it carries a credential but ISN'T a placeholder.
const CREDENTIAL_HINT = /(bearer\s+\S|api[_-]?key|token|secret|authorization)/i;

function checkHeaders(where, headers) {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue;
    const looksSecret = CREDENTIAL_HINT.test(k) || CREDENTIAL_HINT.test(v);
    if (looksSecret && !PLACEHOLDER.test(v)) {
      // allow non-secret static headers (e.g. "Accept: application/json")
      const benign = /^(application\/|text\/|\*\/\*|gzip|identity|no-cache)/i.test(v.trim());
      if (!benign) {
        fail(`${where}: header "${k}" looks like a credential but is not a placeholder — publish "<API_KEY>" etc., never a real secret.`);
      }
    }
  }
}

function checkEntry(kind, list) {
  const names = new Map();
  (list ?? []).forEach((entry, i) => {
    const where = `${kind}[${i}] (${entry?.definition?.name ?? "?"})`;
    const def = entry?.definition;
    if (!def) return; // schema step already reported

    const nameKey = String(def.name || "").toLowerCase();
    if (names.has(nameKey)) fail(`${where}: duplicate name "${def.name}" (also ${kind}[${names.get(nameKey)}])`);
    else names.set(nameKey, i);

    const url = def.baseUrl || def.apiUrl;
    if (url && !/^https:\/\//.test(url)) fail(`${where}: URL must be https — got "${url}"`);

    checkHeaders(where, def.headers);

    if (kind === "services" && def.toolDefinition) {
      try {
        const td = JSON.parse(def.toolDefinition);
        if (!td.name) fail(`${where}: toolDefinition JSON has no "name"`);
      } catch (e) {
        fail(`${where}: toolDefinition is not valid JSON — ${e.message}`);
      }
    }
  });
}

checkEntry("mcpServers", manifest.mcpServers);
checkEntry("services", manifest.services);

// ── report ───────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s) found:\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

const mcp = manifest.mcpServers?.length ?? 0;
const svc = manifest.services?.length ?? 0;
console.log(`✓ manifest.json is valid — ${mcp} MCP server(s), ${svc} service(s).`);
