// Aggregation model for the money-flow graph. Pure — no React — so the
// grouping logic can be exercised from a plain node script.
//
// Shape: one node per counterparty (long tail folded into "+N others" group
// nodes, split by covered/unexplained status, ~12 visible nodes per side),
// and at most two edges per node — covered £ vs unexplained £ — so every
// pound shown still sums back to the case total.

import type { CoverageRow, Trace } from "./types";

/** max visible party/group nodes on one side of the customer */
export const SIDE_CAP = 12;

const DOC_ID = /^[A-Z]{2,5}-\d+$/;

export interface VisParty {
  id: string;
  kind: "party" | "group";
  dir: "in" | "out";
  name: string;
  country: string; // "" when mixed across grouped parties
  parties: number; // counterparties folded into this node
  rows: CoverageRow[]; // every transaction routed through it
  count: number; // rows.length
  total: number;
  unexplained: number; // rows unexplained under effective coverage
  covTotal: number;
  unTotal: number;
  covRows: CoverageRow[];
  unRows: CoverageRow[];
}

export interface FlowEdge {
  id: string;
  nodeId: string; // VisParty id, or "customer" for own-account loops
  loop: boolean;
  inFlow: boolean; // direction the money moves
  rows: CoverageRow[];
  covered: boolean;
  simulated: boolean; // effective coverage differs from raw (flip applied)
  total: number;
  held: boolean;
  docId: string | null; // every row shares one doc id → chip opens it directly
  offset: number; // curvature offset for the quadratic edge path
  width: number;
}

