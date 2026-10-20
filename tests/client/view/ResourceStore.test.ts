import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  NUM_RESOURCES,
  RES_FIELD_CONS,
  RES_FIELD_NET,
  RES_FIELD_PROD,
  RES_FIELD_STOCK,
  RES_PACK_GROWTH,
  RES_PACK_SHORTAGE,
  RES_PACK_SMALL_ID,
  RES_PACK_STRIDE,
  ResourceType,
  resPackOffset,
} from "@openfront/engine-api/game/Resources";
import { describe, expect, it } from "vitest";
import { ResourceStore } from "../../../src/client/view/ResourceStore";
import {
  makeEmptyGu,
  makeGameView,
  makeNameViewData,
  makePlayerUpdate,
} from "../../util/viewStubs";

function pack(
  smallID: number,
  growth: number,
  mask: number,
  stock: number,
  net: number,
  prod = 0,
  cons = 0,
): Float64Array {
  const b = new Float64Array(RES_PACK_STRIDE);
  b[RES_PACK_SMALL_ID] = smallID;
  b[RES_PACK_GROWTH] = growth;
  b[RES_PACK_SHORTAGE] = mask;
  const F = ResourceType.Food;
  b[resPackOffset(F, RES_FIELD_STOCK)] = stock;
  b[resPackOffset(F, RES_FIELD_NET)] = net;
  b[resPackOffset(F, RES_FIELD_PROD)] = prod;
  b[resPackOffset(F, RES_FIELD_CONS)] = cons;
  return b;
}

describe("ResourceStore", () => {
  it("has the expected resource count", () => {
    expect(NUM_RESOURCES).toBeGreaterThan(0);
  });

  it("interpolates stock by net per tick and reports per-second rates", () => {
    const s = new ResourceStore();
    s.apply(pack(3, 0.8, 0, 100, 0.5, 2, 1.5), 10);
    expect(s.has(3)).toBe(true);
    expect(s.stock(3, ResourceType.Food, 10)).toBe(100);
    expect(s.stock(3, ResourceType.Food, 20)).toBe(105);
    expect(s.netPerSecond(3, ResourceType.Food)).toBeCloseTo(5);
    expect(s.productionPerSecond(3, ResourceType.Food)).toBeCloseTo(20);
    expect(s.consumptionPerSecond(3, ResourceType.Food)).toBeCloseTo(15);
    expect(s.growthMultiplier(3)).toBe(0.8);
    expect(s.isShort(3, ResourceType.Food)).toBe(false);
  });

  it("clamps at zero and never extrapolates backwards", () => {
    const s = new ResourceStore();
    s.apply(pack(1, 1, 1, 10, -1), 5);
    expect(s.stock(1, ResourceType.Food, 1000)).toBe(0);
    expect(s.stock(1, ResourceType.Food, 0)).toBe(10);
    expect(s.isShort(1, ResourceType.Food)).toBe(true);
  });

  it("returns defaults for unknown players and undefined buffers", () => {
    const s = new ResourceStore();
    // eslint-disable-next-line prefer-spread
    s.apply(undefined, 1);
    expect(s.has(9)).toBe(false);
    expect(s.stock(9, ResourceType.Food, 5)).toBe(0);
    expect(s.growthMultiplier(9)).toBe(1);
    expect(s.isShort(9, ResourceType.Food)).toBe(false);
  });

  it("handles several records in one buffer", () => {
    const a = pack(1, 1, 0, 5, 0);
    const b = pack(2, 0.5, 0, 7, 0);
    const buf = new Float64Array(a.length + b.length);
    buf.set(a, 0);
    buf.set(b, a.length);
    const s = new ResourceStore();
    s.apply(buf, 1);
    expect(s.stock(1, ResourceType.Food, 1)).toBe(5);
    expect(s.stock(2, ResourceType.Food, 1)).toBe(7);
  });
});

describe("GameView applies packedResourceUpdates", () => {
  it("exposes the packed record through PlayerView", () => {
    const game = makeGameView();
    const gu = makeEmptyGu(4);
    gu.updates[GameUpdateType.Player] = [
      makePlayerUpdate({ id: "alice", smallID: 1 }),
    ];
    gu.playerNameViewData = { alice: makeNameViewData() };
    gu.packedResourceUpdates = pack(1, 0.6, 1, 50, -2, 1, 3);
    game.update(gu);
    const p = game.player("alice");
    expect(p.growthMultiplier()).toBe(0.6);
    expect(p.isResourceShort(ResourceType.Food)).toBe(true);
    expect(p.resourceStock(ResourceType.Food)).toBe(50);
    expect(p.resourceNetPerSecond(ResourceType.Food)).toBeCloseTo(-20);
    expect(game.resources.has(1)).toBe(true);
  });
});
