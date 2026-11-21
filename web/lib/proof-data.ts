// Everything the /proof page shows, computed from real files and real runs.
// Nothing invented: if a measurement can't be produced on this host, the
// page says so instead of showing a number.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const OUT_DIR = join(ROOT, "output");
const INST_ROOT = join(ROOT, "institutions");
const DOCS_DIR = join(ROOT, "docs");
const VALIDATE_TIMEOUT = 30_000;

export const INSTITUTION_IDS = ["bank", "emoney", "investment", "payments_fx"] as const;

export interface ValidationRow {
  institution: string;
  lines: number | null;
  errors: number | null;
  raw: string;
  ok: boolean;
}

export interface InstitutionProof {
  institution: string;
  repro_sha256: string | null; // the hash 5 identical runs produced
  output_sha256: string | null; // sha256 of output/<inst>.jsonl right now
  output_matches: boolean | null;
  input_hash: string | null; // sha256 of the institution's input files (from a trace)
  cases: number | null;
}

export interface ProofData {
  repro: {
    generated_at: string | null;
    method: string | null;
    runs: number | null;
    identical_bytes: boolean | null;
    present: boolean;
  };
  outputs: InstitutionProof[];
  validation: ValidationRow[];
  validation_ran: boolean;
  eval_blind_md: string | null;
  engine_version: string | null;
}

const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

function runValidate(inst: string): Promise<ValidationRow> {
  return new Promise((res) => {
    const child = spawn(
      "python3",
      [
        join(SYSTEM_DIR, "validate.py"),
        join(INST_ROOT, inst),
        join(OUT_DIR, `${inst}.jsonl`),
      ],
      { cwd: SYSTEM_DIR, stdio: ["ignore", "pipe", "pipe"] }
    );
    const kill = setTimeout(() => {
      child.kill("SIGKILL");
    }, VALIDATE_TIMEOUT);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(kill);
      res({ institution: inst, lines: null, errors: null, raw: "validator failed to start", ok: false });
    });
    child.on("close", (code) => {
      clearTimeout(kill);
      const raw = out.trim().split("\n").pop() ?? "";
      const m = /(\d[\d,]*)\s+lines?,\s*(\d+)\s+errors?/.exec(raw);
      res({
        institution: inst,
        lines: m ? parseInt(m[1].replace(/,/g, ""), 10) : null,
        errors: m ? parseInt(m[2], 10) : null,
        raw: raw || `validator exited ${code}`,
        ok: code === 0 && !!m,
      });
    });
  });
}

let cached: Promise<ProofData> | null = null;

/** Reads repro.json + output files, re-hashes outputs, and re-runs
 * system/validate.py on every output file — all live, cached per process. */
export function getProofData(): Promise<ProofData> {
  if (cached) return cached;
  cached = (async () => {
    // repro.json — the stored 5× byte-identical result
    let repro: ProofData["repro"] = {
      generated_at: null,
      method: null,
      runs: null,
      identical_bytes: null,
      present: false,
    };
    let reproInsts: Record<string, { sha256?: string; identical?: boolean }> = {};
    const reproPath = join(OUT_DIR, "repro.json");
    if (existsSync(reproPath)) {
      try {
        const r = JSON.parse(readFileSync(reproPath, "utf8"));
        repro = {
          generated_at: r.generated_at ?? null,
          method: r.method ?? null,
          runs: r.runs ?? null,
          identical_bytes: r.identical_bytes ?? null,
          present: true,
        };
        reproInsts = r.institutions ?? {};
      } catch {
        /* malformed repro.json — report as absent */
      }
    }

    const outputs: InstitutionProof[] = INSTITUTION_IDS.map((inst) => {
      const outPath = join(OUT_DIR, `${inst}.jsonl`);
      const tracePath = join(OUT_DIR, "traces", `${inst}.jsonl`);
      let output_sha256: string | null = null;
      let cases: number | null = null;
      let input_hash: string | null = null;
      if (existsSync(outPath)) {
        try {
          output_sha256 = sha256File(outPath);
          cases = readFileSync(outPath, "utf8").split("\n").filter(Boolean).length;
        } catch {
          /* unreadable */
        }
      }
      if (existsSync(tracePath)) {
        try {
          const first = readFileSync(tracePath, "utf8").split("\n").find(Boolean);
          if (first) {
            const t = JSON.parse(first);
            input_hash = t.input_hash ?? null;
            engine_version = t.engine_version ?? null;
          }
        } catch {
          /* unreadable */
        }
      }
      const stored = reproInsts[inst]?.sha256 ?? null;
      return {
        institution: inst,
        repro_sha256: stored,
        output_sha256,
        output_matches:
          stored && output_sha256 ? stored === output_sha256 : null,
        input_hash,
        cases,
      };
    });

    // engine version travels inside each trace line
    let engine_version: string | null = null;
    for (const inst of INSTITUTION_IDS) {
      const tracePath = join(OUT_DIR, "traces", `${inst}.jsonl`);
      if (!existsSync(tracePath)) continue;
      try {
        const first = readFileSync(tracePath, "utf8").split("\n").find(Boolean);
        if (first) {
          const t = JSON.parse(first);
          if (t.engine_version) {
            engine_version = t.engine_version;
            break;
          }
        }
      } catch {
        /* next */
      }
    }

    const validateExists = existsSync(join(SYSTEM_DIR, "validate.py"));
    const outputsExist = outputs.every((o) => o.cases != null);
    const validation =
      validateExists && outputsExist
        ? await Promise.all(INSTITUTION_IDS.map((i) => runValidate(i)))
        : INSTITUTION_IDS.map((i) => ({
            institution: i,
            lines: null,
            errors: null,
            raw: validateExists ? "no output files to validate" : "validator not present",
            ok: false,
          }));

    const evalPath = join(DOCS_DIR, "eval_blind.md");
    const eval_blind_md = existsSync(evalPath)
      ? readFileSync(evalPath, "utf8")
      : null;

    return {
      repro,
      outputs,
      validation,
      validation_ran: validateExists && outputsExist,
      eval_blind_md,
      engine_version,
    };
  })().catch(() => ({
    repro: { generated_at: null, method: null, runs: null, identical_bytes: null, present: false },
    outputs: [],
    validation: [],
    validation_ran: false,
    eval_blind_md: null,
    engine_version: null,
  }));
  return cached;
}
