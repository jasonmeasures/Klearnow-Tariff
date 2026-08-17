/**
 * Section 232 passenger vehicles / light trucks — Proclamation 10908 (U.S. note 33).
 * CSMS #64624801. Distinct from the auto-parts annex (9903.94.05).
 */
import pack from "../data/s232_autos_vehicles.json" with { type: "json" };
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export const S232_VEHICLES_START = String(pack.program.effective);

const STEMS = compileStems(pack.hts as string[]);

export function match232PassengerVehicle(hts: string) {
  if (!hts) return null;
  const hit = matchStem(hts, STEMS);
  if (!hit) return null;
  return {
    ...hit,
    ch99_duty: pack.headings.duty as string,
    source: pack.source as string,
  };
}

export function isOn232PassengerVehicleList(hts: string): boolean {
  return Boolean(match232PassengerVehicle(hts));
}

export function s232VehiclesMeta() {
  return {
    id: pack.program.id,
    effective: pack.program.effective,
    source_csms: pack.program.source_csms,
    stem_count: STEMS.length,
    headings: pack.headings,
  };
}

export function s232VehiclesAppliesOn(d: string | null | undefined): boolean {
  return onOrAfter(d, S232_VEHICLES_START);
}
