import { NextResponse } from "next/server";
import { grokKeyConfigured, grokModel } from "@/lib/grok-assist";

export const dynamic = "force-dynamic";

/**
 * GET /api/grok — whether Grok-assisted parsing is available.
 * The /run page's "Grok-assisted parsing" switch defaults ON when this
 * returns available:true. The key itself never leaves the server.
 */
export async function GET() {
  return NextResponse.json({
    available: grokKeyConfigured(),
    model: grokModel(),
    promptVersion: "grok-assist-v1",
  });
}
