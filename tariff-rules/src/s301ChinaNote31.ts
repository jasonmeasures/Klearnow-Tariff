/**
 * Section 301 China four-year review — U.S. note 31 / 9903.91.xx + 9903.92.10.
 * Sources: 89 FR 76581; CSMS #62411889.
 *
 * Products of China only. Date windows are inclusive. When a note 31 heading
 * applies, it replaces (does not stack with) legacy 9903.88.xx for that line.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Note31Hit = {
  ch99: string;
  rate_pct: number;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  bucket: string;
  subdivision: string | null;
  exempt: boolean;
  source: string;
};

export type Note31Result = {
  hit: Note31Hit | null;
  skip_legacy: boolean;
  diagnostics: Array<{
    severity: "INFO" | "WARNING";
    code: string;
    message: string;
    remediation?: string;
  }>;
};

type Bucket = {
  id: string;
  subdivision?: string;
  ch99: string;
  rate_pct: number;
  start: string;
  end: string | null;
  label: string;
  hts8?: string[];
  hts10?: string[];
  note?: string;
  claim_flag?: string;
  auto?: boolean;
};

type Pack = {
  version: string;
  as_of: string;
  program: { id: string; source_csms: string; source_fr: string; detail: string };
  sources: string[];
  buckets: Bucket[];
  exclusions: Bucket[];
  claim_gated: Bucket[];
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s301_china_note31.json",
);

const FILED_TO_FLAG: Record<string, string> = {
  "9903.91.09": "s301_sts_exclusion",
  "9903.92.10": "s301_sts_crane",
  "9903.92.80": "s301_sts_other_crane",
};

let pack: Pack | null = null;

function load(): Pack {
  if (pack) return pack;
  if (!existsSync(DATA)) {
    pack = {
      version: "0",
      as_of: "",
      program: { id: "SEC_301_CHINA_FY", source_csms: "", source_fr: "", detail: "" },
      sources: [],
      buckets: [],
      exclusions: [],
      claim_gated: [],
    };
    return pack;
  }
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  return pack;
}

export function reloadS301ChinaNote31(): Pack {
  pack = null;
  return load();
}

export function s301ChinaNote31Meta() {
  const p = load();
  return {
    version: p.version,
    as_of: p.as_of,
    source_csms: p.program.source_csms,
    source_fr: p.program.source_fr,
    bucket_count: p.buckets.length,
    hts8_count: p.buckets.reduce((n, b) => n + (b.hts8?.length || 0), 0),
    sources: p.sources,
  };
}

function digits(hts: string): string {
  return String(hts || "").replace(/\D/g, "");
}

function inWindow(day: string, start: string, end: string | null | undefined): boolean {
  const d = String(day || "").slice(0, 10);
  if (!d || d < start) return false;
  if (end && d > end) return false;
  return true;
}

function key8(hts: string): string {
  const d = digits(hts);
  return d.length >= 8 ? d.slice(0, 8) : d;
}

function key10(hts: string): string {
  return digits(hts);
}

function matchesBucket(b: Bucket, hts: string): "hts10" | "hts8" | null {
  const d10 = key10(hts);
  const d8 = key8(hts);
  for (const h of b.hts10 || []) {
    if (digits(h) === d10) return "hts10";
  }
  for (const h of b.hts8 || []) {
    if (digits(h).slice(0, 8) === d8) return "hts8";
  }
  return null;
}

function toHit(b: Bucket, p: Pack, extra?: string): Note31Hit {
  const rate = b.rate_pct / 100;
  return {
    ch99: b.ch99,
    rate_pct: b.rate_pct,
    rate_pct_decimal: rate,
    label: b.label,
    reason:
      `${b.ch99} @ ${b.rate_pct}% additional — ${b.label}. ${p.program.source_csms} / ${p.program.source_fr}.` +
      (extra ? ` ${extra}` : "") +
      (b.note ? ` ${b.note}` : ""),
    bucket: b.id,
    subdivision: b.subdivision || null,
    exempt: b.rate_pct === 0,
    source: `${p.program.source_csms}; ${p.program.source_fr}`,
  };
}

function flagsWithFiled(
  flags: Record<string, boolean>,
  filed: string[],
): Record<string, boolean> {
  const next = { ...flags };
  for (const raw of filed) {
    const d = digits(raw);
    if (d.length !== 8) continue;
    const code = `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
    const flag = FILED_TO_FLAG[code];
    if (flag) next[flag] = true;
  }
  return next;
}

/**
 * Resolve U.S. note 31 / 9903.92.10 for a China-origin line.
 * Caller must gate on COO=CN.
 */
