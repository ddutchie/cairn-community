#!/usr/bin/env node
/**
 * Live credit-endpoint probe for AI providers in the community registry.
 *
 * For every provider whose `definition.credits` descriptor is set AND whose API
 * key is available in env, hits `credits.url` and verifies the response is 2xx
 * and parses into the declared `shape`. Providers without a key are skipped.
 * Providers WITHOUT a descriptor (e.g. merge) plus the non-manifest `opencode`
 * entry get an informational `{base}/v1/key` probe when their key is set, so
 * the output doubles as a discovery report for adding new descriptors.
 *
 * Keys come from process.env, or a gitignored `.env.test` at the repo root
 * (copy `.env.test.example`). Set any subset — unset ones are skipped.
 *
 * Exit codes: 0 = all configured providers passed (or none configured)
 *             1 = at least one configured provider failed its check
 *             2 = usage/load error
 *
 * Run:   node scripts/test-credits.mjs
 * CI:    none — requires real keys, run manually before shipping a descriptor.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── env: load a gitignored .env.test (if any), process.env wins ─────────────
const envFile = path.join(root, ".env.test");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const TIMEOUT_MS = 12_000;

/** Provider id → env var for the API key. Unknown providers fall back to
 *  `<SLUG>_API_KEY` (id after "provider-", upper-snake). */
const KEY_ENV = {
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  neuralwatt: "NEURALWATT_API_KEY",
  merge: "MERGE_API_KEY",
  "provider-openai": "OPENAI_API_KEY",
  "provider-openrouter": "OPENROUTER_API_KEY",
  "provider-deepseek": "DEEPSEEK_API_KEY",
  "provider-neuralwatt": "NEURALWATT_API_KEY",
  "provider-merge": "MERGE_API_KEY",
};

function keyEnvFor(id) {
  if (KEY_ENV[id]) return KEY_ENV[id];
  return `${id.replace(/^provider-/, "").replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

/** Mirror of Cairn's buildApiUrl (electron/lib/llm.ts): append the path under
 *  /v1 unless the base already carries a versioned segment. */
function buildApiUrl(baseUrl, p) {
  const base = baseUrl.replace(/\/+$/, "");
  const cleanPath = p.replace(/^\/+/, "");
  let pathname;
  try {
    pathname = new URL(/^https?:\/\//i.test(base) ? base : `http://${base}`).pathname;
  } catch {
    pathname = base;
  }
  const hasVersion = /(^|\/)v\d+(\/|$)/.test(pathname);
  return hasVersion ? `${base}/${cleanPath}` : `${base}/v1/${cleanPath}`;
}

// ── shape checkers (contract-level; the Cairn app parses for display) ───────
const SHAPE_CHECKS = {
  openrouter(json) {
    const d = json?.data;
    if (!d || typeof d !== "object") return null;
    const n = (v) => (typeof v === "number" ? v : null);
    const usage = n(d.usage);
    const limit = n(d.limit);
    const remaining = n(d.limit_remaining) ?? (limit != null && usage != null ? limit - usage : null);
    return { remaining, usage, limit, isFreeTier: typeof d.is_free_tier === "boolean" ? d.is_free_tier : null };
  },
  deepseek(json) {
    const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
    if (infos.length === 0) return null;
    const row = infos.find((i) => i?.currency === "USD") ?? infos[0];
    const remaining = typeof row?.total_balance === "string" ? Number.parseFloat(row.total_balance) : NaN;
    if (Number.isNaN(remaining)) return null;
    return { remaining, usage: null, limit: null, isFreeTier: json.is_available == null ? null : json.is_available === false };
  },
  "openai-grants"(json) {
    const raw = json?.total_available;
    const remaining = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : NaN;
    if (Number.isNaN(remaining)) return null;
    return { remaining, usage: null, limit: null, isFreeTier: null };
  },
  neuralwatt(json) {
    const b = json?.balance;
    if (!b || typeof b !== "object") return null;
    const read = (v) => (typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN);
    const remaining = read(b.credits_remaining_usd);
    const limit = read(b.total_credits_usd);
    const usage = read(b.credits_used_usd);
    const ok = (n) => (Number.isNaN(n) ? null : n);
    if (ok(remaining) == null && ok(limit) == null && ok(usage) == null) return null;
    return { remaining: ok(remaining), usage: ok(usage), limit: ok(limit), isFreeTier: null };
  },
  merge(json) {
    if (!json || typeof json !== "object") return null;
    const n = (v) => (typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : null);
    const usage = n(json.usage);
    const limit = n(json.limit);
    const remaining = n(json.limit_remaining) ?? (limit != null && usage != null ? limit - usage : null);
    if (remaining == null && usage == null && limit == null) return null;
    return { remaining, usage, limit, isFreeTier: null };
  },
};

