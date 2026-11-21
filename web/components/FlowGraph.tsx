"use client";

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo } from "react";
import { ccode, gbp, gbpShort, initials } from "@/lib/format";
import type { CoverageRow, Trace } from "@/lib/types";

const COVERED = "#38d07d";
const UNCOVERED = "#ff5566";
const DOC_ID = /^[A-Z]{2,5}-\d+$/;

/* ------------------------------- nodes ---------------------------------- */

type PartyNodeData = {
  name: string;
  country: string;
  total: number;
  count: number;
  unexplained: number;
  delay: number;
};
type PartyNode = Node<PartyNodeData, "party">;
type CustomerNode = Node<{ name: string; kind: string; flagged: number; delay: number }, "customer">;
type MoneyEdgeData = {
  row: CoverageRow;
  color: string;
  width: number;
  offset: number;
  held: boolean;
  covered: boolean;
  simulated: boolean;
  idx: number;
  onDoc: (docId: string) => void;
};
type MoneyEdge = Edge<MoneyEdgeData, "money">;

const handleStyle = { opacity: 0, width: 6, height: 6, pointerEvents: "none" as const };

const PartyNodeView = memo(({ data }: NodeProps<PartyNode>) => (
  <div
    className="cp-node-in w-[190px] rounded-lg border px-3 py-2.5"
    style={{
      animationDelay: `${data.delay}ms`,
      background: "var(--color-obsidian-850)",
      borderColor: data.unexplained ? "#ff556655" : "var(--color-line-2)",
    }}
  >
    <Handle id="l-src" type="source" position={Position.Left} style={handleStyle} />
    <Handle id="l-tgt" type="target" position={Position.Left} style={handleStyle} />
    <Handle id="r-src" type="source" position={Position.Right} style={handleStyle} />
    <Handle id="r-tgt" type="target" position={Position.Right} style={handleStyle} />
    <div className="flex items-center gap-2">
      <span className="ctag" title={data.country}>{ccode(data.country)}</span>
      <span className="truncate text-[12px] font-medium text-ink-100" title={data.name}>
        {data.name}
      </span>
    </div>
    <div className="mono mt-1.5 flex items-center justify-between text-[9.5px] tracking-[0.06em] text-ink-500">
      <span>{gbpShort(data.total)}</span>
      <span>
        {data.count} txn{data.count > 1 ? "s" : ""}
        {data.unexplained ? ` · ${data.unexplained}?` : ""}
      </span>
    </div>
  </div>
));
PartyNodeView.displayName = "PartyNodeView";

