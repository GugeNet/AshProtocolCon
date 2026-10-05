export type Dir = "north" | "south" | "east" | "west";

export type ItemKind = "junk" | "weapon" | "gear" | "key" | "heal" | "oracle";

/** A fact that is true inside the world. Rules test these. There is no flag bag. */
export type Fact =
  | { carrying: string }
  | { heldBy: string; item: string }
  | { mind: string }
  | { recalls: string; npc: string }
  | { place: string; is: string; room?: string }
  | { wave: string }
  | { gone: string };

export type When = { all?: Fact[]; any?: Fact[] };

export type Cond = Fact | When;

export type Change =
  | { remember: string; line: string }
  | { recall: string; npc?: string; line: string }
  | { place: string; is: string; room: string }
  | { wave: string };

export type Inclination = { id: string; line: string };

export type ItemDef = {
  id: string;
  name: string;
  aliases: string[];
  kind: ItemKind;
  value: number;
  damage?: number;
  heal?: number;
  text: string;
  useText?: string;
  /** Merchants buy this only while this fact holds. Keys and oracles never sell. */
  sellWhen?: Cond;
};

export type GroundItem = {
  id: string;
  /** Stays out of "You see" until this fact holds. The item is still in the room. */
  hiddenUntil?: Cond;
};

export type Obstacle = {
  dir: Dir;
  /** The way is open while this fact holds. */
  when?: Cond;
  fail: string;
  pass: string;
};

export type ListenStep = {
  at?: number;
  requiresItem?: string;
  change?: Change[];
  say: string;
};

export type ListenAction = {
  counter?: string;
  steps: ListenStep[];
};

export type SearchAction = {
  when?: Cond;
  /** Already searched once this fact holds. */
  done: Cond;
  fail: string;
  grantItems?: string[];
  grantScrip?: number;
  change?: Change[];
  say: string;
  already: string;
};

export type RoomDef = {
  id: string;
  name: string;
  code: string;
  x: number;
  y: number;
  exits: Partial<Record<Dir, string>>;
  /** Starting fixture values, such as a chain up or a seal shut. Copied into the tape. */
  fixtures?: Record<string, string>;
  descriptions: { when?: Cond; unless?: Cond; text: string }[];
  ground: GroundItem[];
  npcs: string[];
  obstacles: Obstacle[];
  onListen?: ListenAction;
  onSearch?: SearchAction;
  win?: boolean;
};

export type TalkRule = {
  when?: Cond;
  requiresItem?: string;
  /** Move this item out of the speaker's pack and into Null's. The rule matches only while they hold it. */
  takeFromSelf?: string;
  change?: Change[];
  grantItems?: string[];
  gist: string;
};

export type Topic = {
  gist: string;
  change?: Change[];
};

export type Trade = {
  give: string;
  receive?: string;
  /** Refuse the trade once this fact holds. */
  once?: Cond;
  change?: Change[];
  gist: string;
};

export type Bribe = {
  cost: number;
  /** Already paid once this fact holds. */
  done?: Cond;
  heal?: boolean;
  change?: Change[];
  gist: string;
  alreadyGist?: string;
};

export type Story = {
  when?: Cond;
  /** Already told once this fact holds. */
  done?: Cond;
  grantScrip?: number;
  change?: Change[];
  gist: string;
  elseGist: string;
  alreadyGist?: string;
};

export type SayRule = {
  includes: string;
  when?: Cond;
  requiresAllItems?: string[];
  change?: Change[];
  consumeItems?: string[];
  grantItems?: string[];
  gist: string;
};

export type ShopDef = {
  sells: string[];
  buys: ItemKind[];
};

export type CombatDef = {
  damage: number;
  scrip: number;
  unkillable?: boolean;
  refuseGist?: string;
  /** What their death does to the world. A door opens because the body cannot hold it. */
  onDeath?: Change[];
  onDeathSay: string;
};

export type PresenceWhen = {
  when: Cond;
  text: string;
};

export type NpcScript = {
  id: string;
  name: string;
  aliases: string[];
  presence: string;
  presenceWhen?: PresenceWhen[];
  greeting: string;
  topics: Record<string, Topic>;
  onTalk?: TalkRule[];
  trades: Trade[];
  bribe?: Bribe;
  story?: Story;
  say: SayRule[];
  combat: CombatDef;
  shop?: ShopDef;
};

export type NpcState = {
  id: string;
  alive: boolean;
  hp: number;
  maxHp: number;
  hostile: boolean;
  mood: string;
  inventory: string[];
};

export type NpcRuntime = {
  alive: boolean;
  hp: number;
  maxHp: number;
  hostile: boolean;
  inventory: string[];
  /** First-person lines this person now holds as memory. The id is how rules name the inclination. */
  mind: Inclination[];
  log: string[];
};

export type GameMode = "play" | "dead" | "won";

export type GameState = {
  version: 1 | 2;
  mode: GameMode;
  roomId: string;
  previousRoomId: string | null;
  hp: number;
  maxHp: number;
  scrip: number;
  inventory: string[];
  /** What Null remembers. The hymn, once heard, lives here. */
  mind: Inclination[];
  /** Fixture values by room id. A chain down, a seal open, a radio hushed. */
  places: Record<string, Record<string, string>>;
  /** Calls loose on the air. The clearance word, once the tower has spoken it. */
  air: string[];
  counters: Record<string, number>;
  turns: number;
  visited: string[];
  npcs: Record<string, NpcRuntime>;
  roomItems: Record<string, string[]>;
  combatWith: string | null;
  playerLog: string[];
};

export type Consult = {
  subject?: string;
  activator: string;
  itemId: string;
};

export type World = {
  start: string;
  items: Record<string, ItemDef>;
  rooms: Record<string, RoomDef>;
  npcs: Record<string, { script: NpcScript; state: NpcState }>;
};

export type LineKind =
  | "echo"
  | "sys"
  | "room"
  | "body"
  | "exit"
  | "speech"
  | "combat"
  | "warn"
  | "good"
  | "map";

export type GameLine = {
  kind: LineKind;
  text: string;
};

export type Effect = "none" | "save" | "load" | "clear" | "exit" | "restart";

export type Beat = {
  npcId: string;
  event: string;
  gist: string;
};

export type CommandResult = {
  state: GameState;
  lines: GameLine[];
  effect: Effect;
  consult?: Consult;
  beats?: Beat[];
};
