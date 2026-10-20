import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
/**
 * Shared game bootstrap for the full-game perf harnesses: loads the map,
 * builds the engine config, nations and game, and wires a GameRunner.
 * The runner is returned un-initialized so callers can attach profilers
 * before calling runner.init() (which adds the initial executions).
 */
import { GameConfig } from "@openfront/engine-api/Schemas";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Executor } from "@openfront/engine/execution/ExecutionManager";
import { Game } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import { createNationsForGame } from "@openfront/engine/game/NationCreation";
import { GameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { NodeGameMapLoader } from "./NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export interface Bootstrapped {
  config: EngineConfig;
  game: Game;
  runner: GameRunner;
}

export async function bootstrapGame(
  gameConfig: GameConfig,
  gameID: string,
  callBack: (gu: GameUpdateViewData | ErrorUpdate) => void,
): Promise<Bootstrapped> {
  // Mirrors createGameRunner(), but assembled by hand so the caller can
  // attach the execution profiler before GameRunner.init() adds the initial
  // executions (nations, bots, spawn timer, win check).
  const config = new EngineConfig(gameConfig, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    await loadMapFiles(mapLoader, gameConfig.gameMap, gameConfig.gameMapSize),
  );
  const random = new PseudoRandom(simpleHash(gameID));
  const nations = createNationsForGame(
    { gameID, lobbyCreatedAt: 0, config: gameConfig, players: [] },
    terrain.nations,
    terrain.additionalNations,
    0,
    random,
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );
  const runner = new GameRunner(
    game,
    new Executor(game, gameID, undefined),
    callBack,
  );
  return { config, game, runner };
}
