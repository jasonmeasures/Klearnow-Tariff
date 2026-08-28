# Pack intake checklist

**Purpose:** Keep tariff **rules + data packs** complete and current. Completeness is a **source / pack / golden** problem — not an LLM-depth problem.

**When to use:** Any new or amended CSMS, Federal Register annex, proclamation, or broker dispute that touches Chapter 99 / HTS lists.

**Related:** [`program_watch.json`](../data/program_watch.json) · [`program_status.json`](../data/program_status.json) · [`OPEN_ITEMS.md`](./OPEN_ITEMS.md) · [`RULES.md`](./RULES.md)

---

## Gate: when a pack may exist

A pack is allowed **only** when authority names:

1. **Chapter 99 heading(s)** (and rates / basis), **and**
2. An **HTS list** (or explicit claim-gated rule with note text), **and**
3. An **effective date** (and sunset / suspension if any).

Investigations without a proclamation / FR annex / CSMS → `PENDING` in `program_watch`. Do **not** invent headings.

---

## Weekly scorecard (per LIVE program)

Run for every `program_watch` row with `status: LIVE` (or after any CSMS that might touch that family).

| # | Check | Pass if |
|---|--------|---------|
| 1 | **Authority freshness** | Pack `source_csms` / `source_csms_amended` / FR cite matches the **latest** CSMS or FR for that program |
| 2 | **HTS list fidelity** | Attachment stems re-diffed (or row-count + spot-check); hash / `as_of` updated |
| 3 | **Engine wired** | `engine_module` exists; `program_status` ACTIVE+compute agrees with watch |
| 4 | **Goldens** | ≥1 automated test per major path (auto / claim / Ch.98 / origin split / exclusion) |
| 5 | **RULES worked example** | `RULES.md` example matches the golden; EXPIRED programs stay dark |

**Fail any row → program is incomplete** for shipping duty math, even if the UI “looks right.”

Open broker disputes → add/update [`OPEN_ITEMS.md`](./OPEN_ITEMS.md) with owner + blocking flag.

---

## Intake workflow (new or amended authority)

Copy this block into the PR / ticket.

```
### Pack intake

Program id:           (e.g. SEC_232_METALS)
Authority:            CSMS #________ / FR ________ / Proc. ________
Effective (entry):    YYYY-MM-DD (timezone if given)
Supersedes:           CSMS #________ (or none)

HTS list source:      [ ] CSMS attachment  [ ] FR annex  [ ] other: ____
Pack file(s):         tariff-rules/data/________.json
Engine module:        tariff-rules/src/________.ts
Assess / coverage:    backend/src/assess.ts (+ coverage if list preview)

Diff summary:
  Adds:    ____ stems
  Removes: ____ stems
  Heading / rate changes: ____

Claim vs auto:
  Auto: ________
  Claim-gated: ________

Stacking notes (R1–R13): ________
Expired / do-not-compute: ________

Goldens added:
  - [ ] scenario 1 (HTS / COO / date → expected Ch.99 seq)
  - [ ] scenario 2
  - [ ] Ch.98 / exclusion path if relevant

Docs:
  - [ ] RULES.md worked example + changelog
  - [ ] program_watch + program_status source_csms / as_of
  - [ ] OPEN_ITEMS if still blocked

Broker dispute?  [ ] N  [ ] Y — ticket / name: ________
Scorecard 1–5:   [ ] [ ] [ ] [ ] [ ]
```

### Steps (in order)

1. **Capture authority** — save CSMS id, FR cite, effective date, attachment filename.
2. **Diff the list** — attachment HTS vs current pack JSON (stem-level). Prefer list diff over prose.
3. **Update pack** — JSON only; set `source_csms`, `source_csms_amended` if applicable, `as_of`, row_count.
4. **Wire or adjust engine** — auto vs claim; never invent off-list from UI fields alone (see metals / solar lesson).
5. **Add goldens** — real broker HTS when available; include “must not apply” cases for expired / off-list.
6. **Update RULES** — one worked example + changelog; mark EXPIRED programs explicitly.
7. **Update watch/status** — `program_watch` + `program_status`; CI must keep LIVE ↔ engine_module aligned.
8. **Sign-off** — compliance initials on RULES §14 when the program is reviewed.

---

## Broker dispute intake (highest-signal QA)

When a licensed broker or compliance reviewer disagrees with the tool:

| Field | Example |
|-------|---------|
| HTS / COO / rate date | `8541.43.0080` / CN / 2026-08-28 |
| Ch.98 / claims | `9802.00.50`, repair value |
| Tool produced | Ch.99 sequence + key diagnostics |
| Expected stack | Headings + rates + CSMS cite |
| Pack vs attachment? | Y/N — which stem missing / extra |
| Expired program wrongly live? | e.g. CSPV 201 |

Route to: golden test → pack fix or engine invent fix → RULES worked example → close OPEN item.

---

## LLM / agent use (optional)

**Do use** models to:

- Diff an attached CSMS HTS list against pack JSON (adds/removes).
- Draft goldens from a filled intake block + authority PDF/text.
- Explain assess output vs expected stack (pack gap vs invent bug).

**Do not** ask models:

- “Are we complete for Section 232?” without the attachment.
- To invent Chapter 99 headings or HTS membership from memory.

**Required prompt pattern:** attach **primary document + current pack**; require *heading + HTS stem + effective date*; if not in attachment → **OUT OF SCOPE**.

---

## Sources (weekly pull)

Same as `program_watch.sources`:

- White House presidential actions  
- Federal Register (HTS annex PDFs)  
- CBP CSMS (GovDelivery / `/v1/csms` in-app)  
- USTR enforcement dockets  

Target: **30–45 minutes/week** — scan new CSMS touching `9903.*`, run scorecard on affected LIVE programs.

---

## Anti-patterns (lessons learned)

| Anti-pattern | Instead |
|--------------|---------|
| Cite April CSMS while June list governs coverage | Keep `source_csms` + `source_csms_amended`; re-diff attachment |
| Invent `9903.82.09` from metal-content on off-list HTS | List membership (or explicit claim / filed heading) only |
| Reuse QSP 201 headings for CSPV solar | CSPV expired; QSP is quartz-only |
| Treat Ch.98 repair as suppressing 301 / FL | `9802.00.40`/`.50` keep remedies on repair value |
| Assume AD/CVD case numbers in the stacker | Flag only; separate case register (OPEN #9) |

---

## Definition of done

- [ ] Scorecard 1–5 pass for the program  
- [ ] Pack JSON + engine + ≥1 golden merged  
- [ ] RULES example + changelog  
- [ ] `program_watch` / `program_status` authority fields current  
- [ ] No silent invent of off-list or expired programs  
