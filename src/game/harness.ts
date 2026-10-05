import {
  applyAction,
  isCartridgeMeta,
  isSlashed,
  parseCommand,
  type Action,
} from "./engine.ts";
import { applyChanges, ensureState, matches } from "./facts.ts";
import {
  blockedDirs,
  englishList,
  memoryFileSection,
  memoryPrompt,
  noteOpenedDoors,
  noteSpeech,
  quote,
  witness,
  witnessAs,
  witnesses,
} from "./observe.ts";
import { legacyMemoryUrl, memoryUrl, publishJournals } from "./journal.ts";
import { interpret, type Interpreter } from "./interpret.ts";
import { askModel } from "./ollama.ts";
import { consultOracle, type Reading } from "./oracle.ts";
import type { Beat, Change, CommandResult, Cond, Fact, GameLine, GameState, NpcScript, World } from "./types.ts";

export type NpcObjective = {
  id: string;
  goal: string;
  utteranceIncludes?: string;
  when?: Cond;
  done?: Cond;
  requiresAllItems?: string[];
  consumeItems?: string[];
  grantItems?: string[];
  change?: Change[];
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

function asFact(raw: unknown): Fact | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.carrying === "string") return { carrying: row.carrying };
  if (typeof row.heldBy === "string" && typeof row.item === "string") return { heldBy: row.heldBy, item: row.item };
  if (typeof row.recalls === "string" && typeof row.npc === "string") return { recalls: row.recalls, npc: row.npc };
  if (typeof row.mind === "string") return { mind: row.mind };
  if (typeof row.place === "string" && typeof row.is === "string") {
    return { place: row.place, is: row.is, ...(typeof row.room === "string" ? { room: row.room } : {}) };
  }
  if (typeof row.wave === "string") return { wave: row.wave };
  if (typeof row.gone === "string") return { gone: row.gone };
  return null;
}

function asCond(raw: unknown): Cond | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if (Array.isArray(row.all) || Array.isArray(row.any)) {
    const list = (value: unknown) =>
      Array.isArray(value)
        ? value.flatMap((entry) => {
            const fact = asFact(entry);
            return fact ? [fact] : [];
          })
        : undefined;
    const all = list(row.all);
    const any = list(row.any);
    if (!all?.length && !any?.length) return undefined;
    return { ...(all?.length ? { all } : {}), ...(any?.length ? { any } : {}) };
  }
  return asFact(raw) ?? undefined;
}

function asChanges(raw: unknown): Change[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const changes: Change[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.remember === "string" && typeof row.line === "string") {
      changes.push({ remember: row.remember, line: row.line });
    } else if (typeof row.recall === "string" && typeof row.line === "string") {
      changes.push({
        recall: row.recall,
        line: row.line,
        ...(typeof row.npc === "string" ? { npc: row.npc } : {}),
      });
    } else if (typeof row.place === "string" && typeof row.is === "string" && typeof row.room === "string") {
      changes.push({ place: row.place, is: row.is, room: row.room });
    } else if (typeof row.wave === "string") {
      changes.push({ wave: row.wave });
    }
  }
  return changes.length ? changes : undefined;
}

function asObjective(raw: unknown): NpcObjective | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.goal !== "string") return null;
  const strings = (value: unknown) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : undefined;
  return {
    id: row.id,
    goal: row.goal,
    utteranceIncludes: typeof row.utteranceIncludes === "string" ? row.utteranceIncludes : undefined,
    when: asCond(row.when),
    done: asCond(row.done),
    requiresAllItems: strings(row.requiresAllItems),
    consumeItems: strings(row.consumeItems),
    grantItems: strings(row.grantItems),
    change: asChanges(row.change),
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

function alreadyMet(state: GameState, objective: NpcObjective): boolean {
  return Boolean(objective.done) && matches(state, objective.done, state.roomId);
}

export function evidenceHolds(state: GameState, objective: NpcObjective, utterance: string): boolean {
  if (alreadyMet(state, objective)) return false;
  if (objective.utteranceIncludes && !wordHas(utterance, objective.utteranceIncludes)) return false;
  if (objective.when && !matches(state, objective.when, state.roomId)) return false;
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
  ensureState(next);
  const allowed = new Map(role.objectives.map((objective) => [objective.id, objective]));
  const flipped: NpcObjective[] = [];
  for (const id of met) {
    const objective = allowed.get(id);
    if (!objective || !evidenceHolds(next, objective, utterance)) continue;
    for (const itemId of objective.consumeItems ?? []) {
      const index = next.inventory.indexOf(itemId);
      if (index >= 0) next.inventory.splice(index, 1);
    }
    for (const itemId of objective.grantItems ?? []) {
      if (!hasItem(next, itemId)) next.inventory.push(itemId);
    }
    applyChanges(next, objective.change);
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
    if (matches(state, alt.when, state.roomId)) text = alt.text;
  }
  return text;
}

function objectiveBrief(role: NpcRole, state: GameState, utterance: string): string {
  if (!role.objectives.length) return "You have no objectives. met must be an empty list.";
  return role.objectives
    .map((objective) => {
      const open = alreadyMet(state, objective) ? "ALREADY MET" : "OPEN";
      const evidence =
        open === "OPEN" && evidenceHolds(state, objective, utterance)
          ? "EVIDENCE HOLDS"
          : "EVIDENCE DOES NOT HOLD";
      return `- ${objective.id} — ${open} — ${evidence}. ${objective.goal}`;
    })
    .join("\n");
}

function memoryText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return raw;
  try {
    const row = JSON.parse(trimmed) as { memory?: unknown };
    return typeof row.memory === "string" ? row.memory : "";
  } catch {
    return "";
  }
}

