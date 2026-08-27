/**
 * Deterministic chat answers from the live HTS / rules tables.
 * No LLM key required for HTS lookup, coverage, or duty stacks.
 */
import { assessEntry } from "./assess.ts";
import { coverOne } from "./coverage.ts";
import { lookupHts } from "./htsLookup.ts";
import { lookupS301fl, s301flMeta } from "../../tariff-rules/src/s301fl.ts";
import { getCh99 } from "../../tariff-rules/src/tariffRules.ts";
import { listCsms } from "./csms.ts";

export type ChatIntent = {
  hts: string | null;
  ch99: string | null;
  coo: string | null;
  as_of: string | null;
  entered_value: number | null;
  usmca: boolean;
  cafta: boolean;
  wants_stack: boolean;
  wants_csms: boolean;
  s301fl_iso2: string | null;
  mode_of_transport: string | null;
};

const NAME_TO_ISO: Record<string, string> = {
  mexico: "MX",
  mexican: "MX",
  canada: "CA",
  canadian: "CA",
  china: "CN",
  chinese: "CN",
  vietnam: "VN",
  vietnamese: "VN",
  brazil: "BR",
  brazilian: "BR",
  japan: "JP",
  japanese: "JP",
  germany: "DE",
  german: "DE",
  india: "IN",
  indian: "IN",
  korea: "KR",
  "south korea": "KR",
  taiwan: "TW",
  uk: "GB",
  britain: "GB",
  "united kingdom": "GB",
  "united states": "US",
};

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveCooToken(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[.,;]+$/g, "");
  if (/^[a-z]{2}$/.test(t)) return t.toUpperCase();
  return NAME_TO_ISO[t] || null;
}

