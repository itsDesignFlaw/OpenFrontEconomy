import {
  NUM_RESOURCES,
  RES_FIELD_CONS,
  RES_FIELD_NET,
  RES_FIELD_PROD,
  RES_FIELD_STOCK,
  RES_PACK_GROWTH,
  RES_PACK_SHORTAGE,
  RES_PACK_SMALL_ID,
  RES_PACK_STRIDE,
  ResourceType,
  resPackOffset,
} from "@openfront/engine-api/game/Resources";

/** Engine ticks per second; packed rates are per tick. */
const TICKS_PER_SECOND = 10;
const FIELDS = 4;

interface Entry {
  sampleTick: number;
  growth: number;
  shortageMask: number;
  /** [stock, netPerTick, prodPerTick, consPerTick] per resource. */
  fields: Float64Array;
}

/**
 * Client-side mirror of per-player resource economies, fed by the engine's
 * packedResourceUpdates and keyed by smallID. Stocks are extrapolated
 * linearly between samples using the last net rate.
 */
export class ResourceStore {
  private entries = new Map<number, Entry>();

  apply(packed: Float64Array | undefined, tick: number): void {
    if (packed === undefined) return;
    for (
      let o = 0;
      o + RES_PACK_STRIDE <= packed.length;
      o += RES_PACK_STRIDE
    ) {
      const smallID = packed[o + RES_PACK_SMALL_ID];
      const fields = new Float64Array(NUM_RESOURCES * FIELDS);
      for (let r = 0; r < NUM_RESOURCES; r++) {
        for (let f = 0; f < FIELDS; f++) {
          fields[r * FIELDS + f] = packed[o + resPackOffset(r, f)];
        }
      }
      this.entries.set(smallID, {
        sampleTick: tick,
        growth: packed[o + RES_PACK_GROWTH],
        shortageMask: packed[o + RES_PACK_SHORTAGE],
        fields,
      });
    }
  }

  has(smallID: number): boolean {
    return this.entries.has(smallID);
  }

  private field(smallID: number, r: ResourceType, f: number): number {
    const e = this.entries.get(smallID);
    return e === undefined ? 0 : e.fields[r * FIELDS + f];
  }

  stock(smallID: number, r: ResourceType, atTick: number): number {
    const e = this.entries.get(smallID);
    if (e === undefined) return 0;
    const dt = Math.max(0, atTick - e.sampleTick);
    return Math.max(
      0,
      e.fields[r * FIELDS + RES_FIELD_STOCK] +
        e.fields[r * FIELDS + RES_FIELD_NET] * dt,
    );
  }

  netPerSecond(smallID: number, r: ResourceType): number {
    return this.field(smallID, r, RES_FIELD_NET) * TICKS_PER_SECOND;
  }

  productionPerSecond(smallID: number, r: ResourceType): number {
    return this.field(smallID, r, RES_FIELD_PROD) * TICKS_PER_SECOND;
  }

  consumptionPerSecond(smallID: number, r: ResourceType): number {
    return this.field(smallID, r, RES_FIELD_CONS) * TICKS_PER_SECOND;
  }

  growthMultiplier(smallID: number): number {
    return this.entries.get(smallID)?.growth ?? 1;
  }

  isShort(smallID: number, r: ResourceType): boolean {
    const e = this.entries.get(smallID);
    return e !== undefined && (e.shortageMask & (1 << r)) !== 0;
  }
}
