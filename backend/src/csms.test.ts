import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTitle,
  filterCsmsMessages,
  parseGovDeliveryRss,
  stripHtml,
} from "./csms.ts";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CBP Recent Updates</title>
    <item>
      <title>CSMS # 69326983 - Guidance: Section 301 Forced Labor</title>
      <link>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/aaa</link>
      <guid>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/aaa</guid>
      <pubDate>Thu, 23 Jul 2026 12:00:00 -0500</pubDate>
      <description><![CDATA[<p>301-FL effective 24 July 2026.</p>]]></description>
    </item>
    <item>
      <title>CAMS # 69523442 - Information: Quota Bulletin 26-502</title>
      <link>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/bbb</link>
      <guid>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/bbb</guid>
      <pubDate>Thu, 13 Aug 2026 14:22:47 -0500</pubDate>
      <description>Quota bulletin duplicate for air cargo.</description>
    </item>
    <item>
      <title>U.S. Customs and Border Protection Media Releases Update</title>
      <link>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/ccc</link>
      <guid>https://content.govdelivery.com/accounts/USDHSCBP/bulletins/ccc</guid>
      <description>Not a CSMS.</description>
    </item>
  </channel>
</rss>`;

describe("CSMS RSS parse", () => {
  it("classifies CSMS vs CAMS vs other", () => {
    assert.deepEqual(classifyTitle("CSMS # 69326983 - Guidance"), {
      kind: "csms",
      number: "69326983",
    });
    assert.deepEqual(classifyTitle("CAMS # 69523442 - Information"), {
      kind: "cams",
      number: "69523442",
    });
    assert.deepEqual(classifyTitle("Trade Update"), { kind: "other", number: null });
  });

  it("strips HTML from summaries", () => {
    assert.equal(stripHtml("<p>301-FL <b>effective</b></p>"), "301-FL effective");
  });

  it("parses GovDelivery items and filters to CSMS by default", () => {
    const all = parseGovDeliveryRss(SAMPLE);
    assert.equal(all.length, 3);
    const csms = filterCsmsMessages(all);
    assert.equal(csms.length, 1);
    assert.equal(csms[0].number, "69326983");
    assert.match(csms[0].summary, /301-FL/);
    const withCams = filterCsmsMessages(all, { include_cams: true });
    assert.equal(withCams.length, 2);
    const q = filterCsmsMessages(all, { q: "forced labor" });
    assert.equal(q.length, 1);
  });
});
