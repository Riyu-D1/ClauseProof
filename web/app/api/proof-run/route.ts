import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const INST_ROOT = join(ROOT, "institutions");
const DEMO_INST_ROOT = join(ROOT, "demo", "institutions");
const VALID = new Set(["bank", "emoney", "investment", "payments_fx"]);
const RUNS = 5;

// one proof run at a time — the demo only has one engine
let inFlight = false;

const sha256 = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

function runOnce(
  runScript: string,
  instDir: string,
  outFile: string,
  register: (c: ChildProcess) => void
): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(runScript, [instDir, outFile], {
      cwd: SYSTEM_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });
    register(child);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", rej);
    child.on("close", (code) =>
      code === 0
        ? res()
        : rej(new Error(`engine exited ${code}: ${err.trim().slice(-400)}`))
    );
  });
}

/**
 * POST /api/proof-run { institution }
 * Streams NDJSON: {type:"start"} → {type:"run",n,ms,hash} ×5 → {type:"done",identical,hashes,total_ms}
 * Runs the real engine 5× on the chosen institution into a temp dir and
 * SHA-256s each official output file — the live reproducibility proof.
 *
 * Dataset the run uses, reported as `dataset` on start/done events:
 *  - "full"        the private development dataset (local checkout)
 *  - "demo-subset" the bundled synthetic demo institutions (hosted image)
 * Either way it is a real engine run — never a replayed recording.
 */
export async function POST(req: NextRequest) {
  let institution = "";
  try {
    institution = (await req.json())?.institution ?? "";
  } catch {
    /* fall through to validation */
  }
  if (!VALID.has(institution)) {
    return NextResponse.json({ error: "bad institution" }, { status: 400 });
  }
  const runScript = join(SYSTEM_DIR, "run");
  const fullDir = join(INST_ROOT, institution);
  const demoDir = join(DEMO_INST_ROOT, institution);
  const hasFull = existsSync(join(fullDir, "cases.jsonl"));
  const instDir = hasFull ? fullDir : demoDir;
  const dataset = hasFull ? "full" : "demo-subset";
  if (!existsSync(runScript) || !existsSync(join(instDir, "cases.jsonl"))) {
    return NextResponse.json({ error: "engine not found" }, { status: 500 });
  }
  if (inFlight) {
    return NextResponse.json({ error: "a proof run is already running" }, { status: 409 });
  }
  inFlight = true;

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: object) =>
        controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const tmp = mkdtempSync(join(tmpdir(), "cp-proof-"));
      let child: ChildProcess | null = null;
      const kill = () => {
        try {
          child?.kill("SIGKILL");
        } catch {
          /* already dead */
        }
      };
      req.signal.addEventListener("abort", kill);
      const t0 = Date.now();
      try {
        const absInst = realpathSync(instDir);
        send({ type: "start", institution, runs: RUNS, dataset });
        const hashes: string[] = [];
        for (let i = 1; i <= RUNS; i++) {
          const out = join(tmp, `${institution}_${i}.jsonl`);
          const r0 = Date.now();
          await runOnce(runScript, absInst, out, (c) => (child = c));
          const hash = sha256(out);
          hashes.push(hash);
          send({ type: "run", n: i, ms: Date.now() - r0, hash });
        }
        send({
          type: "done",
          identical: new Set(hashes).size === 1,
          hashes,
          total_ms: Date.now() - t0,
          dataset,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        req.signal.removeEventListener("abort", kill);
        kill();
        rmSync(tmp, { recursive: true, force: true });
        inFlight = false;
        controller.close();
      }
    },
    cancel() {
      inFlight = false;
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
