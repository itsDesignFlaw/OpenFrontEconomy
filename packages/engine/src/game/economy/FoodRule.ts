import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import type { FoodTuning } from "@openfront/engine-lib/configuration/Config";
import { pow } from "@openfront/engine-lib/DetMath";
import type { EngineConfig } from "../../configuration/EngineConfig";
import type { EconomyContext, ResourceRule } from "./EconomySystem";
import type { PlayerResources } from "./PlayerResources";

const FOOD = ResourceType.Food;
const TICKS_PER_SECOND = 10;

export class FoodRule implements ResourceRule {
  readonly type = ResourceType.Food;
  private readonly t: FoodTuning;
  /** Share of the satiation gap closed per economy tick. */
  private readonly k: number;
  /** Share of the fed gap closed per economy tick. */
  private readonly kFed: number;
  private readonly lossPerTick: number;
  /** Config rates are per second; internal state and hot paths use per tick. */
  private readonly baseProdPerTick: number;
  private readonly prodPerTilePerTick: readonly number[];
  private readonly needPerTroopPerTick: number;

  constructor(
    private readonly config: EngineConfig,
    intervalSeconds: number,
  ) {
    this.t = config.foodTuning();
    this.k = 1 - pow(1 - this.t.satiationApproachPerSecond, intervalSeconds);
    this.kFed = 1 - pow(1 - this.t.fedApproachPerSecond, intervalSeconds);
    this.lossPerTick = this.t.starvationLossPerSecond / TICKS_PER_SECOND;
    const secondsPerTick = config.msPerTick() / 1000;
    this.baseProdPerTick = this.t.baseProductionPerSecond * secondsPerTick;
    this.prodPerTilePerTick = this.t.productionPerTilePerSecond.map(
      (r) => r * secondsPerTick,
    );
    this.needPerTroopPerTick = this.t.needPerTroopPerSecond * secondsPerTick;
  }

  evaluate(ctx: EconomyContext, res: PlayerResources): void {
    const t = this.t;
    let prod = this.baseProdPerTick;
    for (let c = 0; c < res.terrainCounts.length; c++) {
      prod += res.terrainCounts[c] * this.prodPerTilePerTick[c];
    }
    res.production[FOOD] = prod;

    const p = ctx.player;
    if (p.type() === PlayerType.Human && this.config.hasInfiniteTroopsFor(p)) {
      res.levels[FOOD] = 1;
      res.consumption[FOOD] = 0;
      res.net[FOOD] = prod;
      res.fed[FOOD] = 1;
      res.fedStep[FOOD] = 0;
      res.consNeeded[FOOD] = 0;
      res.starveCoef[FOOD] = 0;
      res.structuralNeed[FOOD] = 0;
      res.unfedPerUnit[FOOD] = 0;
      res.homeShare = 1;
      return;
    }

    const weighted = ctx.troopsHome + t.awayNeedMultiplier * ctx.troopsAway;
    const need = this.needPerTroopPerTick * weighted;
    let target = t.satiationMax;
    if (need > 0) {
      target = prod / need;
      if (target < t.satiationMin) target = t.satiationMin;
      else if (target > t.satiationMax) target = t.satiationMax;
    }
    const level = res.levels[FOOD] + (target - res.levels[FOOD]) * this.k;
    res.levels[FOOD] = level;
    const consNeeded = need * level;
    let fTarget = 1;
    if (consNeeded > 0) {
      const available = prod + res.stock[FOOD] / ctx.intervalTicks;
      fTarget = Math.min(1, available / consNeeded);
    }
    // fed reaches f by the next economy tick in equal per-tick steps.
    const f = res.fed[FOOD] + (fTarget - res.fed[FOOD]) * this.kFed;
    res.fedStep[FOOD] = (f - res.fed[FOOD]) / ctx.intervalTicks;
    res.consNeeded[FOOD] = consNeeded;
    res.starveCoef[FOOD] = this.lossPerTick * weighted;
    const cons = consNeeded * f;
    res.consumption[FOOD] = cons;
    res.net[FOOD] = prod - cons;
    res.structuralNeed[FOOD] =
      this.needPerTroopPerTick * (ctx.troopsHome + ctx.troopsAway);
    ctx.growthMultiplier *= level;
    res.unfedPerUnit[FOOD] =
      need > 0 ? 1 / (this.needPerTroopPerTick * level) : 0;
    res.homeShare = weighted > 0 ? ctx.troopsHome / weighted : 1;
  }
}
