import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { lanUrl } from "@/lib/play-run";
import { supabaseConfigFromEnv } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// private/loopback hosts — for these the QR should point at the LAN IP
const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|.*\.local)/i;

/** GET /api/play/config — the URL phones should open, the publishable
 * Supabase config for realtime subscriptions (browser-safe key, guarded
 * by RLS), and whether the private dataset is present (hosted builds run
 * on the bundled synthetic demo subset instead).
 * PUBLIC_URL env wins (tunnels); on a public deployment the request's own
 * origin is used; on a LAN, the first non-internal IPv4. */
export async function GET(req: NextRequest) {
  const host = (
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? ""
  ).split(",")[0].trim();
  const port = host.includes(":") ? host.split(":").pop()! : "3000";
  let base: string;
  if (process.env.PUBLIC_URL?.trim()) {
    base = process.env.PUBLIC_URL.trim().replace(/\/$/, "");
  } else if (host && !LOCAL_HOST.test(host)) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    base = `${proto}://${host}`;
  } else {
    base = await lanUrl(port);
  }
  const hosted = !existsSync(
    join(resolve(process.cwd(), ".."), "institutions", "bank", "cases.jsonl")
  );
  return NextResponse.json(
    { playUrl: `${base}/play`, base, supabase: supabaseConfigFromEnv(), hosted },
    { headers: { "cache-control": "no-store" } }
  );
}
