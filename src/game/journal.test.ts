import assert from "node:assert/strict";
import test from "node:test";
import {
  HYPNOS_MARKER,
  journalPeople,
  logFileName,
  memoryFileName,
  memoryUrl,
  mergeJournal,
  personFileName,
} from "./journal.ts";
import { memoryFileSection } from "./observe.ts";
import type { GameState, NpcScript, NpcState, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

test("journal files use the person's name", () => {
  assert.equal(personFileName("Old Coil"), "Old Coil");
  assert.equal(personFileName("  the Archivist  "), "the Archivist");
  assert.equal(personFileName("a/b\\c"), "abc");
  assert.equal(personFileName(".."), "unnamed");
  assert.equal(personFileName("dot."), "dot");
  assert.equal(logFileName("Old Coil"), "Old Coil.log");
  assert.equal(memoryFileName("Mare Voss"), "Mare Voss.memory.json");
  assert.equal(memoryUrl("Old Coil"), "/journals/Old%20Coil.memory.json");
});

test("a saved log keeps the hypnos marker and adds only new lines after it", () => {
  const marked = ["Null comes into the Silt Dock.", HYPNOS_MARKER, "Null waits."].join("\n") + "\n";
  const again = mergeJournal(marked, ["Null comes into the Silt Dock.", "Null waits.", "Null goes north."]);
  assert.equal(again, ["Null comes into the Silt Dock.", HYPNOS_MARKER, "Null waits.", "Null goes north."].join("\n") + "\n");
  assert.equal(mergeJournal(again, ["Null comes into the Silt Dock.", "Null waits.", "Null goes north."]), again);
  assert.equal(mergeJournal(marked, []), "");
  assert.equal(mergeJournal(marked, ["Null comes into the Chapel."]), "Null comes into the Chapel.\n");
});

test("a memory file becomes the MEMORY section of the prompt", () => {
  assert.equal(memoryFileSection("  "), "");
  const section = memoryFileSection("You remember the dock.\r\nNull took the cable.");
  assert.match(section, /^MEMORY\n/);
  assert.match(section, /You remember the dock.\nNull took the cable.$/);
});

test("the journal lists every person and the log they hold", () => {
  const script: NpcScript = {
    id: "sister",
    name: "Sister Static",
    aliases: ["sister"],
    presence: "Sister is here.",
    greeting: "Hello.",
    topics: {},
    trades: [],
    say: [],
    combat: { damage: 1, scrip: 0, onDeathSay: "Sister falls." },
  };
  const state: NpcState = {
    id: "sister",
    alive: true,
    hp: 8,
    maxHp: 8,
    hostile: false,
    mood: "calm",
    inventory: [],
  };
  const room: RoomDef = {
    id: "chapel",
    name: "Chapel",
    code: "CHP",
    x: 0,
    y: 0,
    exits: {},
    descriptions: [{ text: "Chapel." }],
    ground: [],
    npcs: ["sister"],
    obstacles: [],
  };
  const world = createWorld([room], [script], [state], [], "chapel");
  const game: GameState = initialState(world);
  game.npcs.sister.log.push('Null says "hello"');
  assert.deepEqual(journalPeople(world, game), [
    {
      id: "sister",
      name: "Sister Static",
      log: ["Null comes into the Chapel.", 'Null says "hello"'],
    },
    {
      id: "null",
      name: "Null",
      log: ["I come into the Chapel."],
    },
  ]);
});
