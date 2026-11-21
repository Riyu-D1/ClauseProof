// GET /api/run/<id>/file?ds=<name>&kind=output|traces|report — downloads.

import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { artefactPath, getJob } from "@/lib/run-jobs";

export const dynamic = "force-dynamic";

const KINDS = new Set(["output", "traces", "report"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const ds = req.nextUrl.searchParams.get("ds") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") ?? "";
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const art = artefactPath(job, ds, kind as "output" | "traces" | "report");
  if (!art || !existsSync(art.path)) {
    return NextResponse.json({ error: "artefact not ready" }, { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(art.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": kind === "report" ? "application/json" : "application/x-ndjson",
      "content-length": String(statSync(art.path).size),
      "content-disposition": `attachment; filename="${art.download}"`,
      "cache-control": "no-store",
    },
  });
}
