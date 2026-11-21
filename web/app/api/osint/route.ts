import { NextRequest, NextResponse } from "next/server";
import { researchSubject } from "@/lib/osint";

export const dynamic = "force-dynamic";

const VALID_KIND = new Set(["entity", "country"]);
const MAX_NAME_LEN = 120;

// POST /api/osint  { kind: "entity" | "country", name: string }
// Live OSINT lookup — context only, never used in the verdict.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const kind = (body as Record<string, unknown>)?.kind;
  const rawName = (body as Record<string, unknown>)?.name;
  const name = typeof rawName === "string" ? rawName.trim().slice(0, MAX_NAME_LEN) : "";
  if (typeof kind !== "string" || !VALID_KIND.has(kind) || name.length < 2) {
    return NextResponse.json({ ok: false, error: "bad_params" }, { status: 400 });
  }

  try {
    const report = await researchSubject({ kind: kind as "entity" | "country", name });
    // offline is a graceful 200 — the panel renders the "OSINT offline" state
    return NextResponse.json(report);
  } catch {
    return NextResponse.json(
      { ok: false, offline: true, offline_reason: "unexpected_error" },
      { status: 200 }
    );
  }
}
