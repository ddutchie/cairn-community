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
  "AI Providers",
]);

// Personalities use their OWN category set — a one-off fixed list of Browse
// chips, distinct from the connector categories above.
const PERSONALITY_CATEGORIES = new Set([
  "Tone & Style",
  "Planning & Strategy",
  "Execution",
  "Learning",
  "Technical",
  "Critique & Review",
  "Assistant",
  "Fun & Playful",
]);

// Chat themes use their OWN category set (Appearance) and get an AA-contrast
// gate on the user bubble fill vs its fg (WCAG 4.5:1 for normal text).
const THEME_CATEGORIES = new Set(["Appearance"]);
const THEME_FONTS = new Set(["sans", "serif", "mono"]);
const THEME_BG_TYPES = new Set(["solid", "gradient", "pattern"]);
const THEME_BUBBLE_STYLES = new Set(["filled", "glass", "outlined"]);

function hexLuminance(hex) {
  if (typeof hex !== "string") return 0;
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.9; // non-hex (e.g. rgba glass) — assume lightish, skip the gate
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrastRatio(a, b) {
  const [l1, l2] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

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

function findConnectorDirs(baseDir) {
  const results = [];
  if (!fs.existsSync(baseDir)) return results;
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findConnectorDirs(fullPath));
    } else if (entry.isFile() && entry.name === "connector.json") {
      results.push(fullPath);
    }
  }
  return results;
}

// Pre-pass: collect the MCP + service catalogs so automation `requires` can
// reference connectors by id (slug) or display name. Other kinds are excluded.
const mcpCatalog = [];
const serviceCatalog = [];
for (const jsonPath of findConnectorDirs(connectorsDir)) {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    continue;
  }
  if (!c.definition?.name) continue;
  if (c.kind === "mcp") mcpCatalog.push({ id: path.basename(path.dirname(jsonPath)), name: c.definition.name });
  else if (c.kind === "service") serviceCatalog.push({ id: path.basename(path.dirname(jsonPath)), name: c.definition.name });
}

