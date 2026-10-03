import { PLAYER_ID, PLAYER_NAME } from "./journal.ts";
import { noteSpeech, quote, remember } from "./observe.ts";
import type { CommandResult, GameLine, GameState, World } from "./types.ts";

export type Reading = {
  name: string;
  memory: string;
  log: string;
};

export type OracleIo = {
  read: (id: string, signal?: AbortSignal) => Promise<Reading>;
  whisper: (
    prompt: string,
    subject: string,
    reading: Reading,
    signal?: AbortSignal,
  ) => Promise<string>;
  cryptic: (
    world: World,
    state: GameState,
    npcId: string,
    whisper: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  prompt: string;
  pick?: (ids: string[]) => string;
};

const line = (kind: GameLine["kind"], text: string): GameLine => ({ kind, text });

const DARK = "The glass stays dark. There is nobody else here to read.";
const EMPTY = "The glass is empty. Nothing is written there yet.";
const FOG = "The glass fogs and keeps its secret.";
const HYPNOS = "The cartridge cannot read a memory. Hypnos did not answer.";
const QUIET = "The cartridge cannot hear the glass. Is Ollama running qwen3:4b?";
const NO_PROMPT = "The crystal ball has no voice to read with.";
const FALLBACK = "Something you did is still in the room, and it did not come in with you.";

export function peopleBeside(world: World, state: GameState, activator: string): string[] {
  const room = world.rooms[state.roomId];
  if (!room) return [];
  const ids: string[] = [];
  if (activator !== PLAYER_ID) ids.push(PLAYER_ID);
  for (const id of room.npcs) {
    if (id === activator) continue;
    if (!state.npcs[id]?.alive) continue;
    ids.push(id);
  }
  return ids;
}

export function personName(world: World, id: string): string {
  if (id === PLAYER_ID) return PLAYER_NAME;
  return world.npcs[id]?.script.name ?? id;
}

export function cleanWhisper(content: string): string {
  let text = content.replace(/\s+/g, " ").trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fromJson = whisperFromJson(text);
  if (fromJson !== null) text = fromJson;
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("“") && text.endsWith("”") && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }
  if (!text) return "";
  if (/\b(we are writing|you are a crystal|thinking process)\b/i.test(text)) return "";
  if (text.length > 400) text = text.slice(0, 400).trim();
  return text;
}

function fieldFromJson(text: string, field: "whisper" | "say"): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const row = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const value = row[field];
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

function whisperFromJson(text: string): string | null {
  return fieldFromJson(text, "whisper");
}

function pickOne(ids: string[]): string {
  return ids[Math.floor(Math.random() * ids.length)] ?? ids[0];
}

function applyWhisper(state: GameState, activator: string, whisper: string): void {
  const heard = `The crystal ball whispers ${quote(whisper)}`;
  if (activator === PLAYER_ID) {
    remember(state, heard);
    return;
  }
  const npc = state.npcs[activator];
  if (!npc) return;
  if (!Array.isArray(npc.log)) npc.log = [];
  npc.log.push(heard);
}

function spoken(world: World, state: GameState, activator: string, text: string): GameLine {
  if (activator === PLAYER_ID) return line("body", text);
  const name = personName(world, activator);
  noteSpeech(world, state, state.roomId, activator, text);
  return line("speech", `${name}: ${text}`);
}

export async function consultOracle(
  world: World,
  result: CommandResult,
  io: OracleIo,
  signal?: AbortSignal,
): Promise<CommandResult> {
  const consult = result.consult;
  if (!consult) return result;
  const state = result.state;
  const beside = peopleBeside(world, state, consult.activator);
  if (!beside.length) {
    return {
      state,
      lines: [...result.lines, spoken(world, state, consult.activator, DARK)],
      effect: result.effect,
    };
  }

  const subject = (io.pick ?? pickOne)(beside);
  let reading: Reading;
  try {
    reading = await io.read(subject, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return { state, lines: [...result.lines, line("warn", HYPNOS)], effect: result.effect };
  }
  if (!reading.memory.trim() && !reading.log.trim()) {
    return {
      state,
      lines: [...result.lines, spoken(world, state, consult.activator, EMPTY)],
      effect: result.effect,
    };
  }
  if (!io.prompt.trim()) {
    return { state, lines: [...result.lines, line("warn", NO_PROMPT)], effect: result.effect };
  }

  let whisper = "";
  try {
    whisper = cleanWhisper(
      await io.whisper(io.prompt, personName(world, subject), reading, signal),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    whisper = "";
  }
  if (!whisper) {
    return {
      state,
      lines: [...result.lines, spoken(world, state, consult.activator, FOG)],
      effect: result.effect,
    };
  }

  applyWhisper(state, consult.activator, whisper);
  if (consult.activator === PLAYER_ID) {
    return {
      state,
      lines: [...result.lines, line("speech", `The crystal ball whispers, ${quote(whisper)}`)],
      effect: result.effect,
    };
  }

  let cryptic = "";
  try {
    const raw = await io.cryptic(world, state, consult.activator, whisper, signal);
    cryptic = cleanWhisper(fieldFromJson(raw, "say") ?? raw);
  } catch (error) {
    if (signal?.aborted) throw error;
    cryptic = "";
  }
  if (!cryptic) cryptic = FALLBACK;
  return {
    state,
    lines: [...result.lines, spoken(world, state, consult.activator, cryptic)],
    effect: result.effect,
  };
}
