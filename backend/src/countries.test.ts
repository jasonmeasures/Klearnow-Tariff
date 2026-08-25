/**
 * Origin picker must cover ISO 3166-1 and every 301-FL economy.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COUNTRIES, resolveCountryIso } from "../../frontend/countries.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Official ISO 3166-1 alpha-2 (249), including HK / MO / TW. */
const ISO3166_ALPHA2 = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM
BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX
CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG
GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR
IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV
LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE
NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO
RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF
TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF
WS YE YT ZA ZM ZW
`.trim().split(/\s+/);

describe("origin country picker", () => {
  const byCode = new Map(COUNTRIES);

  it("has unique ISO-2 codes", () => {
    assert.equal(byCode.size, COUNTRIES.length);
  });

  it("covers every ISO 3166-1 alpha-2 code", () => {
    assert.equal(ISO3166_ALPHA2.length, 249);
    const missing = ISO3166_ALPHA2.filter((c) => !byCode.has(c));
    assert.deepEqual(missing, [], `picker missing ${missing.join(", ")}`);
  });

  it("covers every 301-FL pack economy", () => {
    const pack = JSON.parse(
      readFileSync(join(ROOT, "tariff-rules/data/s301fl_pack.json"), "utf8"),
    );
    const missing = pack.countries
      .map((c) => c.iso2)
      .filter((iso) => !byCode.has(iso));
    assert.deepEqual(missing, [], `picker missing FL ${missing.join(", ")}`);
  });

  it("resolves Hong Kong and Macao by code and alias", () => {
    assert.equal(resolveCountryIso("HK"), "HK");
    assert.equal(resolveCountryIso("Hong Kong"), "HK");
    assert.equal(resolveCountryIso("Hong Kong SAR"), "HK");
    assert.equal(resolveCountryIso("MO"), "MO");
    assert.equal(resolveCountryIso("Macao"), "MO");
    assert.equal(resolveCountryIso("Macau"), "MO");
  });
});