export function loadMemory(name: string): Promise<string> {
  const read = (url: string) => fetch(url, { cache: "no-store" });
  return read(memoryUrl(name))
    .then(async (res) => {
      if (res.ok) return memoryText(await res.text());
      const legacy = await read(legacyMemoryUrl(name));
      return legacy.ok ? legacy.text() : "";
    })
    .catch(() => "");
}

export type AgentReply = { say: string; met: string[] };

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
    ? row.met.filter((id): id is string => typeof id === "string")
    : [];
  return { say, met };
}

function itemName(world: World, id: string): string {
  return world.items[id]?.name ?? id;
}

export type VoiceAsk = {
  npcId: string;
  role: NpcRole | null;
  utterance?: string;
  beats: Beat[];
  memory: string;
};

export type Voice = (
  world: World,
  state: GameState,
  ask: VoiceAsk,
  signal?: AbortSignal,
) => Promise<AgentReply>;

export type HarnessIo = {
  interpret: Interpreter;
  voice: Voice;
  role: (id: string) => Promise<NpcRole | null>;
  memory: (name: string) => Promise<string>;
};

function distinct(texts: string[]): string[] {
  return [...new Set(texts)];
}

function mindSection(lines: string[]): string {
  if (!lines.length) return "";
  return [
    "WHAT YOU HOLD IN MIND",
    "These inclinations are already yours. They are memory.",
    ...lines.map((entry) => `- ${entry}`),
  ].join("\n");
}

export function voicePrompt(world: World, state: GameState, ask: VoiceAsk): string {
  const npc = world.npcs[ask.npcId];
  const script = npc.script;
  const runtime = state.npcs[ask.npcId];
  const room = world.rooms[state.roomId];
  const parts = [
    `You are ${script.name} in the text game Ash Protocol. Stay in that life. One to three sentences.`,
    "The say field is spoken dialogue only. Do not prefix your name. Do not narrate actions. Do not mention JSON, objectives, or that you are a model.",
    runtime?.hostile ? "You are hostile. Threaten. Do not help. met must be an empty list." : "",
    `Mood: ${npc.state.mood}.`,
    "",
    "ROLE",
    ask.role?.prompt.trim() ?? "",
    "",
    `ROOM: ${room.name}.`,
    presenceOf(script, state),
    "",
    memoryFileSection(ask.memory),
    "",
    mindSection(runtime?.mind?.map((item) => item.line) ?? []),
    "",
    memoryPrompt(runtime?.log),
  ];
  if (ask.utterance !== undefined && ask.role) {
    parts.push(
      "",
      "OBJECTIVES",
      objectiveBrief(ask.role, state, ask.utterance),
      "",
      "If a line says EVIDENCE HOLDS and the objective is OPEN, put that objective id in met.",
      "If a line says EVIDENCE DOES NOT HOLD, or the objective is ALREADY MET, do not put that id in met.",
      "Never put an id in met that is not listed.",
    );
  } else {
    parts.push("", "met must be an empty list.");
  }
  if (ask.beats.length) {
    parts.push(
      "",
      "WHAT JUST HAPPENED",
      ...distinct(ask.beats.map((beat) => `- ${beat.event}`)),
      "",
      "YOU MUST GET ACROSS",
      ...distinct(ask.beats.map((beat) => `- ${beat.gist}`)),
      "",
      "Those lines are notes about you: in them, you are you and they are Null.",
      "Speak to Null directly, as yourself. Never read the notes aloud or repeat them as instructions.",
      "Convey every fact under YOU MUST GET ACROSS, in your own voice. Never contradict it.",
      "Do not add prices, items, or places that are not in it or in your ROLE.",
    );
  }
  return parts.filter((part) => part !== "").join("\n");
}

