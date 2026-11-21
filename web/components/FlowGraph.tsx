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
import { buildGraphModel, type FlowEdge, type VisParty } from "@/lib/graph-layout";
import type { CoverageRow, Trace, TxListing } from "@/lib/types";

const COVERED = "#38d07d";
const UNCOVERED = "#ff5566";
const HELD = "#ffb224";

/* ------------------------------- nodes ---------------------------------- */

type PartyNodeData = { v: VisParty; delay: number; onList?: (l: TxListing) => void };
type PartyNode = Node<PartyNodeData, "party">;
type CustomerNode = Node<{ name: string; kind: string; flagged: number; delay: number }, "customer">;
type MoneyEdgeData = {
  e: FlowEdge;
  partyName: string;
  idx: number;
  onDoc: (docId: string) => void;
  onList?: (l: TxListing) => void;
};
type MoneyEdge = Edge<MoneyEdgeData, "money">;

const handleStyle = { opacity: 0, width: 6, height: 6, pointerEvents: "none" as const };

const listingFor = (v: VisParty, rows?: CoverageRow[], sub?: string): TxListing => ({
  title: v.name,
  sub:
    sub ??
    `${v.dir === "in" ? "IN →" : "OUT →"} · ${
      v.parties > 1 ? `${v.parties} parties · ` : ""
    }${v.count} txns · ${gbp(v.total)}`,
  rows: rows ?? v.rows,
});

const PartyNodeView = memo(({ data }: NodeProps<PartyNode>) => {
  const { v, onList } = data;
  const clickable = !!onList;
  const group = v.kind === "group";
  return (
    <div
      className={`cp-node-in group relative w-[190px] rounded-lg border px-3 py-2.5 ${
        clickable ? "cursor-pointer" : ""
      }`}
      style={{
        animationDelay: `${data.delay}ms`,
        background: group ? "var(--color-obsidian-900)" : "var(--color-obsidian-850)",
        borderColor: v.unexplained ? "#ff556655" : "var(--color-line-2)",
        borderStyle: group ? "dashed" : "solid",
      }}
      onClick={clickable ? () => onList(listingFor(v)) : undefined}
      title={clickable ? `${v.count} transactions — click to list` : undefined}
    >
      {clickable && (
        <span className="pointer-events-none absolute inset-0 rounded-lg border border-accent opacity-0 transition-opacity group-hover:opacity-60" />
      )}
      <Handle id="l-src" type="source" position={Position.Left} style={handleStyle} />
      <Handle id="l-tgt" type="target" position={Position.Left} style={handleStyle} />
      <Handle id="r-src" type="source" position={Position.Right} style={handleStyle} />
      <Handle id="r-tgt" type="target" position={Position.Right} style={handleStyle} />
      <div className="flex items-center gap-2">
        {group ? (
          <span className="mono flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-2 bg-obsidian-800 px-1 text-[9.5px] font-bold text-ink-300">
            +{v.parties}
          </span>
        ) : (
          <span className="ctag" title={v.country}>{ccode(v.country)}</span>
        )}
        <span className="truncate text-[12px] font-medium text-ink-100" title={v.name}>
          {group ? "others" : v.name}
        </span>
      </div>
      <div className="mono mt-1.5 flex items-center justify-between text-[9.5px] tracking-[0.06em] text-ink-500">
        <span>{gbpShort(v.total)}</span>
        <span>
          {v.count} txn{v.count > 1 ? "s" : ""}
          {v.unexplained ? ` · ${v.unexplained}?` : ""}
        </span>
      </div>
      {group && clickable && (
        <div className="mono mt-1 text-[8.5px] tracking-[0.14em] text-accent/80">
          LIST TXNS →
        </div>
      )}
    </div>
  );
});
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

function selfLoopPath(sx: number, sy: number, i: number): [string, number, number] {
  const r = 46 + i * 34;
  return [
    `M ${sx},${sy} C ${sx - r},${sy - r * 2.4} ${sx + r},${sy - r * 2.4} ${sx + 2},${sy - 2}`,
    sx,
    sy - r * 1.7,
  ];
}

