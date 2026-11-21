#!/usr/bin/env python3
"""Perturb an institution folder without changing case meaning.

Transformations, all pure functions applied consistently across every file:

1. rename every person/company name token        (names -> synthetic tokens)
2. shift every date by a fixed whole-month offset
3. rescale every GBP amount by a small factor (may legitimately cross a
   policy threshold for borderline values)
4. rotate digits inside ID-looking tokens        (BK-T912969143 -> BK-T467414698)
5. shuffle .jsonl line order                     (deterministic seed)

usage: perturb.py <institution folder> <output folder> [--dates-only]
"""
import json
import os
import random
import re
import sys
from datetime import date

# tokens that must stay literal for the evidence parser and the engine
KEYWORDS = set("""
january february march april may june july august september october
november december monday tuesday wednesday thursday friday saturday sunday
invoice invoices contract contracts payment payments payable paid pay pays
to from account accounts iban acct sort supplier suppliers carrier payee
seller buyer client clients borrower lender amount amounts due total price
fee fees value advance principal order company companies officer officers
born resigned resignations ceased notified notification control owner
owners holder bank statement statements register registers registered
office nature business status dissolved significant person persons device
devices country date dates emptied banked deposited counted topped up
order due exporter importer customer customers payer shipper bill billed
vendor refunds refund return returns booking bookings deposit deposits
subscription settlement entitled share sale sum gifts gift of travellers
per in each name names address identifiers id reason added on opened
reviewed file files type title dated transaction transactions alert
alerts case institution channel direction reference references currency
location kind occupation employer activity risk rating close rfi escalate
individual business low medium high salary wages payroll bonus employer
refund returned gave back takings shop inheritance estate savings support
family uncle aunt parents father mother relative relatives redundan
redundancy laid off lost my job working abroad relocated moved been away
back uk united kingdom gift loan borrowed sold sale of the a an and or
our sent your ending reference will would not now holding held payment
invoice contract schedule purchase confirmation reconciliation reports
book handling procedure ticket management accounts venue email letter
cancellation credit note insurer solicitor completion receipt vehicle
advert agreement factoring remittance advice group structure extract
control reverification record export sending fraud report support chat
contact staff customer life event employment doc doc_id review window
list entry measured matched party multiple dormant limit days received
distinct counterparties direction in out inflow outflow self income
monthly annual turnover gbp expected countries channels source funds
purpose cash top topup withdrawal faster swift wallet transfer bacs
direct debit standing fund subscription redemption afghanistan belarus
democratic republic congo haiti iran iraq lebanon libya mali myanmar
north korea russia somalia south sudan syria venezuela yemen poland
canada states america france germany spain italy ireland netherlands
belgium switzerland austria portugal sweden norway denmark finland
greece turkey india pakistan nigeria ghana kenya brazil mexico china
japan singapore australia zealand romania bulgaria hungary slovakia
lithuania latvia estonia cyprus malta iceland ukraine georgia armenia
dear sir madam hello thanks please find attached regards sincerely note
yes no ok mr mrs ms dr miss ltd limited llp plc inc co gmbh sarl fze
sal srl bv nv sa pty llc corp corporation lp pjsc holdings holding
international enterprises the of for at on by with as is are was were be
been being this that these those it its they them their he she his her
we us our you your i me my
""".split())

NAME_RE = re.compile(r"[A-Za-z][A-Za-z'&]*")
ISO_RE = re.compile(r"\b(\d{4})-(\d{2})(?:-(\d{2}))?(?!\d)")
DMY_RE = re.compile(
    r"\b(?:(\d{1,2})\s+)?(January|February|March|April|May|June|July|"
    r"August|September|October|November|December)\s+(\d{4})\b")
MONEY_RE = re.compile(r"£\s*([0-9][0-9,]*(?:\.\d{1,2})?)")
ID_RE = re.compile(r"\b[A-Z]{2,8}-[A-Z0-9-]*\d[A-Z0-9-]*\b")
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July",
     "August", "September", "October", "November", "December"], 1)}
MONTH_NAMES = [m.capitalize() for m in MONTHS]
MONTH_SHIFT = 5          # whole months, keeps month-precision matches
AMOUNT_FACTOR = 1.004    # +0.4%
DATE_SHIFT = MONTH_SHIFT


def add_months(y, m, d):
    mm = (m - 1 + DATE_SHIFT) % 12 + 1
    yy = y + (m - 1 + DATE_SHIFT) // 12
    dim = [31, 29 if (yy % 4 == 0 and (yy % 100 or yy % 400 == 0)) else 28,
           31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]
    return yy, mm, min(d, dim)


_SYL = ["Abern", "Balwh", "Corv", "Dunm", "Elmr", "Farn", "Glen", "Harb",
        "Inver", "Jasm", "Keld", "Luth", "Morv", "Norl", "Oakw", "Pemr",
        "Quil", "Ravn", "Sorl", "Thw", "Ulv", "Vexl", "Wyn", "Yarl",
        "Zelk", "Ash"]
_END = ["more", "wick", "gate", "stead", "ford", "mere", "combe", "dale",
        "ridge", "well", "holt", "shaw", "bury", "field", "croft",
        "worth", "bank", "hill", "wood", "ley", "ton", "ham", "port",
        "brook", "fall", "den"]


