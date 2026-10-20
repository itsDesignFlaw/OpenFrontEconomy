import {
  NUM_RESOURCES,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { ECONOMY_INTERVAL_TICKS } from "@openfront/engine-lib/configuration/Config";
import type { EngineConfig } from "../../configuration/EngineConfig";
import type { Player } from "../Game";
import type { PlayerResources } from "./PlayerResources";

export interface EconomyContext {
  player: Player;
  troopsHome: number;
  troopsAway: number;
  intervalSeconds: number;
  /** Rules multiply their growth factor in. */
  growthMultiplier: number;
}

export interface ResourceRule {
  readonly type: ResourceType;
  /** Fills production/consumption/net/levels/unfedPerUnit[type]. */
  evaluate(ctx: EconomyContext, res: PlayerResources): void;
  /** Troops lost this tick to an unmet need. */
  shortageTroopLoss(res: PlayerResources, unmet: number): number;
}

/** Stub: bodies are filled in by the economy rules task. */
export class EconomySystem {
  readonly intervalTicks: number = ECONOMY_INTERVAL_TICKS;

  constructor(readonly config: EngineConfig) {
    this.intervalTicks = config.economyIntervalTicks();
  }

  /** PlayerExecution, every tick after troop growth. */
  tickPlayer(_player: Player, _ticks: number): void {}

  /** Starting stock per resource. */
  startingStockpile(_startTroops: number): number[] {
    return new Array<number>(NUM_RESOURCES).fill(0);
  }
}
