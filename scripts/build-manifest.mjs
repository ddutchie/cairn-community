#!/usr/bin/env node
/**
 * Compile every connectors/<id>/connector.json into manifest.json (the artifact
 * the Cairn apps fetch). Source of truth = the per-connector folders;
 * manifest.json is generated and should never be hand-edited.
 *
 * Icon resolution (in priority order), inlined as sanitized `iconSvg` on each
 * compiled entry so the app renders it directly (no runtime fetch/sanitize):
 *   1. icon.svg    -- inline SVG string in connector.json
 *   2. icon.file   -- a file next to connector.json (e.g. "icon.svg")
 *   3. icon.slug   -- logos/<slug>.svg (materialized by fetch-logos.mjs)
 *   (none)         -- no iconSvg; the app falls back (MCP glyph / plug)
 *
 * Run: node scripts/build-manifest.mjs   (or with --check to verify up-to-date)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSvg } from "./svg-sanitize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectorsDir = path.join(root, "connectors");
const logosDir = path.join(root, "logos");
const manifestPath = path.join(root, "manifest.json");
const providersPath = path.join(root, "providers.json");

function resolveIconSvg(id, dir, icon) {
  if (!icon || typeof icon !== "object") return undefined;
  let raw;
  let label = id;
  if (typeof icon.svg === "string" && icon.svg.trim()) {
    raw = icon.svg;
    label = `${id} (inline)`;
  } else if (icon.file) {
    const p = path.join(dir, String(icon.file));
    if (!fs.existsSync(p)) throw new Error(`${id}: icon.file "${icon.file}" not found`);
    raw = fs.readFileSync(p, "utf8");
    label = `${id}/${icon.file}`;
  } else if (icon.slug) {
    const p = path.join(logosDir, `${icon.slug}.svg`);
    if (!fs.existsSync(p)) {
      throw new Error(`${id}: no logo for slug "${icon.slug}" -- run fetch-logos.mjs`);
    }
    raw = fs.readFileSync(p, "utf8");
    label = `logos/${icon.slug}.svg`;
  } else {
    return undefined;
  }
  return normalizeSvg(raw, label); // sanitize + tint at compile time
}

function build() {
  const mcpServers = [];
  const services = [];
  const commands = [];
  const providers = [];
  const ids = fs.readdirSync(connectorsDir).filter((d) =>
    fs.existsSync(path.join(connectorsDir, d, "connector.json")),
  ).sort();

  for (const id of ids) {
    const dir = path.join(connectorsDir, id);
    const c = JSON.parse(fs.readFileSync(path.join(dir, "connector.json"), "utf8"));
    const iconSvg = resolveIconSvg(id, dir, c.icon);
    const entry = {
      id,
      author: c.author,
      version: c.version,
      category: c.category,
      tags: c.tags,
      blurb: c.blurb,
      brandColor: c.brandColor,
      homepage: c.homepage,
      ...(iconSvg ? { iconSvg } : {}),
      definition: c.definition,
    };
    if (c.kind === "service") services.push(entry);
    else if (c.kind === "command") commands.push(entry);
    else if (c.kind === "provider") providers.push(entry);
    else mcpServers.push(entry);
  }

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return {
    // manifest.json — MCP servers + HTTP services + slash commands.
    // v2 adds the `commands` array (community slash commands). Older Cairn
    // clients ignore unknown top-level keys, so this is backward-compatible.
    manifest: {
      version: 2,
      updatedAt: now,
      mcpServers,
      services,
      commands,
    },
    // providers.json — AI provider presets. A SEPARATE manifest so the two
    // catalogs evolve independently (fetched by Cairn's registry:fetchProviders).
    providers: {
      version: 1,
      updatedAt: now,
      providers,
    },
  };
}

const built = build();
const manifestJson = JSON.stringify(built.manifest, null, 2) + "\n";
const providersJson = JSON.stringify(built.providers, null, 2) + "\n";

if (process.argv.includes("--check")) {
  // Ignore updatedAt drift (timestamp changes every build); compare the rest.
  const strip = (s) => s.replace(/"updatedAt":\s*"[^"]*"/, '"updatedAt":"X"');
  let stale = false;
  const currentManifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  if (strip(currentManifest) !== strip(manifestJson)) {
    console.error("✗ manifest.json is out of date -- run: node scripts/build-manifest.mjs");
    stale = true;
  }
  const currentProviders = fs.existsSync(providersPath) ? fs.readFileSync(providersPath, "utf8") : "";
  if (strip(currentProviders) !== strip(providersJson)) {
    console.error("✗ providers.json is out of date -- run: node scripts/build-manifest.mjs");
    stale = true;
  }
  if (stale) process.exit(1);
  console.log("✓ manifest.json and providers.json are up to date");
} else {
  fs.writeFileSync(manifestPath, manifestJson, "utf8");
  fs.writeFileSync(providersPath, providersJson, "utf8");
  console.log(
    `✓ built manifest.json -- ${built.manifest.mcpServers.length} MCP + ${built.manifest.services.length} services + ${built.manifest.commands.length} commands`,
  );
  console.log(`✓ built providers.json -- ${built.providers.providers.length} providers`);
}
