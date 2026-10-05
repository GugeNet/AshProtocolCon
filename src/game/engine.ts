import { applyChanges, matches } from "./facts.ts";
import {
  blockedDirs,
  englishList,
  noteArrival,
  noteOpenedDoors,
  quote,
  remember,
  repairLogs,
  tradeNote,
  witness,
  witnessAs,
  witnesses,
} from "./observe.ts";
import { PLAYER_ID } from "./journal.ts";
import type {
  Beat,
  CommandResult,
  Consult,
  Dir,
  GameLine,
  GameState,
  ItemDef,
  NpcScript,
  RoomDef,
  SayRule,
  TalkRule,
  World,
} from "./types.ts";

const DIRS: Dir[] = ["north", "south", "east", "west"];
const DIR_ALIAS: Record<string, Dir> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  north: "north",
  south: "south",
  east: "east",
  west: "west",
};

export type Action =
  | { type: "empty" }
  | { type: "none" }
  | { type: "unknown"; raw: string }
  | { type: "meta"; cmd: string }
  | { type: "go"; dir: Dir }
  | { type: "look" }
  | { type: "examine"; target: string }
  | { type: "search" }
  | { type: "listen" }
  | { type: "take"; target: string }
  | { type: "drop"; target: string }
  | { type: "talk"; target: string; topic?: string }
  | { type: "give"; item: string; npc: string }
  | { type: "buy"; item: string }
  | { type: "sell"; item: string }
  | { type: "pay"; npc: string }
  | { type: "attack"; target: string }
  | { type: "flee" }
  | { type: "use"; item: string }
  | { type: "say"; text: string }
  | { type: "story"; npc: string }
  | { type: "trade" }
  | { type: "wait" };

const line = (kind: GameLine["kind"], text: string): GameLine => ({ kind, text });

const META = new Set(["help", "inv", "status", "map", "save", "load", "clear", "restart", "exit"]);

export function isSlashed(input: string): boolean {
  return input.trim().startsWith("/");
}

export function parseCommand(raw: string): Action {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const slashed = trimmed.startsWith("/");
  const squashed = slashed ? trimmed.slice(1).trim() : trimmed;
  if (!squashed) return slashed ? { type: "meta", cmd: "" } : { type: "empty" };
  if (slashed && !squashed.includes(" ")) {
    const cmd = aliasMeta(squashed.toLowerCase());
    if (META.has(cmd) || cmd === "look") return { type: "meta", cmd };
  }
  const parsed = parseVerb(squashed);
  if (slashed && parsed.type === "unknown" && !squashed.includes(" ")) {
    return { type: "meta", cmd: aliasMeta(squashed.toLowerCase()) };
  }
  return parsed;
}

function parseVerb(squashed: string): Action {
  const lower = squashed.toLowerCase();
  if (/^(help|\?)$/.test(lower)) return { type: "meta", cmd: "help" };
  if (/^(inventory|inv|i)$/.test(lower)) return { type: "meta", cmd: "inv" };
  if (/^(status|stats|score)$/.test(lower)) return { type: "meta", cmd: "status" };
  if (lower === "map") return { type: "meta", cmd: "map" };
  if (lower === "save") return { type: "meta", cmd: "save" };
  if (lower === "load") return { type: "meta", cmd: "load" };
  if (lower === "clear") return { type: "meta", cmd: "clear" };
  if (lower === "restart") return { type: "meta", cmd: "restart" };
  if (/^(exit|quit)$/.test(lower)) return { type: "meta", cmd: "exit" };

  let m: RegExpExecArray | null;
  if (
    (m =
      /^(?:go|walk|move|run|head)(?:\s+to)?\s+(north|south|east|west|n|s|e|w)$/.exec(
        lower,
      ))
  ) {
    return { type: "go", dir: DIR_ALIAS[m[1]] };
  }
  if (/^(north|south|east|west|n|s|e|w)$/.test(lower)) {
    return { type: "go", dir: DIR_ALIAS[lower] };
  }
  if (/^(look|l)$/.test(lower)) return { type: "look" };
  if ((m = /^(?:look|examine|inspect|x)\s+(?:at\s+)?(.+)$/.exec(lower))) {
    return { type: "examine", target: m[1] };
  }
  if (/^(search|rummage)$/.test(lower)) return { type: "search" };
  if (/^(listen|pray|kneel)$/.test(lower)) return { type: "listen" };
  if ((m = /^(?:take|get|grab|pick up|pocket|loot)\s+(.+)$/.exec(lower))) {
    return { type: "take", target: m[1] };
  }
  if ((m = /^(?:drop|leave)\s+(.+)$/.exec(lower))) return { type: "drop", target: m[1] };
  if (
    (m =
      /^(?:ask|talk|speak)(?:\s+to|\s+with)?\s+(.+?)\s+for\s+(?:(?:a|the|my|your)\s+)?fortune$/.exec(
        lower,
      ))
  ) {
    return { type: "talk", target: m[1], topic: "fortune" };
  }
  if (
    (m =
      /^(?:talk|speak|ask)(?:\s+to|\s+with)?\s+(.+?)(?:\s+about\s+(.+))?$/.exec(lower))
  ) {
    return { type: "talk", target: m[1], topic: m[2] };
  }
  if ((m = /^give\s+(.+?)\s+to\s+(.+)$/.exec(lower))) {
    return { type: "give", item: m[1], npc: m[2] };
  }
  if ((m = /^buy\s+(.+)$/.exec(lower))) return { type: "buy", item: m[1] };
  if ((m = /^sell\s+(.+)$/.exec(lower))) return { type: "sell", item: m[1] };
  if ((m = /^(?:pay|bribe)\s+(.+)$/.exec(lower))) return { type: "pay", npc: m[1] };
  if (/^heal$/.test(lower)) return { type: "pay", npc: "doc" };
  if ((m = /^heal\s+(.+)$/.exec(lower))) return { type: "pay", npc: m[1] };
  if ((m = /^(?:attack|fight|kill|hit|strike)\s+(.+)$/.exec(lower))) {
    return { type: "attack", target: m[1] };
  }
  if (/^(flee|run away|escape)$/.test(lower)) return { type: "flee" };
  if ((m = /^use\s+(.+)$/.exec(lower))) return { type: "use", item: m[1] };
  if ((m = /^(?:say|answer|shout)\s+(.+)$/i.exec(squashed))) {
    return { type: "say", text: m[1].trim() };
  }
  if ((m = /^tell\s+(.+?)\s+(?:a\s+)?story$/.exec(lower))) {
    return { type: "story", npc: m[1] };
  }
  if (/^(trade|shop|wares|browse)$/.test(lower)) return { type: "trade" };
  if (/^(wait|rest|z)$/.test(lower)) return { type: "wait" };
  return { type: "unknown", raw: squashed };
}

function aliasMeta(cmd: string): string {
  if (cmd === "inventory" || cmd === "i") return "inv";
  if (cmd === "stats" || cmd === "score") return "status";
  if (cmd === "quit") return "exit";
  if (cmd === "?") return "help";
  return cmd;
}

