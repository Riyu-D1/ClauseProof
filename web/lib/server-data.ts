import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Demo, Manifest, Repro, Trace } from "./types";

const DATA_DIR = join(process.cwd(), "public", "data");

function readJson<T>(file: string): T | null {
  const p = join(DATA_DIR, file);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export function getManifest(): Manifest | null {
  return readJson<Manifest>("manifest.json");
}

export function getRepro(): Repro | null {
  return readJson<Repro>("repro.json");
}

export function getDemo(): Demo | null {
  return readJson<Demo>("demo.json");
}

export function getTraces(institution: string): Trace[] {
  return readJson<Trace[]>(`${institution}.json`) ?? [];
}

export function getAllTraces(): Record<string, Trace[]> {
  const manifest = getManifest();
  const out: Record<string, Trace[]> = {};
  for (const inst of manifest?.institutions ?? []) {
    out[inst.id] = getTraces(inst.id);
  }
  return out;
}

export function findCase(caseId: string): { trace: Trace; peers: Trace[] } | null {
  const all = getAllTraces();
  for (const traces of Object.values(all)) {
    const trace = traces.find((t) => t.case_id === caseId);
    if (trace) return { trace, peers: traces };
  }
  return null;
}
