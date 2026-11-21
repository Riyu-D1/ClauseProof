import GrokAssistPanel, { GrokReadTag } from "@/components/GrokAssistPanel";
import PageCaption from "@/components/PageCaption";

// Real grok_summary.json from the warm payments_fx run (5th replay):
// 32 purchase_order docs the parser could not extract, all served from
// cache, zero API calls.
const EXAMPLE_SUMMARY = {
  enabled: true,
  key_configured: false,
  model: "grok-4.20-0309-non-reasoning",
  prompt_version: "grok-assist-v1",
  docs_and_rules_examined: 32,
  docs_read_by_grok: 32,
  api_calls: 0,
  cache_hits: 32,
  invalid_answers: 0,
  call_failures: 0,
  budget_stops: 0,
  budget: 200,
  cache_dir: "output/grok_cache",
};

// Preview of the Grok-assist switch + tag until the /run page lands.
// Summary above is a real warm-run summary from payments_fx.
export default function GrokDemo() {
  return (
    <div>
      <PageCaption>
        GROK-ASSIST PANEL PREVIEW — drop-in switch for the /run page
        (example data)
      </PageCaption>
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <GrokAssistPanel summary={EXAMPLE_SUMMARY} />
        <div className="mono rounded border border-line bg-panel px-3 py-2 text-[11px] text-ink-300">
          <div className="mb-1 tracking-[0.08em] text-ink-500">
            EVIDENCE ROWS (example)
          </div>
          {["SALE-9001 — Archived sale memo for a vehicle",
            "INV-2291 — Invoice from Kelwell Retail Ltd",
            "POA-1005 — Energy bill used as proof of address"].map(
            (row, i) => (
              <div
                key={row}
                className="flex items-center justify-between border-t border-line py-1.5"
              >
                <span>{row}</span>
                {i === 0 && (
                  <GrokReadTag note="Archived memo recording the sale of a vehicle for GBP 9,500." />
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
