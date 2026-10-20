import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { SpawnExecution } from "@openfront/engine/execution/SpawnExecution";
import { Game, Player } from "@openfront/engine/game/Game";

export function spawn(
  game: Game,
  id: string,
  x: number,
  y: number,
  type: PlayerType = PlayerType.Human,
): Player {
  const info = new PlayerInfo(id, type, null, id);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("test_game", info, game.ref(x, y)));
  return game.player(id);
}

export function run(game: Game, ticks: number): void {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

export function conquerBox(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.isImpassable(t)) p.conquer(t);
    }
  }
}