def _letters(i):
    """Synthetic name token with varied initials and endings."""
    return _SYL[i % len(_SYL)] + _END[(i // len(_SYL)) % len(_END)] + \
        ("x" * (i // (len(_SYL) * len(_END))))


class Perturber:
    def __init__(self):
        self.name_map = {}
        self._name_re = None

    def collect_names(self, folder):
        toks = set()
        for fn in ("customers.jsonl", "internal_list.jsonl",
                   "transactions.jsonl", "alerts.jsonl",
                   "previous_reviews.jsonl"):
            try:
                for l in open(os.path.join(folder, fn),
                              encoding="utf-8", errors="replace"):
                    l = l.strip()
                    if not l:
                        continue
                    try:
                        d = json.loads(l)
                    except ValueError:
                        continue
                    self._pull_names(d, toks)
            except OSError:
                continue
        # exclude anything the parser needs verbatim; keep each
        # replacement's first letter so initial-based matching
        # ("D & D Selmore" == "Dale Selmore") survives renaming
        self.lexicon = sorted(
            t for t in toks if len(t) >= 2 and t.lower() not in KEYWORDS)
        self.name_map = {t: t[0] + _letters(i)[1:]
                         for i, t in enumerate(self.lexicon)}
        self._name_re = re.compile(
            r"\b(" + "|".join(re.escape(t) for t in
                              sorted(self.lexicon, key=len,
                                     reverse=True)) + r")\b") \
            if self.lexicon else None

    def _pull_names(self, d, toks):
        name_keys = {"name", "employer", "counterparty_name",
                     "matched_party"}
        if isinstance(d, dict):
            for k, v in d.items():
                if k in name_keys and isinstance(v, str):
                    for t in NAME_RE.findall(v):
                        toks.add(t)
                elif isinstance(v, (dict, list)):
                    self._pull_names(v, toks)
        elif isinstance(d, list):
            for x in d:
                self._pull_names(x, toks)

    def text(self, s):
        if self._name_re:
            s = self._name_re.sub(lambda m: self.name_map[m.group(0)], s)
        def _iso(m):
            y, mo, d = add_months(int(m.group(1)), int(m.group(2)),
                                  int(m.group(3)) if m.group(3) else 1)
            return "%04d-%02d-%02d" % (y, mo, d) if m.group(3) \
                else "%04d-%02d" % (y, mo)
        s = ISO_RE.sub(_iso, s)

        def _dmy(m):
            y, mo, d = add_months(int(m.group(3)),
                                  MONTHS[m.group(2).lower()],
                                  int(m.group(1)) if m.group(1) else 1)
            if m.group(1):
                return f"{d} {MONTH_NAMES[mo - 1]} {y}"
            return f"{MONTH_NAMES[mo - 1]} {y}"
        s = DMY_RE.sub(_dmy, s)
        s = MONEY_RE.sub(
            lambda m: "£{:,.2f}".format(
                round(float(m.group(1).replace(",", ""))
                      * AMOUNT_FACTOR, 2)), s)
        s = ID_RE.sub(
            lambda m: "".join(
                str((int(c) + 5) % 10) if c.isdigit() else c
                for c in m.group(0)), s)
        return s

    def value(self, v, key=""):
        if isinstance(v, str):
            return self.text(v)
        if isinstance(v, bool) or v is None:
            return v
        if isinstance(v, (int, float)):
            if key == "amount_gbp" or key == "amount" or \
                    (key.endswith("_gbp") and key != "limit_gbp"):
                return round(v * AMOUNT_FACTOR, 2)
            return v
        if isinstance(v, list):
            return [self.value(x, key) for x in v]
        if isinstance(v, dict):
            return {k: self.value(x, k) for k, x in v.items()}
        return v


JSONL = ("cases.jsonl", "alerts.jsonl", "customers.jsonl",
         "transactions.jsonl", "evidence.jsonl",
         "previous_reviews.jsonl", "internal_list.jsonl")


def perturb_folder(src, dst):
    p = Perturber()
    p.collect_names(src)
    os.makedirs(dst, exist_ok=True)
    rng = random.Random(99)
    for fn in list(JSONL) + ["POLICY.md"]:
        spath = os.path.join(src, fn)
        if not os.path.exists(spath):
            continue
        out_lines = []
        if fn == "POLICY.md":
            # keep the SOP verbatim: profile detection must still work
            with open(spath, "rb") as f:
                data = f.read()
            with open(os.path.join(dst, fn), "wb") as f:
                f.write(data)
            continue
        with open(spath, "rb") as f:
            for raw in f:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                out_lines.append(json.dumps(
                    p.value(d), ensure_ascii=False))
        rng.shuffle(out_lines)
        with open(os.path.join(dst, fn), "w", encoding="utf-8",
                  newline="\n") as f:
            f.write("\n".join(out_lines) + ("\n" if out_lines else ""))
    ev_in = os.path.join(src, "evidence")
    ev_out = os.path.join(dst, "evidence")
    if os.path.isdir(ev_in):
        os.makedirs(ev_out, exist_ok=True)
        for name in sorted(os.listdir(ev_in)):
            with open(os.path.join(ev_in, name), "rb") as f:
                txt = f.read().decode("utf-8", "replace")
            new = p.text(txt)
            newname = p.text(name)
            with open(os.path.join(ev_out, newname), "w",
                      encoding="utf-8", newline="\n") as f:
                f.write(new)
    return p


def main():
    src, dst = sys.argv[1], sys.argv[2]
    p = perturb_folder(src, dst)
    sys.stderr.write(f"perturbed {src} -> {dst} "
                     f"({len(p.name_map)} name tokens)\n")


if __name__ == "__main__":
    main()
