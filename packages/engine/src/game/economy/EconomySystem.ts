import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  NUM_RESOURCES,
  RESOURCE_EVAL_ORDER,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import type { EngineConfig } from "../../configuration/EngineConfig";
import type { Player } from "../Game";
import { FoodRule } from "./FoodRule";
import type { PlayerResources } from "./PlayerResources";

const TICKS_PER_SECOND = 10;
/** Fed fraction below which a resource counts as short. */
const SHORT_FED = 0.99;

export interface EconomyContext {
  player: Player;
  troopsHome: number;
  troopsAway: number;
  intervalSeconds: number;
  intervalTicks: number;
  /** Rules multiply their growth factor in. */
  growthMultiplier: number;
}

export interface ResourceRule {
  readonly type: ResourceType;
  /**
   * Fills production/consumption/net/levels/fed/structuralNeed[type], sets
   * homeShare and adds its per tick starvation to res.starveRate.
   */
  evaluate(ctx: EconomyContext, res: PlayerResources): void;
}

export class EconomySystem {
  readonly intervalTicks: number;
  private readonly rules: ResourceRule[] = [];
  private readonly intervalSeconds: number;
  private readonly startingSeconds: number;
  private readonly needPerTroopPerSecond: number;
  // Reused every call: no allocation in tickPlayer.
  private readonly ctx: EconomyContext = {
    player: null as unknown as Player,
    troopsHome: 0,
    troopsAway: 0,
    intervalSeconds: 0,
    intervalTicks: 0,
    growthMultiplier: 1,
  };

  constructor(readonly config: EngineConfig) {
    this.intervalTicks = config.economyIntervalTicks();
    this.intervalSeconds = this.intervalTicks / TICKS_PER_SECOND;
    this.ctx.intervalSeconds = this.intervalSeconds;
    this.ctx.intervalTicks = this.intervalTicks;
    for (const r of RESOURCE_EVAL_ORDER) {
      if (!config.isResourceEnabled(r)) continue;
      switch (r) {
        case ResourceType.Food:
          this.rules.push(new FoodRule(config, this.intervalSeconds));
          break;
      }
    }
    const f = config.foodTuning();
    this.startingSeconds = f.startingStockpileSeconds;
    this.needPerTroopPerSecond = f.needPerTroopPerSecond;
  }

  /** PlayerExecution, every tick after troop growth. */
  tickPlayer(player: Player, ticks: number): void {
    const res = player.resources();
    if ((ticks + res.phase) % this.intervalTicks === 0) {
      this.spreadAwayLoss(player, res);
      this.evaluate(player, res);
      res.dirty = true;
    }
    this.applyTick(player, res);
  }

  /** Per resource starting stock: seconds of base need at the start troops. */
  startingStockpile(startTroops: number): number[] {
    const out = new Array<number>(NUM_RESOURCES).fill(0);
    out[ResourceType.Food] =
      this.startingSeconds * this.needPerTroopPerSecond * startTroops;
    return out;
  }

  private evaluate(player: Player, res: PlayerResources): void {
    let away = 0;
    const attacks = player.outgoingAttacks();
    for (let i = 0; i < attacks.length; i++) away += attacks[i].troops();
    const units = player.units();
    for (let i = 0; i < units.length; i++) {
      if (units[i].type() === UnitType.TransportShip) away += units[i].troops();
    }
    const ctx = this.ctx;
    ctx.player = player;
    ctx.troopsHome = player.troops();
    ctx.troopsAway = away;
    ctx.growthMultiplier = 1;
    res.starveRate = 0;
    for (let i = 0; i < this.rules.length; i++) {
      this.rules[i].evaluate(ctx, res);
    }
    res.growthMultiplier = ctx.growthMultiplier;
    let mask = 0;
    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i].type;
      if (res.fed[r] < SHORT_FED) mask |= 1 << r;
    }
    res.shortageMask = mask;
    ctx.player = null as unknown as Player;
  }

  private applyTick(player: Player, res: PlayerResources): void {
    for (let i = 0; i < this.rules.length; i++) {
      const r = this.rules[i].type;
      const stock = res.stock[r] + res.net[r];
      res.stock[r] = stock > 0 ? stock : 0;
    }
    if (res.starveRate > 0) {
      res.lossAccHome += res.starveRate * res.homeShare;
      res.lossAccAway += res.starveRate * (1 - res.homeShare);
    }
    if (res.lossAccHome >= 1) {
      const whole = Math.floor(res.lossAccHome);
      const removed = player.removeTroops(whole);
      res.starved += removed;
      res.lossAccHome -= whole;
    }
  }

  /** Applies accumulated away losses across attacks, then boats, by size. */
  private spreadAwayLoss(player: Player, res: PlayerResources): void {
    if (res.lossAccAway < 1) return;
    const attacks = player.outgoingAttacks();
    const units = player.units();
    let reducible = 0;
    for (let i = 0; i < attacks.length; i++) reducible += attacks[i].troops();
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.type() === UnitType.TransportShip) {
        reducible += Math.max(0, u.troops() - 1);
      }
    }
    if (reducible <= 0) {
      // Nothing away to hurt (e.g. everything landed): the loss lapses.
      res.lossAccAway = 0;
      return;
    }
    const loss = Math.min(Math.floor(res.lossAccAway), reducible);
    let applied = 0;
    for (let i = 0; i < attacks.length; i++) {
      const t = attacks[i].troops();
      const take = Math.min(t, (loss * t) / reducible);
      attacks[i].setTroops(t - take);
      applied += take;
    }
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.type() !== UnitType.TransportShip) continue;
      const t = u.troops();
      const take = Math.floor((loss * Math.max(0, t - 1)) / reducible);
      if (take > 0) {
        u.setTroops(t - take);
        applied += take;
      }
    }
    res.lossAccAway -= applied;
    res.starved += applied;
  }
}
