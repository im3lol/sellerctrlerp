/**
 * The fleet face of the maintenance engine. A vehicle is an asset with an odometer, so
 * everything here is arithmetic on top of readings that lib/erp/maintenance.ts already
 * validates — nothing about a truck needs a second work-order engine.
 *
 * The number a fleet owner actually wants is cost per kilometre, and the one that catches
 * theft is litres per hundred kilometres drifting on one vehicle while the rest hold.
 */

export type FuelLog = {
  id: string;
  at: string;
  liters: number;
  cost: number;
  /** Odometer at the pump. Null means the driver did not write it down. */
  meterValue: number | null;
};

export type Consumption = {
  logId: string;
  at: string;
  distance: number;
  liters: number;
  cost: number;
  /** Litres per 100 km — the number every fleet compares. */
  per100: number;
  costPerKm: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Consumption between consecutive fills. The first fill has no "before", so it gives a
 * cost but no efficiency — that is honest, not a gap to paper over with an estimate.
 */
export function consumption(logs: FuelLog[]): Consumption[] {
  const usable = logs
    .filter((l) => l.meterValue != null && l.liters > 0)
    .sort((a, b) => a.meterValue! - b.meterValue!);

  const out: Consumption[] = [];
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1];
    const cur = usable[i];
    const distance = r2(cur.meterValue! - prev.meterValue!);
    if (distance <= 0) continue; // two fills at the same reading say nothing
    out.push({
      logId: cur.id, at: cur.at, distance, liters: cur.liters, cost: cur.cost,
      per100: r2((cur.liters / distance) * 100),
      costPerKm: r2(cur.cost / distance),
    });
  }
  return out;
}

/**
 * A fill that burns far more than this vehicle's own normal. Compared against its own
 * median, not a fleet average: a loaded truck and a delivery bike have no business being
 * held to the same number.
 */
export function fuelOutliers(rows: Consumption[], tolerance = 0.25): Consumption[] {
  if (rows.length < 4) return []; // too few fills to know what normal looks like
  const sorted = rows.map((c) => c.per100).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median <= 0) return [];
  return rows.filter((c) => c.per100 > median * (1 + tolerance));
}

/**
 * Everything a kilometre costs: fuel, parts and labour on its work orders, and the
 * depreciation the ledger already charges. Leaving depreciation out is how a fleet
 * convinces itself an old truck is cheap.
 */
export function costPerKm(input: {
  distance: number;
  fuelCost: number;
  maintenanceCost: number;
  depreciation?: number;
  otherCost?: number;
}): { total: number; perKm: number; breakdown: { fuel: number; maintenance: number; depreciation: number; other: number } } {
  const depreciation = input.depreciation ?? 0;
  const other = input.otherCost ?? 0;
  const total = r2(input.fuelCost + input.maintenanceCost + depreciation + other);
  return {
    total,
    perKm: input.distance > 0 ? r2(total / input.distance) : 0,
    breakdown: { fuel: r2(input.fuelCost), maintenance: r2(input.maintenanceCost), depreciation: r2(depreciation), other: r2(other) },
  };
}

export type Trip = { startMeter: number; endMeter: number | null };

/** How far the fleet actually ran, ignoring trips still out on the road. */
export function tripDistance(trips: Trip[]): number {
  return r2(trips.reduce((s, t) => s + (t.endMeter != null && t.endMeter > t.startMeter ? t.endMeter - t.startMeter : 0), 0));
}

/** A trip cannot end before it started, and it cannot end at a reading it never reached. */
export function validateTrip(startMeter: number, endMeter: number | null): string | null {
  if (!Number.isFinite(startMeter) || startMeter < 0) return "قراءة البداية لازم تكون رقم موجب";
  if (endMeter == null) return null;
  if (endMeter < startMeter) return "قراءة النهاية أقل من البداية";
  return null;
}
