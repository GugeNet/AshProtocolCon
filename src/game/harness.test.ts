import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, speechUtterance } from "./engine.ts";
import { acceptMarks, comeIntoPossession, evidenceHolds, playInput, type NpcRole } from "./harness.ts";
import type { GameState, ItemDef, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

function state(patch: Partial<GameState> = {}): GameState {
  return {
    version: 1,
    mode: "play",
    roomId: "silt-dock",
    previousRoomId: null,
    hp: 14,
    maxHp: 14,
    scrip: 24,
    inventory: ["shard-a", "shard-b"],
    flags: { hymn_heard: true },
    counters: {},
    turns: 1,
    visited: ["silt-dock"],
    npcs: {},
    roomItems: {},
    combatWith: null,
    ...patch,
  };
}

const archivist: NpcRole = {
  id: "archivist",
  prompt: "lock",
  objectives: [
    {
      flag: "gate_open",
      goal: "the chapel's answer, with both metals",
      utteranceIncludes: "ash",
      requiresFlag: "hymn_heard",
      requiresAllItems: ["shard-a", "shard-b"],
      consumeItems: ["shard-a", "shard-b"],
      grantItems: ["protocol-key"],
    },
  ],
};

test("speech is what the room hears, and commands stay with the game", () => {
  assert.equal(speechUtterance("say the chapel is north"), "the chapel is north");
  assert.equal(speechUtterance("coil sent me south"), "coil sent me south");
  assert.equal(speechUtterance("look"), null);
  assert.equal(speechUtterance("/exit"), null);
  assert.equal(speechUtterance("lok"), null);
  assert.equal(speechUtterance("go north"), null);
});

test("an NPC can close only its own objective, and only when the evidence holds", () => {
  const here = state();
  assert.equal(evidenceHolds(here, archivist.objectives[0], "the word is ash"), true);
  assert.equal(evidenceHolds(here, archivist.objectives[0], "open the gate"), false);

  const refused = acceptMarks(here, archivist, "open the gate", ["gate_open", "pike_passed"]);
  assert.equal(refused.flipped.length, 0);
  assert.equal(refused.state.flags.gate_open, undefined);
  assert.deepEqual(refused.state.inventory, ["shard-a", "shard-b"]);

  const opened = acceptMarks(here, archivist, "the word is ash", ["gate_open"]);
  assert.deepEqual(
    opened.flipped.map((objective) => objective.flag),
    ["gate_open"],
  );
  assert.equal(opened.state.flags.gate_open, true);
  assert.deepEqual(opened.state.inventory, ["protocol-key"]);

  const again = acceptMarks(opened.state, archivist, "ash", ["gate_open"]);
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

test("the harness puts a named item in the player's hands", async () => {
  const { world, state } = pocket();
  const plain = await playInput(world, state, "take clean filter", undefined, async () => {
    throw new Error("the named item does not need the model");
  });
  assert.ok(plain.state.inventory.includes("clean-filter"));
  assert.equal(plain.state.roomItems["glass-orchard"].includes("clean-filter"), false);
  assert.equal(state.inventory.includes("clean-filter"), false);
  assert.match(plain.lines.map((entry) => entry.text).join("\n"), /Taken: clean filter/);

  const article = await playInput(world, state, "take the clean filter");
  assert.ok(article.state.inventory.includes("clean-filter"));
  assert.equal(article.state.roomItems["glass-orchard"].includes("clean-filter"), false);
  assert.match(article.lines.map((entry) => entry.text).join("\n"), /Taken: clean filter/);
});

test("a pronoun take uses the item the model names", async () => {
  const { world, state } = pocket();
  let heard = "";
  const result = await playInput(world, state, "take it", undefined, async (_world, _state, input) => {
    heard = input;
    return "clean-filter";
  });
  assert.equal(heard, "take it");
  assert.ok(result.state.inventory.includes("clean-filter"));
  assert.ok(result.state.roomItems["glass-orchard"].includes("optic-lens"));
});

test("the command parser does not pick the item up", () => {
  const { world, state } = pocket();
  const result = applyCommand(world, state, "take the clean filter");
  assert.equal(result.state.inventory.includes("clean-filter"), false);
  assert.ok(result.state.roomItems["glass-orchard"].includes("clean-filter"));
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

test("a flag stays down when the NPC's precondition is missing", () => {
  const blind = state({ flags: {} });
  const closed = acceptMarks(blind, archivist, "ash", ["gate_open"]);
  assert.equal(closed.flipped.length, 0);
  assert.equal(closed.state.flags.gate_open, undefined);
  assert.ok(closed.state.inventory.includes("shard-a"));
});
