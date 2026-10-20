import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { NUM_RESOURCES } from "@openfront/engine-api/game/Resources";
import { setup } from "../util/Setup";
import { spawn } from "./helpers";

describe("resource transfer on elimination", () => {
  test("conqueror gains exactly the conquered stock", async () => {
    const game = await setup("ocean_and_land", { resources: { food: true } });
    const a = spawn(game, "a", 0, 10, PlayerType.Bot);
    const b = spawn(game, "b", 0, 12, PlayerType.Bot);
    const ra = a.resources();
    const rb = b.resources();
    ra.stock[0] = 100;
    rb.stock[0] = 250;
    game.conquerPlayer(a, b);
    for (let r = 0; r < NUM_RESOURCES; r++) {
      expect(ra.stock[r]).toBe(350);
      expect(rb.stock[r]).toBe(0);
    }
    expect(ra.dirty && rb.dirty).toBe(true);
  });

  test("no transfer when the economy is off", async () => {
    const game = await setup("ocean_and_land", {});
    const a = spawn(game, "a", 0, 10, PlayerType.Bot);
    const b = spawn(game, "b", 0, 12, PlayerType.Bot);
    b.resources().stock[0] = 250;
    game.conquerPlayer(a, b);
    expect(a.resources().stock[0]).toBe(0);
    expect(b.resources().stock[0]).toBe(250);
  });

  test("no transfer from a human who never attacked", async () => {
    const game = await setup("ocean_and_land", { resources: { food: true } });
    const a = spawn(game, "a", 0, 10, PlayerType.Bot);
    const b = spawn(game, "b", 0, 12, PlayerType.Human);
    b.resources().stock[0] = 250;
    const before = a.resources().stock[0];
    game.conquerPlayer(a, b);
    expect(a.resources().stock[0]).toBe(before);
    expect(b.resources().stock[0]).toBe(250);
  });
});
