import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { readVersioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import {
  defaultPlayerResourcesData,
  PlayerResourcesSnapshot,
} from "@openfront/engine/game/economy/PlayerResources";
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
    expect(b.resources().starveRate).toBeGreaterThan(0);
    expect(b.resources().fedMin()).toBeLessThan(1);
    expect(b.resources().starved).toBeGreaterThan(0);
    await expectSnapshotRoundTrip(game, "plains", 40);
  });

  test("v1 records migrate to v2 with a fully fed, non-starving default", () => {
    const { fed, starveRate, structuralNeed, ...v1 } =
      defaultPlayerResourcesData();
    const migrated = readVersioned(PlayerResourcesSnapshot, { v: 1, d: v1 });
    expect(migrated.fed.every((x) => x === 1)).toBe(true);
    expect(migrated.starveRate).toBe(0);
    expect(migrated.structuralNeed.every((x) => x === 0)).toBe(true);
    void fed;
    void starveRate;
    void structuralNeed;
  });

  test("round trip with food off", async () => {
    const game = await setup("plains", {});
    spawn(game, "a", 10, 10);
    run(game, 15);
    await expectSnapshotRoundTrip(game, "plains", 10);
  });
});
