/**
 * Section 232 MHDV / buses / MHDV parts — Proclamation 10984 (U.S. note 38).
 * CSMS #66665333. Parts duty is claim-gated because 9903.74.11 exists.
 */
import pack from "../data/s232_mhdv.json" with { type: "json" };
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export const S232_MHDV_START = String(pack.program.effective);

const VEHICLE_STEMS = compileStems(pack.vehicles_hts as string[]);
const BUS_STEMS = compileStems(pack.buses_hts as string[]);
const PART_STEMS = compileStems(pack.parts_hts as string[]);

export type MhdvKind = "vehicle" | "bus" | "part";

export function match232Mhdv(hts: string, kind: MhdvKind) {
  const stems = kind === "vehicle" ? VEHICLE_STEMS : kind === "bus" ? BUS_STEMS : PART_STEMS;
  const hit = matchStem(hts, stems);
  if (!hit) return null;
  const heading =
    kind === "vehicle"
      ? pack.headings.mhdv_duty
      : kind === "bus"
        ? pack.headings.buses_duty
        : pack.headings.parts_duty;
  return { ...hit, kind, ch99_duty: heading as string, source: pack.source as string };
}

export function match232MhdvVehicle(hts: string) {
  return match232Mhdv(hts, "vehicle");
}
export function match232MhdvBus(hts: string) {
  return match232Mhdv(hts, "bus");
}
export function match232MhdvPart(hts: string) {
  return match232Mhdv(hts, "part");
}

export function s232MhdvMeta() {
  return {
    id: pack.program.id,
    effective: pack.program.effective,
    source_csms: pack.program.source_csms,
    vehicle_stems: VEHICLE_STEMS.length,
    bus_stems: BUS_STEMS.length,
    part_stems: PART_STEMS.length,
    headings: pack.headings,
  };
}

export function s232MhdvAppliesOn(d: string | null | undefined): boolean {
  return onOrAfter(d, S232_MHDV_START);
}
