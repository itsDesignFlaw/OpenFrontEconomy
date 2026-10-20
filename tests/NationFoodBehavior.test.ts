import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import {
  resourcePressure,
  resourceValuePerTile,
} from "@openfront/engine/execution/utils/ResourceAdvisor";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

const F = ResourceType.Food;

async function world(food: boolean, type: PlayerType = PlayerType.Nation) {
  const game = await setup("big_plains", {
    infiniteGold: true,
    instantBuild: true,
    ...(food ? { resources: { food: true } } : {}),
  });
  const mk = (id: string, t: PlayerType) => {
    game.addPlayer(new PlayerInfo(id, t, null, id));
    return game.player(id);
  };
  const me = mk("me", type);
  const a = mk("a", PlayerType.Human);
  const b = mk("b", PlayerType.Human);
  const owners = [me, a, b];
  let n = 0;
  game.map().forEachTile((t) => {
    if (!game.map().isLand(t)) return;
    owners[n % 3].conquer(t);
    n += 1;
  });
  me.addTroops(100_000);
  a.addTroops(1000);
  b.addTroops(1000);
  return { game, me, a, b };
}

function hunger(p: Player, level: "fed" | "short" | "half") {
  const r = p.resources();
  if (level === "fed") {
    r.net[F] = 1;
    r.stock[F] = 1000;
    r.shortageMask = 0;
  } else if (level === "short") {
    r.shortageMask = 1 << F;
    r.stock[F] = 0;
    r.net[F] = -1;
  } else {
    // runway 60s at 10 ticks/s -> pressure 0.5
    r.shortageMask = 0;
    r.stock[F] = 600;
    r.net[F] = -1;
  }
}

function attacker(game: Game, me: Player) {
  return new AiAttackBehavior(new PseudoRandom(7), game, me, 0.5, 0.5, 0.2);
}

describe("ResourceAdvisor", () => {
  it("is neutral when the economy is off", async () => {
    const { game, me, a } = await world(false);
    expect(resourcePressure(game, me)).toBe(0);
    expect(resourceValuePerTile(game, a)).toBe(0);
  });

  it("scales pressure by runway", async () => {
    const { game, me, a } = await world(true);
    hunger(me, "fed");
    expect(resourcePressure(game, me)).toBe(0);
    hunger(me, "half");
    expect(resourcePressure(game, me)).toBeCloseTo(0.5);
    hunger(me, "short");
    expect(resourcePressure(game, me)).toBe(1);
    a.resources().production[F] = a.numTilesOwned();
    expect(resourceValuePerTile(game, a)).toBeCloseTo(1);
  });
});

describe("nation food behavior", () => {
  it("fed nation chooses the same target as with food off", async () => {
    const off = await world(false);
    const on = await world(true);
    hunger(on.me, "fed");
    on.b.resources().production[F] = 1e6;
    const pick = (w: any) =>
      (attacker(w.game, w.me) as any).findJuicyTarget([w.a, w.b])?.id();
    expect(pick(on)).toBe(pick(off));
  });

  it("hungry nation prefers the more fertile of two equal targets", async () => {
    const w = await world(true);
    hunger(w.me, "short");
    w.a.resources().production[F] = 0;
    w.b.resources().production[F] = 1000;
    const ab = attacker(w.game, w.me) as any;
    expect(ab.findJuicyTarget([w.a, w.b]).id()).toBe("b");
    w.a.resources().production[F] = 5000;
    expect(ab.findJuicyTarget([w.a, w.b]).id()).toBe("a");
  });

  it("hungry nation attacks at a lower troop ratio", async () => {
    const w = await world(true);
    const ab = attacker(w.game, w.me) as any;
    const max = w.game.config().maxTroops(w.me);
    w.me.removeTroops(w.me.troops());
    w.me.addTroops(Math.floor(max * 0.4));
    hunger(w.me, "fed");
    expect(ab.hasReserveRatioTroops()).toBe(false);
    expect(ab.hasTriggerRatioTroops()).toBe(false);
    hunger(w.me, "short");
    expect(ab.hasReserveRatioTroops()).toBe(true);
    expect(ab.hasTriggerRatioTroops()).toBe(true);
  });

  it("pressure >= 0.25 blocks city builds", async () => {
    const w = await world(true);
    const nsb = new NationStructureBehavior(
      new PseudoRandom(3),
      w.game,
      w.me,
    ) as any;
    hunger(w.me, "fed");
    expect(nsb.tooHungryForCities()).toBe(false);
    w.me.resources().stock[F] = 1080; // runway 108s -> 0.1
    w.me.resources().net[F] = -1;
    expect(nsb.tooHungryForCities()).toBe(false);
    w.me.resources().stock[F] = 900; // 90s -> 0.25
    expect(nsb.tooHungryForCities()).toBe(true);
    hunger(w.me, "fed");
    expect(nsb.tooHungryForCities()).toBe(false);
  });

  it("tribes behave identically with food on and off", async () => {
    const off = await world(false, PlayerType.Bot);
    const on = await world(true, PlayerType.Bot);
    hunger(on.me, "short");
    on.b.resources().production[F] = 1e6;
    const o = attacker(off.game, off.me) as any;
    const n = attacker(on.game, on.me) as any;
    expect(n.hungerScale()).toBe(1);
    expect(n.findJuicyTarget([on.a, on.b])?.id()).toBe(
      o.findJuicyTarget([off.a, off.b])?.id(),
    );
    expect(n.hasReserveRatioTroops()).toBe(o.hasReserveRatioTroops());
  });
});
