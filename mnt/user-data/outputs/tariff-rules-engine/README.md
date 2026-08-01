# Tariff Rules Engine (TRE)

A declarative, bitemporal, fully-traced duty allocation engine — plus a tool you
can actually open and use.

**`webapp/tariff-tool.html`** — double-click it. No server, no install, no
network. Enter HTS, origin, value and dates; get the full duty stack in CBP
reporting order with citations, the suppressed layers, the fees and the
diagnostics. Paste a CSV for batch. Add the codes the broker filed and it
produces audit findings with a dollar impact.

```bash
python tools/build_webapp.py     # recompiles the pack and rebuilds the tool
python tests/test_parity.py      # proves the browser engine == the Python engine
```

The browser engine is *compiled from* the Python rule pack, never hand-maintained
alongside it — and `tests/test_parity.py` runs 32 scenarios through both engines
and asserts identical duty, identical Chapter 99 sequences, identical
diagnostics. Two implementations of the same rules is the drift problem this
project exists to solve, so it is a merge gate, not a nicety.

Give it a set of HTS codes, countries of origin and entry facts. It returns the
correct tariff allocation — every Chapter 99 layer in CBP reporting order, the
value basis each rate was applied to, the dollar amount, and a citation back to
the CSMS or proclamation that says so.

Rules live in **tables, managed through an API**. A new CSMS becomes a `POST`
that Claude or Cursor can author, the validator can gate, and the engine can
hot-swap — no file edit, no deploy, no regression in the four downstream tools
that consume it. Reference data (HTSUS column-1 rates, Section 301 list
membership, Section 232 derivative annex, country groups, fee schedule) is
table-driven too, so the caller no longer has to know any of it.

See **[docs/TABLE_DRIVEN.md](docs/TABLE_DRIVEN.md)** for the schema, the
authoring workflow and the API surface.

```
$ python cli.py explain --hts 8708.29.5160 --coo CN --value 10000 \
                        --col1 2.5 --date 2026-07-17 --flag s301_list_3

  8708.29.5160   origin CN   entered value $10,000
  rate-determination date 2026-07-17  [latest_release (19 CFR 141.68)]
  rule pack 2026.07.25-1  sha256:1b4c9b5fa665feb02bd3faada3434e6a

  3.1  9903.88.03     Section 301 List 3 — China +25%          $2,500.00
  3.2  9903.03.06     Excluded from Section 122 (232 universe)     $0.00
  3.3  9903.94.05     Automobile parts — Section 232            $2,500.00
  6.0  (commodity)    Chapter 1-97 line                           $250.00

  --  9903.03.01  SUPPRESSED
      Suppressed by 9903.03.06. Would otherwise have assessed $1,000.00.

  TOTAL DUTY  $5,250.00   effective 52.5000%
```

---

## What makes this different from a duty calculator

Six things, each of which is a specific and expensive failure in the tools this
replaces.

**1. Rate-determination date, not entry date.** 19 CFR 141.68/141.69 is
implemented as a first-class resolver. An IT entry gets the IT date; a warehouse
withdrawal gets the withdrawal date. An entry summary filed on 28 July against
an IT accepted on 20 July is assessed under the pre-sunset rules — which is
correct, and which naive calculators get wrong every time a program changes.

**2. Threshold economies are never flat add-ons.** For EU, Japan, Korea,
Switzerland and Taiwan the additional duty is `max(0, cap − column‑1)`. A flat
`+10%` on a French line with a 4% column‑1 rate overcharges by 4 points on every
line. The validator refuses to publish a pack that encodes a threshold as a
flat rate.

**3. Suppression is modelled, not subtracted.** `9903.05.90` pulls the entire
Section 232 universe out of Section 301‑FL scope. It is encoded as an exemption
that wins by precedence, and the suppressed layer is retained in the output with
the amount it *would* have assessed — so an auditor can see the decision, not
just the answer.

**4. Bitemporal.** Rules carry both an effective window (when the law applies)
and a recorded window (when we learned it). Re-run a January entry at the
January knowledge pin and you reproduce the original filing exactly. Re-run it
at today's pin and the IEEPA vacatur suppresses the duty. The difference is the
CAPE refund claim, computed rather than eyeballed.

