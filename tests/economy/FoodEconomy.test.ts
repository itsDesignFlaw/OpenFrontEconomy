import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { conquerBox, run, spawn } from "./helpers";

const FOOD = ResourceType.Food;
const food = { resources: { food: true } };

async function twoBots(extra = {}) {
  const game = await setup("plains", { ...food, ...extra });
  const a = spawn(game, "a", 10, 10, PlayerType.Human);
  const b = spawn(game, "b", 60, 60, PlayerType.Human);
  conquerBox(game, a, 5, 5, 15, 15);
  conquerBox(game, b, 55, 55, 65, 65);
  run(game, 12); // past spawn phase and one full economy interval
  return { game, a, b };
}

const hash = (g: Game) => (g as unknown as { hash(): number }).hash();

describe("food economy", () => {
  test("production = sum of class counts times per-tile rates", async () => {
    const { game, a } = await twoBots();
    a.resources().terrainCounts.set([10, 20, 30]);
    run(game, 10);
    expect(a.resources().production[FOOD]).toBe(10 * 7 + 20 * 3 + 30 * 1);
  });

  test("away troops count triple toward need", async () => {
    const { game, a } = await twoBots();
    a.resources().terrainCounts.fill(0);
    run(game, 10);
    const c = game.config().foodTuning().needPerTroopPerTick;
    const homeOnly = a.troops();
    const levelNow = a.resources().levels[FOOD];
    // Troops grew since the last evaluation, so allow a few percent.
    const cons = a.resources().consumption[FOOD];
    expect(Math.abs(cons / (c * homeOnly * levelNow) - 1)).toBeLessThan(0.1);
    game.addExecution(new AttackExecution(5000, a, game.terraNullius().id()));
    run(game, 10);
    const r = a.resources();
    const att = a.outgoingAttacks().reduce((s, x) => s + x.troops(), 0);
    expect(att).toBeGreaterThan(0);
    expect(r.homeShare).toBeLessThan(1);
    expect(r.homeShare).toBeCloseTo(a.troops() / (a.troops() + 3 * att), 1);
  });

  test("satiation converges to the clamped target", async () => {
    const { game, a, b } = await twoBots();
    a.resources().terrainCounts.fill(0);
    b.resources().terrainCounts.set([100000, 0, 0]);
    a.resources().stock[FOOD] = 1e12;
    run(game, 600);
    expect(a.resources().levels[FOOD]).toBeCloseTo(0.5, 2);
    expect(b.resources().levels[FOOD]).toBeCloseTo(1.5, 2);
  });

  test("one interval closes the per-second share of the gap", async () => {
    const game = await setup("plains", food);
    const eco = game.economy()!;
    const a = spawn(game, "a", 10, 10, PlayerType.Human);
    conquerBox(game, a, 5, 5, 15, 15);
    run(game, 3);
    const r = a.resources();
    r.terrainCounts.fill(0);
    r.levels[FOOD] = 1;
    const t = game.ticks();
    let ticks = t;
    while ((ticks + r.phase) % eco.intervalTicks !== 0) ticks++;
    // Evaluate exactly once, as PlayerExecution would.
    eco.tickPlayer(a, ticks);
    const k = 1 - Math.pow(1 - 0.2, eco.intervalTicks / 10);
    expect(r.levels[FOOD]).toBeCloseTo(1 + (0.5 - 1) * k, 9);
  });

  test("surplus accumulates and deficit drains", async () => {
    const { game, a, b } = await twoBots();
    a.resources().terrainCounts.set([100000, 0, 0]);
    b.resources().terrainCounts.fill(0);
    run(game, 10);
    const a0 = a.resources().stock[FOOD];
    const b0 = b.resources().stock[FOOD];
    run(game, 50);
    expect(a.resources().stock[FOOD]).toBeGreaterThan(a0);
    expect(b.resources().stock[FOOD]).toBeLessThan(b0);
    expect(a.resources().starved + b.resources().starved).toBe(0);
  });

  test("starvation costs troops only once the stock is empty", async () => {
    const { game, b } = await twoBots();
    const r = b.resources();
    r.terrainCounts.fill(0);
    r.stock[FOOD] = 0;
    run(game, 100);
    expect(r.isShort(FOOD)).toBe(true);
    expect(r.starved).toBeGreaterThan(0);
    // ~2%/s of unfed troops, level 0.5 -> roughly 1% of troops per second
    // lost over 10 s, against growth that continues.
    expect(r.starved).toBeLessThan(b.troops());
  });

  test("away troops starve and growth follows the satiation level", async () => {
    const { game, a } = await twoBots();
    const r = a.resources();
    r.terrainCounts.fill(0);
    r.stock[FOOD] = 0;
    game.addExecution(new AttackExecution(8000, a, game.terraNullius().id()));
    run(game, 100);
    expect(r.lossAccAway + r.starved).toBeGreaterThan(0);
    expect(r.growthMultiplier).toBeCloseTo(r.levels[FOOD], 9);
    expect(r.levels[FOOD]).toBeLessThan(1);
  });

  test("infinite-troops humans are exempt", async () => {
    const game = await setup("plains", { ...food, infiniteTroops: true });
    const h = spawn(game, "h", 10, 10, PlayerType.Human);
    conquerBox(game, h, 5, 5, 15, 15);
    h.resources().terrainCounts.fill(0);
    h.resources().stock[FOOD] = 0;
    run(game, 60);
    expect(h.resources().levels[FOOD]).toBe(1);
    expect(h.resources().consumption[FOOD]).toBe(0);
    expect(h.resources().starved).toBe(0);
  });

  test("evaluates exactly once per interval per player", async () => {
    const { game, a } = await twoBots();
    const r = a.resources();
    r.terrainCounts.fill(0);
    run(game, 10);
    expect(r.production[FOOD]).toBe(0);
    r.terrainCounts.set([1, 0, 0]);
    let waited = 0;
    while (r.production[FOOD] === 0 && waited < 50) {
      run(game, 1);
      waited++;
    }
    expect(waited).toBeGreaterThanOrEqual(1);
    expect(waited).toBeLessThanOrEqual(10);
    r.terrainCounts.set([2, 0, 0]);
    run(game, waited === 10 ? 9 : 9);
    expect(r.production[FOOD]).toBe(7);
    run(game, 1);
    expect(r.production[FOOD]).toBe(14);
  });

  test("identical games hash identically", async () => {
    const run1 = async () => {
      const { game } = await twoBots();
      run(game, 200);
      return hash(game);
    };
    expect(await run1()).toBe(await run1());
  });

  test("sanity: fresh player stockpile, production and growth", async () => {
    const { game, a } = await twoBots();
    const r = a.resources();
    const start = r.stock[FOOD];
    const troops0 = a.troops();
    run(game, 300);
    expect(Number.isFinite(r.stock[FOOD])).toBe(true);
    expect(r.stock[FOOD]).toBeGreaterThanOrEqual(0);
    expect(r.production[FOOD]).toBeGreaterThan(0);
    expect(a.troops()).toBeGreaterThan(troops0 * 0.9);
    void start;
    void (null as unknown as Player);
  });
});
