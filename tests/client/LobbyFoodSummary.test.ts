import { GameType } from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import { notableLobbySettings } from "../../src/client/utilities/LobbySettingsSummary";

describe("lobby settings summary food toggle", () => {
  const base = {
    gameType: GameType.Private,
    difficulty: "Easy",
  } as unknown as GameConfig;
  it("lists the food economy only when enabled", () => {
    const on = notableLobbySettings(
      { ...base, resources: { food: true } },
      null,
    );
    const off = notableLobbySettings(
      { ...base, resources: { food: false } },
      null,
    );
    expect(on.some((i) => i.label.toLowerCase().includes("food"))).toBe(true);
    expect(off.some((i) => i.label.toLowerCase().includes("food"))).toBe(false);
  });
});
