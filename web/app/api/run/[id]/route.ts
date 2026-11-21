// GET /api/run/<id> — job status for the polling client.

import { NextResponse } from "next/server";
import { deleteJob, getJob, serializeJob } from "@/lib/run-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: "job not found or expired — jobs are kept for one hour" },
      { status: 404 }
    );
  }
  return NextResponse.json(serializeJob(job));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!deleteJob(id)) {
    return NextResponse.json(
      { error: "job not found or still running" },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true });
}
