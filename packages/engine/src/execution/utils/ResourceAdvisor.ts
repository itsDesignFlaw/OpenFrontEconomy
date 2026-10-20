import {
  NUM_RESOURCES,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { Game, Player } from "../../game/Game";

/** Nation AI food behavior. Every function returns the neutral value when the economy is off. */

/** Runway (seconds) at or above which a resource exerts no pressure. */
export const PRESSURE_RUNWAY_SECONDS = 120;
/** Per-tick net is applied every tick; the simulation runs at 10 ticks per second. */
const TICKS_PER_SECOND = 10;
/** Save-up thresholds are multiplied by 1 - k * pressure. */
export const HUNGER_THRESHOLD_SCALE_K = 0.5;
/** Pressure at or above which a nation stops building cities. */
export const NO_CITY_PRESSURE = 0.25;

/** Maximum over enabled resources, in [0, 1]. 1 if short, 0 if net >= 0. */
export function resourcePressure(game: Game, p: Player): number {
  if (game.economy() === null) return 0;
  const res = p.resources();
  const cfg = game.config();
  let pressure = 0;
  for (let r = 0 as ResourceType; r < NUM_RESOURCES; r++) {
    if (!cfg.isResourceEnabled(r)) continue;
    if (res.isShort(r)) return 1;
    const runway = res.runwaySeconds(r, TICKS_PER_SECOND);
    if (runway === Infinity) continue;
    const v = Math.min(1, Math.max(0, 1 - runway / PRESSURE_RUNWAY_SECONDS));
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
