import type {
  CommandResult,
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

type Parsed =
  | { type: "empty" }
  | { type: "unknown"; raw: string }
  | { type: "meta"; cmd: string }
  | { type: "go"; dir: Dir }
  | { type: "look" }
  | { type: "examine"; target: string }
  | { type: "search" }
  | { type: "listen" }
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

function parse(raw: string): Parsed {
  const squashed = raw.trim().replace(/\s+/g, " ");
  if (!squashed) return { type: "empty" };
  if (squashed.startsWith("/")) {
    const cmd = squashed.slice(1).split(" ")[0]?.toLowerCase() ?? "";
    return { type: "meta", cmd: aliasMeta(cmd) };
  }
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
  if ((m = /^(?:drop|leave)\s+(.+)$/.exec(lower))) return { type: "drop", target: m[1] };
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
  if ((m = /^(?:say|answer|shout)\s+(.+)$/.exec(lower))) {
    return { type: "say", text: m[1] };
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
  return parse(input).type === "meta";
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
    if (spec?.hiddenUntilFlag && !state.flags[spec.hiddenUntilFlag]) return false;
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

function obstacleOpen(state: GameState, obstacle: RoomDef["obstacles"][number]): boolean {
  const flagOk = obstacle.anyFlag?.some((f) => state.flags[f]) ?? false;
  const itemOk = obstacle.anyItem?.some((id) => hasItem(state, id)) ?? false;
  return flagOk || itemOk;
}

function dirBlocked(room: RoomDef, state: GameState, dir: Dir): boolean {
  return room.obstacles.some((o) => o.dir === dir && !obstacleOpen(state, o));
}

export function describeRoom(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const lines: GameLine[] = [line("room", room.name.toUpperCase())];
  let text = room.descriptions[0]?.text ?? "";
  for (const desc of room.descriptions) {
    if (desc.whenFlag && !state.flags[desc.whenFlag]) continue;
    if (desc.unlessFlag && state.flags[desc.unlessFlag]) continue;
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
      if (state.flags[alt.flag]) presence = alt.text;
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
        "ASH PROTOCOL  ·  VERBS",
        "",
        "  go north    go south    go east    go west",
        "  n  s  e  w",
        "",
        "  look                 reprint the room",
        "  look at <thing>",
        "  search               listen",
        "  take [the] <item>    drop <item>",
        "  talk <name>",
        "  talk <name> about <topic>",
        "  give <item> to <name>",
        "  tell <name> a story",
        "  say <words>",
        "  buy <item>           sell <item>",
        "  trade                pay <name>",
        "  heal                 use <item>",
        "  attack <name>        flee",
        "  wait",
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
        `SEEN ${state.visited.length}/20`,
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
  if (item.sellRequiresFlag && !state.flags[item.sellRequiresFlag]) return false;
  if (item.kind === "key") return false;
  return buys.includes(item.kind);
}

function hurt(state: GameState, amount: number, lines: GameLine[], source: string): boolean {
  state.hp = Math.max(0, state.hp - amount);
  lines.push(line("combat", `${source} (-${amount} HP, ${state.hp} left).`));
  if (state.hp <= 0) {
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
  for (const flag of script.combat.onDeathFlags ?? []) state.flags[flag] = true;
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
  return hurt(state, script.combat.damage, lines, `${script.name} hits you`);
}

function endRank(state: GameState): string {
  const kills = ["drone_dead", "pike_dead", "kite_dead", "razor_dead"].filter((f) => state.flags[f])
    .length;
  if (kills === 0 && state.hp >= 8) return "PACIFIST SIGNAL";
  if (state.hp >= 10) return "LANTERN COURIER";
  if (state.hp >= 4) return "ASH APPRENTICE";
  return "BLOODY RECEIPT";
}

function winLines(state: GameState): GameLine[] {
  return [
    line(
      "good",
      `TURNS ${state.turns}    ROOMS ${state.visited.length}/20    HP ${state.hp}    SCRIP ${state.scrip}`,
    ),
    line("good", `RANK: ${endRank(state)}`),
    line("sys", "The cartridge hums. /save if you want the tape. /exit cuts the power."),
  ];
}

function move(world: World, state: GameState, dir: Dir): GameLine[] {
  const room = world.rooms[state.roomId];
  const destId = room.exits[dir];
  if (!destId) {
    return [line("warn", `No passage ${dir}. Sintered glass, posters, and the idea of a wall.`)];
  }
  const obstacles = room.obstacles.filter((o) => o.dir === dir);
  for (const obstacle of obstacles) {
    if (!obstacleOpen(state, obstacle)) return [line("warn", obstacle.fail)];
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
  state.previousRoomId = state.roomId;
  state.roomId = destId;
  if (!state.visited.includes(destId)) state.visited.push(destId);
  lines.push(...describeRoom(world, state));
  const dest = world.rooms[destId];
  if (dest.win) {
    state.mode = "won";
    lines.push(...winLines(state));
  }
  return lines;
}

function doSearch(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
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
  if (state.flags[action.onceFlag]) return [line("body", action.already)];
  const flagOk = action.requiresAnyFlags?.some((f) => state.flags[f]) ?? false;
  const itemOk = action.requiresAnyItems?.some((id) => hasItem(state, id)) ?? false;
  const needsFlag = (action.requiresAnyFlags?.length ?? 0) > 0;
  const needsItem = (action.requiresAnyItems?.length ?? 0) > 0;
  const ok = (!needsFlag && !needsItem) || flagOk || itemOk;
  if (!ok) return [line("warn", action.fail)];
  state.flags[action.onceFlag] = true;
  for (const id of action.grantItems ?? []) addItem(state, id);
  if (action.grantScrip) state.scrip += action.grantScrip;
  return [line("good", action.say)];
}

function doListen(world: World, state: GameState): GameLine[] {
  const room = world.rooms[state.roomId];
  const action = room.onListen;
  if (!action) return [line("body", "You listen. The city chews itself, somewhere else.")];
  if (!action.counter) {
    const step = action.steps[0];
    if (!step) return [line("body", "Silence, which is a kind of answer.")];
    if (step.setFlag) state.flags[step.setFlag] = true;
    return [line("speech", step.say)];
  }
  const n = (state.counters[action.counter] ?? 0) + 1;
  state.counters[action.counter] = n;
  const at = action.steps.filter((s) => s.at === n);
  const withItem = at.find((s) => s.requiresItem && hasItem(state, s.requiresItem));
  const plain = at.find((s) => !s.requiresItem);
  const step = withItem ?? plain;
  if (!step) return [line("body", "Only wind, and the wind is out of new words.")];
  if (step.setFlag) state.flags[step.setFlag] = true;
  return [line("speech", step.say)];
}

function doDrop(world: World, state: GameState, target: string): GameLine[] {
  const item = matchItem(world, target, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${target}.`)];
  removeItem(state, item.id);
  state.roomItems[state.roomId].push(item.id);
  return [line("body", `Dropped: ${item.name}.`)];
}

function doExamine(world: World, state: GameState, target: string): GameLine[] {
  const q = target.toLowerCase();
  if (/^(me|self|myself|null)$/.test(q)) {
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
    return [
      line(
        "speech",
        `${script.name}. ${script.presence} (${rt.hp}/${rt.maxHp}, ${script.combat.unkillable ? "not a body you can end" : rt.hostile ? "hostile" : "not hostile"}.)`,
      ),
    ];
  }
  const item = matchItem(world, target, [...state.inventory, ...visibleGround(world, state, room)]);
  if (!item) return [line("warn", `You see no ${target} worth a longer look.`)];
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
    return [line("good", `You take the ${item.name}. HP ${before} → ${state.hp}.`)];
  }
  if (item.useText) return [line("body", item.useText)];
  return [line("body", `You fuss with the ${item.name}. The room declines to change.`)];
}

function doTalk(world: World, state: GameState, target: string, topic?: string): GameLine[] {
  const npcId = matchNpc(world, state, target);
  if (!npcId) return [line("warn", "No one here answers to that.")];
  const script = world.npcs[npcId].script;
  if (topic) {
    const key = matchTopic(script, topic);
    if (!key) {
      const hint = topicHint(script);
      return [
        line("speech", `${script.name} has nothing to say about that.`),
        ...(hint ? [hint] : []),
      ];
    }
    const entry = script.topics[key];
    if (entry.setFlag) state.flags[entry.setFlag] = true;
    return [line("speech", entry.say)];
  }
  if (script.onTalk?.length) {
    const rule = script.onTalk.find((candidate) => talkOk(state, candidate));
    if (rule) {
      if (rule.setFlag) state.flags[rule.setFlag] = true;
      for (const id of rule.grantItems ?? []) {
        if (!hasItem(state, id)) addItem(state, id);
      }
      const lines = [line("speech", rule.say)];
      const hint = topicHint(script);
      if (hint) lines.push(hint);
      return lines;
    }
  }
  const lines = [line("speech", script.greeting)];
  const hint = topicHint(script);
  if (hint) lines.push(hint);
  return lines;
}

function matchTopic(script: NpcScript, query: string): string | null {
  const q = query.toLowerCase().replace(/^the\s+/, "").trim();
  if (script.topics[q]) return q;
  const keys = Object.keys(script.topics);
  return keys.find((key) => q.includes(key) || key.includes(q)) ?? null;
}

function talkOk(state: GameState, rule: TalkRule): boolean {
  if (rule.requiresFlag && !state.flags[rule.requiresFlag]) return false;
  if (rule.requiresItem && !hasItem(state, rule.requiresItem)) return false;
  return true;
}

function sayOk(state: GameState, rule: SayRule): boolean {
  if (rule.requiresFlag && !state.flags[rule.requiresFlag]) return false;
  if (rule.requiresAnyFlags && !rule.requiresAnyFlags.some((f) => state.flags[f])) return false;
  if (rule.requiresAllItems && !rule.requiresAllItems.every((id) => hasItem(state, id))) return false;
  return true;
}

function doSay(world: World, state: GameState, text: string): GameLine[] {
  const room = world.rooms[state.roomId];
  let recognized = false;
  for (const npcId of room.npcs) {
    if (!state.npcs[npcId].alive) continue;
    const script = world.npcs[npcId].script;
    for (const rule of script.say) {
      if (!wordHas(text, rule.includes)) continue;
      recognized = true;
      if (!sayOk(state, rule)) continue;
      if (rule.setFlag) state.flags[rule.setFlag] = true;
      for (const id of rule.consumeItems ?? []) removeItem(state, id);
      for (const id of rule.grantItems ?? []) addItem(state, id);
      return [line("speech", rule.say)];
    }
  }
  if (recognized) {
    return [line("speech", "The room knows that word and is not ready to honor it.")];
  }
  return [line("body", "Your words sit in the ash. Nobody picks them up.")];
}

function doGive(world: World, state: GameState, itemQuery: string, npcQuery: string): GameLine[] {
  const item = matchItem(world, itemQuery, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${itemQuery}.`)];
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "No one here to take it.")];
  const script = world.npcs[npcId].script;
  const trade = script.trades.find((t) => t.give === item.id);
  if (!trade) return [line("speech", `${script.name} looks at the ${item.name} and does not want it.`)];
  if (trade.onceFlag && state.flags[trade.onceFlag]) {
    return [line("speech", `${script.name} has already taken that kind of deal.`)];
  }
  const rt = state.npcs[npcId];
  if (trade.receive) {
    const held = rt.inventory.indexOf(trade.receive);
    if (held < 0) return [line("speech", `${script.name} has nothing left to give you for that.`)];
    rt.inventory.splice(held, 1);
    addItem(state, trade.receive);
  }
  removeItem(state, item.id);
  if (trade.setFlag) state.flags[trade.setFlag] = true;
  if (trade.onceFlag) state.flags[trade.onceFlag] = true;
  return [line("speech", trade.say)];
}

function doStory(world: World, state: GameState, npcQuery: string): GameLine[] {
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "You tell the story to the furniture. The furniture is unmoved.")];
  const script = world.npcs[npcId].script;
  const story = script.story;
  if (!story) return [line("speech", `${script.name} is not your audience.`)];
  if (story.onceFlag && state.flags[story.onceFlag]) {
    return [line("speech", story.already ?? `${script.name} has heard that one.`)];
  }
  if (story.requiresAnyFlags && !story.requiresAnyFlags.some((f) => state.flags[f])) {
    return [line("speech", story.elseSay)];
  }
  if (story.setFlag) state.flags[story.setFlag] = true;
  if (story.onceFlag) state.flags[story.onceFlag] = true;
  if (story.grantScrip) state.scrip += story.grantScrip;
  return [line("speech", story.say)];
}

function doPay(world: World, state: GameState, npcQuery: string): GameLine[] {
  const npcId = matchNpc(world, state, npcQuery);
  if (!npcId) return [line("warn", "No one here is taking payment.")];
  const script = world.npcs[npcId].script;
  const bribe = script.bribe;
  if (!bribe) return [line("speech", `${script.name} does not sell what you are offering to buy.`)];
  if (bribe.setFlag && state.flags[bribe.setFlag]) {
    return [line("speech", bribe.already ?? "That debt is already settled.")];
  }
  if (bribe.heal && state.hp >= state.maxHp) {
    return [line("speech", `${script.name} squints. "Come back when you are actually broken."`)];
  }
  if (state.scrip < bribe.cost) {
    return [line("warn", `You need ${bribe.cost} scrip. You have ${state.scrip}.`)];
  }
  state.scrip -= bribe.cost;
  if (bribe.setFlag) state.flags[bribe.setFlag] = true;
  if (bribe.heal) state.hp = state.maxHp;
  return [line("speech", bribe.say)];
}

function doBuy(world: World, state: GameState, itemQuery: string): GameLine[] {
  const npcId = merchantIn(world, state);
  if (!npcId) return [line("warn", "Nobody here is selling.")];
  const script = world.npcs[npcId].script;
  const shop = script.shop;
  if (!shop) return [line("warn", "Nobody here is selling.")];
  const item = matchItem(world, itemQuery, shop.sells);
  if (!item) return [line("warn", `${script.name} does not stock ${itemQuery}. Try: trade.`)];
  const rt = state.npcs[npcId];
  if (!rt.inventory.includes(item.id)) {
    return [line("speech", `${script.name} spreads empty hands. The ${item.name} is gone.`)];
  }
  if (state.scrip < item.value) {
    return [line("warn", `${item.name} costs ${item.value} scrip. You have ${state.scrip}.`)];
  }
  state.scrip -= item.value;
  rt.inventory.splice(rt.inventory.indexOf(item.id), 1);
  addItem(state, item.id);
  return [line("good", `Bought ${item.name} for ${item.value} scrip. ${state.scrip} left.`)];
}

function doSell(world: World, state: GameState, itemQuery: string): GameLine[] {
  const npcId = merchantIn(world, state);
  if (!npcId) return [line("warn", "Nobody here is buying.")];
  const script = world.npcs[npcId].script;
  const shop = script.shop;
  if (!shop) return [line("warn", "Nobody here is buying.")];
  const item = matchItem(world, itemQuery, state.inventory);
  if (!item) return [line("warn", `You are not carrying ${itemQuery}.`)];
  if (!canSell(item, state, shop.buys)) {
    if (item.sellRequiresFlag && !state.flags[item.sellRequiresFlag]) {
      return [line("speech", `${script.name} taps the ${item.name}. "You still need that. Come back after."`)];
    }
    return [line("speech", `${script.name} will not buy ${item.name}.`)];
  }
  removeItem(state, item.id);
  rtTake(state, npcId, item.id);
  state.scrip += item.value;
  return [line("good", `Sold ${item.name} for ${item.value} scrip. You now have ${state.scrip}.`)];
}

function rtTake(state: GameState, npcId: string, itemId: string) {
  state.npcs[npcId].inventory.push(itemId);
}

function doTrade(world: World, state: GameState): GameLine[] {
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
  return [line("sys", `${script.name.toUpperCase()}  ·  WARES\n${stock}\nBuys: ${buys}.\nbuy <item>    sell <item>`)];
}

function doAttack(world: World, state: GameState, target: string): GameLine[] {
  const npcId = matchNpc(world, state, target);
  if (!npcId) return [line("warn", "You swing at nothing, which is a kind of practice.")];
  const script = world.npcs[npcId].script;
  const rt = state.npcs[npcId];
  if (script.combat.unkillable) {
    return [line("speech", script.combat.refuse ?? "Your blow passes through a recording.")];
  }
  rt.hostile = true;
  state.combatWith = npcId;
  const weapon = bestWeapon(world, state);
  const dmg = weapon?.damage ?? 1;
  const withWhat = weapon ? weapon.name : "your fists";
  rt.hp -= dmg;
  const lines: GameLine[] = [
    line("combat", `You strike ${script.name} with ${withWhat} for ${dmg}. (${Math.max(0, rt.hp)}/${rt.maxHp})`),
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
    lines.push(line("warn", "Nowhere to run. The room is a fist."));
    return lines;
  }
  lines.push(line("good", `You break ${dir}.`));
  lines.push(...move(world, state, dir));
  return lines;
}

function doWait(world: World, state: GameState): GameLine[] {
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
  const parsed = parse(input);
  if (parsed.type === "empty") return { state: prev, lines: [], effect: "none" };

  if (parsed.type === "meta") {
    const meta = metaResult(world, prev, parsed.cmd);
    if (meta) return meta;
    return {
      state: prev,
      lines: [line("warn", `Unknown console command /${parsed.cmd}. Try /help.`)],
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
  state.turns += 1;
  let lines: GameLine[];
  switch (parsed.type) {
    case "unknown":
      lines = [line("warn", `ASH does not know "${parsed.raw}". /help lists the verbs.`)];
      break;
    case "go":
      lines = move(world, state, parsed.dir);
      break;
    case "look":
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
    case "drop":
      lines = doDrop(world, state, parsed.target);
      break;
    case "talk":
      lines = doTalk(world, state, parsed.target, parsed.topic);
      break;
    case "give":
      lines = doGive(world, state, parsed.item, parsed.npc);
      break;
    case "buy":
      lines = doBuy(world, state, parsed.item);
      break;
    case "sell":
      lines = doSell(world, state, parsed.item);
      break;
    case "pay":
      lines = doPay(world, state, parsed.npc);
      break;
    case "attack":
      lines = doAttack(world, state, parsed.target);
      break;
    case "flee":
      lines = doFlee(world, state);
      break;
    case "use":
      lines = doUse(world, state, parsed.item);
      break;
    case "say":
      lines = doSay(world, state, parsed.text);
      break;
    case "story":
      lines = doStory(world, state, parsed.npc);
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
  return { state, lines, effect: "none" };
}

export const SAVE_KEY = "ash-protocol-tape-v1";

const UNHEARD = new Set([
  "Your words sit in the ash. Nobody picks them up.",
  "The room knows that word and is not ready to honor it.",
]);

export function speechUtterance(input: string): string | null {
  const parsed = parse(input);
  if (parsed.type === "say") return parsed.text;
  if (parsed.type === "unknown" && /\s/.test(parsed.raw)) return parsed.raw;
  return null;
}

export function isUnheardLine(entry: GameLine): boolean {
  if (UNHEARD.has(entry.text)) return true;
  return entry.kind === "warn" && entry.text.startsWith('ASH does not know "');
}
