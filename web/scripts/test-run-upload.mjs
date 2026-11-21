#!/usr/bin/env node
// Proof for /run — exercises the upload pipeline end to end against a
// running web server:
//
//   1. zips each of the 4 dev institutions, uploads it via POST /api/run,
//      waits for the 5× job, and asserts:
//        - the 5 output hashes are identical (and the 5 trace hashes)
//        - system/validate.py reports 0 errors
//        - the downloaded output is BYTE-IDENTICAL to `system/run` on the CLI
//   2. uploads a zip with alerts.jsonl removed and asserts the API rejects
//      it, naming the missing file
//   3. posts one institution as a folder upload (files[] fields) — same
//      pipeline, no zip — and asserts identical + 0 errors
//   4. POST {sample:"investment"} — the server-side zip path — and asserts
//      identical + byte-identical to the CLI
//
// usage: node scripts/test-run-upload.mjs [base_url] [--quick]
//   base_url defaults to http://localhost:3000
//   --quick runs only the smallest institution + the broken-zip test

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const QUICK = process.argv.includes("--quick");
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(WEB, "..");
const INST_ROOT = join(ROOT, "institutions");
const RUN = join(ROOT, "system", "run");
const ZIPPY = join(WEB, "scripts", "safe_unzip.py");
const TMP = mkdtempSync(join(tmpdir(), "cp-test-upload-"));
const ALL = ["bank", "emoney", "investment", "payments_fx"];
const INSTS = QUICK ? ["investment"] : ALL;
const POLL_EVERY = 2000;
const JOB_TIMEOUT = 15 * 60 * 1000;

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) {
    passed++;
    console.log(`    ✓ ${msg}`);
  } else {
    failed++;
    console.log(`    ✗ FAIL: ${msg}`);
  }
  return cond;
};