function voiceCue(ask: VoiceAsk): string {
  const gists = distinct(ask.beats.map((beat) => beat.gist)).join(" ");
  const brief = gists ? `\n\nIn your reply, get across: ${gists}` : "";
  if (ask.utterance !== undefined) return `Null says: ${ask.utterance}${brief}`;
  const events = distinct(ask.beats.map((beat) => beat.event)).join(" ");
  return `${events}${brief}`;
}

export const speak: Voice = async (world, state, ask, signal) => {
  const content = await askModel(
    REPLY_SCHEMA,
    0.6,
    180,
    voicePrompt(world, state, ask),
    voiceCue(ask),
    signal,
  );
  return parseReply(content);
};

export const defaultIo: HarnessIo = {
  interpret,
  voice: speak,
  role: loadRole,
  memory: loadMemory,
};

const STATIC = "Is Ollama running qwen3:4b?";

export async function voiceRoom(
  world: World,
  state: GameState,
  heard: { utterance?: string; beats: Beat[] },
  io: HarnessIo,
  signal?: AbortSignal,
): Promise<HearResult> {
  const roomId = state.roomId;
  const room = world.rooms[roomId];
  const speech = heard.utterance !== undefined;
  const present = room.npcs.filter((id) => state.npcs[id]?.alive);
  const speakers = present.filter(
    (id) => speech || heard.beats.some((beat) => beat.npcId === id),
  );
  if (!speakers.length) return { state, lines: [] };
  const wasBlocked = blockedDirs(world, state, roomId);

  const replies = await Promise.all(
    speakers.map(async (id) => {
      const beats = heard.beats.filter((beat) => beat.npcId === id);
      try {
        const [role, memory] = await Promise.all([
          io.role(id),
          io.memory(world.npcs[id].script.name),
        ]);
        const reply = await io.voice(
          world,
          state,
          { npcId: id, role, utterance: heard.utterance, beats, memory },
          signal,
        );
        return { id, role, beats, ...reply, error: "" };
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : "silent";
        return { id, role: null, beats, say: "", met: [] as string[], error: message };
      }
    }),
  );

  if (!heard.beats.length && replies.every((reply) => reply.error)) {
    return { state, lines: [line("warn", `The cartridge cannot hear the room. ${STATIC}`)] };
  }

  let next = state;
  const lines: GameLine[] = [];
  for (const reply of replies) {
    const script = world.npcs[reply.id].script;
    if (reply.say) {
      lines.push(line("speech", `${script.name}: ${reply.say}`));
      noteSpeech(world, next, roomId, reply.id, reply.say);
    } else if (reply.beats.length) {
      lines.push(
        reply.error
          ? line("warn", `${script.name}'s reply is lost in static. ${STATIC}`)
          : line("body", `${script.name} says nothing.`),
      );
    }
    if (!speech || !reply.role || !reply.met.length || state.npcs[reply.id]?.hostile) continue;
    const applied = acceptMarks(next, reply.role, heard.utterance ?? "", reply.met);
    next = applied.state;
    for (const objective of applied.flipped) {
      lines.push(
        line("sys", `${script.name} meets an objective: ${objective.id.replaceAll("-", " ")}.`),
      );
      if (objective.consumeItems?.length) {
        const handed = englishList(objective.consumeItems.map((id) => itemName(world, id)));
        witness(next, witnesses(world, next), `Null hands over ${handed}.`);
      }
      if (objective.grantItems?.length) {
        const names = objective.grantItems.map((id) => itemName(world, id));
        const goods = englishList(names);
        witnessAs(
          next,
          witnesses(world, next),
          reply.id,
          `I give Null ${goods}.`,
          `${script.name} gives Null ${goods}.`,
        );
        lines.push(line("good", `You receive ${names.join(", ")}.`));
      }
    }
  }
  if (speech && !lines.length) lines.push(line("body", "The room lets the words settle."));
  noteOpenedDoors(world, next, roomId, wasBlocked);
  const still = blockedDirs(world, next, roomId);
  for (const dir of wasBlocked) {
    if (!still.includes(dir)) lines.push(line("good", `The way ${dir} is open.`));
  }
  return { state: next, lines };
}

const WHISPER_SCHEMA = {
  type: "object",
  properties: { whisper: { type: "string" } },
  required: ["whisper"],
};

const CRYPTIC_SCHEMA = {
  type: "object",
  properties: { say: { type: "string" } },
  required: ["say"],
};

const oraclePrompts = new Map<string, Promise<string>>();

export function loadOraclePrompt(itemId: string): Promise<string> {
  const pending = oraclePrompts.get(itemId);
  if (pending) return pending;
  const next = fetch(`/ash/oracles/${itemId}.json`)
    .then(async (res) => {
      if (!res.ok) return "";
      const row = (await res.json()) as { id?: unknown; prompt?: unknown };
      if (row.id !== itemId || typeof row.prompt !== "string") return "";
      return row.prompt;
    })
    .catch(() => "");
  oraclePrompts.set(itemId, next);
  return next;
}

