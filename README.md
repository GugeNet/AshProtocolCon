# Ash Protocol

A twenty-room text adventure in the browser. You are Null, a silt-runner in Cinder Reach. Three nights ago the market radio used your voice and told you to bring the key to the Spire. You start on Silt Dock with a bent multitool, one stim, 14 HP, and 24 scrip. You win when you walk into the Spire Core.

The cartridge is JSON under `public/ash/`. A rules engine handles movement, talk, trade, and combat. A named take is resolved in the browser. Free speech, and a take that is only a pronoun or is ambiguous, go to a local model: **Qwen3:4b**, served by **Ollama**.

## Run

Node 20 or newer.

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`. **New cartridge** starts a life. **Continue** appears when this browser already has a tape.

Ollama needs to be running on this machine with the model pulled:

```bash
ollama pull qwen3:4b
ollama serve
```

The page posts to `/ollama/api/chat`. Vite forwards that to `http://127.0.0.1:11434`. While `npm run dev` is running, each request and reply prints in that terminal as `[qwen #N]`, including the model, options, messages, status, and reply. `npm run preview` still proxies Ollama and stays quiet.

Scripted verbs keep working if Ollama is down. `say`, other free speech, and an ambiguous take then answer: "The cartridge cannot hear the room. Is Ollama running qwen3:4b?"

```bash
npm run build    # tsc --noEmit, then the Vite production build
npm run preview
```

Tests load the cartridge from `public/ash/` and walk a full route to the Spire:

```bash
node --experimental-strip-types --test src/game/harness.test.ts src/game/observe.test.ts src/game/journal.test.ts src/game/walkthrough.test.ts
python -m unittest hypnos_test.py
npx tsc --noEmit
```

## How to play

Type at the `>` prompt and press Enter. The compass, Look, Search, Talk, and Map buttons send the same commands. Up and down arrow walk the command history. A line that starts with `/` offers the slash commands.

The header shows the room, HP, and scrip. HP under 5 turns red.

`/help` prints this list inside the game.

| Command | What it does |
| --- | --- |
| `go north` `go south` `go east` `go west` | Move. `n` `s` `e` `w` and `walk` / `head` work too. |
| `look` `l` | Reprint the room, exits, visible items, and who is here. |
| `look at <thing>` | Examine an item, a person, or yourself. `examine`, `inspect`, and `x` match. |
| `search` | Look for what the room is holding back. |
| `listen` | Hear a room that has a line to speak. `pray` and `kneel` do the same. |
| `take <item>` | Pick up something on the ground. `get`, `grab`, `pick up` match. `take the clean filter` is the same act as `take clean filter`. |
| `drop <item>` | Leave it in the room. |
| `talk <name>` | Greeting, then topics when that person has any. |
| `talk <name> about <topic>` | One topic from their script. |
| `give <item> to <name>` | A trade written on that person. |
| `tell <name> a story` | Their story, when they have one. |
| `say <words>` | Speak. The script may answer, and then the people in the room. |
| `trade` | A merchant's shelf. `shop`, `wares`, and `browse` match. |
| `buy <item>` `sell <item>` | With a merchant in the room. |
| `pay <name>` | Spend scrip on a bribe or a healing. `bribe` matches. `heal` finds Doc. |
| `use <item>` | Stims and anything else with a use line. |
| `attack <name>` | Strike. They hit back. `fight`, `kill`, `hit`, and `strike` match. |
| `flee` | Leave a fight, usually the way you came. |
| `wait` | Pass a moment. In a fight, they still swing. `rest` and `z` match. |

| Console | What it does |
| --- | --- |
| `/help` | Verbs and slash commands. `help` and `?` match. |
| `/look` | Reprint the room. |
| `/inv` | What you carry, and your scrip. `inventory` and `i` match. |
| `/status` | HP, scrip, weapon, room, turn, rooms seen. |
| `/map` | Rooms you have entered, and doors you have seen. |
| `/save` | Write the tape. Living turns already write it. |
| `/load` | Read the tape. |
| `/clear` | Clear the scroll and reprint the room. |
| `/restart` | Boot a new life. Type it twice. The shelf tape stays until a living turn overwrites it. |
| `/exit` | Cut the power and return to the title. Type it twice. |

### Speech

A line the parser knows stays with the rules: `go north`, `talk coil about ash`, `attack drone`.

`say <words>` is spoken aloud. So is any other line of more than one word that the parser does not recognize, such as `coil sent me`. Each living person in the room answers through Qwen3:4b, in that life, in one to three sentences.

The scroll shows "The room is listening…" while that call is in flight. Another command cancels it.

A flag from speech lands only when the harness already sees the evidence: the words, the flags, and the items that objective requires. The model names candidate flags. The harness accepts them.

### Taking things

A take that names one item on the ground is resolved in the browser. The item leaves the room and enters your pack. That path does not call Ollama.

`take it`, or a sentence that could mean more than one thing on the ground, asks Qwen3:4b to choose a single id from the items that are here. The reply is an enum of those ids, or `none`.

### Combat, scrip, death, and the ending