function wordHas(text: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function itemName(world: World, id: string): string {
  return world.items[id]?.name ?? id;
}

function named(world: World, ids: string[]): string {
  return englishList(ids.map((id) => itemName(world, id)));
}

function noteTalk(world: World, state: GameState, npcId: string, topic?: string): void {
  const name = world.npcs[npcId].script.name;
  const about = topic ? ` about ${topic}` : "";
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    `Null talks to me${about}.`,
    `Null talks to ${name}${about}.`,
  );
  remember(state, `I talk to ${name}${about}.`);
}

function noteGift(world: World, state: GameState, npcId: string, ids: string[]): void {
  if (!ids.length) return;
  const name = world.npcs[npcId].script.name;
  const goods = named(world, ids);
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    `I give Null ${goods}.`,
    `${name} gives Null ${goods}.`,
  );
}

function noteScrip(world: World, state: GameState, npcId: string, amount: number): void {
  if (!amount) return;
  const name = world.npcs[npcId].script.name;
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    `I give Null ${amount} scrip.`,
    `${name} gives Null ${amount} scrip.`,
  );
}

function noteOffer(world: World, state: GameState, npcId: string, item: string): void {
  const name = world.npcs[npcId].script.name;
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    `Null offers ${item} to me.`,
    `Null offers ${item} to ${name}.`,
  );
  remember(state, `I offer ${item} to ${name}.`);
}

function hasItem(state: GameState, id: string): boolean {
  return state.inventory.includes(id);
}

function addItem(state: GameState, id: string) {
  state.inventory.push(id);
}

function removeItem(state: GameState, id: string): boolean {
  const i = state.inventory.indexOf(id);
  if (i < 0) return false;
  state.inventory.splice(i, 1);
  return true;
}

function bareNoun(query: string): string {
  let q = query.toLowerCase().trim().replace(/\s+/g, " ");
  q = q.replace(/[.,!?;:]+$/g, "").trim();
  while (/^(?:the|a|an|some|my|your|that|this)\s+/.test(q)) {
    q = q.replace(/^(?:the|a|an|some|my|your|that|this)\s+/, "");
  }
  q = q.replace(/[.,!?;:]+$/g, "").trim();
  return q;
}

