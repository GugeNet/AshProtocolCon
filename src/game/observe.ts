import { ensureState, matches } from "./facts.ts";
import type { Dir, GameState, Obstacle, World } from "./types.ts";

const PLAYER = "Null";

function placedItems(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const id of state.inventory ?? []) ids.add(id);
  for (const pile of Object.values(state.roomItems ?? {})) {
    if (!Array.isArray(pile)) continue;
    for (const id of pile) ids.add(id);
  }
  for (const npc of Object.values(state.npcs)) {
    if (!Array.isArray(npc.inventory)) continue;
    for (const id of npc.inventory) ids.add(id);
  }
  return ids;
}

function claim(held: Set<string>, itemId: string): boolean {
  if (held.has(itemId)) return false;
  held.add(itemId);
  return true;
}

export function repairLogs(state: GameState, world?: World): GameState {
  for (const npc of Object.values(state.npcs)) {
    if (!Array.isArray(npc.log)) npc.log = [];
  }
  if (!Array.isArray(state.playerLog)) state.playerLog = [];
  if (!world) return ensureState(state);
  if (!state.roomItems) state.roomItems = {};

  const held = placedItems(state);
  for (const [id, npc] of Object.entries(world.npcs)) {
    if (state.npcs[id]) continue;
    const inventory = npc.state.inventory.filter((itemId) => claim(held, itemId));
    const runtime = {
      alive: npc.state.alive,
      hp: npc.state.hp,
      maxHp: npc.state.maxHp,
      hostile: npc.state.hostile,
      inventory,
      mind: [],
      log: [] as string[],
    };
    state.npcs[id] = runtime;
    const here = Object.values(world.rooms).find((room) => room.npcs.includes(id));
    if (here && here.id === state.roomId && runtime.alive) {
      runtime.log.push(`${PLAYER} comes into the ${here.name}.`);
    }
  }
  for (const room of Object.values(world.rooms)) {
    if (Array.isArray(state.roomItems[room.id])) continue;
    state.roomItems[room.id] = room.ground
      .map((ground) => ground.id)
      .filter((itemId) => claim(held, itemId));
  }
  ensureState(state, world);
  return state;
}

export function remember(state: GameState, text: string): void {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return;
  if (!Array.isArray(state.playerLog)) state.playerLog = [];
  state.playerLog.push(flat);
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

function doorOpen(state: GameState, obstacle: Obstacle, roomId: string): boolean {
  return Boolean(obstacle.when) && matches(state, obstacle.when, roomId);
}

export function blockedDirs(world: World, state: GameState, roomId: string): Dir[] {
  const room = world.rooms[roomId];
  if (!room) return [];
  const dirs: Dir[] = [];
  for (const obstacle of room.obstacles) {
    if (!doorOpen(state, obstacle, roomId) && !dirs.includes(obstacle.dir)) dirs.push(obstacle.dir);
  }
  return dirs;
}

export function noteOpenedDoors(world: World, state: GameState, roomId: string, was: Dir[]): void {
  if (state.roomId !== roomId) return;
  const now = new Set(blockedDirs(world, state, roomId));
  const ids = witnesses(world, state, roomId);
  for (const dir of was) {
    if (!now.has(dir)) {
      witness(state, ids, `Door to ${dir} opens.`);
      remember(state, `Door to ${dir} opens.`);
    }
  }
}

export function noteArrival(world: World, state: GameState, roomId: string): void {
  const room = world.rooms[roomId];
  if (!room) return;
  witness(state, witnesses(world, state, roomId), `${PLAYER} comes into the ${room.name}.`);
  remember(state, `I come into the ${room.name}.`);
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
  remember(state, `${name} replies ${said}`);
}
