// @vitest-environment jsdom
import { EventBus } from "@openfront/shared/EventBus";
import { render } from "lit";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../src/client/hud/layers/ControlPanel";
import type { ControlPanel } from "../../src/client/hud/layers/ControlPanel";
import { renderResourceChips } from "../../src/client/hud/ResourceReadout";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

function makePlayer(fed: number, starvePerTick: number) {
  return {
    isAlive: () => true,
    troops: () => 100,
    gold: () => 0n,
    outgoingAttacks: () => [],
    growthMultiplier: () => 1,
    resourceStock: () => 50,
    resourceNetPerSecond: () => -1,
    resourceProductionPerSecond: () => 1,
    resourceConsumptionPerSecond: () => 2,
    isResourceShort: () => false,
    resourceFed: () => fed,
    starvationPerTick: () => starvePerTick,
  };
}

function makeGame(player: ReturnType<typeof makePlayer>): GameView {
  return {
    inSpawnPhase: () => false,
    myPlayer: () => player,
    updatesSinceLastTick: () => null,
    ticks: () => 0,
    nearbyUnits: () => [],
    config: () => ({
      resourcesEnabled: () => true,
      isResourceEnabled: () => true,
      maxTroops: () => 1000,
      troopIncreaseRate: () => 1,
      effectiveTroopIncreaseRate: (b: number, g: number) => (b > 0 ? b * g : b),
      netTroopRate: (b: number, g: number, fed: number, s: number) =>
        (b > 0 ? b * g * fed : b) - s,
    }),
  } as unknown as GameView;
}

describe("ControlPanel pop gain with resources", () => {
  let panel: ControlPanel;
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.setItem("gamesPlayed", "50");
    panel = document.createElement("control-panel") as ControlPanel;
    panel.uiState = { attackRatio: 0.2 } as UIState;
    panel.eventBus = new EventBus();
  });
  afterEach(() => panel.remove());

  async function run(fed: number, starve: number) {
    panel.game = makeGame(makePlayer(fed, starve));
    document.body.appendChild(panel);
    panel.tick();
    (panel as any)._isVisible = true;
    panel.requestUpdate();
    await panel.updateComplete;
  }

  it("is green and positive when growth wins", async () => {
    await run(1, 0);
    const el = panel.querySelector(".pop-gain")!;
    expect(el.textContent).toMatch(/^\+/);
    expect(el.className).toContain("text-green-400");
    expect(panel.querySelector(".starving-tag")).toBeNull();
  });

  it("is red and negative when starvation exceeds growth, with a tag", async () => {
    await run(0.5, 5);
    const el = panel.querySelector(".pop-gain")!;
    expect(el.textContent).toMatch(/^-/);
    expect(el.className).toContain("text-red-400");
    expect(panel.querySelector(".starving-tag")).not.toBeNull();
  });

  it("smooths the rate: one tick of change does not flip the sign", async () => {
    await run(1, 0);
    panel.game = makeGame(makePlayer(1, 0.5));
    panel.tick();
    (panel as any)._isVisible = true;
    panel.requestUpdate();
    await panel.updateComplete;
    // raw rate is now -4/s, the displayed EMA is still positive
    expect(panel.querySelector(".pop-gain")!.textContent).toMatch(/^\+/);
  });
});

describe("resource chips", () => {
  it("renders an inline SVG icon, not an emoji", () => {
    const host = document.createElement("div");
    render(renderResourceChips(makePlayer(1, 0) as never, "compact"), host);
    expect(host.querySelector(".resource-chip svg")).not.toBeNull();
    expect(host.textContent).not.toContain("🌾");
  });

  it("compact chip shows a starving tag when fed < 0.99", () => {
    const host = document.createElement("div");
    render(renderResourceChips(makePlayer(0.5, 1) as never, "compact"), host);
    expect(host.querySelector(".starving-tag")).not.toBeNull();
    expect(host.querySelector(".resource-chip")?.className).toContain(
      "text-red-400",
    );
  });
});

describe("PlayerInfoOverlay structure", () => {
  it("keeps resource chips out of the fixed-width gold row", () => {
    const src = readFileSync(
      "src/client/hud/layers/PlayerInfoOverlay.ts",
      "utf8",
    );
    const goldRow = src.slice(
      src.indexOf("Left: Gold & Troop bar"),
      src.indexOf("resource-row"),
    );
    expect(goldRow).not.toContain("renderResourceChips");
    expect(src).toContain('class="resource-row flex flex-wrap');
  });
});
