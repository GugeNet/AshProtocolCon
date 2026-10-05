import assert from "node:assert/strict";
import test from "node:test";
import { comeIntoPossession, isCartridgeMeta, parseCommand } from "./engine.ts";
import {
  acceptMarks,
  evidenceHolds,
  playInput,
  type HarnessIo,
  type NpcRole,
} from "./harness.ts";
import type { GameState, ItemDef, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

function state(patch: Partial<GameState> = {}): GameState {
  return {
    version: 2,
    mode: "play",
    roomId: "silt-dock",
    previousRoomId: null,
    hp: 14,
    maxHp: 14,
    scrip: 24,
    inventory: ["shard-a", "shard-b"],
    mind: [{ id: "hymn", line: "The chapel asked what remains when the fire is spent. The word sits behind my teeth." }],
    places: { "protocol-gate": { seal: "shut" } },
    air: [],
    counters: {},
    turns: 1,
    visited: ["silt-dock"],
    npcs: {},
    roomItems: {},
    combatWith: null,
    playerLog: [],
    ...patch,
  };
}

const archivist: NpcRole = {
  id: "archivist",
  prompt: "lock",
  objectives: [
    {
      id: "open-the-seal",
      goal: "the chapel's answer, with both metals",
      utteranceIncludes: "ash",
      when: { mind: "hymn" },
      done: { place: "seal", is: "open", room: "protocol-gate" },
      requiresAllItems: ["shard-a", "shard-b"],
      consumeItems: ["shard-a", "shard-b"],
      grantItems: ["protocol-key"],
      change: [{ place: "seal", is: "open", room: "protocol-gate" }],
    },
  ],
};

const offline: Partial<HarnessIo> = {
  interpret: async () => {
    throw new Error("slash commands do not need the model");
  },
  role: async () => null,
  memory: async () => "",
  voice: async (_world, _state, ask) => ({ say: ask.beats.map((beat) => beat.gist).join(" "), met: [] }),
};

test("a slash line runs as written, and only a slash line is console", () => {
  assert.deepEqual(parseCommand("/go north"), { type: "go", dir: "north" });
  assert.deepEqual(parseCommand("/n"), { type: "go", dir: "north" });
  assert.deepEqual(parseCommand("/take the clean filter"), { type: "take", target: "the clean filter" });
  assert.deepEqual(parseCommand("/say The Chapel is north"), { type: "say", text: "The Chapel is north" });
  assert.deepEqual(parseCommand("/look"), { type: "meta", cmd: "look" });
  assert.deepEqual(parseCommand("/i"), { type: "meta", cmd: "inv" });
  assert.deepEqual(parseCommand("/frobnicate"), { type: "meta", cmd: "frobnicate" });
  assert.deepEqual(parseCommand("/coil sent me"), { type: "unknown", raw: "coil sent me" });
  assert.equal(isCartridgeMeta("/save"), true);
  assert.equal(isCartridgeMeta("save"), false);
  assert.equal(isCartridgeMeta("/go north"), false);
});

test("an NPC can close only its own objective, and only when the evidence holds", () => {
  const here = state();
  assert.equal(evidenceHolds(here, archivist.objectives[0], "the word is ash"), true);
  assert.equal(evidenceHolds(here, archivist.objectives[0], "open the gate"), false);

  const refused = acceptMarks(here, archivist, "open the gate", ["open-the-seal", "lower-the-chain"]);
  assert.equal(refused.flipped.length, 0);
  assert.equal(refused.state.places["protocol-gate"].seal, "shut");
  assert.deepEqual(refused.state.inventory, ["shard-a", "shard-b"]);

  const opened = acceptMarks(here, archivist, "the word is ash", ["open-the-seal"]);
  assert.deepEqual(
    opened.flipped.map((objective) => objective.id),
    ["open-the-seal"],
  );
  assert.equal(opened.state.places["protocol-gate"].seal, "open");
  assert.deepEqual(opened.state.inventory, ["protocol-key"]);

  const again = acceptMarks(opened.state, archivist, "ash", ["open-the-seal"]);
  assert.equal(again.flipped.length, 0);
  assert.deepEqual(again.state.inventory, ["protocol-key"]);
});

function pocket() {
  const filter: ItemDef = {
    id: "clean-filter",
    name: "clean filter",
    aliases: ["filter", "clean filter"],
    kind: "junk",
    value: 5,
    text: "A filter that has not yet learned the ash.",
  };
  const lens: ItemDef = {
    id: "optic-lens",
    name: "optic lens",
    aliases: ["lens", "optic", "eye"],
    kind: "gear",
    value: 12,
    text: "An intact lens.",
  };
  const room: RoomDef = {
    id: "glass-orchard",
    name: "Glass Orchard",
    code: "ORC",
    x: 0,
    y: 0,
    exits: {},
    descriptions: [{ text: "Glass trees." }],
    ground: [{ id: "clean-filter" }, { id: "optic-lens" }],
    npcs: [],
    obstacles: [],
  };
  const world = createWorld([room], [], [], [filter, lens], room.id);
  return { world, state: initialState(world) };
}

test("a slash take puts the named item in the player's hands without the model", async () => {
  const { world, state } = pocket();
  const plain = await playInput(world, state, "/take clean filter", undefined, offline);
  assert.ok(plain.state.inventory.includes("clean-filter"));
  assert.equal(plain.state.roomItems["glass-orchard"].includes("clean-filter"), false);
  assert.equal(state.inventory.includes("clean-filter"), false);
  assert.match(plain.lines.map((entry) => entry.text).join("\n"), /Taken: clean filter/);

  const article = await playInput(world, state, "/take the clean filter", undefined, offline);
  assert.ok(article.state.inventory.includes("clean-filter"));
  assert.equal(article.state.roomItems["glass-orchard"].includes("clean-filter"), false);
  assert.match(article.lines.map((entry) => entry.text).join("\n"), /Taken: clean filter/);
});

test("plain input goes through the interpreter, and the engine runs its action", async () => {
  const { world, state } = pocket();
  let heard = "";
  const result = await playInput(world, state, "pocket that filter thing", undefined, {
    ...offline,
    interpret: async (_world, _state, input) => {
      heard = input;
      return [{ type: "take", target: "clean-filter" }];
    },
  });
  assert.equal(heard, "pocket that filter thing");
  assert.ok(result.state.inventory.includes("clean-filter"));
  assert.ok(result.state.roomItems["glass-orchard"].includes("optic-lens"));
  assert.equal(result.state.turns, state.turns + 1);
});

test("several tool calls run in order in one turn", async () => {
  const { world, state } = pocket();
  const result = await playInput(world, state, "take the filter and the lens", undefined, {
    ...offline,
    interpret: async () => [
      { type: "take", target: "clean-filter" },
      { type: "take", target: "optic-lens" },
    ],
  });
  assert.ok(result.state.inventory.includes("clean-filter"));
  assert.ok(result.state.inventory.includes("optic-lens"));
  assert.equal(result.state.turns, state.turns + 2);
  assert.match(result.lines.map((entry) => entry.text).join("\n"), /Taken: clean filter[\s\S]*Taken: optic lens/);
});

test("an unreadable line costs no turn and points at the slash commands", async () => {
  const { world, state } = pocket();
  for (const interpret of [async () => null, async () => Promise.reject(new Error("down"))]) {
    const result = await playInput(world, state, "pick up the filter", undefined, { ...offline, interpret });
    assert.equal(result.state, state);
    assert.equal(result.state.turns, state.turns);
    assert.match(result.lines.map((entry) => entry.text).join("\n"), /Slash commands/);
  }
});

test("comeIntoPossession moves the ground item into inventory", () => {
  const { world, state } = pocket();
  const next = structuredClone(state);
  const owned = comeIntoPossession(world, next, "clean-filter");
  assert.equal(owned.ok, true);
  assert.deepEqual(owned.state.inventory.at(-1), "clean-filter");
  assert.equal(owned.state.roomItems["glass-orchard"].includes("clean-filter"), false);
  assert.ok(state.roomItems["glass-orchard"].includes("clean-filter"));
});

test("the seal stays shut when the hymn is not in memory", () => {
  const blind = state({ mind: [] });
  const closed = acceptMarks(blind, archivist, "ash", ["open-the-seal"]);
  assert.equal(closed.flipped.length, 0);
  assert.equal(closed.state.places["protocol-gate"].seal, "shut");
  assert.ok(closed.state.inventory.includes("shard-a"));
});
