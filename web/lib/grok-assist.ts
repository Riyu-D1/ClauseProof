// Grok-assist layer helpers for the web app.
//
// The engine's Grok reader is opt-in: `system/run --grok` or a configured
// XAI_API_KEY. It only READS evidence the deterministic parser could not
// classify — it never decides a verdict. Every answer is cached on disk by
// sha256(model | prompt_version | input bytes), so warm runs replay
// byte-identical output. Keys live only in server env; they never reach
// the client.
//
// The /run upload page uses this in one line:
//   <GrokAssistPanel summary={run.grok} onToggle={(on)=>setGrok(on)} />
// and passes "--grok" to the engine spawn when the switch is on.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GrokSummary {
  enabled: boolean;
  key_configured: boolean;
  model: string;
  prompt_version: string;
  docs_and_rules_examined: number;
  docs_read_by_grok: number;
  api_calls: number;
  cache_hits: number;
  invalid_answers: number;
  call_failures: number;
  budget_stops: number;
  budget: number;
  cache_dir: string;
}

export interface GrokTraceDoc {
  assisted_by: "grok";
  cache_key: string;
  note: string | null;
}

export interface GrokTraceRule {
  assisted_by: "grok";
  cache_key: string;
  measures: string;
  threshold_gbp: number | null;
  window_days: number | null;
  typical_risk: string;
}

export interface GrokTraceBlock {
  docs: Record<string, GrokTraceDoc>;
  rules: Record<string, GrokTraceRule>;
}

/** Server-side: is an xAI key configured for this process? */
export function grokKeyConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

export function grokModel(): string {
  return process.env.XAI_MODEL || "grok-4.20-0309-non-reasoning";
}

/** Extra argv for the engine spawn when the user enables the switch. */
export function grokEngineArgs(enabled: boolean): string[] {
  return enabled ? ["--grok"] : [];
}

/**
 * Read <outdir>/grok_summary.json written by a `--grok` engine run.
 * Returns null when the run had no assist or the file is absent.
 */
export function readGrokSummary(outdir: string): GrokSummary | null {
  const p = join(outdir, "grok_summary.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as GrokSummary;
  } catch {
    return null;
  }
}

/** Per-trace provenance: which doc_ids were read by Grok. */
export function grokDocIds(trace: {
  grok?: GrokTraceBlock | null;
}): Set<string> {
  return new Set(Object.keys(trace?.grok?.docs ?? {}));
}
