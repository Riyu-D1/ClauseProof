import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseWithGrok } from "@/lib/live-llm";
import { normalizeScenario, parseScenarioLocal } from "@/lib/live-scenario";
import { runLiveScenario } from "@/lib/live-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RUN_SCRIPT = join(resolve(process.cwd(), ".."), "system", "run");

/**
 * POST /api/live
 *  { mode: "parse", text, parser? } → { scenario, parser, parse_ms, notes }
 *  { mode: "run",   scenario }      → { scenario, result }
 *  { mode: "go",    text, parser? } → parse + run in one round-trip
 *
 * Parsing defaults to the instant local parser. parser:"grok" opts into the
 * LLM parser, which has a hard 6s timeout and silently falls back to local —
 * it can never block the run. The verdict always comes from the
 * deterministic engine (system/run); parsing only fills the editable card.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = String(b.mode ?? "");
  const wantsGrok = String(b.parser ?? "") === "grok";

  if (!existsSync(RUN_SCRIPT)) {
    return NextResponse.json(
      { error: "engine not found on this machine" },
      { status: 500 }
    );
  }

  try {
    if (mode === "parse" || mode === "go") {
      const text = String(b.text ?? "").trim();
      if (!text || text.length > 3000) {
        return NextResponse.json(
          { error: "describe the customer and their money in a sentence or two" },
          { status: 400 }
        );
      }
      let parsed;
      let parse_ms: number | null;
      if (wantsGrok) {
        const g = await parseWithGrok(text);
        parsed = g.outcome;
        parse_ms = g.ms;
      } else {
        const t0 = Date.now();
        parsed = parseScenarioLocal(text);
        parse_ms = Date.now() - t0;
      }
      if (mode === "parse") {
        return NextResponse.json(
          { ...parsed, parse_ms },
          { headers: { "cache-control": "no-store" } }
        );
      }
      const result = await runLiveScenario(parsed.scenario);
      return NextResponse.json(
        { ...parsed, parse_ms, result },
        { headers: { "cache-control": "no-store" } }
      );
    }

    if (mode === "run") {
      const scenario = normalizeScenario(b.scenario);
      const result = await runLiveScenario(scenario);
      return NextResponse.json(
        { scenario, result },
        { headers: { "cache-control": "no-store" } }
      );
    }

    return NextResponse.json({ error: "unknown mode" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "engine failed" },
      { status: 500 }
    );
  }
}
