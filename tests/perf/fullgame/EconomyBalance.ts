import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  HashUpdate,
} from "@openfront/engine-api/game/GameUpdates";
/**
 * Economy balance harness: runs the same seeded game twice (food economy off,
 * then on) and compares population/territory/troop trajectories per player
 * type, plus the food-only resource stats, top players, per-tick timing, and
 * final state hash of each run.
 *
 * Usage:
 *   npm run perf:economy -- [--map world] [--bots 400] [--ticks 6000]
 *                           [--seed perf-default] [--sample 300]
 *
 * Writes the collected data to tests/perf/output/economy-balance-<map>-<seed>.json.
 */
import { ResourceType } from "@openfront/engine-api/game/Resources";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { Game, Player } from "@openfront/engine/game/Game";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { bootstrapGame } from "./Bootstrap";
import { TickStats, TickStatsSummary } from "./Profiler";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MAX_SPAWN_TURNS = 1000;
const PLAYER_TYPES: PlayerType[] = [
  PlayerType.Bot,
  PlayerType.Nation,
  PlayerType.Human,
];

// ── CLI ──

interface Options {
  map: GameMapType;
  bots: number;
  ticks: number;
  seed: string;
  sample: number;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    const available = Object.keys(GameMapType)
      .map((k) => k.toLowerCase())
      .join(", ");
    throw new Error(`unknown map "${name}". Available: ${available}`);
  }
  return GameMapType[key as keyof typeof GameMapType];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    map: GameMapType.World,
    bots: 400,
    ticks: 6000,
    seed: "perf-default",
    sample: 300,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--map":
        opts.map = resolveMap(next());
        break;
      case "--bots":
        opts.bots = parseInt(next(), 10);
        break;
      case "--ticks":
        opts.ticks = parseInt(next(), 10);
        break;
      case "--seed":
        opts.seed = next();
        break;
      case "--sample":
        opts.sample = parseInt(next(), 10);
        if (!(opts.sample > 0)) throw new Error("--sample must be > 0");
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ── Sampling ──

interface TypeSample {
  alive: number;
  meanTroops: number;
  meanTiles: number;
  /** Food only. */
  meanSatiation?: number;
  /** Food only: alive players with shortageMask !== 0. */
  shortageCount?: number;
  /** Food only: sum of troops starved. */
  starved?: number;
}

interface SamplePoint {
  tick: number;
  byType: Record<string, TypeSample>;
}

function takeSample(game: Game, food: boolean): SamplePoint {
  const alive = game.players().filter((p) => p.isAlive());
  const byType: Record<string, TypeSample> = {};
  for (const t of PLAYER_TYPES) {
    const ps = alive.filter((p) => p.type() === t);
    const n = ps.length;
    const mean = (f: (p: Player) => number): number =>
      n === 0 ? 0 : ps.reduce((a, p) => a + f(p), 0) / n;
    const s: TypeSample = {
      alive: n,
      meanTroops: mean((p) => p.troops()),
      meanTiles: mean((p) => p.numTilesOwned()),
    };
    if (food) {
      s.meanSatiation = mean((p) => p.resources().levels[ResourceType.Food]);
      s.shortageCount = ps.filter(
        (p) => p.resources().shortageMask !== 0,
      ).length;
      s.starved = ps.reduce((a, p) => a + p.resources().starved, 0);
    }
    byType[t] = s;
  }
  return { tick: game.ticks(), byType };
}

interface TopPlayer {
  smallID: number;
  type: PlayerType;
  tiles: number;
  troops: number;
  /** null when food is off. */
  starved: number | null;
}

function topPlayers(game: Game, food: boolean): TopPlayer[] {
  return game
    .players()
    .filter((p) => p.isAlive())
    .sort(
      (a, b) =>
        b.numTilesOwned() - a.numTilesOwned() || a.smallID() - b.smallID(),
    )
    .slice(0, 10)
    .map((p) => ({
      smallID: p.smallID(),
      type: p.type(),
      tiles: p.numTilesOwned(),
      troops: p.troops(),
      starved: food ? p.resources().starved : null,
    }));
}

// ── One run ──

interface RunResult {
  food: boolean;
  hash: number | null;
  hashTick: number | null;
  timing: TickStatsSummary;
  samples: SamplePoint[];
  top: TopPlayer[];
}