function matchItem(world: World, query: string, ids: string[]): ItemDef | null {
  const q = bareNoun(query);
  if (q.length < 2) return null;
  const pool = ids.map((id) => world.items[id]).filter(Boolean);
  const score = (item: ItemDef) => {
    if (item.id === q || item.name.toLowerCase() === q) return 100;
    if (item.aliases.some((a) => a === q)) return 90;
    if (item.name.toLowerCase().includes(q) || item.aliases.some((a) => a.includes(q))) {
      return 60;
    }
    return 0;
  };
  const ranked = pool
    .map((item) => ({ item, score: score(item) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].item.id !== ranked[1].item.id) {
    return null;
  }
  return ranked[0].item;
}

export function findItem(world: World, query: string, ids: string[]): ItemDef | null {
  return matchItem(world, query, ids);
}

export function itemsInRoom(world: World, state: GameState): ItemDef[] {
  const room = world.rooms[state.roomId];
  return visibleGround(world, state, room)
    .map((id) => world.items[id])
    .filter((item): item is ItemDef => Boolean(item));
}

export function isCartridgeMeta(input: string): boolean {
  return isSlashed(input) && parseCommand(input).type === "meta";
}

export function oraclesInHands(world: World, state: GameState): ItemDef[] {
  const room = world.rooms[state.roomId];
  const items: ItemDef[] = [];
  for (const npcId of room?.npcs ?? []) {
    const npc = state.npcs[npcId];
    if (!npc?.alive) continue;
    for (const id of npc.inventory) {
      const item = world.items[id];
      if (item?.kind === "oracle" && !items.some((held) => held.id === item.id)) items.push(item);
    }
  }
  return items;
}

function oracleHolder(world: World, state: GameState, itemId: string): string | null {
  const item = world.items[itemId];
  if (!item || item.kind !== "oracle") return null;
  const room = world.rooms[state.roomId];
  for (const npcId of room?.npcs ?? []) {
    const npc = state.npcs[npcId];
    if (!npc?.alive) continue;
    if (npc.inventory.includes(itemId)) return npcId;
  }
  return null;
}

function takeItem(world: World, state: GameState, itemId: string): GameLine[] {
  const item = world.items[itemId];
  const onGround = itemsInRoom(world, state).some((entry) => entry.id === itemId);
  const holder = onGround ? null : oracleHolder(world, state, itemId);
  if (!item || (!onGround && !holder)) {
    return [line("warn", `There is no ${item?.name ?? itemId} here you can take.`)];
  }
  if (onGround) {
    const pile = state.roomItems[state.roomId];
    const index = pile?.indexOf(item.id) ?? -1;
    if (pile && index >= 0) pile.splice(index, 1);
    witness(state, witnesses(world, state), `Null takes ${item.name}.`);
    remember(state, `I take the ${item.name}.`);
  } else if (holder) {
    const pack = state.npcs[holder].inventory;
    const held = pack.indexOf(item.id);
    if (held >= 0) pack.splice(held, 1);
    const name = world.npcs[holder].script.name;
    witnessAs(
      state,
      witnesses(world, state),
      holder,
      `Null takes ${item.name} from me.`,
      `Null takes ${item.name} from ${name}.`,
    );
    remember(state, `I take the ${item.name} from ${name}.`);
  }
  state.inventory.push(item.id);
  return [line("good", `Taken: ${item.name}.`)];
}

function doTake(world: World, state: GameState, target: string): GameLine[] {
  const ground = itemsInRoom(world, state).map((item) => item.id);
  const held = oraclesInHands(world, state).map((item) => item.id);
  const item = matchItem(world, target, ground) ?? matchItem(world, target, held);
  if (!item) return [line("warn", "There is nothing here by that name you can take.")];
  return takeItem(world, state, item.id);
}

export function comeIntoPossession(
  world: World,
  state: GameState,
  itemId: string,
): { ok: boolean; state: GameState; lines: GameLine[] } {
  repairLogs(state, world);
  const roomId = state.roomId;
  const wasBlocked = blockedDirs(world, state, roomId);
  const before = state.inventory.length;
  const lines = takeItem(world, state, itemId);
  noteOpenedDoors(world, state, roomId, wasBlocked);
  return { ok: state.inventory.length > before, state, lines };
}

function npcScore(script: NpcScript, query: string): number {
  const q = query.toLowerCase().trim();
  if (script.id === q || script.name.toLowerCase() === q) return 100;
  if (script.aliases.some((a) => a === q)) return 90;
  if (script.aliases.some((a) => q.includes(a) || a.includes(q))) return 70;
  if (script.name.toLowerCase().includes(q)) return 60;
  return 0;
}

function matchNpc(world: World, state: GameState, query: string, onlyAlive = true): string | null {
  const room = world.rooms[state.roomId];
  const ranked = room.npcs
    .map((id) => ({ id, score: npcScore(world.npcs[id].script, query) }))
    .filter((row) => row.score > 0)
    .filter((row) => !onlyAlive || state.npcs[row.id].alive)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return null;
  return ranked[0].id;
}

function visibleGround(world: World, state: GameState, room: RoomDef): string[] {
  const pile = state.roomItems[room.id] ?? [];
  return pile.filter((id) => {
    const spec = room.ground.find((g) => g.id === id);
    if (spec?.hiddenUntil && !matches(state, spec.hiddenUntil, room.id)) return false;
    return true;
  });
}

function bestWeapon(world: World, state: GameState): ItemDef | null {
  let best: ItemDef | null = null;
  for (const id of state.inventory) {
    const item = world.items[id];
    if (!item || item.kind !== "weapon") continue;
    if (!best || (item.damage ?? 0) > (best.damage ?? 0)) best = item;
  }
  return best;
}

function obstacleOpen(state: GameState, obstacle: RoomDef["obstacles"][number], roomId: string): boolean {
  return Boolean(obstacle.when) && matches(state, obstacle.when, roomId);
}

function dirBlocked(room: RoomDef, state: GameState, dir: Dir): boolean {
  return room.obstacles.some((o) => o.dir === dir && !obstacleOpen(state, o, room.id));
}

export function describeRoom(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const lines: GameLine[] = [line("room", room.name.toUpperCase())];
  let text = room.descriptions[0]?.text ?? "";
  for (const desc of room.descriptions) {
    if (desc.when && !matches(state, desc.when, room.id)) continue;
    if (desc.unless && matches(state, desc.unless, room.id)) continue;
    text = desc.text;
  }
  lines.push(line("body", text));
  const exits = DIRS.filter((d) => room.exits[d]).map((d) => {
    if (dirBlocked(room, state, d)) return `${d} (blocked)`;
    return d;
  });
  lines.push(line("exit", exits.length ? `Exits: ${exits.join(", ")}.` : "Exits: none."));
  const stuff = visibleGround(world, state, room);
  if (stuff.length) {
    const names = stuff.map((id) => itemName(world, id));
    lines.push(line("body", `You see: ${names.join(", ")}.`));
  }
  for (const npcId of room.npcs) {
    const rt = state.npcs[npcId];
    if (!rt?.alive) continue;
    const script = world.npcs[npcId].script;
    let presence = script.presence;
    for (const alt of script.presenceWhen ?? []) {
      if (matches(state, alt.when, state.roomId)) presence = alt.text;
    }
    lines.push(line("speech", presence));
    if (rt.hostile) {
      lines.push(line("warn", `${script.name} is hostile.`));
    }
  }
  return lines;
}

export function introLines(): GameLine[] {
  return [
    line(
      "body",
      "You are Null, a silt-runner with a cracked optic and twenty-four scrip. Three nights ago the market radio used your voice to say: bring the key to the Spire. You do not have the key. You have a dock, a debt, and the habit of trying doors.",
    ),
  ];
}

function helpLines(): GameLine[] {
  return [
    line(
      "sys",
      [
        "ASH PROTOCOL",
        "",
        "Type what Null does or says, in your own words.",
        "The cartridge reads it and the people in the room answer.",
        "",
        "A line that starts with / skips the reading and runs as written:",
        "  /go north   /n /s /e /w",
        "  /look at <thing>     /search     /listen",
        "  /take <item>         /drop <item>",
        "  /talk <name>         /talk <name> about <topic>",
        "  /ask <name> for a fortune",
        "  /give <item> to <name>          /tell <name> a story",
        "  /say <words>",
        "  /buy <item>   /sell <item>   /trade   /pay <name>   /heal",
        "  /use <item>   /attack <name>   /flee   /wait",
        "",
        "CONSOLE",
        "  /help     verbs and slash commands",
        "  /look     reprint the room",
        "  /inv      what you carry",
        "  /status   body, scrip, weapon",
        "  /map      rooms you have seen",
        "  /save     write the tape",
        "  /load     read the tape",
        "  /clear    clear the scrollback",
        "  /restart  boot a new life",
        "  /exit     cut the power",
        "",
        "You win when you reach the final room.",
      ].join("\n"),
    ),
  ];
}

function invLines(world: World, state: GameState): GameLine[] {
  if (!state.inventory.length) {
    return [line("sys", `CARRYING: nothing.\nSCRIP: ${state.scrip}`)];
  }
  const counts = new Map<string, number>();
  for (const id of state.inventory) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows = [...counts.entries()].map(([id, n]) => {
    const name = itemName(world, id);
    return n > 1 ? `  ${name} x${n}` : `  ${name}`;
  });
  return [line("sys", `CARRYING:\n${rows.join("\n")}\nSCRIP: ${state.scrip}`)];
}

function statusLines(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const weapon = bestWeapon(world, state);
  const weaponText = weapon
    ? `${weapon.name} (${weapon.damage})`
    : "fists (1)";
  return [
    line(
      "sys",
      [
        "NULL  ·  SILT RUNNER",
        `HP ${state.hp}/${state.maxHp}`,
        `SCRIP ${state.scrip}`,
        `WEAPON ${weaponText}`,
        `ROOM ${room.name}`,
        `TURN ${state.turns}`,
        `SEEN ${state.visited.length}/${Object.keys(world.rooms).length}`,
      ].join("\n"),
    ),
  ];
}

export function mapText(world: World, state: GameState): string {
  const known = new Set(state.visited);
  for (const id of state.visited) {
    const room = world.rooms[id];
    for (const dir of DIRS) {
      const next = room.exits[dir];
      if (next) known.add(next);
    }
  }
  const cells = Object.values(world.rooms).filter((r) => known.has(r.id));
  if (!cells.length) return "(no map)";
  const minX = Math.min(...cells.map((r) => r.x));
  const maxX = Math.max(...cells.map((r) => r.x));
  const minY = Math.min(...cells.map((r) => r.y));
  const maxY = Math.max(...cells.map((r) => r.y));
  const at = (x: number, y: number) =>
    Object.values(world.rooms).find((r) => r.x === x && r.y === y && known.has(r.id));
  const rows: string[] = ["MAP  ·  * you    ???? unseen"];
  for (let y = maxY; y >= minY; y--) {
    let row = "";
    for (let x = minX; x <= maxX; x++) {
      const room = at(x, y);
      if (!room) {
        row += "      ";
        continue;
      }
      const seen = state.visited.includes(room.id);
      const mark = room.id === state.roomId ? `${room.code}*` : seen ? `${room.code} ` : "????";
      const eastId = room.exits.east;
      const east = eastId ? world.rooms[eastId] : undefined;
      const linked =
        east &&
        known.has(east.id) &&
        east.x === x + 1 &&
        east.y === y &&
        (seen || state.visited.includes(east.id));
      row += mark.padEnd(4, " ").slice(0, 4);
      row += linked ? "--" : "  ";
    }
    rows.push(row.replace(/\s+$/, ""));
    if (y === minY) continue;
    let links = "";
    for (let x = minX; x <= maxX; x++) {
      const room = at(x, y);
      const southId = room?.exits.south;
      const south = southId ? world.rooms[southId] : undefined;
      const linked =
        room &&
        south &&
        known.has(south.id) &&
        south.x === x &&
        south.y === y - 1 &&
        (state.visited.includes(room.id) || state.visited.includes(south.id));
      links += linked ? " |    " : "      ";
    }
    rows.push(links.replace(/\s+$/, ""));
  }
  return rows.join("\n");
}

function topicHint(script: NpcScript): GameLine | null {
  const keys = Object.keys(script.topics);
  if (!keys.length) return null;
  return line("exit", `Ask about: ${keys.join(", ")}.`);
}

function merchantIn(world: World, state: GameState): string | null {
  const room = world.rooms[state.roomId];
  for (const id of room.npcs) {
    if (!state.npcs[id].alive) continue;
    if (world.npcs[id].script.shop) return id;
  }
  return null;
}

function canSell(item: ItemDef, state: GameState, buys: ItemDef["kind"][]): boolean {
  if (item.sellWhen && !matches(state, item.sellWhen, state.roomId)) return false;
  if (item.kind === "key" || item.kind === "oracle") return false;
  return buys.includes(item.kind);
}

function hurt(world: World, state: GameState, amount: number, lines: GameLine[], source: string): boolean {
  state.hp = Math.max(0, state.hp - amount);
  lines.push(line("combat", `${source} (-${amount} HP, ${state.hp} left).`));
  if (state.hp <= 0) {
    witness(state, witnesses(world, state), "Null falls.");
    remember(state, "I fall.");
    state.mode = "dead";
    state.combatWith = null;
    lines.push(
      line(
        "warn",
        "The world goes out like a monitor.\nYou are a rumor in Cinder Reach.\nThe tape still holds the moment before this. /load it, or /restart.",
      ),
    );
    return true;
  }
  return false;
}

function killNpc(world: World, state: GameState, npcId: string, lines: GameLine[]) {
  const script = world.npcs[npcId].script;
  const rt = state.npcs[npcId];
  const watching = witnesses(world, state);
  witnessAs(state, watching, npcId, "I fall.", `${script.name} falls.`);
  rt.hp = 0;
  rt.alive = false;
  rt.hostile = false;
  if (state.combatWith === npcId) state.combatWith = null;
  const roomId = state.roomId;
  for (const id of rt.inventory) {
    state.roomItems[roomId].push(id);
  }
  const dropped = rt.inventory.map((id) => itemName(world, id));
  rt.inventory = [];
  state.scrip += script.combat.scrip;
  applyChanges(state, script.combat.onDeath, npcId);
  const left = witnesses(world, state);
  if (dropped.length) witness(state, left, `${script.name} drops ${englishList(dropped)}.`);
  if (script.combat.scrip > 0) witness(state, left, `Null takes ${script.combat.scrip} scrip.`);
  lines.push(line("combat", script.combat.onDeathSay));
  if (script.combat.scrip > 0) {
    lines.push(line("good", `You take ${script.combat.scrip} scrip.`));
  }
  if (dropped.length) {
    lines.push(line("good", `Left on the ground: ${dropped.join(", ")}.`));
  }
}

function retaliate(world: World, state: GameState, npcId: string, lines: GameLine[]): boolean {
  const script = world.npcs[npcId].script;
  const rt = state.npcs[npcId];
  if (!rt.alive) return false;
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    "I hit Null.",
    `${script.name} hits Null.`,
  );
  remember(state, `${script.name} hits me.`);
  return hurt(world, state, script.combat.damage, lines, `${script.name} hits you`);
}

