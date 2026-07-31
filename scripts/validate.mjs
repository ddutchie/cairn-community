#!/usr/bin/env node
/**
 * Validate the community registry:
 *   - every connectors/<id>/connector.json parses + has the required fields
 *   - baseUrl / apiUrl must be https
 *   - secret-looking header values must be a PLACEHOLDER, never a real secret
 *   - services: toolDefinition is valid stringified JSON with a "name"
 *   - unique connector names (case-insensitive) within each kind
 *   - every icon (inline svg / icon.file / icon.slug) passes the SVG allowlist
 *   - manifest.json is up to date with the folders (drift gate)
 *
 * Run: npm run validate   (CI gate; exits non-zero on any problem)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertSafeSvg } from "./svg-sanitize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectorsDir = path.join(root, "connectors");
const logosDir = path.join(root, "logos");

const errors = [];
const fail = (m) => errors.push(m);

const PLACEHOLDER = /<API_KEY>|<TOKEN>|<ACCESS_TOKEN>|YOUR_API_KEY/;
const CREDENTIAL_HINT = /(bearer\s+\S|api[_-]?key|token|secret|authorization)/i;

const CATEGORIES = new Set([
  "Project management",
  "Dev & Code",
  "Docs & Knowledge",
  "CRM & Support",
  "Search & Web",
  "Finance",
  "Design",
  "Automation",
  "Utilities",
]);

function checkHeaders(where, headers) {
  if (!headers) return;
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") continue;
    const looksSecret = CREDENTIAL_HINT.test(k) || CREDENTIAL_HINT.test(v);
    if (looksSecret && !PLACEHOLDER.test(v)) {
      const benign = /^(application\/|text\/|\*\/\*|gzip|identity|no-cache)/i.test(v.trim());
      if (!benign) fail(`${where}: header "${k}" looks like a credential but is not a placeholder — publish "<API_KEY>" etc., never a real secret.`);
    }
  }
}

function checkIcon(where, dir, icon) {
  if (!icon || typeof icon !== "object") return; // no icon → app fallback, fine
  const kinds = ["svg", "file", "slug"].filter((k) => icon[k]);
  if (kinds.length > 1) fail(`${where}: icon must use exactly one of svg/file/slug (got ${kinds.join(", ")})`);
  try {
    if (icon.svg) {
      assertSafeSvg(String(icon.svg), `${where} icon.svg`);
    } else if (icon.file) {
      const p = path.join(dir, String(icon.file));
      if (!fs.existsSync(p)) return fail(`${where}: icon.file "${icon.file}" not found`);
      assertSafeSvg(fs.readFileSync(p, "utf8"), `${where} ${icon.file}`);
    } else if (icon.slug) {
      const p = path.join(logosDir, `${icon.slug}.svg`);
      if (!fs.existsSync(p)) return fail(`${where}: no logo for slug "${icon.slug}" — run: node scripts/fetch-logos.mjs`);
      assertSafeSvg(fs.readFileSync(p, "utf8"), `${where} logos/${icon.slug}.svg`);
    }
  } catch (e) {
    fail(`${where}: unsafe icon — ${e.message}`);
  }
}

// ── validate every connector folder ────────────────────────────────────────
if (!fs.existsSync(connectorsDir)) {
  console.error("✗ connectors/ directory missing");
  process.exit(1);
}
const names = { mcp: new Map(), service: new Map(), command: new Map() };
let count = 0;
for (const id of fs.readdirSync(connectorsDir).sort()) {
  const dir = path.join(connectorsDir, id);
  const jsonPath = path.join(dir, "connector.json");
  if (!fs.existsSync(jsonPath)) continue;
  const where = `connectors/${id}`;
  let c;
  try {
    c = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (e) {
    fail(`${where}/connector.json: invalid JSON — ${e.message}`);
    continue;
  }
  count++;

  if (c.kind !== "mcp" && c.kind !== "service" && c.kind !== "command") fail(`${where}: kind must be "mcp", "service", or "command"`);
  if (!c.blurb) fail(`${where}: missing blurb`);
  if (!CATEGORIES.has(c.category)) fail(`${where}: category must be one of ${[...CATEGORIES].join(" | ")} (got ${JSON.stringify(c.category)})`);
  if (!/^\d+\.\d+\.\d+$/.test(String(c.version || ""))) fail(`${where}: version must be semver`);
  const def = c.definition || {};
  if (!def.name) fail(`${where}: definition.name required`);

  // ── command entries: no URLs / headers / icon; validate the command shape ──
  if (c.kind === "command") {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(def.name || ""))) {
      fail(`${where}: command name must be lowercase letters, digits, and hyphens (got ${JSON.stringify(def.name)})`);
    }
    if (typeof def.insertText !== "string" || def.insertText.trim().length === 0) {
      fail(`${where}: command definition.insertText must be a non-empty string`);
    }
    if (!["chat", "agent", "both"].includes(def.scope)) {
      fail(`${where}: command definition.scope must be "chat", "agent", or "both" (got ${JSON.stringify(def.scope)})`);
    }
    const cmdKey = String(def.name || "").toLowerCase();
    if (names.command.has(cmdKey)) fail(`${where}: duplicate command name "${def.name}" (also ${names.command.get(cmdKey)})`);
    else names.command.set(cmdKey, id);
    for (const key of ["homepage"]) {
      if (c[key] && !/^https:\/\//.test(c[key])) fail(`${where}: ${key} must be https`);
    }
    checkIcon(where, dir, c.icon);
    continue;
  }

  const nameKey = String(def.name || "").toLowerCase();
  const bucket = c.kind === "service" ? names.service : names.mcp;
  if (bucket.has(nameKey)) fail(`${where}: duplicate name "${def.name}" (also ${bucket.get(nameKey)})`);
  else bucket.set(nameKey, id);

  const url = def.baseUrl || def.apiUrl;
  if (url && !/^https:\/\//.test(url)) fail(`${where}: URL must be https — got "${url}"`);
  for (const key of ["homepage"]) {
    if (c[key] && !/^https:\/\//.test(c[key])) fail(`${where}: ${key} must be https`);
  }
  if (def.apiKeyUrl && !/^https:\/\//.test(def.apiKeyUrl)) fail(`${where}: apiKeyUrl must be https`);

  checkHeaders(where, def.headers);
  checkIcon(where, dir, c.icon);

  if (c.kind === "service" && def.toolDefinition) {
    try {
      if (!JSON.parse(def.toolDefinition).name) fail(`${where}: toolDefinition JSON has no "name"`);
    } catch (e) {
      fail(`${where}: toolDefinition is not valid JSON — ${e.message}`);
    }
  }
}

// ── drift gate: manifest.json must match the folders ────────────────────────
try {
  execFileSync("node", [path.join(root, "scripts", "build-manifest.mjs"), "--check"], { stdio: "pipe" });
} catch (e) {
  fail("manifest.json is out of date with connectors/ — run: node scripts/build-manifest.mjs");
}

// ── report ──────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):\n`);
  for (const e of errors) console.error("  • " + e);
  process.exit(1);
}
console.log(`✓ ${count} connectors valid; manifest.json up to date.`);
