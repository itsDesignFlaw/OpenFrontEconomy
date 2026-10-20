// @vitest-environment jsdom
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

function makeGame(enabled: boolean, short: boolean): GameView {
  const player = {
    isAlive: () => true,
    troops: () => 100,
    gold: () => 0n,
    outgoingAttacks: () => [],
    growthMultiplier: () => 0.5,
    resourceStock: () => 1234,
    resourceNetPerSecond: () => -3,
    resourceProductionPerSecond: () => 1,
    resourceConsumptionPerSecond: () => 4,
    isResourceShort: () => short,
    resourceFed: () => 1,
    starvationPerTick: () => 0,
  };
  return {
    inSpawnPhase: () => false,
    myPlayer: () => player,
    config: () => ({
      resourcesEnabled: () => enabled,
      isResourceEnabled: () => true,
      maxTroops: () => 1000,
      troopIncreaseRate: () => 2,
      effectiveTroopIncreaseRate: (b: number, g: number) => b * g,
    }),
  } as unknown as GameView;
}

describe("ControlPanel resource chip", () => {
  let panel: ControlPanel;
  beforeEach(() => {
    document.body.innerHTML = "";
    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0.2 } as UIState;
    panel.eventBus = new EventBus();
  });
  afterEach(() => panel.remove());

  async function render(enabled: boolean, short: boolean) {
    panel.game = makeGame(enabled, short);
    document.body.appendChild(panel);
    (panel as any)._isVisible = true;
    panel.requestUpdate();
    await panel.updateComplete;
  }

  it("is hidden when the economy is off", async () => {
    await render(false, false);
    expect(panel.querySelector(".resource-chip")).toBeNull();
  });

  it("shows a chip when enabled, with the starving state", async () => {
    await render(true, true);
    const chips = panel.querySelectorAll(".resource-chip");
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].getAttribute("data-short")).toBe("true");
  });

  it("shows a non-starving chip when stocked", async () => {
    await render(true, false);
    expect(
      panel.querySelector(".resource-chip")?.getAttribute("data-short"),
    ).toBe("false");
  });
});
