import { TerrainType } from "@openfront/engine-api/game/GameTypes";
import {
  landClassOfMagnitude,
  NUM_RESOURCES,
  RES_FIELD_CONS,
  RES_PACK_HEADER,
  RES_PACK_PER_RESOURCE,
  RES_PACK_STRIDE,
  resPackOffset,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { describe, expect, it } from "vitest";
import { setup } from "../util/Setup";

describe("resources contract", () => {
  it("landClassOfMagnitude matches terrain classes below impassable", () => {
    const expected = (m: number) =>
      m < 10
        ? TerrainType.Plains
        : m < 20
          ? TerrainType.Highland
          : TerrainType.Mountain;
    for (let m = 0; m <= 30; m++) {
      expect(landClassOfMagnitude(m)).toBe(expected(m));
    }
  });

  it("pack stride math", () => {
    expect(RES_PACK_STRIDE).toBe(
      RES_PACK_HEADER + RES_PACK_PER_RESOURCE * NUM_RESOURCES,
    );
    expect(resPackOffset(ResourceType.Food, RES_FIELD_CONS)).toBe(
      RES_PACK_HEADER + 3,
    );
    expect(resPackOffset(ResourceType.Food, RES_FIELD_CONS)).toBeLessThan(
      RES_PACK_STRIDE,
    );
  });

  it("food is off by default and growth rate leaves negatives alone", async () => {
    const game = await setup("plains", {});
    const cfg = game.config() as Config;
    expect(cfg.isResourceEnabled(ResourceType.Food)).toBe(false);
    expect(cfg.resourcesEnabled()).toBe(false);
    expect(game.economy()).toBeNull();
    expect(cfg.effectiveTroopIncreaseRate(-5, 0.5)).toBe(-5);
    expect(cfg.effectiveTroopIncreaseRate(10, 0.5)).toBe(5);
    expect(cfg.effectiveTroopIncreaseRate(0, 0.5)).toBe(0);
  });

  it("food toggle enables the economy", async () => {
    const game = await setup("plains", { resources: { food: true } });
    expect(game.config().isResourceEnabled(ResourceType.Food)).toBe(true);
    expect(game.economy()).not.toBeNull();
  });
});
