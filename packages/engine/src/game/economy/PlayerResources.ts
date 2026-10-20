import {
  NUM_LAND_CLASSES,
  NUM_RESOURCES,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zInt,
  zNum,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";

export const PlayerResourcesSnapshot = snapshotType({
  name: "PlayerResources",
  version: 1,
  schema: z.object({
    terrainCounts: z.array(zInt()),
    stock: z.array(zNum()),
    net: z.array(zNum()),
    production: z.array(zNum()),
    consumption: z.array(zNum()),
    levels: z.array(zNum()),
    unfedPerUnit: z.array(zNum()),
    growthMultiplier: zNum(),
    shortageMask: zInt(),
    homeShare: zNum(),
    lossAccHome: zNum(),
    lossAccAway: zNum(),
    starved: zNum(),
    phase: zInt(),
  }),
});
export type PlayerResourcesState = z.infer<
  typeof PlayerResourcesSnapshot.schema
>;

export function defaultPlayerResourcesData(phase = 0): PlayerResourcesState {
  return {
    terrainCounts: new Array(NUM_LAND_CLASSES).fill(0),
    stock: new Array(NUM_RESOURCES).fill(0),
    net: new Array(NUM_RESOURCES).fill(0),
    production: new Array(NUM_RESOURCES).fill(0),
    consumption: new Array(NUM_RESOURCES).fill(0),
    levels: new Array(NUM_RESOURCES).fill(1),
    unfedPerUnit: new Array(NUM_RESOURCES).fill(0),
    growthMultiplier: 1,
    shortageMask: 0,
    homeShare: 1,
    lossAccHome: 0,
    lossAccAway: 0,
    starved: 0,
    phase,
  };
}

/** Per-player economy state. Plain data; the rules live in EconomySystem. */
export class PlayerResources {
  terrainCounts: Int32Array = new Int32Array(NUM_LAND_CLASSES);
  stock: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per tick, applied every tick. */
  net: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per tick (UI/AI). */
  production: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per tick (UI/AI). */
  consumption: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per-resource smoothed level (food = satiation), init 1. */
  levels: Float64Array = new Float64Array(NUM_RESOURCES).fill(1);
  /** Product of the rules' growth factors, init 1. */
  growthMultiplier = 1;
  /** Bit r set: resource r stock empty and unmet. */
  shortageMask = 0;
  /** home/(home + 3*away): split of losses. */
  homeShare = 1;
  /** Troops unfed per unit of unmet resource. */
  unfedPerUnit: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Fractional troop losses not yet removed. */
  lossAccHome = 0;
  lossAccAway = 0;
  /** Total troops lost to shortage (stats/harness). */
  starved = 0;
  phase: number;
  /** Emit a packed record this tick (derived; NOT snapshotted). */
  dirty = false;

  constructor(phase: number, startingStock: number[] | null) {
    this.phase = phase;
    if (startingStock) {
      for (let i = 0; i < NUM_RESOURCES; i++) {
        this.stock[i] = startingStock[i] ?? 0;
      }
    }
  }

  stockOf(r: ResourceType): number {
    return this.stock[r];
  }
  netOf(r: ResourceType): number {
    return this.net[r];
  }
  isShort(r: ResourceType): boolean {
    return (this.shortageMask & (1 << r)) !== 0;
  }
  /** Seconds until the stock runs out; Infinity if net >= 0. */
  runwaySeconds(r: ResourceType, ticksPerSecond: number): number {
    const n = this.net[r];
    if (n >= 0) return Infinity;
    return this.stock[r] / (-n * ticksPerSecond);
  }

  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(PlayerResourcesSnapshot, {
      terrainCounts: Array.from(this.terrainCounts),
      stock: Array.from(this.stock),
      net: Array.from(this.net),
      production: Array.from(this.production),
      consumption: Array.from(this.consumption),
      levels: Array.from(this.levels),
      unfedPerUnit: Array.from(this.unfedPerUnit),
      growthMultiplier: this.growthMultiplier,
      shortageMask: this.shortageMask,
      homeShare: this.homeShare,
      lossAccHome: this.lossAccHome,
      lossAccAway: this.lossAccAway,
      starved: this.starved,
      phase: this.phase,
    });
  }

  /** Assign-only; typed arrays are rebuilt. */
  restoreSnapshot(raw: unknown, _r: SnapshotReader): void {
    const s = readVersioned(PlayerResourcesSnapshot, raw);
    this.terrainCounts = Int32Array.from(s.terrainCounts);
    this.stock = Float64Array.from(s.stock);
    this.net = Float64Array.from(s.net);
    this.production = Float64Array.from(s.production);
    this.consumption = Float64Array.from(s.consumption);
    this.levels = Float64Array.from(s.levels);
    this.unfedPerUnit = Float64Array.from(s.unfedPerUnit);
    this.growthMultiplier = s.growthMultiplier;
    this.shortageMask = s.shortageMask;
    this.homeShare = s.homeShare;
    this.lossAccHome = s.lossAccHome;
    this.lossAccAway = s.lossAccAway;
    this.starved = s.starved;
    this.phase = s.phase;
    this.dirty = false;
  }
}
