import { NextRequest, NextResponse } from "next/server";
import { decideCaseLive } from "@/lib/case-run";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/decide { case_id }
 * Rebuilds a one-case institution folder from the untouched dataset rows
 * and runs the real engine (system/run) on it now. Returns the verdict and
 * full trace so the case page can show "decided live just now in X ms" —
 * and honestly flag any difference from the pre-computed result.
 */
export async function POST(req: NextRequest) {
  let caseId = "";
  try {
    caseId = String((await req.json())?.case_id ?? "");
  } catch {
    /* fall through to validation */
  }
  if (!/^[A-Za-z0-9-]{3,40}$/.test(caseId)) {
    return NextResponse.json({ error: "bad case_id" }, { status: 400 });
  }
  try {
    const result = await decideCaseLive(caseId);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /not in the dataset/.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