const chipStyle = (covered: boolean) => ({
  background: "var(--color-obsidian-800)",
  color: covered ? COVERED : UNCOVERED,
  border: `1px solid ${covered ? `${COVERED}55` : `${UNCOVERED}66`}`,
});

const MoneyEdgeView = memo((props: EdgeProps<MoneyEdge>) => {
  const { id, sourceX, sourceY, targetX, targetY, data } = props;
  const d = data!;
  const e = d.e;
  const loop = props.source === props.target;
  const loopIdx = loop ? (e.covered ? 0 : 1) : 0;
  const [path, labelX, labelY] = loop
    ? selfLoopPath(sourceX, sourceY - 8, loopIdx)
    : quadPath(sourceX, sourceY, targetX, targetY, e.offset);
  const drawDelay = d.idx * 60;
  const n = e.rows.length;
  const openList = () =>
    d.onList?.({
      title: d.partyName,
      sub: `${e.inFlow ? "in →" : "out →"} ${
        e.covered ? "covered" : "unexplained"
      } · ${n} txn${n > 1 ? "s" : ""} · ${gbp(e.total)}`,
      rows: e.rows,
    });

  let chip: React.ReactNode;
  if (e.covered && e.docId) {
    chip = (
      <button
        className="edge-chip pointer-events-auto"
        style={{ ...chipStyle(true), transition: "color .4s ease, border-color .4s ease" }}
        title={`${n} txn${n > 1 ? "s" : ""} · ${gbp(e.total)} — open ${e.docId}`}
        onClick={(ev) => {
          ev.stopPropagation();
          d.onDoc(e.docId!);
        }}
      >
        ✓ {e.docId}
        {n > 1 ? ` ×${n}` : ""}
      </button>
    );
  } else if (e.covered && n === 1 && !e.simulated) {
    chip = (
      <button
        className={`edge-chip ${d.onList ? "pointer-events-auto" : ""}`}
        style={{ ...chipStyle(true), cursor: d.onList ? "pointer" : "default" }}
        title={`${e.rows[0].transaction_id} · ${gbp(e.total)} — ${e.rows[0].why}`}
        onClick={d.onList ? openList : undefined}
      >
        ✓ {e.rows[0].covered_by}
      </button>
    );
  } else {
    chip = (
      <button
        className={`edge-chip ${d.onList ? "pointer-events-auto" : ""}`}
        style={{ ...chipStyle(e.covered), cursor: d.onList ? "pointer" : "default" }}
        title={
          e.covered
            ? `${n} txns · ${gbp(e.total)} — click to list`
            : e.simulated
              ? `${n} txn${n > 1 ? "s" : ""} · ${gbp(e.total)} — removed in the flip scenario`
              : `${n} txn${n > 1 ? "s" : ""} · ${gbp(e.total)} — click to list`
        }
        onClick={d.onList ? openList : undefined}
      >
        {e.covered ? "✓" : "?"} {gbpShort(e.total)}
        {n > 1 ? ` · ${n} txns` : e.covered ? "" : " unexplained"}
      </button>
    );
  }

  return (
    <>
      {/* under-glow — sweeps in on mount, recolours with the flip state */}
      <path
        d={path}
        fill="none"
        stroke={e.covered ? COVERED : UNCOVERED}
        strokeWidth={e.width + 7}
        strokeOpacity={0.13}
        pathLength={1}
        className={`edge-draw ${e.covered ? "" : "edge-uncovered"}`}
        style={{ animationDelay: `${drawDelay}ms`, transition: "stroke .4s ease" }}
      />
      <BaseEdge
        id={id}
        path={path}
        className={`edge-flow edge-fade ${e.covered ? "" : "edge-uncovered"}`}
        style={{
          stroke: e.covered ? COVERED : UNCOVERED,
          strokeWidth: e.width,
          animationDelay: `${drawDelay + 200}ms, 0s`,
          transition: "stroke .4s ease",
        }}
      />
      <foreignObject
        x={labelX - 75}
        y={labelY - 12}
        width={150}
        height={26}
        className="pointer-events-none overflow-visible"
      >
        <div
          className="edge-chipwrap flex h-full items-center justify-center gap-1"
          style={{ animationDelay: `${drawDelay + 320}ms` }}
        >
          {chip}
          {e.held && (
            <span
              className="edge-chip"
              style={{
                background: "var(--color-obsidian-800)",
                color: HELD,
                border: `1px solid ${HELD}55`,
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

const NODE_W = 190;
const CUST_W = 220;
const DX = 390; // column centre distance from the customer
const SP = 84; // vertical pitch inside a column

function GraphInner({
  trace,
  onDoc,
  flipped,
  onList,
}: {
  trace: Trace;
  onDoc: (id: string) => void;
  flipped: boolean;
  onList?: (l: TxListing) => void;
}) {
  const model = useMemo(() => buildGraphModel(trace, flipped), [trace, flipped]);

  const { nodes, edges } = useMemo(() => {
    const nodes: (PartyNode | CustomerNode)[] = [
      {
        id: "customer",
        type: "customer",
        position: { x: -CUST_W / 2, y: -52 },
        data: { name: trace.customer.name, kind: trace.customer.kind, flagged: model.flagged, delay: 0 },
      },
    ];
    const place = (list: VisParty[], side: -1 | 1, base: number) => {
      list.forEach((v, i) => {
        nodes.push({
          id: v.id,
          type: "party",
          position: {
            x: side * DX - NODE_W / 2,
            y: (i - (list.length - 1) / 2) * SP - 27,
          },
          data: { v, delay: base + i * 40, onList },
        });
      });
    };
    place(model.ins, -1, 80);
    place(model.outs, 1, 80 + model.ins.length * 40);

    const byId = new Map([...model.ins, ...model.outs].map((v) => [v.id, v]));
    const edges: MoneyEdge[] = model.edges.map((e, i) => {
      const v = byId.get(e.nodeId);
      const side = v?.dir === "in" ? -1 : 1;
      let source = "customer";
      let target = "customer";
      let sourceHandle = "t-src";
      let targetHandle = "t-tgt";
      if (!e.loop && v) {
        if (e.inFlow) {
          source = v.id;
          sourceHandle = side < 0 ? "r-src" : "l-src";
          targetHandle = side < 0 ? "l-tgt" : "r-tgt";
        } else {
          target = v.id;
          sourceHandle = side < 0 ? "l-src" : "r-src";
          targetHandle = side < 0 ? "r-tgt" : "l-tgt";
        }
      }
      return {
        id: e.id,
        type: "money",
        source,
        target,
        sourceHandle,
        targetHandle,
        data: { e, partyName: v?.name ?? trace.customer.name, idx: i, onDoc, onList },
      };
    });
    return { nodes, edges };
  }, [model, trace, onDoc, onList]);

  return (
    <div className="flex h-full w-full flex-col">
      {/* legend header — flat strip so it can never overlap nodes; £ totals reconcile to flagged */}
      <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2 text-[9.5px]">
        <span className="tracking-[0.18em] text-ink-500">
          MONEY FLOW · {trace.coverage.length} TXNS · {model.parties} PARTIES
          {flipped && trace.flip ? " · FLIPPED" : ""}
        </span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5" style={{ background: COVERED }} />
          covered {gbpShort(model.coveredTotal)} · {model.coveredRows} txns
        </span>
        <span className="flex items-center gap-1.5 text-ink-300">
          <span className="inline-block h-[3px] w-5" style={{ background: UNCOVERED }} />
          unexplained {gbpShort(model.uncovTotal)} · {model.uncovRows} txns
        </span>
        {model.grouped > 0 && (
          <span className="ml-auto text-ink-500">
            +{model.grouped} parties in “others” — click a node to list txns
          </span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          key={`${trace.case_id}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1.1 }}
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
      </div>
    </div>
  );
}

export default function FlowGraph(props: {
  trace: Trace;
  onDoc: (id: string) => void;
  flipped: boolean;
  onList?: (l: TxListing) => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphInner {...props} />
    </ReactFlowProvider>
  );
}
