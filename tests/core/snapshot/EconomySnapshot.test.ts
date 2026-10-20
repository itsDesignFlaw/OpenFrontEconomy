import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { conquerBox, run, spawn } from "../../economy/helpers";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";

describe("economy snapshots", () => {
  test("round trip with food on, including mid-starvation", async () => {
    const game = await setup("plains", { resources: { food: true } });
    const a = spawn(game, "a", 10, 10, PlayerType.Bot);
    const b = spawn(game, "b", 40, 40, PlayerType.Bot);
    conquerBox(game, a, 5, 5, 15, 15);
    conquerBox(game, b, 35, 35, 45, 45);
    run(game, 15);
    await expectSnapshotRoundTrip(game, "plains", 20);
    // Empty the stockpile so starvation is underway.
    b.resources().terrainCounts.fill(0); // no farmland
    b.resources().stock[ResourceType.Food] = 10;
    run(game, 60);
    expect(b.resources().isShort(ResourceType.Food)).toBe(true);
    expect(b.resources().starved).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, "plains", 40);
  });

  test("round trip with food off", async () => {
    const game = await setup("plains", {});
    spawn(game, "a", 10, 10);
    run(game, 15);
    await expectSnapshotRoundTrip(game, "plains", 10);
  });
});
