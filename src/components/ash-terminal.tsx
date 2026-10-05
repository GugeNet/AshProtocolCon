import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SAVE_KEY, applyCommand, describeRoom, introLines, isCartridgeMeta } from "../game/engine";
import { inputWaits, playInput } from "../game/harness";
import { publishJournals } from "../game/journal";
import { loadWorld } from "../game/load";
import { repairLogs } from "../game/observe";
import { initialState } from "../game/world";
import type { GameLine, GameState, World } from "../game/types";

type Row = GameLine & { id: number };

const SLASH = [
  { cmd: "/help", blurb: "how to play, slash commands" },
  { cmd: "/look", blurb: "reprint the room" },
  { cmd: "/inv", blurb: "what you carry" },
  { cmd: "/status", blurb: "hp, scrip, weapon" },
  { cmd: "/map", blurb: "rooms you have seen" },
  { cmd: "/save", blurb: "write the tape" },
  { cmd: "/load", blurb: "read the tape" },
  { cmd: "/clear", blurb: "clear the scrollback" },
  { cmd: "/restart", blurb: "boot a new life" },
  { cmd: "/exit", blurb: "cut the power" },
];

const BOOT = [
  "ASH PROTOCOL CARTRIDGE",
  "MODEL VIC-2147    ·    21 ROOMS",
  "",
  "**** ASH BASIC V2 ****",
  "",
  " 3583 BYTES FREE",
  "",
  "READY.",
];

function kindClass(kind: GameLine["kind"]): string {
  if (kind === "echo" || kind === "exit") return "text-dim";
  if (kind === "sys" || kind === "speech" || kind === "map") return "text-ash";
  if (kind === "combat" || kind === "warn") return "text-danger";
  if (kind === "room") return "text-phosphor text-2xl leading-none";
  return "text-phosphor";
}

