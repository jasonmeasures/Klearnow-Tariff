/**
 * Authoritative program windows + stacking contract for assessments / ES-003 audit.
 *
 * Calendar days are inclusive on both ends unless noted. Rate-determination date
 * (19 CFR 141.68 / 141.69) selects the window — Entry Date is the usual proxy.
 *
 * Do not drift these dates from tariff-rules/data/program_status.json.
 */

export {
  IEEPA_START,
  IEEPA_END,
  SEC_122_START,
  SEC_122_END,
  S301FL_START,
  SEC_122_CH99,
  filingEra,
  filingEraLabel,
  inIeepaWindow,
  sec122AppliesOn,
  s301flAppliesOn,
  wrongEraFiledCode,
} from "./programEras.ts";

/** Machine-readable stacking contract — asserted by rulesMatrix.test.ts */
export const STACKING_CONTRACT = {
  version: "1.4.0",
  as_of: "2026-08-24",
  eras: [
    {
      id: "ieepa",
      from: "2025-02-04",
      to: "2026-02-23",
      primary: "IEEPA (CAPE / refund only — not live forward)",
      ch99: "9903.01.xx",
    },
    {
      id: "sec_122",
      from: "2026-02-24",
      to: "2026-07-23",
      primary: "Section 122 10% surcharge",
      ch99: "9903.03.01",
    },
    {
      id: "s301fl",
      from: "2026-07-24",
      to: null,
      primary: "Section 301-FL (CSMS #69326983)",
      ch99: "9903.05.xx",
    },
  ],
  rules: [
    {
      id: "R2",
      text: "China 301 (legacy 9903.88.xx and four-year review 9903.91.xx / 9903.92.10) is NOT suppressed by 232 or Sec 122. Reports first; stacks with both when applicable. Note 31 replaces 9903.88.xx on the same HTS.",
    },
    {
      id: "R2b",
      text: "Section 122 does NOT stack with Section 232 autos/parts or 232 metals. Report 9903.03.06; suppress 9903.03.01.",
    },
    {
      id: "R1",
      text: "232 and 301-FL are mutually exclusive. 232 wins via 9903.05.90.",
    },
    {
      id: "R4a",
      text: "9903.82.02 — primary metal articles: +50% on metal-content value (needs content + melt/pour).",
    },
    {
      id: "R4b",
      text: "9903.82.09 — copper / derivative alu+steel (U.S. note 16): +25% on entered value. Claim-gated outside Ch.72–76 when filed.",
    },
    {
      id: "R4c",
      text: "Sec 122 is entry-level: 9903.03.01 filed on any ESL of an Entry Summary Number satisfies the entry.",
    },
    {
      id: "R11",
      text: "Section 338 Canada (9903.03.12–.14 @ 50%) reports as Chapter 99 additional before 301/232. USMCA does not exempt. 232-family headings gate 9903.03.15; civil aircraft GN6 gates 9903.03.16. Drawback eligible. Live from 12:01 a.m. EST 2026-08-22 (suspended 2026-08-19–21).",
    },
  ],
  boundary_days: {
    last_ieepa: "2026-02-23",
    first_sec_122: "2026-02-24",
    last_sec_122: "2026-07-23",
    first_s301fl: "2026-07-24",
  },
} as const;
