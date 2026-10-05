# Ash Protocol

A twenty-one-room text adventure in the browser. You are Null, a silt-runner in Cinder Reach. Three nights ago the market radio used your voice and told you to bring the key to the Spire. You start on Silt Dock with a bent multitool, one stim, 14 HP, and 24 scrip. You win when you walk into the Spire Core.

The cartridge is JSON under `public/ash/`. You type what Null does in your own words. A local model, **Qwen3:4b** served by **Ollama**, reads the line and turns it into one game action. A rules engine runs that action: movement, talk, trade, combat. The people in the room answer in their own voice, also through the model. A line that starts with `/` skips the model and runs as written.

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

If Ollama is down, a plain line does nothing and costs no turn: "The cartridge could not read that. Is Ollama running qwen3:4b? Slash commands (/help) still work." Slash commands still run. Their rules still apply, but each NPC reply is replaced by "… reply is lost in static." A crystal ball reading needs both Ollama and the Hypnos read on the dev server or preview.

```bash
npm run build    # tsc --noEmit, then the Vite production build
npm run preview
```

Tests load the cartridge from `public/ash/` and walk a full route to the Spire:

```bash
node --experimental-strip-types --test src/game/*.test.ts
python -m unittest hypnos_test.py
npx tsc --noEmit
dotnet test dotnet/Ash.Game.Tests
```

## Command prompt

The same cartridge plays from a console. The C# player uses the GGUF through LLamaSharp. The browser stays on Ollama.

```powershell
dotnet run --project dotnet/Ash.Cli
```

The program walks up from the current directory until it finds `public/ash/index.json`. At the title, `new` starts a life and `continue` reads `tape.json` in the repo root. `quit` leaves. Up and down arrow walk the command history when the console can read keys. If input is redirected, it reads plain lines instead. That is what some SSH sessions do.

Colors are ANSI truecolor: phosphor for the room, ash for speech and system lines, dim for the echo, red for warnings and for HP under 5. `NO_COLOR` turns the color off. A pipe turns it off as well. PowerShell and an SSH session that has a terminal keep it.

The model file is `C:\Users\Geir Gundersen\OneDrive\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf`. `ASH_MODEL` or `--model` selects another file. The first line that needs the model tries CUDA, then Vulkan, then CPU, each in its own process. The one that loads is used, and that load is the pause before the first reply. `--backend cpu` (or `vulkan` or `cuda`) uses that one. One loaded model answers the people in the room one at a time. Slash commands never load it. A living turn writes `tape.json`. A death leaves the previous tape in place. NPC logs still go to `journals/`.

Hypnos, and the crystal ball's memory lookup, stay in Python. The console runs `python hypnos.py --read-only --npc <id>`. The whisper and Madam Wick's sentence run on the GGUF. The browser still asks Ollama for those.

## How to play

Type at the `>` prompt and press Enter. Write what Null does or says, in plain words: `grab the cable`, `what does coil know about ash?`, `hand him a stim`, `head north`, `coil sent me`. The compass, Look, Search, Talk, and Map buttons send slash commands. Up and down arrow walk the command history. A line that starts with `/` offers the console commands.

The header shows the room, HP, and scrip. HP under 5 turns red.

### How a line is read

A plain line is read the way an MCP client works with tools. The room publishes a set of game tools to Qwen3:4b through Ollama's native tool calling. Each tool has a name, a description, and parameters whose values are enums of the ids in that room. The model calls the tool, or up to three tools in order, that does what you typed. The harness checks each call and runs it through the engine.

| Tool | Offered when | Does |
| --- | --- | --- |
| `move(direction)` | the room has exits | `go` |
| `look_around`, `search_room`, `listen`, `wait`, `flee` | always | the verb of the same name |
| `examine(target)` | always | a person, an item, or `self` |
| `take_item(item)` | something can be taken | from the ground, or an oracle from someone's hands |
| `drop_item(item)`, `use_item(item)` | Null carries something | |
| `talk_to(person, topic?)` | someone is here | a greeting, or a topic |
| `ask_for_fortune(reader)` | someone here holds a crystal ball | they read Null's fortune |
| `say(words)` | always | Null speaks aloud |
| `give_item(item, person)`, `tell_story(person)`, `pay(person)`, `attack(person)` | someone is here | |
| `show_wares`, `buy_item(item)`, `sell_item(item)` | a merchant is here | |
| `show_screen(screen)` | always | inventory, status, map, or help |

The descriptions carry the meaning. In the Glass Booth, "what does her crystal ball say?" or "madam, look into the glass for me" calls `ask_for_fortune`, because that tool says it is for anyone asking what the ball says, sees, or shows.

