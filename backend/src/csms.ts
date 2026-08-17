/**
 * Recent CBP Cargo Systems Messaging Service (CSMS) bulletins.
 * Source: CBP GovDelivery RSS (same channel the CSMS page points at).
 * Full archive: https://www.cbp.gov/trade/automated/cargo-systems-messaging-service
 */
import { Router } from "express";
import { requireScope } from "./auth.ts";

export const CSMS_PAGE =
  "https://www.cbp.gov/trade/automated/cargo-systems-messaging-service";
export const CSMS_RSS =
  process.env.CSMS_RSS_URL || "https://public.govdelivery.com/accounts/USDHSCBP/feed.rss";
export const CSMS_SUBSCRIBE =
  "https://public.govdelivery.com/accounts/USDHSCBP/subscriber/new?topic_id=USDHSCBP_3";

export const csmsRouter = Router();

export type CsmsKind = "csms" | "cams" | "other";

export type CsmsMessage = {
  id: string;
  kind: CsmsKind;
  number: string | null;
  title: string;
  summary: string;
  published_at: string | null;
  url: string;
};

type Cache = { fetched_at: number; messages: CsmsMessage[]; source: string };

const CACHE_MS = Number(process.env.CSMS_CACHE_MS || 15 * 60 * 1000);
let cache: Cache | null = null;

const CSMS_RE = /\bCSMS\s*#\s*(\d+)\b/i;
const CAMS_RE = /\bCAMS\s*#\s*(\d+)\b/i;

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

export function stripHtml(s: string): string {
  return decodeXml(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const cdata = block.match(
    new RegExp(`<${name}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${name}>`, "i"),
  );
  if (cdata) return cdata[1].trim();
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return decodeXml(m?.[1] || "").trim();
}

export function classifyTitle(title: string): { kind: CsmsKind; number: string | null } {
  const csms = title.match(CSMS_RE);
  if (csms) return { kind: "csms", number: csms[1] };
  const cams = title.match(CAMS_RE);
  if (cams) return { kind: "cams", number: cams[1] };
  return { kind: "other", number: null };
}

export function parseGovDeliveryRss(xml: string): CsmsMessage[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  const out: CsmsMessage[] = [];
  const seen = new Set<string>();
  for (const m of items) {
    const block = m[1];
    const title = stripHtml(tag(block, "title"));
    const link = tag(block, "link").replace(/&amp;/g, "&");
    if (!title || !link) continue;
    const guid = stripHtml(tag(block, "guid")) || link;
    if (seen.has(guid)) continue;
    seen.add(guid);
    const { kind, number } = classifyTitle(title);
    const summary = stripHtml(tag(block, "description")).slice(0, 420);
    const pub = tag(block, "pubDate");
    let published_at: string | null = null;
    if (pub) {
      const d = new Date(pub);
      published_at = Number.isNaN(d.getTime()) ? pub : d.toISOString();
    }
    out.push({
      id: guid,
      kind,
      number,
      title,
      summary,
      published_at,
      url: link,
    });
  }
  return out;
}

export function filterCsmsMessages(
  messages: CsmsMessage[],
  opts: { q?: string; include_other?: boolean; include_cams?: boolean; limit?: number } = {},
): CsmsMessage[] {
  const q = String(opts.q || "").trim().toLowerCase();
  const includeCams = Boolean(opts.include_cams);
  const includeOther = Boolean(opts.include_other);
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 100);
  let rows = messages.filter((m) => {
    if (m.kind === "csms") return true;
    if (m.kind === "cams") return includeCams;
    return includeOther;
  });
  if (q) {
    rows = rows.filter((m) =>
      `${m.number || ""} ${m.title} ${m.summary}`.toLowerCase().includes(q),
    );
  }
  return rows.slice(0, limit);
}

async function loadFeed(force = false): Promise<Cache> {
  if (!force && cache && Date.now() - cache.fetched_at < CACHE_MS) return cache;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(CSMS_RSS, {
      signal: ctrl.signal,
      headers: {
        accept: "application/rss+xml, application/xml, text/xml, */*",
        "user-agent": "KlearNow-Tariff/1.0 (CSMS tab; +https://klearnow.com)",
      },
    });
    if (!r.ok) throw new Error(`GovDelivery RSS HTTP ${r.status}`);
    const xml = await r.text();
    const messages = parseGovDeliveryRss(xml);
    if (!messages.length) throw new Error("GovDelivery RSS returned no items");
    cache = { fetched_at: Date.now(), messages, source: CSMS_RSS };
    return cache;
  } catch (e) {
    if (cache) return cache;
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function listCsms(opts: {
  q?: string;
  include_other?: boolean;
  include_cams?: boolean;
  limit?: number;
  refresh?: boolean;
} = {}) {
  const feed = await loadFeed(Boolean(opts.refresh));
  const messages = filterCsmsMessages(feed.messages, opts);
  return {
    ok: true,
    official_url: CSMS_PAGE,
    subscribe_url: CSMS_SUBSCRIBE,
    source: feed.source,
    fetched_at: new Date(feed.fetched_at).toISOString(),
    cache_seconds: Math.round(CACHE_MS / 1000),
    count: messages.length,
    messages,
  };
}

csmsRouter.get("/csms", requireScope("calculate"), async (req, res) => {
  try {
    const q = String(req.query.q || "");
    const include_cams = String(req.query.include_cams || "") === "true";
    const include_other = String(req.query.include_other || "") === "true";
    const refresh = String(req.query.refresh || "") === "1" || String(req.query.refresh || "") === "true";
    const limit = Number(req.query.limit) || 50;
    res.json(await listCsms({ q, include_cams, include_other, refresh, limit }));
  } catch (e) {
    res.status(502).json({
      detail: e instanceof Error ? e.message : String(e),
      official_url: CSMS_PAGE,
      subscribe_url: CSMS_SUBSCRIBE,
    });
  }
});
