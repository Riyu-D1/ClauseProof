#!/usr/bin/env python3
"""Grok assist layer for ClauseProof.

Opt-in, deterministic-by-cache assistance for the deterministic engine.
Grok is only ever asked to READ documents the parser could not classify or
whose fields it could not extract (unhandled doc types, unrecognised table
layouts, all-empty extracted fields) and to gloss rule IDs the engine does
not model. It never decides a verdict.

Env:
    XAI_API_KEY        API key (without it the layer replays fixtures and
                       the run cache only -- never touches the network).
    XAI_MODEL          default grok-4.20-0309-non-reasoning
    XAI_BASE_URL       default https://api.x.ai/v1 (any OpenAI-compatible
                       chat-completions endpoint, e.g. OpenRouter)
    GROK_BUDGET        max API calls per run, default 200
    GROK_TIMEOUT       per-call seconds, default 8
    GROK_CONCURRENCY   parallel API calls, default 4
    GROK_CACHE_DIR     override the cache dir (default <outdir>/grok_cache)

Cache: one JSON file per request keyed by
sha256(model | prompt_version | request bytes). Successful AND failed
responses are cached, so warm runs replay byte-identical output and
traces. Committed fixtures live in system/grok_fixtures/ and are consulted
read-only, so the dev institutions get Grok-assisted runs with no key and
no network.

Standard library only.
"""

import hashlib
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PROMPT_VERSION = "grok-assist-v1"
DEFAULT_MODEL = "grok-4.20-0309-non-reasoning"
DEFAULT_BASE = "https://api.x.ai/v1"
FIXTURE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "grok_fixtures")

# ---------------------------------------------------------------------------
# What the deterministic parser is sure about
# ---------------------------------------------------------------------------

# Types Doc._extract() maps to coverage claims / events / identities.
EVIDENCE_TYPES = {
    "invoice", "dealer_invoice", "hospital_invoice", "carrier_invoice",
    "supplier_invoice", "receipt", "supplier_invoices", "freight_invoices",
    "payment_file", "contract_schedule", "consulting_contract",
    "supply_contract", "purchase_order", "booking_confirmation",
    "cash_reconciliation", "cash_collection_reports", "takings_book",
    "venue_email", "deposit_return_letter", "cancellation_confirmation",
    "credit_note", "insurer_letter", "settlement_letter", "solicitor_letter",
    "completion_statement", "sale_receipt", "vehicle_sale_receipt",
    "holding_deposit_receipt", "advert", "loan_agreement", "gift_letter",
    "factoring_agreement", "remittance_advice", "group_structure",
    "company_register_extract", "significant_control_register",
    "bank_statement", "reverification_record", "device_export",
    "sending_bank_fraud_report", "redundancy_letter", "employment_contract",
}

# Types the parser deliberately treats as context only (KYC, comms, notes).
# An unknown type NOT in this set and not in EVIDENCE_TYPES, showing
# financial signals, is a candidate for Grok.
CONTEXT_TYPES = {
    "due_diligence_summary", "proof_of_address", "insurance_schedule",
    "management_accounts", "ticket_report", "cash_handling_procedure",
    "contact_note", "staff_note", "support_chat", "customer_email",
    "customer_letter", "email",
}

# Rule IDs the engine models (engine.py rule dispatch). Others are unknown.
KNOWN_RULES = {"TM01", "TM02", "TM03", "TM04", "TM05", "TM06", "TM07",
               "TM08", "TM10", "TM22"}

# Claim keys that do not, by themselves, count as extracted content.
_FILLER = {"kind", "doc_id", "date", "text", "instalments", "any_amount",
           "assisted_by"}

DOC_CLASSES = [
    "invoice", "payment_file", "contract", "letter_credit", "refund",
    "statement", "register", "cash_record", "kyc", "other",
]
PARTY_ROLES = ["payee", "payer", "buyer", "seller", "issuer", "subject",
               "officer", "other"]

