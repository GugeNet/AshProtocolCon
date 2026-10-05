import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  callToAction,
  interpret,
  interpretPrompt,
  sceneOf,
  ToolError,
  toolsFor,
  type Scene,
} from "./interpret.ts";
import type { ItemDef, NpcScript, NpcState, RoomDef } from "./types.ts";
import { createWorld, initialState } from "./world.ts";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function load() {
  const root = join(process.cwd(), "public", "ash");
  const index = readJson<{ start: string; rooms: string[]; npcs: string[] }>(join(root, "index.json"));
  return createWorld(
    index.rooms.map((id) => readJson<RoomDef>(join(root, "rooms", `${id}.json`))),
    index.npcs.map((id) => readJson<NpcScript>(join(root, "npcs", id, "script.json"))),
    index.npcs.map((id) => readJson<NpcState>(join(root, "npcs", id, "state.json"))),
    readJson<ItemDef[]>(join(root, "items.json")),
    index.start,
  );
}

function names(scene: Scene): string[] {
  return toolsFor(scene).map((tool) => tool.function.name);
}

function enumOf(scene: Scene, tool: string, param: string): unknown {
  const spec = toolsFor(scene).find((entry) => entry.function.name === tool);
  const parameters = spec?.function.parameters as { properties: Record<string, { enum?: string[] }> };
  return parameters.properties[param]?.enum;
}

test("the room publishes only the tools that make sense here", () => {
  const world = load();
  const state = initialState(world);
  const dock = sceneOf(world, state);
  assert.ok(names(dock).includes("talk_to"));
  assert.ok(names(dock).includes("take_item"));
  assert.equal(names(dock).includes("ask_for_fortune"), false);
  assert.equal(names(dock).includes("buy_item"), false);
  assert.deepEqual(enumOf(dock, "move", "direction"), ["north", "east"]);
  assert.deepEqual(enumOf(dock, "talk_to", "person"), ["old-coil"]);
  assert.deepEqual(enumOf(dock, "take_item", "item"), ["frayed-cable"]);

  state.roomId = "lantern-market";
  const market = sceneOf(world, state);
  assert.ok(names(market).includes("buy_item"));
  assert.ok((enumOf(market, "buy_item", "item") as string[]).includes("breather"));

  state.roomId = "glass-booth";
  const booth = sceneOf(world, state);
  assert.ok(names(booth).includes("ask_for_fortune"));
  assert.deepEqual(enumOf(booth, "ask_for_fortune", "reader"), ["madam-wick"]);
  assert.ok((enumOf(booth, "take_item", "item") as string[]).includes("crystal-ball"));

  state.roomId = "scrap-yard";
  assert.equal((sceneOf(world, state).ground as string[]).includes("insulated-gloves"), false);
});

test("asking what the crystal ball says is a fortune the witch reads for Null", () => {
  const world = load();
  const state = initialState(world);
  state.roomId = "glass-booth";
  const scene = sceneOf(world, state);
  const tool = toolsFor(scene).find((entry) => entry.function.name === "ask_for_fortune");
  assert.match(tool?.function.description ?? "", /what the crystal ball says/);
  assert.deepEqual(callToAction({ name: "ask_for_fortune", arguments: { reader: "madam-wick" } }, scene, "x"), {
    type: "talk",
    target: "madam-wick",
    topic: "fortune",
  });
  assert.match(interpretPrompt(world, state, scene), /holding crystal ball/);
});

