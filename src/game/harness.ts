import {
  applyCommand,
  findItem,
  isCartridgeMeta,
  isUnheardLine,
  itemsInRoom,
  speechUtterance,
} from "./engine.ts";
import type { CommandResult, GameLine, GameState, ItemDef, NpcScript, World } from "./types.ts";

export const OLLAMA_MODEL = "qwen3:4b";

export type NpcObjective = {
  flag: string;
  goal: string;
  utteranceIncludes?: string;
  requiresFlag?: string;
  requiresAnyFlags?: string[];
  requiresAllItems?: string[];
  consumeItems?: string[];
  grantItems?: string[];
};

export type NpcRole = {
  id: string;
  prompt: string;
  objectives: NpcObjective[];
};

export type HearResult = {
  state: GameState;
  lines: GameLine[];
};

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    met: { type: "array", items: { type: "string" } },
  },
  required: ["say", "met"],
};

const line = (kind: GameLine["kind"], text: string): GameLine => ({ kind, text });

function wordHas(text: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function hasItem(state: GameState, id: string): boolean {
  return state.inventory.includes(id);
}

function asObjective(raw: unknown): NpcObjective | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.flag !== "string" || typeof row.goal !== "string") return null;
  const strings = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : undefined;
  return {
    flag: row.flag,
    goal: row.goal,
    utteranceIncludes: typeof row.utteranceIncludes === "string" ? row.utteranceIncludes : undefined,
    requiresFlag: typeof row.requiresFlag === "string" ? row.requiresFlag : undefined,
    requiresAnyFlags: strings(row.requiresAnyFlags),
    requiresAllItems: strings(row.requiresAllItems),
    consumeItems: strings(row.consumeItems),
    grantItems: strings(row.grantItems),
  };
}

export function asRole(id: string, raw: unknown): NpcRole | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.id !== id || typeof row.prompt !== "string") return null;
  const objectives = Array.isArray(row.objectives)
    ? row.objectives.flatMap((entry) => {
        const objective = asObjective(entry);
        return objective ? [objective] : [];
      })
    : [];
  return { id, prompt: row.prompt, objectives };
}

export function evidenceHolds(state: GameState, objective: NpcObjective, utterance: string): boolean {
  if (state.flags[objective.flag]) return false;
  if (objective.utteranceIncludes && !wordHas(utterance, objective.utteranceIncludes)) return false;
  if (objective.requiresFlag && !state.flags[objective.requiresFlag]) return false;
  if (objective.requiresAnyFlags && !objective.requiresAnyFlags.some((flag) => state.flags[flag])) {
    return false;
  }
  if (objective.requiresAllItems && !objective.requiresAllItems.every((id) => hasItem(state, id))) {
    return false;
  }
  if (objective.consumeItems && !objective.consumeItems.every((id) => hasItem(state, id))) return false;
  return true;
}

export function acceptMarks(
  state: GameState,
  role: NpcRole,
  utterance: string,
  met: string[],
): { state: GameState; flipped: NpcObjective[] } {
  const next = structuredClone(state);
  const allowed = new Map(role.objectives.map((objective) => [objective.flag, objective]));
  const flipped: NpcObjective[] = [];
  for (const flag of met) {
    const objective = allowed.get(flag);
    if (!objective || !evidenceHolds(next, objective, utterance)) continue;
    for (const id of objective.consumeItems ?? []) {
      const index = next.inventory.indexOf(id);
      if (index >= 0) next.inventory.splice(index, 1);
    }
    next.flags[objective.flag] = true;
    for (const id of objective.grantItems ?? []) {
      if (!hasItem(next, id)) next.inventory.push(id);
    }
    flipped.push(objective);
  }
  return { state: next, flipped };
}

const roles = new Map<string, Promise<NpcRole | null>>();

export function loadRole(id: string): Promise<NpcRole | null> {
  const pending = roles.get(id);
  if (pending) return pending;
  const next = fetch(`/ash/npcs/${id}/role.json`)
    .then(async (res) => {
      if (!res.ok) return null;
      return asRole(id, await res.json());
    })
    .catch(() => null);
  roles.set(id, next);
  return next;
}

