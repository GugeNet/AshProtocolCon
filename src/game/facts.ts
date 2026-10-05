import type { Change, Cond, Fact, GameState, Inclination, When, World } from "./types.ts";

const HYMN = "The chapel asked what remains when the fire is spent. The word sits behind my teeth.";
const TOLD_ASH = "I told him ASH is coughing in the chapel radio, north of the market.";
const TRADED_LIGHT = "I took his stim and gave him the glowcapsule. The tin is empty of light.";
const PAID_STORY = "I paid him six scrip for the story of the radio using his voice.";
const SAVED_WORD = "I told him to save the word Ash for the gate and the copy of himself.";
const GAVE_TAPE = "I pressed the cipher tape into his hand.";

function isWhen(value: Cond): value is When {
  return "all" in value || "any" in value;
}

export function eachFact(cond: Cond | undefined): Fact[] {
  if (!cond) return [];
  if (isWhen(cond)) return [...(cond.all ?? []), ...(cond.any ?? [])];
  return [cond];
}

function rememberLine(state: GameState, line: string): void {
  const flat = line.replace(/\s+/g, " ").trim();
  if (!flat) return;
  if (!Array.isArray(state.playerLog)) state.playerLog = [];
  state.playerLog.push(flat);
}

function addMind(list: Inclination[], id: string, line: string): boolean {
  if (list.some((item) => item.id === id)) return false;
  list.push({ id, line });
  return true;
}

export function factHolds(state: GameState, fact: Fact, here: string): boolean {
  if ("carrying" in fact) return state.inventory?.includes(fact.carrying) ?? false;
  if ("heldBy" in fact) return state.npcs?.[fact.heldBy]?.inventory?.includes(fact.item) ?? false;
  if ("recalls" in fact) {
    return state.npcs?.[fact.npc]?.mind?.some((item) => item.id === fact.recalls) ?? false;
  }
  if ("mind" in fact) return state.mind?.some((item) => item.id === fact.mind) ?? false;
  if ("place" in fact) {
    const room = fact.room ?? here;
    return state.places?.[room]?.[fact.place] === fact.is;
  }
  if ("wave" in fact) return state.air?.includes(fact.wave) ?? false;
  if ("gone" in fact) {
    const npc = state.npcs?.[fact.gone];
    return Boolean(npc) && !npc.alive;
  }
  return false;
}

/** A missing condition is true. A `done` check should use factHolds or pass a real condition. */
export function matches(state: GameState, cond: Cond | undefined, here: string): boolean {
  if (!cond) return true;
  const spec: When = isWhen(cond) ? cond : { all: [cond] };
  if (spec.all && !spec.all.every((fact) => factHolds(state, fact, here))) return false;
  if (spec.any && !spec.any.some((fact) => factHolds(state, fact, here))) return false;
  return true;
}

export function applyChanges(state: GameState, changes: Change[] | undefined, actor?: string): void {
  if (!changes?.length) return;
  ensureState(state);
  for (const change of changes) {
    if ("remember" in change) {
      if (addMind(state.mind, change.remember, change.line)) rememberLine(state, change.line);
      continue;
    }
    if ("recall" in change) {
      const npcId = change.npc ?? actor;
      const npc = npcId ? state.npcs[npcId] : undefined;
      if (!npc) continue;
      if (!Array.isArray(npc.mind)) npc.mind = [];
      if (!Array.isArray(npc.log)) npc.log = [];
      if (addMind(npc.mind, change.recall, change.line)) npc.log.push(change.line);
      continue;
    }
    if ("place" in change) {
      const room = state.places[change.room] ?? {};
      state.places[change.room] = room;
      room[change.place] = change.is;
      continue;
    }
    if ("wave" in change && !state.air.includes(change.wave)) state.air.push(change.wave);
  }
}

function migrateFlags(state: GameState): void {
  const bag = state as GameState & { flags?: Record<string, boolean> };
  const flags = bag.flags;
  if (!flags) return;
  const on = (id: string) => flags[id] === true;

  if (on("hymn_heard")) addMind(state.mind, "hymn", HYMN);
  if (on("password_known") && !state.air.includes("cinder")) state.air.push("cinder");
  if (on("shard_a_found")) {
    const well = state.places["ash-well"] ?? {};
    state.places["ash-well"] = well;
    well.cache = "empty";
  }
  if (on("gate_open")) {
    const gate = state.places["protocol-gate"] ?? {};
    state.places["protocol-gate"] = gate;
    gate.seal = "open";
  }
  if (on("ferryman_paid")) {
    const canal = state.places["black-canal"] ?? {};
    state.places["black-canal"] = canal;
    canal.skiff = "loose";
  }
  if (on("pike_passed")) {
    const cut = state.places["smugglers-cut"] ?? {};
    state.places["smugglers-cut"] = cut;
    cut.chain = "down";
  }
  if (on("kite_passed")) {
    const tower = state.places["watchtower"] ?? {};
    state.places["watchtower"] = tower;
    tower.hatch = "open";
  }
  if (on("razor_passed")) {
    const pit = state.places["combat-pit"] ?? {};
    state.places["combat-pit"] = pit;
    pit.stair = "clear";
  }

  const recall = (npcId: string, id: string, line: string) => {
    const npc = state.npcs[npcId];
    if (!npc) return;
    if (!Array.isArray(npc.mind)) npc.mind = [];
    addMind(npc.mind, id, line);
  };
  if (on("heard_coil_ash")) recall("old-coil", "told-ash", TOLD_ASH);
  if (on("coil_traded")) recall("old-coil", "traded-light", TRADED_LIGHT);
  if (on("coil_story")) recall("old-coil", "paid-story", PAID_STORY);
  if (on("heard_sister_ash")) recall("sister-static", "saved-the-word", SAVED_WORD);
  if (on("cipher_got")) recall("ash-fragment", "gave-tape", GAVE_TAPE);

  delete bag.flags;
}

/** Fill mind, fixtures, and the air, and fold a version-1 flag tape into those facts. */
export function ensureState(state: GameState, world?: World): GameState {
  if (!Array.isArray(state.mind)) state.mind = [];
  if (!Array.isArray(state.air)) state.air = [];
  if (!state.places || typeof state.places !== "object") state.places = {};
  for (const npc of Object.values(state.npcs ?? {})) {
    if (!Array.isArray(npc.mind)) npc.mind = [];
  }
  if (world) {
    for (const room of Object.values(world.rooms)) {
      const have = state.places[room.id] ?? {};
      state.places[room.id] = have;
      for (const [name, value] of Object.entries(room.fixtures ?? {})) {
        if (have[name] === undefined) have[name] = value;
      }
    }
  }
  migrateFlags(state);
  state.version = 2;
  return state;
}
