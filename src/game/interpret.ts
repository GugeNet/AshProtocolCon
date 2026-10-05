import { itemsInRoom, oraclesInHands, type Action } from "./engine.ts";
import { blockedDirs } from "./observe.ts";
import { chatTools, type ChatMessage, type ToolCall, type ToolSpec } from "./ollama.ts";
import type { Dir, GameState, World } from "./types.ts";

// The interpreter works like an MCP client: the room publishes a set of game tools,
// the model calls one or more of them, and the harness runs each call through the engine.

export type Scene = {
  dirs: Dir[];
  npcs: string[];
  ground: string[];
  carried: string[];
  stock: string[];
  readers: string[];
  merchant: boolean;
};

type Args = Record<string, unknown>;

type GameTool = {
  name: string;
  description: string;
  params: Record<string, { schema: Record<string, unknown>; required: boolean }>;
  available: (scene: Scene) => boolean;
  run: (args: Args, scene: Scene, input: string) => Action;
};

export class ToolError extends Error {}

const DIRS: Dir[] = ["north", "south", "east", "west"];
const SCREENS: Record<string, string> = { inventory: "inv", status: "status", map: "map", help: "help" };
const SELF = "self";

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function sceneOf(world: World, state: GameState): Scene {
  const room = world.rooms[state.roomId];
  const npcs = room.npcs.filter((id) => state.npcs[id]?.alive);
  const merchants = npcs.filter((id) => world.npcs[id].script.shop);
  const stock = unique(
    merchants.flatMap((id) => {
      const sells = world.npcs[id].script.shop?.sells ?? [];
      return state.npcs[id].inventory.filter((itemId) => sells.includes(itemId));
    }),
  );
  const readers = npcs.filter((id) =>
    state.npcs[id].inventory.some((itemId) => world.items[itemId]?.kind === "oracle"),
  );
  return {
    dirs: DIRS.filter((dir) => room.exits[dir]),
    npcs,
    ground: unique([
      ...itemsInRoom(world, state).map((item) => item.id),
      ...oraclesInHands(world, state).map((item) => item.id),
    ]),
    carried: unique(state.inventory).filter((id) => world.items[id]),
    stock,
    readers,
    merchant: merchants.length > 0,
  };
}

function oneOf(values: string[], description: string) {
  return { schema: { type: "string", enum: values, description }, required: true };
}

function text(description: string, required = true) {
  return { schema: { type: "string", description }, required };
}

