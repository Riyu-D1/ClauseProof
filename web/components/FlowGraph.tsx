"use client";

import {
  Background,
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
import { flag, gbp, gbpShort, initials } from "@/lib/format";
import type { CoverageRow, Trace } from "@/lib/types";

const COVERED = "#2bd47d";
const UNCOVERED = "#ff3b5c";
const CYAN = "#37e0d8";

/* ------------------------------- nodes ---------------------------------- */

type PartyNodeData = {
  name: string;
  country: string;
  total: number;
  count: number;
  unexplained: number;
};
type PartyNode = Node<PartyNodeData, "party">;
type CustomerNode = Node<{ name: string; kind: string; flagged: number }, "customer">;
type MoneyEdgeData = {
  row: CoverageRow;
  color: string;
  width: number;
  offset: number;
  held: boolean;
  onDoc: (docId: string) => void;
};
type MoneyEdge = Edge<MoneyEdgeData, "money">;

const handleStyle = { opacity: 0, width: 6, height: 6, pointerEvents: "none" as const };

const PartyNodeView = memo(({ data }: NodeProps<PartyNode>) => (
  <div
    className="w-[190px] rounded-xl border px-3 py-2.5"
    style={{
      background: "linear-gradient(180deg,#141a24,#0d1118)",
      borderColor: data.unexplained ? "#ff3b5c50" : "rgba(255,255,255,0.1)",
      boxShadow: data.unexplained ? "0 0 22px #ff3b5c18" : "0 0 18px rgba(0,0,0,0.4)",
    }}
  >
    <Handle id="l-src" type="source" position={Position.Left} style={handleStyle} />
    <Handle id="l-tgt" type="target" position={Position.Left} style={handleStyle} />
    <Handle id="r-src" type="source" position={Position.Right} style={handleStyle} />
    <Handle id="r-tgt" type="target" position={Position.Right} style={handleStyle} />
    <div className="flex items-center gap-2">
      <span className="text-[15px] leading-none">{flag(data.country)}</span>
      <span className="truncate text-[12px] font-medium text-ink-100" title={data.name}>
        {data.name}
      </span>
    </div>
    <div className="mono mt-1 flex items-center justify-between text-[10px] text-ink-500">
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
    className="w-[220px] rounded-2xl border px-4 py-3.5"
    style={{
      background: "linear-gradient(160deg,#182031,#0c1017)",
      borderColor: "#37e0d845",
      boxShadow: "0 0 40px #37e0d818, 0 0 18px rgba(0,0,0,0.5)",
    }}
  >
    <Handle id="l-src" type="source" position={Position.Left} style={handleStyle} />
    <Handle id="l-tgt" type="target" position={Position.Left} style={handleStyle} />
    <Handle id="r-src" type="source" position={Position.Right} style={handleStyle} />
    <Handle id="r-tgt" type="target" position={Position.Right} style={handleStyle} />
    <Handle id="t-src" type="source" position={Position.Top} style={handleStyle} />
    <Handle id="t-tgt" type="target" position={Position.Top} style={handleStyle} />
    <div className="flex items-center gap-2.5">
      <span
        className="mono flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: "#37e0d818", color: CYAN, border: "1px solid #37e0d840" }}
      >
        {initials(data.name)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-ink-100">{data.name}</div>
        <div className="mono text-[10px] uppercase tracking-widest text-ink-500">
          {data.kind}
        </div>
      </div>
    </div>
    <div className="mono mt-2.5 border-t border-white/[0.07] pt-2 text-[10px] text-ink-500">
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
  return (
    <>
      {/* under-glow */}
      <path
        d={path}
        fill="none"
        stroke={d.color}
        strokeWidth={d.width + 7}
        strokeOpacity={0.14}
        className={r.covered_by ? undefined : "edge-uncovered"}
      />
      <BaseEdge
        id={id}
        path={path}
        className={`edge-flow ${r.covered_by ? "" : "edge-uncovered"}`}
        style={{ stroke: d.color, strokeWidth: d.width }}
      />
      <foreignObject
        x={labelX - 70}
        y={labelY - 12}
        width={140}
        height={26}
        className="pointer-events-none overflow-visible"
      >
        <div className="flex h-full items-center justify-center gap-1">
          {r.covered_by ? (
            <button
              className="edge-chip pointer-events-auto"
              style={{ background: "#0d1118", color: COVERED, border: `1px solid ${COVERED}55` }}
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
              style={{ background: "#17090d", color: UNCOVERED, border: `1px solid ${UNCOVERED}66` }}
              title={`${r.transaction_id} · ${gbp(r.amount_gbp)} — ${r.why}`}
            >
              ? unexplained
            </span>
          )}
          {d.held && (
            <span
              className="edge-chip"
              style={{ background: "#170f05", color: "#ffb020", border: "1px solid #ffb02055" }}
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

function buildGraph(trace: Trace, onDoc: (id: string) => void) {
  const rows = trace.coverage;
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
    if (!r.covered_by) p.unexplained++;
    p.dir = p.totalIn >= p.totalOut ? "in" : "out";
  }

  const ins = [...parties.values()].filter((p) => p.dir === "in").sort((a, b) => b.totalIn - a.totalIn);
  const outs = [...parties.values()].filter((p) => p.dir === "out").sort((a, b) => b.totalOut - a.totalOut);

  const nodes: (PartyNode | CustomerNode)[] = [
    {
      id: "customer",
      type: "customer",
      position: { x: 0, y: 0 },
      data: { name: trace.customer.name, kind: trace.customer.kind, flagged },
    },
  ];
  const place = (list: Party[], x: number) => {
    const spacing = Math.min(110, Math.max(72, 460 / Math.max(list.length, 1)));
    const startY = -((list.length - 1) * spacing) / 2;
    list.forEach((p, i) =>
      nodes.push({
        id: `p:${p.key}`,
        type: "party",
        position: { x, y: startY + i * spacing },
        data: {
          name: p.name,
          country: p.country,
          total: p.totalIn + p.totalOut,
          count: p.count,
          unexplained: p.unexplained,
        },
      })
    );
  };
  place(ins, -420);
  place(outs, 420);

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

  const edges: MoneyEdge[] = rows.map((r) => {
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
    const covered = !!r.covered_by;
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
        onDoc,
      },
    };
  });

  return { nodes, edges };
}

/* ------------------------------ component ------------------------------- */

function GraphInner({ trace, onDoc }: { trace: Trace; onDoc: (id: string) => void }) {
  const { nodes, edges } = useMemo(() => buildGraph(trace, onDoc), [trace, onDoc]);
  const covered = trace.coverage.filter((r) => r.covered_by).length;
  return (
    <div className="relative h-full w-full">
      <ReactFlow
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
        <Background color="rgba(255,255,255,0.035)" gap={28} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      {/* legend */}
      <div className="mono pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-obsidian-900/80 px-3 py-2 text-[10px] backdrop-blur">
        <span className="tracking-[0.18em] text-ink-500">MONEY FLOW · {trace.coverage.length} TXNS</span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5 rounded" style={{ background: COVERED }} />
          covered — document attached ({covered})
        </span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5 rounded" style={{ background: UNCOVERED }} />
          unexplained ({trace.coverage.length - covered})
        </span>
      </div>
    </div>
  );
}

export default function FlowGraph(props: { trace: Trace; onDoc: (id: string) => void }) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