A call that names a tool or an id that is not here goes back to the model as a tool error that lists the valid choices, and the model gets one more try. Prose instead of a call gets one nudge. If both tries fail, or Ollama is unreachable, the turn costs nothing. Several calls run in order and stop early if Null leaves the room, dies, or wins.

The scroll shows "The room is listening…" while a call is in flight. Another line cancels it.

### Slash commands

A line that starts with `/` never goes to the model for reading. The regex parser runs it as written, so the game stays playable without Ollama, and the tests use it. `/help` prints this list inside the game.

| Command | What it does |
| --- | --- |
| `/go north` `/n` `/s` `/e` `/w` | Move. `walk` and `head` work too. |
| `/look at <thing>` | Examine an item, a person, or yourself. `examine`, `inspect`, and `x` match. |
| `/search` | Look for what the room is holding back. |
| `/listen` | Hear a room that has a line to speak. `pray` and `kneel` do the same. |
| `/take <item>` | Pick up something on the ground, or an oracle from someone's hands. `get`, `grab`, `pick up` match. |
| `/drop <item>` | Leave it in the room. |
| `/talk <name>` | A greeting, then topics when that person has any. |
| `/talk <name> about <topic>` | One topic from their script. |
| `/ask <name> for a fortune` | If that person is holding a crystal ball, they read someone else in the room. |
| `/give <item> to <name>` | A trade written on that person. |
| `/tell <name> a story` | Their story, when they have one. |
| `/say <words>` | Speak aloud. A password rule may fire, and the people in the room answer. |
| `/trade` | A merchant's shelf. `shop`, `wares`, and `browse` match. |
| `/buy <item>` `/sell <item>` | With a merchant in the room. |
| `/pay <name>` | Spend scrip on a bribe or a healing. `bribe` matches. `/heal` finds Doc. |
| `/use <item>` | Stims, a carried crystal ball, and anything else with a use line. |
| `/attack <name>` | Strike. They hit back. `fight`, `kill`, `hit`, and `strike` match. |
| `/flee` | Leave a fight, usually the way you came. |
| `/wait` | Pass a moment. In a fight, they still swing. `rest` and `z` match. |

| Console | What it does |
| --- | --- |
| `/help` | How to play, and the slash commands. |
| `/look` | Reprint the room. Costs no turn. |
| `/inv` | What you carry, and your scrip. `/inventory` and `/i` match. |
| `/status` | HP, scrip, weapon, room, turn, rooms seen. |
| `/map` | Rooms you have entered, and doors you have seen. |
| `/save` | Write the tape. Living turns already write it. |
| `/load` | Read the tape. |
| `/clear` | Clear the scroll and reprint the room. |
| `/restart` | Boot a new life. Type it twice. The shelf tape stays until a living turn overwrites it. |
| `/exit` | Cut the power and return to the title. Type it twice. |

A bare `help`, `map`, or `what am I carrying` goes to the model like any other line, and it opens the same screen.

### Speech and replies

No NPC line is prewritten. When an action involves a person, such as a talk, a topic, a trade, a bribe, a story, a password, a refusal, or a blow they shrug off, the engine applies the rules and hands that person a *beat*: what Null just did, and a gist of what the reply has to get across. Qwen3:4b writes the reply from the person's role, mood, memory, log, and that gist. Each change the rules make is also printed as its own line, such as `Doc Hex takes the clean filter.`, `You receive chemical breather.`, or `The way south is open.`, so you never have to read it out of the prose.

Speech (`say`, or a line the model reads as Null talking) reaches every living person in the room, and each may answer. An objective from speech changes the world only when the harness already sees the evidence: the words, the facts, and the items that objective requires. The model names candidate objective ids. The harness accepts them.

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

The cartridge has no flags. A rule is true when a fact in the world is true. A fact is one of these:

| Fact | Means |
| --- | --- |
| `{ "carrying": "breather" }` | Null's pack holds that item. |
| `{ "heldBy": "pike", "item": "stim" }` | That person's pack holds that item. |
| `{ "mind": "hymn" }` | Null remembers that inclination. |
| `{ "recalls": "told-ash", "npc": "old-coil" }` | That person holds that inclination. |
| `{ "place": "chain", "is": "down", "room": "smugglers-cut" }` | A fixture in a room. A chain, a seal, a skiff, a radio, a hatch, a stair, a cache. |
| `{ "wave": "cinder" }` | That call is loose on the air. |
| `{ "gone": "drone-mite" }` | That creature is no longer alive. |

