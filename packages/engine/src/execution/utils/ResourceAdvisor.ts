import {
  NUM_RESOURCES,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { Game, Player } from "../../game/Game";

/** Nation AI food behavior. Every function returns the neutral value when the economy is off. */

/** Save-up thresholds are multiplied by 1 - k * pressure. */
export const HUNGER_THRESHOLD_SCALE_K = 0.5;
/** Pressure at or above which a nation stops building cities. */
export const NO_CITY_PRESSURE = 0.25;

/** Seconds of structural need a stockpile must cover to fully cancel pressure. */
const PRESSURE_BUFFER_SECONDS = 120;
/** Production shortfall (share of structural need) that gives full land pressure. */
const PRESSURE_GAP_SPAN = 0.5;

/**
 * Maximum over enabled resources, in [0, 1]. Land gap (production against the
 * structural need of all troops) discounted by the stockpile buffer. Smooth: it
 * ignores troops going away, so attacks do not move it.
 */
export function resourcePressure(game: Game, p: Player): number {
  if (game.economy() === null) return 0;
  const res = p.resources();
  const cfg = game.config();
  const ticksPerSecond = 1000 / cfg.msPerTick();
  let pressure = 0;
  for (let r = 0 as ResourceType; r < NUM_RESOURCES; r++) {
    if (!cfg.isResourceEnabled(r)) continue;
    const need = res.structuralNeed[r];
    if (need <= 0) continue;
    const support = res.production[r] / need;
    const landGap = Math.min(1, Math.max(0, (1 - support) / PRESSURE_GAP_SPAN));
    const buffer = Math.min(
      1,
      Math.max(
        0,
        res.stock[r] / (need * ticksPerSecond * PRESSURE_BUFFER_SECONDS),
      ),
    );
    const v = landGap * (1 - buffer);
    if (v > pressure) pressure = v;
  }
  return pressure;
}

/** Total production per owned tile. Terra nullius and economy off give 0. */
export function resourceValuePerTile(game: Game, target: Player): number {
  if (game.economy() === null) return 0;
  const tiles = target.numTilesOwned();
  if (tiles <= 0) return 0;
  const prod = target.resources().production;
  let sum = 0;
  for (let r = 0; r < NUM_RESOURCES; r++) sum += prod[r];
  return sum / tiles;
}

/** Multiplier for save-up ratios: 1 for a fed nation. */
export function hungerThresholdScale(pressure: number): number {
  return 1 - HUNGER_THRESHOLD_SCALE_K * pressure;
}
