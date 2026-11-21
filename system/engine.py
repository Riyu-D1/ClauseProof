#!/usr/bin/env python3
"""ClauseProof deterministic triage engine.

Reads one institution folder (POLICY.md, cases/alerts/customers/transactions/
evidence/previous_reviews/internal_list) and writes one JSON verdict line per
case, plus a per-case trace file for the demo UI.

Standard library only. Fully deterministic: sorted iteration, no randomness,
no time dependence, no network.
"""

import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timedelta

ENGINE_VERSION = "1.0.0"

HIGH_RISK = {
    "afghanistan", "belarus", "democratic republic of the congo", "haiti",
    "iran", "iraq", "lebanon", "libya", "mali", "myanmar", "north korea",
    "russia", "somalia", "south sudan", "syria", "venezuela", "yemen",
}

CLOSE_CODES = {
    "COLLECTION_DOCUMENTED", "BUSINESS_RECORDS_RECONCILE", "DOCUMENTED_EVENT",
    "INVOICE_MATCHES", "OWN_ACCOUNT", "GROUP_COMPANY",
    "THIRD_PARTY_DOCUMENTED", "REFUND_OF_EARLIER_PAYMENT",
    "RETURNING_CUSTOMER", "LIST_MATCH_DIFFERENT_PARTY", "WITHIN_PROFILE",
}
RFI_CODES = {
    "RFI_PURPOSE_DOCUMENTS", "RFI_BUSINESS_RECORDS", "RFI_SOURCE_OF_FUNDS",
    "RFI_COUNTERPARTY_DETAILS", "RFI_UPDATED_PROFILE",
}
ESC_CODES = {
    "ESC_MULE_ACTIVITY", "ESC_STRUCTURING", "ESC_UNEXPLAINED_FUNDS",
    "ESC_PASS_THROUGH", "ESC_INVOICE_MISMATCH", "ESC_HIGH_RISK_CORRIDOR",
    "ESC_ACCOUNT_MISUSE", "ESC_THIRD_PARTY_FUNDING", "ESC_EARLY_REDEMPTION",
    "ESC_LISTED_PARTY",
}
CODE_BY_VERDICT = {"CLOSE": CLOSE_CODES, "RFI": RFI_CODES, "ESCALATE": ESC_CODES}

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}

