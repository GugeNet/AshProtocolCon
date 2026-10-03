import type { Dir, GameState, Obstacle, World } from "./types.ts";

const PLAYER = "Null";

export function repairLogs(state: GameState): GameState {
  for (const npc of Object.values(state.npcs)) {
    if (!Array.isArray(npc.log)) npc.log = [];
  }
  return state;
}

export function witnesses(world: World, state: GameState, roomId = state.roomId): string[] {
  const room = world.rooms[roomId];
  if (!room) return [];
  return room.npcs.filter((id) => state.npcs[id]?.alive);
}

export function witness(state: GameState, ids: string[], text: string): void {
  for (const id of ids) {
    const npc = state.npcs[id];
    if (!npc) continue;
    if (!Array.isArray(npc.log)) npc.log = [];
    npc.log.push(text);
  }
}

export function witnessAs(
  state: GameState,
  ids: string[],
  selfId: string,
  mine: string,
  theirs: string,
): void {
  for (const id of ids) {
    const npc = state.npcs[id];
    if (!npc) continue;
    if (!Array.isArray(npc.log)) npc.log = [];
    npc.log.push(id === selfId ? mine : theirs);
  }
}

export function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const wrapped =
    (flat.startsWith('"') && flat.endsWith('"') && flat.length >= 2) ||
    (flat.startsWith("“") && flat.endsWith("”") && flat.length >= 2);
  const bare = wrapped ? flat.slice(1, -1).trim() : flat;
  return `"${bare}"`;
}

export function englishList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function tradeNote(exchange: string): string {
  return `Trade happens - ${exchange}.`;
}

export function memoryPrompt(log: string[] | undefined): string {
  if (!log?.length) return "";
  const recent = log.length > 80 ? ["(Earlier events omitted.)", ...log.slice(-80)] : log;
  return ["WHAT YOU HAVE SEEN", "These events already happened. Remember them.", ...recent].join("\n");
}

export function memoryFileSection(text: string): string {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return ["MEMORY", "This is your long memory, written while you slept. It is yours.", trimmed].join("\n");
}

function doorOpen(state: GameState, obstacle: Obstacle): boolean {
  const flagOk = obstacle.anyFlag?.some((flag) => state.flags[flag]) ?? false;
  const itemOk = obstacle.anyItem?.some((id) => state.inventory.includes(id)) ?? false;
  return flagOk || itemOk;
}

export function blockedDirs(world: World, state: GameState, roomId: string): Dir[] {
  const room = world.rooms[roomId];
  if (!room) return [];
  const dirs: Dir[] = [];
  for (const obstacle of room.obstacles) {
    if (!doorOpen(state, obstacle) && !dirs.includes(obstacle.dir)) dirs.push(obstacle.dir);
  }
  return dirs;
}

export function noteOpenedDoors(world: World, state: GameState, roomId: string, was: Dir[]): void {
  if (state.roomId !== roomId) return;
  const now = new Set(blockedDirs(world, state, roomId));
  const ids = witnesses(world, state, roomId);
  for (const dir of was) {
    if (!now.has(dir)) witness(state, ids, `Door to ${dir} opens.`);
  }
}

export function noteArrival(world: World, state: GameState, roomId: string): void {
  const room = world.rooms[roomId];
  if (!room) return;
  witness(state, witnesses(world, state, roomId), `${PLAYER} comes into the ${room.name}.`);
}

export function noteSpeech(
  world: World,
  state: GameState,
  roomId: string,
  speakerId: string,
  text: string,
): void {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return;
  const name = world.npcs[speakerId]?.script.name;
  if (!name) return;
  const said = quote(flat);
  witnessAs(
    state,
    witnesses(world, state, roomId),
    speakerId,
    `I reply ${said}`,
    `${name} replies ${said}`,
  );
}