function presenceOf(script: NpcScript, state: GameState): string {
  let text = script.presence;
  for (const alt of script.presenceWhen ?? []) {
    if (state.flags[alt.flag]) text = alt.text;
  }
  return text;
}

function objectiveBrief(role: NpcRole, state: GameState, utterance: string): string {
  if (!role.objectives.length) return "You have no objectives. met must be an empty list.";
  return role.objectives
    .map((objective) => {
      const open = state.flags[objective.flag] ? "ALREADY MET" : "OPEN";
      const evidence =
        open === "OPEN" && evidenceHolds(state, objective, utterance)
          ? "EVIDENCE HOLDS"
          : "EVIDENCE DOES NOT HOLD";
      return `- ${objective.flag} — ${open} — ${evidence}. ${objective.goal}`;
    })
    .join("\n");
}

function systemPrompt(
  role: NpcRole,
  script: NpcScript,
  roomName: string,
  mood: string,
  state: GameState,
  utterance: string,
  prior: string[],
): string {
  const runtime = state.npcs[script.id];
  const parts = [
    `You are ${script.name} in the text game Ash Protocol. Stay in that life. One to three sentences.`,
    "The say field is spoken dialogue only. Do not prefix your name. Do not mention JSON, flags, objectives, or that you are a model.",
    runtime?.hostile
      ? "You are hostile. Threaten. Do not help. met must be an empty list."
      : "",
    `Mood: ${mood}.`,
    "",
    "ROLE",
    role.prompt.trim(),
    "",
    `ROOM: ${roomName}.`,
    presenceOf(script, state),
    "",
    "OBJECTIVES",
    objectiveBrief(role, state, utterance),
    "",
    "If a line says EVIDENCE HOLDS and the objective is OPEN, put that flag id in met.",
    "If a line says EVIDENCE DOES NOT HOLD, or the objective is ALREADY MET, do not put that flag in met.",
    "Never put a flag in met that is not listed.",
  ];
  if (prior.length) {
    parts.push("", "The cartridge already told the player:", ...prior.map((text) => `- ${text}`));
    parts.push("Do not repeat that. Leave say empty if you would only repeat it.");
  }
  return parts.filter((part) => part !== "").join("\n");
}

type AgentReply = { say: string; met: string[] };

function cleanSay(text: string): string {
  let say = text.replace(/\s+/g, " ").trim();
  if (
    (say.startsWith('"') && say.endsWith('"')) ||
    (say.startsWith("“") && say.endsWith("”"))
  ) {
    say = say.slice(1, -1).trim();
  }
  if (say.length > 400) say = say.slice(0, 400).trim();
  return say;
}

function parseReply(content: string): AgentReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { say: cleanSay(content), met: [] };
  }
  if (!parsed || typeof parsed !== "object") return { say: "", met: [] };
  const row = parsed as Record<string, unknown>;
  const say = typeof row.say === "string" ? cleanSay(row.say) : "";
  const met = Array.isArray(row.met)
    ? row.met.filter((flag): flag is string => typeof flag === "string")
    : [];
  return { say, met };
}

