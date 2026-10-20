# Plan: a generic multi-resource economy, starting with food

## 0. Decisions (settled with the user; these override anything below)
1. **No base food production.** `baseProductionPerTick` stays 0. Small players rely on the starting stockpile; balance is tuned later from the comparison harness.
2. **All resources transfer on elimination.** In `GameImpl.conquerPlayer` (~1560–1612, next to the gold capture), when gold transfers (same `skipGoldTransfer` rule), move every resource stockpile from the conquered player to the conqueror, generically over `NUM_RESOURCES`, mark both `dirty`, and only when the economy is on. Owned by A1. Test: eliminate a player with stock → conqueror gains exactly that stock; off → no change; hash unaffected when off.
3. **No replay UI for now.** `packedResourceUpdates` is routed as `"dropped"` in `FrameNormalizer.ts`.
4. **The toggle stays and is fully integrated**: engine flag, lobby switches in SinglePlayerModal and HostLobbyModal, the lobby settings summary, the server `ConfigPatch.ts` allowlist, and translations. Off by default.
5. **Execution changes by the orchestrator:**
   - B2 (lobby toggles) is merged into B1, which now owns SinglePlayerModal.ts, HostLobbyModal.ts and LobbySettingsSummary.ts too.
   - Each Wave 1 agent works in its own git worktree, branched from the committed Wave 0 checkpoint on the feature branch; the orchestrator merges them. File ownership stays strict so merges are trivial.
   - The orchestrator (main session) acts as the Wave 3 verifier.
6. **Bot food behavior is nations only, and only when hungry**: a hunger-scaled preference for fertile targets, lower save-up thresholds under pressure (spend troops rather than let them starve), and no cities at pressure ≥ 0.25. No forage strategy, no cap on troops sent away, nothing for tribes. Details in task C.

## 1. What I found in the code that changes or sharpens the design

1. **No hooks are needed for fallout or water.**
   - `GameImpl.setFallout` (GameImpl.ts:283) throws on owned tiles, and `conquer` clears fallout (`_map.setFallout(tile,false)`, ~834).
   - `GameImpl.setWater` (295) throws on owned tiles. The water-conversion loop in `WaterManager.tick` (~153–163) skips owned tiles.
   - `setMagnitude` is only called on water tiles (`WaterManager` ~873–881).
   - Doomsday rot calls `relinquish` before `setFallout` (DoomsdayClockExecution.ts:361).
   - So an owned tile never has fallout and its terrain class can't change while owned. Per-player terrain counts only need updating in `conquer` (814) and `relinquish` (838).
   - "Fallout produces 0" holds automatically. We add invariant tests instead of hooks.
   - The only other place that writes owners is snapshot restore (GameSnapshot.ts:405), so the counts go into the snapshot.
2. **Gate the counting on the toggle.** It costs one branch per conquer, nothing when off, and stays exactly correct.
   - The Player snapshot migration from v1 to v2 can then fill zero counts. That is correct because old snapshots predate the toggle.
   - Ungated counting would go negative in restored old games.
   - The hot-path cost when on: `landClassOfMagnitude(this._map.magnitude(tile))`, plus one decrement and one increment on an `Int32Array`. `conquer` has already checked the tile is land and passable.
3. **Troops are bigint and get floored.**
   - `PlayerImpl._troops` is bigint, and `addTroops`/`removeTroops` floor through `toInt` (PlayerImpl.ts:1376–1390, Util.ts:232).
   - Starvation therefore needs float carry-over counters (home and away) and removes `Math.floor(acc)` each time.
   - Attack troops are floats (`AttackImpl.setTroops`, `Math.max(0, …)`). Boat troops are on `UnitImpl`, and `setTroops` emits a UnitUpdate each time (UnitImpl.ts:219).
   - So losses for troops that are away are applied only at the once-per-second economy tick, not every tick. This avoids flooding the update stream.
4. **Reading `troopsAway` is cheap.**
   - It is the sum of `player.outgoingAttacks()[i].troops()` plus the troops on the player's `UnitType.TransportShip` units. Iterate `player.units()` with no type filter so nothing is allocated.
   - Attack troops have already been taken out of `player.troops()` (AttackExecution.ts:131–137). Boat landings use `removeTroops=false` with a source tile, and the boat's troops already left at departure. So there is no double counting.
   - We read it once per second per player.