const failures = [];
const skips = [];
const infos = [];

const fmtMoney = (n, currency = "USD") => (n == null ? "n/a" : currency === "CNY" ? `¥${n.toFixed(2)}` : `$${n.toFixed(2)}`);
const summarize = (info) => {
  if (!info) return "unparseable";
  const parts = [`${fmtMoney(info.remaining)} left`];
  if (info.usage != null) parts.push(`${fmtMoney(info.usage)} used`);
  if (info.limit != null) parts.push(`of ${fmtMoney(info.limit)}`);
  if (info.isFreeTier != null) parts.push(info.isFreeTier ? "free tier" : "paid");
  return parts.join(" · ");
};

async function probe(url, key, signal) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal });
  const json = res.headers.get("content-type")?.includes("json")
    ? await res.json().catch(() => null)
    : null;
  return { status: res.status, json };
}

async function run() {
  let providers;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "providers.json"), "utf8"));
    providers = raw.providers;
  } catch (e) {
    console.error(`✗ could not load providers.json (run "npm run build" first): ${e.message}`);
    process.exit(2);
  }

  // ── providers WITH a credits descriptor ─────────────────────────────────
  for (const p of providers) {
    const spec = p.definition?.credits;
    if (!spec) continue;
    const env = keyEnvFor(p.id);
    const key = process.env[env];
    if (!key) {
      skips.push(`${p.id} (set ${env})`);
      continue;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let probeResult;
    try {
      probeResult = await probe(spec.url, key, ac.signal);
    } catch (e) {
      failures.push(`${p.id} — ${spec.url} could not be reached (${e.name === "AbortError" ? "timeout" : e.message})`);
      continue;
    } finally {
      clearTimeout(timer);
    }
    const { status, json } = probeResult;
    const check = SHAPE_CHECKS[spec.shape];
    const info = check && status >= 200 && status < 300 ? check(json) : null;
    if (info) {
      console.log(`✓ ${p.id} — ${summarize(info)} (${status})`);
    } else {
      failures.push(`${p.id} — ${spec.url} expected 2xx + ${spec.shape} shape, got HTTP ${status}${json ? ` ${JSON.stringify(json).slice(0, 120)}` : ""}`);
    }
  }

  // ── informational probes: no-descriptor providers with a key ─────────────
  const probeInfo = async (label, baseUrl, key, shape) => {
    const url = buildApiUrl(baseUrl, "key");
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let status = 0;
    let json = null;
    try {
      const r = await probe(url, key, ac.signal);
      status = r.status;
      json = r.json;
    } catch {
      /* network error → status stays 0 */
    } finally {
      clearTimeout(timer);
    }
    const check = SHAPE_CHECKS[shape];
    const info = check && status >= 200 && status < 300 ? check(json) : null;
    infos.push(`${label} — ${url} → HTTP ${status || "n/a"}${info ? ` (${summarize(info)})` : ""}`);
  };

  const noDescriptor = providers.filter((p) => !p.definition?.credits);
  for (const p of noDescriptor) {
    const env = keyEnvFor(p.id);
    const key = process.env[env];
    if (!key) continue;
    await probeInfo(p.id, p.definition.baseUrl, key, "openrouter");
  }
  if (process.env.OPENCODE_API_KEY) {
    await probeInfo("provider-opencode", process.env.OPENCODE_BASE_URL || "https://opencode.ai", process.env.OPENCODE_API_KEY, "openrouter");
  }

  // ── report ─────────────────────────────────────────────────────────────
  for (const line of infos) console.log(`ℹ ${line}`);
  if (skips.length) console.log(`\n(skipped, no key set: ${skips.join(", ")})`);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} provider(s) failed:\n`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }
  console.log("\n✓ all configured credit endpoints returned parseable balances");
}

run().catch((e) => {
  console.error(`✗ unexpected error: ${e.message}`);
  process.exit(2);
});
