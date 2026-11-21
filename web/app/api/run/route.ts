// POST /api/run — accept an institution dataset and start a 5× run job.
//   multipart field "file"   → a .zip (files at root, one subfolder, or
//                              several institution folders inside)
//   multipart field "files"  → a folder upload (webkitdirectory), one entry
//                              per file, filename = its relative path
//   JSON {sample:"bank"}     → zip a dev institution server-side and run it
//
// GET /api/run — what this host can run: engine present + available samples.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  availableSamples,
  createJob,
  enginePresent,
  INST_ROOT,
  SAMPLES,
} from "@/lib/run-jobs";
import { discoverDatasets, type DatasetIssue } from "@/lib/upload-dataset";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UNZIP_SCRIPT = join(process.cwd(), "scripts", "safe_unzip.py");
const MAX_UPLOAD = 50 * 1024 * 1024; // ~50MB
const MAX_FILES_FIELD = 20_000;

export function GET() {
  return NextResponse.json({
    ok: true,
    engine: enginePresent(),
    samples: availableSamples(),
    limits: { max_upload_bytes: MAX_UPLOAD },
  });
}

function fail(status: number, error: string, issues?: unknown) {
  return NextResponse.json({ error, ...(issues ? { issues } : {}) }, { status });
}

function py(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((res, rej) => {
    const c = spawn("python3", [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("error", rej);
    c.on("close", (code) => res({ code: code ?? -1, out }));
  });
}

/** sanitize a client-supplied relative path; null = unsafe */
function safeRel(name: string): string | null {
  const n = name.replace(/\\/g, "/");
  if (!n || n.startsWith("/") || /^[A-Za-z]:/.test(n)) return null;
  const parts = n.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === "..")) return null;
  if (parts.some((p) => p.includes("\0"))) return null;
  return parts.join("/");
}

interface Found {
  name: string;
  dir: string;
  cases: number;
  issues: DatasetIssue[];
}

async function finish(jobDir: string, found: Found[], source: "zip" | "folder" | "sample", label: string, uploadSha?: string) {
  const bad = found.filter((d) => d.issues.length);
  if (!found.length) {
    rmSync(jobDir, { recursive: true, force: true });
    return fail(
      422,
      "no institution folder found — expected cases.jsonl at the zip root or inside one subfolder"
    );
  }
  if (bad.length) {
    const issues = bad.flatMap((d) =>
      d.issues.map((i) => ({ dataset: d.name, ...i }))
    );
    rmSync(jobDir, { recursive: true, force: true });
    return fail(422, "dataset is missing or has malformed files", issues);
  }
  const job = createJob({
    source,
    label,
    dir: jobDir,
    upload_sha256: uploadSha,
    datasets: found.map((d) => ({ name: d.name, dir: d.dir, cases: d.cases })),
  });
  return NextResponse.json({ job_id: job.id, datasets: found.map((d) => d.name) });
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  // ---- sample dataset: zip a dev institution server-side, same pipeline ----
  if (ct.includes("application/json")) {
    let sample = "";
    try {
      sample = (await req.json())?.sample ?? "";
    } catch {
      return fail(400, "bad JSON body");
    }
    if (!(SAMPLES as readonly string[]).includes(sample)) {
      return fail(400, "unknown sample dataset");
    }
    const src = join(INST_ROOT, sample);
    const jobDir = mkdtempSync(join(tmpdir(), "cp-run-"));
    try {
      const zipPath = join(jobDir, "sample.zip");
      const zr = await py(UNZIP_SCRIPT, ["zip", realpathSync(src), zipPath]);
      if (zr.code !== 0) throw new Error(zr.out.slice(-300));
      const dest = join(jobDir, "extracted");
      mkdirSync(dest, { recursive: true });
      const xr = await py(UNZIP_SCRIPT, ["extract", zipPath, dest]);
      if (xr.code !== 0) throw new Error(xr.out.slice(-300));
      return await finish(jobDir, discoverDatasets(dest), "sample", `sample:${sample}`);
    } catch (e) {
      rmSync(jobDir, { recursive: true, force: true });
      return fail(500, `sample dataset failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!ct.includes("multipart/form-data")) {
    return fail(400, "expected multipart/form-data or application/json");
  }

  // ---- upload ----
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 1024 * 1024) {
    return fail(413, `upload too large — limit is ${MAX_UPLOAD / (1 << 20)}MB`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "could not parse the upload");
  }

  const jobDir = mkdtempSync(join(tmpdir(), "cp-run-"));
  try {
    // (a) a .zip file
    const zipFile = form.get("file");
    if (zipFile instanceof File) {
      if (zipFile.size > MAX_UPLOAD) {
        rmSync(jobDir, { recursive: true, force: true });
        return fail(413, `zip too large — limit is ${MAX_UPLOAD / (1 << 20)}MB`);
      }
      const buf = Buffer.from(await zipFile.arrayBuffer());
      const uploadSha = createHash("sha256").update(buf).digest("hex");
      const zipPath = join(jobDir, "upload.zip");
      writeFileSync(zipPath, buf);
      const dest = join(jobDir, "extracted");
      mkdirSync(dest, { recursive: true });
      const xr = await py(UNZIP_SCRIPT, ["extract", zipPath, dest]);
      if (xr.code !== 0) {
        let msg = xr.out.slice(-300);
        try {
          msg = JSON.parse(xr.out).error ?? msg;
        } catch {
          /* keep raw */
        }
        rmSync(jobDir, { recursive: true, force: true });
        return fail(422, `could not extract the zip: ${msg}`);
      }
      rmSync(zipPath, { force: true });
      return await finish(jobDir, discoverDatasets(dest), "zip", zipFile.name || "upload.zip", uploadSha);
    }

    // (b) a folder upload — each entry's filename is its relative path
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length) {
      if (files.length > MAX_FILES_FIELD) {
        rmSync(jobDir, { recursive: true, force: true });
        return fail(413, `too many files (${files.length})`);
      }
      const dest = join(jobDir, "uploaded");
      mkdirSync(dest, { recursive: true });
      let total = 0;
      const seen = new Set<string>();
      for (const f of files) {
        const rel = safeRel(f.name);
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        total += f.size;
        if (total > MAX_UPLOAD) {
          rmSync(jobDir, { recursive: true, force: true });
          return fail(413, `folder too large — limit is ${MAX_UPLOAD / (1 << 20)}MB`);
        }
        const out = join(dest, rel);
        if (!resolve(out).startsWith(resolve(dest) + "/")) continue;
        mkdirSync(resolve(out, ".."), { recursive: true });
        writeFileSync(out, Buffer.from(await f.arrayBuffer()));
      }
      return await finish(jobDir, discoverDatasets(dest), "folder", "folder upload");
    }

    rmSync(jobDir, { recursive: true, force: true });
    return fail(400, "no file — send a .zip in field \"file\" or folder files in \"files\"");
  } catch (e) {
    rmSync(jobDir, { recursive: true, force: true });
    return fail(500, e instanceof Error ? e.message : String(e));
  }
}
