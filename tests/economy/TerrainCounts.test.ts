import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  landClassOfMagnitude,
  NUM_LAND_CLASSES,
} from "@openfront/engine-api/game/Resources";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../util/Setup";
import { spawn } from "./helpers";

function scan(game: Game, p: Player): number[] {
  const counts = new Array<number>(NUM_LAND_CLASSES).fill(0);
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && game.owner(t) === p) {
        counts[landClassOfMagnitude(game.magnitude(t))]++;
      }
    }
  }
  return counts;
}

async function scenario(food: boolean) {
  const game = await setup("world", food ? { resources: { food: true } } : {});
  const a = spawn(game, "a", 10, 10, PlayerType.Bot);
  const b = spawn(game, "b", 11, 11, PlayerType.Bot);
  const land: number[] = [];
  for (let y = 0; y < game.height(); y += 3) {
    for (let x = 0; x < game.width(); x += 3) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.isImpassable(t)) land.push(t);
    }
  }
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 4000; i++) {
    const t = land[rnd() % land.length];
    const op = rnd() % 4;
    if (op === 0) a.conquer(t);
    else if (op === 1) b.conquer(t);
    else if (game.owner(t).isPlayer()) (game.owner(t) as Player).relinquish(t);
  }
  return { game, a, b };
}

describe("terrain counts", () => {
  test("equal a full scan after random conquer/relinquish", async () => {
    const { game, a, b } = await scenario(true);
    expect(Array.from(a.resources().terrainCounts)).toEqual(scan(game, a));
    expect(Array.from(b.resources().terrainCounts)).toEqual(scan(game, b));
    expect(a.resources().terrainCounts.some((n) => n > 0)).toBe(true);
  });

  test("conquerPlayer leaves counts consistent", async () => {
    const { game, a, b } = await scenario(true);
    for (const t of Array.from(b.tiles())) a.conquer(t);
    game.conquerPlayer(a, b);
    expect(Array.from(a.resources().terrainCounts)).toEqual(scan(game, a));
    expect(Array.from(b.resources().terrainCounts)).toEqual([0, 0, 0]);
  });

  test("stay zero when the economy is off", async () => {
    const { a, b } = await scenario(false);
    expect(Array.from(a.resources().terrainCounts)).toEqual([0, 0, 0]);
    expect(Array.from(b.resources().terrainCounts)).toEqual([0, 0, 0]);
  });

  test("owned tiles never carry fallout", async () => {
    const { game, a } = await scenario(true);
    for (const t of a.tiles()) expect(game.hasFallout(t)).toBe(false);
    const free = game.ref(0, 0);
    void free;
  });
});
