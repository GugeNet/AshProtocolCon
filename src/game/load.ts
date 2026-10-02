import { createWorld } from "./world.ts";
import type { ItemDef, NpcScript, NpcState, RoomDef, World } from "./types.ts";

type IndexFile = {
  start: string;
  rooms: string[];
  npcs: string[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Cartridge missing ${path}`);
  return res.json() as Promise<T>;
}

let pending: Promise<World> | null = null;

export function loadWorld(): Promise<World> {
  if (!pending) pending = fetchWorld();
  return pending;
}

async function fetchWorld(): Promise<World> {
  const index = await getJson<IndexFile>("/ash/index.json");
  const items = await getJson<ItemDef[]>("/ash/items.json");
  const rooms = await Promise.all(
    index.rooms.map((id) => getJson<RoomDef>(`/ash/rooms/${id}.json`)),
  );
  const pairs = await Promise.all(
    index.npcs.map(async (id) => {
      const [script, state] = await Promise.all([
        getJson<NpcScript>(`/ash/npcs/${id}/script.json`),
        getJson<NpcState>(`/ash/npcs/${id}/state.json`),
      ]);
      return { script, state };
    }),
  );
  return createWorld(
    rooms,
    pairs.map((p) => p.script),
    pairs.map((p) => p.state),
    items,
    index.start,
  );
}
