import {
  RESOURCE_KEYS,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, TemplateResult } from "lit";
import { renderDuration, translateText } from "../Utils";
import { PlayerView } from "../view/PlayerView";

export type ResourceReadoutVariant = "hud" | "compact" | "panel";

const ICONS: readonly string[] = ["🌾"];

/** Small food values (per-second rates, low stocks) keep one decimal; 100 and up use renderNumber. */
export function formatResourceAmount(n: number): string {
  const v = Math.abs(n);
  return v < 99.95 ? v.toFixed(1) : renderNumber(v);
}

function formatRate(perSecond: number): string {
  const sign = perSecond >= 0 ? "+" : "-";
  return `${sign}${formatResourceAmount(perSecond)}/s`;
}

function tooltip(player: PlayerView, r: ResourceType): string {
  const parts = [
    translateText("resource_panel.production", {
      amount: formatResourceAmount(player.resourceProductionPerSecond(r)),
    }),
    translateText("resource_panel.consumption", {
      amount: formatResourceAmount(player.resourceConsumptionPerSecond(r)),
    }),
    translateText("resource_panel.growth", {
      percent: Math.round(player.growthMultiplier() * 100),
    }),
  ];
  const net = player.resourceNetPerSecond(r);
  if (net < 0) {
    parts.push(
      translateText("resource_panel.runway", {
        time: renderDuration(player.resourceStock(r) / -net),
      }),
    );
  }
  return parts.join("\n");
}

/** One chip per enabled resource. Callers gate on config.resourcesEnabled(). */
export function renderResourceChips(
  player: PlayerView,
  variant: ResourceReadoutVariant,
  isEnabled: (r: ResourceType) => boolean = () => true,
): TemplateResult {
  const chips: TemplateResult[] = [];
  for (let r = 0; r < RESOURCE_KEYS.length; r++) {
    if (!isEnabled(r)) continue;
    const short = player.isResourceShort(r);
    const net = player.resourceNetPerSecond(r);
    const color = short
      ? "border-red-500 text-red-400 animate-pulse"
      : net < 0
        ? "border-orange-400 text-orange-400"
        : "border-green-400 text-green-400";
    const size =
      variant === "panel"
        ? "gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 text-white w-35 shrink-0 border-0"
        : variant === "compact"
          ? "gap-1 px-1 py-0.5 text-sm"
          : "gap-1 px-1 py-0.5 text-sm min-w-[4.5rem]";
    const key = RESOURCE_KEYS[r];
    chips.push(html`<div
      class="resource-chip flex items-center justify-center border rounded-md font-bold ${size} ${variant ===
      "panel"
        ? ""
        : color}"
      data-resource=${key}
      data-short=${short ? "true" : "false"}
      title=${tooltip(player, r)}
      translate="no"
    >
      <span>${ICONS[r] ?? ""}</span>
      <span class="tabular-nums"
        >${formatResourceAmount(player.resourceStock(r))}</span
      >
      ${variant === "compact"
        ? ""
        : html`<span
            class="tabular-nums text-xs ${variant === "panel"
              ? net < 0
                ? "text-orange-400"
                : "text-green-400"
              : ""}"
            >${formatRate(net)}</span
          >`}
      ${short
        ? html`<span class="text-xs text-red-400"
            >${translateText("resource_panel.starving")}</span
          >`
        : variant === "panel"
          ? html`<span class="text-zinc-200 whitespace-nowrap"
              >${translateText(`resource_panel.${key}`)}</span
            >`
          : ""}
    </div>`);
  }
  return html`${chips}`;
}
