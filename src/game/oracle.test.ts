import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand } from "./engine.ts";
import { playInput } from "./harness.ts";
import { PLAYER_ID } from "./journal.ts";
import { consultOracle, peopleBeside, type OracleIo, type Reading } from "./oracle.ts";
import type { GameState, ItemDef, NpcScript, NpcState, RoomDef, World } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

const ball: ItemDef = {
  id: "crystal-ball",
  name: "crystal ball",
  aliases: ["crystal ball", "ball", "crystal", "orb"],
  kind: "oracle",
  value: 0,
  text: "Glass.",
};

function person(id: string, name: string, aliases: string[]): NpcScript {
  return {
    id,
    name,
    aliases,
    presence: `${name} is here.`,
    greeting: "Hello.",
    topics: {},
    trades: [],
    say: [],
    combat: { damage: 1, scrip: 0, onDeathSay: `${name} falls.` },
  };
}

function body(id: string, inventory: string[] = []): NpcState {
  return { id, alive: true, hp: 8, maxHp: 8, hostile: false, mood: "odd", inventory };
}

function booth(): { world: World; state: GameState } {
  const wick = person("madam-wick", "Madam Wick", ["wick", "madam"]);
  const mare = person("mare-voss", "Mare Voss", ["mare"]);
  const room: RoomDef = {
    id: "glass-booth",
    name: "Glass Booth",
    code: "GLS",
    x: 0,
    y: 0,
    exits: { east: "lane" },
    descriptions: [{ text: "A booth." }],
    ground: [],
    npcs: ["madam-wick", "mare-voss"],
    obstacles: [],
  };
  const lane: RoomDef = {
    id: "lane",
    name: "Lane",
    code: "LAN",
    x: 1,
    y: 0,
    exits: { west: "glass-booth" },
    descriptions: [{ text: "A lane." }],
    ground: [],
    npcs: [],
    obstacles: [],
  };
  const world = createWorld(
    [room, lane],
    [wick, mare],
    [body("madam-wick", ["crystal-ball"]), body("mare-voss")],
    [ball],
    "glass-booth",
  );
  return { world, state: initialState(world) };
}

function io(partial: Partial<OracleIo> & Pick<OracleIo, "read">): OracleIo {
  return {
    prompt: "You are the glass.",
    whisper: async () => "He waited on the dock.",
    cryptic: async () => "Your boots remember a room you have not named.",
    pick: (ids) => ids[0],
    ...partial,
  };
}

test("asking the witch for a fortune reads Null, and he hears the ball", async () => {
  const { world, state } = booth();
  assert.deepEqual(peopleBeside(world, state, "madam-wick"), [PLAYER_ID, "mare-voss"]);
  assert.deepEqual(peopleBeside(world, state, PLAYER_ID), ["madam-wick", "mare-voss"]);

  const asked = applyCommand(world, state, "ask wick for a fortune");
  assert.equal(asked.consult?.activator, "madam-wick");
  assert.equal(asked.consult?.itemId, "crystal-ball");
  assert.equal(asked.consult?.subject, PLAYER_ID);
  const reads: string[] = [];
  let heardByWick = "";
  const told = await consultOracle(
    world,
    asked,
    io({
      pick: () => "mare-voss",
      read: async (id) => {
        reads.push(id);
        return { name: "Null", memory: "I went to the dock.", log: "I wait." };
      },
      whisper: async (_prompt, subject, reading: Reading) => {
        assert.equal(subject, "Null");
        assert.match(reading.memory, /dock/);
        return "He waited on the dock.";
      },
      cryptic: async (_world, _state, _npcId, whisper) => {
        heardByWick = whisper;
        return "Docks keep people, receipt. Move before it keeps you.";
      },
    }),
  );
  assert.deepEqual(reads, [PLAYER_ID]);
  assert.equal(heardByWick, "He waited on the dock.");
  const shown = told.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /The crystal ball whispers, "He waited on the dock\."/);
  assert.match(shown, /Madam Wick: Docks keep people, receipt/);
  assert.ok(told.state.npcs["madam-wick"].log.some((entry) => entry.includes("He waited on the dock.")));
  assert.ok(told.state.playerLog.some((entry) => entry.includes("He waited on the dock.")));
  assert.equal(told.state.npcs["mare-voss"].log.some((entry) => entry.includes("waited on the dock")), false);
  assert.ok(told.state.npcs["mare-voss"].log.some((entry) => entry.includes("Docks keep people")));
  assert.ok(told.state.playerLog.some((entry) => entry.includes("I talk to Madam Wick about fortune.")));
});