`when` and `unless` take one fact, or `{ "all": [...] }`, or `{ "any": [...] }`. A `change` is what an action does to the world: `remember` (Null's mind), `recall` (someone's mind, with the first-person line), `place` (set a fixture), or `wave` (put a call on the air). An inclination is stored on that person and written into their log. The model sees it under `WHAT YOU HOLD IN MIND`.

`fixtures` on a room are the starting values, copied onto the tape. The chapel radio starts `warm` and goes `hushed`. Pike's chain starts `up`. The gate seal starts `shut`.

Descriptions are tried in order. `when` shows that text only while the fact holds. `unless` hides that text while the fact holds. The last matching text is the one you read.

`ground` is a list of `{ id, hiddenUntil? }`. A hidden item stays out of "You see" until the fact holds. It can still be in the room's pile. The yard gloves stay hidden until the drone is gone.

An obstacle blocks one direction until its `when` fact holds. Holding the breather opens the flooded arch. A lowered chain, or Pike being dead, opens his door. It has a `fail` line and a `pass` line.

`onListen` is what `listen` plays. A step can change the world: the chapel hymn becomes Null's memory and hushes the radio; the antenna, heard clearly or heard three times, puts `cinder` on the air. A `counter` picks the step for that visit, and a step can require an item. `onSearch` can require a fact, then once grant items and scrip and change the room. The well's cache starts `buried` and becomes `empty`.

`"win": true` ends the game when you enter. That room is `spire-core`.

### Items

`items.json` is the catalog. Kinds are `junk`, `weapon`, `gear`, `key`, `heal`, and `oracle`.

| Field | Use |
| --- | --- |
| `aliases` | How the parser and the take prompt recognize it. |
| `value` | Price in scrip, both ways. |
| `damage` | Weapon damage. The best one in your pack is used. |
| `heal` | HP restored by `use` on a `heal` item. The item is consumed. |
| `text` | What `look at` prints. |
| `useText` | What `use` prints when the item is not a heal. |
| `sellWhen` | Merchants buy it only while this fact holds. The optic lens sells once ASH has given up the cipher tape. Keys and oracles never sell. |

A new game puts `bent-multitool` and `stim` in your pack. Everything else starts on a room floor or in someone's inventory.

### People

`script.json` is the deterministic character.

| Field | Use |
| --- | --- |
| `aliases` | Names the slash commands and the reading prompt recognize. |
| `presence` | The line in the room description. `presenceWhen` replaces it while a fact holds. |
| `greeting` | Gist for a bare `talk`, when no `onTalk` rule matches. |
| `topics` | A `gist` per topic, for `talk <name> about <topic>`. A topic can change the world, usually by leaving an inclination in that person's memory. The topic names are listed after a greeting. |
| `onTalk` | The first matching rule on a bare `talk`. It can require a fact or an item, take an item they are holding, change the world, and grant items. Has a `gist`. |
| `trades` | `give <item> to <name>`. The item goes into their pack. Can return something from their pack, change the world, and happen once a fact holds. Has a `gist`. |
| `bribe` | `pay` / `bribe`. A scrip cost, an optional world change (the chain comes down, the skiff is loose), an optional full heal. `gist`, and `alreadyGist` once `done` holds. |
| `story` | `tell <name> a story`. Can require a fact, pay scrip, change the world, and happen once `done` holds. `gist`, `elseGist` when the fact is missing, `alreadyGist` after. |
| `say` | A word inside spoken words. Can require facts and items, consume items, grant items, and change the world. Has a `gist`. |
| `combat` | Damage they deal, scrip they drop, optional `unkillable` and `refuseGist`, `onDeath` changes (a door opens because the body cannot hold it), and the death line. The ending counts bodies, not a kill list: the drone, Pike, Kite, and Razor, if they are no longer alive. |
| `shop` | `sells` is item ids they stock. `buys` is the kinds they will pay for. Stock comes out of `state.inventory`. |

A *gist* is notes, not a line to quote. "You" is the NPC and "they" is Null: `"Six scrip and you put them back together. Or bring a clean filter from the glass orchard and you will trade them a breather."` Every clue the player needs has to be in a gist or a role, because the model speaks only what it is given. `presence`, `presenceWhen`, and `onDeathSay` are narration and are printed as written.

`state.json` is the starting body: `alive`, `hp`, `maxHp`, `hostile`, `mood`, and `inventory`. The engine copies this into the game state at the start of a life.