SYSTEM_PROMPT = """\
You are a forensic document-reading component inside a transaction-monitoring
alert triage system. A deterministic parser failed to classify the following
evidence document or to extract its fields. Read it and return STRICT JSON
only, no prose, matching exactly this schema:

{
  "doc_class": one of ["invoice","payment_file","contract","letter_credit",
    "refund","statement","register","cash_record","kyc","other"],
  "summary": string, one sentence, <= 200 chars,
  "parties": [{"name": string, "role": one of
    ["payee","payer","buyer","seller","issuer","subject","officer","other"]}],
  "amounts_gbp": [numbers, GBP amounts mentioned, no symbols],
  "dates_iso": ["YYYY-MM-DD"],
  "proves": string, one sentence: what fact this document evidences,
  "field_mapping": {"payee": <the document's own label for the payee, if any>,
    "amount": <its label for the amount>, "date": <its label for the date>}
}

Rules: report only what the document literally states; never infer or advise;
empty arrays when nothing found; "letter_credit" means a letter evidencing
funds RECEIVED (insurance, settlement, inheritance, sale). Do not assess
risk, never recommend a decision.\
"""

RULE_SYSTEM_PROMPT = """\
You are a component in a transaction-monitoring system. A deterministic
engine does not model the alert rule below. In STRICT JSON only, describe
what the rule measures:

{"measures": string <= 120 chars, "threshold_gbp": number or null,
 "window_days": number or null, "typical_risk": string <= 120 chars}

Describe only; never recommend a verdict.\
"""

DOC_SCHEMA = {
    "type": "object",
    "properties": {
        "doc_class": {"type": "string", "enum": DOC_CLASSES},
        "summary": {"type": "string"},
        "parties": {"type": "array", "items": {
            "type": "object",
            "properties": {"name": {"type": "string"},
                           "role": {"type": "string", "enum": PARTY_ROLES}},
            "required": ["name", "role"], "additionalProperties": False}},
        "amounts_gbp": {"type": "array", "items": {"type": "number"}},
        "dates_iso": {"type": "array", "items": {"type": "string"}},
        "proves": {"type": "string"},
        "field_mapping": {"type": "object"},
    },
    "required": ["doc_class", "summary", "parties", "amounts_gbp",
                 "dates_iso", "proves", "field_mapping"],
    "additionalProperties": False,
}

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _clip(s, n):
    return s[:n] if isinstance(s, str) else ""


def validate_doc_answer(raw):
    """Return a normalised answer dict, or None if invalid."""
    if not isinstance(raw, dict):
        return None
    if raw.get("doc_class") not in DOC_CLASSES:
        return None
    parties = []
    for p in raw.get("parties") or []:
        if isinstance(p, dict) and isinstance(p.get("name"), str) \
                and p.get("role") in PARTY_ROLES:
            parties.append({"name": _clip(p["name"], 160),
                            "role": p["role"]})
    amounts = []
    for a in raw.get("amounts_gbp") or []:
        if isinstance(a, (int, float)) and not isinstance(a, bool) \
                and 0 <= a < 1e12:
            amounts.append(float(a))
    dates = [d for d in (raw.get("dates_iso") or [])
             if isinstance(d, str) and _ISO.match(d)]
    fm = raw.get("field_mapping")
    return {
        "doc_class": raw["doc_class"],
        "summary": _clip(raw.get("summary"), 200),
        "parties": parties[:12],
        "amounts_gbp": amounts[:64],
        "dates_iso": sorted(set(dates))[:32],
        "proves": _clip(raw.get("proves"), 300),
        "field_mapping": {str(k)[:60]: _clip(v, 120)
                          for k, v in fm.items()
                          if isinstance(v, str)} if isinstance(fm, dict)
        else {},
    }


def validate_rule_answer(raw):
    if not isinstance(raw, dict):
        return None
    thr = raw.get("threshold_gbp")
    win = raw.get("window_days")
    return {
        "measures": _clip(raw.get("measures"), 120),
        "threshold_gbp": float(thr)
        if isinstance(thr, (int, float)) else None,
        "window_days": int(win) if isinstance(win, int)
        and not isinstance(win, bool) else None,
        "typical_risk": _clip(raw.get("typical_risk"), 120),
    }


# ---------------------------------------------------------------------------
# Assist object
# ---------------------------------------------------------------------------