5. **`troopIncreaseRate` can be negative.** Above the cap, `ratio < 0` (Config.ts ~370–400), so troops decay. Satiation must scale only positive growth.
   - The client HUD also calls it (ControlPanel.ts:137, 322), so the rule is shared: `Config.effectiveTroopIncreaseRate(base, mult)`.
6. **The stagger can be stateless.** PlayerExecution's cluster stagger stores `lastCalc` in its snapshot. For the economy, compute `phase = simpleHash(id) % 10` once and keep it in PlayerResources. Then PlayerExecution's snapshot doesn't change; its new `economy` field is a reference taken from `r.game`.
7. **Client player state is tied to the replay codec.**
   - `PlayerState` (render/types/Renderer.ts:61) feeds `EntitySchema.ts` (`PlayerFields = Omit<PlayerState,"smallID">`), so adding fields there means replay codec changes.
   - Instead, resource data goes in a separate `ResourceStore` on `GameView`.
   - `VIEW_DATA_ROUTING` in FrameNormalizer.ts (~96) is checked exhaustively at compile time, so the new buffer field must be routed in the contracts step. Route it as `"dropped"` for v1.
8. **Bots, tribes, nations and humans:**
   - Tribes are `PlayerType.Bot`. They run `TribeExecution` → `AiAttackBehavior`.
   - Nations run `NationExecution` with the same `AiAttackBehavior`, plus the structure, nuke and other behaviors.
   - Humans have no AI.
   - All three run `PlayerExecution`, so the economy covers everyone through one hook.
   - Players with infinite troops (`hasInfiniteTroopsFor`, a 1e9 cap) would starve instantly. They are exempt (level 1, no consumption).
9. **Risks to the hash staying identical with food off:**
   - No new PRNG calls anywhere.
   - Every AI hook is gated on `game.economy() !== null`.
   - `PlayerImpl.hash()` adds the stockpile only when enabled.
   - No new Execution class, so the exec list and order are unchanged.
   - Counting is gated.
   - Satiation multiplies only inside the economy branch.
   - Iteration order is untouched.
10. **Patterns to copy:**
    - Toggle and tunables: Doomsday Clock (`DoomsdayClockConfigSchema` Schemas.ts:215, `DOOMSDAY_CLOCK_DEFAULTS` and `doomsdayClockConfig()` Config.ts:35/113).
    - Packed channel: `playerStatsQuads` → `drainPackedPlayerUpdates` (GameImpl.ts:143/566–583/620) → GameRunner.ts:275–286 → `transfersOf` (Worker.worker.ts ~130) → `applyPackedPlayerStats` (EntityState.ts:208) called at GameView.ts:385.
    - Nested snapshot record: `w.versioned(...)` / `readVersioned(...)` with a `VersionedSchema` field (AiAttackBehavior.ts:102–140, NationExecution.ts:506).
    - Migrations: AiAttackBehavior.ts:2014–2027.
11. **Gotchas outside the engine:**
    - The server's `ConfigPatch.ts` allowlist (~15–35) must include `"resources"`, or host updates are dropped.
    - HostLobbyModal must send an explicit `{food:false}` when off, not undefined; see the comment at ~1685.
    - `tests/EnJsonSorted.test.ts` requires en.json keys sorted at every level.

## 2. Contracts (Wave 0 builds these first)

### 2.1 `packages/engine-api/src/game/Resources.ts` (new; imports only `./GameTypes`)
```ts
/** Fixed indices: stored in snapshots and packed buffers. APPEND ONLY. */
export enum ResourceType { Food = 0 }
export const NUM_RESOURCES = 1;
/** Deterministic evaluation order; a resource another rule consumes comes first. */
export const RESOURCE_EVAL_ORDER: readonly ResourceType[] = [ResourceType.Food];
/** Slug per resource (i18n keys `resource_panel.<slug>`), indexed by ResourceType. */
export const RESOURCE_KEYS: readonly string[] = ["food"];

/** Owned-land classes; indices equal TerrainType.Plains/Highland/Mountain. */
export const NUM_LAND_CLASSES = 3;
/** Mirrors GameMapImpl.terrainType thresholds (10/20) for passable land. */
export function landClassOfMagnitude(m: number): number { return m < 10 ? 0 : m < 20 ? 1 : 2; }

/** Packed worker→main record (Float64), one per player whose economy changed:
 *  [smallID, growthMultiplier, shortageMask, (stock, netPerTick, prodPerTick, consPerTick) × NUM_RESOURCES] */
export const RES_PACK_SMALL_ID = 0, RES_PACK_GROWTH = 1, RES_PACK_SHORTAGE = 2, RES_PACK_HEADER = 3;
export const RES_PACK_PER_RESOURCE = 4;
export const RES_FIELD_STOCK = 0, RES_FIELD_NET = 1, RES_FIELD_PROD = 2, RES_FIELD_CONS = 3;
export const RES_PACK_STRIDE = RES_PACK_HEADER + RES_PACK_PER_RESOURCE * NUM_RESOURCES;
export function resPackOffset(r: ResourceType, field: number): number {
  return RES_PACK_HEADER + r * RES_PACK_PER_RESOURCE + field;
}
```

