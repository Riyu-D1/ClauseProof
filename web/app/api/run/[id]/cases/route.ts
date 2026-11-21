// GET /api/run/<id>/cases?ds=<name> — results-table rows from run 1.

import { NextRequest, NextResponse } from "next/server";
import { getCaseRows, getJob } from "@/lib/run-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  const ds = req.nextUrl.searchParams.get("ds") ?? "";
  const rows = getCaseRows(job, ds);
  if (rows === null) {
    return NextResponse.json({ error: "dataset not finished or unknown" }, { status: 404 });
  }
  return NextResponse.json({ dataset: ds, rows });
}