class GrokAssist:
    """Cache-first Grok reader. Without a key it replays fixtures/cache and
    never touches the network."""

    def __init__(self, enabled, cache_dir):
        self.enabled = enabled
        self.api_key = os.environ.get("XAI_API_KEY", "")
        self.model = os.environ.get("XAI_MODEL", DEFAULT_MODEL)
        self.base = os.environ.get("XAI_BASE_URL", DEFAULT_BASE).rstrip("/")
        self.budget = int(os.environ.get("GROK_BUDGET", "200"))
        self.timeout = float(os.environ.get("GROK_TIMEOUT", "8"))
        self.concurrency = max(1, int(os.environ.get("GROK_CONCURRENCY", "4")))
        self.cache_dir = cache_dir
        self.fixture_dir = FIXTURE_DIR
        self.calls = 0            # real API calls made this run
        self.cache_hits = 0       # served from run cache or fixtures
        self.asked = 0            # documents/rules evaluated for assist
        self.docs_read = 0        # docs Grok successfully read (or replayed)
        self.invalid = 0          # Grok answered but failed validation
        self.failures = 0         # transport/timeout failures
        self.budget_stops = 0     # candidates dropped by the budget cap
        self._mem = {}            # key -> cache record
        # TLS: macOS Pythons often lack the system store; prefer an
        # explicit cafile when present. Verification is never disabled.
        self._ctx = None
        for ca in (os.environ.get("SSL_CERT_FILE"), "/etc/ssl/cert.pem"):
            if ca and os.path.exists(ca):
                self._ctx = ssl.create_default_context(cafile=ca)
                break
        if self._ctx is None:
            self._ctx = ssl.create_default_context()
        if enabled and cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    # -- key + cache ------------------------------------------------------

    def _key(self, kind, payload):
        blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        h = hashlib.sha256()
        h.update(self.model.encode())
        h.update(b"\x00")
        h.update(PROMPT_VERSION.encode())
        h.update(b"\x00")
        h.update(kind.encode())
        h.update(b"\x00")
        h.update(blob.encode())
        return h.hexdigest()

    def _cache_path(self, key):
        return os.path.join(self.cache_dir, key + ".json")

    def _fixture_path(self, key):
        return os.path.join(self.fixture_dir, key + ".json")

    def _lookup(self, key):
        if key in self._mem:
            self.cache_hits += 1
            return self._mem[key]
        paths = [self._fixture_path(key)]
        if self.cache_dir:
            paths.insert(0, self._cache_path(key))
        for path in paths:
            if os.path.exists(path):
                try:
                    with open(path, encoding="utf-8") as f:
                        rec = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                self._mem[key] = rec
                self.cache_hits += 1
                return rec
        return None

    def _store(self, key, rec):
        self._mem[key] = rec
        if self.cache_dir:
            tmp = self._cache_path(key) + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(rec, f, ensure_ascii=False, sort_keys=True)
            os.replace(tmp, self._cache_path(key))

    # -- HTTP -------------------------------------------------------------

    def _chat_once(self, system_prompt, user_prompt, schema):
        body = {
            "model": self.model,
            "temperature": 0,
            "seed": 7,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if schema:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "grok_assist", "strict": True,
                                "schema": schema},
            }
        else:
            body["response_format"] = {"type": "json_object"}
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + self.api_key},
            method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout,
                                    context=self._ctx) as r:
            out = json.loads(r.read())
        content = out["choices"][0]["message"]["content"]
        return json.loads(content)

    def _chat(self, system_prompt, user_prompt, schema):
        """One call; on HTTP 400 from a strict schema, retry json_object."""
        try:
            return self._chat_once(system_prompt, user_prompt, schema)
        except urllib.error.HTTPError as e:
            if e.code == 400 and schema is not None:
                return self._chat_once(system_prompt, user_prompt, None)
            raise

    def _fetch(self, key, kind, system_prompt, user_prompt, schema,
               validator):
        """One network fetch -> cache record (never raises)."""
        try:
            raw = self._chat(system_prompt, user_prompt, schema)
        except Exception as e:  # noqa: BLE001 - all failures identical
            return key, {"status": "error",
                         "error": f"{type(e).__name__}: {e}"[:200]}
        answer = validator(raw)
        if answer is None:
            return key, {"status": "invalid"}
        return key, {"status": "ok", "answer": answer}

    # -- documents --------------------------------------------------------

    @staticmethod
    def _claim_useful(claim):
        return any(v for k, v in claim.items() if k not in _FILLER)

    def needs_doc(self, meta, doc):
        """True when the deterministic parser is unsure about this doc."""
        if not self.enabled:
            return False
        t = meta.get("type", "")
        if t in CONTEXT_TYPES:
            return False
        if t in EVIDENCE_TYPES:
            # recognised type whose fields/tables yielded nothing usable
            if doc.suspicion:
                return False
            if any(self._claim_useful(c) for c in doc.claims):
                return False
            return bool(doc.tables or doc.amounts)
        # unknown type: only when it looks financial (money or a table)
        return bool(doc.tables) or len(doc.amounts) >= 2 \
            or bool(doc.amounts and doc.fields)

    def _doc_request(self, meta, text):
        payload = {"doc_id": meta["doc_id"], "type": meta.get("type", ""),
                   "title": meta.get("title", ""),
                   "dated": meta.get("dated"), "text": text[:12000]}
        key = self._key("doc", payload)
        user = (f"Document type label: {meta.get('type', '')}\n"
                f"Document title: {meta.get('title', '')}\n"
                f"Document date: {meta.get('dated', '')}\n\n"
                f"--- document ---\n{text[:12000]}")
        return key, user

    def process_docs(self, items):
        """items: [(meta, text, doc)] candidates in deterministic order.
        Sequential cache pre-pass, then a bounded thread pool for misses.
        Results are applied in submission order, never in arrival order."""
        if not self.enabled:
            return
        misses = []
        for meta, text, doc in items:
            self.asked += 1
            key, user = self._doc_request(meta, text)
            rec = self._lookup(key)
            if rec is not None:
                if rec.get("status") == "ok":
                    self.apply_doc(doc, rec["answer"], key)
                continue
            misses.append((doc, key, user))
        if not misses or not self.api_key:
            return
        room = max(0, self.budget - self.calls)
        todo = misses[:room]
        self.budget_stops += len(misses) - len(todo)
        if not todo:
            return

        def task(item):
            _doc, key, user = item
            return self._fetch(key, "doc", SYSTEM_PROMPT, user,
                               DOC_SCHEMA, validate_doc_answer)

        with ThreadPoolExecutor(max_workers=self.concurrency) as ex:
            results = list(ex.map(task, todo))
        for (doc, key, _u), (k, rec) in zip(todo, results):
            self.calls += 1
            self._store(k, rec)
            if rec["status"] == "ok":
                self.apply_doc(doc, rec["answer"], k)
            elif rec["status"] == "invalid":
                self.invalid += 1
            else:
                self.failures += 1

    def apply_doc(self, doc, answer, key):
        """Merge a validated answer into a parsed Doc. Adds coverage claims
        only where the schema supports them; always marks provenance."""
        doc.flags.add("grok_read")
        doc.grok_key = key
        doc.grok_note = answer["summary"] or answer["proves"]
        self.docs_read += 1
        parties = answer["parties"]
        by_role = {}
        for p in parties:
            by_role.setdefault(p["role"], p["name"])
        amount = max(answer["amounts_gbp"]) if answer["amounts_gbp"] \
            else None
        dated = answer["dates_iso"][0] if answer["dates_iso"] else doc.dated
        cls = answer["doc_class"]
        if cls in ("invoice", "payment_file", "contract"):
            payee = by_role.get("payee") or by_role.get("issuer") \
                or by_role.get("seller")
            if payee or amount:
                doc.add("payable", payee=payee, amount=amount, date=dated,
                        instalments=False, assisted_by="grok",
                        text=doc.title)
        elif cls == "letter_credit":
            payer = by_role.get("payer") or by_role.get("seller") \
                or by_role.get("issuer")
            if payer or amount:
                doc.add("event", payer=payer, amount=amount, date=dated,
                        assisted_by="grok", text=doc.title)
        elif cls == "refund":
            payer = by_role.get("payer") or by_role.get("issuer")
            if payer or amount:
                doc.add("refund", payer=payer, amount=amount, date=dated,
                        assisted_by="grok", text=doc.title)
        elif cls == "statement":
            holder = by_role.get("subject") or by_role.get("payee")
            if holder:
                doc.add("own_account", holder=holder, bank=None,
                        account=None, transfers=[], assisted_by="grok",
                        text=doc.title)
        elif cls == "cash_record":
            rows = [{"label": answer["summary"][:80] or "per document",
                     "amount": a, "date": dated}
                    for a in answer["amounts_gbp"][:24]]
            if rows:
                doc.add("cash_banking", rows=rows, assisted_by="grok",
                        text=doc.title)
        elif cls == "register":
            subject = by_role.get("subject") or by_role.get("issuer")
            officers = [{"name": p["name"], "born": None, "resigned": None,
                         "role": "officer"}
                        for p in parties if p["role"] == "officer"]
            if subject or officers:
                doc.add("register", company=subject, officers=officers,
                        pscs=[], dissolved=None, address=None,
                        business=None, assisted_by="grok", text=doc.title)
        # kyc / other: provenance tag only, no claim added

    # -- rules --------------------------------------------------------------

    def assist_rules(self, alerts):
        """Interpretations for rule IDs the engine does not model.
        Cached identically; trace context only, never verdicts.
        Returns {rule_id: answer}."""
        out = {}
        if not self.enabled:
            return out
        seen = {}
        for a in alerts:
            rid = a.get("rule_id", "")
            if rid in KNOWN_RULES or rid in seen or rid in out:
                continue
            seen[rid] = a
        for rid in sorted(seen):
            a = seen[rid]
            self.asked += 1
            payload = {"rule_id": rid,
                       "rule_name": a.get("rule_name", ""),
                       "message": a.get("message", "")}
            key = self._key("rule", payload)
            rec = self._lookup(key)
            if rec is None and self.api_key \
                    and self.calls < self.budget:
                user = (f"rule_id: {rid}\n"
                        f"rule_name: {a.get('rule_name', '')}\n"
                        f"alert message: {a.get('message', '')}")
                _, rec = self._fetch(key, "rule", RULE_SYSTEM_PROMPT,
                                     user, None, validate_rule_answer)
                self.calls += 1
                self._store(key, rec)
                if rec["status"] == "invalid":
                    self.invalid += 1
                elif rec["status"] != "ok":
                    self.failures += 1
            elif rec is None:
                self.budget_stops += 1
            if rec and rec.get("status") == "ok":
                ans = dict(rec["answer"])
                ans["assisted_by"] = "grok"
                ans["cache_key"] = key
                out[rid] = ans
        return out

    # -- summary ------------------------------------------------------------

    def summary(self):
        return {
            "enabled": self.enabled,
            "key_configured": bool(self.api_key),
            "model": self.model,
            "prompt_version": PROMPT_VERSION,
            "docs_and_rules_examined": self.asked,
            "docs_read_by_grok": self.docs_read,
            "api_calls": self.calls,
            "cache_hits": self.cache_hits,
            "invalid_answers": self.invalid,
            "call_failures": self.failures,
            "budget_stops": self.budget_stops,
            "budget": self.budget,
            "cache_dir": self.cache_dir,
        }


