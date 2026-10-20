import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { resourcePressure } from "@openfront/engine/execution/utils/ResourceAdvisor";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { conquerBox, run, spawn } from "./helpers";

const FOOD = ResourceType.Food;

async function world() {
  const game = await setup("plains", { resources: { food: true } });
  const a = spawn(game, "a", 10, 10, PlayerType.Human);
  const b = spawn(game, "b", 60, 60, PlayerType.Human);
  conquerBox(game, a, 5, 5, 15, 15);
  conquerBox(game, b, 55, 55, 65, 65);
  run(game, 12);
  return { game, a, b };
}

function starve(p: Player, stock: number): void {
  p.resources().terrainCounts.fill(0);
  p.resources().stock[FOOD] = stock;
}

function netRate(game: Game, p: Player): number {
  const r = p.resources();
  return game
    .config()
    .netTroopRate(
      game.config().troopIncreaseRate(p),
      r.growthMultiplier,
      r.fedMin(),
      r.starveRate,
    );
}

describe("continuous starvation", () => {
  test("troop change is continuous as the stock runs out", async () => {
    const { game, b } = await world();
    const base = game.config().troopIncreaseRate(b);
    starve(b, 3 * b.resources().structuralNeed[FOOD] * 10);
    let prev = netRate(game, b);
    let maxStep = 0;
    let minFed = 1;
    for (let i = 0; i < 1500; i++) {
      game.executeNextTick();
      const n = netRate(game, b);
      maxStep = Math.max(maxStep, Math.abs(n - prev));
      prev = n;
      minFed = Math.min(minFed, b.resources().fedMin());
    }
    // Fed falls through intermediate values instead of jumping to starvation.
    expect(minFed).toBeLessThan(0.9);
    // Fed moves every tick, so no tick-to-tick jump is more than a small share of growth.
    expect(maxStep).toBeLessThan(0.08 * Math.max(1, base));
  });

  test("a starving population converges to zero net growth", async () => {
    const { game, b } = await world();
    starve(b, 0);
    run(game, 4000);
    const r = b.resources();
    const base = game.config().troopIncreaseRate(b);
    expect(r.fedMin()).toBeLessThan(0.99);
    expect(r.stock[FOOD]).toBeLessThan(1e-6 + r.structuralNeed[FOOD]);
    expect(Math.abs(netRate(game, b))).toBeLessThan(0.05 * Math.max(1, base));
  });

  test("zero production with a stockpile still grows at about half rate", async () => {
    const { game, b } = await world();
    starve(b, 1e9);
    run(game, 600);
    const r = b.resources();
    expect(r.fedMin()).toBe(1);
    expect(r.starveRate).toBe(0);
    expect(r.growthMultiplier).toBeCloseTo(0.5, 2);
    const base = game.config().troopIncreaseRate(b);
    expect(netRate(game, b) / base).toBeCloseTo(0.5, 2);
  });
});

describe("structural pressure", () => {
  test("fed player has no pressure", async () => {
    const { game, a } = await world();
    a.resources().terrainCounts.set([100000, 0, 0]);
    run(game, 50);
    expect(resourcePressure(game, a)).toBe(0);
  });

  test("starving equilibrium is high and stable", async () => {
    const { game, b } = await world();
    starve(b, 0);
    run(game, 3000);
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      run(game, 50);
      samples.push(resourcePressure(game, b));
    }
    expect(Math.min(...samples)).toBeGreaterThan(0.9);
    expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.05);
  });

  test("a stockpile lowers pressure smoothly", async () => {
    const { game, b } = await world();
    starve(b, 0);
    run(game, 20);
    const need = b.resources().structuralNeed[FOOD];
    const out: number[] = [];
    for (const secs of [0, 30, 60, 90, 120]) {
      b.resources().stock[FOOD] = need * 10 * secs;
      out.push(resourcePressure(game, b));
    }
    for (let i = 1; i < out.length; i++)
      expect(out[i]).toBeLessThan(out[i - 1]);
    expect(out[4]).toBe(0);
  });

  test("launching an attack does not raise pressure", async () => {
    const { game, b } = await world();
    starve(b, 0);
    run(game, 100);
    const before = resourcePressure(game, b);
    game.addExecution(
      new AttackExecution(
        Math.floor(b.troops() / 2),
        b,
        game.terraNullius().id(),
      ),
    );
    run(game, 1);
    expect(resourcePressure(game, b)).toBeLessThanOrEqual(before + 1e-9);
    run(game, 10);
    expect(resourcePressure(game, b)).toBeLessThan(before + 0.02);
  });
});
