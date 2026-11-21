// Live OSINT enrichment for the demo UI — CONTEXT ONLY.
// Results never reach the scored engine: verdict, reason_code and evidence
// are produced offline by system/ and are unchanged by anything here.
//
// Key hygiene: TAVILY_API_KEY is read from process.env or the repo-root .env
// (a symlink). The value is never logged, cached, or returned to the client.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type OsintSubjectKind = "entity" | "country";

export interface OsintSubject {
  kind: OsintSubjectKind;
  name: string;
}

export interface OsintFinding {
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface OsintQueryResult {
  label: string;
  query: string;
  cached: boolean;
  answer: string | null;
  findings: OsintFinding[];
  error?: string;
}

export type OsintSignal = "clean" | "namesake" | "adverse";

export interface OsintReport {
  ok: boolean;
  offline?: boolean;
  offline_reason?: string;
  subject?: OsintSubject;
  signal?: OsintSignal;
  signal_label?: string;
  queries?: OsintQueryResult[];
  took_ms?: number;
}

const TAVILY_URL = "https://api.tavily.com/search";
const MAX_LIVE_CALLS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_DIR = join(process.cwd(), ".cache", "osint");

// ---------------------------------------------------------------- key loading

export function loadTavilyKey(): string | null {
  const fromEnv = process.env.TAVILY_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(resolve(process.cwd(), "..", ".env"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?TAVILY_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) {
        const v = m[1].replace(/^["']|["']$/g, "").trim();
        if (v && !v.startsWith("#")) return v;
      }
    }
  } catch {
    // no readable .env — offline mode
  }
  return null;
}

// ---------------------------------------------------------------- queries

export function buildQueries(subject: OsintSubject): { label: string; query: string }[] {
  const name = subject.name.trim();
  if (subject.kind === "country") {
    return [
      {
        label: "FATF status",
        query: `${name} FATF grey list OR black list increased monitoring high-risk jurisdiction`,
      },
      {
        label: "UK higher-risk list",
        query: `${name} UK "high-risk third country" money laundering regulations schedule 3ZA`,
      },
    ];
  }
  return [
    {
      label: "Registration / reality check",
      query: `"${name}" company OR incorporated OR "companies house" OR director OR registered`,
    },
    {
      label: "Adverse media",
      query: `"${name}" fraud OR scam OR sanctions OR "money laundering" OR fined OR prosecuted`,
    },
  ];
}

// ---------------------------------------------------------------- disk cache

function cachePath(query: string): string {
  const h = createHash("sha256").update(query.trim().toLowerCase()).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${h}.json`);
}

function readCache(query: string): OsintQueryResult | null {
  const p = cachePath(query);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as { result?: OsintQueryResult };
    if (raw.result) return { ...raw.result, cached: true };
  } catch {
    // corrupt cache entry — refetch
  }
  return null;
}

function writeCache(query: string, result: OsintQueryResult): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(
      cachePath(query),
      JSON.stringify({ query, fetched_at: new Date().toISOString(), result }, null, 2)
    );
  } catch {
    // cache is best-effort; never fail a lookup over it
  }
}

// ---------------------------------------------------------------- tavily

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function tavilySearch(query: string, key: string): Promise<OsintQueryResult> {
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tavily_http_${res.status}`);
  const data = (await res.json()) as { answer?: string; results?: TavilyResult[] };
  const findings: OsintFinding[] = (data.results ?? []).slice(0, 5).map((r) => ({
    title: r.title ?? r.url ?? "(untitled)",
    url: r.url ?? "",
    domain: domainOf(r.url ?? ""),
    snippet: (r.content ?? "").slice(0, 320),
  }));
  return { label: "", query, cached: false, answer: data.answer ?? null, findings };
}

// ---------------------------------------------------------------- signal

const ADVERSE =
  /\b(fraud|scam|sanction(?:ed|s)?|money[- ]launder|laundering|fined|penalt|convict|arrest|charged|indict|terror|briber|corrupt|ponzi|phishing|grey[- ]?list|black ?list|blacklisted|high[- ]risk|embargo|seized|prosecut|debarred|wanted|crime|criminal|theft|stolen)\b/i;

function queryHasAdverse(r: OsintQueryResult): boolean {
  const hay = [r.answer ?? "", ...r.findings.map((f) => `${f.title} ${f.snippet}`)].join(" ");
  return ADVERSE.test(hay);
}

function classify(
  subject: OsintSubject,
  queries: OsintQueryResult[]
): { signal: OsintSignal; label: string } {
  const anyHits = queries.some((q) => q.findings.length > 0 || q.answer);
  const anyAdverse = queries.some(queryHasAdverse);
  if (anyAdverse) {
    return {
      signal: "adverse",
      label:
        subject.kind === "country"
          ? "Higher-risk indicators found"
          : "Adverse findings — check for namesakes",
    };
  }
  if (subject.kind === "entity" && anyHits) {
    return { signal: "namesake", label: "Possible namesake hits" };
  }
  return { signal: "clean", label: "No adverse findings" };
}

// ---------------------------------------------------------------- entry point

export async function researchSubject(subject: OsintSubject): Promise<OsintReport> {
  const started = Date.now();
  const key = loadTavilyKey();
  if (!key) {
    return { ok: false, offline: true, offline_reason: "no_api_key" };
  }

  const plan = buildQueries(subject).slice(0, MAX_LIVE_CALLS);
  let liveCalls = 0;
  const results: OsintQueryResult[] = [];

  for (const { label, query } of plan) {
    const hit = readCache(query);
    if (hit) {
      results.push({ ...hit, label });
      continue;
    }
    if (liveCalls >= MAX_LIVE_CALLS) break;
    liveCalls += 1;
    try {
      const fresh = await tavilySearch(query, key);
      writeCache(query, fresh);
      results.push({ ...fresh, label });
    } catch (e) {
      results.push({
        label,
        query,
        cached: false,
        answer: null,
        findings: [],
        error: e instanceof Error ? e.message : "fetch_failed",
      });
    }
  }

  const anyData = results.some((r) => r.findings.length > 0 || r.answer);
  if (!anyData && results.every((r) => r.error)) {
    return { ok: false, offline: true, offline_reason: "upstream_unreachable" };
  }

  const { signal, label } = classify(subject, results);
  return {
    ok: true,
    subject,
    signal,
    signal_label: label,
    queries: results,
    took_ms: Date.now() - started,
  };
}
