#!/usr/bin/env node
/**
 * link-check.mjs — crawl every nav route plus three case pages, then follow
 * every internal link those pages expose and assert none of them 404s.
 *
 *   node scripts/link-check.mjs [base_url]   (default http://localhost:3000)
 *
 * Exit 0 when every check passes, 1 otherwise.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] || process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(WEB, "public", "data");

const NAV_ROUTES = ["/", "/queue", "/live", "/stage", "/proof"];
let pass = 0;
let fail = 0;

const ok = (m) => { console.log(`  PASS ${m}`); pass += 1; };
const bad = (m) => { console.log(`  FAIL ${m}`); fail += 1; };

// three real case pages — one per verdict, read from the queue data
function pickCases() {
  const want = { CLOSE: null, RFI: null, ESCALATE: null };
  for (const inst of ["bank", "emoney", "investment", "payments_fx"]) {
    const p = join(DATA, `${inst}.json`);
    if (!existsSync(p)) continue;
    for (const t of JSON.parse(readFileSync(p, "utf8"))) {
      if (want[t.verdict] === null) want[t.verdict] = t.case_id;
    }
  }
  return Object.values(want).filter(Boolean);
}

async function get(url) {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { code: res.status, text };
  } catch (e) {
    return { code: 0, text: String(e) };
  }
}

const seen = new Set();
const internalLinks = new Set();

async function checkRoute(route, collect = true) {
  const { code, text } = await get(`${BASE}${route}`);
  if (code === 200) ok(`GET ${route} → 200`);
  else bad(`GET ${route} → ${code}`);
  if (!collect || code !== 200) return;
  for (const m of text.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const path = href.split("#")[0].split("?")[0] || "/";
    if (path.startsWith("/data/") || path.startsWith("/_next") || path.startsWith("/api/")) continue;
    internalLinks.add(path);
  }
}

console.log(`link-check ${BASE}`);
const cases = pickCases();
const routes = [...NAV_ROUTES, ...cases.map((c) => `/case/${c}`)];
if (cases.length < 3) console.log(`  (note: only ${cases.length} case ids found in public/data)`);
for (const r of routes) await checkRoute(r);

console.log(`  — ${internalLinks.size} internal links found on those pages`);
for (const link of [...internalLinks].sort()) {
  if (seen.has(link)) continue;
  seen.add(link);
  const { code } = await get(`${BASE}${link}`);
  if (code === 200) ok(`GET ${link} → 200`);
  else bad(`GET ${link} → ${code}`);
}

console.log(fail === 0 ? `\nLINK-CHECK: ALL ${pass} CHECKS PASSED` : `\nLINK-CHECK: ${pass} passed, ${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