function str(args: Args, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function pick(args: Args, key: string, allowed: string[], what: string): string {
  const value = str(args, key);
  if (!value) throw new ToolError(`${key} is required. Choose one of: ${allowed.join(", ")}.`);
  if (!allowed.includes(value)) {
    throw new ToolError(`There is no ${what} "${value}" here. Choose one of: ${allowed.join(", ")}.`);
  }
  return value;
}

const people = (scene: Scene) => scene.npcs.length > 0;

export const TOOLS: GameTool[] = [
  {
    name: "move",
    description: "Walk out of the room through an exit.",
    params: { direction: { schema: {}, required: true } },
    available: (scene) => scene.dirs.length > 0,
    run: (args, scene) => ({ type: "go", dir: pick(args, "direction", scene.dirs, "exit") as Dir }),
  },
  {
    name: "look_around",
    description: "Look around the room again: its description, exits, items, and people.",
    params: {},
    available: () => true,
    run: () => ({ type: "look" }),
  },
  {
    name: "examine",
    description: "Look closely at one person, one item, or at Null himself (target self).",
    params: { target: { schema: {}, required: true } },
    available: () => true,
    run: (args, scene) => {
      const target = pick(args, "target", [...scene.npcs, ...scene.ground, ...scene.carried, ...scene.stock, SELF], "target");
      return { type: "examine", target: target === SELF ? "me" : target };
    },
  },
  {
    name: "search_room",
    description: "Search the room for anything hidden.",
    params: {},
    available: () => true,
    run: () => ({ type: "search" }),
  },
  {
    name: "listen",
    description: "Stand still and listen to the room. Also use it to pray or kneel.",
    params: {},
    available: () => true,
    run: () => ({ type: "listen" }),
  },
  {
    name: "take_item",
    description: "Pick up an item lying here, or take an item out of someone's hands.",
    params: { item: { schema: {}, required: true } },
    available: (scene) => scene.ground.length > 0,
    run: (args, scene) => ({ type: "take", target: pick(args, "item", scene.ground, "item") }),
  },
  {
    name: "drop_item",
    description: "Put down an item Null carries.",
    params: { item: { schema: {}, required: true } },
    available: (scene) => scene.carried.length > 0,
    run: (args, scene) => ({ type: "drop", target: pick(args, "item", scene.carried, "carried item") }),
  },
  {
    name: "use_item",
    description:
      "Use an item Null carries: take a stim, operate gear. If Null holds a crystal ball himself, this is how he looks into it.",
    params: { item: { schema: {}, required: true } },
    available: (scene) => scene.carried.length > 0,
    run: (args, scene) => ({ type: "use", item: pick(args, "item", scene.carried, "carried item") }),
  },
  {
    name: "talk_to",
    description:
      "Talk to a person, or ask them about a subject. Put the subject in topic, using one of their listed topics when it fits.",
    params: {
      person: { schema: {}, required: true },
      topic: text("What Null asks about, in a word or two. Leave empty for a plain greeting.", false),
    },
    available: people,
    run: (args, scene) => {
      const person = pick(args, "person", scene.npcs, "person");
      const topic = str(args, "topic");
      return topic ? { type: "talk", target: person, topic } : { type: "talk", target: person };
    },
  },
  {
    name: "ask_for_fortune",
    description:
      "Ask the person holding a crystal ball to read Null's fortune in it. Use this whenever the player asks what the crystal ball says, sees, or shows, asks for a reading, a fortune, or a prophecy, or asks someone to look into the ball for him.",
    params: { reader: { schema: {}, required: true } },
    available: (scene) => scene.readers.length > 0,
    run: (args, scene) => ({
      type: "talk",
      target: pick(args, "reader", scene.readers, "person holding a crystal ball"),
      topic: "fortune",
    }),
  },
  {
    name: "say",
    description:
      "Null speaks words aloud to the room: a password, an answer to a question, a reply, a greeting, or a statement. Copy the words exactly as the player typed them.",
    params: { words: text("The exact words Null says.") },
    available: () => true,
    run: (args, _scene, input) => ({ type: "say", text: str(args, "words") || input.trim() }),
  },
  {
    name: "give_item",
    description: "Hand an item Null carries to a person, as a gift or a swap.",
    params: { item: { schema: {}, required: true }, person: { schema: {}, required: true } },
    available: (scene) => people(scene) && scene.carried.length > 0,
    run: (args, scene) => ({
      type: "give",
      item: pick(args, "item", scene.carried, "carried item"),
      npc: pick(args, "person", scene.npcs, "person"),
    }),
  },
  {
    name: "tell_story",
    description: "Tell a person a story, or tell them about something that happened to Null.",
    params: { person: { schema: {}, required: true } },
    available: people,
    run: (args, scene) => ({ type: "story", npc: pick(args, "person", scene.npcs, "person") }),
  },
  {
    name: "pay",
    description: "Pay a person scrip: a bribe, a toll, a fare, or a healer's fee.",
    params: { person: { schema: {}, required: true } },
    available: people,
    run: (args, scene) => ({ type: "pay", npc: pick(args, "person", scene.npcs, "person") }),
  },
  {
    name: "show_wares",
    description: "See what the merchant here sells, at what price, and what they buy.",
    params: {},
    available: (scene) => scene.merchant,
    run: () => ({ type: "trade" }),
  },
  {
    name: "buy_item",
    description:
      "Buy an item from the merchant for scrip. Only when the player clearly says to buy it. Asking a price is talk_to with that item as topic.",
    params: { item: { schema: {}, required: true } },
    available: (scene) => scene.merchant && scene.stock.length > 0,
    run: (args, scene) => ({ type: "buy", item: pick(args, "item", scene.stock, "item for sale") }),
  },
  {
    name: "sell_item",
    description: "Sell an item Null carries to the merchant for scrip. Any offer to sell is this tool, never give_item.",
    params: { item: { schema: {}, required: true } },
    available: (scene) => scene.merchant && scene.carried.length > 0,
    run: (args, scene) => ({ type: "sell", item: pick(args, "item", scene.carried, "carried item") }),
  },
  {
    name: "attack",
    description: "Fight a person.",
    params: { person: { schema: {}, required: true } },
    available: people,
    run: (args, scene) => ({ type: "attack", target: pick(args, "person", scene.npcs, "person") }),
  },
  {
    name: "flee",
    description: "Run away from a fight.",
    params: {},
    available: () => true,
    run: () => ({ type: "flee" }),
  },
  {
    name: "wait",
    description: "Let a moment pass.",
    params: {},
    available: () => true,
    run: () => ({ type: "wait" }),
  },
  {
    name: "show_screen",
    description: "Show one of the game's screens: what Null carries, his status, the map, or help.",
    params: { screen: oneOf(Object.keys(SCREENS), "Which screen.") },
    available: () => true,
    run: (args) => ({ type: "meta", cmd: SCREENS[pick(args, "screen", Object.keys(SCREENS), "screen")] }),
  },
];

function enumFor(tool: GameTool, key: string, scene: Scene): string[] | null {
  if (key === "direction") return scene.dirs;
  if (key === "person") return scene.npcs;
  if (key === "reader") return scene.readers;
  if (key === "target") return [...scene.npcs, ...scene.ground, ...scene.carried, ...scene.stock, SELF];
  if (key !== "item") return null;
  if (tool.name === "take_item") return scene.ground;
  if (tool.name === "buy_item") return scene.stock;
  return scene.carried;
}

export function toolsFor(scene: Scene): ToolSpec[] {
  return TOOLS.filter((tool) => tool.available(scene)).map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, param] of Object.entries(tool.params)) {
      const values = enumFor(tool, key, scene);
      properties[key] = values ? { type: "string", enum: unique(values) } : param.schema;
      if (param.required) required.push(key);
    }
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties, required },
      },
    };
  });
}

