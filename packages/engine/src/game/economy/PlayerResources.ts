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
  version: 2,
  migrations: {
    // v1 had no fed fraction or starvation rate: fully fed, none starving.
    1: (d) => ({
      ...d,
      fed: new Array(NUM_RESOURCES).fill(1),
      starveRate: 0,
      structuralNeed: new Array(NUM_RESOURCES).fill(0),
      fedStep: new Array(NUM_RESOURCES).fill(0),
      consNeeded: new Array(NUM_RESOURCES).fill(0),
      starveCoef: new Array(NUM_RESOURCES).fill(0),
      growthStep: 0,
    }),
  },
  schema: z.object({
    terrainCounts: z.array(zInt()),
    stock: z.array(zNum()),
    net: z.array(zNum()),
    production: z.array(zNum()),
    consumption: z.array(zNum()),
    levels: z.array(zNum()),
    unfedPerUnit: z.array(zNum()),
    fed: z.array(zNum()),
    starveRate: zNum(),
    structuralNeed: z.array(zNum()),
    fedStep: z.array(zNum()),
    consNeeded: z.array(zNum()),
    starveCoef: z.array(zNum()),
    growthStep: zNum(),
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
    fed: new Array(NUM_RESOURCES).fill(1),
    starveRate: 0,
    structuralNeed: new Array(NUM_RESOURCES).fill(0),
    fedStep: new Array(NUM_RESOURCES).fill(0),
    consNeeded: new Array(NUM_RESOURCES).fill(0),
    starveCoef: new Array(NUM_RESOURCES).fill(0),
    growthStep: 0,
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
  /** Per-resource smoothed fed fraction in [0, 1], init 1. */
  fed: Float64Array = new Float64Array(NUM_RESOURCES).fill(1);
  /** Troops lost to shortage per tick (home + away), held between economy ticks. */
  starveRate = 0;
  /** Per tick need if every troop counted 1x (UI/AI). */
  structuralNeed: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per-tick change of fed until the next economy tick, so fed moves every tick. */
  fedStep: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Consumption per tick at full feeding (need × satiation). */
  consNeeded: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Troops lost per tick per unit of unfed fraction. */
  starveCoef: Float64Array = new Float64Array(NUM_RESOURCES);
  /** Per-tick change of growthMultiplier until the next economy tick. */
  growthStep = 0;
  /** Product of the rules' growth factors, init 1. */
  growthMultiplier = 1;
  /** Bit r set: resource r fed fraction below 0.99. */
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

  /** Minimum fed fraction over all resources. */
  fedMin(): number {
    let m = 1;
    for (let i = 0; i < this.fed.length; i++)
      if (this.fed[i] < m) m = this.fed[i];
    return m;
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
      fed: Array.from(this.fed),
      starveRate: this.starveRate,
      structuralNeed: Array.from(this.structuralNeed),
      fedStep: Array.from(this.fedStep),
      consNeeded: Array.from(this.consNeeded),
      starveCoef: Array.from(this.starveCoef),
      growthStep: this.growthStep,
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
    this.fed = Float64Array.from(s.fed);
    this.starveRate = s.starveRate;
    this.structuralNeed = Float64Array.from(s.structuralNeed);
    this.fedStep = Float64Array.from(s.fedStep);
    this.consNeeded = Float64Array.from(s.consNeeded);
    this.starveCoef = Float64Array.from(s.starveCoef);
    this.growthStep = s.growthStep;
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