test("using the ball shows Null the whisper and leaves the subject untold", async () => {
  const { world, state } = booth();
  state.inventory.push("crystal-ball");
  const used = applyCommand(world, state, "use crystal ball");
  assert.equal(used.consult?.activator, PLAYER_ID);
  const told = await consultOracle(
    world,
    used,
    io({
      pick: () => "madam-wick",
      read: async () => ({ name: "Madam Wick", memory: "", log: "Null comes into the Glass Booth." }),
      whisper: async () => "She argued with Tuesday.",
    }),
  );
  const shown = told.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /The crystal ball whispers, "She argued with Tuesday."/);
  assert.ok(told.state.playerLog.includes('The crystal ball whispers "She argued with Tuesday."'));
  assert.equal(
    told.state.npcs["madam-wick"].log.some((entry) => entry.includes("Tuesday")),
    false,
  );
  assert.equal(told.state.npcs["mare-voss"].log.some((entry) => entry.includes("Tuesday")), false);
});

test("the glass stays dark when nobody else is there or nothing is written", async () => {
  const { world, state } = booth();
  state.inventory.push("crystal-ball");
  state.roomId = "lane";
  const alone = applyCommand(world, state, "use orb");
  let reads = 0;
  const dark = await consultOracle(
    world,
    alone,
    io({
      read: async () => {
        reads += 1;
        return { name: "Null", memory: "x", log: "y" };
      },
    }),
  );
  assert.equal(reads, 0);
  assert.match(dark.lines.map((entry) => entry.text).join("\n"), /nobody else/);

  const { world: again, state: fresh } = booth();
  fresh.inventory.push("crystal-ball");
  const used = applyCommand(again, fresh, "use ball");
  let whispered = 0;
  const empty = await consultOracle(
    again,
    used,
    io({
      read: async () => ({ name: "Madam Wick", memory: "  ", log: "" }),
      whisper: async () => {
        whispered += 1;
        return "Invented.";
      },
    }),
  );
  assert.equal(whispered, 0);
  assert.match(empty.lines.map((entry) => entry.text).join("\n"), /Nothing is written/);
  assert.equal(empty.state.playerLog.some((entry) => entry.includes("Invented")), false);
});

test("Null can take the ball, and a fortune needs it in her hands", async () => {
  const { world, state } = booth();
  const taken = await playInput(world, state, "/take the crystal ball", undefined, {
    interpret: async () => {
      throw new Error("slash commands do not need the model");
    },
    role: async () => null,
    memory: async () => "",
    voice: async () => ({ say: "", met: [] }),
  });
  assert.ok(taken.state.inventory.includes("crystal-ball"));
  assert.equal(taken.state.npcs["madam-wick"].inventory.includes("crystal-ball"), false);
  assert.ok(taken.state.playerLog.some((entry) => entry.includes("I take the crystal ball from Madam Wick.")));
  assert.ok(taken.state.npcs["madam-wick"].log.some((entry) => entry.includes("from me")));

  const refused = applyCommand(world, taken.state, "ask madam for a fortune");
  assert.equal(refused.consult, undefined);
  assert.match(refused.lines.map((entry) => entry.text).join("\n"), /no crystal ball/);
  assert.match(refused.beats?.[0].gist ?? "", /palms/);

  const returned = applyCommand(world, refused.state, "give ball to wick");
  assert.equal(returned.state.inventory.includes("crystal-ball"), false);
  assert.ok(returned.state.npcs["madam-wick"].inventory.includes("crystal-ball"));
  const ready = applyCommand(world, returned.state, "talk wick about fortune");
  assert.equal(ready.consult?.activator, "madam-wick");
});

test("a reading cut off mid-JSON still shows her words, not the braces", async () => {
  const { world, state } = booth();
  const asked = applyCommand(world, state, "ask wick for a fortune");
  const told = await consultOracle(
    world,
    asked,
    io({
      read: async () => ({ name: "Null", memory: "I went to the dock.", log: "" }),
      cryptic: async () => '{ "say": "The dock remembers you, receipt. It wants you back, and it should not get',
    }),
  );
  const shown = told.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /Madam Wick: The dock remembers you, receipt\./);
  assert.equal(shown.includes("{"), false);
  assert.equal(shown.includes("should not get"), false);
});

test("a reading that only parrots the cue is dropped, and the whisper still shows", async () => {
  const { world, state } = booth();
  const asked = applyCommand(world, state, "ask wick for a fortune");
  const told = await consultOracle(
    world,
    asked,
    io({
      read: async () => ({ name: "Null", memory: "I went to the dock.", log: "" }),
      cryptic: async () =>
        'The ball whispered about Null: "He waited on the dock." Now tell Null what you make of it.',
    }),
  );
  const shown = told.lines.map((entry) => entry.text).join("\n");
  assert.match(shown, /The crystal ball whispers, "He waited on the dock\."/);
  assert.equal(shown.includes("Madam Wick:"), false);
});