### 2.2 `packages/engine-api/src/Schemas.ts`
- Next to `OvertimeConfigSchema` (~225), add:
  ```ts
  export const ResourcesConfigSchema = z.object({ food: z.boolean().optional() });
  ```
- In `GameConfigSchema`, add `resources: ResourcesConfigSchema.optional(),` right after `overtime` (~268).
- New resources append fields to `ResourcesConfigSchema`. That is safe because all peers run the same build (zbin README).

### 2.3 `packages/engine-api/src/game/GameUpdates.ts`
After `packedAttackUpdates` (~59), add `packedResourceUpdates?: Float64Array;`. Its doc comment refers to the layout in Resources.ts and says it is sent at economy cadence and absent when the economy is off.

### 2.4 `packages/engine-lib/src/configuration/Config.ts`
- Next to `OVERTIME_DEFAULTS` (~81), add the tuning types and defaults:
  ```ts
  export interface FoodTuning {
    productionPerTile: readonly number[]; // per tick, by land class: [plains, highland, mountain]
    baseProductionPerTick: number;        // flat per player
    needPerTroopPerTick: number;          // c
    awayNeedMultiplier: number;           // 3
    satiationMin: number; satiationMax: number;       // 0.5 / 1.5
    satiationApproachPerSecond: number;   // share of the gap to target closed per second
    startingStockpileSeconds: number;     // seconds of base need at start troops
    starvationLossPerSecond: number;      // share of unfed troops lost per second
  }
  export const ECONOMY_INTERVAL_TICKS = 10;
  const FOOD_DEFAULTS: FoodTuning = { productionPerTile: [7, 3, 1], baseProductionPerTick: 0,
    needPerTroopPerTick: 0.02, awayNeedMultiplier: 3, satiationMin: 0.5, satiationMax: 1.5,
    satiationApproachPerSecond: 0.2, startingStockpileSeconds: 180, starvationLossPerSecond: 0.02 };
  ```
- New methods on `Config`:
  ```ts
  resourcesEnabled(): boolean;                 // any resource on
  isResourceEnabled(r: ResourceType): boolean; // Food ← gameConfig.resources?.food ?? false
  foodTuning(): FoodTuning;                    // returns the frozen FOOD_DEFAULTS
  economyIntervalTicks(): number;              // ECONOMY_INTERVAL_TICKS
  effectiveTroopIncreaseRate(base: number, growthMultiplier: number): number {
    return base > 0 ? base * growthMultiplier : base;
  }
  ```

### 2.5 `packages/engine/src/game/economy/PlayerResources.ts` (new; Wave 0 writes the full data class and its snapshot)
```ts
export class PlayerResources {
  terrainCounts: Int32Array;   // [NUM_LAND_CLASSES]
  stock: Float64Array;         // [NUM_RESOURCES]
  net: Float64Array;           // per tick, applied every tick
  production: Float64Array;    // per tick (UI/AI)
  consumption: Float64Array;   // per tick (UI/AI)
  levels: Float64Array;        // per-resource smoothed level (food = satiation), init 1
  growthMultiplier: number;    // product of rules' growth factors, init 1
  shortageMask: number;        // bit r = resource r stock empty and unmet
  homeShare: number;           // home/(home + 3·away), split of losses
  unfedPerUnit: Float64Array;  // troops unfed per unit of unmet resource
  lossAccHome: number; lossAccAway: number; // fractional troop losses not yet removed
  starved: number;             // total troops lost to shortage (stats/harness)
  phase: number;               // simpleHash(id) % ECONOMY_INTERVAL_TICKS
  dirty: boolean;              // emit a packed record this tick (derived; NOT snapshotted)
  constructor(phase: number, startingStock: number[] | null);
  stockOf(r): number; netOf(r): number; isShort(r): boolean;
  runwaySeconds(r: ResourceType, ticksPerSecond: number): number; // Infinity if net >= 0
  snapshot(w: SnapshotWriter): Versioned;
  restoreSnapshot(raw: unknown, r: SnapshotReader): void; // assign-only; typed arrays rebuilt
}
export const PlayerResourcesSnapshot = snapshotType({ name: "PlayerResources", version: 1,
  schema: z.object({ terrainCounts: z.array(zInt()), stock: z.array(zNum()), net: z.array(zNum()),
    production: z.array(zNum()), consumption: z.array(zNum()), levels: z.array(zNum()),
    unfedPerUnit: z.array(zNum()), growthMultiplier: zNum(), shortageMask: zInt(), homeShare: zNum(),
    lossAccHome: zNum(), lossAccAway: zNum(), starved: zNum(), phase: zInt() }) });
export function defaultPlayerResourcesData(phase = 0) { /* zeros, levels=1, growth=1, homeShare=1 */ }
```
Add `"dirty"` to `DERIVED_FIELDS` in tests/util/Snapshot.ts:133.