export interface GraphModel {
  ins: VisParty[];
  outs: VisParty[];
  edges: FlowEdge[];
  flagged: number;
  parties: number; // distinct counterparties, incl. those inside groups
  grouped: number; // counterparties hidden inside group nodes
  coveredRows: number;
  coveredTotal: number;
  uncovRows: number;
  uncovTotal: number;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const sum = (rs: CoverageRow[]) => rs.reduce((s, r) => s + r.amount_gbp, 0);

export function buildGraphModel(trace: Trace, flipped: boolean): GraphModel {
  const rows = trace.coverage;
  const heldId = trace.customer.held_payment_id ?? null;

  // which rows does the flip change touch? Doc ids named in flip.change lose
  // their document; generic flips to CLOSE explain every open row.
  const flipDocIds = new Set<string>(
    trace.flip
      ? rows
          .map((c) => c.covered_by)
          .filter((id): id is string => !!id && trace.flip!.change.includes(id))
      : []
  );
  const effCovered = (r: CoverageRow) => {
    if (!flipped || !trace.flip) return !!r.covered_by;
    if (flipDocIds.size) return !!r.covered_by && !flipDocIds.has(r.covered_by);
    return trace.flip.new_verdict === "CLOSE" ? true : !!r.covered_by;
  };

  const custNorm = norm(trace.customer.name);
  const flagged = sum(rows);

  interface Party {
    key: string;
    name: string;
    country: string;
    rows: CoverageRow[];
    dir: "in" | "out";
    totalIn: number;
    totalOut: number;
    rawUn: number; // rows unexplained by raw coverage — stable across flip
  }
  const parties = new Map<string, Party>();
  const selfRows: CoverageRow[] = [];

  for (const r of rows) {
    const k = norm(r.counterparty);
    if (k && k === custNorm) {
      selfRows.push(r);
      continue;
    }
    const key = k || `anon:${r.transaction_id}`;
    let p = parties.get(key);
    if (!p) {
      p = {
        key,
        name: r.counterparty || "Unknown party",
        country: r.country,
        rows: [],
        dir: r.direction,
        totalIn: 0,
        totalOut: 0,
        rawUn: 0,
      };
      parties.set(key, p);
    }
    p.rows.push(r);
    if (r.direction === "in") p.totalIn += r.amount_gbp;
    else p.totalOut += r.amount_gbp;
    if (!r.covered_by) p.rawUn++;
    p.dir = p.totalIn >= p.totalOut ? "in" : "out";
  }

  // unexplained first, then biggest — the risk surface sits at the top
  const sideSort = (a: Party, b: Party) =>
    Number(b.rawUn > 0) - Number(a.rawUn > 0) ||
    b.totalIn + b.totalOut - (a.totalIn + a.totalOut);

  const ins = [...parties.values()].filter((p) => p.dir === "in").sort(sideSort);
  const outs = [...parties.values()].filter((p) => p.dir === "out").sort(sideSort);

  const finish = (
    id: string,
    kind: "party" | "group",
    dir: "in" | "out",
    name: string,
    country: string,
    memberRows: CoverageRow[],
    partyCount: number
  ): VisParty => {
    const covRows = memberRows.filter(effCovered);
    const unRows = memberRows.filter((r) => !effCovered(r));
    return {
      id,
      kind,
      dir,
      name,
      country,
      parties: partyCount,
      rows: memberRows,
      count: memberRows.length,
      total: sum(memberRows),
      unexplained: unRows.length,
      covTotal: sum(covRows),
      unTotal: sum(unRows),
      covRows,
      unRows,
    };
  };

  const toVis = (p: Party): VisParty =>
    finish(`p:${p.key}`, "party", p.dir, p.name, p.country, p.rows, 1);

  const groupVis = (members: Party[], dir: "in" | "out", un: boolean): VisParty => {
    const memberRows = members.flatMap((p) => p.rows);
    const countries = new Set(members.map((m) => m.country));
    return finish(
      `g:${dir}:${un ? "un" : "cov"}`,
      "group",
      dir,
      `+${members.length} others`,
      countries.size === 1 ? [...countries][0] : "",
      memberRows,
      members.length
    );
  };

  // fold the long tail: ≤ SIDE_CAP nodes per side, tail split by raw
  // covered/unexplained status into up to two "+N others" nodes.
  const side = (list: Party[], dir: "in" | "out"): VisParty[] => {
    if (list.length <= SIDE_CAP) return list.map(toVis);
    const tailProbe = list.slice(SIDE_CAP - 1);
    const twoGroups =
      tailProbe.some((p) => p.rawUn > 0) && tailProbe.some((p) => p.rawUn === 0);
    const k = twoGroups ? SIDE_CAP - 2 : SIDE_CAP - 1;
    const tail = list.slice(k);
    const covTail = tail.filter((p) => p.rawUn === 0);
    const unTail = tail.filter((p) => p.rawUn > 0);
    return [
      ...list.slice(0, k).map(toVis),
      ...(covTail.length ? [groupVis(covTail, dir, false)] : []),
      ...(unTail.length ? [groupVis(unTail, dir, true)] : []),
    ];
  };

  const insV = side(ins, "in");
  const outsV = side(outs, "out");

  // — edges —
  const singleDoc = (rs: CoverageRow[]) => {
    const docs = new Set(rs.map((r) => r.covered_by));
    const only = docs.size === 1 ? [...docs][0] : null;
    return only && DOC_ID.test(only) ? only : null;
  };

  const edges: FlowEdge[] = [];
  const lanes = new Map<string, FlowEdge[]>(); // `${nodeId}|${inFlow}` → its edges

  const emit = (
    nodeId: string,
    rs: CoverageRow[],
    covered: boolean,
    loop: boolean,
    inFlow: boolean
  ) => {
    const e: FlowEdge = {
      id: `${nodeId}:${inFlow ? "i" : "o"}:${covered ? "c" : "u"}${loop ? ":l" : ""}`,
      nodeId,
      loop,
      inFlow,
      rows: rs,
      covered,
      simulated: rs.some((r) => effCovered(r) !== !!r.covered_by),
      total: sum(rs),
      held: !!heldId && rs.some((r) => r.transaction_id === heldId),
      docId: covered ? singleDoc(rs) : null,
      offset: 0,
      width: 0,
    };
    edges.push(e);
    if (!loop) {
      const key = `${nodeId}|${inFlow}`;
      const l = lanes.get(key) ?? [];
      l.push(e);
      lanes.set(key, l);
    }
  };

  for (const v of [...insV, ...outsV]) {
    for (const inFlow of [true, false]) {
      const laneRows = v.rows.filter((r) => (r.direction === "in") === inFlow);
      const cov = laneRows.filter(effCovered);
      const un = laneRows.filter((r) => !effCovered(r));
      if (cov.length) emit(v.id, cov, true, false, inFlow);
      if (un.length) emit(v.id, un, false, false, inFlow);
    }
  }
  // own-account loops ride over the top of the customer node
  {
    const cov = selfRows.filter(effCovered);
    const un = selfRows.filter((r) => !effCovered(r));
    if (cov.length) emit("customer", cov, true, true, true);
    if (un.length) emit("customer", un, false, true, true);
  }

  // width ∝ √£; unexplained drawn thicker on top so it dominates
  for (const e of edges) {
    const w = Math.min(10, Math.max(1.8, Math.sqrt(e.total) / 24));
    e.width = e.covered ? w : Math.min(12, w * 1.25);
  }
  // lanes: a gentle bow for single edges, fanned ±22 when a node has both
  for (const l of lanes.values()) {
    if (l.length === 1) {
      l[0].offset = l[0].inFlow ? -24 : 24;
    } else {
      const base = l[0].inFlow ? -22 : 22;
      l.forEach((e, i) => {
        e.offset = base + (i === 0 ? -20 : 20);
      });
    }
  }
  // unexplained last = rendered on top
  edges.sort((a, b) => Number(a.covered) - Number(b.covered));

  const coveredRows = rows.filter(effCovered);
  const uncovRows = rows.filter((r) => !effCovered(r));
  const groupedCount =
    insV.concat(outsV).reduce((s, v) => s + (v.kind === "group" ? v.parties : 0), 0);

  return {
    ins: insV,
    outs: outsV,
    edges,
    flagged,
    parties: parties.size,
    grouped: groupedCount,
    coveredRows: coveredRows.length,
    coveredTotal: sum(coveredRows),
    uncovRows: uncovRows.length,
    uncovTotal: sum(uncovRows),
  };
}
