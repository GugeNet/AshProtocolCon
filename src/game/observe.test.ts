import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { applyCommand, spokenFrom } from "./engine.ts";
import { playInput } from "./harness.ts";
import { memoryPrompt, repairLogs } from "./observe.ts";
import type { GameState, ItemDef, NpcScript, NpcState, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

function item(
  id: string,
  name: string,
  kind: ItemDef["kind"],
  value: number,
  extra: Partial<ItemDef> = {},
): ItemDef {
  return {
    id,
    name,
    aliases: [id, name.toLowerCase()],
    kind,
    value,
    text: name,
    ...extra,
  };
}

function person(id: string, name: string, extra: Partial<NpcScript> = {}): NpcScript {
  return {
    id,
    name,
    aliases: [id],
    presence: `${name} is here.`,
    greeting: "Hello.",
    topics: {},
    trades: [],
    say: [],
    combat: { damage: 1, scrip: 0, onDeathSay: `${name} falls.` },
    ...extra,
  };
}

function body(id: string, inventory: string[] = []): NpcState {
  return { id, alive: true, hp: 8, maxHp: 8, hostile: false, mood: "calm", inventory };
}

function room(
  id: string,
  name: string,
  x: number,
  y: number,
  exits: RoomDef["exits"],
  extra: Partial<RoomDef> = {},
): RoomDef {
  return {
    id,
    name,
    code: id.slice(0, 3).toUpperCase(),
    x,
    y,
    exits,
    descriptions: [{ text: name }],
    ground: [],
    npcs: [],
    obstacles: [],
    ...extra,
  };
}

function chapel() {
  const optic = item("optic", "Optic Defibrillator", "gear", 2);
  const cascader = item("cascader", "Cascader", "junk", 1, { useText: "The cascader ticks." });
  const diode = item("diode", "diode", "junk", 4);
  const sister = person("sister", "Sister", {
    bribe: { cost: 4, setFlag: "paid", say: "The door is yours." },
    say: [
      { includes: "friend", say: "Same as everyday." },
      {
        includes: "ash",
        consumeItems: ["cascader"],
        grantItems: ["diode"],
        say: "Take this.",
      },
    ],
    shop: { sells: ["diode"], buys: ["junk"] },
  });
  const clerk = person("clerk", "Clerk");
  const warden = person("warden", "Warden");
  const rooms = [
    room("lane", "Lane", 0, 0, { east: "chapel" }),
    room("chapel", "Chapel", 1, 0, { west: "lane", east: "nave", north: "loft" }, {
      ground: [{ id: "optic" }],
      npcs: ["sister", "clerk"],
      obstacles: [
        { dir: "east", anyItem: ["optic"], fail: "The east door is shut.", pass: "The east door stands open." },
        { dir: "north", anyFlag: ["paid"], fail: "The north door is shut.", pass: "The north door stands open." },
      ],
    }),
    room("nave", "Nave", 2, 0, { west: "chapel" }, { npcs: ["warden"] }),
    room("loft", "Loft", 1, 1, { south: "chapel" }),
  ];
  const world = createWorld(
    rooms,
    [sister, clerk, warden],
    [body("sister", ["diode"]), body("clerk"), body("warden")],
    [optic, cascader, diode],
    "lane",
  );
  const state = initialState(world);
  state.inventory = ["cascader"];
  return { world, state };
}

async function play(world: ReturnType<typeof chapel>["world"], state: GameState, commands: string[]) {
  let current = state;
  for (const command of commands) {
    const result = await playInput(world, current, command);
    current = result.state;
  }
  return current;
}

test("spoken lines keep the player's casing", () => {
  assert.equal(spokenFrom('say How are you, my friend?'), "How are you, my friend?");
  assert.equal(spokenFrom("coil sent me"), "coil sent me");
  assert.equal(spokenFrom("look"), null);
});

test("an NPC's log is the room, in the order it happened", async () => {
  const { world, state } = chapel();
  assert.deepEqual(state.npcs.sister.log, []);
  assert.deepEqual(state.npcs.warden.log, []);

  const entered = await playInput(world, state, "e");
  assert.deepEqual(entered.state.npcs.sister.log, ["Null comes into the Chapel."]);
  assert.deepEqual(state.npcs.sister.log, []);

  const seen = await play(world, entered.state, [
    "say How are you, my friend?",
    "use Cascader",
    "take Optic Defibrillator",
    "say Do you sell anything?",
    "buy diode",
    "say Thank you.",
    "e",
  ]);

  assert.deepEqual(seen.npcs.sister.log, [
    "Null comes into the Chapel.",
    'Null says "How are you, my friend?"',
    'I reply "Same as everyday."',
    "Null uses Cascader.",
    "Null takes Optic Defibrillator.",
    "Door to east opens.",
    'Null says "Do you sell anything?"',
    "Trade happens - 1 diode for 4 scrip.",
    'Null says "Thank you."',
    "Null goes east.",
  ]);
  assert.deepEqual(seen.npcs.clerk.log, [
    "Null comes into the Chapel.",
    'Null says "How are you, my friend?"',
    'Sister replies "Same as everyday."',
    "Null uses Cascader.",
    "Null takes Optic Defibrillator.",
    "Door to east opens.",
    'Null says "Do you sell anything?"',
    "Trade happens - 1 diode for 4 scrip.",
    'Null says "Thank you."',
    "Null goes east.",
  ]);
  assert.deepEqual(seen.npcs.warden.log, ["Null comes into the Nave."]);
  assert.deepEqual(entered.state.npcs.sister.log, ["Null comes into the Chapel."]);
});

test("paying opens a door the NPC can see", async () => {
  const { world, state } = chapel();
  const next = await play(world, state, ["e", "pay sister"]);
  assert.deepEqual(next.npcs.sister.log, [
    "Null comes into the Chapel.",
    "Null pays me 4 scrip.",
    'I reply "The door is yours."',
    "Door to north opens.",
  ]);
  assert.equal(next.npcs.clerk.log.at(-1), "Door to north opens.");
  assert.ok(next.npcs.clerk.log.includes("Null pays Sister 4 scrip."));
});

test("a fight is written from both sides", async () => {
  const { world, state } = chapel();
  const next = await play(world, state, ["e", "attack clerk"]);
  assert.deepEqual(next.npcs.sister.log, [
    "Null comes into the Chapel.",
    "Null strikes Clerk with fists.",
    "Clerk hits Null.",
  ]);
  assert.deepEqual(next.npcs.clerk.log, [
    "Null comes into the Chapel.",
    "Null strikes Clerk with fists.",
    "I hit Null.",
  ]);
});

test("what an NPC gives and takes is part of the reply", async () => {
  const { world, state } = chapel();
  const next = await play(world, state, ["e", "say ash"]);
  assert.deepEqual(next.npcs.sister.log, [
    "Null comes into the Chapel.",
    'Null says "ash"',
    'I reply "Take this."',
    "Null hands over Cascader.",
    "I give Null diode.",
  ]);
  assert.equal(next.npcs.clerk.log.at(-1), "Sister gives Null diode.");
  assert.ok(next.inventory.includes("diode"));
  assert.equal(next.inventory.includes("cascader"), false);
});

test("a tape from before the log still records the next thing they see", () => {
  const { world, state } = chapel();
  const arrived = applyCommand(world, state, "e").state;
  delete (arrived.npcs.sister as { log?: string[] }).log;
  const waited = applyCommand(world, arrived, "wait").state;
  assert.deepEqual(waited.npcs.sister.log, ["Null waits."]);
  assert.equal(arrived.npcs.sister.log, undefined);
});

test("memory prompt keeps the log and trims the oldest lines", () => {
  assert.equal(memoryPrompt([]), "");
  assert.match(memoryPrompt(['Null says "hello"']), /WHAT YOU HAVE SEEN/);
  assert.match(memoryPrompt(['Null says "hello"']), /Null says "hello"/);
  const long = Array.from({ length: 90 }, (_, index) => `line ${index}`);
  const prompt = memoryPrompt(long);
  assert.match(prompt, /Earlier events omitted/);
  assert.equal(prompt.includes("line 0"), false);
  assert.match(prompt, /line 89/);
  const repaired = repairLogs({ npcs: { sister: { log: undefined } } } as unknown as GameState);
  assert.deepEqual(repaired.npcs.sister.log, []);
});

function loadCartridge() {
  const root = join(process.cwd(), "public", "ash");
  const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8")) as {
    start: string;
    rooms: string[];
    npcs: string[];
  };
  const items = JSON.parse(readFileSync(join(root, "items.json"), "utf8")) as ItemDef[];
  const rooms = index.rooms.map((id) =>
    JSON.parse(readFileSync(join(root, "rooms", `${id}.json`), "utf8")) as RoomDef,
  );
  const scripts = index.npcs.map((id) =>
    JSON.parse(readFileSync(join(root, "npcs", id, "script.json"), "utf8")) as NpcScript,
  );
  const states = index.npcs.map((id) =>
    JSON.parse(readFileSync(join(root, "npcs", id, "state.json"), "utf8")) as NpcState,
  );
  assert.equal(readdirSync(join(root, "rooms")).filter((name) => name.endsWith(".json")).length, 20);
  return createWorld(rooms, scripts, states, items, index.start);
}

test("coil sees the dock, and mare sees Null arrive at the market", async () => {
  const world = loadCartridge();
  let state = initialState(world);
  assert.deepEqual(state.npcs["old-coil"].log, ["Null comes into the Silt Dock."]);
  assert.deepEqual(state.npcs["mare-voss"].log, []);
  state = (await playInput(world, state, "take cable")).state;
  state = (await playInput(world, state, "n")).state;
  assert.deepEqual(state.npcs["old-coil"].log, [
    "Null comes into the Silt Dock.",
    "Null takes frayed cable.",
    "Null goes north.",
  ]);
  assert.deepEqual(state.npcs["mare-voss"].log, ["Null comes into the Lantern Market."]);
  assert.deepEqual(state.npcs["sister-static"].log, []);
});