**5. Indeterminacy is an answer.** When the engine cannot determine Section 301
list membership because no annex flag was supplied, it says
`DATA_GAP_UNRESOLVED_RULE — risk is UNDERPAYMENT` rather than returning a
confident `$0`. "Does not apply" and "could not be determined" are different
statements and conflating them is how a 7.5% List 4A layer goes missing.

**6. Reproducible.** The engine never evaluates mutable rows. It evaluates an
immutable, content-hashed snapshot frozen at publication. Every answer is
stamped with the snapshot version, its hash and the reference epoch. Pin the
hash and you can replay any assessment months later, which is what you need when
CBP asks why a line was filed the way it was — and it is why the rule tables and
the evaluation snapshots are two separate layers rather than one.

---

## The tool

```bash
uvicorn api.app:app --port 8080     # then open http://localhost:8080
```

A web app for managing US tariff rules and calculating duty. Seven views:
**Calculator**, **Audit an entry**, **Rules**, **Upload**, **Snapshots**,
**Insights**, **Reference**. Role-aware — it reads `/v1/me` on load and shows only
what the caller has scope for, so the same build serves an internal analyst and an
external customer.

It holds no rule logic of its own. Three static files calling the API. See
[web/README.md](web/README.md).

---

## Keeping it current

Rules go stale. The engine ships with an MCP server so Claude can hold the rule
pack directly — surface expiring sunsets, research a new CSMS, draft the YAML,
validate it, model the duty impact, and publish behind a human sign-off.

```bash
python mcp_server/server.py                      # local: Claude Desktop / Code / Cursor
TRE_MCP_READONLY=1 python mcp_server/server.py   # inspection only
```

Nothing reaches the live pack except `publish_staged`, which requires a clean
validation, a **named human** reviewer, and the staged content hash — which the
caller can only know by having produced the diff. See [docs/MCP.md](docs/MCP.md).

---

## Quick start

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# migrate the YAML packs into tables and publish the first snapshot
python tools/seed_db.py --db tre.db --publish 2026.07.25-1

python cli.py --db tre.db validate           # ingestion checklist against the tables
python tests/test_engine.py                  # 64 engine assertions
python tests/test_store.py                   # 44 table-driven assertions
uvicorn api.app:app --port 8080              # HTTP API (bootstraps an empty DB)
```

Table-driven assessment needs no annex flags and no column-1 rate:

```bash
python cli.py --db tre.db explain --hts 8708.29.5160 --coo CN \
              --value 10000 --date 2026-07-17 --mode OCEAN
```

Library:

```python
from decimal import Decimal
from datetime import date
from tariffengine import TariffEngine, load_pack, EntryLine

engine = TariffEngine(load_pack("rulepacks/core"))

result = engine.assess_line(EntryLine(
    hts="6203.42.4010", coo="FR", entered_value=Decimal("10000"),
    col1_rate_pct=Decimal("4"),
    entry_date=date(2026, 7, 25), release_date=date(2026, 7, 25),
))
# Table-backed instead, with column-1 and annex membership resolved:
#   store    = RuleStore.sqlite("tre.db")
#   engine   = TariffEngine(store.materialize(),
#                           resolver=TableFactResolver(store))

result.total_duty          # Decimal('1000.00')
result.ch99_sequence()     # ['9903.05.39']
result.layers[0].reason    # "Column-1 rate 4% is below the 10% threshold;
                           #  combined column-1 + program duty tops up to 10%..."
