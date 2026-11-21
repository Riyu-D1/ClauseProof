// GET /api/run/<id>/doc?ds=<name>&doc=<doc_id> — an uploaded evidence doc,
// same payload shape as /api/evidence so EvidenceDrawer works unchanged.

import { NextRequest, NextResponse } from "next/server";
import { getEvidenceDoc, getJob } from "@/lib/run-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const ds = req.nextUrl.searchParams.get("ds") ?? "";
  const doc = req.nextUrl.searchParams.get("doc") ?? "";
  const payload = getEvidenceDoc(job, ds, doc);
  if (!payload) {
    return NextResponse.json({ error: "not a document", doc_id: doc }, { status: 404 });
  }
  return NextResponse.json(payload);
}