async function readHypnos(
  world: World,
  state: GameState,
  id: string,
  signal?: AbortSignal,
): Promise<Reading> {
  try {
    await publishJournals(world, state);
  } catch {
    // The file may be a turn behind. Hypnos still reads what is on disk.
  }
  const response = await fetch(`/hypnos/read?npc=${encodeURIComponent(id)}`, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Hypnos answered ${response.status}`);
  const row = (await response.json()) as { name?: unknown; memory?: unknown; log?: unknown };
  return {
    name: typeof row.name === "string" ? row.name : id,
    memory: typeof row.memory === "string" ? row.memory : "",
    log: typeof row.log === "string" ? row.log : "",
  };
}

const ABOUT_THE_BALL = /\b(fortune|crystal ball|the glass|whispers)\b/i;

export function readable(log: string): string {
  return log
    .split(/\r?\n/)
    .filter((entry) => entry.trim() && !ABOUT_THE_BALL.test(entry))
    .join("\n")
    .trim();
}

function askBall(
  prompt: string,
  subject: string,
  reading: Reading,
  signal?: AbortSignal,
): Promise<string> {
  return askModel(
    WHISPER_SCHEMA,
    0.3,
    80,
    prompt,
    [
      `SUBJECT: ${subject}`,
      "",
      "MEMORY",
      reading.memory.trim() || "(none)",
      "",
      "LOG",
      readable(reading.log) || "(nothing)",
    ].join("\n"),
    signal,
  );
}

async function askCryptic(
  world: World,
  state: GameState,
  npcId: string,
  whisper: string,
  signal?: AbortSignal,
): Promise<string> {
  const role = await loadRole(npcId);
  const script = world.npcs[npcId]?.script;
  if (!role || !script) return "";
  return askModel(
    CRYPTIC_SCHEMA,
    0.7,
    160,
    [
      `You are ${script.name} in the text game Ash Protocol. Stay in that life. One or two sentences.`,
      "The say field is spoken dialogue only. Do not prefix your name.",
      "",
      "ROLE",
      role.prompt.trim(),
      "",
      "Null asked you to read his fortune. You looked into your crystal ball, and it just whispered about him. He heard it too.",
      "Tell Null, in your own voice, what you make of it and what it may mean for him.",
      "Do not repeat the whisper word for word. Do not invent places, people, prices, or items that are not in it or in your ROLE.",
    ].join("\n"),
    `The ball whispered about Null: ${quote(whisper)}\n\nNow tell Null what you make of it.`,
    signal,
  );
}

const UNREAD =
  "The cartridge could not read that. Is Ollama running qwen3:4b? Slash commands (/help) still work.";

export function inputWaits(state: GameState, input: string): boolean {
  return state.mode === "play" && !isCartridgeMeta(input);
}

export async function playInput(
  world: World,
  prev: GameState,
  input: string,
  signal?: AbortSignal,
  io: Partial<HarnessIo> = {},
): Promise<CommandResult> {
  const use: HarnessIo = { ...defaultIo, ...io };
  let actions: Action[] | null;
  if (prev.mode !== "play" || isSlashed(input)) {
    actions = [parseCommand(input)];
  } else {
    try {
      actions = await use.interpret(world, prev, input, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      actions = null;
    }
    if (!actions?.length) return { state: prev, lines: [line("warn", UNREAD)], effect: "none" };
  }

  let state = prev;
  const lines: GameLine[] = [];
  let effect: CommandResult["effect"] = "none";
  for (const action of actions) {
    const roomId = state.roomId;
    const step = await runAction(world, state, action, use, signal);
    state = step.state;
    lines.push(...step.lines);
    effect = step.effect;
    if (state.mode !== "play" || state.roomId !== roomId || effect !== "none") break;
  }
  return { state, lines, effect };
}

async function runAction(
  world: World,
  prev: GameState,
  action: Action,
  io: HarnessIo,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const result = applyAction(world, prev, action);
  if (result.state.mode !== "play") {
    return { state: result.state, lines: result.lines, effect: result.effect };
  }
  if (result.consult) {
    const prompt = await loadOraclePrompt(result.consult.itemId);
    const read = await consultOracle(
      world,
      result,
      {
        prompt,
        read: (id, readSignal) => readHypnos(world, result.state, id, readSignal),
        whisper: askBall,
        cryptic: askCryptic,
      },
      signal,
    );
    return { state: read.state, lines: read.lines, effect: read.effect };
  }
  const heard = await voiceRoom(
    world,
    result.state,
    { utterance: action.type === "say" ? action.text : undefined, beats: result.beats ?? [] },
    io,
    signal,
  );
  return { state: heard.state, lines: [...result.lines, ...heard.lines], effect: result.effect };
}
