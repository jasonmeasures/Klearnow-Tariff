/**
 * ACE entry-summary reporting sequence — CSMS #69668138 (updates #69606660).
 *
 * Ch.98 → Ch.99 trade remedies (301 → 338 → 232 → 201) → replacement/MTB → other quota → Ch.1–97.
 *
 * CSMS orders *sections* only. Order of two headings inside one section is not prescribed —
 * preserve input order (stable) within a section. Do not invent ascending / China-before-FL
 * tiebreaks.
 */
import { isBrazil301Heading } from "../../tariff-rules/src/s301Brazil.ts";
import { isS338Heading } from "../../tariff-rules/src/s338Canada.ts";
import { isChina301Note31Heading } from "../../tariff-rules/src/s301ChinaNote31.ts";

export const STACKING_CSMS = "69668138";

/** Reporting slots on Form 7501 / duty-stack UI (evaluation order may differ). */
export const REPORTING_SLOTS = {
  CH98: "1",
  S301: "3.1",
  S338: "3.2",
  /** Section 122 — historical only (sunset 2026-07-23). */
  S122: "3.25",
  S232: "3.3",
  S201: "3.4",
  REPLACEMENT: "4",
  OTHER_QUOTA: "5",
  COMMODITY: "6.0",
} as const;

const SLOT_RANK: Record<string, number> = {
  [REPORTING_SLOTS.CH98]: 1,
  [REPORTING_SLOTS.S301]: 2,
  [REPORTING_SLOTS.S338]: 3,
  [REPORTING_SLOTS.S122]: 4,
  [REPORTING_SLOTS.S232]: 5,
  [REPORTING_SLOTS.S201]: 6,
  [REPORTING_SLOTS.REPLACEMENT]: 7,
  [REPORTING_SLOTS.OTHER_QUOTA]: 8,
  [REPORTING_SLOTS.COMMODITY]: 9,
};

/** Trade-remedy section ranks for CSMS #69668138 (lower = earlier on the line). */
export const SECTION_RANK = {
  S301: 1,
  S338: 2,
  /** Historical surcharge — after 338, before 232 when both appear. */
  S122: 3,
  S232: 4,
  S201: 5,
  OTHER: 6,
} as const;

/**
 * Map a Chapter 99 code to its CSMS trade-remedy section.
 * 9903.05.90 is Section 301 (FL / Note 52 family), not Section 232.
 */
export function ch99SectionRank(code: string): number {
  const c = String(code || "").trim();
  if (!c) return SECTION_RANK.OTHER;

  if (
    c.startsWith("9903.88") ||
    c.startsWith("9903.91") ||
    c.startsWith("9903.92") ||
    isChina301Note31Heading(c) ||
    c.startsWith("9903.05") ||
    isBrazil301Heading(c)
  ) {
    return SECTION_RANK.S301;
  }
  if (isS338Heading(c)) return SECTION_RANK.S338;
  if (c === "9903.03.01" || c === "9903.03.03" || c === "9903.03.06") {
    return SECTION_RANK.S122;
  }
  if (
    c.startsWith("9903.82") ||
    c.startsWith("9903.04") ||
    c.startsWith("9903.94") ||
    c.startsWith("9903.74") ||
    c.startsWith("9903.76") ||
    c.startsWith("9903.79") ||
    c.startsWith("9903.08")
  ) {
    return SECTION_RANK.S232;
  }
  if (c.startsWith("9903.45")) return SECTION_RANK.S201;
  return SECTION_RANK.OTHER;
}

/**
 * Order Chapter 99 codes for filing / audit (CSMS #69668138).
 * Cross-section only; within a section the input relative order is preserved.
 */
export function orderCh99Sequence(seq: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of seq) {
    const c = String(raw || "").trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    unique.push(c);
  }
  return unique.sort((a, b) => ch99SectionRank(a) - ch99SectionRank(b));
}

export function buildFilingSequence(opts: {
  ch98?: string;
  ch99: string[];
  commodityHts: string;
}): string[] {
  const ch98 = String(opts.ch98 || "").trim();
  return [...(ch98 ? [ch98] : []), ...opts.ch99, opts.commodityHts];
}

type SortableLayer = { stack_slot: string; ch99: string | null };

/** Sort assessed layers for visual stack / ACE reporting order. */
export function sortLayersForDisplay<T extends SortableLayer>(
  layers: T[],
  ch99Order: string[],
): T[] {
  const ch99Index = (ch99: string | null): number => {
    if (!ch99) return 10_000;
    const i = ch99Order.indexOf(ch99);
    return i >= 0 ? i : 5_000;
  };
  const slotRank = (slot: string) => SLOT_RANK[slot] ?? 50;

  return [...layers].sort((a, b) => {
    const sr = slotRank(a.stack_slot) - slotRank(b.stack_slot);
    if (sr !== 0) return sr;
    if (!a.ch99 && b.ch99) return 1;
    if (a.ch99 && !b.ch99) return -1;
    return ch99Index(a.ch99) - ch99Index(b.ch99);
  });
}

export const STACKING_ORDER_NOTE =
  "CSMS #69668138: Ch.98 → Ch.99 additional duties (trade remedies 301 → 338 → 232 → 201) → replacement/MTB → other quota → Ch.1–97. Entered value reports on the Ch.1–97 line unless Chapter 98 provisions dictate otherwise. Within a section, heading order is not prescribed — preserve the assigned sequence.";

export const STACKING_SEQUENCE = [
  { slot: REPORTING_SLOTS.CH98, line: "Chapter 98 (if claimed)" },
  {
    slot: "3",
    line: "Chapter 99 additional duties — trade remedies: Section 301 → Section 338 → Section 232 → Section 201 duty → Section 201 quota",
  },
  { slot: REPORTING_SLOTS.S301, line: "Section 301 (China legacy / four-year review / Brazil country / 301-FL)" },
  { slot: REPORTING_SLOTS.S338, line: "Section 338 Canada (9903.03.12–.16)" },
  { slot: REPORTING_SLOTS.S232, line: "Section 232 (autos, metals, wood, MHDV, semiconductors, pharma, UAS)" },
  { slot: REPORTING_SLOTS.S201, line: "Section 201 duty / quota" },
  { slot: REPORTING_SLOTS.S122, line: "Section 122 (historical — inactive after 2026-07-23)" },
  { slot: REPORTING_SLOTS.REPLACEMENT, line: "Chapter 99 replacement duty / MTB / other use" },
  { slot: REPORTING_SLOTS.OTHER_QUOTA, line: "Chapter 99 other quota" },
  { slot: REPORTING_SLOTS.COMMODITY, line: "Chapters 1–97 commodity line" },
] as const;
