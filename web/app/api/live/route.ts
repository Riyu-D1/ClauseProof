import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseScenario, configuredLlmTag } from "@/lib/live-llm";
import { normalizeScenario } from "@/lib/live-scenario";
import { runLiveScenario } from "@/lib/live-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RUN_SCRIPT = join(resolve(process.cwd(), ".."), "system", "run");

/**
 * POST /api/live
 *  { mode: "parse", text, useLlm? }  → { scenario, parser, notes, parseMs, llmTag }
 *  { mode: "run",   scenario }       → { scenario, result }
 *  { mode: "go",    text, useLlm? }  → parse + run in one round-trip
 * The verdict always comes from the deterministic engine (system/run);
 * parsing only fills the editable scenario card.
 *
 * Runs happen only when the client explicitly asks — this route never
 * schedules, polls or chains calls.
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
  const useLlm = b.useLlm !== false;
  const llmTag = configuredLlmTag();

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
      const parsed = await parseScenario(text, { useLlm });
      const payload = {
        scenario: parsed.scenario,
        parser: parsed.parser,
        notes: parsed.notes,
        parseMs: parsed.ms ?? null,
        llmTag,
      };
      if (mode === "parse") {
        return NextResponse.json(payload, {
          headers: { "cache-control": "no-store" },
        });
      }
      const result = await runLiveScenario(parsed.scenario);
      return NextResponse.json(
        { ...payload, result },
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
