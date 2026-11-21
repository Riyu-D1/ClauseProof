// Uploaded-dataset discovery + validation for /run.
//
// After a zip is safely extracted (or a folder upload is written) into a
// temp dir, we locate every institution folder inside it — the spec accepts
// files at the zip root, inside one subfolder, or several institution
// folders in one zip — then validate each against the hackathon contract:
// the same files system/run is specified to read.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const REQUIRED_FILES = [
  "POLICY.md",
  "cases.jsonl",
  "alerts.jsonl",
  "customers.jsonl",
  "transactions.jsonl",
  "evidence.jsonl",
  "previous_reviews.jsonl",
  "internal_list.jsonl",
] as const;

// files that must be non-empty JSONL of objects for the engine to load
const JSONL_FILES = [
  "cases.jsonl",
  "alerts.jsonl",
  "customers.jsonl",
  "transactions.jsonl",
  "evidence.jsonl",
  "previous_reviews.jsonl",
  "internal_list.jsonl",
] as const;

export interface DatasetIssue {
  file: string;
  line?: number;
  message: string;
}

export interface DatasetInfo {
  /** filesystem-safe display name, unique within the job */
  name: string;
  /** absolute path of the institution folder system/run will read */
  dir: string;
  cases: number;
  issues: DatasetIssue[];
}

const SAFE_NAME = /[^A-Za-z0-9._-]+/g;

function cleanName(name: string): string {
  const n = name.replace(SAFE_NAME, "_").replace(/^[._]+/, "");
  return n || "dataset";
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk the extracted tree (bounded depth) and return every directory that
 * looks like an institution folder — i.e. it directly contains
 * cases.jsonl. Deepest match wins per branch: if <dir>/cases.jsonl exists
 * we do not also descend into it looking for nested datasets.
 */
export function findDatasetDirs(root: string, maxDepth = 3): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, "cases.jsonl"))) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.startsWith(".") || e === "__MACOSX") continue;
      const p = join(dir, e);
      if (isDir(p)) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return found.sort();
}

/** Validate one institution folder against the input contract. */
export function validateDatasetDir(dir: string): DatasetIssue[] {
  const issues: DatasetIssue[] = [];

  for (const f of REQUIRED_FILES) {
    if (!existsSync(join(dir, f))) {
      issues.push({ file: f, message: "required file is missing" });
    }
  }
  if (issues.length) return issues; // no point parsing files that are absent

  for (const f of JSONL_FILES) {
    const path = join(dir, f);
    let lines: string[];
    try {
      lines = readFileSync(path, "utf8").split("\n");
    } catch (e) {
      issues.push({ file: f, message: `cannot read file: ${e}` });
      continue;
    }
    let rows = 0;
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      rows += 1;
      try {
        const v = JSON.parse(line);
        if (v === null || typeof v !== "object" || Array.isArray(v)) {
          issues.push({ file: f, line: i + 1, message: "line is not a JSON object" });
        }
      } catch (e) {
        issues.push({
          file: f,
          line: i + 1,
          message: `malformed JSON — ${e instanceof Error ? e.message : e}`,
        });
      }
    });
    if (rows === 0 && f !== "previous_reviews.jsonl" && f !== "internal_list.jsonl") {
      issues.push({ file: f, message: "file has no data rows" });
    }
  }

  // case rows need the fields the output contract echoes back
  const casePath = join(dir, "cases.jsonl");
  if (existsSync(casePath)) {
    readFileSync(casePath, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const v = JSON.parse(line);
          if (!v.case_id) {
            issues.push({ file: "cases.jsonl", line: i + 1, message: "missing case_id" });
          }
          if (!Array.isArray(v.alert_ids) || v.alert_ids.length === 0) {
            issues.push({
              file: "cases.jsonl",
              line: i + 1,
              message: "missing or empty alert_ids",
            });
          }
        } catch {
          /* already reported above */
        }
      });
  }

  // evidence dir is only needed if evidence.jsonl points at files
  const evIndex = join(dir, "evidence.jsonl");
  if (existsSync(evIndex) && !isDir(join(dir, "evidence"))) {
    const hasDocs = readFileSync(evIndex, "utf8")
      .split("\n")
      .some((l) => l.trim());
    if (hasDocs) {
      issues.push({
        file: "evidence/",
        message: "evidence.jsonl lists documents but the evidence/ folder is missing",
      });
    }
  }

  return issues.slice(0, 40);
}

function countCases(dir: string): number {
  try {
    return readFileSync(join(dir, "cases.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Discover + validate all datasets under an extracted root.
 * Returns datasets (possibly with issues) — callers decide to reject when
 * any dataset has issues or when none was found at all.
 */
export function discoverDatasets(root: string): DatasetInfo[] {
  const dirs = findDatasetDirs(root);
  const used = new Set<string>();
  return dirs.map((dir) => {
    let name = cleanName(basename(dir));
    // "files at the zip root" — basename is the temp dir name, label it clearly
    if (dir === root) name = "dataset";
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${name}-${i}`)) i += 1;
      name = `${name}-${i}`;
    }
    used.add(name);
    return { name, dir, cases: countCases(dir), issues: validateDatasetDir(dir) };
  });
}