const sh = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// dev servers occasionally drop keep-alive sockets mid-upload — retry the
// whole request (safe: nothing is created until the body is fully parsed)
async function fetchRetry(url, opts = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

async function pollJob(id) {
  const t0 = Date.now();
  for (;;) {
    const r = await fetchRetry(`${BASE}/api/run/${id}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`status ${r.status} polling job`);
    const j = await r.json();
    if (j.status === "done" || j.status === "error") return j;
    if (Date.now() - t0 > JOB_TIMEOUT) throw new Error("job timed out");
    const cur = j.datasets.map((d) => `${d.name}:${d.current_run}/5`).join(" ");
    process.stdout.write(`\r    … ${j.status} ${cur}   `);
    await new Promise((r2) => setTimeout(r2, POLL_EVERY));
  }
}

async function postZip(zipPath) {
  const fd = new FormData();
  fd.append(
    "file",
    new Blob([readFileSync(zipPath)], { type: "application/zip" }),
    zipPath.split("/").pop()
  );
  const r = await fetchRetry(`${BASE}/api/run`, { method: "POST", body: fd });
  return { status: r.status, body: await r.json() };
}

async function postFolder(dir) {
  const fd = new FormData();
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (!e.startsWith(".")) {
        // like a real webkitdirectory pick: paths include the top folder
        fd.append("files", new Blob([readFileSync(p)]),
          `${dir.split("/").pop()}/${relative(dir, p)}`);
      }
    }
  };
  walk(dir);
  const r = await fetchRetry(`${BASE}/api/run`, { method: "POST", body: fd });
  return { status: r.status, body: await r.json() };
}

async function runJobAndCheck(post, inst, cliOut, label) {
  const t0 = Date.now();
  const { status, body } = await post;
  if (!ok(status === 200, `${label}: accepted (${JSON.stringify(body).slice(0, 120)})`)) return;
  const job = await pollJob(body.job_id);
  process.stdout.write("\n");
  const ds = job.datasets[0];
  ok(job.status === "done", `${label}: job finished (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  ok(ds.status === "done", `${label}: dataset done${ds.error ? ` — ${ds.error}` : ""}`);
  ok(ds.runs.length === 5, `${label}: ran 5 times`);
  const outs = new Set(ds.runs.map((r) => r.output_sha256));
  const trs = new Set(ds.runs.map((r) => r.trace_sha256));
  ok(outs.size === 1, `${label}: all 5 output sha256 identical (${[...outs][0]?.slice(0, 16)}…)`);
  ok(trs.size === 1, `${label}: all 5 trace sha256 identical`);
  ok(ds.identical === true, `${label}: job reports IDENTICAL`);
  ok(ds.validation?.ok === true, `${label}: validate.py — ${ds.validation?.summary}`);
  // byte-identical to the CLI run
  const dl = await fetchRetry(`${BASE}/api/run/${job.id}/file?ds=${ds.name}&kind=output`);
  const web = Buffer.from(await dl.arrayBuffer());
  ok(web.equals(readFileSync(cliOut)), `${label}: output byte-identical to system/run CLI`);
  const dlT = await fetchRetry(`${BASE}/api/run/${job.id}/file?ds=${ds.name}&kind=traces`);
  const webT = Buffer.from(await dlT.arrayBuffer());
  const cliTrace = join(dirname(cliOut), "traces", `${inst}.jsonl`);
  ok(existsSync(cliTrace) && webT.equals(readFileSync(cliTrace)),
    `${label}: traces byte-identical to CLI`);
  // free the job's temp dir — verified, no reason to keep ~50MB around
  await fetchRetry(`${BASE}/api/run/${job.id}`, { method: "DELETE" }).catch(() => {});
}

console.log(`ClauseProof /run upload proof — ${BASE}`);
console.log(`tmp: ${TMP}\n`);

try {
  // ---------- broken zip first (fast) ----------
  console.log("• broken zip — institution minus alerts.jsonl must be rejected");
  const broken = join(TMP, "broken-inst");
  cpSync(join(INST_ROOT, "investment"), broken, { recursive: true });
  rmSync(join(broken, "alerts.jsonl"));
  sh("python3", [ZIPPY, "zip", broken, join(TMP, "broken.zip")]);
  {
    const { status, body } = await postZip(join(TMP, "broken.zip"));
    ok(status === 422, `broken zip rejected with 422 (got ${status})`);
    const names = JSON.stringify(body.issues ?? body);
    ok(names.includes("alerts.jsonl"), `error names the missing file: ${names.slice(0, 160)}`);
  }

  // ---------- the four dev institutions via zip ----------
  for (const inst of INSTS) {
    console.log(`\n• ${inst} — zip → upload → 5× → compare to CLI`);
    const cliOutDir = join(TMP, "cli", inst);
    mkdirSync(cliOutDir, { recursive: true });
    const cliOut = join(cliOutDir, `${inst}.jsonl`);
    sh(RUN, [join(INST_ROOT, inst), cliOut]);
    const zipPath = join(TMP, `${inst}.zip`);
    sh("python3", [ZIPPY, "zip", join(INST_ROOT, inst), zipPath]);
    console.log(`    zip ${(statSync(zipPath).size / (1 << 20)).toFixed(1)}MB`);
    await runJobAndCheck(postZip(zipPath), inst, cliOut, inst);
  }

  // ---------- folder upload (files[] fields, no zip) ----------
  if (!QUICK) {
    console.log("\n• folder upload — every file posted as files[] entries");
    const cliOutDir = join(TMP, "cli", "folder");
    mkdirSync(cliOutDir, { recursive: true });
    const cliOut = join(cliOutDir, "investment.jsonl");
    sh(RUN, [join(INST_ROOT, "investment"), cliOut]);
    await runJobAndCheck(postFolder(join(INST_ROOT, "investment")), "investment", cliOut, "folder");
  }

  // ---------- sample dataset (server-side zip) ----------
  console.log("\n• sample dataset — POST {sample:\"investment\"} (server-side zip)");
  {
    const cliOutDir = join(TMP, "cli", "sample");
    mkdirSync(cliOutDir, { recursive: true });
    const cliOut = join(cliOutDir, "investment.jsonl");
    sh(RUN, [join(INST_ROOT, "investment"), cliOut]);
    const post = fetchRetry(`${BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sample: "investment" }),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
    await runJobAndCheck(post, "investment", cliOut, "sample");
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