def from_env(outdir, flag):
    """Build the assist object for a run. `flag` = --grok on the CLI.
    Without the flag AND without a key the layer is fully inert: the engine
    then behaves exactly as it does today."""
    enabled = bool(flag or os.environ.get("XAI_API_KEY"))
    cache_dir = os.environ.get("GROK_CACHE_DIR") \
        or (os.path.join(outdir, "grok_cache") if outdir else None)
    if enabled and not os.environ.get("XAI_API_KEY"):
        sys.stderr.write(
            "grok: enabled but XAI_API_KEY is not set; "
            "replaying cache/fixtures only\n")
    return GrokAssist(enabled, cache_dir)


def _selftest():
    """Schema validation + cache replay with no network."""
    import tempfile
    tmp = tempfile.mkdtemp()
    a = GrokAssist(True, tmp)
    good = {"doc_class": "invoice", "summary": "x", "parties":
            [{"name": "Acme", "role": "payee"}],
            "amounts_gbp": [100.0], "dates_iso": ["2026-01-02"],
            "proves": "x", "field_mapping": {"payee": "Vendor"}}
    assert validate_doc_answer(good)["amounts_gbp"] == [100.0]
    assert validate_doc_answer({"doc_class": "nope"}) is None
    assert validate_doc_answer("str") is None
    assert validate_rule_answer({"measures": "m"})["window_days"] is None
    key = a._key("doc", {"doc_id": "SELFTEST", "type": "x", "text": "t"})
    a._store(key, {"status": "ok",
                   "answer": validate_doc_answer(good)})
    b = GrokAssist(True, tmp)
    rec = b._lookup(key)
    assert rec and rec["answer"]["doc_class"] == "invoice"
    assert b.cache_hits == 1
    print("grok_assist selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
