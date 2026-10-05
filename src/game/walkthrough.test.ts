import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { applyCommand } from "./engine.ts";
import { ensureState } from "./facts.ts";
import { playInput, type HarnessIo } from "./harness.ts";
import type { ItemDef, NpcScript, NpcState, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function load() {
  const root = join(process.cwd(), "public", "ash");
  const index = readJson<{ start: string; rooms: string[]; npcs: string[] }>(
    join(root, "index.json"),
  );
  const items = readJson<ItemDef[]>(join(root, "items.json"));
  const rooms = index.rooms.map((id) => readJson<RoomDef>(join(root, "rooms", `${id}.json`)));
  const scripts = index.npcs.map((id) =>
    readJson<NpcScript>(join(root, "npcs", id, "script.json")),
  );
  const states = index.npcs.map((id) =>
    readJson<NpcState>(join(root, "npcs", id, "state.json")),
  );
  const diskRooms = readdirSync(join(root, "rooms")).filter((name) => name.endsWith(".json"));
  assert.equal(diskRooms.length, 21);
  assert.equal(rooms.length, 21);
  for (const id of index.npcs) {
    assert.ok(readdirSync(join(root, "npcs", id)).includes("script.json"));
    assert.ok(readdirSync(join(root, "npcs", id)).includes("state.json"));
  }
  return createWorld(rooms, scripts, states, items, index.start);
}

test("cartridge loads a connected twenty-one-room maze", () => {
  const world = load();
  assert.equal(Object.keys(world.rooms).length, 21);
  assert.equal(world.rooms["spire-core"].win, true);
  const seen = new Set<string>();
  const queue = [world.start];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of Object.values(world.rooms[id].exits)) {
      if (next) queue.push(next);
    }
  }
  assert.equal(seen.size, 21);
  assert.equal(world.rooms["lantern-market"].exits.west, "glass-booth");
  assert.equal(world.rooms["glass-booth"].exits.east, "lantern-market");
  assert.deepEqual(world.npcs["madam-wick"].state.inventory, ["crystal-ball"]);
  assert.equal(world.items["crystal-ball"].kind, "oracle");
});

const offline: Partial<HarnessIo> = {
  interpret: async () => {
    throw new Error("slash commands do not need the model");
  },
  role: async () => null,
  memory: async () => "",
  voice: async (_world, _state, ask) => ({ say: ask.beats.map((beat) => beat.gist).join(" "), met: [] }),
};

test("pacifist route reaches the spire", async () => {
  const world = load();
  let state = initialState(world);
  const commands = [
    "take cable",
    "talk coil about ash",
    "tell coil a story",
    "give stim to coil",
    "n",
    "sell cable",
    "buy breather",
    "n",
    "listen",
    "s",
    "e",
    "n",
    "take lens",
    "take slag",
    "take filter",
    "s",
    "w",
    "sell slag",
    "buy knife",
    "e",
    "n",
    "e",
    "listen",
    "e",
    "say cinder",
    "e",
    "talk ash",
    "w",
    "w",
    "w",
    "s",
    "w",
    "s",
    "e",
    "e",
    "say coil sent me",
    "s",
    "search",
    "e",
    "e",
    "sell lens",
    "buy wafer",
    "w",
    "give knife to razor",
    "s",
    "s",
    "say ash",
    "s",
  ];
  for (const command of commands) {
    const result = await playInput(world, state, `/${command}`, undefined, offline);
    state = result.state;
    if (state.mode === "dead") {
      assert.fail(`died on "${command}": ${result.lines.map((l) => l.text).join(" | ")}`);
    }
  }
  assert.equal(state.mode, "won");
  assert.equal(state.roomId, "spire-core");
  assert.ok(state.visited.length >= 16);
  assert.ok(state.inventory.includes("protocol-key"));
  assert.ok(state.mind.some((item) => item.id === "hymn"));
  assert.equal(state.places["protocol-gate"].seal, "open");
});

test("flood, pike, and the pit each refuse a shortcut", () => {
  const world = load();
  let state = initialState(world);
  let result = applyCommand(world, state, "e");
  assert.equal(result.state.roomId, "flooded-underpass");
  result = applyCommand(world, result.state, "e");
  assert.match(result.lines.map((l) => l.text).join("\n"), /breather/i);
  assert.equal(result.state.roomId, "flooded-underpass");

  state = initialState(world);
  state = applyCommand(world, state, "n").state;
  state = applyCommand(world, state, "e").state;
  state = applyCommand(world, state, "e").state;
  state = applyCommand(world, state, "s").state;
  result = applyCommand(world, state, "s");
  assert.equal(result.state.roomId, "smugglers-cut");
  assert.match(result.lines.map((l) => l.text).join("\n"), /Pike|paid/i);

  state.places["combat-pit"].stair = "clear";
  state.roomId = "combat-pit";
  result = applyCommand(world, state, "s");
  assert.equal(result.state.roomId, "combat-pit");
  assert.match(result.lines.map((l) => l.text).join("\n"), /cipher/i);
});

test("a version-1 tape's flags become things in the world", () => {
  const world = load();
  const state = initialState(world) as ReturnType<typeof initialState> & {
    flags?: Record<string, boolean>;
  };
  state.version = 1;
  state.flags = {
    hymn_heard: true,
    password_known: true,
    gate_open: true,
    pike_passed: true,
    ferryman_paid: true,
    kite_passed: true,
    razor_passed: true,
    shard_a_found: true,
    heard_coil_ash: true,
    coil_traded: true,
    coil_story: true,
    heard_sister_ash: true,
    cipher_got: true,
  };
  ensureState(state, world);
  assert.equal(state.version, 2);
  assert.equal(state.flags, undefined);
  assert.ok(state.mind.some((item) => item.id === "hymn"));
  assert.ok(state.air.includes("cinder"));
  assert.equal(state.places["protocol-gate"].seal, "open");
  assert.equal(state.places["smugglers-cut"].chain, "down");
  assert.equal(state.places["black-canal"].skiff, "loose");
  assert.equal(state.places["watchtower"].hatch, "open");
  assert.equal(state.places["combat-pit"].stair, "clear");
  assert.equal(state.places["ash-well"].cache, "empty");
  assert.ok(state.npcs["old-coil"].mind.some((item) => item.id === "told-ash"));
  assert.ok(state.npcs["old-coil"].mind.some((item) => item.id === "traded-light"));
  assert.ok(state.npcs["old-coil"].mind.some((item) => item.id === "paid-story"));
  assert.ok(state.npcs["sister-static"].mind.some((item) => item.id === "saved-the-word"));
  assert.ok(state.npcs["ash-fragment"].mind.some((item) => item.id === "gave-tape"));
});

test("a killing blow leaves the previous moment unsaved by the engine", () => {
  const world = load();
  const state = initialState(world);
  state.roomId = "scrap-yard";
  state.hp = 1;
  const result = applyCommand(world, state, "attack drone");
  assert.equal(result.state.mode, "dead");
  assert.equal(state.mode, "play");
  assert.equal(state.hp, 1);
});