const CustomerNodeView = memo(({ data }: NodeProps<CustomerNode>) => (
  <div
    className="cp-node-in w-[220px] rounded-lg border px-4 py-3.5"
    style={{
      animationDelay: `${data.delay}ms`,
      background: "var(--color-obsidian-800)",
      borderColor: "var(--color-line-2)",
      boxShadow: "0 0 0 1px var(--color-line)",
    }}
  >
    <Handle id="l-src" type="source" position={Position.Left} style={handleStyle} />
    <Handle id="l-tgt" type="target" position={Position.Left} style={handleStyle} />
    <Handle id="r-src" type="source" position={Position.Right} style={handleStyle} />
    <Handle id="r-tgt" type="target" position={Position.Right} style={handleStyle} />
    <Handle id="t-src" type="source" position={Position.Top} style={handleStyle} />
    <Handle id="t-tgt" type="target" position={Position.Top} style={handleStyle} />
    <div className="flex items-center gap-2.5">
      <span className="mono flex h-9 w-9 items-center justify-center rounded-md border border-line-2 bg-obsidian-900 text-[12px] font-bold text-ink-100">
        {initials(data.name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink-100">{data.name}</div>
        <div className="mono mt-0.5 text-[9px] uppercase tracking-[0.18em] text-ink-500">
          {data.kind}
        </div>
      </div>
    </div>
    <div className="mono mt-2.5 border-t border-line pt-2 text-[10px] tracking-[0.08em] text-ink-500">
      flagged <span className="text-ink-100">{gbp(data.flagged)}</span>
    </div>
  </div>
));
CustomerNodeView.displayName = "CustomerNodeView";

const nodeTypes = { party: PartyNodeView, customer: CustomerNodeView };

/* ------------------------------- edges ---------------------------------- */

function quadPath(
  sx: number, sy: number, tx: number, ty: number, offset: number
): [string, number, number] {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const cx = mx + px * offset;
  const cy = my + py * offset;
  return [`M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`, (sx + 2 * cx + tx) / 4, (sy + 2 * cy + ty) / 4];
}

function selfLoopPath(
  sx: number, sy: number
): [string, number, number] {
  const r = 46;
  return [
    `M ${sx},${sy} C ${sx - r},${sy - r * 2.4} ${sx + r},${sy - r * 2.4} ${sx + 2},${sy - 2}`,
    sx,
    sy - r * 1.7,
  ];
}

const MoneyEdgeView = memo((props: EdgeProps<MoneyEdge>) => {
  const { id, sourceX, sourceY, targetX, targetY, data } = props;
  const d = data!;
  const loop = props.source === props.target;
  const [path, labelX, labelY] = loop
    ? selfLoopPath(sourceX, sourceY - 8)
    : quadPath(sourceX, sourceY, targetX, targetY, d.offset);
  const r = d.row;
  const drawDelay = d.idx * 60;
  const docClickable = d.covered && !!r.covered_by && DOC_ID.test(r.covered_by);
  return (
    <>
      {/* under-glow — sweeps in on mount, recolours with the flip state */}
      <path
        d={path}
        fill="none"
        stroke={d.color}
        strokeWidth={d.width + 7}
        strokeOpacity={0.13}
        pathLength={1}
        className={`edge-draw ${d.covered ? "" : "edge-uncovered"}`}
        style={{ animationDelay: `${drawDelay}ms`, transition: "stroke .4s ease" }}
      />
      <BaseEdge
        id={id}
        path={path}
        className={`edge-flow edge-fade ${d.covered ? "" : "edge-uncovered"}`}
        style={{
          stroke: d.color,
          strokeWidth: d.width,
          animationDelay: `${drawDelay + 200}ms, 0s`,
          transition: "stroke .4s ease",
        }}
      />
      <foreignObject
        x={labelX - 70}
        y={labelY - 12}
        width={140}
        height={26}
        className="pointer-events-none overflow-visible"
      >
        <div
          className="edge-chipwrap flex h-full items-center justify-center gap-1"
          style={{ animationDelay: `${drawDelay + 320}ms` }}
        >
          {d.covered ? (
            docClickable ? (
              <button
                className="edge-chip pointer-events-auto"
                style={{
                  background: "var(--color-obsidian-800)",
                  color: COVERED,
                  border: `1px solid ${COVERED}55`,
                  transition: "color .4s ease, border-color .4s ease",
                }}
                title={`${r.transaction_id} · ${gbp(r.amount_gbp)} — ${r.why}`}
                onClick={(e) => {
                  e.stopPropagation();
                  d.onDoc(r.covered_by!);
                }}
              >
                ✓ {r.covered_by}
              </button>
            ) : (
              <span
                className="edge-chip"
                style={{
                  background: "var(--color-obsidian-800)",
                  color: COVERED,
                  border: `1px solid ${COVERED}55`,
                  cursor: "default",
                }}
                title={`${r.transaction_id} · ${gbp(r.amount_gbp)} — ${r.why}`}
              >
                ✓ {d.simulated ? "explained" : r.covered_by}
              </span>
            )
          ) : (
            <span
              className="edge-chip"
              style={{
                background: "var(--color-obsidian-800)",
                color: UNCOVERED,
                border: `1px solid ${UNCOVERED}66`,
              }}
              title={
                d.simulated
                  ? `${r.transaction_id} · ${gbp(r.amount_gbp)} — removed in the flip scenario`
                  : `${r.transaction_id} · ${gbp(r.amount_gbp)} — ${r.why}`
              }
            >
              ? unexplained
            </span>
          )}
          {d.held && (
            <span
              className="edge-chip"
              style={{
                background: "var(--color-obsidian-800)",
                color: "#ffb224",
                border: "1px solid #ffb22455",
              }}
              title="Held payment — released only on CLOSE"
            >
              HELD
            </span>
          )}
        </div>
      </foreignObject>
    </>
  );
});
MoneyEdgeView.displayName = "MoneyEdgeView";

const edgeTypes = { money: MoneyEdgeView };

/* ------------------------------ layout ---------------------------------- */

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function buildGraph(trace: Trace, onDoc: (id: string) => void, flipped: boolean) {
  const rows = trace.coverage;

  // which rows does the flip change touch? Doc ids named in flip.change lose
  // their document; generic flips to CLOSE explain every open row.
  const flipDocIds = new Set<string>(
    trace.flip
      ? trace.coverage
          .map((c) => c.covered_by)
          .filter((id): id is string => !!id && trace.flip!.change.includes(id))
      : []
  );
  const effCovered = (r: CoverageRow) => {
    if (!flipped || !trace.flip) return !!r.covered_by;
    if (flipDocIds.size) return !!r.covered_by && !flipDocIds.has(r.covered_by);
    return trace.flip.new_verdict === "CLOSE" ? true : !!r.covered_by;
  };

  const flagged = rows.reduce((s, r) => s + r.amount_gbp, 0);
  const custNorm = norm(trace.customer.name);

  // aggregate counterparties (excluding self-loops into customer node)
  interface Party {
    key: string;
    name: string;
    country: string;
    dir: "in" | "out";
    totalIn: number;
    totalOut: number;
    count: number;
    unexplained: number;
  }
  const parties = new Map<string, Party>();
  for (const r of rows) {
    const rNorm = norm(r.counterparty);
    if (rNorm && rNorm === custNorm) continue; // self-loop rows handled below
    const key = rNorm || `anon:${r.transaction_id}`;
    let p = parties.get(key);
    if (!p) {
      p = {
        key,
        name: r.counterparty || "Unknown party",
        country: r.country,
        dir: r.direction,
        totalIn: 0,
        totalOut: 0,
        count: 0,
        unexplained: 0,
      };
      parties.set(key, p);
    }
    p.count++;
    if (r.direction === "in") p.totalIn += r.amount_gbp;
    else p.totalOut += r.amount_gbp;
    if (!effCovered(r)) p.unexplained++;
    p.dir = p.totalIn >= p.totalOut ? "in" : "out";
  }

  const ins = [...parties.values()].filter((p) => p.dir === "in").sort((a, b) => b.totalIn - a.totalIn);
  const outs = [...parties.values()].filter((p) => p.dir === "out").sort((a, b) => b.totalOut - a.totalOut);

  const nodes: (PartyNode | CustomerNode)[] = [
    {
      id: "customer",
      type: "customer",
      position: { x: 0, y: 0 },
      data: { name: trace.customer.name, kind: trace.customer.kind, flagged, delay: 0 },
    },
  ];
  // place parties left/right; more than 14 on one side wraps into a second
  // column further out so the fan stays readable
  const place = (list: Party[], x: number, base: number, dir: 1 | -1) => {
    const nCols = list.length > 14 ? 2 : 1;
    const perCol = Math.ceil(list.length / nCols);
    const spacing = Math.min(110, Math.max(64, 420 / Math.max(perCol, 1)));
    const colSpan = (perCol - 1) * spacing;
    list.forEach((p, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const cy = nCols === 1 ? 0 : (col - 0.5) * (colSpan + 60);
      nodes.push({
        id: `p:${p.key}`,
        type: "party",
        position: {
          x: x + col * 250 * dir,
          y: cy + (row - (perCol - 1) / 2) * spacing,
        },
        data: {
          name: p.name,
          country: p.country,
          total: p.totalIn + p.totalOut,
          count: p.count,
          unexplained: p.unexplained,
          delay: base + i * 40,
        },
      });
    });
  };
  place(ins, -420, 80, -1);
  place(outs, 420, 80 + ins.length * 40, 1);

  const nodeKey = (r: CoverageRow) => {
    const rNorm = norm(r.counterparty);
    if (rNorm && rNorm === custNorm) return "customer";
    return `p:${rNorm || `anon:${r.transaction_id}`}`;
  };

  // parallel-edge offsets per unordered node pair
  const pairCount = new Map<string, number>();
  const pairIdx = new Map<string, number>();
  for (const r of rows) {
    const p = nodeKey(r);
    const a = r.direction === "in" ? p : "customer";
    const b = r.direction === "in" ? "customer" : p;
    const key = `${a}->${b}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const edges: MoneyEdge[] = rows.map((r, i) => {
    const rNorm = norm(r.counterparty);
    const self = !!rNorm && rNorm === custNorm;
    const pKey = nodeKey(r);
    const p = self ? null : parties.get(rNorm || `anon:${r.transaction_id}`)!;
    const inFlow = r.direction === "in";
    const source = inFlow ? pKey : "customer";
    const target = inFlow ? "customer" : pKey;
    const pairKey = `${source}->${target}`;
    const idx = pairIdx.get(pairKey) ?? 0;
    pairIdx.set(pairKey, idx + 1);
    const n = pairCount.get(pairKey) ?? 1;
    const covered = effCovered(r);
    const simulated = covered !== !!r.covered_by;
    // which side is the party on? choose handles accordingly
    const partyLeft = p ? p.dir === "in" : true;
    const sourceHandle = self
      ? "t-src"
      : inFlow
        ? partyLeft ? "r-src" : "l-src"
        : partyLeft ? "l-src" : "r-src";
    const targetHandle = self
      ? "t-tgt"
      : inFlow
        ? partyLeft ? "l-tgt" : "r-tgt"
        : partyLeft ? "r-tgt" : "l-tgt";
    return {
      id: r.transaction_id,
      type: "money",
      source,
      target,
      sourceHandle,
      targetHandle,
      data: {
        row: r,
        color: covered ? COVERED : UNCOVERED,
        width: Math.min(8, Math.max(1.6, Math.sqrt(r.amount_gbp) / 26)),
        offset: (idx - (n - 1) / 2) * 34 + (inFlow ? -30 : 30),
        held: trace.customer.held_payment_id === r.transaction_id,
        covered,
        simulated,
        idx: i,
        onDoc,
      },
    };
  });

  return { nodes, edges };
}

/* ------------------------------ component ------------------------------- */

function GraphInner({
  trace,
  onDoc,
  flipped,
}: {
  trace: Trace;
  onDoc: (id: string) => void;
  flipped: boolean;
}) {
  const { nodes, edges } = useMemo(
    () => buildGraph(trace, onDoc, flipped),
    [trace, onDoc, flipped]
  );
  const covered = edges.filter((e) => e.data?.covered).length;
  return (
    <div className="relative h-full w-full">
      <ReactFlow
        key={`${trace.case_id}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.05 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        panOnDrag
      >
        {/* dot-matrix field, on motif */}
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.06)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {/* legend — flat, mono caps */}
      <div className="mono pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5 rounded-lg border border-line bg-obsidian-900 px-3 py-2.5 text-[9.5px]">
        <span className="tracking-[0.18em] text-ink-500">
          MONEY FLOW · {trace.coverage.length} TXNS{flipped && trace.flip ? " · FLIPPED" : ""}
        </span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5" style={{ background: COVERED }} />
          covered — document attached ({covered})
        </span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5" style={{ background: UNCOVERED }} />
          unexplained ({trace.coverage.length - covered})
        </span>
      </div>
    </div>
  );
}

export default function FlowGraph(props: {
  trace: Trace;
  onDoc: (id: string) => void;
  flipped: boolean;
}) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