```

---

## Repo layout

| Path | Purpose |
|---|---|
| `tariffengine/models.py` | Domain model — `Rule`, `EntryLine`, `DutyLayer`, `LineAssessment` |
| `tariffengine/engine.py` | Deterministic evaluator: snapshot → program → layer → sequence |
| `tariffengine/ratedate.py` | 19 CFR 141.68/141.69 rate-determination date resolver |
| `tariffengine/predicates.py` | Safe declarative matcher (no `eval`, fixed vocabulary) |
| `tariffengine/rates.py` | Value-basis resolution and rate math incl. combined-to-cap |
| `tariffengine/fees.py` | MPF/HMF/cotton — entry-level, floor and cap applied once |
| `tariffengine/rulepack.py` | Load, validate, hash, diff. Mechanizes the CSMS checklist |
| `tariffengine/postentry.py` | 7501 audit findings and bitemporal refund discovery |
| `tariffengine/store.py` | Table schema, CRUD, publish/activate, immutable snapshots, change log |
| `tariffengine/resolver.py` | Table-driven fact resolution — column-1 rates, program scope, country groups |
| `tariffengine/seeds.py` | Reference seed data (demonstrative; load the real tables via API) |
| `rulepacks/core/*.yaml` | The rules: 232, 301 China, 301‑FL, 122, IEEPA historical |
| `api/app.py` | FastAPI assessment service with tenanting and metering |
| `api/rules_api.py` | CRUD over the rule and reference tables; publish lifecycle |
| `api/state.py` | Hot-swappable engine state; atomic snapshot activation |
| `cli.py` | `validate` · `calc` · `explain` · `batch` · `refunds` · `diff` · `rules` |
| `webapp/tariff-tool.html` | **The tool.** Single file, offline, no dependencies |
| `webapp/src/engine.js` | Browser evaluator — exact BigInt decimal arithmetic |
| `tools/build_webapp.py` | Compiles pack + engine + UI into the single file |
| `tests/test_parity.py` | Cross-engine parity gate (Python vs browser) |
| `mcp_server/server.py` | MCP server — connects Claude to the rule pack for live maintenance |
| `tariffengine/governance.py` | Staged changes, publication gates, version snapshots, audit log |
| `tools/gen_301fl.py` | Generates the 301‑FL pack from the CSMS fact table |
| `tools/seed_db.py` | Migrate YAML packs into tables; seed reference data |
| `tests/test_engine.py` | Golden suite including all ten CSMS test cases |
| `tests/test_store.py` | Table-driven path: resolver, CRUD, publish, immutability |

Docs: [TABLE_DRIVEN](docs/TABLE_DRIVEN.md) ·
[ARCHITECTURE](docs/ARCHITECTURE.md) ·
[RULE_AUTHORING](docs/RULE_AUTHORING.md) ·
[INTEGRATION](docs/INTEGRATION.md) ·
[OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md) ·
[CSMS ingestion prompt](docs/CSMS_INGESTION_PROMPT.md)

---

## Current rule coverage

| Program | Rules | Window | Notes |
|---|---|---|---|
| `s232` | 10 | 2025‑03‑12 → open | Steel/aluminium/copper (metal-content split), autos, auto parts, MHDV, USMCA carve-out, exclusions |
| `s301` | 5 | 2018‑07‑06 → open | Lists 1/2/3/4A, annex-gated; exclusion |
| `s301fl` | 96 | 2026‑07‑24 → open | 60 economies, 5 threshold, 35 exemptions, in-transit grace |
| `s122` | 2 | 2026‑02‑24 → 2026‑07‑24 | Surcharge + 232 exclusion, hard sunset |
| `ieepa` | 6 | 2025‑02‑04 → 2026‑02‑24 | Historical, with the SCOTUS vacatur as a bitemporal record |
| fees | — | — | MPF (formal/informal, floor, cap), HMF, cotton |

119 rules, one warning, zero validation failures. 64 golden assertions and 32
parity scenarios green. 108 assertions passing across
both suites.

Reference tables seeded demonstratively — 11 HTS headings, partial Section 301
and 232 annexes. Load the real data via `POST /v1/reference/hts` and
`POST /v1/reference/scope`; run `POST /v1/reference/coverage:check` against a
parts-master extract to size the job.

---

## Not in scope

- HTS classification. The engine consumes an HTS, it does not assign one.
- Sourcing the USTR Section 301 annexes and the Section 232 derivative annexes.
  The engine now *resolves* membership from `program_scope`, but somebody still
  has to load those tables from the published annexes.
- AD/CVD case matching.
- ACE transmission. TRE produces the stack and the sequence; the filing system
  transmits it.