MONEY_RE = re.compile(r"£\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
DATE_RE = re.compile(r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|"
                     r"August|September|October|November|December)\s+(\d{4})\b",
                     re.I)
MONTH_YEAR_RE = re.compile(r"\b(January|February|March|April|May|June|July|"
                           r"August|September|October|November|December)\s+(\d{4})\b",
                           re.I)
ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
FIELD_RE = re.compile(r"^\s*\*\*([^*:]+):\*\*\s*(.+?)\s*$")
ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")

COMPANY_SUFFIXES = {
    "ltd", "limited", "llp", "plc", "inc", "co", "company", "gmbh", "sarl",
    "fze", "sal", "srl", "bv", "nv", "sa", "pty", "llc", "corp", "corporation",
    "lp", "pjsc", "holdings", "holding", "group", "sp", "z", "o", "sarl",
    "the", "uk", "international", "enterprises",
}


def parse_money(s):
    if s is None:
        return None
    m = MONEY_RE.search(str(s))
    if m:
        return float(m.group(1).replace(",", ""))
    m = re.search(r"([0-9][0-9,]*(?:\.\d{1,2})?)", str(s))
    return float(m.group(1).replace(",", "")) if m else None


def parse_date_text(s):
    """Parse '4 August 2026' or '2026-08-04' -> date."""
    if not s:
        return None
    m = ISO_DATE_RE.search(s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = DATE_RE.search(s)
    if m:
        return date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    return None


def parse_month_year(s):
    m = MONTH_YEAR_RE.search(str(s))
    if m:
        return (int(m.group(2)), MONTHS[m.group(1).lower()])
    return None


def all_dates(text):
    out = []
    for m in DATE_RE.finditer(text):
        out.append(date(int(m.group(3)), MONTHS[m.group(2).lower()],
                        int(m.group(1))))
    for m in ISO_DATE_RE.finditer(text):
        out.append(date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return out


def norm_name(name):
    """Normalise a party name for comparison."""
    if not name:
        return ""
    n = name.lower()
    n = re.sub(r"[.,'&()/\-]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def name_tokens(name):
    n = norm_name(name)
    toks = [t for t in n.split() if t and t not in COMPANY_SUFFIXES]
    return set(toks)


def same_party(a, b):
    """Fuzzy party match: same normalised string, or token containment."""
    if not a or not b:
        return False
    na, nb = norm_name(a), norm_name(b)
    if na == nb:
        return True
    ta, tb = name_tokens(a), name_tokens(b)
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    inter = ta & tb
    if inter and inter == ta or inter == tb:
        return True
    return False


def person_surname(name):
    toks = norm_name(name).split()
    return toks[-1] if toks else ""


def same_person(a, b):
    """Match people: surname equal and (first initial equal or one name
    contained in the other)."""
    if not a or not b:
        return False
    ta, tb = norm_name(a).split(), norm_name(b).split()
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    if ta[-1] != tb[-1]:
        return False
    return ta[0][:1] == tb[0][:1] or ta[0] == tb[0]


def is_company(name):
    n = norm_name(name)
    return bool(re.search(r"\b(ltd|limited|llp|plc|inc|gmbh|sarl|fze|srl|bv|"
                          r"nv|sa|pty|llc|corp|lp|pjsc|co|company)\b", n))


def surname_in_text(name, text):
    return person_surname(name) and person_surname(name) in norm_name(text).split()


# --------------------------------------------------------------------------
# Evidence document parsing
# --------------------------------------------------------------------------

class Doc:
    __slots__ = ("doc_id", "type", "title", "dated", "text", "fields",
                 "tables", "amounts", "flags", "claims", "suspicion")

    def __init__(self, meta, text):
        self.doc_id = meta["doc_id"]
        self.type = meta["type"]
        self.title = meta.get("title", "")
        self.dated = meta.get("dated")
        self.text = text
        self.fields = {}
        self.tables = []
        self.amounts = []
        self.flags = set()
        self.claims = []        # structured facts used for coverage
        self.suspicion = []     # (esc_code, detail) pairs
        self._parse()

    def _parse(self):
        cur_table = None
        for line in self.text.splitlines():
            fm = FIELD_RE.match(line)
            if fm:
                self.fields[fm.group(1).strip().lower()] = fm.group(2).strip()
                continue
            rm = ROW_RE.match(line)
            if rm:
                cells = [c.strip() for c in rm.group(1).split("|")]
                if all(set(c) <= set("-: ") for c in cells):
                    continue  # separator row
                if cur_table is None:
                    cur_table = []
                    self.tables.append(cur_table)
                cur_table.append(cells)
                continue
            cur_table = None
        self.amounts = [float(m.group(1).replace(",", ""))
                        for m in MONEY_RE.finditer(self.text)]
        self._extract()

    def field(self, *names):
        for n in names:
            for k, v in self.fields.items():
                if k == n or k.startswith(n):
                    return v
        return None

    def money_field(self, *names):
        v = self.field(*names)
        return parse_money(v) if v else None

    def add(self, kind, **kw):
        kw["kind"] = kind
        kw["doc_id"] = self.doc_id
        self.claims.append(kw)

    def _extract(self):
        t = self.type
        if t in ("invoice", "dealer_invoice", "hospital_invoice",
                 "carrier_invoice", "supplier_invoice", "receipt"):
            self._extract_invoice()
        elif t in ("supplier_invoices", "freight_invoices"):
            self._extract_multi_invoice()
        elif t == "payment_file":
            self._extract_payment_file()
        elif t in ("contract_schedule",):
            self._extract_contract_schedule()
        elif t in ("consulting_contract", "supply_contract"):
            self._extract_contract()
        elif t == "purchase_order":
            self._extract_purchase_order()
        elif t == "booking_confirmation":
            self._extract_booking()
        elif t in ("cash_reconciliation", "cash_collection_reports",
                   "takings_book"):
            self._extract_cash_records()
        elif t in ("cash_handling_procedure", "ticket_report",
                   "management_accounts"):
            self.flags.add("cash_context")
        elif t in ("venue_email", "deposit_return_letter",
                   "cancellation_confirmation", "credit_note"):
            self._extract_refund()
        elif t in ("insurer_letter", "settlement_letter", "solicitor_letter",
                   "completion_statement", "sale_receipt",
                   "vehicle_sale_receipt", "holding_deposit_receipt"):
            self._extract_event()
        elif t == "advert":
            self._extract_advert()
        elif t == "loan_agreement":
            self._extract_loan()
        elif t == "gift_letter":
            self._extract_gift()
        elif t in ("factoring_agreement", "remittance_advice"):
            self._extract_factoring()
        elif t == "group_structure":
            self._extract_group()
        elif t == "company_register_extract":
            self._extract_register()
        elif t == "significant_control_register":
            self._extract_psc()
        elif t == "bank_statement":
            self._extract_statement()
        elif t == "reverification_record":
            self._extract_reverification()
        elif t == "device_export":
            self._extract_device()
        elif t == "sending_bank_fraud_report":
            self._extract_fraud()
        elif t in ("support_chat", "contact_note", "staff_note",
                   "customer_email", "customer_letter"):
            self._extract_statement_text()
        elif t in ("redundancy_letter", "employment_contract"):
            self._extract_life_event()
        # generic flags
        low = self.text.lower()
        if "dissolved" in low:
            self.flags.add("mentions_dissolved")

    # ----- specific extractors -----

    def _extract_invoice(self):
        def party_name(v):
            v = re.split(r",|\s+account\b|\s+iban\b", v,
                         flags=re.I)[0].strip()
            return v or None

        payee = self.field("pay to")
        if payee:
            payee = party_name(payee)
            if payee and re.match(r"(?i)^(iban|account|acct|sort\b)",
                                  payee):
                payee = None
        if not payee:
            payee = party_name(self.field("supplier", "carrier",
                                          "payee", "seller") or "")
        if not payee:
            m = re.search(r"from\s+(.+?)(?:\s*$|\s+for)", self.title)
            payee = m.group(1).strip() if m else None
        amount = (self.money_field("amount due", "total", "price", "fee",
                                   "paid by bank transfer", "amount")
                  or (self.amounts[0] if self.amounts else None))
        self.add("payable", payee=payee, amount=amount,
                 date=self.dated, instalments=False,
                 text=self.title)
        m = re.search(r"payable in\s+(\w+)\s+instalments", self.text, re.I)
        if m:
            self.claims[-1]["instalments"] = True
        # account details help confirm identity
        payto = self.field("pay to")
        if payto:
            self.claims[-1]["account_hint"] = payto

    def _extract_multi_invoice(self):
        m = re.search(r"from\s+(.+?)\s*$", self.title)
        supplier = m.group(1).strip() if m else self.field("supplier")
        payer_cols = ("exporter", "importer", "customer", "client",
                      "payer", "shipper", "bill to", "billed")
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            ai = next((i for i, h in enumerate(hdr)
                       if "amount" in h or "total" in h), len(hdr) - 1)
            pi = next((i for i, h in enumerate(hdr)
                       if any(p in h for p in payer_cols)), None)
            si = next((i for i, h in enumerate(hdr)
                       if "supplier" in h or "vendor" in h), None)
            for row in tbl[1:]:
                amt = parse_money(row[ai]) if ai < len(row) else None
                if not amt:
                    continue
                if pi is not None and pi < len(row):
                    # an invoice the client issued to a payer: a
                    # receivable that covers money coming in
                    self.add("receivable", payer=row[pi].strip(),
                             amount=amt, date=self.dated,
                             text=row[0] if row else "")
                else:
                    payee = (row[si].strip()
                             if si is not None and si < len(row)
                             else supplier)
                    self.add("payable", payee=payee, amount=amt,
                             date=self.dated, instalments=False,
                             text=row[0] if row else "")

    def _extract_payment_file(self):
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            ni = 0
            ai = next((i for i, h in enumerate(hdr) if "amount" in h),
                      len(hdr) - 1)
            ci = next((i for i, h in enumerate(hdr) if "country" in h), None)
            for row in tbl[1:]:
                name = row[ni] if ni < len(row) else None
                amt = parse_money(row[ai]) if ai < len(row) else None
                country = row[ci] if ci is not None and ci < len(row) else None
                if name and amt:
                    self.add("payable", payee=name, amount=amt,
                             date=self.dated, country=country,
                             instalments=False, text="payment file row")

    def _extract_contract_schedule(self):
        supplier = self.field("supplier")
        if not supplier:
            m = re.search(r"with\s+(.+?)$", self.title)
            supplier = m.group(1).strip() if m else None
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            ai = next((i for i, h in enumerate(hdr) if "amount" in h),
                      len(hdr) - 1)
            di = next((i for i, h in enumerate(hdr) if "due" in h), None)
            for row in tbl[1:]:
                amt = parse_money(row[ai]) if ai < len(row) else None
                d = (parse_date_text(row[di])
                     if di is not None and di < len(row) else None)
                if amt:
                    self.add("payable", payee=supplier, amount=amt, date=d,
                             due_date=d, instalments=True,
                             text="contract stage")

    def _extract_contract(self):
        other = self.field("supplier", "client")
        if not other:
            m = re.search(r"with\s+(.+?)$", self.title)
            other = m.group(1).strip() if m else None
        amount = (self.money_field("fee", "amount", "value")
                  or (self.amounts[0] if self.amounts else None))
        self.add("payable", payee=other, amount=amount, date=self.dated,
                 instalments=False, any_amount=amount is None,
                 text=self.title)

    def _extract_purchase_order(self):
        company = self.field("company")
        amount = self.money_field("total order value", "total", "amount")
        self.add("payable", payee=company, amount=amount, date=self.dated,
                 instalments=False, text=self.title)

    def _extract_booking(self):
        # group trip collection: travellers paying the lead
        payee = None
        payto = self.field("payment", "pay to")
        if payto:
            m = re.search(r"to\s+(.+?)(?:,|\s+account)", payto)
            payee = m.group(1).strip() if m else None
        if not payee:
            m = re.search(r"from\s+(.+?)\s*$", self.title)
            payee = m.group(1).strip() if m else None
        per = None
        m = re.search(r"£\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*per person",
                      self.text)
        if m:
            per = float(m.group(1).replace(",", ""))
        total = None
        m = re.search(r"£\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*in total",
                      self.text)
        if m:
            total = float(m.group(1).replace(",", ""))
        if total is None:
            total = (self.money_field("total")
                     or (max(self.amounts) if self.amounts else None))
        travellers = []
        in_list = False
        for line in self.text.splitlines():
            if line.strip().lower().startswith("travellers"):
                in_list = True
                continue
            if in_list:
                m = re.match(r"\s*\d+\.\s+(.+?)\s*$", line)
                if m:
                    travellers.append(m.group(1))
                elif line.strip():
                    in_list = False
        self.add("collection", payee=payee, total=total, per_person=per,
                 travellers=travellers, date=self.dated, text=self.title)
        # also a payable (the lead pays the travel company)
        if payee and total:
            self.add("payable", payee=payee, amount=total, date=self.dated,
                     instalments=False, text=self.title)

    def _extract_cash_records(self):
        rows = []
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            amt_i = next((i for i, h in enumerate(hdr)
                          if any(k in h for k in ("topped up", "counted",
                                                  "deposited", "banked"))),
                         None)
            if amt_i is None:
                amt_i = next((i for i, h in enumerate(hdr)
                              if "amount" in h or "total" in h), None)
            if amt_i is None:
                amt_i = len(hdr) - 1
            date_i = next((i for i, h in enumerate(hdr)
                           if h in ("banked", "emptied", "date")), None)
            for row in tbl[1:]:
                amt = (parse_money(row[amt_i])
                       if amt_i < len(row) else None)
                d = None
                if date_i is not None and date_i < len(row):
                    d = parse_date_text(row[date_i])
                label = " ".join(row[:2])
                if amt:
                    rows.append({"label": label, "amount": amt, "date": d})
        self.add("cash_banking", rows=rows, text=self.title)

    def _extract_refund(self):
        payer = None
        m = re.search(r"from\s+(.+?)\s*$", self.title)
        if m:
            payer = m.group(1).strip()
        amount = (self.money_field("refund", "amount", "deposit", "total",
                                   "subscription")
                  or (max(self.amounts) if self.amounts else None))
        self.add("refund", payer=payer, amount=amount, date=self.dated,
                 text=self.title)
        acct = re.search(r"account ending\s+(\w+)", self.text)
        if acct:
            self.claims[-1]["account_hint"] = acct.group(1)
        if re.search(r"account\b[^.\n]*\bin your name|in your name|"
                     r"in the customer's name|your own account",
                     self.text, re.I):
            self.claims[-1]["own_name_attested"] = True

    def _extract_event(self):
        amount = (self.money_field("paid to client's", "settlement payment",
                                   "entitled share", "paid in full",
                                   "amount", "sale price", "total",
                                   "sum of")
                  or (max(self.amounts) if self.amounts else None))
        payer = None
        m = re.search(r"from\s+(.+?)\s*$", self.title)
        if m:
            payer = m.group(1).strip()
        seller = self.field("seller")
        buyer = self.field("buyer", "client")
        self.add("event", payer=payer, seller=seller, buyer=buyer,
                 amount=amount, date=self.dated, text=self.title)
        # a holding deposit / vehicle sale paid BY the customer is an out
        # explanation too
        if self.type in ("holding_deposit_receipt", "vehicle_sale_receipt"):
            self.add("payable", payee=payer or seller, amount=amount,
                     date=self.dated, instalments=False, text=self.title)

    def _extract_advert(self):
        amount = self.amounts[0] if self.amounts else None
        m = re.search(r"seller:\s*(.+?)\s*$", self.text, re.I | re.M)
        seller = m.group(1).strip() if m else None
        self.add("event", payer=None, seller=seller, amount=amount,
                 date=self.dated, text=self.title)

    def _extract_loan(self):
        borrower = self.field("borrower")
        lender = self.field("lender")
        principal = self.money_field("principal amount", "principal",
                                     "amount")
        self.add("loan", borrower=borrower, lender=lender,
                 amount=principal, date=self.dated, text=self.title)

    def _extract_gift(self):
        amount = (self.money_field("gift of", "amount", "sum")
                  or (max(self.amounts) if self.amounts else None))
        m = re.search(r"I,\s*(.+?),\s*born\s+(.+?)[,.]", self.text)
        giver = m.group(1).strip() if m else None
        giver_dob = m.group(2).strip() if m else None
        if not giver:
            m = re.search(r"from\s+(.+?)\s*$", self.title)
            giver = m.group(1).strip() if m else None
        rec = re.search(r"to\s+my\s+(?:\w+\s*,?\s*)?([A-Z][a-z]+\s+[A-Z][a-z]+)",
                        self.text)
        recipient = rec.group(1).strip() if rec else None
        self.add("gift", giver=giver, giver_dob=giver_dob, recipient=recipient,
                 amount=amount, date=self.dated, text=self.title)

    def _extract_factoring(self):
        amount = (self.money_field("advance", "total", "amount")
                  or (max(self.amounts) if self.amounts else None))
        party = None
        m = re.search(r"(?:with|from)\s+(.+?)\s*$", self.title)
        if m:
            party = m.group(1).strip()
        self.add("funding", payer=party, amount=amount, date=self.dated,
                 text=self.title)

    def _extract_group(self):
        companies = []
        owners = set()
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            ci = next((i for i, h in enumerate(hdr) if "compan" in h), 0)
            oi = next((i for i, h in enumerate(hdr) if "owner" in h), None)
            for row in tbl[1:]:
                if ci < len(row):
                    companies.append(row[ci])
                if oi is not None and oi < len(row):
                    owners.add(row[oi])
        self.add("group", companies=companies, owners=sorted(owners),
                 text=self.title)

    def _extract_register(self):
        company = None
        m = re.search(r"for\s+(.+?)(?::|$)", self.title)
        if m:
            company = m.group(1).strip()
        if not company:
            for k, v in self.fields.items():
                if k in ("company", "company name"):
                    company = v
                    break
        status = self.field("status")
        dissolved = None
        if status and "dissolved" in status.lower():
            dissolved = parse_date_text(status) or True
        officers = []
        pscs = []
        address = self.field("registered office")
        business = self.field("nature of business")
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            if any("officer" in h for h in hdr) or any("role" in h
                                                     for h in hdr):
                bi = next((i for i, h in enumerate(hdr) if "born" in h),
                          None)
                ri = next((i for i, h in enumerate(hdr)
                           if "resign" in h), None)
                for row in tbl[1:]:
                    born = (parse_month_year(row[bi])
                            if bi is not None and bi < len(row) else None)
                    res = (parse_date_text(row[ri])
                           if ri is not None and ri < len(row) else None)
                    officers.append({"name": row[0], "born": born,
                                     "resigned": res,
                                     "role": row[1] if len(row) > 1 else ""})
            elif any("significant control" in h or "person" in h
                     for h in hdr):
                bi = next((i for i, h in enumerate(hdr) if "born" in h),
                          None)
                for row in tbl[1:]:
                    born = (parse_month_year(row[bi])
                            if bi is not None and bi < len(row) else None)
                    pscs.append({"name": row[0], "born": born,
                                 "control": row[-1] if row else ""})
        self.add("register", company=company, officers=officers, pscs=pscs,
                 dissolved=dissolved, address=address, business=business,
                 text=self.title)

    def _extract_psc(self):
        company = None
        m = re.search(r"for\s+(.+?)\s*$", self.title)
        if m:
            company = m.group(1).strip()
        persons = []
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            bi = next((i for i, h in enumerate(hdr) if "born" in h), None)
            ci = next((i for i, h in enumerate(hdr) if "ceased" in h), None)
            ni = next((i for i, h in enumerate(hdr) if "notified" in h), None)
            for row in tbl[1:]:
                born = (parse_month_year(row[bi])
                        if bi is not None and bi < len(row) else None)
                ceased = (parse_date_text(row[ci])
                          if ci is not None and ci < len(row) else None)
                notified = (parse_date_text(row[ni])
                            if ni is not None and ni < len(row) else None)
                persons.append({"name": row[0], "born": born,
                                "ceased": ceased, "notified": notified,
                                "control": row[2] if len(row) > 2 else ""})
        self.add("psc", company=company, persons=persons, text=self.title)

    def _extract_statement(self):
        holder = self.field("account holder")
        bank = self.field("bank")
        account = self.field("account")
        transfers = []
        for line in self.text.splitlines():
            m = re.match(r"\s*(\d{1,2}\s+\w+\s+\d{4}):\s*(.+)", line)
            if m:
                amt = parse_money(m.group(2))
                if amt:
                    transfers.append({"date": parse_date_text(m.group(1)),
                                      "text": m.group(2), "amount": amt})
        self.add("own_account", holder=holder, bank=bank, account=account,
                 transfers=transfers, text=self.title)

    def _extract_reverification(self):
        notes = " ".join(self.text.split("\n")[4:]).strip()
        self.add("reverified", date=self.dated, note=notes, text=self.title)

    def _extract_device(self):
        rows = []
        for tbl in self.tables:
            hdr = [h.lower() for h in tbl[0]]
            if not any("device" in h for h in hdr):
                continue
            for row in tbl[1:]:
                dev = row[0]
                customers = [c.strip() for c in row[2].split(",")] \
                    if len(row) > 2 else []
                countries = [c.strip() for c in row[3].split(",")] \
                    if len(row) > 3 else []
                rows.append({"device": dev, "customers": customers,
                             "countries": countries})
        self.add("device", rows=rows, text=self.title)

    def _extract_fraud(self):
        m = re.search(r"Our customer\s+(.+?)\s+sent\s+£\s*([0-9,]+(?:\.\d+)?)"
                      r"\s+on\s+(.+?)\s+to your customer's account ending"
                      r"\s+(\w+)", self.text)
        if m:
            self.add("fraud_report", sender=m.group(1).strip(),
                     amount=parse_money(m.group(2)),
                     date=parse_date_text(m.group(3)),
                     account_hint=m.group(4),
                     ref=re.search(r'reference "([^"]+)"', self.text)
                     and re.search(r'reference "([^"]+)"',
                                   self.text).group(1),
                     text=self.title)

    def _extract_life_event(self):
        self.add("life_event", date=self.dated, text=self.title,
                 body=self.text)

    def _extract_statement_text(self):
        low = self.text.lower()
        body = "\n".join(self.text.split("\n")[4:])
        bl = body.lower()
        # incriminating statements
        if re.search(r"payments assistant|clients pay into my account|"
                     r"send it on|keep\s+\d+%|found the job through an "
                     r"advert|their clients pay", bl):
            self.suspicion.append(("ESC_MULE_ACTIVITY",
                                   "customer describes forwarding other "
                                   "people's money for pay"))
        if re.search(r"invest for (a few|other) people|invest for others|"
                     r"friends sent me money|money to invest for them|"
                     r"sending it on", bl):
            self.suspicion.append(("ESC_ACCOUNT_MISUSE",
                                   "customer uses the account for other "
                                   "people's money"))
        if re.search(r"breaking down|split.{0,80}(under|below)|below the "
                     r"£?10,?000|£?10,?000 threshold|exempt.{0,60}invoice|"
                     r"exempt.{0,60}report|different branch|tallied|"
                     r"aggregation|under £10,000|under the threshold",
                     bl):
            self.suspicion.append(("ESC_STRUCTURING",
                                   "customer raised keeping payments below "
                                   "the threshold"))
        if re.search(r"unwilling to (explain|provide|justify)|unable or "
                     r"unwilling|unable to (explain|provide|justify)|"
                     r"refused to explain|refusing to explain|"
                     r"would not (explain|say)|declined to explain|"
                     r"not willing to explain", bl):
            self.suspicion.append(("UNWILLING",
                                   "customer would not explain the activity"))
        # benign explanation hints (recorded for context / inconsistency)
        claims = set()
        if re.search(r"\bgift|from my (uncle|aunt|parents?|father|mother|"
                     r"family|relative)", bl):
            claims.add("gift")
        if re.search(r"sold my|sale of|sold the|sold a", bl):
            claims.add("sale")
        if re.search(r"\bloan\b|borrowed", bl):
            claims.add("loan")
        if re.search(r"salary|wages|employer|bonus|pay ?rise", bl):
            claims.add("employment")
        if re.search(r"refund|returned|gave back", bl):
            claims.add("refund")
        if re.search(r"business|takings|shop|customers", bl):
            claims.add("business")
        if re.search(r"inheritance|estate|savings", bl):
            claims.add("savings")
        if re.search(r"family support|support (my|the|a) family|to help",
                     bl):
            claims.add("family_support")
        if re.search(r"redundan|laid off|lost my job", bl):
            claims.add("redundancy")
        if claims:
            self.add("text_claims", claims=sorted(claims), text=self.title)
        # statements of fact about the customer (dormancy/returning)
        if re.search(r"working (abroad|in)|relocated|moved (to|abroad)|"
                     r"been (away|abroad)|back in the uk|returned", bl):
            self.flags.add("mentions_return_or_work_abroad")


# --------------------------------------------------------------------------
# Institution data
# --------------------------------------------------------------------------

def load_jsonl(path):
    rows = []
    with open(path, "rb") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


class Institution:
    def __init__(self, folder):
        self.folder = folder
        self.name = os.path.basename(os.path.normpath(folder))
        h = hashlib.sha256()
        self.cases = load_jsonl(self._f("cases.jsonl", h))
        self.alerts = {a["alert_id"]: a
                       for a in load_jsonl(self._f("alerts.jsonl", h))}
        self.customers = {c["customer_id"]: c
                          for c in load_jsonl(self._f("customers.jsonl", h))}
        self.transactions = {t["transaction_id"]: t
                             for t in load_jsonl(
                                 self._f("transactions.jsonl", h))}
        self.prev_reviews = {}
        for r in load_jsonl(self._f("previous_reviews.jsonl", h)):
            self.prev_reviews.setdefault(r["customer_id"], []).append(r)
        self.internal_list = {e["entry_id"]: e
                              for e in load_jsonl(
                                  self._f("internal_list.jsonl", h))}
        # evidence: metadata + parsed text
        self.evidence_meta = {}
        self.docs = {}  # customer_id -> [Doc]
        ev_dir = os.path.join(folder, "evidence")
        for meta in load_jsonl(self._f("evidence.jsonl", h)):
            self.evidence_meta[meta["doc_id"]] = meta
            path = os.path.join(folder, meta["file"])
            try:
                with open(path, encoding="utf-8") as f:
                    text = f.read()
                    h.update(text.encode("utf-8"))
            except OSError:
                text = ""
            doc = Doc(meta, text)
            self.docs.setdefault(meta["customer_id"], []).append(doc)
        for cid in self.docs:
            self.docs[cid].sort(key=lambda d: d.doc_id)
        self.input_hash = h.hexdigest()
        self.txn_by_customer = {}
        for t in self.transactions.values():
            self.txn_by_customer.setdefault(t["customer_id"], []).append(t)
        for cid in self.txn_by_customer:
            self.txn_by_customer[cid].sort(
                key=lambda t: (t["booked_at"], t["transaction_id"]))

    def _f(self, name, h):
        path = os.path.join(self.folder, name)
        with open(path, "rb") as f:
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    break
                h.update(chunk)
        return path


# --------------------------------------------------------------------------
# Decision engine
# --------------------------------------------------------------------------

ROUTINE_OUT_CHANNELS = {"card", "cash_withdrawal", "direct_debit",
                        "standing_order", "fund_subscription",
                        "fund_redemption"}
MINOR_TXN_GBP = 150.0


class Coverage:
    __slots__ = ("covered", "code", "doc_ids", "why", "kind", "strength")

    def __init__(self, covered=False, code=None, doc_ids=(), why="",
                 kind="", strength=1.0):
        self.covered = covered
        self.code = code
        self.doc_ids = list(doc_ids)
        self.why = why
        self.kind = kind
        self.strength = strength


class Gap:
    __slots__ = ("kind", "amount", "detail", "rfi_code", "esc_code", "alert")

    def __init__(self, kind, amount, detail, rfi_code, esc_code, alert=None):
        self.kind = kind
        self.amount = amount
        self.detail = detail
        self.rfi_code = rfi_code
        self.esc_code = esc_code
        self.alert = alert


def amt(x):
    return f"£{x:,.2f}"


def dstr(d):
    if isinstance(d, date):
        return d.strftime("%-d %B %Y")
    return str(d)


class CaseCtx:
    def __init__(self, inst, case, drop_docs=frozenset(), synth_docs=(),
                 list_override=None):
        self.inst = inst
        self.case = case
        self.cust = inst.customers[case["customer_id"]]
        docs = inst.docs.get(case["customer_id"], [])
        self.docs = [d for d in docs if d.doc_id not in drop_docs]
        self.docs += list(synth_docs)
        self.docs.sort(key=lambda d: d.doc_id)
        self.alerts = [inst.alerts[a] for a in case["alert_ids"]
                       if a in inst.alerts]
        self.alerts.sort(key=lambda a: a["alert_id"])
        self.txns = {t["transaction_id"]: t
                     for t in inst.txn_by_customer.get(
                         case["customer_id"], [])}
        self.alerted_ids = []
        for a in self.alerts:
            for t in a["transaction_ids"]:
                if t not in self.alerted_ids:
                    self.alerted_ids.append(t)
        hp = case.get("held_payment_id")
        self.held_txn = self.txns.get(hp) if hp else None
        if hp and hp not in self.alerted_ids:
            self.alerted_ids.append(hp)
        self.reviews = sorted(
            inst.prev_reviews.get(case["customer_id"], []),
            key=lambda r: r["review_id"])
        self.list_override = list_override or {}
        self.window = (case["review_window"]["from"],
                       case["review_window"]["to"])
        self.coverage = {}        # txn_id -> Coverage
        self.alert_cov = {}       # alert_id -> bool covered
        self.checks = []
        self.risk_context = []
        self.suspicion = []       # (code, detail, evidence_ids)
        self.gaps = []            # Gap
        self.tm22 = {}            # alert_id -> resolution dict
        self.used_review_ids = []
        self.own_transfer_gbp = 0.0

    # -- helpers -----------------------------------------------------

    def check(self, clause, question, result, evidence=()):
        self.checks.append({
            "step": len(self.checks) + 1,
            "policy_clause": clause,
            "question": question,
            "result": result,
            "evidence": list(evidence),
        })

    def txns_of_alert(self, alert):
        return [self.txns[t] for t in alert["transaction_ids"]
                if t in self.txns]

    def all_claims(self, kind=None):
        for d in self.docs:
            for c in d.claims:
                if kind is None or c["kind"] == kind:
                    yield d, c

    def declared_baseline(self):
        dec = self.cust.get("declared", {})
        if self.cust["kind"] == "business":
            turnover = dec.get("annual_turnover_gbp") or 0
            return turnover / 12.0
        return dec.get("monthly_income_gbp") or 0

    def cust_last(self):
        return person_surname(self.cust["name"])

    # -- suspicion scan ------------------------------------------------

    def scan_suspicion(self):
        txns = sorted(self.txns.values(),
                      key=lambda t: (t["booked_at"], t["transaction_id"]))
        for d in self.docs:
            for code, detail in d.suspicion:
                self.suspicion.append((code, detail, [d.doc_id]))
            for c in d.claims:
                if c["kind"] == "fraud_report":
                    for t in txns:
                        if t["direction"] != "in":
                            continue
                        if c.get("amount") is not None and \
                                abs(t["amount_gbp"] - c["amount"]) > 1.0:
                            continue
                        if c.get("date") and \
                                abs((date.fromisoformat(
                                    t["booked_at"][:10]) - c["date"])
                                    .days) > 5:
                            continue
                        if not same_person(c["sender"],
                                           t["counterparty_name"] or ""):
                            continue
                        self.suspicion.append((
                            "ESC_MULE_ACTIVITY",
                            f"{d.doc_id} reports {c['sender']} was scammed "
                            f"paying {amt(t['amount_gbp'])} to this "
                            f"account on {dstr(t['booked_at'][:10])}",
                            [d.doc_id, t["transaction_id"]]))
                        break
                if c["kind"] == "device":
                    for row in c["rows"]:
                        hr = [x for x in row["countries"]
                              if x.lower() in HIGH_RISK]
                        uniq = set(row["customers"])
                        if len(uniq) > 1:
                            self.risk_context.append(
                                f"device {row['device']} shared by "
                                f"{len(uniq)} customers")
                        if hr:
                            self.risk_context.append(
                                f"device {row['device']} login from "
                                f"{', '.join(hr)}")
        # contradictory customer explanations across separate documents
        claim_sets = []
        for d in self.docs:
            for c in d.claims:
                if c["kind"] == "text_claims":
                    claim_sets.append((d.doc_id, set(c["claims"])))
        union = set()
        for _, s in claim_sets:
            union |= s
        mutually_exclusive = (("gift" in union) + ("sale" in union) +
                              ("loan" in union) + ("savings" in union))
        if mutually_exclusive >= 2 and len(claim_sets) >= 2:
            self.suspicion.append((
                "CONTRADICTORY",
                "the customer gave different explanations for the same "
                "funds in different contacts",
                sorted({d for d, _ in claim_sets})))
        # dissolved counterparty paying in
        for t in txns:
            if t["direction"] != "in":
                continue
            cp = t["counterparty_name"]
            if not cp:
                continue
            for d, c in self.all_claims("register"):
                if c.get("dissolved") and c.get("company") and \
                        same_party(c["company"], cp):
                    dis = c["dissolved"]
                    txd = date.fromisoformat(t["booked_at"][:10])
                    if dis is True or (isinstance(dis, date) and
                                       txd > dis):
                        self.suspicion.append((
                            "ESC_UNEXPLAINED_FUNDS",
                            f"{d.doc_id} shows {c['company']} was "
                            f"dissolved before it paid "
                            f"{amt(t['amount_gbp'])}",
                            [d.doc_id, t["transaction_id"]]))

    # -- TM22 ----------------------------------------------------------

    def resolve_tm22(self, alert):
        aid = alert["alert_id"]
        if aid in self.list_override:
            return {"result": self.list_override[aid],
                    "detail": "counterfactual resolution",
                    "entry": alert["measured"].get("list_entry"),
                    "matched_on": alert["measured"].get("matched_on", ""),
                    "matched_party": alert["measured"].get(
                        "matched_party", ""),
                    "cp": "", "evidence": [alert["measured"].get(
                        "list_entry")]}
        m = alert["measured"]
        entry = self.inst.internal_list.get(m["list_entry"], {})
        entry_id = m["list_entry"]
        matched_on = m.get("matched_on", "")
        matched_party = m.get("matched_party", "")
        txns = self.txns_of_alert(alert)
        txn = txns[0] if txns else None
        cp_name = txn["counterparty_name"] if txn else matched_party
        txn_date = (date.fromisoformat(txn["booked_at"][:10])
                    if txn else None)
        res = {"result": "unsettled", "entry": entry_id,
               "matched_on": matched_on, "matched_party": matched_party,
               "cp": cp_name, "evidence": [entry_id]}
        entry_dob = entry.get("date_of_birth")
        entry_ym = entry_dob[:7] if entry_dob else None

        # Docs that can settle identity: docs naming the matched party with
        # a DoB (gift letters etc.), registers/PSCs for the counterparty.
        def dob_of_party_in_docs():
            """(doc_id, (y,m) or 'dob') found for matched party."""
            out = []
            for d in self.docs:
                for c in d.claims:
                    if c["kind"] == "gift" and c.get("giver") and \
                            c.get("giver_dob") and \
                            same_person(c["giver"], matched_party):
                        out.append((d.doc_id, parse_date_text(
                            c["giver_dob"]) or parse_month_year(
                                c["giver_dob"])))
            return out

        def company_intel():
            """register/psc facts about the counterparty company."""
            officers, pscs, regs = [], [], []
            for d, c in self.all_claims("register"):
                if c.get("company") and cp_name and \
                        same_party(c["company"], cp_name):
                    officers += [(d.doc_id, o) for o in c["officers"]]
                    pscs += [(d.doc_id, p) for p in c["pscs"]]
                    regs.append((d.doc_id, c))
            for d, c in self.all_claims("psc"):
                if c.get("company") and cp_name and \
                        same_party(c["company"], cp_name):
                    for p in c["persons"]:
                        pscs.append((d.doc_id, p))
            return officers, pscs, regs

        if matched_on.startswith("company officer"):
            officers, pscs, regs = company_intel()
            mp_first = matched_party.split(",")[0].strip()
            found_same = found_diff = False
            controls = False
            ceased_before = False
            for doc_id, o in officers:
                if not same_person(o["name"], mp_first):
                    continue
                if o.get("born") and entry_ym:
                    y, mo = o["born"]
                    if f"{y:04d}-{mo:02d}" == entry_ym:
                        found_same = True
                    else:
                        found_diff = True
                res["evidence"].append(doc_id)
                if o.get("resigned") is None or \
                        (txn_date and o["resigned"]
                         and txn_date <= o["resigned"]):
                    controls = True
                elif txn_date and o.get("resigned") and \
                        txn_date > o["resigned"]:
                    ceased_before = True
            for doc_id, p in pscs:
                if not same_person(p["name"], mp_first):
                    continue
                if p.get("born") and entry_ym:
                    y, mo = p["born"]
                    if f"{y:04d}-{mo:02d}" == entry_ym:
                        found_same = True
                    else:
                        found_diff = True
                res["evidence"].append(doc_id)
                if p.get("ceased") is None or \
                        (txn_date and p["ceased"]
                         and txn_date <= p["ceased"]):
                    controls = True
                elif txn_date and p.get("ceased") and \
                        txn_date > p["ceased"]:
                    ceased_before = True
            if found_diff:
                res["result"] = "different"
                res["detail"] = ("register/PSC records show the officer "
                                 "was born in a different month/year")
                return res
            if found_same and controls:
                res["result"] = "listed"
                res["detail"] = ("the listed party is a company officer/"
                                 "controller of the counterparty")
                return res
            if found_same and ceased_before and not controls:
                res["result"] = "different"
                res["detail"] = ("the matched officer ceased control "
                                 "before the payment")
                return res
            # alert itself asserts name+birth-month match; if we have
            # register docs confirming the officer exists but born not
            # recorded, treat as listed (the match has two details).
            if (officers or pscs) and any(
                    same_person(o["name"], mp_first)
                    for _, o in officers + pscs):
                res["result"] = "listed"
                res["detail"] = ("alert matched the officer on name and "
                                 "month/year of birth; registers confirm "
                                 "the officer")
                return res
            if officers or pscs:
                res["result"] = "unsettled"
                return res
            res["result"] = "unsettled"
            return res

        if matched_on.startswith("registered address"):
            officers, pscs, regs = company_intel()
            mp = matched_party.strip()
            # if the listed entry is a business with the same name -> same
            if entry.get("kind") == "business" and \
                    same_party(entry.get("name"), cp_name):
                res["result"] = "listed"
                res["detail"] = "counterparty is the listed company"
                return res
            listed_is_officer = False
            doc_names = []
            for doc_id, o in officers + pscs:
                doc_names.append(o["name"])
                if same_person(o["name"], entry.get("name", "")):
                    listed_is_officer = True
                res["evidence"].append(doc_id)
            if listed_is_officer:
                res["result"] = "listed"
                res["detail"] = ("the listed person is an officer/PSC of "
                                 "the counterparty company")
                return res
            if regs:
                res["result"] = "different"
                res["detail"] = ("the counterparty is a different company "
                                 "sharing the address; its officers are "
                                 "not the listed party")
                return res
            res["result"] = "unsettled"
            return res

        # name-only match
        cp_is_company = is_company(cp_name or "")
        if cp_is_company:
            officers, pscs, regs = company_intel()
            listed_is_officer = any(
                same_person(o["name"], entry.get("name", ""))
                for _, o in officers + pscs)
            for doc_id, _ in officers + pscs:
                res["evidence"].append(doc_id)
            if listed_is_officer:
                res["result"] = "listed"
                res["detail"] = ("the listed person is an officer/PSC of "
                                 "the counterparty company")
                return res
            if regs:
                res["result"] = "different"
                res["detail"] = ("register records show a different "
                                 "company/party than the list entry")
                return res
            res["result"] = "unsettled"
            return res
        # person counterparty: look for their DoB in docs
        for doc_id, dob in dob_of_party_in_docs():
            res["evidence"].append(doc_id)
            if isinstance(dob, date) and entry_dob:
                if dob.isoformat() == entry_dob:
                    res["result"] = "listed"
                    res["detail"] = ("the counterparty's date of birth "
                                     "matches the list entry")
                    return res
                res["result"] = "different"
                res["detail"] = ("the counterparty's date of birth "
                                 "differs from the list entry")
                return res
            if isinstance(dob, tuple) and entry_ym:
                y, mo = dob
                res["result"] = ("listed"
                                 if f"{y:04d}-{mo:02d}" == entry_ym
                                 else "different")
                res["detail"] = "compared month/year of birth"
                return res
        res["result"] = "unsettled"
        return res

    # -- per-transaction coverage ---------------------------------------

    def doc_for_counterparty(self, kind, cp_name):
        for d, c in self.all_claims(kind):
            party = (c.get("payee") or c.get("payer") or c.get("supplier")
                     or c.get("company"))
            if party and cp_name and same_party(party, cp_name):
                yield d, c

    def cover_txn(self, t):
        """Return Coverage for one transaction."""
        ch = t["channel"]
        cp = t["counterparty_name"]
        amt_g = t["amount_gbp"]
        txd = date.fromisoformat(t["booked_at"][:10])
        cust = self.cust

        if t["direction"] == "in":
            # cash deposits / top-ups
            if ch in ("cash_deposit", "cash_topup"):
                cov = self.match_cash(t)
                if cov:
                    return cov
                cov = self.match_event(t)
                if cov:
                    return cov
                cov = self.match_redeposit(t)
                if cov:
                    return cov
                return Coverage(False, why="unexplained cash in")
            # employer salary
            empl = cust.get("employer")
            ref = (t.get("reference") or "").lower()
            if empl and same_party(cp, empl):
                return Coverage(True, "WITHIN_PROFILE", (),
                                f"salary from employer {empl}", "salary")
            if "salary" in ref or "wages" in ref or "payroll" in ref:
                return Coverage(True, "WITHIN_PROFILE", (),
                                f"salary credit from {cp}", "salary")
            # own-name transfer in
            if cp and same_person(cp, cust["name"]):
                return self.own_account_cov(t, "in")
            # refund claims
            cov = self.match_refund(t)
            if cov:
                return cov
            # event claims (inheritance, insurance, sale, settlement)
            cov = self.match_event(t)
            if cov:
                return cov
            # gift / loan / third-party relationships
            cov = self.match_relationship(t)
            if cov:
                return cov
            # collection (group trip etc.)
            cov = self.match_collection(t)
            if cov:
                return cov
            # funding agreement (factoring etc.)
            cov = self.match_funding(t)
            if cov:
                return cov
            # invoices the client issued to the payer (receivables)
            cov = self.match_receivable(t)
            if cov:
                return cov
            # group company
            cov = self.match_group(t)
            if cov:
                return cov
            # earlier review covering same counterparty
            cov = self.match_prev_review(t)
            if cov:
                return cov
            # declared family support: same surname payer
            dec = (cust.get("declared", {}).get("source_of_funds") or "")
            if cp and self.cust_last() and \
                    person_surname(cp) == self.cust_last() and \
                    re.search(r"parent|family|support|relative", dec.lower()):
                return Coverage(True, "WITHIN_PROFILE", (),
                                f"{cp} shares the customer's surname; "
                                f"declared family support", "profile")
            return Coverage(False, why="unexplained credit")
        else:
            # routine small spend and cash access
            if ch in ROUTINE_OUT_CHANNELS:
                return Coverage(True, None, (), "routine outflow",
                                "routine", 0.4)
            if cp and same_person(cp, cust["name"]):
                return self.own_account_cov(t, "out")
            # payable docs (invoice/contract/payment file/receipt)
            cov = self.match_payable(t)
            if cov:
                return cov
            cov = self.match_group(t)
            if cov:
                return cov
            cov = self.match_prev_review(t)
            if cov:
                return cov
            # a business paying a counterparty it has paid several
            # times before, in a declared corridor, is within profile
            if cust["kind"] == "business" and cp and \
                    self.established_counterparty(t):
                return Coverage(True, "WITHIN_PROFILE", (),
                                f"{cp} is a long-standing counterparty",
                                "established", 0.6)
            if amt_g <= MINOR_TXN_GBP:
                return Coverage(True, None, (),
                                "small transfer within routine spend",
                                "minor", 0.3)
            return Coverage(False, why="unexplained payment")

    def own_account_cov(self, t, direction):
        cust = self.cust
        # docs proving the external account is the customer's
        for d, c in self.all_claims("own_account"):
            if c.get("holder") and same_person(c["holder"], cust["name"]):
                hint = c.get("account") or ""
                cp_acc = t.get("counterparty_account") or ""
                if hint and cp_acc:
                    hd = re.sub(r"\D", "", hint)
                    cd = re.sub(r"\D", "", cp_acc)
                    if hd and cd and (hd.endswith(cd[-4:])
                                      or cd.endswith(hd[-4:])):
                        return Coverage(
                            True, "OWN_ACCOUNT", (d.doc_id,),
                            f"{d.doc_id} shows {c['holder']} holds "
                            f"account {hint}", "own_account")
                bank = c.get("bank") or "another provider"
                return Coverage(True, "OWN_ACCOUNT", (d.doc_id,),
                                f"{d.doc_id} shows {c['holder']} holds an "
                                f"account at {bank}", "own_account")
        for d, c in self.all_claims("reverified"):
            return Coverage(True, "OWN_ACCOUNT", (d.doc_id,),
                            f"{d.doc_id} re-verified the customer; "
                            f"transfer is in their own name",
                            "own_account")
        # a refund or event document attesting the money moved to or
        # from an account "in your name" proves the account is the
        # customer's own for the transfer of that amount
        for kind in ("refund", "event"):
            for d, c in self.all_claims(kind):
                if not c.get("own_name_attested") or \
                        c.get("amount") is None:
                    continue
                if abs(t["amount_gbp"] - c["amount"]) <= max(
                        2.0, c["amount"] * 0.03):
                    return Coverage(
                        True, "OWN_ACCOUNT", (d.doc_id,),
                        f"{d.doc_id} confirms the other account is "
                        f"held in the customer's name", "own_account")
        # A same-name account elsewhere counts as the customer's own
        # account only when a document proves they hold it. For the
        # payments firm, inbound funding in the client's own name is the
        # declared funding channel, not an unexplained transfer.
        if self.inst.name == "payments_fx" and direction == "in":
            chans = " ".join(self.cust.get("declared", {})
                             .get("expected_channels") or [])
            if "own" in chans.lower():
                return Coverage(True, "WITHIN_PROFILE", (),
                                "funding from an account in the "
                                "client's own name (declared channel)",
                                "profile")
        # name match but no documentary proof
        baseline = self.declared_baseline()
        if baseline and t["amount_gbp"] <= baseline:
            return Coverage(True, "WITHIN_PROFILE", (),
                            "same-name transfer within declared income",
                            "profile")
        return Coverage(False, why="same-name transfer lacks a document "
                        "proving the other account is the customer's")

    def match_cash(self, t):
        txd = date.fromisoformat(t["booked_at"][:10])
        for d, c in self.all_claims("cash_banking"):
            for row in c["rows"]:
                if abs(row["amount"] - t["amount_gbp"]) <= max(
                        1.0, row["amount"] * 0.02):
                    if row["date"] is None or \
                            -2 <= (txd - row["date"]).days <= 4:
                        return Coverage(
                            True, "BUSINESS_RECORDS_RECONCILE",
                            (d.doc_id,),
                            f"{d.doc_id} records {amt(row['amount'])} "
                            f"({row['label']}) banked "
                            f"{dstr(row['date'])}", "cash_records")
        return None

    def match_redeposit(self, t):
        """Cash put back in after the customer's own earlier withdrawal
        of the same amount (often documented in contact notes)."""
        txd = date.fromisoformat(t["booked_at"][:10])
        for x in self.txns.values():
            if x["channel"] != "cash_withdrawal" or \
                    x["booked_at"] >= t["booked_at"]:
                continue
            if abs(x["amount_gbp"] - t["amount_gbp"]) <= max(
                    1.0, t["amount_gbp"] * 0.01):
                if (txd - date.fromisoformat(
                        x["booked_at"][:10])).days <= 365:
                    ev = [x["transaction_id"]]
                    why = (f"same {amt(t['amount_gbp'])} was withdrawn "
                           f"on {x['booked_at'][:10]}")
                    for d in self.docs:
                        if d.type in ("support_chat", "contact_note",
                                      "customer_letter",
                                      "customer_email"):
                            low = d.text.lower()
                            if re.search(r"(withdr|took out).{0,160}"
                                         r"(deposit|back)|same (cash|"
                                         r"money)|fell through|keeping "
                                         r"it at home", low):
                                ev.append(d.doc_id)
                                why += (f"; {d.doc_id} confirms it is "
                                        f"the same cash")
                                break
                    return Coverage(True, "WITHIN_PROFILE", tuple(ev),
                                    why, "redeposit")
        return None

    def match_refund(self, t):
        ref = (t.get("reference") or "").lower()
        for d, c in self.all_claims("refund"):
            if c.get("amount") is None:
                continue
            if abs(t["amount_gbp"] - c["amount"]) > max(
                    2.0, c["amount"] * 0.02):
                continue
            party_ok = (not c.get("payer") or not t["counterparty_name"]
                        or same_party(c["payer"], t["counterparty_name"]))
            if party_ok and (same_party(c.get("payer") or "",
                                        t["counterparty_name"] or "")
                             or "refund" in ref or "return" in ref
                             or "booking" in ref):
                return Coverage(True, "REFUND_OF_EARLIER_PAYMENT",
                                (d.doc_id,),
                                f"{d.doc_id} documents a "
                                f"{amt(c['amount'])} refund",
                                "refund")
        return None

    def match_event(self, t):
        for d, c in self.all_claims("event"):
            if c.get("amount") is None:
                continue
            if abs(t["amount_gbp"] - c["amount"]) > max(
                    2.0, c["amount"] * 0.03):
                continue
            party = c.get("payer") or c.get("seller")
            if party and t["counterparty_name"] and \
                    not same_party(party, t["counterparty_name"]) and \
                    not same_person(party, t["counterparty_name"]):
                continue
            # sale paid in cash explains a cash deposit
            if t["channel"] in ("cash_deposit", "cash_topup") or \
                    not party or not t["counterparty_name"] or \
                    same_party(party, t["counterparty_name"]) or \
                    same_person(party, t["counterparty_name"]):
                return Coverage(True, "DOCUMENTED_EVENT", (d.doc_id,),
                                f"{d.doc_id} documents "
                                f"{amt(c['amount'])}", "event")
        return None

    def match_relationship(self, t):
        for d, c in self.all_claims("gift"):
            if c.get("amount") is not None and \
                    abs(t["amount_gbp"] - c["amount"]) <= max(
                        2.0, c["amount"] * 0.02) and \
                    (not c.get("giver") or not t["counterparty_name"]
                     or same_person(c["giver"], t["counterparty_name"])):
                return Coverage(True, "THIRD_PARTY_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} gift letter "
                                f"from {c.get('giver')} for "
                                f"{amt(c['amount'])}", "gift")
        for d, c in self.all_claims("loan"):
            if c.get("amount") is not None and \
                    abs(t["amount_gbp"] - c["amount"]) <= max(
                        2.0, c["amount"] * 0.02) and \
                    (not c.get("lender") or not t["counterparty_name"]
                     or same_party(c["lender"], t["counterparty_name"])):
                return Coverage(True, "THIRD_PARTY_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} loan agreement "
                                f"with {c.get('lender')} for "
                                f"{amt(c['amount'])}", "loan")
        return None

    def match_collection(self, t):
        cp = t["counterparty_name"]
        if not cp:
            return None
        for d, c in self.all_claims("collection"):
            if not c.get("travellers"):
                continue
            if not any(same_person(cp, n) for n in c["travellers"]):
                continue
            per = c.get("per_person")
            if per and abs(t["amount_gbp"] - per) <= max(2.0, per * 0.05):
                return Coverage(True, "COLLECTION_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} lists {cp} "
                                f"among travellers at {amt(per)} each",
                                "collection")
            if per is None and c.get("total") and \
                    t["amount_gbp"] <= c["total"]:
                return Coverage(True, "COLLECTION_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} lists {cp} "
                                f"among travellers", "collection")
        return None

    def match_funding(self, t):
        for d, c in self.all_claims("funding"):
            party = c.get("payer")
            if party and t["counterparty_name"] and \
                    same_party(party, t["counterparty_name"]):
                return Coverage(True, "THIRD_PARTY_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} documents "
                                f"funding from {party}", "funding")
            if c.get("amount") is not None and \
                    abs(t["amount_gbp"] - c["amount"]) <= max(
                        2.0, c["amount"] * 0.02):
                return Coverage(True, "THIRD_PARTY_DOCUMENTED",
                                (d.doc_id,), f"{d.doc_id} documents "
                                f"{amt(c['amount'])} advanced",
                                "funding")
        return None

    def match_receivable(self, t):
        """Documents the client issued to a payer (e.g. freight or
        service invoices) explain money coming in from that party."""
        cp = t["counterparty_name"]
        if not cp:
            return None
        for d, c in self.all_claims("receivable"):
            if not c.get("payer") or not same_party(c["payer"], cp):
                continue
            if c.get("amount") is not None and \
                    abs(t["amount_gbp"] - c["amount"]) <= max(
                        2.0, c["amount"] * 0.03):
                return Coverage(True, "INVOICE_MATCHES", (d.doc_id,),
                                f"{d.doc_id} ({c.get('text')}) bills "
                                f"{amt(c['amount'])} to {cp}",
                                "receivable")
        return None

    def match_group(self, t):
        cp = t["counterparty_name"]
        if not cp:
            return None
        cust_name = self.cust["name"]
        for d, c in self.all_claims("group"):
            if any(same_party(cp, comp) for comp in c["companies"]):
                return Coverage(True, "GROUP_COMPANY", (d.doc_id,),
                                f"{d.doc_id} shows {cp} is in the same "
                                f"ownership group", "group")
        return None

    def match_prev_review(self, t):
        cp = t["counterparty_name"]
        if not cp:
            return None
        for r in self.reviews:
            note = (r.get("note") or "")
            if r.get("verdict") != "CLOSE":
                continue
            if cp and person_surname(cp) and \
                    person_surname(cp) in norm_name(note).split():
                self.used_review_ids.append(r["review_id"])
                return Coverage(True, "WITHIN_PROFILE",
                                (r["review_id"],),
                                f"earlier review {r['review_id']} "
                                f"closed the same counterparty",
                                "prev_review")
        return None

    def established_counterparty(self, t):
        """A counterparty the business has paid at least three times
        before this transaction, in a country it declared."""
        cp = t["counterparty_name"]
        country = t.get("country")
        declared = self.cust.get("declared", {}).get(
            "expected_countries") or []
        if country and declared and \
                not any(c.lower() in country.lower()
                        or country.lower() in c.lower()
                        for c in declared):
            return False
        prior = sum(
            1 for x in self.txns.values()
            if x["direction"] == "out"
            and x["booked_at"] < t["booked_at"]
            and x["counterparty_name"]
            and same_party(x["counterparty_name"], cp))
        return prior >= 3

    def match_payable(self, t):
        cp = t["counterparty_name"]
        txd = date.fromisoformat(t["booked_at"][:10])
        ref = (t.get("reference") or "").upper()
        best = None
        for d, c in self.all_claims("payable"):
            if c.get("payee") and cp and \
                    not same_party(c["payee"], cp):
                continue
            if not c.get("payee") and cp:
                # doc must name somebody
                if not surname_in_text(cp, d.text):
                    continue
            amount = c.get("amount")
            ok = False
            why = ""
            if amount is None:
                ok = bool(c.get("payee"))
                why = "contract on file"
            elif abs(t["amount_gbp"] - amount) <= max(2.0, amount * 0.03):
                ok = True
                why = "amount matches"
            elif c.get("instalments"):
                # staged payments summing to a total
                ok = t["amount_gbp"] < amount + 0.01
                why = "instalment under documented total"
            if ok and c.get("due_date"):
                dd = c["due_date"]
                if abs((txd - dd).days) <= 14:
                    ok = True
                else:
                    ok = False
            if ok:
                cov = Coverage(True, "INVOICE_MATCHES", (d.doc_id,),
                               f"{d.doc_id} ({c.get('text')}) covers "
                               f"{amt(t['amount_gbp'])} to "
                               f"{c.get('payee') or cp}", "payable")
                return cov
        return None

    # -- alert-level ----------------------------------------------------

    def run(self):
        self.scan_suspicion()

        # Resolve each TM22 first (independent of spend coverage)
        for a in self.alerts:
            if a["rule_id"] != "TM22":
                continue
            res = self.resolve_tm22(a)
            self.tm22[a["alert_id"]] = res
            ev = res["evidence"]
            if res["result"] == "listed":
                self.suspicion.append((
                    "ESC_LISTED_PARTY",
                    f"{res['detail']} (entry {res['entry']})",
                    ev))
                self.check("TM22: counterparty on an internal list",
                           f"Does evidence confirm the counterparty is "
                           f"the listed party? ({res['matched_on']})",
                           "FAIL", ev)
                self.alert_cov[a["alert_id"]] = True  # resolved (badly)
            elif res["result"] == "different":
                self.check("TM22: counterparty on an internal list",
                           "Does evidence show the counterparty is a "
                           "different party?",
                           "PASS", ev)
                self.alert_cov[a["alert_id"]] = True
                for t in self.txns_of_alert(a):
                    self.coverage[t["transaction_id"]] = Coverage(
                        True, "LIST_MATCH_DIFFERENT_PARTY", tuple(ev),
                        res["detail"], "list_different")
            else:
                self.check("TM22: counterparty on an internal list",
                           "Can evidence settle whether the counterparty "
                           "is the listed party?",
                           "UNKNOWN", ev)
                g_amount = sum(t["amount_gbp"]
                               for t in self.txns_of_alert(a))
                self.gaps.append(Gap(
                    "list_unsettled", g_amount,
                    f"the match on {res['matched_on']} is not settled "
                    f"either way", "RFI_COUNTERPARTY_DETAILS",
                    "ESC_LISTED_PARTY", a))
                self.alert_cov[a["alert_id"]] = False

        # per-transaction coverage
        for tid in self.alerted_ids:
            if tid in self.coverage or tid not in self.txns:
                continue
            self.coverage[tid] = self.cover_txn(self.txns[tid])
            cov = self.coverage[tid]
            if cov.covered and cov.kind == "own_account":
                self.own_transfer_gbp += self.txns[tid]["amount_gbp"]

        # alert-level coverage
        hardship = [d.doc_id for d in self.docs
                    if d.type in ("redundancy_letter",
                                  "employment_contract")]
        for a in self.alerts:
            aid = a["alert_id"]
            if aid in self.alert_cov:
                continue
            if a["rule_id"] == "TM10" and hardship:
                for t in self.txns_of_alert(a):
                    self.coverage[t["transaction_id"]] = Coverage(
                        True, "DOCUMENTED_EVENT", tuple(hardship),
                        f"{hardship[0]} documents the life event "
                        f"behind the early redemption", "hardship")
                self.alert_cov[aid] = True
                continue
            ts = self.txns_of_alert(a)
            uncovered = [t for t in ts
                         if not self.coverage.get(
                             t["transaction_id"], Coverage()).covered]
            un_amt = sum(t["amount_gbp"] for t in uncovered)
            total = sum(t["amount_gbp"] for t in ts) or 1.0
            material = (not uncovered) or \
                (un_amt <= max(100.0, total * 0.03)
                 and all(t["amount_gbp"] <= MINOR_TXN_GBP
                         for t in uncovered))
            self.alert_cov[aid] = material
            if not material:
                self.classify_gap(a, uncovered)

        # held payment rule (payments_fx)
        if self.inst.name == "payments_fx" and self.held_txn:
            self.held_payment_check()

        return self.decide()

    def classify_gap(self, alert, uncovered):
        rid = alert["rule_id"]
        un_amt = sum(t["amount_gbp"] for t in uncovered)
        ins = [t for t in uncovered if t["direction"] == "in"]
        outs = [t for t in uncovered if t["direction"] == "out"]
        cust_business = self.cust["kind"] == "business"

        if rid == "TM06":
            countries = alert["measured"].get("countries", "")
            self.gaps.append(Gap(
                "corridor", un_amt,
                f"unexplained payments to or from {countries}",
                "RFI_PURPOSE_DOCUMENTS", "ESC_HIGH_RISK_CORRIDOR", alert))
        elif rid == "TM03":
            cashy = all(t["channel"] in ("cash_deposit", "cash_topup")
                        for t in uncovered)
            if cashy and cust_business:
                self.gaps.append(Gap(
                    "biz_cash", un_amt,
                    "repeated below-threshold cash with no banking "
                    "records on file", "RFI_BUSINESS_RECORDS",
                    "ESC_STRUCTURING", alert))
            else:
                self.gaps.append(Gap(
                    "structuring", un_amt,
                    "repeated transactions just under the threshold, "
                    "unexplained", "RFI_PURPOSE_DOCUMENTS",
                    "ESC_STRUCTURING", alert))
        elif rid == "TM02":
            in_cov = all(self.coverage.get(t["transaction_id"],
                                           Coverage()).covered
                         for t in self.txns_of_alert(alert)
                         if t["direction"] == "in")
            if in_cov:
                self.gaps.append(Gap(
                    "out_purpose", un_amt,
                    "explained money in, but the onward payments are "
                    "unexplained", "RFI_PURPOSE_DOCUMENTS",
                    "ESC_UNEXPLAINED_FUNDS", alert))
            else:
                self.gaps.append(Gap(
                    "pass_through", un_amt,
                    "money arrives and leaves quickly with no "
                    "explanation", "RFI_PURPOSE_DOCUMENTS",
                    "ESC_UNEXPLAINED_FUNDS", alert))
        elif rid == "TM10":
            self.gaps.append(Gap(
                "early_redemption", un_amt,
                "fund units bought and sold back early with no "
                "explanation", "RFI_PURPOSE_DOCUMENTS",
                "ESC_EARLY_REDEMPTION", alert))
        elif rid == "TM08":
            self.gaps.append(Gap(
                "third_party", un_amt,
                "funding or payout involving an unrelated third party",
                "RFI_COUNTERPARTY_DETAILS", "ESC_THIRD_PARTY_FUNDING",
                alert))
        elif rid == "TM05":
            if cust_business:
                self.gaps.append(Gap(
                    "biz_cash", un_amt,
                    "large cash movement without records on file",
                    "RFI_BUSINESS_RECORDS", "ESC_UNEXPLAINED_FUNDS",
                    alert))
            else:
                self.gaps.append(Gap(
                    "cash_source", un_amt,
                    "large cash movement without an explanation",
                    "RFI_SOURCE_OF_FUNDS", "ESC_UNEXPLAINED_FUNDS",
                    alert))
        elif rid == "TM04":
            if cust_business:
                self.gaps.append(Gap(
                    "biz_counterparties", un_amt,
                    "many counterparties beyond what records support",
                    "RFI_BUSINESS_RECORDS", "ESC_UNEXPLAINED_FUNDS",
                    alert))
            else:
                self.gaps.append(Gap(
                    "many_parties", un_amt,
                    "many counterparties with no documented purpose",
                    "RFI_COUNTERPARTY_DETAILS", "ESC_MULE_ACTIVITY",
                    alert))
        elif rid == "TM01":
            if ins and not outs:
                if cust_business:
                    self.gaps.append(Gap(
                        "biz_income", un_amt,
                        "inflows above profile without records",
                        "RFI_BUSINESS_RECORDS", "ESC_UNEXPLAINED_FUNDS",
                        alert))
                else:
                    self.gaps.append(Gap(
                        "income_source", un_amt,
                        "income above the declared profile with no "
                        "explanation", "RFI_SOURCE_OF_FUNDS",
                        "ESC_UNEXPLAINED_FUNDS", alert))
            else:
                self.gaps.append(Gap(
                    "purpose", un_amt,
                    "activity above profile with no explanation",
                    "RFI_PURPOSE_DOCUMENTS", "ESC_UNEXPLAINED_FUNDS",
                    alert))
        elif rid == "TM07":
            self.gaps.append(Gap(
                "dormant", un_amt,
                "dormant account reactivated with unexplained money",
                "RFI_SOURCE_OF_FUNDS", "ESC_UNEXPLAINED_FUNDS", alert))
        else:
            self.gaps.append(Gap(
                "generic", un_amt, "unexplained activity",
                "RFI_PURPOSE_DOCUMENTS", "ESC_UNEXPLAINED_FUNDS", alert))

    def held_payment_check(self):
        t = self.held_txn
        if t["direction"] != "out" or t["amount_gbp"] < 10000:
            return
        cp = t["counterparty_name"]
        if cp and same_person(cp, self.cust["name"]):
            return  # transfer to own account: no invoice needed
        if self.coverage.get(t["transaction_id"],
                             Coverage()).covered:
            return  # invoice/contract already matched it
        # does a doc purport to cover but mismatch?
        mismatch = None
        for d, c in self.all_claims("payable"):
            if c.get("payee") and same_party(c["payee"], cp):
                if c.get("amount") is not None and \
                        abs(t["amount_gbp"] - c["amount"]) > max(
                            5.0, c["amount"] * 0.10):
                    mismatch = (d, c)
        if mismatch:
            self.suspicion.append((
                "ESC_INVOICE_MISMATCH",
                f"{mismatch[0].doc_id} names {cp} but for "
                f"{amt(mismatch[1]['amount'])}, not "
                f"{amt(t['amount_gbp'])}",
                [mismatch[0].doc_id, t["transaction_id"]]))
            return
        self.gaps.append(Gap(
            "held_invoice", t["amount_gbp"],
            f"held payment of {amt(t['amount_gbp'])} to {cp} has no "
            f"invoice or contract on file",
            "RFI_PURPOSE_DOCUMENTS", "ESC_UNEXPLAINED_FUNDS"))

    # -- verdict ---------------------------------------------------------

    def decide(self):
        # 1) doc-based suspicion + listed party
        if self.suspicion:
            code, detail, ev = self.pick_esc(self.suspicion)
            self.check("Verdicts", "Are there signs of crime or an "
                       "unresolved suspicion?", "FAIL", ev)
            reason = self.esc_reason(code, detail, ev)
            return self.finish("ESCALATE", code, reason, ev)

        # 2) all alerts covered?
        if all(self.alert_cov.get(a["alert_id"], False)
               for a in self.alerts):
            # own-account activity at >=5x declared needs an updated
            # profile first (POLICY: shared settings)
            own_amt = sum(
                self.txns[tid]["amount_gbp"]
                for tid, cov in self.coverage.items()
                if cov.covered and cov.kind == "own_account")
            total_amt = sum(self.txns[tid]["amount_gbp"]
                            for tid in self.coverage if tid in self.txns)
            base = self.declared_baseline() or 1.0
            multiple = 0.0
            for a in self.alerts:
                m = a["measured"]
                if "multiple" in m:
                    multiple = max(multiple, m["multiple"])
                elif a["rule_id"] == "TM07" and "moved_gbp" in m:
                    multiple = max(multiple, m["moved_gbp"] / base)
                elif a["rule_id"] == "TM02" and "received_gbp" in m:
                    multiple = max(multiple, m["received_gbp"] / base)
                elif a["rule_id"] == "TM05" and "amount_gbp" in m:
                    multiple = max(multiple, m["amount_gbp"] / base)
            if own_amt and own_amt >= total_amt * 0.5 \
                    and multiple >= 5.0:
                ev = sorted({d for cov in self.coverage.values()
                             for d in cov.doc_ids} |
                            {t for t in self.alerted_ids
                             if t in self.txns})
                self.check("Settings: own accounts at 5x or more",
                           "Own-account transfers explain activity of "
                           f"{multiple:.1f}x declared income/volume",
                           "FAIL", ev)
                return self.finish(
                    "RFI", "RFI_UPDATED_PROFILE",
                    f"Transfers between the customer's own accounts "
                    f"explain the activity, but at {multiple:.1f} times "
                    f"the declared income or volume. Ask for an updated "
                    f"expected income or volume before closing.",
                    ev)
            code, ev = self.pick_close()
            self.check("Verdicts",
                       "Does evidence explain every alerted "
                       "transaction?", "PASS", ev)
            reason = self.close_reason(code)
            return self.finish("CLOSE", code, reason, ev)

        # 3) gaps: choose RFI vs ESCALATE per gap morphology
        gap_escalate = self.choose_gap_verdict()
        if gap_escalate:
            code, detail, ev = gap_escalate
            self.check("Verdicts",
                       "Is the unexplained pattern itself suspicious?",
                       "FAIL", ev)
            return self.finish("ESCALATE", code,
                               self.esc_reason(code, detail, ev), ev)

        gap = self.dominant_gap()
        code = gap.rfi_code
        self.check("Verdicts",
                   "Would one document or answer settle the case?",
                   "PASS",
                   [a["alert_id"] for a in self.alerts])
        reason = self.rfi_reason(code, gap)
        ev = self.gap_evidence(gap)
        return self.finish("RFI", code, reason, ev)

    def pick_esc(self, suspicion):
        order = ["ESC_LISTED_PARTY", "ESC_MULE_ACTIVITY", "ESC_STRUCTURING",
                 "ESC_INVOICE_MISMATCH", "ESC_ACCOUNT_MISUSE",
                 "ESC_HIGH_RISK_CORRIDOR", "ESC_EARLY_REDEMPTION",
                 "ESC_THIRD_PARTY_FUNDING", "ESC_PASS_THROUGH",
                 "ESC_UNEXPLAINED_FUNDS", "UNWILLING", "CONTRADICTORY"]
        best = None
        for s in suspicion:
            code = s[0]
            if code in ("UNWILLING", "CONTRADICTORY"):
                continue
            i = order.index(code) if code in order else 99
            if best is None or i < order.index(best[0]):
                best = s
        if best is None:
            s = suspicion[0]
            rules = {a["rule_id"] for a in self.alerts}
            if "TM06" in rules:
                return ("ESC_HIGH_RISK_CORRIDOR", s[1], s[2])
            if "TM03" in rules:
                return ("ESC_STRUCTURING", s[1], s[2])
            if "TM10" in rules:
                return ("ESC_EARLY_REDEMPTION", s[1], s[2])
            return "ESC_UNEXPLAINED_FUNDS", s[1], s[2]
        return best

    def pick_close(self):
        # weight coverage codes by alerted amount covered
        score = {}
        ids = {}
        for tid, cov in self.coverage.items():
            if not cov.covered or not cov.code:
                continue
            score[cov.code] = score.get(cov.code, 0) + \
                self.txns[tid]["amount_gbp"]
            ids.setdefault(cov.code, set()).update(cov.doc_ids)
            ids[cov.code].add(tid)
        if any(r["result"] == "different" for r in self.tm22.values()):
            code = "LIST_MATCH_DIFFERENT_PARTY"
            ev = set()
            for r in self.tm22.values():
                ev.update(r["evidence"])
            for tid, cov in self.coverage.items():
                ev.update(cov.doc_ids)
                if cov.kind != "routine":
                    ev.add(tid)
            return code, sorted(ev)
        if not score:
            return "WITHIN_PROFILE", []
        pref = ["COLLECTION_DOCUMENTED", "BUSINESS_RECORDS_RECONCILE",
                "DOCUMENTED_EVENT", "INVOICE_MATCHES",
                "THIRD_PARTY_DOCUMENTED", "REFUND_OF_EARLIER_PAYMENT",
                "GROUP_COMPANY", "OWN_ACCOUNT", "RETURNING_CUSTOMER",
                "WITHIN_PROFILE"]
        code = max(score.items(),
                   key=lambda kv: (kv[1], -pref.index(kv[0])
                                   if kv[0] in pref else -99))[0]
        # dormant + reverification => RETURNING_CUSTOMER preferred
        rules = {a["rule_id"] for a in self.alerts}
        if "TM07" in rules and code == "OWN_ACCOUNT":
            if any(c["kind"] == "reverified"
                   for d in self.docs for c in d.claims):
                code = "RETURNING_CUSTOMER"
        ev = set(ids.get(code, ()))
        # also cite docs used for other coverage (context)
        for tid, cov in self.coverage.items():
            if cov.covered and cov.kind not in ("routine", "minor"):
                ev.add(tid)
        return code, sorted(ev)

    def choose_gap_verdict(self):
        """Decide whether an unexplained gap is itself suspicious."""
        rules_uncovered = {g.alert["rule_id"] for g in self.gaps
                           if g.alert}
        esc = None
        # corridor: unexplained higher-risk movement is suspicious
        for g in self.gaps:
            if g.kind == "corridor":
                return (g.esc_code, g.detail,
                        [t for t in self.alert_txn_ids(g)])
        # structuring pattern
        for g in self.gaps:
            if g.kind == "structuring":
                return (g.esc_code, g.detail,
                        [t for t in self.alert_txn_ids(g)])
        # early redemption unexplained
        for g in self.gaps:
            if g.kind == "early_redemption":
                return (g.esc_code, g.detail,
                        [t for t in self.alert_txn_ids(g)])
        # pass-through of third-party money
        for g in self.gaps:
            if g.kind == "pass_through":
                alert = g.alert
                ins = [t for t in self.txns_of_alert(alert)
                       if t["direction"] == "in"]
                third_party_in = [t for t in ins if t["counterparty_name"]
                                  and not same_person(
                                      t["counterparty_name"],
                                      self.cust["name"]) and
                                  not self.is_employer(
                                      t["counterparty_name"])]
                mule = len({t["counterparty_name"]
                            for t in third_party_in}) >= 3 and \
                    self.cust["kind"] == "individual"
                if mule:
                    return ("ESC_MULE_ACTIVITY",
                            "several unrelated people paid in and the "
                            "money left within 48 hours",
                            [t["transaction_id"]
                             for t in third_party_in])
                return ("ESC_PASS_THROUGH",
                        "unexplained money in was paid out within "
                        "48 hours",
                        [t["transaction_id"] for t in ins])
        # conduit: a business took third-party money in and disbursed
        # it to many unrelated individuals
        for g in self.gaps:
            if g.kind not in ("third_party", "biz_counterparties") or \
                    self.cust["kind"] != "business":
                continue
            tp_in = any(
                t["direction"] == "in"
                and t["counterparty_name"]
                and not same_person(t["counterparty_name"],
                                    self.cust["name"])
                and not self.is_employer(t["counterparty_name"])
                for t in self.txns_of_alert(g.alert))
            payees = {t["counterparty_name"]
                      for tid in self.alerted_ids
                      for t in [self.txns.get(tid)]
                      if t and t["direction"] == "out"
                      and t["counterparty_name"]
                      and not is_company(t["counterparty_name"])
                      and not same_person(t["counterparty_name"],
                                          self.cust["name"])}
            if tp_in and len(payees) >= 5:
                return ("ESC_THIRD_PARTY_FUNDING",
                        "third-party money in was disbursed to many "
                        "unrelated individuals",
                        sorted(payees))
        # many-party pattern for an individual
        for g in self.gaps:
            if g.kind == "many_parties" and \
                    self.cust["kind"] == "individual":
                alert = g.alert
                ins = [t for t in self.txns_of_alert(alert)
                       if t["direction"] == "in"]
                if len({t["counterparty_name"] for t in ins}) >= 4:
                    return ("ESC_MULE_ACTIVITY",
                            "many unrelated people paid the account",
                            [t["transaction_id"] for t in ins])
        return None

    def alert_txn_ids(self, gap):
        if gap.alert:
            return gap.alert["transaction_ids"]
        return []

    def is_employer(self, name):
        empl = self.cust.get("employer")
        return empl and same_party(name, empl)

    def dominant_gap(self):
        order = {"list_unsettled": 0, "held_invoice": 1, "biz_cash": 2,
                 "cash_source": 3, "income_source": 4, "biz_income": 5,
                 "biz_counterparties": 6, "many_parties": 7,
                 "third_party": 8, "dormant": 9, "purpose": 10,
                 "out_purpose": 11, "generic": 12}
        return max(self.gaps, key=lambda g: (
            g.amount, -order.get(g.kind, 50), g.detail))

    def gap_evidence(self, gap):
        ev = list(self.alert_txn_ids(gap))
        for tid, cov in self.coverage.items():
            ev.extend(cov.doc_ids)
        return sorted(set(ev))

    # -- reasons ---------------------------------------------------------

    def esc_reason(self, code, detail, ev):
        parts = [detail[0].upper() + detail[1:] + "."]
        cov_docs = sorted({d for cov in self.coverage.values()
                           for d in cov.doc_ids})
        extra = []
        for s in self.suspicion:
            if s[1] != detail and s[0] not in ("UNWILLING",
                                              "CONTRADICTORY"):
                extra.append(s[1][0].upper() + s[1][1:] + ".")
        for e in extra[:2]:
            if e not in parts[0]:
                parts.append(e)
        if not extra:
            g = self.gaps[0] if self.gaps else None
            if g:
                parts.append(g.detail[0].upper() + g.detail[1:] + ".")
        parts.append("Escalating to the MLRO.")
        return " ".join(parts)[:800]

    def close_reason(self, code):
        docs_used = {}
        for tid, cov in self.coverage.items():
            if cov.covered and cov.doc_ids and cov.kind not in (
                    "routine", "minor"):
                docs_used[cov.why] = cov.doc_ids
        bits = []
        if code == "LIST_MATCH_DIFFERENT_PARTY":
            for r in self.tm22.values():
                if r["result"] == "different":
                    bits.append(f"Internal-list match {r['entry']} is a "
                                f"different party: {r['detail']}.")
        whys = sorted(docs_used)[:3]
        for w in whys:
            bits.append(w[0].upper() + w[1:] + ".")
        if not bits:
            bits.append("The activity fits the customer's declared "
                        "profile.")
        return " ".join(bits)[:800]

    def rfi_reason(self, code, gap):
        asks = {
            "RFI_PURPOSE_DOCUMENTS":
                "Ask the customer for the invoice, contract or other "
                "documents showing what these payments were for",
            "RFI_BUSINESS_RECORDS":
                "Ask the customer for the business records (takings, "
                "collection reports, reconciliations) behind this "
                "activity",
            "RFI_SOURCE_OF_FUNDS":
                "Ask the customer for proof of where the money came "
                "from (e.g. a sale receipt or statement for the "
                "source account)",
            "RFI_COUNTERPARTY_DETAILS":
                "Ask the customer who the counterparty is and what the "
                "payment was for, including identifying details to "
                "resolve the list match",
            "RFI_UPDATED_PROFILE":
                "Ask the customer for an updated expected income or "
                "volume for the account",
        }
        ask = asks.get(code, "Ask the customer for documentation")
        return (f"{ask}: {gap.detail}. No suspicion on file, so this is "
                f"an RFI rather than an escalation.")[:800]

    # -- finish ----------------------------------------------------------

    def finish(self, verdict, code, reason, evidence):
        ev = []
        seen = set()
        valid = set(self.inst.evidence_meta) | set(self.txns) | \
            set(self.inst.internal_list) | \
            {r["review_id"] for r in self.reviews}
        for e in evidence:
            if e in valid and e not in seen:
                seen.add(e)
                ev.append(e)
        # make sure at least the alerted txns / docs are cited
        if not ev:
            ev = list(dict.fromkeys(
                [t for t in self.alerted_ids if t in self.txns]))[:10]
        return {
            "case_id": self.case["case_id"],
            "alert_ids": list(self.case["alert_ids"]),
            "verdict": verdict,
            "reason_code": code,
            "reason": reason,
            "evidence": ev,
            "_trace": self.build_trace(verdict, code, reason, ev),
        }

    def build_trace(self, verdict, code, reason, ev):
        cust = self.cust
        dec = cust.get("declared", {})
        coverage_rows = []
        for tid in self.alerted_ids:
            t = self.txns.get(tid)
            if not t:
                continue
            cov = self.coverage.get(tid)
            coverage_rows.append({
                "transaction_id": tid,
                "amount_gbp": t["amount_gbp"],
                "direction": t["direction"],
                "counterparty": t["counterparty_name"],
                "country": t["counterparty_country"],
                "booked_at": t["booked_at"],
                "covered_by": (cov.doc_ids[0]
                               if cov and cov.doc_ids else
                               (cov.kind if cov and cov.covered
                                and cov.kind in ("routine", "minor",
                                                 "salary", "profile",
                                                 "own_account")
                                else None)),
                "why": (cov.why if cov else "not assessed"),
            })
        alerts = [{"alert_id": a["alert_id"], "rule_id": a["rule_id"],
                   "rule_name": a["rule_name"], "message": a["message"],
                   "transaction_ids": a["transaction_ids"]}
                  for a in self.alerts]
        rc = sorted(set(self.risk_context))
        return {
            "case_id": self.case["case_id"],
            "institution": self.inst.name,
            "customer": {
                "id": cust["customer_id"],
                "name": cust["name"],
                "kind": cust["kind"],
                "occupation_or_activity": cust.get("occupation")
                    or cust.get("business_activity"),
                "declared_monthly_gbp":
                    self.declared_baseline() or None,
                "expected_countries": dec.get("expected_countries", []),
            },
            "verdict": verdict,
            "reason_code": code,
            "reason": reason,
            "evidence": ev,
            "alerts": alerts,
            "coverage": coverage_rows,
            "checks": self.checks,
            "flip": None,  # filled by caller
            "risk_context": rc,
            "engine_version": ENGINE_VERSION,
            "input_hash": self.inst.input_hash,
        }


# --------------------------------------------------------------------------
# Flip analysis
# --------------------------------------------------------------------------

def synth_invoice(ctx, txn):
    """Synthetic document covering an out-payment."""
    meta = {"doc_id": "SYNTH-INV", "type": "invoice",
            "title": "invoice", "dated": ctx.case["review_window"]["to"]}
    text = (f"**Pay to:** {txn['counterparty_name']}\n"
            f"**Amount due:** £{txn['amount_gbp']:,.2f}\n")
    d = Doc(meta, text)
    return d


def compute_flip(ctx, result):
    verdict = result["verdict"]
    alerted_out = [ctx.txns[t] for t in ctx.alerted_ids
                   if t in ctx.txns and
                   ctx.txns[t]["direction"] == "out"]
    if verdict == "CLOSE":
        deciding = sorted(
            {d for cov in ctx.coverage.values() for d in cov.doc_ids})
        for doc_id in deciding:
            c2 = CaseCtx(ctx.inst, ctx.case, drop_docs={doc_id})
            r2 = c2.run()
            if r2["verdict"] != "CLOSE":
                return {"change": f"document {doc_id} not on file",
                        "new_verdict": r2["verdict"]}
        return None
    if verdict == "RFI":
        # the missing document arrives
        biggest = None
        for tid in ctx.alerted_ids:
            cov = ctx.coverage.get(tid)
            t = ctx.txns.get(tid)
            if t and cov and not cov.covered:
                if biggest is None or \
                        t["amount_gbp"] > biggest["amount_gbp"]:
                    biggest = t
        if biggest is not None:
            d = synth_invoice(ctx, biggest)
            if biggest["direction"] == "in":
                meta = {"doc_id": "SYNTH-LET", "type": "solicitor_letter",
                        "title": "letter",
                        "dated": ctx.case["review_window"]["to"]}
                d = Doc(meta, f"**Entitled share:** "
                              f"£{biggest['amount_gbp']:,.2f}\n"
                              f"**Amount:** £{biggest['amount_gbp']:,.2f}\n")
            c2 = CaseCtx(ctx.inst, ctx.case, synth_docs=[d])
            r2 = c2.run()
            if r2["verdict"] != "RFI":
                return {"change": "the requested document on file",
                        "new_verdict": r2["verdict"]}
        for aid, res in ctx.tm22.items():
            if res["result"] == "unsettled":
                c2 = CaseCtx(ctx.inst, ctx.case,
                             list_override={aid: "different"})
                r2 = c2.run()
                if r2["verdict"] != "RFI":
                    return {"change": "evidence showing the counterparty "
                            "is a different party",
                            "new_verdict": r2["verdict"]}
        return None
    # ESCALATE
    susp_docs = sorted({e for s in ctx.suspicion for e in s[2]
                        if e in ctx.inst.evidence_meta})
    for doc_id in susp_docs:
        c2 = CaseCtx(ctx.inst, ctx.case, drop_docs={doc_id})
        r2 = c2.run()
        if r2["verdict"] != "ESCALATE":
            return {"change": f"document {doc_id} not on file",
                    "new_verdict": r2["verdict"]}
    for aid, res in ctx.tm22.items():
        if res["result"] == "listed":
            c2 = CaseCtx(ctx.inst, ctx.case,
                         list_override={aid: "different"})
            r2 = c2.run()
            if r2["verdict"] != "ESCALATE":
                return {"change": "evidence showing the counterparty is "
                        "a different party", "new_verdict": r2["verdict"]}
    # unexplained-driven escalation: documented explanation
    uncovered = [ctx.txns[t] for t in ctx.alerted_ids
                 if t in ctx.txns and
                 not ctx.coverage.get(t, Coverage()).covered]
    if uncovered:
        docs = []
        for t in uncovered:
            meta = {"doc_id": f"SYNTH-{t['transaction_id']}",
                    "type": "invoice" if t["direction"] == "out"
                    else "solicitor_letter",
                    "title": "document",
                    "dated": ctx.case["review_window"]["to"]}
            if t["direction"] == "out":
                d = Doc(meta, f"**Pay to:** {t['counterparty_name']}\n"
                              f"**Amount due:** £{t['amount_gbp']:,.2f}\n")
            else:
                d = Doc(meta, f"**Amount:** £{t['amount_gbp']:,.2f}\n")
            docs.append(d)
        c2 = CaseCtx(ctx.inst, ctx.case, synth_docs=docs)
        r2 = c2.run()
        if r2["verdict"] != "ESCALATE":
            return {"change": "documents on file explaining the "
                    "unexplained payments", "new_verdict": r2["verdict"]}
    return None


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    if len(sys.argv) != 3:
        sys.stderr.write("usage: run <institution folder> <output file>\n")
        sys.exit(2)
    folder, outfile = sys.argv[1], sys.argv[2]
    inst = Institution(folder)
    outdir = os.path.dirname(os.path.abspath(outfile))
    os.makedirs(outdir, exist_ok=True)
    traces_dir = os.path.join(outdir, "traces")
    os.makedirs(traces_dir, exist_ok=True)
    trace_path = os.path.join(traces_dir, inst.name + ".jsonl")

    with open(outfile, "w") as out, open(trace_path, "w") as tr:
        for case in inst.cases:
            ctx = CaseCtx(inst, case)
            res = ctx.run()
            flip = compute_flip(ctx, res)
            trace = res.pop("_trace")
            trace["flip"] = flip
            out.write(json.dumps(res, ensure_ascii=False) + "\n")
            tr.write(json.dumps(trace, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