function endRank(state: GameState): string {
  const kills = ["drone-mite", "pike", "sentry-kite", "razor-saint"].filter(
    (id) => state.npcs[id] && !state.npcs[id].alive,
  ).length;
  if (kills === 0 && state.hp >= 8) return "PACIFIST SIGNAL";
  if (state.hp >= 10) return "LANTERN COURIER";
  if (state.hp >= 4) return "ASH APPRENTICE";
  return "BLOODY RECEIPT";
}

function winLines(world: World, state: GameState): GameLine[] {
  return [
    line(
      "good",
      `TURNS ${state.turns}    ROOMS ${state.visited.length}/${Object.keys(world.rooms).length}    HP ${state.hp}    SCRIP ${state.scrip}`,
    ),
    line("good", `RANK: ${endRank(state)}`),
    line("sys", "The cartridge hums. /save if you want the tape. /exit cuts the power."),
  ];
}

function move(world: World, state: GameState, dir: Dir, how: "goes" | "flees" = "goes"): GameLine[] {
  const room = world.rooms[state.roomId];
  const origin = state.roomId;
  const destId = room.exits[dir];
  if (!destId) {
    witness(state, witnesses(world, state, origin), `Null tries to go ${dir}.`);
    remember(state, `I try to go ${dir}.`);
    return [line("warn", `No passage ${dir}. Sintered glass, posters, and the idea of a wall.`)];
  }
  const obstacles = room.obstacles.filter((o) => o.dir === dir);
  for (const obstacle of obstacles) {
    if (!obstacleOpen(state, obstacle, room.id)) {
      witness(state, witnesses(world, state, origin), `Null tries to go ${dir}.`);
      remember(state, `I try to go ${dir}.`);
      return [line("warn", obstacle.fail)];
    }
  }
  const lines: GameLine[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.pass) lines.push(line("good", obstacle.pass));
  }
  if (state.combatWith) {
    const foe = state.combatWith;
    if (state.npcs[foe]?.alive && state.npcs[foe].hostile) {
      if (retaliate(world, state, foe, lines)) return lines;
    }
    state.combatWith = null;
  }
  witness(state, witnesses(world, state, origin), `Null ${how} ${dir}.`);
  remember(state, how === "flees" ? `I flee ${dir}.` : `I go ${dir}.`);
  state.previousRoomId = state.roomId;
  state.roomId = destId;
  if (!state.visited.includes(destId)) state.visited.push(destId);
  noteArrival(world, state, destId);
  lines.push(...describeRoom(world, state));
  const dest = world.rooms[destId];
  if (dest.win) {
    state.mode = "won";
    lines.push(...winLines(world, state));
  }
  return lines;
}