export function AshTerminal() {
  const [mounted, setMounted] = useState(false);
  const [saveExists, setSaveExists] = useState(false);
  const [screen, setScreen] = useState<"title" | "play">("title");
  const [world, setWorld] = useState<World | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [lines, setLines] = useState<Row[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");
  const [armed, setArmed] = useState<null | "exit" | "restart">(null);
  const [live, setLive] = useState(false);
  const [hearing, setHearing] = useState(false);
  const idRef = useRef(1);
  const gameRef = useRef<GameState | null>(null);
  const turnRef = useRef(0);
  const listenAbort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const histAt = useRef(0);
  const bootTimer = useRef<number[]>([]);

  useEffect(() => {
    setMounted(true);
    setSaveExists(window.localStorage.getItem(SAVE_KEY) !== null);
    return () => {
      for (const t of bootTimer.current) window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lines, screen, hearing]);

  useEffect(() => {
    if (screen === "play" && live && window.matchMedia("(min-width: 768px)").matches) {
      inputRef.current?.focus();
    }
  }, [screen, live]);

  function commitGame(next: GameState, source: World | null = world) {
    gameRef.current = next;
    setGame(next);
    if (!source) return;
    void publishJournals(source, next).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "The journal was not written.";
      console.warn(message);
    });
  }

  function stamp(batch: GameLine[]): Row[] {
    return batch.map((entry) => ({ ...entry, id: idRef.current++ }));
  }

  function remember(text: string) {
    const last = history.current[history.current.length - 1];
    if (text && text !== last) history.current.push(text);
    histAt.current = history.current.length;
  }

  function writeTape(state: GameState) {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    setSaveExists(true);
  }

  function readTape(current: World): GameState | null {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as GameState;
      if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.npcs || !current.rooms[parsed.roomId]) return null;
      return repairLogs(parsed, current);
    } catch {
      return null;
    }
  }

  async function ensureWorld(): Promise<World> {
    if (world) return world;
    const loaded = await loadWorld();
    setWorld(loaded);
    return loaded;
  }

  function begin(current: World, state: GameState, resumed: boolean) {
    for (const t of bootTimer.current) window.clearTimeout(t);
    bootTimer.current = [];
    listenAbort.current?.abort();
    setHearing(false);
    commitGame(state, current);
    setScreen("play");
    setDraft("");
    setArmed(null);
    setFault("");
    setLive(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const opening: GameLine[] = [
      ...BOOT.map((text) => ({ kind: "sys" as const, text })),
      ...(resumed ? [{ kind: "sys" as const, text: "TAPE LOADED." }] : introLines()),
      ...describeRoom(current, state),
    ];
    if (reduce) {
      setLines(stamp(opening));
      setLive(true);
      return;
    }
    setLines([]);
    opening.forEach((entry, index) => {
      const timer = window.setTimeout(() => {
        setLines((prev) => [...prev, { ...entry, id: idRef.current++ }]);
        if (index === opening.length - 1) setLive(true);
      }, Math.min(index, 12) * 60);
      bootTimer.current.push(timer);
    });
  }

  async function newCartridge() {
    setBusy(true);
    setFault("");
    try {
      const current = await ensureWorld();
      begin(current, initialState(current), false);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Cartridge unreadable.");
    } finally {
      setBusy(false);
    }
  }

  async function continueTape() {
    setBusy(true);
    setFault("");
    try {
      const current = await ensureWorld();
      const tape = readTape(current);
      if (!tape) {
        setFault("Tape unreadable.");
        setSaveExists(false);
        return;
      }
      begin(current, tape, true);
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Cartridge unreadable.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(raw: string) {
    const current = gameRef.current ?? game;
    if (!world || !current || !live) return;
    const text = raw.trim();
    if (!text) return;
    const turn = ++turnRef.current;
    listenAbort.current?.abort();
    setHearing(false);
    remember(text);
    setDraft("");
    const echo: GameLine = { kind: "echo", text: `> ${text}` };

    if (!isCartridgeMeta(text)) {
      const controller = new AbortController();
      listenAbort.current = controller;
      if (inputWaits(current, text)) setHearing(true);
      setLines((prev) => [...prev, ...stamp([echo])]);
      try {
        const result = await playInput(world, current, text, controller.signal);
        if (turn !== turnRef.current || controller.signal.aborted) return;
        commitGame(result.state);
        setLines((prev) => [...prev, ...stamp(result.lines)]);
        if (result.state.mode !== "dead") writeTape(result.state);
      } catch (error) {
        if (turn !== turnRef.current || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "The room stays quiet.";
        setLines((prev) => [...prev, ...stamp([{ kind: "warn", text: message }])]);
      } finally {
        if (turn === turnRef.current) setHearing(false);
      }
      return;
    }

    const result = applyCommand(world, current, text);

    if (result.effect === "exit") {
      if (armed === "exit") {
        setScreen("title");
        setArmed(null);
        setLines([]);
        setLive(false);
        return;
      }
      setArmed("exit");
      setLines((prev) => [
        ...prev,
        ...stamp([
          echo,
          {
            kind: "sys",
            text: "Cut power? Type /exit again to confirm. Anything else keeps you in the room.",
          },
        ]),
      ]);
      return;
    }

    if (result.effect === "restart") {
      if (armed !== "restart") {
        setArmed("restart");
        setLines((prev) => [
          ...prev,
          ...stamp([
            echo,
            {
              kind: "sys",
              text: "Boot a new life? /restart again wipes this run. The shelf tape stays until you overwrite it.",
            },
          ]),
        ]);
        return;
      }
      setArmed(null);
      begin(world, initialState(world), false);
      return;
    }

    if (armed) setArmed(null);

    if (result.effect === "clear") {
      commitGame(result.state);
      setLines(stamp(describeRoom(world, result.state)));
      return;
    }

    if (result.effect === "save") {
      if (current.mode === "dead") {
        setLines((prev) => [
          ...prev,
          ...stamp([
            echo,
            { kind: "warn", text: "The tape will not record a corpse. /load the last living moment." },
          ]),
        ]);
        return;
      }
      writeTape(current);
      setLines((prev) => [
        ...prev,
        ...stamp([echo, { kind: "sys", text: "Tape written. The shelf will keep it." }]),
      ]);
      return;
    }

    if (result.effect === "load") {
      const tape = readTape(world);
      if (!tape) {
        setLines((prev) => [
          ...prev,
          ...stamp([echo, { kind: "warn", text: "No tape on the shelf." }]),
        ]);
        return;
      }
      commitGame(tape);
      setLines((prev) => [
        ...prev,
        ...stamp([echo, { kind: "sys", text: "Tape loaded." }, ...describeRoom(world, tape)]),
      ]);
      return;
    }

    commitGame(result.state);
    setLines((prev) => [...prev, ...stamp([echo, ...result.lines])]);
    if (result.state.mode !== "dead") writeTape(result.state);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.current.length) return;
      const next = Math.max(0, histAt.current - 1);
      histAt.current = next;
      setDraft(history.current[next] ?? "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(history.current.length, histAt.current + 1);
      histAt.current = next;
      setDraft(history.current[next] ?? "");
    }
  }

  const slashQuery = draft.startsWith("/") ? draft.slice(1).toLowerCase() : null;
  const suggestions =
    slashQuery === null
      ? []
      : SLASH.filter((item) => item.cmd.slice(1).startsWith(slashQuery));

  if (screen === "title" || !world || !game) {
    return (
      <main className="relative flex min-h-dvh flex-col bg-void text-phosphor">
        <Stripe />
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-5 py-10">
          <p className="text-lg tracking-widest text-dim">VIC-2147 CARTRIDGE</p>
          <div>
            <h1 className="text-5xl leading-none sm:text-6xl">ASH PROTOCOL</h1>
            <p className="mt-3 text-2xl text-ash">twenty rooms under the ash</p>
          </div>
          <div className="max-w-md text-xl leading-snug">
            <p>A village still trading in brake-light lanterns.</p>
            <p>A mind in the spire, using your voice.</p>
            <p>You win if you reach the final room.</p>
          </div>
          <div className="border border-line bg-panel p-4 text-xl leading-relaxed text-dim">
            <p className="text-phosphor">READY.</p>
            <p>go north · talk · say · attack · trade</p>
            <p>/help · /map · /save · /exit</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="min-h-12 flex-1 border border-phosphor bg-phosphor px-4 text-2xl text-ink"
              onClick={newCartridge}
              disabled={busy}
            >
              {busy ? "MOUNTING…" : "NEW CARTRIDGE"}
            </button>
            {mounted && saveExists ? (
              <button
                type="button"
                className="min-h-12 flex-1 border border-ash px-4 text-2xl text-ash"
                onClick={continueTape}
                disabled={busy}
              >
                CONTINUE
              </button>
            ) : null}
          </div>
          {fault ? <p className="text-xl text-danger">{fault}</p> : null}
        </div>
      </main>
    );
  }

  const room = world.rooms[game.roomId];
  const alive = room.npcs.filter((id) => game.npcs[id]?.alive);

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-void text-phosphor">
      <Stripe />
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-lg tracking-widest text-dim">ASH PROTOCOL</p>
          <h1 className="truncate text-3xl leading-none">{room.name}</h1>
        </div>
        <div className="flex items-center gap-4 text-xl">
          <p>
            HP{" "}
            <span className={game.hp < 5 ? "text-danger" : "text-phosphor"}>{game.hp}</span>
            <span className="text-dim">/{game.maxHp}</span>
          </p>
          <p>
            <span className="text-ash">{game.scrip}</span> <span className="text-dim">SCRIP</span>
          </p>
          <button
            type="button"
            className="min-h-12 border border-line px-3 text-lg text-dim"
            onClick={() => submit("/exit")}
          >
            /EXIT
          </button>
        </div>
      </header>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto px-4 py-4">
        <div className="crt-scan absolute inset-0" aria-hidden="true" />
        <div className="relative flex flex-col gap-3 text-xl leading-snug">
          {lines.map((row) => (
            <p key={row.id} className={`max-w-full whitespace-pre-wrap ${kindClass(row.kind)}`}>
              {row.text}
            </p>
          ))}
          {hearing ? <p className="text-dim">The room is listening…</p> : null}
        </div>
      </div>

      {live && suggestions.length > 0 ? (
        <ul className="max-h-48 overflow-auto border-t border-line bg-panel">
          {suggestions.map((item) => (
            <li key={item.cmd}>
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-4 px-4 text-left text-xl"
                onClick={() => submit(item.cmd)}
              >
                <span>{item.cmd}</span>
                <span className="text-dim">{item.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="border-t border-line bg-panel px-3 py-3">
        <div className="mb-3 grid grid-cols-4 gap-2">
          {(
            [
              ["N", "/go north"],
              ["W", "/go west"],
              ["E", "/go east"],
              ["S", "/go south"],
            ] as const
          ).map(([label, command]) => (
            <button
              key={label}
              type="button"
              className="min-h-12 border border-line text-2xl disabled:opacity-40"
              onClick={() => submit(command)}
              disabled={!live}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mb-3 grid grid-cols-4 gap-2">
          <button
            type="button"
            className="min-h-12 border border-line text-lg disabled:opacity-40"
            onClick={() => submit("/look")}
            disabled={!live}
          >
            LOOK
          </button>
          <button
            type="button"
            className="min-h-12 border border-line text-lg disabled:opacity-40"
            onClick={() => submit("/search")}
            disabled={!live}
          >
            SEARCH
          </button>
          <button
            type="button"
            className="min-h-12 border border-line text-lg disabled:opacity-40"
            onClick={() => {
              if (!live) return;
              if (alive.length === 1) {
                submit(`/talk ${world.npcs[alive[0]].script.aliases[0]}`);
              } else {
                setDraft("talk ");
                inputRef.current?.focus();
              }
            }}
            disabled={!live}
          >
            TALK
          </button>
          <button
            type="button"
            className="min-h-12 border border-line text-lg disabled:opacity-40"
            onClick={() => submit("/map")}
            disabled={!live}
          >
            MAP
          </button>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <label className="text-2xl text-ash" htmlFor="command">
            {">"}
          </label>
          <input
            id="command"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={!live}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder={
              hearing ? "the room is listening — you can still type" : live ? "what does Null do? (/help)" : "mounting cartridge"
            }
            className="min-h-12 w-full bg-transparent text-2xl text-phosphor outline-none placeholder:text-dim disabled:opacity-60"
          />
          <span className="cursor-block" aria-hidden="true" />
        </form>
      </div>
    </main>
  );
}

function Stripe() {
  return (
    <div className="grid grid-cols-4" aria-hidden="true">
      <div className="h-1 bg-phosphor" />
      <div className="h-1 bg-danger" />
      <div className="h-1 bg-ash" />
      <div className="h-1 bg-dim" />
    </div>
  );
}