export function parseChatIntent(text: string): ChatIntent {
  const src = String(text || "");
  const htsDotted = src.match(/\b(\d{4}\.\d{2}\.\d{4})\b/);
  const htsDigits = src.match(/\b(\d{10})\b/);
  let hts: string | null = htsDotted?.[1] || htsDigits?.[1] || null;
  const ch99 = src.match(/\b(9903\.\d{2}\.\d{2})\b/)?.[1] || null;
  if (hts && hts.replace(/\D/g, "").startsWith("9903") && hts.replace(/\D/g, "").length <= 8) {
    hts = null;
  }

  let coo: string | null = null;
  const cooLabeled = src.match(
    /\b(?:coo|c\/o|origin|country(?:\s+of\s+origin)?)\s*[:\-–—]?\s*([A-Za-z]{2,}(?:\s+[A-Za-z]+)?)/i,
  );
  if (cooLabeled) coo = resolveCooToken(cooLabeled[1]);
  if (!coo) {
    for (const [name, iso] of Object.entries(NAME_TO_ISO)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(src)) {
        coo = iso;
        break;
      }
    }
  }

  const as_of = src.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] || null;

  let entered_value: number | null = null;
  const valueHit =
    src.match(/entered\s*value\s*[:\-–—]?\s*\$?\s*([\d,]+(?:\.\d+)?)/i) ||
    src.match(/\$\s*([\d,]+(?:\.\d+)?)/) ||
    src.match(/\b(?:value|ev)\s*[:\-–—]?\s*\$?\s*([\d,]+(?:\.\d+)?)/i);
  if (valueHit) {
    const n = Number(valueHit[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) entered_value = n;
  }

  const usmca = /\busmca\b|\bspi\s*s\+?\b/i.test(src);
  const cafta = /\bcafta(?:-?\s*dr)?\b/i.test(src);
  const wants_stack =
    Boolean(entered_value) ||
    /\b(stack|assess|duty\s*stack|landed|what(?:'s| is) the duty)\b/i.test(src);
  const wants_csms = /\bcsms\b/i.test(src) && !hts;
  const flIso =
    src.match(/\b301-?fl\b[^.]{0,40}\b(?:for|of)?\s*([A-Z]{2})\b/i)?.[1] ||
    src.match(/\b([A-Z]{2})\b[^.]{0,20}\b301-?fl\b/i)?.[1] ||
    null;

  let mode_of_transport: string | null = null;
  if (/\b(ocean|vessel|sea\s*freight|by\s*sea|mot\s*[:\-]?\s*1[012])\b/i.test(src)) {
    mode_of_transport = "OCEAN";
  } else if (/\b(air\s*freight|by\s*air|mot\s*[:\-]?\s*4[01])\b/i.test(src)) {
    mode_of_transport = "AIR";
  } else if (/\b(truck|by\s*road|mot\s*[:\-]?\s*3[012])\b/i.test(src)) {
    mode_of_transport = "TRUCK";
  } else if (/\b(rail|by\s*train|mot\s*[:\-]?\s*2[01])\b/i.test(src)) {
    mode_of_transport = "RAIL";
  }

  return {
    hts,
    ch99,
    coo,
    as_of,
    entered_value,
    usmca,
    cafta,
    wants_stack,
    wants_csms,
    s301fl_iso2: flIso && !["US", "FL"].includes(flIso) ? flIso : coo && /\b301-?fl\b/i.test(src) ? coo : null,
    mode_of_transport,
  };
}

function formatLayer(l: {
  program?: string;
  ch99?: string | null;
  label?: string;
  rate_label?: string;
  rate_pct?: number;
  duty_amount?: number;
  reason?: string;
}): string {
  const heading = l.ch99 ? ` ${l.ch99}` : "";
  const rate = l.rate_label || (l.rate_pct != null ? `${(l.rate_pct * 100).toFixed(2).replace(/\.?0+$/, "")}%` : "");
  const duty = typeof l.duty_amount === "number" ? ` → ${money(l.duty_amount)}` : "";
  return `• ${l.label || l.program || "layer"}${heading}${rate ? ` @ ${rate}` : ""}${duty}`;
}

export function formatAssessReply(result: ReturnType<typeof assessEntry>, intent: ChatIntent): string {
  const line = result.lines[0];
  if (!line) return "No line to assess.";
  const flags = [
    intent.hts,
    intent.coo,
    intent.mode_of_transport,
    intent.usmca ? "USMCA" : intent.cafta ? "CAFTA-DR" : null,
    intent.entered_value != null ? money(intent.entered_value) : null,
    line.rate_determination_date,
  ].filter(Boolean);
  const rows: string[] = [`Duty stack — ${flags.join(" · ")}`, ""];

  for (const l of line.layers || []) {
    rows.push(formatLayer(l));
  }
  const filing = line.filing_sequence?.length
    ? line.filing_sequence
    : line.ch99_sequence;
  if (filing?.length) {
    rows.push("", `Filing sequence: ${filing.join(" → ")}`);
  }
  if (line.col1_rate_label) {
    rows.push(`Column-1: ${line.col1_rate_label}${line.spi_preference ? ` (${line.spi_preference.label} SPI ${line.spi_preference.spi})` : ""}`);
  }
  rows.push(
    "",
    `Line duty: ${money(line.totals.duty)}${line.totals.effective_duty_rate_pct != null ? ` (${line.totals.effective_duty_rate_pct}%)` : ""}`,
    `MPF: ${line.mpf_exempt ? "exempt" : "applies (formal entry)"}`,
  );
  const hmf = result.entry_fees?.find((f: { code: string }) => f.code === "HMF");
  if (hmf) {
    rows.push(`HMF: ${hmf.amount ? money(hmf.amount) : "not due"} (${hmf.rate_note})`);
  } else {
    rows.push("HMF: skipped — add MOT (ocean) to include 0.125% Harbor Maintenance Fee.");
  }
  if (result.totals) {
    rows.push(`Entry duty: ${money(result.totals.duty)} · fees ${money(result.totals.fees)} · landed ${money(result.totals.landed_cost)}`);
  }
  const pharma = line.pharma_compare;
  if (pharma?.claimed && pharma.without_claim && pharma.with_claim) {
    const capBit =
      pharma.kind === "threshold_topup"
        ? `Pharma use skipped this ${pharma.eu_cap ? "EU" : "301-FL"} cap. Without it, this line would have been capped at ${pharma.cap_pct}% — that's Column-1 ${pharma.col1_pct}% plus an extra ${pharma.additional_pct}% (${money(pharma.additional_duty)}), not a second ${pharma.cap_pct}%.`
        : `Pharma use skipped ${pharma.instead_of}. Without it, 301-FL would have added ${pharma.additional_pct}% (${money(pharma.additional_duty)}).`;
    rows.push(
      "",
      capBit,
      `Difference: ${pharma.additional_pct}% / ${money(pharma.extra_without_exception)}. With Pharma use: ${pharma.with_claim.effective_duty_rate_pct}% (${money(pharma.with_claim.line_duty)}). Column-1 and MPF still apply.`,
    );
  } else {
    const cmp = line.fta_compare;
    if (cmp?.available && cmp.without_claim && cmp.with_claim) {
      rows.push(
        "",
        cmp.claimed
          ? `Without ${cmp.label} this line would be ${cmp.without_claim.effective_duty_rate_pct}% (${money(cmp.without_claim.line_duty)}). Duty saved ${money(cmp.duty_saved || 0)}.`
          : `${cmp.label} is available (${cmp.exemption_heading || "Note 52"}). With the claim: ${cmp.with_claim.effective_duty_rate_pct}% (${money(cmp.with_claim.line_duty)}).`,
      );
    }
  }
  const notes = (line.diagnostics || [])
    .filter((d: { severity?: string }) => d.severity === "ERROR" || d.severity === "WARNING")
    .map((d: { message?: string }) => d.message)
    .filter(Boolean);
  if (notes.length) {
    rows.push("", ...notes.map((m: string) => `⚠ ${m}`));
  }
  rows.push("", "From the live HTS + rules tables (no LLM).");
  return rows.join("\n");
}

export async function answerFromTables(text: string): Promise<{
  reply: string;
  tool_trace: Array<{ name: string; input: unknown; output: unknown }>;
} | null> {
  const intent = parseChatIntent(text);
  const tool_trace: Array<{ name: string; input: unknown; output: unknown }> = [];
  const asOf = intent.as_of || today();

  if (intent.hts && intent.wants_stack) {
    const line: Record<string, unknown> = {
      hts: intent.hts,
      coo: intent.coo || "",
      entered_value: intent.entered_value ?? 0,
      entry_date: asOf,
      flags: {
        fta_usmca: intent.usmca,
        fta_cafta_dr: intent.cafta,
      },
    };
    if (intent.usmca) line.fta_claim = "USMCA";
    if (intent.cafta) line.fta_claim = "CAFTA_DR";
    const input = { formal_entry: true, mode_of_transport: intent.mode_of_transport, lines: [line] };
    const output = assessEntry(input as never);
    tool_trace.push({ name: "assess_entry", input, output });
    return { reply: formatAssessReply(output, intent), tool_trace };
  }

  if (intent.hts) {
    const look = lookupHts(intent.hts, asOf);
    const row = coverOne(
      { hts: intent.hts, coo: intent.coo || undefined, as_of: asOf },
      { as_of: asOf, default_coo: intent.coo },
    );
    tool_trace.push({ name: "lookup_hts", input: { hts: intent.hts, as_of: asOf }, output: look });
    tool_trace.push({ name: "explain_hts", input: { hts: intent.hts, coo: intent.coo, as_of: asOf }, output: row });
    const rules = Array.isArray(row.rules) ? (row.rules as Array<{ label?: string; ch99?: string; rate?: string; reason?: string }>) : [];
    const seq = Array.isArray(row.ch99_sequence) ? (row.ch99_sequence as string[]) : [];
    const bits = [
      `${look.hts_display || intent.hts} on ${asOf}${intent.coo ? ` · origin ${intent.coo}` : ""}`,
      look.window_status === "active"
        ? `Column-1: ${look.hit?.col1_pct != null ? `${look.hit.col1_pct}%` : look.hit?.desc || "in table"} ${look.hit?.desc ? `— ${look.hit.desc}` : ""}`
        : `Window: ${look.window_status}${look.ended_on ? ` (ended ${look.ended_on})` : ""}`,
    ];
    if (look.replacement_hts_display) bits.push(`Replacement HTS: ${look.replacement_hts_display}`);
    if (seq.length) bits.push(`Ch.99 sequence: ${seq.join(" → ")}`);
    for (const r of rules.slice(0, 8)) {
      bits.push(`• ${r.label || ""}${r.ch99 ? ` ${r.ch99}` : ""}${r.rate ? ` @ ${r.rate}` : ""}`);
    }
    if (!intent.entered_value) {
      bits.push("", "Add entered value to run a dollar duty stack (no API key needed).");
    }
    bits.push("", "From the live HTS + rules tables (no LLM).");
    return { reply: bits.join("\n"), tool_trace };
  }

  if (intent.ch99) {
    const hit = getCh99(intent.ch99);
    if (!hit) return { reply: `Unknown Chapter 99 code ${intent.ch99} in the live pack.`, tool_trace };
    tool_trace.push({ name: "lookup_ch99", input: { code: intent.ch99 }, output: hit });
    return {
      reply: [
        `${hit.code} — ${hit.program} (${hit.kind})`,
        `Rate: ${hit.rate * 100}% · MFN: ${hit.mfn_interaction} · ${hit.status}`,
        hit.notes,
        "",
        "From the live Ch.99 table (no LLM).",
      ].join("\n"),
      tool_trace,
    };
  }

  if (intent.s301fl_iso2) {
    const hit = lookupS301fl(intent.s301fl_iso2);
    tool_trace.push({ name: "lookup_s301fl", input: { iso2: intent.s301fl_iso2 }, output: hit });
    if (!hit) {
      return {
        reply: `${intent.s301fl_iso2} is not a 301-FL economy in the live pack (${s301flMeta().economies} economies).`,
        tool_trace,
      };
    }
    const rate =
      hit.mechanic === "flat"
        ? `flat ${hit.rate_pct}% via ${hit.heading}`
        : `combined-to-cap ${hit.cap_pct}% via ${hit.combined_to_cap_heading}`;
    return {
      reply: `301-FL ${hit.name} (${hit.iso2}): ${rate}.\nFrom the live 301-FL pack (no LLM).`,
      tool_trace,
    };
  }

  if (intent.wants_csms) {
    try {
      const out = await listCsms({ q: "", limit: 8 });
      tool_trace.push({ name: "search_csms", input: {}, output: out });
      const lines = (out.messages || []).slice(0, 8).map((m) => `• CSMS #${m.number || "—"} — ${m.title}`);
      return {
        reply: [`Recent CSMS (GovDelivery):`, ...lines, "", `Archive: ${out.official_url}`].join("\n"),
        tool_trace,
      };
    } catch (e) {
      return {
        reply: `Could not pull CSMS (${e instanceof Error ? e.message : String(e)}). Open https://www.cbp.gov/trade/automated/cargo-systems-messaging-service`,
        tool_trace,
      };
    }
  }

  return null;
}

export const TABLES_HELP = `I can answer from the live HTS and rules tables without an API key.

Try:
• tariff stack for 3907.69.0050, COO MX, USMCA, entered value 47000
• which rules apply to 6109.10.0012 from VN on 2026-08-01
• 301-FL rate for VN
• what is 9903.05.94

Free-form drafting of a new pack rule still needs ANTHROPIC_API_KEY (admin preview).`;
