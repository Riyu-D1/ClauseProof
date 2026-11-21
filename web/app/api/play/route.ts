import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateInput } from "@/lib/play";
import { getFeed, rateLimit, submitPlay } from "@/lib/play-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RUN_SCRIPT = join(resolve(process.cwd(), ".."), "system", "run");

/**
 * GET /api/play — feed for the stage screen (latest attempt + leaderboard).
 * POST /api/play — submit a play; runs the real engine on a synthetic case.
 */
export function GET() {
  return NextResponse.json(getFeed(), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  const v = validateInput(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  const { input, persona, dest } = v;

  const limited = rateLimit(input.deviceId);
  if (limited) {
    return NextResponse.json({ error: limited }, { status: 429 });
  }
  if (!existsSync(RUN_SCRIPT)) {
    return NextResponse.json({ error: "engine not found on this machine" }, { status: 500 });
  }

  try {
    const { attempt, ranEngine } = await submitPlay(input, persona, dest);
    return NextResponse.json({
      ok: true,
      attempt_id: attempt.id,
      bucket: attempt.bucket,
      verdict: attempt.verdict,
      reason_code: attempt.reason_code,
      reason: attempt.reason,
      evidence: attempt.evidence,
      alerts: attempt.alerts,
      flip: attempt.flip,
      context: attempt.context,
      summary: attempt.summary,
      synthetic: "player-made",
      ran_engine: ranEngine,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "engine failed" },
      { status: 500 }
    );
  }
}