test("each tool call becomes the engine action", () => {
  const world = load();
  const state = initialState(world);
  const dock = sceneOf(world, state);
  const run = (name: string, args: Record<string, unknown>, input = "x") =>
    callToAction({ name, arguments: args }, dock, input);
  assert.deepEqual(run("move", { direction: "north" }), { type: "go", dir: "north" });
  assert.deepEqual(run("take_item", { item: "frayed-cable" }), { type: "take", target: "frayed-cable" });
  assert.deepEqual(run("talk_to", { person: "old-coil", topic: "ash" }), {
    type: "talk",
    target: "old-coil",
    topic: "ash",
  });
  assert.deepEqual(run("talk_to", { person: "old-coil", topic: "" }), { type: "talk", target: "old-coil" });
  assert.deepEqual(run("give_item", { item: "stim", person: "old-coil" }), {
    type: "give",
    item: "stim",
    npc: "old-coil",
  });
  assert.deepEqual(run("examine", { target: "self" }), { type: "examine", target: "me" });
  assert.deepEqual(run("show_screen", { screen: "inventory" }), { type: "meta", cmd: "inv" });
  assert.deepEqual(run("say", { words: "Coil sent me" }), { type: "say", text: "Coil sent me" });
  assert.deepEqual(run("say", {}, "  the word is ash "), { type: "say", text: "the word is ash" });
});

test("a bad call is a tool error that names the valid choices", () => {
  const world = load();
  const dock = sceneOf(world, initialState(world));
  const bad = (name: string, args: Record<string, unknown>) =>
    assert.throws(() => callToAction({ name, arguments: args }, dock, "x"), ToolError);
  bad("dance", {});
  bad("buy_item", { item: "knife" });
  bad("ask_for_fortune", { reader: "madam-wick" });
  bad("take_item", { item: "protocol-key" });
  bad("move", { direction: "south" });
  bad("talk_to", { person: "pike" });
  bad("move", {});
  assert.throws(
    () => callToAction({ name: "talk_to", arguments: { person: "pike" } }, dock, "x"),
    /Choose one of: old-coil/,
  );
});

type Sent = { messages: { role: string; content: string; tool_name?: string }[]; tools: unknown[] };

async function withOllama(replies: unknown[], run: () => Promise<void>): Promise<Sent[]> {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Sent);
    const message = replies.shift() ?? { content: "" };
    return new Response(JSON.stringify({ message }), { status: 200 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
  return sent;
}

test("interpret sends the tools, runs the calls in order, and keeps at most three", async () => {
  const world = load();
  const state = initialState(world);
  let actions: unknown = null;
  const sent = await withOllama(
    [
      {
        content: "",
        tool_calls: [
          { function: { name: "take_item", arguments: { item: "frayed-cable" } } },
          { function: { name: "move", arguments: '{"direction":"north"}' } },
        ],
      },
    ],
    async () => {
      actions = await interpret(world, state, "grab the cable and head north");
    },
  );
  assert.equal(sent.length, 1);
  assert.ok(sent[0].tools.length > 5);
  assert.equal(sent[0].messages.at(-1)?.content, "grab the cable and head north");
  assert.deepEqual(actions, [
    { type: "take", target: "frayed-cable" },
    { type: "go", dir: "north" },
  ]);
});

test("a wrong call goes back to the model as a tool error, once", async () => {
  const world = load();
  const state = initialState(world);
  let actions: unknown = null;
  const sent = await withOllama(
    [
      { content: "", tool_calls: [{ function: { name: "talk_to", arguments: { person: "mare-voss" } } }] },
      { content: "", tool_calls: [{ function: { name: "talk_to", arguments: { person: "old-coil" } } }] },
    ],
    async () => {
      actions = await interpret(world, state, "talk to the old man");
    },
  );
  assert.equal(sent.length, 2);
  const error = sent[1].messages.at(-1);
  assert.equal(error?.role, "tool");
  assert.equal(error?.tool_name, "talk_to");
  assert.match(error?.content ?? "", /no person "mare-voss"/);
  assert.deepEqual(actions, [{ type: "talk", target: "old-coil" }]);
});

test("prose instead of a tool call is nudged once, then given up on", async () => {
  const world = load();
  const state = initialState(world);
  let actions: unknown = "unset";
  const sent = await withOllama([{ content: "You look around." }, { content: "Still prose." }], async () => {
    actions = await interpret(world, state, "hmm");
  });
  assert.equal(sent.length, 2);
  assert.match(sent[1].messages.at(-1)?.content ?? "", /Call one of the tools/);
  assert.equal(actions, null);
});
