export type Dir = "north" | "south" | "east" | "west";

export type ItemKind = "junk" | "weapon" | "gear" | "key" | "heal" | "oracle";

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
  sellRequiresFlag?: string;
};

export type GroundItem = {
  id: string;
  hiddenUntilFlag?: string;
};

export type Obstacle = {
  dir: Dir;
  anyFlag?: string[];
  anyItem?: string[];
  fail: string;
  pass: string;
};

export type ListenStep = {
  at?: number;
  requiresItem?: string;
  setFlag?: string;
  say: string;
};

export type ListenAction = {
  counter?: string;
  steps: ListenStep[];
};

export type SearchAction = {
  requiresAnyFlags?: string[];
  requiresAnyItems?: string[];
  fail: string;
  onceFlag: string;
  grantItems?: string[];
  grantScrip?: number;
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
  descriptions: { whenFlag?: string; unlessFlag?: string; text: string }[];
  ground: GroundItem[];
  npcs: string[];
  obstacles: Obstacle[];
  onListen?: ListenAction;
  onSearch?: SearchAction;
  win?: boolean;
};

export type TalkRule = {
  requiresFlag?: string;
  requiresItem?: string;
  setFlag?: string;
  grantItems?: string[];
  say: string;
};

export type Topic = {
  say: string;
  setFlag?: string;
};

export type Trade = {
  give: string;
  receive?: string;
  setFlag?: string;
  onceFlag?: string;
  say: string;
};

export type Bribe = {
  cost: number;
  setFlag?: string;
  heal?: boolean;
  say: string;
  already?: string;
};

export type Story = {
  requiresAnyFlags?: string[];
  setFlag?: string;
  grantScrip?: number;
  onceFlag?: string;
  say: string;
  elseSay: string;
  already?: string;
};

export type SayRule = {
  includes: string;
  requiresFlag?: string;
  requiresAnyFlags?: string[];
  requiresAllItems?: string[];
  setFlag?: string;
  consumeItems?: string[];
  grantItems?: string[];
  say: string;
};

export type ShopDef = {
  sells: string[];
  buys: ItemKind[];
};

export type CombatDef = {
  damage: number;
  scrip: number;
  unkillable?: boolean;
  refuse?: string;
  onDeathFlags?: string[];
  onDeathSay: string;
};

export type PresenceWhen = {
  flag: string;
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
  log: string[];
};

export type GameMode = "play" | "dead" | "won";

export type GameState = {
  version: 1;
  mode: GameMode;
  roomId: string;
  previousRoomId: string | null;
  hp: number;
  maxHp: number;
  scrip: number;
  inventory: string[];
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  turns: number;
  visited: string[];
  npcs: Record<string, NpcRuntime>;
  roomItems: Record<string, string[]>;
  combatWith: string | null;
  playerLog: string[];
};

export type Consult = {
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

export type CommandResult = {
  state: GameState;
  lines: GameLine[];
  effect: Effect;
  consult?: Consult;
};