The best weapon in your pack is what you strike with. Fists do 1 damage. The bent multitool does 2. Some people cannot be killed; they refuse the blow. A person who falls drops their pack on the ground and whatever scrip they were worth.

Scrip is the coin. Merchants buy some item kinds and refuse keys. `trade` lists prices.

Death does not write the tape. The message tells you that you are a rumor. `/load` restores the last living moment. `/restart` begins again from Silt Dock.

Every living turn autosaves to `localStorage` under the key `ash-protocol-tape-v1`. `/save` writes that same tape on purpose. A corpse cannot be saved.

The Spire Core ends the cartridge. The rank comes from how many fights you finished and how much HP you have left: Pacifist Signal, Lantern Courier, Ash Apprentice, or Bloody Receipt. After that, `/restart` and `/exit` are the commands that still change the screen.

`/map` draws the grid. `*` is you. A three-letter code is a room you have entered. `????` is a neighboring room you have seen a door to and have not entered.

## Content

`public/ash/` is the cartridge. `src/game/load.ts` fetches it once and caches the world.

```
public/ash/
  index.json             start room, room ids, npc ids
  items.json             the item catalog
  rooms/<id>.json        one room
  npcs/<id>/
    script.json          rules the engine runs
    state.json           hp, mood, hostility, starting pack
    role.json            voice and objectives for Qwen3
```

`index.json` sets the start to `silt-dock` and lists 20 rooms and 12 people. A file that is missing from the index is never loaded.

`src/game/world.ts` builds the world and refuses a bad cartridge: a duplicate id, an exit to a missing room, an exit that is not on the neighboring grid cell, an unknown item id, a person placed in two rooms, or a person placed in none.

### Rooms

Each room has an `id`, a display `name`, a three-letter map `code`, grid `x` and `y`, `exits`, `descriptions`, `ground`, `npcs`, and `obstacles`.

Exits are `north`, `south`, `east`, and `west`, and each value is another room id. North increases `y`. East increases `x`. The map is this grid.

Descriptions are tried in order. `whenFlag` shows that text only after the flag is set. `unlessFlag` hides that text once the flag is set. The last matching text is the one you read.

`ground` is a list of `{ id, hiddenUntilFlag? }`. A hidden item stays out of "You see" until the flag is set. It can still be in the room's pile.

An obstacle blocks one direction until you hold any listed flag or any listed item. It has a `fail` line and a `pass` line.

`onListen` is what `listen` plays. A step can set a flag. A `counter` picks the step for that visit, and a step can require an item. `onSearch` can require flags or items, then once grant items, scrip, and a flag.

`"win": true` ends the game when you enter. That room is `spire-core`.

### Items

`items.json` is the catalog. Kinds are `junk`, `weapon`, `gear`, `key`, and `heal`.

| Field | Use |
| --- | --- |
| `aliases` | How the parser and the take prompt recognize it. |
| `value` | Price in scrip, both ways. |
| `damage` | Weapon damage. The best one in your pack is used. |
| `heal` | HP restored by `use` on a `heal` item. The item is consumed. |
| `text` | What `look at` prints. |
| `useText` | What `use` prints when the item is not a heal. |
| `sellRequiresFlag` | Merchants refuse the sale until this flag is set. Keys never sell. |

A new game puts `bent-multitool` and `stim` in your pack. Everything else starts on a room floor or in someone's inventory.

### People

`script.json` is the deterministic character.

| Field | Use |
| --- | --- |
| `aliases` | Names `talk`, `give`, `pay`, and `attack` accept. |
| `presence` | The line in the room description. `presenceWhen` replaces it after a flag. |
| `greeting` | `talk` with no topic, when no `onTalk` rule matches. |
| `topics` | `talk <name> about <topic>`. A topic can set a flag. The topic names are listed after a greeting. |
| `onTalk` | The first matching rule on a bare `talk`. It can require a flag or an item, set a flag, and grant items. |
| `trades` | `give <item> to <name>`. Can return something from their pack, set a flag, and happen once. |
| `bribe` | `pay` / `bribe`. A scrip cost, an optional flag, an optional full heal. |
| `story` | `tell <name> a story`. Can require flags, pay scrip, and happen once. |
| `say` | A word inside `say <words>`. Can require flags and items, consume items, grant items, and set a flag. |
| `combat` | Damage they deal, scrip they drop, optional `unkillable` and `refuse`, death flags, and the death line. |
| `shop` | `sells` is item ids they stock. `buys` is the kinds they will pay for. Stock comes out of `state.inventory`. |

`state.json` is the starting body: `alive`, `hp`, `maxHp`, `hostile`, `mood`, and `inventory`. The engine copies this into the game state at the start of a life.

Each person keeps a log of what they observe. It starts with Null walking into their room. After that it records speech, actions in that room, and what they themselves say and do. Their own lines use "I". A trade is one line, `Trade happens - 1 chemical breather for 16 scrip.` A door that becomes passable while Null is in the room is `Door to east opens.` The log is part of the tape. While `npm run dev` or `npm run preview` is running, each change is also written to `journals/<name>.log`, using that person's name: `journals/Old Coil.log`.