### 2.6 `packages/engine/src/game/economy/EconomySystem.ts` (Wave 0 writes the signatures as stubs; A2 fills the bodies)
```ts
export interface EconomyContext { player: Player; troopsHome: number; troopsAway: number;
  intervalSeconds: number; growthMultiplier: number /* rules multiply in */ }
export interface ResourceRule {
  readonly type: ResourceType;
  evaluate(ctx: EconomyContext, res: PlayerResources): void;   // fills production/consumption/net/levels/unfedPerUnit[type]
  shortageTroopLoss(res: PlayerResources, unmet: number): number; // troops lost this tick
}
export class EconomySystem {
  constructor(config: EngineConfig);                  // builds enabled rules in RESOURCE_EVAL_ORDER, caches tuning
  readonly intervalTicks: number;
  /** PlayerExecution, every tick after troop growth: evaluate if (ticks + phase) % interval === 0, then apply. */
  tickPlayer(player: Player, ticks: number): void;
  startingStockpile(startTroops: number): number[];   // per resource
}
```

### 2.7 `Game.ts`, `GameImpl.ts`, `PlayerImpl.ts` (Wave 0 wiring)
- **`Game` interface:** add `economy(): EconomySystem | null` and `drainPackedResourceUpdates(): Float64Array | null`.
- **`Player` interface:** add `resources(): PlayerResources` and `packResources(out: number[]): void`.
- **`GameImpl` constructor (~185):** add `this._economy = _config.resourcesEnabled() ? new EconomySystem(_config) : null;`. It must come **before** `addPlayers()`. Also add a `private readonly _resourcesOn = this._economy !== null` gate.
- **`PlayerImpl`:**
  - Field `_resources: PlayerResources`.
  - In the constructor (~217): `new PlayerResources(simpleHash(id) % ECONOMY_INTERVAL_TICKS, mg.economy()?.startingStockpile(startTroops) ?? null)`.
  - Accessor `resources()`.
- **Snapshot:** bump `PlayerSnapshot` to version 2 and add a `resources: VersionedSchema` field. Migration: `1: (d) => ({ ...d, resources: { v: 1, d: defaultPlayerResourcesData() } })`.
  - Write: `resources: this._resources.snapshot(w)`.
  - Restore: `const pr = Object.create(PlayerResources.prototype); pr.restoreSnapshot(s.resources, r); this._resources = pr;`.

### 2.8 en.json keys (all added in Wave 0, kept sorted)
- `game_settings.food`: "Food economy (experimental)"
- New top-level section `resource_panel`:
  - `consumption`: "Consumption: {amount}/s"
  - `deficit`: "Deficit"
  - `food`: "Food"
  - `growth`: "Troop growth: {percent}%"
  - `production`: "Production: {amount}/s"
  - `runway`: "Runs out in {time}"
  - `starved_total`: "Lost to starvation: {troops}"
  - `starving`: "Starving"
  - `starving_warning`: "Your troops are starving! Take farmland or recall attacks."
  - `surplus`: "Surplus"

## 3. Engine rules (what A2 implements)

**Economy tick** (`FoodRule.evaluate`, once per second per player). T = `foodTuning()`. The approach factor k is precomputed in the constructor:
```
k = 1 - pow(1 - T.satiationApproachPerSecond, intervalSeconds)   // DetMath.pow
```
Each economy tick:
```
prod   = T.base + Σ terrainCounts[c] * T.productionPerTile[c]
if infinite-troops human: level=1, consumption=0, net=prod, unfedPerUnit=0
need   = c * (home + 3*away)
target = need > 0 ? clamp(prod/need, 0.5, 1.5) : 1.5
level += (target - level) * k
cons   = need * level
net    = prod - cons
ctx.growthMultiplier *= level
unfedPerUnit = need > 0 ? 1 / (c * level) : 0
homeShare    = (home + 3*away) > 0 ? home / (home + 3*away) : 1
```

