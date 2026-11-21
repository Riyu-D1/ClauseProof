"use client";

import { ccode, fmtDate, gbp } from "@/lib/format";
import type { Trace } from "@/lib/types";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[7px]">
      <span className="label shrink-0">{k}</span>
      <span className="text-right text-[12px] text-ink-100">{children}</span>
    </div>
  );
}

export default function CustomerCard({ trace }: { trace: Trace }) {
  const c = trace.customer;
  const observed = trace.coverage.reduce((s, r) => s + r.amount_gbp, 0);
  const multiple =
    c.declared_monthly_gbp && c.declared_monthly_gbp > 0
      ? observed / c.declared_monthly_gbp
      : null;
  const riskColor =
    c.risk_rating === "Low" ? "#38d07d" : c.risk_rating === "Medium" ? "#ffb224" : "#ff5566";
  return (
    <div className="panel flex flex-col p-5">
      <div className="label mb-2.5">Customer</div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink-100">{c.name}</div>
          <div className="mono mt-0.5 text-[10px] tracking-[0.08em] text-ink-500">{c.id}</div>
        </div>
        {c.risk_rating && (
          <span
            className="mono rounded border px-2 py-1 text-[10px] font-bold tracking-[0.1em]"
            style={{ color: riskColor, borderColor: `${riskColor}55` }}
          >
            {c.risk_rating.toUpperCase()}
          </span>
        )}
      </div>
      <div className="mt-1 text-[12px] text-ink-300">
        {c.occupation_or_activity ?? "—"} · {c.kind}
      </div>

      {/* declared vs observed — the signal, numbers right-aligned */}
      <div className="mt-4 rounded-lg border border-line bg-obsidian-900 p-4">
        <div className="label mb-1">Declared vs observed</div>
        <Row k="declared /mo">{gbp(c.declared_monthly_gbp)}</Row>
        <Row k="flagged">
          <span className={`mono ${multiple && multiple > 1 ? "text-rfi" : ""}`}>
            {gbp(observed)}
          </span>
        </Row>
        {multiple != null && (
          <Row k="multiple">
            <span
              className="doto text-[16px]"
              style={{ color: multiple > 2 ? "#ff5566" : multiple > 1 ? "#ffb224" : "#38d07d" }}
            >
              {multiple.toFixed(1)}×
            </span>
          </Row>
        )}
      </div>

      <div className="mt-3 divide-y divide-line">
        {c.account_purpose && <Row k="purpose">{c.account_purpose}</Row>}
        {c.source_of_funds && <Row k="SoF">{c.source_of_funds}</Row>}
        <Row k="countries">
          <span className="flex flex-wrap justify-end gap-1">
            {c.expected_countries.map((x) => (
              <span key={x} className="ctag" title={x}>
                {ccode(x)}
              </span>
            ))}
          </span>
        </Row>
        {c.expected_channels?.length ? (
          <Row k="channels">{c.expected_channels.join(", ")}</Row>
        ) : null}
        {c.onboarded_on && <Row k="onboarded">{fmtDate(c.onboarded_on)}</Row>}
        {c.review_window && (
          <Row k="window">
            {fmtDate(c.review_window.from)} → {fmtDate(c.review_window.to)}
          </Row>
        )}
        {c.address && <Row k="address">{c.address}</Row>}
      </div>

      {trace.risk_context.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">Risk context</div>
          <div className="flex flex-wrap gap-1.5">
            {trace.risk_context.map((r) => (
              <span
                key={r}
                className="mono rounded border border-[#ffb22444] px-1.5 py-0.5 text-[10px] tracking-[0.06em] text-rfi"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="label mb-2">Alerts ({trace.alerts.length})</div>
        <div className="flex flex-col gap-1.5">
          {trace.alerts.map((a) => (
            <div
              key={a.alert_id}
              className="rounded-lg border border-line bg-obsidian-900 px-3 py-2.5"
              title={a.message}
            >
              <div className="flex items-center justify-between">
                <span className="mono text-[10.5px] font-bold tracking-[0.08em] text-ink-100">
                  {a.rule_id}
                </span>
                <span className="mono text-[9.5px] text-ink-500">{a.alert_id}</span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-ink-400">{a.rule_name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
