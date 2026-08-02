#!/usr/bin/env node
/**
 * Materialize per-slug logo files from Simple Icons for any connector whose
 * connector.json uses `"icon": { "slug": "<simple-icons-slug>" }`.
 *
 * The list is DERIVED from every connectors/<id>/connector.json -- contributors never
 * edit this script. They add a connector folder with an icon.slug (or an
 * inline icon.svg / icon.file) and CI resolves everything.
 *
 * Simple Icons is CC0 1.0 (public domain); icon files are free to redistribute.
 * The brand marks remain trademarks of their owners, used nominatively here to
 * identify the connector each entry integrates with.
 *
 * Writes logos/<slug>.svg (normalized to fill="currentColor"). build-manifest.mjs
 * then inlines these into the compiled manifest. Offline-safe: a failed fetch
 * keeps any existing file.
 *
 * Run: node scripts/fetch-logos.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSvg } from "./svg-sanitize.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const connectorsDir = path.join(root, "connectors");
const logosDir = path.join(root, "logos");
const RAW = "https://raw.githubusercontent.com/simple-icons/simple-icons/master/icons";

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

function connectorSlugs() {
  const slugs = new Set();
  const files = findConnectorDirs(connectorsDir);
  for (const f of files) {
    try {
      const c = JSON.parse(fs.readFileSync(f, "utf8"));
      if (c.icon?.slug) slugs.add(String(c.icon.slug));
    } catch { /* validate.mjs reports bad JSON */ }
  }
  return [...slugs].sort();
}

async function main() {
  fs.mkdirSync(logosDir, { recursive: true });
  const slugs = connectorSlugs();
  let ok = 0;
  const errors = [];
  for (const slug of slugs) {
    const dest = path.join(logosDir, `${slug}.svg`);
    try {
      const res = await fetch(`${RAW}/${slug}.svg`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dest, normalizeSvg(await res.text(), slug) + "\n", "utf8");
      ok++;
    } catch (e) {
      errors.push(`${slug}: ${e.message}${fs.existsSync(dest) ? " (kept existing)" : " -- NO FILE"}`);
    }
  }
  console.log(`✓ fetched ${ok}/${slugs.length} Simple Icons logos`);
  if (errors.length) {
    console.error("⚠ logo fetch issues:");
    for (const e of errors) console.error("  " + e);
    if (errors.some((e) => e.includes("NO FILE"))) process.exit(1);
  }
}

main();