Each person keeps a log of what they observe. It starts with Null walking into their room. After that it records speech, actions in that room, and what they themselves say and do. Their own lines use "I". A trade is one line, `Trade happens - 1 chemical breather for 16 scrip.` A door that becomes passable while Null is in the room is `Door to east opens.` The log is part of the tape. While `npm run dev` or `npm run preview` is running, each change is also written to `journals/<name>.log`, using that person's name: `journals/Old Coil.log`.

Null keeps his own action log on the tape, `playerLog`, and in `journals/Null.log`. It is what he did and what he heard, in lines such as `I go north.` and `Mare Voss replies "..."`. Hypnos compresses that log with the old memory into `journals/Null.memory.json`, in the first person. A leftover `journals/Null.memory.txt` is still read. A tape saved before this log starts his journal empty.

Hypnos reads the lines after the last `--- hypnos ---` marker in those logs and writes `journals/<name>.memory.json` as `{ "memory": "..." }`. It then appends that marker. The memory file is included in that person's next prompt, ahead of the log.

`role.json` is for the model. The cartridge loader does not read it. The harness fetches `/ash/npcs/<id>/role.json` whenever that person speaks. `prompt` is the life they stay inside. `objectives` are the only world changes speech can make through the model. Each objective has:

| Field | Use |
| --- | --- |
| `id` | The objective id the model may return in `met`. |
| `goal` | Plain instructions for the model. |
| `utteranceIncludes` | A word that must appear in what you said. |
| `when` | Facts that must already hold. |
| `done` | The objective is already met while this fact holds. |
| `requiresAllItems` | Items you must be carrying. |
| `consumeItems` | Removed from your pack when the objective is accepted. |
| `grantItems` | Added to your pack when the objective is accepted. |
| `change` | What becomes true in the world: a fixture, a memory, a wave. |

If the file is missing, or its `id` does not match the folder, that person still speaks from their name, the room, and the gist. Their script still runs.

## Code

React 19, TypeScript, Vite, and Tailwind 4. There is no game server. State lives in the browser.

```
src/main.tsx                      mounts the terminal
src/components/ash-terminal.tsx   title, scroll, prompt, autosave
src/styles.css
src/game/types.ts                 world, state, and line types
src/game/load.ts                  fetches the cartridge
src/game/world.ts                 validates it and builds a new game
src/game/facts.ts                 world facts: items, memory, fixtures, the air, the dead
src/game/engine.ts                parser and rules
src/game/observe.ts               what each person sees
src/game/journal.ts               log and memory file names
src/game/interpret.ts             reads a plain line into one action
src/game/harness.ts               front door, NPC voices
src/game/ollama.ts                the model name and the chat call
src/game/oracle.ts                crystal ball readings
hypnos.py                         writes memory files from the logs
dotnet/Ash.Game                  engine, harness, and oracle
dotnet/Ash.Cli                    console player and LLamaSharp session
src/game/harness.test.ts
src/game/interpret.test.ts
src/game/walkthrough.test.ts
vite.config.ts                    dev server, Ollama proxy, inference log
```

`AshTerminal` is the screen. A new game calls `loadWorld()`, then `initialState()`, plays a short boot, and prints the intro plus the room. Prefer-reduced-motion skips the boot delay.

Slash console commands (`/help`, `/inv`, `/save`, and the rest) go straight to `applyCommand`. Every other line goes to `playInput`. The component applies the effects the engine returns: save, load, clear, exit, restart. A living turn is written to the tape. A death leaves the previous tape in place.

`applyCommand` parses one line with the regex parser and calls `applyAction`. `applyAction` runs an `Action` on a clone of the state and returns lines, the new state, an optional crystal ball consult, and `beats` for the people who should answer. The engine prints no NPC dialogue.

`playInput` is the front door:

1. A slash line, or any line while dead or after the ending, is parsed by `parseCommand`. No model call.
2. Any other line goes to `interpret` (`src/game/interpret.ts`), which offers Qwen3:4b the room's tools and turns its tool calls into one to three actions. If the model is unreachable or no call fits, the turn ends here with a warning and no state change.
3. `applyAction` runs each action in order.
4. `use` on an oracle you are carrying, or `ask <name> for a fortune` while that person is holding one, consults the crystal ball.
5. Otherwise `voiceRoom` asks each person with a beat, and on speech every living person in the room, for a reply. The calls run in parallel. A reply that fails for a person with a beat prints "… reply is lost in static". If speech reaches nobody, you get the Ollama warning.

`playInput` takes an optional `HarnessIo` (`interpret`, `voice`, `role`, `memory`) so tests can run without Ollama.

Output is a list of `{ kind, text }`. The kind picks the color: room title, body, exits, speech, combat, warning, good news, map, system.

### Ollama and Qwen3:4b