**Every tick** (`applyTick`):
- For each r in eval order: `stock += net`.
  - If `stock < 0`: `unmet = -stock`, `stock = 0`, set shortage bit r. Then `loss = unmet * unfedPerUnit * starvationLossPerSecond / 10`, `lossAccHome += loss*homeShare`, `lossAccAway += loss*(1-homeShare)`.
  - If the shortage bit is set and `stock > 0`, clear it.
  - Any change to the shortage bits sets `dirty`.
- If `lossAccHome >= 1`: remove `floor` of it with `removeTroops`, add the removed amount to `starved`, keep the remainder.

**At each economy tick, before evaluating:**
- Spread `floor(lossAccAway)` over the outgoing attacks, then the boats, in proportion to their troops and in array order (deterministic).
- Boats never go below 1 troop.
- Set `dirty = true`.

Splitting by consumption share is what makes away troops lose 3x per head.

**PlayerExecution changes** (around lines 127–130):
```ts
const troopInc = this.config.troopIncreaseRate(this.player);
this.player.addTroops(this.economy === null ? troopInc
  : this.config.effectiveTroopIncreaseRate(troopInc, this.player.resources().growthMultiplier));
// …after alliances/embargoes:
if (this.economy !== null) this.economy.tickPlayer(this.player, ticks);
```
`economy` is set in `init`. In `restoreSnapshot`: `this.economy = s.initialized ? r.game.economy() : null`. No snapshot version bump.

**Hash:** in `PlayerImpl.hash()`, add `+ Math.floor(totalStock)` only when `mg.economy() !== null`.

## 4. Work breakdown

### Wave 0: contracts (sequential, 1 agent; must leave the tree green)
- **Files:**
  - `engine-api/game/Resources.ts` (new)
  - `Schemas.ts`
  - `GameUpdates.ts`
  - `engine-lib/configuration/Config.ts`
  - `engine/game/economy/PlayerResources.ts` (new, complete with snapshot)
  - `engine/game/economy/EconomySystem.ts` (new, stub bodies)
  - `engine/game/Game.ts`
  - `GameImpl.ts`: constructor wiring, `economy()`, `drainPackedResourceUpdates()` stub returning null
  - `PlayerImpl.ts`: field, accessor, `packResources` no-op, snapshot v2 and migration
  - `src/client/replay/codec/FrameNormalizer.ts`: `packedResourceUpdates: "dropped"`
  - `src/server/ConfigPatch.ts`: `"resources"` in the allowlist
  - `resources/lang/en.json`
  - `tests/util/Snapshot.ts`: add `"dirty"`
- **Tests:**
  - `tests/economy/ResourcesContract.test.ts`: `landClassOfMagnitude(m)` equals `GameMapImpl.terrainType` for every passable magnitude 0–30; stride math; `Config.isResourceEnabled` defaults to false; `effectiveTroopIncreaseRate` leaves negative values alone.
  - Update `tests/server/ConfigPatch.test.ts` if it lists keys.
- **Acceptance:** `npm run typecheck`, `npx vitest tests/core/snapshot tests/EnJsonSorted.test.ts tests/LayerBoundaries.test.ts --run`, and `npm run perf:game -- --map world --bots 400 --ticks 3000 --no-cpu-profile --no-gc-profile --no-alloc-profile` still prints hash **28538223276437444**. Commit as a checkpoint.

### Wave 1 (5 agents in parallel, strict file ownership)

**A1: storage, counts, emission and hash (engine; owns GameImpl.ts, PlayerImpl.ts, GameRunner.ts, Worker.worker.ts, PlayerResources.ts)**
- `GameImpl.conquer`: right after the `isImpassable` throw, add
  ```ts
  if (this._resourcesOn) {
    const cls = landClassOfMagnitude(this._map.magnitude(tile));
    if (previousOwner.isPlayer()) previousOwner._resources.terrainCounts[cls]--;
    owner._resources.terrainCounts[cls]++;
  }
  ```
  Do the same in `relinquish`.