function itemRow(world: World, id: string): string {
  const item = world.items[id];
  const aliases = item.aliases.filter((alias) => alias !== item.name.toLowerCase());
  return aliases.length ? `${id} — ${item.name} (${aliases.join(", ")})` : `${id} — ${item.name}`;
}

export function interpretPrompt(world: World, state: GameState, scene: Scene): string {
  const room = world.rooms[state.roomId];
  const blocked = blockedDirs(world, state, state.roomId);
  const exits = scene.dirs.map((dir) => (blocked.includes(dir) ? `${dir} (blocked)` : dir));
  const crowd = scene.npcs.map((id) => {
    const script = world.npcs[id].script;
    const topics = Object.keys(script.topics);
    const parts = [`${id} — ${script.name}; also called ${script.aliases.join(", ")}`];
    if (topics.length) parts.push(`topics: ${topics.join(", ")}`);
    if (script.shop) parts.push("merchant");
    if (state.npcs[id].hostile) parts.push("hostile");
    const held = state.npcs[id].inventory.filter((itemId) => world.items[itemId]?.kind === "oracle");
    if (held.length) parts.push(`holding ${held.map((itemId) => world.items[itemId].name).join(", ")}`);
    return `- ${parts.join("; ")}`;
  });
  const list = (ids: string[]) => (ids.length ? ids.map((id) => `- ${itemRow(world, id)}`) : ["- (nothing)"]);
  return [
    "You are the hands of Null, the player character in the text game Ash Protocol.",
    "Read what the player typed and carry it out by calling the game tools. You are not a character and you never answer in prose.",
    "Call the one tool that does what the player means. If the player asks for two things in a row, call both tools in that order.",
    "Use only the ids listed below. Articles like the, a, an do not matter. Pronouns like it, him, or her point at the most obvious person or item here.",
    "When the player addresses someone, the person here is meant even if the name is only a title or a description.",
    "If the player states something, answers, or says a word aloud, call say. Prefer say over doing nothing whenever someone is here to hear it.",
    "",
    `ROOM: ${room.name}`,
    `EXITS: ${exits.length ? exits.join(", ") : "none"}`,
    "PEOPLE HERE:",
    ...(crowd.length ? crowd : ["- (nobody)"]),
    "ITEMS HERE:",
    ...list(scene.ground),
    "NULL CARRIES:",
    ...list(scene.carried),
    ...(scene.stock.length ? ["FOR SALE:", ...list(scene.stock)] : []),
  ].join("\n");
}

export function callToAction(call: ToolCall, scene: Scene, input: string): Action {
  const tool = TOOLS.find((entry) => entry.name === call.name);
  if (!tool || !tool.available(scene)) {
    const names = TOOLS.filter((entry) => entry.available(scene)).map((entry) => entry.name);
    throw new ToolError(`There is no tool "${call.name}" here. Use one of: ${names.join(", ")}.`);
  }
  return tool.run(call.arguments, scene, input);
}

export type Interpreter = (
  world: World,
  state: GameState,
  input: string,
  signal?: AbortSignal,
) => Promise<Action[] | null>;

const MAX_CALLS = 3;
const ATTEMPTS = 2;

export const interpret: Interpreter = async (world, state, input, signal) => {
  const scene = sceneOf(world, state);
  const tools = toolsFor(scene);
  const messages: ChatMessage[] = [
    { role: "system", content: interpretPrompt(world, state, scene) },
    { role: "user", content: input.trim() },
  ];
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const reply = await chatTools(tools, messages, signal);
    const actions: Action[] = [];
    const errors: { name: string; message: string }[] = [];
    for (const call of reply.calls.slice(0, MAX_CALLS)) {
      try {
        actions.push(callToAction(call, scene, input));
      } catch (error) {
        if (!(error instanceof ToolError)) throw error;
        errors.push({ name: call.name, message: error.message });
      }
    }
    if (actions.length && (!errors.length || attempt === ATTEMPTS - 1)) return actions;
    messages.push({
      role: "assistant",
      content: reply.content,
      tool_calls: reply.calls.map((call) => ({ function: call })),
    });
    if (errors.length) {
      for (const error of errors) messages.push({ role: "tool", tool_name: error.name, content: `Error: ${error.message}` });
    } else {
      messages.push({ role: "user", content: "Do not answer in prose. Call one of the tools." });
    }
  }
  return null;
};
