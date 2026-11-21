// GET /api/run/<id>/trace?ds=<name>&case=<case_id> — one run-1 trace.

import { NextRequest, NextResponse } from "next/server";
import { getJob, getTrace } from "@/lib/run-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const ds = req.nextUrl.searchParams.get("ds") ?? "";
  const caseId = req.nextUrl.searchParams.get("case") ?? "";
  const trace = getTrace(job, ds, caseId);
  if (!trace) return NextResponse.json({ error: "case not found" }, { status: 404 });
  return NextResponse.json(trace);
}