- In the `executeNextTick` player loop (~566–583), after `toUpdate`: `if (this._economy !== null) player.packResources(this.resourceRecords);`.
- Add `drainPackedResourceUpdates()` mirroring `drainPackedPlayerUpdates`, and add `resourceRecords` to `DERIVED_FIELDS`.
- `PlayerImpl.packResources`: if dirty, push `RES_PACK_STRIDE` numbers, then clear dirty.
- Add the stockpile to `hash()` as described above.
- GameRunner.ts (~275): drain, then spread `...(packedResourceUpdates ? { packedResourceUpdates } : {})`.
- Worker.worker.ts `transfersOf`: push the buffer.
- **Tests:**
  - `tests/economy/TerrainCounts.test.ts` on the `world` map: random conquer, relinquish and `conquerPlayer`; counts equal a full scan of `_tiles`; counts stay zero when off.
  - Invariant test: an owned tile never `hasFallout`; nuke and water conversion on owned tiles leave the counts consistent.
  - `tests/economy/PackedResourceUpdates.test.ts`: absent when off; stride; each player emits once per 10 ticks after spawn ends.
  - `tests/core/snapshot/EconomySnapshot.test.ts`: `expectSnapshotRoundTrip` with food on, including mid-starvation; existing fixtures load through the v1→v2 migration.

**A2: economy rules (engine; owns `economy/EconomySystem.ts`, new `economy/FoodRule.ts`, PlayerExecution.ts)**
- Implement section 3. Cache the tuning in the constructor. No allocation in `tickPlayer`.
- **Tests (`tests/economy/FoodEconomy.test.ts`, using `setup()` with `{ resources: { food: true } }`):**
  - production formula, by setting `terrainCounts` or conquering tiles;
  - need includes 3x away troops (real `AttackExecution` and a transport boat);
  - satiation converges to the clamped target, and the per-second rate gives the same result at the interval;
  - surplus accumulates and deficit drains;
  - no troop loss while stock > 0;
  - starvation is proportional, and away troops lose 3x per head;
  - growth is halved at level 0.5, and negative growth over the cap is unchanged;
  - infinite-troops players are exempt;
  - the stagger runs exactly once per 10 ticks per player;
  - two identical games give the same hash.

**B1: client view layer and HUD (Sonnet; owns GameView.ts, PlayerView.ts, new view/ResourceStore.ts, new hud/ResourceReadout.ts, ControlPanel.ts, PlayerPanel.ts, PlayerInfoOverlay.ts)**
- **`ResourceStore`** (keyed by smallID, `Float64Array` of stride width):
  - `apply(packed, tick)`;
  - `stock(smallID, r, atTick)`: `max(0, stock + net*(atTick - sampleTick))`;
  - `netPerSecond`, `productionPerSecond`, `consumptionPerSecond`;
  - `growthMultiplier` (default 1), `isShort`, `has`.