Hypnos reads the lines after the last `--- hypnos ---` marker in those logs and writes `journals/<name>.memory.txt`. It then appends that marker. The memory file is included in that person's next Ollama prompt, ahead of the log.

`role.json` is for the model. The cartridge loader does not read it. The harness fetches `/ash/npcs/<id>/role.json` when that person hears speech. `prompt` is the life they stay inside. `objectives` are the only flags speech can set. Each objective has:

| Field | Use |
| --- | --- |
| `flag` | The flag id the model may return in `met`. |
| `goal` | Plain instructions for the model. |
| `utteranceIncludes` | A word that must appear in what you said. |
| `requiresFlag` / `requiresAnyFlags` | Flags that must already be set. |
| `requiresAllItems` | Items you must be carrying. |
| `consumeItems` | Removed from your pack when the flag is accepted. |
| `grantItems` | Added to your pack when the flag is accepted. |

If the file is missing, or its `id` does not match the folder, that person has no model voice. Their script still runs.

## Code

React 19, TypeScript, Vite, and Tailwind 4. There is no game server. State lives in the browser.

```
src/main.tsx                      mounts the terminal
src/components/ash-terminal.tsx   title, scroll, prompt, autosave
src/styles.css
src/game/types.ts                 world, state, and line types
src/game/load.ts                  fetches the cartridge
src/game/world.ts                 validates it and builds a new game
src/game/engine.ts                parser and rules
src/game/observe.ts               what each person sees
src/game/journal.ts               log and memory file names
src/game/harness.ts               takes, speech, and Ollama
hypnos.py                         writes memory files from the logs
src/game/harness.test.ts
src/game/walkthrough.test.ts
vite.config.ts                    dev server, Ollama proxy, inference log
```

`AshTerminal` is the screen. A new game calls `loadWorld()`, then `initialState()`, plays a short boot, and prints the intro plus the room. Prefer-reduced-motion skips the boot delay.

Slash commands and the other meta verbs (`help`, `inv`, `save`, `map`, and the rest) go straight to `applyCommand`. Every other line goes to `playInput`. The component applies the effects the engine returns: save, load, clear, exit, restart. A living turn is written to the tape. A death leaves the previous tape in place.

`applyCommand` parses one line and runs it on a clone of the state. Taking an item is the harness's job. The engine has no take verb. A single unknown word is an error and points you at `/help`. An unknown line of more than one word is speech.

`playInput` is the front door:

1. Meta commands pass through to the engine.
2. A take that names one item here is applied by `comeIntoPossession`. The item moves from `roomItems` into `inventory`.
3. A pronoun or an ambiguous take calls `readPossession`, which asks Qwen3:4b for one id.
4. Movement, look, talk, combat, trade, listen, search, and the other scripted verbs go to the engine.
5. If the line was speech, `hearRoom` asks every living person in the room. Scripted speech from the engine is handed to the model as lines already said, so the reply can stay empty. If every person fails to answer, you get the Ollama warning.

Output is a list of `{ kind, text }`. The kind picks the color: room title, body, exits, speech, combat, warning, good news, map, system.

### Ollama and Qwen3:4b

`OLLAMA_MODEL` in `src/game/harness.ts` is `qwen3:4b`. Both calls are `POST /ollama/api/chat` with `stream: false`, `think: false`, and `keep_alive: "10m"`.

Speech includes that person's memory file under `MEMORY`, then the log under `WHAT YOU HAVE SEEN`.

### Hypnos

Hypnos is the batch step that turns a log into a memory. It reads `journals/<name>.log` and writes `journals/<name>.memory.txt`. The file is a short recollection of the visit, in sentences such as `Null came by. He was nice. He asked if I was well.` It includes what they answered and where he went. After it writes, it appends a `--- hypnos ---` line to that log. The next run reads only the lines after the last marker and adds them to the memory. A log with nothing after the marker is left alone. While the dev server or preview is running, saving the log keeps the marker and writes new lines after it.

```bash
python hypnos.py
python hypnos.py --npc old-coil
python hypnos.py --dry-run
```

`--dry-run` prints the memory and does not write it. The next time that person hears speech, the memory file is what they are shown.

Speech uses temperature `0.6`, `num_predict: 180`, and a JSON schema `{ say, met }`. The system prompt names the person, the room, the mood from `state.json`, the role text, and each objective as open or already met, and as evidence that holds or evidence that does not. Hostile people are told to threaten and to leave `met` empty. `acceptMarks` then drops any flag whose evidence fails, consumes the listed items, and grants the listed items.

An ambiguous take uses temperature `0`, `num_predict: 24`, and a schema whose `take` field is an enum: the ids on the ground, plus `none`. The prompt is the room's physics. It lists each id, name, and alias, and it treats "the" as noise.

`vite.config.ts` rewrites `/ollama` onto `http://127.0.0.1:11434` for both the dev server and preview. The `ollama-console` plugin is dev-only. It numbers each chat `[qwen #N]`, prints the outgoing model, options, and messages, then prints the status and the reply. If you abort the call by typing again, the plugin drops the upstream request.