async function askSubagent(
  role: NpcRole,
  world: World,
  state: GameState,
  utterance: string,
  prior: string[],
  signal: AbortSignal,
): Promise<AgentReply> {
  const npc = world.npcs[role.id];
  const script = npc.script;
  const room = world.rooms[state.roomId];
  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: REPLY_SCHEMA,
      options: { temperature: 0.6, num_predict: 180 },
      messages: [
        {
          role: "system",
          content: systemPrompt(role, script, room.name, npc.state.mood, state, utterance, prior),
        },
        { role: "user", content: `Null says: ${utterance}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const data = (await response.json()) as { message?: { content?: string } };
  return parseReply(data.message?.content ?? "");
}

function itemName(world: World, id: string): string {
  return world.items[id]?.name ?? id;
}

export async function hearRoom(
  world: World,
  state: GameState,
  utterance: string,
  prior: string[] = [],
  signal?: AbortSignal,
): Promise<HearResult> {
  const room = world.rooms[state.roomId];
  const present = room.npcs.filter((id) => state.npcs[id]?.alive);
  if (!present.length) {
    return {
      state,
      lines: [line("body", "Your words sit in the ash. Nobody picks them up.")],
    };
  }

  const loaded = await Promise.all(present.map(async (id) => ({ id, role: await loadRole(id) })));
  const replies = await Promise.all(
    loaded.map(async (agent) => {
      if (!agent.role) {
        return { id: agent.id, role: null, say: "", met: [] as string[], error: "no role" };
      }
      try {
        const reply = await askSubagent(agent.role, world, state, utterance, prior, signal ?? new AbortController().signal);
        return { id: agent.id, role: agent.role, ...reply, error: "" };
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : "silent";
        return { id: agent.id, role: agent.role, say: "", met: [] as string[], error: message };
      }
    }),
  );

  let next = state;
  const lines: GameLine[] = [];
  let failures = 0;
  for (const reply of replies) {
    const script = world.npcs[reply.id].script;
    if (reply.say) lines.push(line("speech", `${script.name}: ${reply.say}`));
    if (reply.role && reply.met.length && !state.npcs[reply.id]?.hostile) {
      const applied = acceptMarks(next, reply.role, utterance, reply.met);
      next = applied.state;
      for (const objective of applied.flipped) {
        lines.push(
          line("sys", `${script.name} meets an objective: ${objective.flag.replaceAll("_", " ")}.`),
        );
        if (objective.grantItems?.length) {
          const names = objective.grantItems.map((id) => itemName(world, id));
          lines.push(line("good", `You receive ${names.join(", ")}.`));
        }
      }
    }
    if (reply.error && !reply.say) failures += 1;
  }
  if (failures === replies.length) {
    return {
      state,
      lines: [line("warn", "The cartridge cannot hear the room. Is Ollama running qwen3:4b?")],
    };
  }
  if (!lines.length) {
    lines.push(line("body", "The room lets the words settle."));
  }
  return { state: next, lines };
}

const ACQUIRE = /\b(?:take|get|grab|pick up|pocket|loot)\b/i;
const LEADING =
  /^(?:please\s+)?(?:take|get|grab|pick up|pocket|loot)\s+(.+)$/i;
const PRONOUN = /^(?:it|them|one|those|these|that|this)$/;
const NO_TAKE = "none";

export type TakeReader = (
  world: World,
  state: GameState,
  utterance: string,
  signal?: AbortSignal,
) => Promise<string | null>;

type Acquire =
  | { kind: "id"; id: string }
  | { kind: "ask" }
  | { kind: "miss" }
  | { kind: "no" };

function mentionsItem(utterance: string, item: ItemDef): boolean {
  const words = new Set(
    utterance.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2),
  );
  const labels = [item.id.replaceAll("-", " "), item.name, ...item.aliases].join(" ");
  return labels
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.length > 2 && words.has(word));
}

function classifyAcquire(world: World, state: GameState, input: string): Acquire {
  const present = itemsInRoom(world, state);
  const ids = present.map((item) => item.id);
  const squashed = input.trim().replace(/\s+/g, " ");
  const leading = LEADING.exec(squashed);
  if (leading) {
    const found = findItem(world, leading[1], ids);
    if (found) return { kind: "id", id: found.id };
    const bare = leading[1]
      .toLowerCase()
      .replace(/[.,!?;:]+$/g, "")
      .replace(/^(?:the|a|an|some|my|your)\s+/, "")
      .trim();
    if (PRONOUN.test(bare)) return { kind: "ask" };
    return { kind: "miss" };
  }
  if (!ACQUIRE.test(squashed)) return { kind: "no" };
  const named = present.filter((item) => mentionsItem(squashed, item));
  if (named.length === 1) return { kind: "id", id: named[0].id };
  if (named.length > 1) return { kind: "ask" };
  return { kind: "no" };
}

export function comeIntoPossession(
  world: World,
  state: GameState,
  itemId: string,
): { ok: boolean; state: GameState; lines: GameLine[] } {
  const item = itemsInRoom(world, state).find((entry) => entry.id === itemId);
  if (!item) {
    const name = world.items[itemId]?.name ?? itemId;
    return {
      ok: false,
      state,
      lines: [line("warn", `There is no ${name} here you can take.`)],
    };
  }
  const pile = state.roomItems[state.roomId];
  const index = pile?.indexOf(item.id) ?? -1;
  if (pile && index >= 0) pile.splice(index, 1);
  state.inventory.push(item.id);
  return { ok: true, state, lines: [line("good", `Taken: ${item.name}.`)] };
}

function possessed(world: World, prev: GameState, itemId: string): CommandResult {
  const state = structuredClone(prev);
  state.turns += 1;
  const owned = comeIntoPossession(world, state, itemId);
  return { state: owned.state, lines: owned.lines, effect: "none" };
}

function takeSchema(ids: string[]) {
  return {
    type: "object",
    properties: {
      take: { type: "string", enum: [NO_TAKE, ...ids] },
    },
    required: ["take"],
  };
}

function parseTake(content: string, ids: string[]): string | null {
  try {
    const row = JSON.parse(content) as { take?: unknown };
    if (typeof row.take !== "string" || row.take === NO_TAKE) return null;
    return ids.includes(row.take) ? row.take : null;
  } catch {
    return null;
  }
}

export async function readPossession(
  world: World,
  state: GameState,
  utterance: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const present = itemsInRoom(world, state);
  if (!present.length) return null;
  const ids = present.map((item) => item.id);
  const room = world.rooms[state.roomId];
  const catalog = present
    .map((item) => `${item.id} — ${item.name}; also called ${item.aliases.join(", ")}`)
    .join("\n");
  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: takeSchema(ids),
      options: { temperature: 0, num_predict: 24 },
      messages: [
        {
          role: "system",
          content: [
            "You are the physics of Ash Protocol, not a character.",
            "Decide whether the player comes into possession of one item that is here.",
            "Do not speak. Do not invent ids.",
            `ROOM: ${room.name}.`,
            "Items on the ground:",
            catalog,
            "",
            "If the player is taking one of those items, set take to its id.",
            'Articles such as "the", "a", and "an" do not change the item.',
            '"take clean filter" and "take the clean filter" are the same act.',
            `If they are not taking an item, set take to ${NO_TAKE}.`,
            "Looking, moving, talking, giving, dropping, buying, selling, and attacking are not taking.",
          ].join("\n"),
        },
        { role: "user", content: utterance },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const data = (await response.json()) as { message?: { content?: string } };
  return parseTake(data.message?.content ?? "", ids);
}

async function finishEngine(
  world: World,
  prev: GameState,
  input: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const result = applyCommand(world, prev, input);
  if (result.state.mode !== "play") return result;
  const utterance = speechUtterance(input);
  if (!utterance) return result;
  const prior = result.lines.filter((entry) => entry.kind === "speech").map((entry) => entry.text);
  const shown = result.lines.filter((entry) => !isUnheardLine(entry));
  const heard = await hearRoom(world, result.state, utterance, prior, signal);
  return { state: heard.state, lines: [...shown, ...heard.lines], effect: result.effect };
}

export function inputWaits(world: World, state: GameState, input: string): boolean {
  if (state.mode !== "play" || isCartridgeMeta(input)) return false;
  const acquire = classifyAcquire(world, state, input);
  if (acquire.kind === "ask") return true;
  return acquire.kind === "no" && speechUtterance(input) !== null;
}

export async function playInput(
  world: World,
  prev: GameState,
  input: string,
  signal?: AbortSignal,
  readTake: TakeReader = readPossession,
): Promise<CommandResult> {
  if (prev.mode !== "play" || isCartridgeMeta(input)) {
    return finishEngine(world, prev, input, signal);
  }

  const acquire = classifyAcquire(world, prev, input);
  if (acquire.kind === "id") return possessed(world, prev, acquire.id);

  if (acquire.kind === "ask") {
    let modelId: string | null = null;
    try {
      modelId = await readTake(world, prev, input, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      modelId = null;
    }
    if (modelId && itemsInRoom(world, prev).some((item) => item.id === modelId)) {
      return possessed(world, prev, modelId);
    }
    const state = structuredClone(prev);
    state.turns += 1;
    return {
      state,
      lines: [line("warn", "There is nothing here by that name you can take.")],
      effect: "none",
    };
  }

  if (acquire.kind === "miss") {
    const state = structuredClone(prev);
    state.turns += 1;
    return {
      state,
      lines: [line("warn", "There is nothing here by that name you can take.")],
      effect: "none",
    };
  }

  return finishEngine(world, prev, input, signal);
}
