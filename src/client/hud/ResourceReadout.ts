import {
  RESOURCE_KEYS,
  ResourceType,
} from "@openfront/engine-api/game/Resources";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, TemplateResult } from "lit";
import { renderDuration, translateText } from "../Utils";
import { PlayerView } from "../view/PlayerView";

export type ResourceReadoutVariant = "hud" | "compact" | "panel";

/** Fed fraction below this counts as starving in the HUD. */
export const STARVING_FED = 0.99;

export function isStarving(player: PlayerView): boolean {
  return player.resourceFed() < STARVING_FED;
}

/** Per-resource icon, keyed by ResourceType; inline SVG so it needs no emoji font. */
const RESOURCE_ICONS: Record<number, TemplateResult> = {
  0: html`<svg
    class="resource-icon shrink-0 w-4 h-4"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M12 23V8"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      fill="none"
    />
    <ellipse cx="12" cy="3.8" rx="2" ry="3.2" fill="currentColor" />
    <ellipse
      cx="7.6"
      cy="9"
      rx="2"
      ry="3.4"
      transform="rotate(-35 7.6 9)"
      fill="currentColor"
    />
    <ellipse
      cx="16.4"
      cy="9"
      rx="2"
      ry="3.4"
      transform="rotate(35 16.4 9)"
      fill="currentColor"
    />
    <ellipse
      cx="7.6"
      cy="15"
      rx="2"
      ry="3.4"
      transform="rotate(-35 7.6 15)"
      fill="currentColor"
    />
    <ellipse
      cx="16.4"
      cy="15"
      rx="2"
      ry="3.4"
      transform="rotate(35 16.4 15)"
      fill="currentColor"
    />
  </svg>`,
};

export function renderResourceIcon(r: ResourceType): TemplateResult {
  return RESOURCE_ICONS[r] ?? html``;
}

export function renderStarvingTag(): TemplateResult {
  return html`<span
    class="starving-tag text-[10px] leading-none font-bold uppercase text-red-400 whitespace-nowrap"
    >${translateText("resource_panel.starving")}</span
  >`;
}

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
    const short = player.isResourceShort(r) || isStarving(player);
    const net = player.resourceNetPerSecond(r);
    const color = short
      ? "border-red-500 text-red-400 animate-pulse"
      : net < 0
        ? "border-orange-400 text-orange-400"
        : variant === "compact"
          ? "border-white/40 text-white"
          : "border-green-400 text-green-400";
    const size =
      variant === "panel"
        ? "gap-1.5 rounded-lg bg-white/4 px-3 py-1.5 text-white w-35 shrink-0 border-0"
        : variant === "compact"
          ? "gap-1 px-1 py-0.5 text-sm min-w-0 max-w-full"
          : "gap-1 px-1 py-0.5 text-sm min-w-[5.5rem] shrink-0";
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
      ${renderResourceIcon(r)}
      <span class="tabular-nums"
        >${formatResourceAmount(player.resourceStock(r))}</span
      >
      ${variant === "hud" || variant === "panel"
        ? html`<span
            class="tabular-nums text-xs ${variant === "panel"
              ? net < 0
                ? "text-orange-400"
                : "text-green-400"
              : ""}"
            >${formatRate(net)}</span
          >`
        : ""}
      ${short
        ? variant === "hud"
          ? ""
          : renderStarvingTag()
        : variant === "panel"
          ? html`<span class="text-zinc-200 whitespace-nowrap"
              >${translateText(`resource_panel.${key}`)}</span
            >`
          : ""}
    </div>`);
  }
  return html`${chips}`;
}
