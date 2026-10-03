import type { GameState, World } from "./types.ts";

export type JournalPerson = {
  id: string;
  name: string;
  log: string[];
};

export function personFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return "unnamed";
  return cleaned;
}

export function logFileName(name: string): string {
  return `${personFileName(name)}.log`;
}

export function memoryFileName(name: string): string {
  return `${personFileName(name)}.memory.txt`;
}

export function memoryUrl(name: string): string {
  return `/journals/${encodeURIComponent(memoryFileName(name))}`;
}

export const HYPNOS_MARKER = "--- hypnos ---";

export const PLAYER_ID = "null";
export const PLAYER_NAME = "Null";

export function mergeJournal(existing: string, lines: string[]): string {
  const events = lines.map((line) => line.replace(/\r/g, "")).filter((line) => line !== "");
  if (!events.length) return "";
  const fileLines = existing.replace(/\r\n/g, "\n").split("\n");
  if (fileLines.length && fileLines[fileLines.length - 1] === "") fileLines.pop();
  let last = -1;
  for (let index = 0; index < fileLines.length; index++) {
    if (fileLines[index] === HYPNOS_MARKER) last = index;
  }
  if (last < 0) return `${events.join("\n")}\n`;
  const prior = fileLines.slice(0, last).filter((line) => line !== HYPNOS_MARKER && line !== "");
  const matches = prior.length <= events.length && prior.every((line, index) => line === events[index]);
  if (!matches) return `${events.join("\n")}\n`;
  const fresh = events.slice(prior.length);
  return `${[...fileLines.slice(0, last + 1), ...fresh].join("\n")}\n`;
}

export function journalPeople(world: World, state: GameState): JournalPerson[] {
  const people = Object.entries(world.npcs).map(([id, npc]) => ({
    id,
    name: npc.script.name,
    log: state.npcs[id]?.log ?? [],
  }));
  people.push({
    id: PLAYER_ID,
    name: PLAYER_NAME,
    log: state.playerLog ?? [],
  });
  return people;
}

export async function publishJournals(world: World, state: GameState): Promise<void> {
  const res = await fetch("/journals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people: journalPeople(world, state) }),
  });
  if (!res.ok) throw new Error(`The journal was not written (${res.status}).`);
}
