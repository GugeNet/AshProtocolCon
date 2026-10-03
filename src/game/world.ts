import { noteArrival } from "./observe.ts";
import type {
  Dir,
  GameState,
  ItemDef,
  NpcScript,
  NpcState,
  RoomDef,
  World,
} from "./types.ts";

const DIRS: Dir[] = ["north", "south", "east", "west"];
const DELTA: Record<Dir, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

export function createWorld(
  roomsIn: RoomDef[],
  scripts: NpcScript[],
  states: NpcState[],
  itemsIn: ItemDef[],
  start = "silt-dock",
): World {
  const items: World["items"] = {};
  for (const item of itemsIn) {
    if (items[item.id]) throw new Error(`duplicate item ${item.id}`);
    items[item.id] = item;
  }

  const rooms: World["rooms"] = {};
  for (const room of roomsIn) {
    if (rooms[room.id]) throw new Error(`duplicate room ${room.id}`);
    rooms[room.id] = room;
  }

  const npcs: World["npcs"] = {};
  for (const script of scripts) {
    const state = states.find((s) => s.id === script.id);
    if (!state) throw new Error(`npc ${script.id} missing state`);
    if (npcs[script.id]) throw new Error(`duplicate npc ${script.id}`);
    npcs[script.id] = { script, state };
  }
  for (const state of states) {
    if (!npcs[state.id]) throw new Error(`state ${state.id} missing script`);
  }

  if (!rooms[start]) throw new Error(`missing start room ${start}`);

  const needItem = (id: string, where: string) => {
    if (!items[id]) throw new Error(`unknown item ${id} at ${where}`);
  };

  for (const room of Object.values(rooms)) {
    for (const dir of DIRS) {
      const destId = room.exits[dir];
      if (!destId) continue;
      const dest = rooms[destId];
      if (!dest) throw new Error(`${room.id} exit ${dir} → missing ${destId}`);
      const [dx, dy] = DELTA[dir];
      if (dest.x !== room.x + dx || dest.y !== room.y + dy) {
        throw new Error(
          `${room.id} ${dir} to ${destId} is not adjacent (${room.x},${room.y}) → (${dest.x},${dest.y})`,
        );
      }
    }
    for (const npcId of room.npcs) {
      if (!npcs[npcId]) throw new Error(`${room.id} unknown npc ${npcId}`);
    }
    for (const g of room.ground) needItem(g.id, room.id);
    for (const step of room.onListen?.steps ?? []) {
      if (step.requiresItem) needItem(step.requiresItem, `${room.id} listen`);
    }
    for (const id of room.onSearch?.grantItems ?? []) needItem(id, `${room.id} search`);
    for (const id of room.onSearch?.requiresAnyItems ?? []) needItem(id, `${room.id} search need`);
    for (const o of room.obstacles) {
      for (const id of o.anyItem ?? []) needItem(id, `${room.id} obstacle`);
    }
  }

  for (const { script, state } of Object.values(npcs)) {
    for (const id of state.inventory) needItem(id, `${script.id} pack`);
    for (const id of script.shop?.sells ?? []) needItem(id, `${script.id} shop`);
    for (const trade of script.trades) {
      needItem(trade.give, `${script.id} trade`);
      if (trade.receive) needItem(trade.receive, `${script.id} trade receive`);
    }
    for (const rule of script.onTalk ?? []) {
      if (rule.requiresItem) needItem(rule.requiresItem, `${script.id} talk`);
      for (const id of rule.grantItems ?? []) needItem(id, `${script.id} grant`);
    }
    for (const rule of script.say) {
      for (const id of rule.requiresAllItems ?? []) needItem(id, `${script.id} say`);
      for (const id of rule.consumeItems ?? []) needItem(id, `${script.id} consume`);
      for (const id of rule.grantItems ?? []) needItem(id, `${script.id} say grant`);
    }
  }

  const placed = new Set<string>();
  for (const { script } of Object.values(npcs)) {
    for (const room of Object.values(rooms)) {
      if (room.npcs.includes(script.id)) {
        if (placed.has(script.id)) throw new Error(`npc ${script.id} in two rooms`);
        placed.add(script.id);
      }
    }
    if (!placed.has(script.id)) throw new Error(`npc ${script.id} not placed`);
  }

  return { start, items, rooms, npcs };
}

export function initialState(world: World): GameState {
  const npcs: GameState["npcs"] = {};
  for (const [id, npc] of Object.entries(world.npcs)) {
    npcs[id] = {
      alive: npc.state.alive,
      hp: npc.state.hp,
      maxHp: npc.state.maxHp,
      hostile: npc.state.hostile,
      inventory: [...npc.state.inventory],
      log: [],
    };
  }
  const roomItems: Record<string, string[]> = {};
  for (const room of Object.values(world.rooms)) {
    roomItems[room.id] = room.ground.map((g) => g.id);
  }
  const state: GameState = {
    version: 1,
    mode: "play",
    roomId: world.start,
    previousRoomId: null,
    hp: 14,
    maxHp: 14,
    scrip: 24,
    inventory: ["bent-multitool", "stim"],
    flags: {},
    counters: {},
    turns: 0,
    visited: [world.start],
    npcs,
    roomItems,
    combatWith: null,
    playerLog: [],
  };
  noteArrival(world, state, world.start);
  return state;
}
