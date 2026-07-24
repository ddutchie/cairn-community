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
    (c.kind === "service" ? services : mcpServers).push(entry);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    mcpServers,
    services,
  };
}

const built = build();
const json = JSON.stringify(built, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  // Ignore updatedAt drift (timestamp changes every build); compare the rest.
  const strip = (s) => s.replace(/"updatedAt":\s*"[^"]*"/, '"updatedAt":"X"');
  if (strip(current) !== strip(json)) {
    console.error("✗ manifest.json is out of date -- run: node scripts/build-manifest.mjs");
    process.exit(1);
  }
  console.log("✓ manifest.json is up to date");
} else {
  fs.writeFileSync(manifestPath, json, "utf8");
  console.log(`✓ built manifest.json -- ${built.mcpServers.length} MCP + ${built.services.length} services`);
}