function doSearch(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const watching = witnesses(world, state);
  witness(state, watching, "Null searches.");
  remember(state, "I search.");
  const action = room.onSearch;
  if (!action) {
    const stuff = visibleGround(world, state, room);
    if (!stuff.length) return [line("body", "You search. The room has already shown you its teeth.")];
    return [
      line(
        "body",
        `You search and find only what was already in the open: ${stuff.map((id) => itemName(world, id)).join(", ")}.`,
      ),
    ];
  }
  if (matches(state, action.done, room.id)) return [line("body", action.already)];
  if (action.when && !matches(state, action.when, room.id)) return [line("warn", action.fail)];
  applyChanges(state, action.change);
  for (const id of action.grantItems ?? []) addItem(state, id);
  if (action.grantScrip) state.scrip += action.grantScrip;
  const found = [
    ...(action.grantItems?.length ? [named(world, action.grantItems)] : []),
    ...(action.grantScrip ? [`${action.grantScrip} scrip`] : []),
  ];
  if (found.length) {
    witness(state, watching, `Null finds ${englishList(found)}.`);
    remember(state, `I find ${englishList(found)}.`);
  }
  return [line("good", action.say)];
}

function doListen(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const watching = witnesses(world, state);
  witness(state, watching, "Null listens.");
  remember(state, "I listen.");
  const action = room.onListen;
  if (!action) return [line("body", "You listen. The city chews itself, somewhere else.")];
  if (!action.counter) {
    const step = action.steps[0];
    if (!step) return [line("body", "Silence, which is a kind of answer.")];
    applyChanges(state, step.change);
    witness(state, watching, `The room says ${quote(step.say)}`);
    remember(state, `The room says ${quote(step.say)}`);
    return [line("speech", step.say)];
  }
  const n = (state.counters[action.counter] ?? 0) + 1;
  state.counters[action.counter] = n;
  const at = action.steps.filter((s) => s.at === n);
  const withItem = at.find((s) => s.requiresItem && hasItem(state, s.requiresItem));
  const plain = at.find((s) => !s.requiresItem);
  const step = withItem ?? plain;
  if (!step) return [line("body", "Only wind, and the wind is out of new words.")];
  applyChanges(state, step.change);
  witness(state, watching, `The room says ${quote(step.say)}`);
  remember(state, `The room says ${quote(step.say)}`);
  return [line("speech", step.say)];
}

function doDrop(world: World, state: GameState, target: string): GameLine[] {
  const item = matchItem(world, target, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${target}.`)];
  removeItem(state, item.id);
  state.roomItems[state.roomId].push(item.id);
  witness(state, witnesses(world, state), `Null drops ${item.name}.`);
  remember(state, `I drop the ${item.name}.`);
  return [line("body", `Dropped: ${item.name}.`)];
}

function doExamine(world: World, state: GameState, target: string): GameLine[] {
  const q = target.toLowerCase();
  const watching = witnesses(world, state);
  if (/^(me|self|myself|null)$/.test(q)) {
    witness(state, watching, "Null looks at himself.");
    remember(state, "I look at myself.");
    return [
      line(
        "body",
        "Null. Cracked optic, wet boots, the posture of a person who will try the door anyway.",
      ),
    ];
  }
  const room = world.rooms[state.roomId];
  const npcId = matchNpc(world, state, target, false);
  if (npcId && state.npcs[npcId].alive) {
    const script = world.npcs[npcId].script;
    const rt = state.npcs[npcId];
    witnessAs(
      state,
      watching,
      npcId,
      "Null looks at me.",
      `Null looks at ${script.name}.`,
    );
    remember(state, `I look at ${script.name}.`);
    return [
      line(
        "speech",
        `${script.name}. ${script.presence} (${rt.hp}/${rt.maxHp}, ${script.combat.unkillable ? "not a body you can end" : rt.hostile ? "hostile" : "not hostile"}.)`,
      ),
    ];
  }
  const item = matchItem(world, target, [...state.inventory, ...visibleGround(world, state, room)]);
  if (!item) return [line("warn", `You see no ${target} worth a longer look.`)];
  witness(state, watching, `Null looks at ${item.name}.`);
  remember(state, `I look at the ${item.name}.`);
  return [line("body", item.text)];
}

function doUse(world: World, state: GameState, target: string): GameLine[] {
  const item = matchItem(world, target, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${target}.`)];
  if (item.kind === "heal") {
    if (state.hp >= state.maxHp) return [line("body", "You are already as whole as this town allows.")];
    removeItem(state, item.id);
    const before = state.hp;
    state.hp = Math.min(state.maxHp, state.hp + (item.heal ?? 0));
    witness(state, witnesses(world, state), `Null uses ${item.name}.`);
    remember(state, `I use the ${item.name}.`);
    return [line("good", `You take the ${item.name}. HP ${before} → ${state.hp}.`)];
  }
  witness(state, witnesses(world, state), `Null uses ${item.name}.`);
  remember(state, `I use the ${item.name}.`);
  if (item.kind === "oracle") {
    return [line("body", `You cup the ${item.name}. The glass goes cold.`)];
  }
  if (item.useText) return [line("body", item.useText)];
  return [line("body", `You fuss with the ${item.name}. The room declines to change.`)];
}

function beat(beats: Beat[], npcId: string, event: string, gist: string): void {
  if (gist.trim()) beats.push({ npcId, event, gist: gist.trim() });
}

function received(world: World, ids: string[]): GameLine[] {
  return ids.length ? [line("good", `You receive ${named(world, ids)}.`)] : [];
}

function doTalk(
  world: World,
  state: GameState,
  beats: Beat[],
  target: string,
  topic?: string,
): GameLine[] {
  const npcId = matchNpc(world, state, target);
  if (!npcId) return [line("warn", "No one here answers to that.")];
  const script = world.npcs[npcId].script;
  const hint = topicHint(script);
  if (topic) {
    const event = `Null asks you about ${topic}.`;
    const key = matchTopic(script, topic);
    noteTalk(world, state, npcId, topic);
    if (!key) {
      beat(
        beats,
        npcId,
        event,
        `Answer in character. You know nothing special about ${topic}, so do not invent facts about it.`,
      );
      return hint ? [hint] : [];
    }
    const entry = script.topics[key];
    applyChanges(state, entry.change, npcId);
    beat(beats, npcId, event, entry.gist);
    return [];
  }
  const event = "Null talks to you.";
  if (script.onTalk?.length) {
    const rule = script.onTalk.find((candidate) => talkOk(state, candidate, npcId));
    if (rule) {
      applyChanges(state, rule.change, npcId);
      const granted = (rule.grantItems ?? []).filter((id) => !hasItem(state, id));
      if (rule.takeFromSelf) {
        const held = state.npcs[npcId].inventory;
        const index = held.indexOf(rule.takeFromSelf);
        if (index >= 0) {
          held.splice(index, 1);
          if (!hasItem(state, rule.takeFromSelf)) granted.push(rule.takeFromSelf);
        }
      }
      for (const id of granted) addItem(state, id);
      noteTalk(world, state, npcId);
      noteGift(world, state, npcId, granted);
      beat(beats, npcId, event, rule.gist);
      return [...received(world, granted), ...(hint ? [hint] : [])];
    }
  }
  noteTalk(world, state, npcId);
  beat(beats, npcId, event, script.greeting || "Acknowledge them in character.");
  return hint ? [hint] : [];
}

