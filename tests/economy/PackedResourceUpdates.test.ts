import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { RES_PACK_STRIDE } from "@openfront/engine-api/game/Resources";
import { setup } from "../util/Setup";
import { conquerBox, run, spawn } from "./helpers";

describe("packed resource updates", () => {
  test("absent when the economy is off", async () => {
    const game = await setup("plains", {});
    spawn(game, "a", 10, 10);
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
      expect(game.drainPackedResourceUpdates()).toBeNull();
    }
  });

  test("each player emits whole records, once per interval", async () => {
    const game = await setup("plains", { resources: { food: true } });
    const a = spawn(game, "a", 10, 10, PlayerType.Bot);
    conquerBox(game, a, 5, 5, 15, 15);
    run(game, 5);
    game.drainPackedResourceUpdates();
    const emitted: number[] = [];
    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
      const p = game.drainPackedResourceUpdates();
      if (p === null) continue;
      expect(p.length % RES_PACK_STRIDE).toBe(0);
      for (let o = 0; o < p.length; o += RES_PACK_STRIDE) {
        expect(p[o]).toBe(a.smallID());
        emitted.push(game.ticks());
      }
    }
    expect(emitted.length).toBe(10);
    for (let i = 1; i < emitted.length; i++) {
      expect(emitted[i] - emitted[i - 1]).toBe(10);
    }
  });
});
