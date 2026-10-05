import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { applyCommand, describeRoom, parseCommand } from "./engine.ts";
import { playInput, voicePrompt, type HarnessIo, type VoiceAsk } from "./harness.ts";
import { memoryPrompt, repairLogs } from "./observe.ts";
import type { GameState, ItemDef, NpcScript, NpcState, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

const offline: Partial<HarnessIo> = {
  interpret: async () => {
    throw new Error("slash commands do not need the model");
  },
  role: async () => null,
  memory: async () => "",
  voice: async (_world, _state, ask) => ({ say: ask.beats.map((beat) => beat.gist).join(" "), met: [] }),
};

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
    bribe: {
      cost: 4,
      done: { place: "bar", is: "down", room: "chapel" },
      change: [{ place: "bar", is: "down", room: "chapel" }],
      gist: "The door is yours.",
    },
    say: [
      { includes: "friend", gist: "Same as everyday." },
      {
        includes: "ash",
        consumeItems: ["cascader"],
        grantItems: ["diode"],
        gist: "Take this.",
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
      fixtures: { bar: "up" },
      obstacles: [
        { dir: "east", when: { carrying: "optic" }, fail: "The east door is shut.", pass: "The east door stands open." },
        { dir: "north", when: { place: "bar", is: "down" }, fail: "The north door is shut.", pass: "The north door stands open." },
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
    const result = await playInput(world, current, command, undefined, offline);
    current = result.state;
  }
  return current;
}

test("spoken lines keep the player's casing", () => {
  assert.deepEqual(parseCommand("/say How are you, my friend?"), { type: "say", text: "How are you, my friend?" });
  assert.deepEqual(parseCommand("/shout Coil sent me"), { type: "say", text: "Coil sent me" });
  assert.equal(parseCommand("/look").type, "meta");
});

test("an NPC's log is the room, in the order it happened", async () => {
  const { world, state } = chapel();
  assert.deepEqual(state.npcs.sister.log, []);
  assert.deepEqual(state.npcs.warden.log, []);

  const entered = await playInput(world, state, "/e", undefined, offline);
  assert.deepEqual(entered.state.npcs.sister.log, ["Null comes into the Chapel."]);
  assert.deepEqual(state.npcs.sister.log, []);

  const seen = await play(world, entered.state, [
    "/say How are you, my friend?",
    "/use Cascader",
    "/take Optic Defibrillator",
    "/say Do you sell anything?",
    "/buy diode",
    "/say Thank you.",
    "/e",
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
  const next = await play(world, state, ["/e", "/pay sister"]);
  assert.deepEqual(next.npcs.sister.log, [
    "Null comes into the Chapel.",
    "Null pays me 4 scrip.",
    "Door to north opens.",
    'I reply "The door is yours."',
  ]);
  assert.equal(next.npcs.clerk.log.at(-1), 'Sister replies "The door is yours."');
  assert.ok(next.npcs.clerk.log.includes("Door to north opens."));
  assert.ok(next.npcs.clerk.log.includes("Null pays Sister 4 scrip."));
});

test("a fight is written from both sides", async () => {
  const { world, state } = chapel();
  const next = await play(world, state, ["/e", "/attack clerk"]);
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
  const next = await play(world, state, ["/e", "/say ash"]);
  assert.deepEqual(next.npcs.sister.log, [
    "Null comes into the Chapel.",
    'Null says "ash"',
    "Null hands over Cascader.",
    "I give Null diode.",
    'I reply "Take this."',
  ]);
  assert.ok(next.npcs.clerk.log.includes("Sister gives Null diode."));
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
  assert.equal(readdirSync(join(root, "rooms")).filter((name) => name.endsWith(".json")).length, 21);
  return createWorld(rooms, scripts, states, items, index.start);
}

test("a tape from before Madam Wick still finds her in the booth", () => {
  const world = loadCartridge();
  const standing = initialState(world);
  delete standing.npcs["madam-wick"];
  delete standing.roomItems["glass-booth"];
  standing.roomId = "glass-booth";
  const looked = applyCommand(world, standing, "look");
  const shown = looked.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /Madam Wick sits too straight/);
  assert.deepEqual(looked.state.npcs["madam-wick"].inventory, ["crystal-ball"]);
  assert.deepEqual(looked.state.npcs["madam-wick"].log, [
    "Null comes into the Glass Booth.",
    "Null looks around.",
  ]);
  assert.deepEqual(looked.state.roomItems["glass-booth"], []);

  const market = initialState(world);
  delete market.npcs["madam-wick"];
  const walked = applyCommand(world, market, "n");
  const west = applyCommand(world, walked.state, "w");
  assert.match(west.lines.map((entry) => entry.text).join("\n"), /Madam Wick/);
  assert.deepEqual(west.state.npcs["madam-wick"].log, ["Null comes into the Glass Booth."]);

  const carrying = initialState(world);
  delete carrying.npcs["madam-wick"];
  carrying.inventory.push("crystal-ball");
  carrying.roomId = "lantern-market";
  const repaired = repairLogs(carrying, world);
  assert.deepEqual(repaired.npcs["madam-wick"].inventory, []);
  assert.deepEqual(repaired.npcs["madam-wick"].log, []);
  assert.match(describeRoom(world, { ...repaired, roomId: "glass-booth" }).map((entry) => entry.text).join("\n"), /Madam Wick/);
});

test("coil sees the dock, and mare sees Null arrive at the market", async () => {
  const world = loadCartridge();
  let state = initialState(world);
  assert.deepEqual(state.npcs["old-coil"].log, ["Null comes into the Silt Dock."]);
  assert.deepEqual(state.npcs["mare-voss"].log, []);
  state = (await playInput(world, state, "/take cable", undefined, offline)).state;
  state = (await playInput(world, state, "/n", undefined, offline)).state;
  assert.deepEqual(state.npcs["old-coil"].log, [
    "Null comes into the Silt Dock.",
    "Null takes frayed cable.",
    "Null goes north.",
  ]);
  assert.deepEqual(state.npcs["mare-voss"].log, ["Null comes into the Lantern Market."]);
  assert.deepEqual(state.npcs["sister-static"].log, []);
  assert.deepEqual(state.playerLog, [
    "I come into the Silt Dock.",
    "I take the frayed cable.",
    "I go north.",
    "I come into the Lantern Market.",
  ]);
});

test("the engine speaks no dialogue; it hands the NPC a gist and shows what changed", () => {
  const world = loadCartridge();
  const state = initialState(world);
  const asked = applyCommand(world, state, "talk coil about ash");
  assert.equal(asked.lines.some((entry) => entry.kind === "speech"), false);
  assert.equal(asked.beats?.length, 1);
  assert.equal(asked.beats?.[0].npcId, "old-coil");
  assert.equal(asked.beats?.[0].event, "Null asks you about ash.");
  assert.match(asked.beats?.[0].gist ?? "", /chapel/);
  assert.ok(asked.state.npcs["old-coil"].mind.some((item) => item.id === "told-ash"));

  const traded = applyCommand(world, asked.state, "give stim to coil");
  assert.equal(traded.lines.some((entry) => entry.kind === "speech"), false);
  const shown = traded.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /Old Coil takes the stim/);
  assert.match(shown, /You receive glowcapsule/);
  assert.match(traded.beats?.[0].gist ?? "", /glowcapsule/);

  const unknown = applyCommand(world, state, "talk coil about weather");
  assert.match(unknown.beats?.[0].gist ?? "", /nothing special about weather/);
  assert.match(unknown.lines.map((entry) => entry.text).join("\n"), /Ask about/);
});

test("the voiced reply is printed and logged; the prompt carries the gist", async () => {
  const world = loadCartridge();
  const state = initialState(world);
  let seen: VoiceAsk | null = null;
  const result = await playInput(world, state, "/talk coil about ash", undefined, {
    ...offline,
    voice: async (_world, _state, ask) => {
      seen = ask;
      return { say: "Chapel. North of the market. Kneel.", met: [] };
    },
  });
  const ask = seen as VoiceAsk | null;
  assert.ok(ask);
  assert.equal(ask.npcId, "old-coil");
  assert.equal(ask.utterance, undefined);
  const prompt = voicePrompt(world, result.state, ask);
  assert.match(prompt, /YOU MUST GET ACROSS/);
  assert.match(prompt, /coughing in the chapel radio/);
  assert.match(prompt, /met must be an empty list/);
  assert.match(
    result.lines.map((entry) => entry.text).join("\n"),
    /Old Coil: Chapel\. North of the market\. Kneel\./,
  );
  assert.equal(result.state.npcs["old-coil"].log.at(-1), 'I reply "Chapel. North of the market. Kneel."');
});

test("a lost reply still leaves the trade done and says so", async () => {
  const world = loadCartridge();
  const state = initialState(world);
  const result = await playInput(world, state, "/give stim to coil", undefined, {
    ...offline,
    voice: async () => {
      throw new Error("down");
    },
  });
  const shown = result.lines.map((entry) => entry.text).join("\n");
  assert.ok(result.state.inventory.includes("glowcapsule"));
  assert.match(shown, /You receive glowcapsule/);
  assert.match(shown, /Old Coil's reply is lost in static/);
  assert.equal(result.state.npcs["old-coil"].log.some((entry) => entry.startsWith("I reply")), false);
});

test("free speech reaches everyone in the room; only the rule's NPC gets a gist", async () => {
  const world = loadCartridge();
  const state = initialState(world);
  state.roomId = "smugglers-cut";
  state.npcs["old-coil"].mind.push({
    id: "told-ash",
    line: "I told him ASH is coughing in the chapel radio, north of the market.",
  });
  const asks: VoiceAsk[] = [];
  const result = await playInput(world, state, "/say Coil sent me", undefined, {
    ...offline,
    voice: async (_world, _state, ask) => {
      asks.push(ask);
      return { say: "Walk.", met: [] };
    },
  });
  assert.equal(result.state.places["smugglers-cut"].chain, "down");
  assert.ok(asks.every((ask) => ask.utterance === "Coil sent me"));
  const pike = asks.find((ask) => ask.npcId === "pike");
  assert.match(pike?.beats[0]?.gist ?? "", /south door is open/);
  assert.match(result.lines.map((entry) => entry.text).join("\n"), /The way south is open/);
});

test("no prewritten NPC dialogue is left in the cartridge", () => {
  const root = join(process.cwd(), "public", "ash", "npcs");
  for (const id of readdirSync(root)) {
    const script = JSON.parse(readFileSync(join(root, id, "script.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const rows: Record<string, unknown>[] = [
      ...Object.values((script.topics ?? {}) as Record<string, Record<string, unknown>>),
      ...((script.onTalk ?? []) as Record<string, unknown>[]),
      ...((script.trades ?? []) as Record<string, unknown>[]),
      ...((script.say ?? []) as Record<string, unknown>[]),
    ];
    if (script.bribe) rows.push(script.bribe as Record<string, unknown>);
    if (script.story) rows.push(script.story as Record<string, unknown>);
    for (const row of rows) {
      assert.equal("say" in row, false, `${id} still has a say line`);
      assert.equal("already" in row || "elseSay" in row, false, `${id} still has prose`);
      assert.ok(typeof row.gist === "string" && row.gist.trim(), `${id} has an empty gist`);
    }
    const combat = script.combat as Record<string, unknown>;
    assert.equal("refuse" in combat, false, `${id} still has a refuse line`);
  }
});
