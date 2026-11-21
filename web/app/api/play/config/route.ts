import { NextRequest, NextResponse } from "next/server";
import { lanUrl } from "@/lib/play-run";

export const dynamic = "force-dynamic";

/** GET /api/play/config — the URL phones on the LAN should open.
 * PUBLIC_URL env wins (for tunnels); otherwise first non-internal IPv4. */
export function GET(req: NextRequest) {
  const host = req.nextUrl.host;
  const port = host.includes(":") ? host.split(":").pop()! : "3000";
  const base = lanUrl(port);
  return NextResponse.json(
    { playUrl: `${base}/play`, base },
    { headers: { "cache-control": "no-store" } }
  );
}