export function lookupChina301Note31(opts: {
  hts: string;
  date: string | null | undefined;
  flags?: Record<string, boolean>;
  filed_ch99?: string[];
}): Note31Result {
  const p = load();
  const day = String(opts.date || "").slice(0, 10);
  const diagnostics: Note31Result["diagnostics"] = [];
  const flags = flagsWithFiled(opts.flags || {}, opts.filed_ch99 || []);
  const hts = opts.hts;

  if (!day) return { hit: null, skip_legacy: false, diagnostics };

  for (const ex of p.exclusions) {
    if (!ex.auto) continue;
    if (!inWindow(day, ex.start, ex.end)) continue;
    if (matchesBucket(ex, hts)) {
      diagnostics.push({
        severity: "INFO",
        code: "S301_NOTE31_EXCLUSION",
        message: `${ex.ch99}: ${ex.label} (through ${ex.end}).`,
      });
      return { hit: toHit(ex, p), skip_legacy: true, diagnostics };
    }
  }

  const craneStem = key8(hts) === "84261900";
  if (craneStem && inWindow(day, "2024-09-27", null)) {
    const excl = p.exclusions.find((e) => e.ch99 === "9903.91.09")!;
    if (flags.s301_sts_exclusion && inWindow(day, excl.start, excl.end)) {
      diagnostics.push({
        severity: "INFO",
        code: "S301_NOTE31_STS_EXCLUSION",
        message:
          "9903.91.09 claimed — ship-to-shore crane contract exclusion (Annex D certification required in ACE DIS).",
      });
      return { hit: toHit(excl, p, "Claim-gated; Annex D certification."), skip_legacy: true, diagnostics };
    }
    if (flags.s301_sts_exclusion && !inWindow(day, excl.start, excl.end)) {
      diagnostics.push({
        severity: "WARNING",
        code: "S301_NOTE31_STS_EXCLUSION_EXPIRED",
        message: `9903.91.09 expired after ${excl.end}. File 9903.92.10 unless the article is not a ship-to-shore gantry crane.`,
        remediation: "Claim s301_sts_crane (9903.92.10) or s301_sts_other_crane (9903.92.80).",
      });
    }
    if (flags.s301_sts_crane) {
      const duty = p.claim_gated.find((e) => e.ch99 === "9903.92.10")!;
      return { hit: toHit(duty, p), skip_legacy: true, diagnostics };
    }
    if (flags.s301_sts_other_crane) {
      const other = p.claim_gated.find((e) => e.ch99 === "9903.92.80")!;
      return { hit: toHit(other, p), skip_legacy: true, diagnostics };
    }
    diagnostics.push({
      severity: "WARNING",
      code: "S301_NOTE31_STS_CLAIM_REQUIRED",
      message:
        "8426.19.00 from China: ship-to-shore gantry cranes report 9903.92.10 @ 25% (or 9903.91.09 with a pre-May 14 2024 contract through 2026-05-13). Other cranes under this subheading report 9903.92.80 (not covered).",
      remediation:
        "Set s301_sts_crane, s301_sts_exclusion, or s301_sts_other_crane (or file the matching Chapter 99 heading).",
    });
    return { hit: null, skip_legacy: true, diagnostics };
  }

  type Cand = { b: Bucket; spec: "hts10" | "hts8" };
  const cands: Cand[] = [];
  for (const b of p.buckets) {
    if (!inWindow(day, b.start, b.end)) continue;
    const spec = matchesBucket(b, hts);
    if (spec) cands.push({ b, spec });
  }
  if (!cands.length) return { hit: null, skip_legacy: false, diagnostics };

  cands.sort((a, b) => {
    const start = b.b.start.localeCompare(a.b.start);
    if (start) return start;
    if (a.spec === b.spec) return 0;
    return a.spec === "hts10" ? -1 : 1;
  });
  const best = cands[0].b;
  diagnostics.push({
    severity: "INFO",
    code: "S301_NOTE31_RESOLVED",
    message: `China 301 four-year review U.S. note 31(${best.subdivision || "?"}) → ${best.ch99} @ ${best.rate_pct}% (${best.label}).`,
  });
  return { hit: toHit(best, p), skip_legacy: true, diagnostics };
}

export function isChina301Note31Heading(code: string): boolean {
  const d = digits(code);
  return d.startsWith("990391") || d === "99039210" || d === "99039280";
}