`OLLAMA_MODEL` in `src/game/ollama.ts` is `qwen3:4b`. Every browser call is `POST /ollama/api/chat` with `stream: false`, `think: false`, and `keep_alive: "10m"`.

Reading a line sends `tools` with temperature `0` and `num_predict: 1024`, and it is the one call with `think: true`. With tools attached, qwen3 ignores `think: false` and reasons in the reply text until it runs out of tokens. With thinking on, the reasoning goes to its own field and the tool call comes out clean. On a CPU-only Ollama, that read takes tens of seconds. A GPU makes it fast.

A reply includes that person's memory file under `MEMORY`, then the log under `WHAT YOU HAVE SEEN`.

### Hypnos

Hypnos is the sleep cycle. It sends the GGUF the old `journals/<name>.memory.json` and the lines of `journals/<name>.log` after the last `--- hypnos ---` marker. The prompt asks for one new memory that compresses both. The file is written only when the reply reads as that person's own recollection: first person, a few sentences, no reasoning and no plan. A reply that is not a memory leaves the file and the marker alone. After a memory is written, Hypnos appends `--- hypnos ---` to the log. The next run compresses that new memory with only the lines after the marker. A log with nothing after the marker is left alone. While the dev server or preview is running, saving the log keeps the marker and writes new lines after it. Null's memory uses I. An NPC's memory uses I, and Null is he. A `.memory.txt` file is still read when the JSON file is absent.

```bash
python hypnos.py
python hypnos.py --npc old-coil
python hypnos.py --npc null
python hypnos.py --dry-run
python hypnos.py --read-only --npc old-coil
```

`--dry-run` prints the memory and does not write it. The next time that person hears speech, the memory file is what they are shown.

`--read-only` needs `--npc`. It prints JSON, `{ id, name, memory, log }`, and does not write the memory or add a marker. `null` is Null. The crystal ball uses this. The dev server and preview expose it as `GET /hypnos/read?npc=<id>`, which runs that command. The log in the JSON has the marker lines removed. The memory is the file Hypnos has already written.

The sleep cycle loads the same GGUF through `llama-cpp-python`. Install the prebuilt CPU wheel with `pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu`. It tries every GPU layer, then CPU. `ASH_MODEL` selects another file. Only the memory field is saved. `--read-only` does not call the model and does not need the package.

### The crystal ball

Madam Wick keeps the crystal ball in the Glass Booth, one step west of the Lantern Market. It is an `oracle`. It is not a person: it has no log, no memory, and it does not hear the room or move. Its prompt is `public/ash/oracles/crystal-ball.json`. The engine does not load that file.

You can take it, drop it, and give it to someone in the room. It only reads for whoever is holding it.

Asking Madam Wick what the ball says, for a reading, or for your fortune works while she holds it (`/ask wick for a fortune`). That reading is always about Null. `use crystal ball` works while you hold it, and the ball picks one other living person in the room. Either way it asks Hypnos for the subject's memory and log, read-only. Log lines about the fortune request itself are dropped. Then it asks Qwen for one or two sentences drawn from those texts.

The whisper is printed in the scroll, `The crystal ball whispers, "…"`, like any other generated line, and it is written to your log. If she woke it, it is also written to her log, and then she tells you in her own voice what she makes of it. The room hears her, not the ball. When you read someone else, that person is not told. If nobody else is there, or that person has no memory and no log, the glass stays dark. Shops do not buy an oracle.

A reply uses temperature `0.6`, `num_predict: 180`, and a JSON schema `{ say, met }`. The system prompt names the person, the room, the mood from `state.json`, the role text, the memory file, what they hold in mind, and the log, and, when there is a beat, `WHAT JUST HAPPENED` and `YOU MUST GET ACROSS`. On speech it also lists each objective as open or already met, and as evidence that holds or evidence that does not. Hostile people are told to threaten and to leave `met` empty. `acceptMarks` then drops any objective whose evidence fails, consumes the listed items, grants the listed items, and applies the world change.

A tape from before this, still stored under `ash-protocol-tape-v1` with `version: 1`, is read and its old flags are folded into these facts. The next save is `version: 2`.

`vite.config.ts` rewrites `/ollama` onto `http://127.0.0.1:11434` for both the dev server and preview. The `ollama-console` plugin is dev-only. It numbers each chat `[qwen #N]`, prints the outgoing model, options, tools (each with its enums), and messages, then prints the status, the thinking, the reply, and any tool calls. That covers every model call: reading a line, NPC replies, the crystal ball's whisper, and Madam Wick's reading. If you abort the call by typing again, the plugin drops the upstream request.