function matchTopic(script: NpcScript, query: string): string | null {
  const q = query.toLowerCase().replace(/^the\s+/, "").trim();
  if (script.topics[q]) return q;
  const keys = Object.keys(script.topics);
  return keys.find((key) => q.includes(key) || key.includes(q)) ?? null;
}

function talkOk(state: GameState, rule: TalkRule, npcId: string): boolean {
  if (rule.when && !matches(state, rule.when, state.roomId)) return false;
  if (rule.requiresItem && !hasItem(state, rule.requiresItem)) return false;
  if (rule.takeFromSelf && !state.npcs[npcId]?.inventory.includes(rule.takeFromSelf)) return false;
  return true;
}

function sayOk(state: GameState, rule: SayRule): boolean {
  if (rule.when && !matches(state, rule.when, state.roomId)) return false;
  if (rule.requiresAllItems && !rule.requiresAllItems.every((id) => hasItem(state, id))) return false;
  return true;
}

function doSay(world: World, state: GameState, beats: Beat[], text: string): GameLine[] {
  const room = world.rooms[state.roomId];
  const listening = room.npcs.filter((npcId) => state.npcs[npcId]?.alive);
  if (!listening.length) return [line("body", "Your words sit in the ash. Nobody picks them up.")];
  const event = `Null says ${quote(text)}`;
  for (const npcId of listening) {
    const script = world.npcs[npcId].script;
    for (const rule of script.say) {
      if (!wordHas(text, rule.includes)) continue;
      if (!sayOk(state, rule)) continue;
      applyChanges(state, rule.change, npcId);
      const consumed: string[] = [];
      for (const id of rule.consumeItems ?? []) {
        if (removeItem(state, id)) consumed.push(id);
      }
      for (const id of rule.grantItems ?? []) addItem(state, id);
      if (consumed.length) {
        witness(state, witnesses(world, state), `Null hands over ${named(world, consumed)}.`);
      }
      noteGift(world, state, npcId, rule.grantItems ?? []);
      beat(beats, npcId, event, rule.gist);
      return [
        ...(consumed.length ? [line("good", `You hand over ${named(world, consumed)}.`)] : []),
        ...received(world, rule.grantItems ?? []),
      ];
    }
  }
  return [];
}

function doGive(
  world: World,
  state: GameState,
  beats: Beat[],
  itemQuery: string,
  npcQuery: string,
): GameLine[] {
  const item = matchItem(world, itemQuery, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${itemQuery}.`)];
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "No one here to take it.")];
  const script = world.npcs[npcId].script;
  const event = `Null offers you the ${item.name}.`;
  const trade = script.trades.find((t) => t.give === item.id);
  if (!trade && item.kind === "oracle") {
    removeItem(state, item.id);
    state.npcs[npcId].inventory.push(item.id);
    witnessAs(
      state,
      witnesses(world, state),
      npcId,
      `Null gives me the ${item.name}.`,
      `Null gives ${script.name} the ${item.name}.`,
    );
    remember(state, `I give ${script.name} the ${item.name}.`);
    return [line("good", `${script.name} takes the ${item.name}.`)];
  }
  const refuse = (gist: string) => {
    noteOffer(world, state, npcId, item.name);
    beat(beats, npcId, event, gist);
    return [line("sys", `${script.name} does not take the ${item.name}.`)];
  };
  if (!trade) return refuse(`Refuse the ${item.name}. You have no use for it.`);
  if (trade.once && matches(state, trade.once, state.roomId)) {
    return refuse(`Refuse the ${item.name}. You already made that deal with them once.`);
  }
  const rt = state.npcs[npcId];
  if (trade.receive) {
    const held = rt.inventory.indexOf(trade.receive);
    if (held < 0) {
      return refuse(
        `Refuse the ${item.name}. You have nothing left to give for it; the ${itemName(world, trade.receive)} is gone.`,
      );
    }
    rt.inventory.splice(held, 1);
    addItem(state, trade.receive);
  }
  removeItem(state, item.id);
  rtTake(state, npcId, item.id);
  applyChanges(state, trade.change, npcId);
  const exchange = trade.receive ? `${item.name} for ${itemName(world, trade.receive)}` : item.name;
  witness(state, witnesses(world, state), tradeNote(exchange));
  beat(beats, npcId, `Null gives you the ${item.name}.`, trade.gist);
  return [
    line("good", `${script.name} takes the ${item.name}.`),
    ...received(world, trade.receive ? [trade.receive] : []),
  ];
}

function doStory(world: World, state: GameState, beats: Beat[], npcQuery: string): GameLine[] {
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "You tell the story to the furniture. The furniture is unmoved.")];
  const script = world.npcs[npcId].script;
  const story = script.story;
  const event = "Null tells you a story.";
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    "Null tells me a story.",
    `Null tells ${script.name} a story.`,
  );
  if (!story) {
    beat(beats, npcId, event, "You are not interested in their story. You are not their audience.");
    return [];
  }
  if (story.done && matches(state, story.done, state.roomId)) {
    beat(beats, npcId, event, story.alreadyGist ?? "You have heard that one already.");
    return [];
  }
  if (story.when && !matches(state, story.when, state.roomId)) {
    beat(beats, npcId, event, story.elseGist || "The story does not move you.");
    return [];
  }
  applyChanges(state, story.change, npcId);
  if (story.grantScrip) state.scrip += story.grantScrip;
  noteScrip(world, state, npcId, story.grantScrip ?? 0);
  beat(beats, npcId, event, story.gist);
  return story.grantScrip
    ? [line("good", `${script.name} gives you ${story.grantScrip} scrip. You have ${state.scrip}.`)]
    : [];
}

function doPay(world: World, state: GameState, beats: Beat[], npcQuery: string): GameLine[] {
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "No one here is taking payment.")];
  const script = world.npcs[npcId].script;
  const bribe = script.bribe;
  const event = "Null offers you scrip.";
  if (!bribe) {
    beat(beats, npcId, event, "Refuse the money. You do not sell what they are trying to buy.");
    return [line("sys", `${script.name} does not take the scrip.`)];
  }
  if (bribe.done && matches(state, bribe.done, state.roomId)) {
    beat(beats, npcId, event, bribe.alreadyGist ?? "That debt is already settled. Refuse more money.");
    return [line("sys", "That is already paid.")];
  }
  if (bribe.heal && state.hp >= state.maxHp) {
    beat(beats, npcId, event, "They are not hurt. Tell them to come back when they are actually broken.");
    return [line("sys", "You are not hurt.")];
  }
  if (state.scrip < bribe.cost) {
    return [line("warn", `You need ${bribe.cost} scrip. You have ${state.scrip}.`)];
  }
  state.scrip -= bribe.cost;
  applyChanges(state, bribe.change, npcId);
  const before = state.hp;
  if (bribe.heal) state.hp = state.maxHp;
  witnessAs(
    state,
    witnesses(world, state),
    npcId,
    `Null pays me ${bribe.cost} scrip.`,
    `Null pays ${script.name} ${bribe.cost} scrip.`,
  );
  beat(beats, npcId, `Null pays you ${bribe.cost} scrip.`, bribe.gist);
  const lines = [line("good", `You pay ${script.name} ${bribe.cost} scrip. ${state.scrip} left.`)];
  if (bribe.heal) lines.push(line("good", `HP ${before} → ${state.hp}.`));
  return lines;
}

function doBuy(world: World, state: GameState, beats: Beat[], itemQuery: string): GameLine[] {
  const npcId = merchantIn(world, state);
  if (!npcId) return [line("warn", "Nobody here is selling.")];
  const script = world.npcs[npcId].script;
  const shop = script.shop;
  if (!shop) return [line("warn", "Nobody here is selling.")];
  const item = matchItem(world, itemQuery, shop.sells);
  if (!item) return [line("warn", `${script.name} does not stock ${itemQuery}. Try: trade.`)];
  const rt = state.npcs[npcId];
  if (!rt.inventory.includes(item.id)) {
    beat(beats, npcId, `Null asks to buy the ${item.name}.`, `You are out of ${item.name}. It is gone.`);
    return [line("warn", `${script.name} has no ${item.name} left.`)];
  }
  if (state.scrip < item.value) {
    return [line("warn", `${item.name} costs ${item.value} scrip. You have ${state.scrip}.`)];
  }
  state.scrip -= item.value;
  rt.inventory.splice(rt.inventory.indexOf(item.id), 1);
  addItem(state, item.id);
  witness(state, witnesses(world, state), tradeNote(`1 ${item.name} for ${item.value} scrip`));
  return [line("good", `Bought ${item.name} for ${item.value} scrip. ${state.scrip} left.`)];
}

function doSell(world: World, state: GameState, beats: Beat[], itemQuery: string): GameLine[] {
  const npcId = merchantIn(world, state);
  if (!npcId) return [line("warn", "Nobody here is buying.")];
  const script = world.npcs[npcId].script;
  const shop = script.shop;
  if (!shop) return [line("warn", "Nobody here is buying.")];
  const item = matchItem(world, itemQuery, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${itemQuery}.`)];
  if (!canSell(item, state, shop.buys)) {
    const event = `Null tries to sell you the ${item.name}.`;
    if (item.sellWhen && !matches(state, item.sellWhen, state.roomId)) {
      beat(beats, npcId, event, `Refuse to buy the ${item.name}. They still need it; come back after.`);
    } else {
      beat(beats, npcId, event, `Refuse to buy the ${item.name}. You do not deal in that.`);
    }
    return [line("sys", `${script.name} will not buy the ${item.name}.`)];
  }
  removeItem(state, item.id);
  rtTake(state, npcId, item.id);
  state.scrip += item.value;
  witness(state, witnesses(world, state), tradeNote(`1 ${item.name} for ${item.value} scrip`));
  return [line("good", `Sold ${item.name} for ${item.value} scrip. You now have ${state.scrip}.`)];
}