- `GameView.update` (~385): call `this.resources.apply(gu.packedResourceUpdates, gu.tick)`.
- PlayerView accessors: `resourceStock(r)`, `resourceNetPerSecond(r)`, `isResourceShort(r)`, `growthMultiplier()`.
- **`ResourceReadout`**: Lit render helpers that loop over `RESOURCE_KEYS`, with variants `hud`, `compact` and `panel`.
  - Each chip shows an icon (wheat emoji, matching PlayerPanel's emoji icons), the stock (`renderNumber`) and the net rate per second.
  - Colours: green for surplus, orange for deficit, red pulse plus `resource_panel.starving` when short.
  - The `title` tooltip shows production, consumption, growth % and runway.
- **ControlPanel:**
  - Add a chip row between rows 1 and 2 in `renderDesktop` (~477) and in the mobile view.
  - Render it only if `config.resourcesEnabled()`.
  - `troopRate` (~137) and `updateTroopIncrease` (~322) use `config.effectiveTroopIncreaseRate(base, player.growthMultiplier())`.
- PlayerPanel `renderResources` (679): add a third pill. PlayerInfoOverlay (~642, the gold row): add a compact chip.
- **Tests:** `tests/client/view/ResourceStore.test.ts` (interpolation, clamping, unknown player); a GameView test that the packed record is applied; a jsdom test that the ControlPanel chip appears only when enabled and shows the starving state.

**B2: lobby toggles (Haiku or Sonnet; owns SinglePlayerModal.ts, HostLobbyModal.ts, LobbySettingsSummary.ts)**
- **SinglePlayerModal:**
  - `DEFAULT_OPTIONS.food=false` (~120), plus `@state food` (~209);
  - a toggle `{labelKey:"game_settings.food", checked}` after doomsday (~553);
  - a `case` in the toggle handler (~796), reset (~698) and the non-default check (~622);
  - in the start config (~1181): `...(this.food ? { resources: { food: true } } : {})`.
- **HostLobbyModal:**
  - state (~97), toggle (~709), handler with `putGameConfig()` (~1150), reset (~1038);
  - `putGameConfig` (~1682) sends `resources: { food: this.food }`, always explicit.
- LobbySettingsSummary (~125): `if (c.resources?.food)` → `game_settings.food` / enabled.
- **Tests:** extend the existing lobby summary and modal tests if present. Otherwise add a small jsdom test that the config contains `resources.food`.

**C: bots (Opus; owns new execution/utils/ResourceAdvisor.ts, AiAttackBehavior.ts, NationUtils.ts, NationStructureBehavior.ts)**

Intent (settled with the user): a well-fed nation plays exactly as today. Hunger makes a nation "go take food": seek fertile targets, spend troops before they starve, and stop building cities. **Nations only. Tribes (`PlayerType.Bot`) get no food behavior at all**: every hook below also checks `player.type() === PlayerType.Nation`, because tribes share parts of `AiAttackBehavior` (e.g. `calculateAttackTroops`, called from `TribeExecution` via `sendAttack`). No forage strategy, no cap on troops sent away, no behavior around unclaimed land, no deliberate troop shedding.

- **`ResourceAdvisor`** (pure functions; each returns the neutral value when `game.economy() === null`):
  - `resourcePressure(game, p)` in [0, 1]: the maximum over enabled resources. 1 if short; 0 if net ≥ 0; otherwise `clamp(1 - runway/120s)`. Pressure is exactly 0 while production covers need, so every hook is a no-op for a fed nation.
  - `resourceValuePerTile(game, target)`: Σ_r production[r] / tiles (other players' resources are public state; humans see them in the player panel). Terra nullius → 0.
- **Hooks**, all behind `if (this.game.economy() !== null)` plus the Nation check, with no snapshot change. When food is off they must not add, remove or reorder any PRNG call (hash invariant). When food is on, changing which branches run (and so which PRNG calls happen) is fine.
  - (a) **Hunger-seeking targets.** `findJuiciestTarget(game, candidates, extraScore?)` gets an optional extra score term. `findJuicyTarget` (~1013) passes `p => pressure * normalized(resourceValuePerTile(p))`. With pressure 0 the term is 0, so a fed nation's choice is unchanged.
  - (b) **Use troops before they starve.** In the attack decision (~405–421), scale the save-up thresholds down under pressure: the reserve ratio (`hasReserveRatioTroops`) and trigger ratio (`hasTriggerRatioTroops`) are multiplied by `1 - k * pressure` (k a tunable in `foodTuning()`-adjacent AI constants, e.g. 0.5), so a starving nation attacks sooner instead of holding troops that will starve anyway. Do not cap troops sent away.
  - (c) **No cities when hungry.** `NationStructureBehavior` city spawn (~717): skip `City` while pressure ≥ **0.25**. Cities add 250k troops that eat and produce no food, so they are dangerous for a hungry nation.
- **Tests:** `tests/NationFoodBehavior.test.ts`:
  - fed nation (pressure 0): same target choice and same attack decisions as with food off;
  - hungry nation prefers the more fertile of two otherwise equal targets;
  - hungry nation attacks at a lower troop ratio than a fed one;
  - pressure ≥ 0.25 blocks city builds, below it does not;
  - tribes behave identically with food on and off (given equal troop counts).
  Code and the unit tests that set `PlayerResources` fields directly can run in Wave 1. Tests that need the real economy wait for A2.

**D: harnesses (Sonnet; owns FullGamePerf.ts, new tests/perf/fullgame/EconomyBalance.ts, package.json scripts)**
- FullGamePerf `parseArgs` (~185): add `--food`, which sets `resources: { food: true }` in `gameConfig` (~223).
- **`EconomyBalance.ts`** (`npm run perf:economy -- --map world --bots 400 --ticks 6000 --seed perf-default --sample 300`):
  - Run food off and on, same seed, in sequence.
  - At every sample, per PlayerType: alive count, mean and total troops, mean tiles, mean satiation, number short, total starved.
  - At the end: top 10 by tiles (type, tiles, troops, starved), the winner if any, the final hash, and mean/p99/max ms per tick.
  - Print the two runs side by side and write JSON to `tests/perf/output/`.
  - Copy FullGamePerf's bootstrap (~254–300), or factor it into `Bootstrap.ts` (D owns both).

### Wave 2
- C finishes its integration tests against the real economy.
- D runs both harnesses and reports.
- A1 and A2 fix anything that turns up.

### Wave 3: integration and verification (1 Opus agent, or the orchestrator)
1. `npm run typecheck && npm run lint && npm test` (covers LayerBoundaries, EnJsonSorted and the snapshot fixtures).
2. `npm run perf:game -- --map world --bots 400 --ticks 3000`: the hash must be exactly **28538223276437444**.
3. The same command with `--food`, run twice:
   - identical hashes across the two runs;
   - mean tick time within about 1% of 5.2 ms;
   - p99 and max no worse than baseline beyond noise;
   - compare PlayerExecution µs per player-tick against the 3.7 baseline.
4. `npm run perf:economy …`: summarize the curves for you.
5. Smoke test with the run-openfront skill: a singleplayer game with Food on. Check the HUD chip, troop rate, another player's panel, and the starving state (spam cities with infinite gold).
6. Optionally run `/code-review high` on the diff.

**Files touched by more than one task, and who owns them:**
- Wave 0 is the only task that edits `Config.ts`, `Game.ts`, `Schemas.ts`, `GameUpdates.ts`, `Resources.ts`, `en.json`, `ConfigPatch.ts` and `FrameNormalizer.ts`. After Wave 0: A2 owns `Config.ts` tuning changes, B1 owns any en.json additions, and A1 owns `Game.ts`.
- `GameImpl.ts`, `PlayerImpl.ts` and `PlayerResources.ts` belong to A1 after Wave 0. A2 never edits them; if it needs a new field, it asks the orchestrator.
- `EconomySystem.ts` belongs to A2.
- `tests/util/Snapshot.ts` belongs to A1.

All agents share one working tree. Each runs only its own vitest files plus `npm run typecheck`. The full `npm test` waits for Wave 3.

## 5. Subagent roster
| Agent | Model | Receives | Order |
|---|---|---|---|
| W0 Contracts | Opus | CLAUDE.md, sections 1, 2 and 4 (Wave 0), snapshot README | first, alone |
| A1 Storage, counts, emission | Opus | CLAUDE.md, sections 1–3, A1 task, ownership list, hash requirement | Wave 1 |
| A2 Economy rules | Opus | the same, plus the A2 task | Wave 1 |
| B1 Client HUD | Sonnet | CLAUDE.md (i18n, Lit, homepage rules), sections 2.1–2.3 and 2.8, B1 task | Wave 1 |
| B2 Lobby toggles | Haiku or Sonnet | CLAUDE.md, 2.2, 2.8, B2 task, the doomsday wiring line numbers | Wave 1 |
| C Bots | Opus | CLAUDE.md, sections 1, 2.5–2.6, 3, C task, the hash gating rule | Wave 1 (code), Wave 2 (tests) |
| D Harnesses | Sonnet | sections 2.2 and 2.5, D task | Wave 1 (code), Wave 2 (runs) |
| V Verifier | Opus | the whole plan, baseline numbers | Wave 3 |

## 6. Risks and how to handle them
- **Hash drift with food off.** Every engine and AI path is behind `economy !== null` or `_resourcesOn`, with no RNG calls added. V checks the hash. Each Wave 1 engine agent also runs the perf hash check before handing off.
- **Spikes in the conquer path.** One gated branch plus a typed-array update. Watch the max-tick number.
- **Update spam from boat and attack `setTroops`.** Losses for away troops are applied only once per second.
- **The balance problem in open question 1.**
- **Replays.** The buffer is routed as `"dropped"`, so replays show no food UI (the UI hides when the store is empty). Recording it can come later.
- **Snapshot compatibility.** Player v2 migration plus the existing fixtures test. PlayerExecution's snapshot doesn't change.
- **Starved boats.** Clamping boats to at least 1 troop avoids a landing with zero troops.

## 7. Open questions
All resolved; see section 0.

### Critical Files for Implementation
- /home/itsco/openfronteconomy/packages/engine/src/game/GameImpl.ts
- /home/itsco/openfronteconomy/packages/engine/src/game/PlayerImpl.ts
- /home/itsco/openfronteconomy/packages/engine/src/execution/PlayerExecution.ts
- /home/itsco/openfronteconomy/packages/engine-lib/src/configuration/Config.ts
- /home/itsco/openfronteconomy/packages/engine/src/execution/utils/AiAttackBehavior.ts