// ── validate every connector folder ────────────────────────────────────────
if (!fs.existsSync(connectorsDir)) {
  console.error("✗ connectors/ directory missing");
  process.exit(1);
}
const names = { mcp: new Map(), service: new Map(), command: new Map(), provider: new Map(), automation: new Map(), personality: new Map(), theme: new Map() };
let count = 0;
const jsonPaths = findConnectorDirs(connectorsDir).sort((a, b) =>
  path.basename(path.dirname(a)).localeCompare(path.basename(path.dirname(b)))
);
for (const jsonPath of jsonPaths) {
  const dir = path.dirname(jsonPath);
  const id = path.basename(dir);
  const relPath = path.relative(root, jsonPath);
  const where = relPath;
  let c;
  try {
    c = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (e) {
    fail(`${where}: invalid JSON — ${e.message}`);
    continue;
  }
  count++;

  if (c.kind !== "mcp" && c.kind !== "service" && c.kind !== "command" && c.kind !== "provider" && c.kind !== "automation" && c.kind !== "personality" && c.kind !== "theme") fail(`${where}: kind must be "mcp", "service", "command", "provider", "automation", "personality", or "theme"`);
  if (!c.blurb) fail(`${where}: missing blurb`);
  if (c.kind === "personality") {
    if (!PERSONALITY_CATEGORIES.has(c.category)) {
      fail(`${where}: personality category must be one of ${[...PERSONALITY_CATEGORIES].join(" | ")} (got ${JSON.stringify(c.category)})`);
    }
  } else if (c.kind === "theme") {
    if (!THEME_CATEGORIES.has(c.category)) {
      fail(`${where}: theme category must be one of ${[...THEME_CATEGORIES].join(" | ")} (got ${JSON.stringify(c.category)})`);
    }
  } else if (!CATEGORIES.has(c.category)) {
    fail(`${where}: category must be one of ${[...CATEGORIES].join(" | ")} (got ${JSON.stringify(c.category)})`);
  }
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

  // ── personality entries: custom chat system-prompt snippet ──
  if (c.kind === "personality") {
    if (typeof def.name !== "string" || def.name.trim().length === 0) {
      fail(`${where}: personality definition.name must be a non-empty string`);
    }
    if (def.description !== undefined && typeof def.description !== "string") {
      fail(`${where}: personality definition.description must be a string`);
    }
    // Behavioral RULES, not a one-line label — a personality is appended
    // verbatim to the chat system prompt, so a thin prompt adds nothing.
    if (typeof def.prompt !== "string" || def.prompt.trim().length === 0) {
      fail(`${where}: personality definition.prompt must be a non-empty string`);
    } else if (def.prompt.trim().length < 20) {
      fail(`${where}: personality definition.prompt must be behavioral rules (20+ chars), not a one-liner`);
    }
    // A personality is a STYLE LAYER on the existing Cairn assistant identity —
    // it must not open with its own "You are …" identity claim, which would
    // contradict the base "You are the Cairn AI assistant" system prompt.
    if (typeof def.prompt === "string" && /^you\s+are/i.test(def.prompt.trim())) {
      fail(`${where}: personality definition.prompt must not start with a "You are …" identity claim — the base Cairn prompt already establishes the assistant identity. Write behavioral rules only.`);
    }
    const perKey = String(def.name || "").toLowerCase();
    if (names.personality.has(perKey)) fail(`${where}: duplicate personality name "${def.name}" (also ${names.personality.get(perKey)})`);
    else names.personality.set(perKey, id);
    checkIcon(where, dir, c.icon);
    continue;
  }

  // ── theme entries: chat surface look; validate shape + AA contrast ──
  if (c.kind === "theme") {
    if (typeof def.name !== "string" || def.name.trim().length === 0) {
      fail(`${where}: theme definition.name must be a non-empty string`);
    }
    if (!THEME_FONTS.has(def.font)) {
      fail(`${where}: theme definition.font must be one of ${[...THEME_FONTS].join(" | ")} (got ${JSON.stringify(def.font)})`);
    }
    if (!THEME_BG_TYPES.has(def.bgType)) {
      fail(`${where}: theme definition.bgType must be one of ${[...THEME_BG_TYPES].join(" | ")} (got ${JSON.stringify(def.bgType)})`);
    }
    if (!THEME_BUBBLE_STYLES.has(def.bubbleStyle)) {
      fail(`${where}: theme definition.bubbleStyle must be one of ${[...THEME_BUBBLE_STYLES].join(" | ")} (got ${JSON.stringify(def.bubbleStyle)})`);
    }
    // dark + light palettes, each with bg + bubbles; gradient requires both stops.
    for (const mode of ["dark", "light"]) {
      const m = def[mode];
      if (!m || typeof m !== "object") {
        fail(`${where}: theme definition.${mode} is required`);
        continue;
      }
      if (typeof m.bg !== "string" || m.bg.trim().length === 0) {
        fail(`${where}: theme definition.${mode}.bg must be a non-empty string`);
      }
      for (const key of ["userBubble", "userBubbleFg", "aiBubble"]) {
        if (typeof m[key] !== "string" || m[key].trim().length === 0) {
          fail(`${where}: theme definition.${mode}.${key} must be a non-empty string`);
        }
      }
      if (def.bgType === "gradient") {
        const g = m.gradient;
        if (!Array.isArray(g) || g.length !== 2 || g.some((s) => typeof s !== "string" || !s.trim())) {
          fail(`${where}: theme definition.${mode}.gradient must be [from, to] when bgType is "gradient"`);
        }
      }
      // AA gate: user bubble fill vs its fg (4.5:1 for normal text). Only hex
      // pairs are checked — translucent glass fills skip (the app tints over
      // the bg). Both dark and light must pass.
      const user = m.userBubble;
      const fg = m.userBubbleFg;
      if (/^#[0-9a-f]{6}$/i.test(user) && /^#[0-9a-f]{6}$/i.test(fg)) {
        const r = contrastRatio(user, fg);
        if (r < 4.5) {
          fail(`${where}: theme definition.${mode} user bubble ${user} vs fg ${fg} is ${r.toFixed(2)}:1 — must be ≥4.5:1 (WCAG AA)`);
        }
      }
    }
    const themeKey = String(def.name || "").toLowerCase();
    if (names.theme.has(themeKey)) fail(`${where}: duplicate theme name "${def.name}" (also ${names.theme.get(themeKey)})`);
    else names.theme.set(themeKey, id);
    checkIcon(where, dir, c.icon);
    continue;
  }

  // ── automation entries: scheduled recipe; validate shape + schedule ──
  if (c.kind === "automation") {
    if (typeof def.name !== "string" || def.name.trim().length === 0) {
      fail(`${where}: automation definition.name must be a non-empty string`);
    }
    if (typeof def.instructions !== "string" || def.instructions.trim().length < 10) {
      fail(`${where}: automation definition.instructions must be a non-empty string (10+ chars)`);
    }
    const sched = def.schedule;
    if (!sched || typeof sched !== "object") {
      fail(`${where}: automation definition.schedule is required`);
    } else {
      if (!["cron", "every", "once"].includes(sched.kind)) {
        fail(`${where}: automation schedule.kind must be "cron", "every", or "once" (got ${JSON.stringify(sched.kind)})`);
      }
      if (typeof sched.expr !== "string" || sched.expr.trim().length === 0) {
        fail(`${where}: automation schedule.expr must be a non-empty string`);
      }
      if (sched.timezone !== undefined && typeof sched.timezone !== "string") {
        fail(`${where}: automation schedule.timezone must be a string`);
      }
    }
    if (def.approvalMode !== undefined && !["auto", "ask"].includes(def.approvalMode)) {
      fail(`${where}: automation definition.approvalMode must be "auto" or "ask" (got ${JSON.stringify(def.approvalMode)})`);
    }
    if (def.maxRuns !== undefined && (typeof def.maxRuns !== "number" || def.maxRuns < 1)) {
      fail(`${where}: automation definition.maxRuns must be a positive number`);
    }
    // ── required connectors: shape + existence in the catalog ──
    if (def.requires !== undefined) {
      if (!Array.isArray(def.requires)) {
        fail(`${where}: automation definition.requires must be an array of {kind, name}`);
      } else {
        for (const req of def.requires) {
          if (!req || typeof req !== "object") {
            fail(`${where}: automation definition.requires entries must be objects`);
            continue;
          }
          const { kind, name } = req;
          if (!["mcp", "service"].includes(kind)) {
            fail(`${where}: automation requires.kind must be "mcp" or "service" (got ${JSON.stringify(kind)})`);
            continue;
          }
          if (typeof name !== "string" || name.trim().length === 0) {
            fail(`${where}: automation requires.name must be a non-empty string`);
            continue;
          }
          // The referenced connector must exist in the catalog as a catalog id
          // (folder slug) or a display definition.name of the matching kind.
          const catalog = kind === "mcp" ? mcpCatalog : serviceCatalog;
          const key = name.toLowerCase();
          if (!catalog.some((c) => c.id.toLowerCase() === key || String(c.name || "").toLowerCase() === key)) {
            fail(`${where}: automation requires "${name}" (${kind}) is not in the catalog — add the connector or fix the name`);
          }
        }
      }
    }
    const autoKey = String(def.name || "").toLowerCase();
    if (names.automation.has(autoKey)) fail(`${where}: duplicate automation name "${def.name}" (also ${names.automation.get(autoKey)})`);
    else names.automation.set(autoKey, id);
    checkIcon(where, dir, c.icon);
    continue;
  }

  // ── provider entries: OpenAI-compatible preset; validate + no headers/tools ──
  if (c.kind === "provider") {    if (typeof def.needsApiKey !== "boolean") {
      fail(`${where}: provider definition.needsApiKey must be a boolean`);
    }
    if (!def.baseUrl || !/^https:\/\//.test(def.baseUrl)) {
      fail(`${where}: provider definition.baseUrl must be an https URL (got ${JSON.stringify(def.baseUrl)})`);
    }
    if (def.apiKeyUrl && !/^https:\/\//.test(def.apiKeyUrl)) fail(`${where}: apiKeyUrl must be https`);
    if (def.defaultModel !== undefined && typeof def.defaultModel !== "string") {
      fail(`${where}: provider definition.defaultModel must be a string`);
    }
    if (def.models !== undefined && (!Array.isArray(def.models) || def.models.some((m) => typeof m !== "string"))) {
      fail(`${where}: provider definition.models must be an array of strings`);
    }
    if (def.credits !== undefined) {
      const c = def.credits;
      if (typeof c !== "object" || c === null) {
        fail(`${where}: provider definition.credits must be an object`);
      } else {
        if (!c.url || !/^https:\/\//.test(c.url)) fail(`${where}: credits.url must be an https URL (got ${JSON.stringify(c.url)})`);
        const SHAPES = ["openrouter", "deepseek", "openai-grants", "neuralwatt", "merge"];
        if (!SHAPES.includes(c.shape)) fail(`${where}: credits.shape must be one of ${SHAPES.join(" | ")} (got ${JSON.stringify(c.shape)})`);
        for (const key of Object.keys(c)) {
          if (key !== "url" && key !== "shape") fail(`${where}: credits has unknown property "${key}"`);
        }
      }
    }
    const provKey = String(def.name || "").toLowerCase();
    if (names.provider.has(provKey)) fail(`${where}: duplicate provider name "${def.name}" (also ${names.provider.get(provKey)})`);
    else names.provider.set(provKey, id);
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
  fail("manifest.json / providers.json are out of date with connectors/ — run: node scripts/build-manifest.mjs");
}

// ── report ──────────────────────────────────────────────────────────────
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):\n`);
  for (const e of errors) console.error("  • " + e);
  process.exit(1);
}
console.log(`✓ ${count} connectors valid; manifest.json up to date.`);