function rtTake(state: GameState, npcId: string, itemId: string) {
  state.npcs[npcId].inventory.push(itemId);
}

function doTrade(world: World, state: GameState): GameLine[] {
  witness(state, witnesses(world, state), "Null looks over the wares.");
  remember(state, "I look over the wares.");
  const npcId = merchantIn(world, state);
  if (!npcId) return [line("body", "Nobody here has wares. The room is not a shop, however much it charges you.")];
  const script = world.npcs[npcId].script;
  const shop = script.shop!;
  const rt = state.npcs[npcId];
  const counts = new Map<string, number>();
  for (const id of rt.inventory) {
    if (!shop.sells.includes(id)) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const rows = [...counts.entries()].map(([id, n]) => {
    const item = world.items[id];
    return `  ${item.name} — ${item.value} scrip${n > 1 ? ` (${n})` : ""}`;
  });
  const buys = shop.buys.join(", ");
  const stock = rows.length ? rows.join("\n") : "  (shelves bare)";
  return [line("sys", `${script.name.toUpperCase()}  ·  WARES\n${stock}\nBuys: ${buys}.\nSay what you want to buy or sell, or /buy <item>  /sell <item>.`)];
}

function doAttack(world: World, state: GameState, beats: Beat[], target: string): GameLine[] {
  const npcId = matchNpc(world, state, target);
  if (!npcId) {
    witness(state, witnesses(world, state), "Null swings at nothing.");
    remember(state, "I swing at nothing.");
    return [line("warn", "You swing at nothing, which is a kind of practice.")];
  }
  const script = world.npcs[npcId].script;
  const rt = state.npcs[npcId];
  const weapon = bestWeapon(world, state);
  const withWhat = weapon ? weapon.name : "fists";
  witness(state, witnesses(world, state), `Null strikes ${script.name} with ${withWhat}.`);
  remember(
    state,
    weapon ? `I strike ${script.name} with the ${withWhat}.` : `I strike ${script.name} with fists.`,
  );
  if (script.combat.unkillable) {
    beat(
      beats,
      npcId,
      `Null strikes at you with ${weapon ? `the ${withWhat}` : "fists"}.`,
      script.combat.refuseGist ?? "The blow does nothing to you. You cannot be hurt this way.",
    );
    return [line("combat", `Your blow does nothing to ${script.name}.`)];
  }
  rt.hostile = true;
  state.combatWith = npcId;
  const dmg = weapon?.damage ?? 1;
  rt.hp -= dmg;
  const lines: GameLine[] = [
    line("combat", `You strike ${script.name} with ${weapon ? weapon.name : "your fists"} for ${dmg}. (${Math.max(0, rt.hp)}/${rt.maxHp})`),
  ];
  if (rt.hp <= 0) {
    killNpc(world, state, npcId, lines);
    return lines;
  }
  if (retaliate(world, state, npcId, lines)) return lines;
  return lines;
}

function doFlee(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const foe =
    state.combatWith && state.npcs[state.combatWith]?.alive
      ? state.combatWith
      : room.npcs.find((id) => state.npcs[id].alive && state.npcs[id].hostile);
  if (!foe) return [line("body", "Nothing is chasing you. The city does that later.")];
  const lines: GameLine[] = [];
  if (retaliate(world, state, foe, lines)) return lines;
  state.combatWith = null;
  const back = state.previousRoomId;
  const backDir = DIRS.find((d) => room.exits[d] === back && !dirBlocked(room, state, d));
  const dir = backDir ?? DIRS.find((d) => room.exits[d] && !dirBlocked(room, state, d));
  if (!dir || !room.exits[dir]) {
    witness(state, witnesses(world, state), "Null tries to flee.");
    remember(state, "I try to flee.");
    lines.push(line("warn", "Nowhere to run. The room is a fist."));
    return lines;
  }
  lines.push(line("good", `You break ${dir}.`));
  lines.push(...move(world, state, dir, "flees"));
  return lines;
}

function isFortune(topic: string): boolean {
  return /^(?:(?:a|the|my|your)\s+)?fortune$/.test(topic.trim().toLowerCase());
}

function heldOracle(world: World, state: GameState, npcId: string): string | null {
  const pack = state.npcs[npcId]?.inventory ?? [];
  return pack.find((id) => world.items[id]?.kind === "oracle") ?? null;
}

function beginFortune(
  world: World,
  state: GameState,
  beats: Beat[],
  npcId: string,
): { lines: GameLine[]; consult?: Consult } {
  const script = world.npcs[npcId].script;
  noteTalk(world, state, npcId, "fortune");
  const itemId = heldOracle(world, state, npcId);
  if (!itemId) {
    beat(
      beats,
      npcId,
      "Null asks you for a fortune.",
      "The glass is not in your hands, so there is no fortune. You do not read palms: palms lie, and they charge extra.",
    );
    return { lines: [line("sys", `${script.name} has no crystal ball to read.`)] };
  }
  const name = world.items[itemId]?.name ?? "crystal ball";
  return {
    lines: [line("body", `${script.name} sets both hands on the ${name} and listens.`)],
    consult: { activator: npcId, itemId, subject: PLAYER_ID },
  };
}

function doWait(world: World, state: GameState): GameLine[] {
  witness(state, witnesses(world, state), "Null waits.");
  remember(state, "I wait.");
  const foe = state.combatWith;
  if (foe && state.npcs[foe]?.alive && state.npcs[foe].hostile) {
    const lines: GameLine[] = [line("body", "You hesitate.")];
    retaliate(world, state, foe, lines);
    return lines;
  }
  return [line("body", "You wait. The ash keeps its appointments.")];
}

function metaResult(world: World, state: GameState, cmd: string): CommandResult | null {
  if (cmd === "help") return { state, lines: helpLines(), effect: "none" };
  if (cmd === "look") return { state, lines: describeRoom(world, state), effect: "none" };
  if (cmd === "inv") return { state, lines: invLines(world, state), effect: "none" };
  if (cmd === "status") return { state, lines: statusLines(world, state), effect: "none" };
  if (cmd === "map") return { state, lines: [line("map", mapText(world, state))], effect: "none" };
  if (cmd === "save") {
    return {
      state,
      lines: [line("sys", "Writing tape…")],
      effect: "save",
    };
  }
  if (cmd === "load") return { state, lines: [line("sys", "Reading tape…")], effect: "load" };
  if (cmd === "clear") return { state, lines: [], effect: "clear" };
  if (cmd === "exit") return { state, lines: [], effect: "exit" };
  if (cmd === "restart") return { state, lines: [], effect: "restart" };
  return null;
}

export function applyCommand(world: World, prev: GameState, input: string): CommandResult {
  return applyAction(world, prev, parseCommand(input));
}

export function applyAction(world: World, prev: GameState, parsed: Action): CommandResult {
  if (parsed.type === "empty") return { state: prev, lines: [], effect: "none" };
  if (parsed.type === "none") {
    return {
      state: prev,
      lines: [line("body", "Nothing comes of that. Put it another way, or try /help.")],
      effect: "none",
    };
  }

  if (parsed.type === "meta") {
    const meta = metaResult(world, prev, parsed.cmd);
    if (meta) return meta;
    return {
      state: prev,
      lines: [line("warn", `Unknown console command /${parsed.cmd}. Try /help, or drop the slash and say it.`)],
      effect: "none",
    };
  }

  if (prev.mode === "won") {
    return {
      state: prev,
      lines: [line("sys", "The cartridge has ended. /restart for another life, or /exit to cut power.")],
      effect: "none",
    };
  }
  if (prev.mode === "dead") {
    return {
      state: prev,
      lines: [line("warn", "You are a rumor. /load the last tape, or /restart.")],
      effect: "none",
    };
  }

  const state: GameState = structuredClone(prev);
  repairLogs(state, world);
  state.turns += 1;
  const roomId = state.roomId;
  const wasBlocked = blockedDirs(world, state, roomId);
  if (parsed.type === "say") {
    witness(state, witnesses(world, state), `Null says ${quote(parsed.text)}`);
    remember(state, `I say ${quote(parsed.text)}`);
  }
  const beats: Beat[] = [];
  let lines: GameLine[];
  let consult: Consult | undefined;
  switch (parsed.type) {
    case "unknown":
      lines = [
        line("warn", `ASH does not know "/${parsed.raw}". /help lists the commands, or drop the slash and say it.`),
      ];
      break;
    case "go":
      lines = move(world, state, parsed.dir);
      break;
    case "look":
      witness(state, witnesses(world, state), "Null looks around.");
      remember(state, "I look around.");
      lines = describeRoom(world, state);
      break;
    case "examine":
      lines = doExamine(world, state, parsed.target);
      break;
    case "search":
      lines = doSearch(world, state);
      break;
    case "listen":
      lines = doListen(world, state);
      break;
    case "take":
      lines = doTake(world, state, parsed.target);
      break;
    case "drop":
      lines = doDrop(world, state, parsed.target);
      break;
    case "talk": {
      const npcId =
        parsed.topic && isFortune(parsed.topic) ? matchNpc(world, state, parsed.target) : null;
      if (npcId) {
        const fortune = beginFortune(world, state, beats, npcId);
        lines = fortune.lines;
        consult = fortune.consult;
        break;
      }
      lines = doTalk(world, state, beats, parsed.target, parsed.topic);
      break;
    }
    case "give":
      lines = doGive(world, state, beats, parsed.item, parsed.npc);
      break;
    case "buy":
      lines = doBuy(world, state, beats, parsed.item);
      break;
    case "sell":
      lines = doSell(world, state, beats, parsed.item);
      break;
    case "pay":
      lines = doPay(world, state, beats, parsed.npc);
      break;
    case "attack":
      lines = doAttack(world, state, beats, parsed.target);
      break;
    case "flee":
      lines = doFlee(world, state);
      break;
    case "use": {
      const used = matchItem(world, parsed.item, state.inventory);
      lines = doUse(world, state, parsed.item);
      if (used?.kind === "oracle") consult = { activator: PLAYER_ID, itemId: used.id };
      break;
    }
    case "say":
      lines = doSay(world, state, beats, parsed.text);
      break;
    case "story":
      lines = doStory(world, state, beats, parsed.npc);
      break;
    case "trade":
      lines = doTrade(world, state);
      break;
    case "wait":
      lines = doWait(world, state);
      break;
    default:
      lines = [line("warn", "The parser shrugged.")];
  }
  noteOpenedDoors(world, state, roomId, wasBlocked);
  if (state.roomId === roomId && state.mode === "play") {
    const still = blockedDirs(world, state, roomId);
    for (const dir of wasBlocked) {
      if (!still.includes(dir)) lines.push(line("good", `The way ${dir} is open.`));
    }
  }
  const result: CommandResult = { state, lines, effect: "none" };
  if (consult) result.consult = consult;
  if (beats.length) result.beats = beats;
  return result;
}

export const SAVE_KEY = "ash-protocol-tape-v1";
