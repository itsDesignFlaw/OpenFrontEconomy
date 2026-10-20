/** Fixed indices: stored in snapshots and packed buffers. APPEND ONLY. */
export enum ResourceType {
  Food = 0,
}
export const NUM_RESOURCES = 1;
/** Deterministic evaluation order; a resource another rule consumes comes first. */
export const RESOURCE_EVAL_ORDER: readonly ResourceType[] = [ResourceType.Food];
/** Slug per resource (i18n keys `resource_panel.<slug>`), indexed by ResourceType. */
export const RESOURCE_KEYS: readonly string[] = ["food"];

/** Owned-land classes; indices equal TerrainType.Plains/Highland/Mountain. */
export const NUM_LAND_CLASSES = 3;
/** Mirrors GameMapImpl.terrainType thresholds (10/20) for passable land. */
export function landClassOfMagnitude(m: number): number {
  return m < 10 ? 0 : m < 20 ? 1 : 2;
}

/**
 * Packed worker->main record (Float64), one per player whose economy changed:
 * [smallID, growthMultiplier, shortageMask,
 *  (stock, netPerTick, prodPerTick, consPerTick) x NUM_RESOURCES]
 */
export const RES_PACK_SMALL_ID = 0,
  RES_PACK_GROWTH = 1,
  RES_PACK_SHORTAGE = 2,
  RES_PACK_HEADER = 3;
export const RES_PACK_PER_RESOURCE = 4;
export const RES_FIELD_STOCK = 0,
  RES_FIELD_NET = 1,
  RES_FIELD_PROD = 2,
  RES_FIELD_CONS = 3;
export const RES_PACK_STRIDE =
  RES_PACK_HEADER + RES_PACK_PER_RESOURCE * NUM_RESOURCES;
export function resPackOffset(r: ResourceType, field: number): number {
  return RES_PACK_HEADER + r * RES_PACK_PER_RESOURCE + field;
}
