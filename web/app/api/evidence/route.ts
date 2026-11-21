import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const INST_ROOT = resolve(process.cwd(), "..", "institutions");
const DEMO_INST_ROOT = resolve(process.cwd(), "..", "demo", "institutions");
const VALID_INST = /^[a-z_]+$/;
const VALID_DOC = /^[A-Za-z0-9-]+$/;

interface EvidenceMeta {
  doc_id: string;
  customer_id: string;
  type: string;
  title: string;
  dated: string;
  file: string;
}

// GET /api/evidence?institution=bank&doc=INV-1234
export function GET(req: NextRequest) {
  const institution = req.nextUrl.searchParams.get("institution") ?? "";
  const doc = req.nextUrl.searchParams.get("doc") ?? "";
  if (!VALID_INST.test(institution) || !VALID_DOC.test(doc)) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }
  // private dataset locally; bundled synthetic demo subset when hosted
  let dir = join(INST_ROOT, institution);
  if (!existsSync(join(dir, "evidence.jsonl"))) {
    dir = join(DEMO_INST_ROOT, institution);
  }
  const idxPath = join(dir, "evidence.jsonl");
  if (!existsSync(idxPath)) {
    return NextResponse.json({ error: "no such institution" }, { status: 404 });
  }
  const meta = readFileSync(idxPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EvidenceMeta)
    .find((e) => e.doc_id === doc);
  if (!meta) {
    return NextResponse.json(
      { error: "not a document", doc_id: doc },
      { status: 404 }
    );
  }
  // meta.file is like "evidence/ACC-1093.md" — never trust beyond basename
  const mdPath = join(dir, "evidence", basename(meta.file));
  const markdown = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
  return NextResponse.json({ ...meta, markdown });
}