async function runOnce(opts: Options, food: boolean): Promise<RunResult> {
  const gameConfig: GameConfig = {
    gameMap: opts.map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: opts.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ...(food ? { resources: { food: true } } : {}),
  };

  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;
  const { config, game, runner } = await bootstrapGame(
    gameConfig,
    opts.seed,
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) {
        lastHash = hashes[hashes.length - 1];
      }
    },
  );
  runner.init();

  let turnNumber = 0;
  const runTick = (stats?: TickStats): boolean => {
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });
    const tick = game.ticks();
    const start = performance.now();
    const ok = runner.executeNextTick();
    stats?.record(tick, performance.now() - start);
    return ok && fatalError === undefined;
  };

  while (game.inSpawnPhase()) {
    if (turnNumber >= MAX_SPAWN_TURNS) {
      throw new Error(`spawn phase did not end after ${MAX_SPAWN_TURNS} turns`);
    }
    if (!runTick()) {
      throw new Error(`game errored during spawn phase:\n${fatalError}`);
    }
  }

  const stats = new TickStats();
  const samples: SamplePoint[] = [];
  for (let i = 0; i < opts.ticks; i++) {
    if (!runTick(stats)) {
      throw new Error(`game errored at tick ${game.ticks()}:\n${fatalError}`);
    }
    if ((i + 1) % opts.sample === 0) {
      samples.push(takeSample(game, food));
    }
  }

  return {
    food,
    hash: lastHash ? lastHash.hash : null,
    hashTick: lastHash ? lastHash.tick : null,
    timing: stats.summarize(config.msPerTick()),
    samples,
    top: topPlayers(game, food),
  };
}

// ── Report ──

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, c) => cell.padEnd(widths[c])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w)))]
    .concat(rows.map(line))
    .join("\n");
}

const f1 = (n: number | undefined): string =>
  n === undefined ? "-" : n.toFixed(1);
const f3 = (n: number | undefined): string =>
  n === undefined ? "-" : n.toFixed(3);
const i0 = (n: number | undefined): string =>
  n === undefined ? "-" : String(n);

function printReport(off: RunResult, on: RunResult): void {
  console.log(`\n--- Per-sample, per player type (off vs on) ---`);
  const rows: string[][] = [];
  off.samples.forEach((sOff, idx) => {
    const sOn = on.samples[idx];
    for (const t of PLAYER_TYPES) {
      const a = sOff.byType[t];
      const b = sOn?.byType[t];
      rows.push([
        String(sOff.tick),
        t,
        String(a.alive),
        String(b?.alive ?? "-"),
        f1(a.meanTroops),
        f1(b?.meanTroops),
        f1(a.meanTiles),
        f1(b?.meanTiles),
        f3(b?.meanSatiation),
        i0(b?.shortageCount),
        f1(b?.starved),
      ]);
    }
  });
  console.log(
    table(
      [
        "tick",
        "type",
        "alive off",
        "alive on",
        "troops off",
        "troops on",
        "tiles off",
        "tiles on",
        "satiation on",
        "short on",
        "starved on",
      ],
      rows,
    ),
  );

  for (const run of [off, on]) {
    console.log(
      `\n--- Top 10 players by tiles (food ${run.food ? "on" : "off"}) ---`,
    );
    console.log(
      table(
        ["#", "type", "smallID", "tiles", "troops", "starved"],
        run.top.map((p, i) => [
          String(i + 1),
          p.type,
          String(p.smallID),
          String(p.tiles),
          f1(p.troops),
          p.starved === null ? "-" : f1(p.starved),
        ]),
      ),
    );
  }

  console.log(`\n--- Per-tick wall time (game phase) ---`);
  console.log(
    table(
      ["run", "ticks", "mean ms", "p99 ms", "max ms"],
      [off, on].map((run) => [
        run.food ? "food on" : "food off",
        String(run.timing.count),
        run.timing.meanMs.toFixed(2),
        run.timing.p99Ms.toFixed(2),
        run.timing.maxMs.toFixed(2),
      ]),
    ),
  );

  console.log(`\n--- Final hash ---`);
  for (const run of [off, on]) {
    console.log(
      `food ${run.food ? "on " : "off"}: ${run.hash ?? "n/a"}` +
        (run.hashTick !== null ? ` (tick ${run.hashTick})` : ""),
    );
  }
}

// ── Main ──

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {}; // silence per-tick debug logging

  console.log(
    `Economy balance: map=${opts.map} bots=${opts.bots} seed=${opts.seed} ` +
      `ticks=${opts.ticks} sample=${opts.sample}`,
  );

  console.log(`Running food=off...`);
  const off = await runOnce(opts, false);
  console.log(`Running food=on...`);
  const on = await runOnce(opts, true);

  printReport(off, on);

  const outDir = path.join(PROJECT_ROOT, "tests/perf/output");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `economy-balance-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.json`,
  );
  fs.writeFileSync(
    outFile,
    JSON.stringify({ options: opts, off, on }, null, 2),
  );
  console.log(`\nData written to ${path.relative(PROJECT_ROOT, outFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
