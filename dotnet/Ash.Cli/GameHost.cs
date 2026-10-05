using System.Text;
using System.Text.Json;
using Ash.Game;

namespace Ash.Cli;

sealed class GameHost
{
    readonly string _root;
    readonly string _ash;
    readonly string _journals;
    readonly string _tapePath;
    readonly string _modelPath;
    readonly string? _backend;
    readonly World _world;
    readonly List<string> _history = [];
    ModelSession? _session;
    bool _modelFailed;
    GameState _state = new();
    string? _armed;
    bool _lineMode;

    public GameHost(string root, string modelPath, string? backend, string? tapePath)
    {
        _root = root;
        _ash = Path.Combine(root, "public", "ash");
        _journals = Path.Combine(root, "journals");
        _tapePath = tapePath ?? Path.Combine(root, "tape.json");
        _modelPath = modelPath;
        _backend = backend;
        _world = WorldBuilder.LoadCartridge(_ash);
    }

    public void Run()
    {
        while (true)
        {
            if (!Title()) return;
            Play();
        }
    }

    bool Title()
    {
        Ansi.Line("exit", "VIC-2147 CARTRIDGE");
        Ansi.Line("body", "ASH PROTOCOL");
        Ansi.Line("speech", "twenty rooms under the ash");
        Console.WriteLine();
        Ansi.Line("body", "A village still trading in brake-light lanterns.");
        Ansi.Line("body", "A mind in the spire, using your voice.");
        Ansi.Line("body", "You win if you reach the final room.");
        Console.WriteLine();
        Ansi.Line("body", "READY.");
        Ansi.Line("exit", "go north · talk · say · attack · trade");
        Ansi.Line("exit", "/help · /map · /save · /exit");
        Console.WriteLine();
        Ansi.Line("body", "new      start a life");
        if (File.Exists(_tapePath)) Ansi.Line("speech", "continue read the tape");
        Ansi.Line("exit", "quit");
        while (true)
        {
            var choice = Read("title> ")?.Trim().ToLowerInvariant();
            if (choice is null || choice is "quit" or "q" or "exit") return false;
            if (choice is "new" or "n")
            {
                Begin(WorldBuilder.InitialState(_world), false);
                return true;
            }
            if (choice is "continue" or "c")
            {
                var tape = ReadTape();
                if (tape is null)
                {
                    Ansi.Line("warn", "No tape on the shelf.");
                    continue;
                }
                Begin(tape, true);
                return true;
            }
            Ansi.Line("warn", "Type new, continue, or quit.");
        }
    }

    void Begin(GameState state, bool resumed)
    {
        _state = state;
        _armed = null;
        Publish(_state);
        foreach (var row in new[]
        {
            "ASH PROTOCOL CARTRIDGE",
            "MODEL VIC-2147    ·    21 ROOMS",
            "",
            "**** ASH BASIC V2 ****",
            "",
            " 3583 BYTES FREE",
            "",
            "READY.",
        })
        {
            Ansi.Line("sys", row);
        }
        if (resumed) Ansi.Line("sys", "TAPE LOADED.");
        else Show(Engine.IntroLines());
        Show(Engine.DescribeRoom(_world, _state));
    }

    void Play()
    {
        while (true)
        {
            Status();
            var raw = Read("> ");
            if (raw is null)
            {
                Ansi.Line("sys", "Cut power.");
                return;
            }
            var text = raw.Trim();
            if (text.Length == 0) continue;
            Remember(text);
            Ansi.Line("echo", $"> {text}");
            if (_state.Mode == "play" && !Engine.IsSlashed(text)) Ansi.Line("exit", "The room is listening…");

            CommandResult result;
            try
            {
                result = Harness.Play(_world, _state, text, Io()).GetAwaiter().GetResult();
            }
            catch (Exception error)
            {
                Ansi.Line("warn", error.Message);
                continue;
            }

            if (result.Effect == "exit")
            {
                if (_armed == "exit") return;
                _armed = "exit";
                Ansi.Line("sys", "Cut power? Type /exit again to confirm. Anything else keeps you in the room.");
                continue;
            }
            if (result.Effect == "restart")
            {
                if (_armed != "restart")
                {
                    _armed = "restart";
                    Ansi.Line("sys", "Boot a new life? /restart again wipes this run. The shelf tape stays until you overwrite it.");
                    continue;
                }
                _armed = null;
                Begin(WorldBuilder.InitialState(_world), false);
                continue;
            }
            _armed = null;

            if (result.Effect == "clear")
            {
                _state = result.State;
                Show(Engine.DescribeRoom(_world, _state));
                continue;
            }
            if (result.Effect == "save")
            {
                if (_state.Mode == "dead")
                {
                    Ansi.Line("warn", "The tape will not record a corpse. /load the last living moment.");
                    continue;
                }
                WriteTape(_state);
                Ansi.Line("sys", "Tape written. The shelf will keep it.");
                continue;
            }
            if (result.Effect == "load")
            {
                var tape = ReadTape();
                if (tape is null)
                {
                    Ansi.Line("warn", "No tape on the shelf.");
                    continue;
                }
                _state = tape;
                Publish(_state);
                Ansi.Line("sys", "Tape loaded.");
                Show(Engine.DescribeRoom(_world, tape));
                continue;
            }

            Show(result.Lines);
            _state = result.State;
            Publish(_state);
            if (_state.Mode != "dead") WriteTape(_state);
        }
    }

    HarnessIo Io() => new()
    {
        Interpret = async (world, state, input, cancel) =>
        {
            var session = await Model(cancel);
            return await Interpreter.Read(world, state, input, session.ToolsAsync, cancel);
        },
        Voice = async (world, state, ask, cancel) =>
        {
            var session = await Model(cancel);
            var system = Harness.VoicePrompt(world, state, ask) + "\n\nReply with only this JSON: {\"say\":\"spoken words\",\"met\":[]}";
            var text = await session.CompleteAsync([("system", system), ("user", Harness.VoiceCue(ask))], 0.6f, 180, cancel);
            return Harness.ParseReply(Slice(text));
        },
        Role = (id, _) => Task.FromResult(Harness.LoadRole(_ash, id)),
        Memory = (name, _) => Task.FromResult(Journal.ReadMemory(_journals, name)),
        Consult = Consult,
    };

    async Task<CommandResult> Consult(World world, CommandResult result, CancellationToken cancel)
    {
        var itemId = result.Consult?.ItemId ?? "";
        var prompt = Harness.LoadOraclePrompt(_ash, itemId);
        try { Journal.Publish(_journals, world, result.State); } catch (IOException) { }
        return await Oracle.Consult(world, result, new OracleIo
        {
            Prompt = prompt,
            Read = (id, _) => Task.FromResult(Harness.ReadHypnos(_root, id)),
            Whisper = async (ball, subject, reading, token) =>
            {
                var session = await Model(token);
                var log = Oracle.Readable(reading.Log);
                var user = string.Join('\n',
                [
                    $"SUBJECT: {subject}",
                    "",
                    "MEMORY",
                    string.IsNullOrWhiteSpace(reading.Memory) ? "(none)" : reading.Memory.Trim(),
                    "",
                    "LOG",
                    log.Length > 0 ? log : "(nothing)",
                ]);
                var system = ball.Trim() + "\n\nReply with only this JSON: {\"whisper\":\"one sentence\"}";
                return await session.CompleteAsync([("system", system), ("user", user)], 0.3f, 80, token);
            },
            Cryptic = async (game, here, npcId, whisper, token) =>
            {
                var role = Harness.LoadRole(_ash, npcId);
                if (role is null || !game.Npcs.TryGetValue(npcId, out var npc)) return "";
                var session = await Model(token);
                var system = string.Join('\n',
                [
                    $"You are {npc.Script.Name} in the text game Ash Protocol. Stay in that life. One or two sentences.",
                    "The say field is spoken dialogue only. Do not prefix your name.",
                    "",
                    "ROLE",
                    role.Prompt.Trim(),
                    "",
                    "Null asked you to read his fortune. You looked into your crystal ball, and it just whispered about him. He heard it too.",
                    "Tell Null, in your own voice, what you make of it and what it may mean for him.",
                    "Do not repeat the whisper word for word. Do not invent places, people, prices, or items that are not in it or in your ROLE.",
                    "",
                    "Reply with only this JSON: {\"say\":\"spoken words\"}",
                ]);
                var cue = $"The ball whispered about Null: {Observe.Quote(whisper)}\n\nNow tell Null what you make of it.";
                return await session.CompleteAsync([("system", system), ("user", cue)], 0.7f, 160, token);
            },
        }, cancel);
    }

    async Task<ModelSession> Model(CancellationToken cancel)
    {
        if (_session is not null) return _session;
        if (_modelFailed) throw new InvalidOperationException("The local model did not answer.");
        try
        {
            _session = await Task.Run(() => ModelSession.Open(_modelPath, _backend, Console.Out), cancel);
            Ansi.Line("sys", $"Model ready ({_session.Backend}).");
            return _session;
        }
        catch (Exception error)
        {
            _modelFailed = true;
            Ansi.Line("warn", error.Message);
            throw;
        }
    }

    void Publish(GameState state)
    {
        try { Journal.Publish(_journals, _world, state); }
        catch (IOException error) { Ansi.Line("warn", error.Message); }
    }

    void WriteTape(GameState state)
    {
        File.WriteAllText(_tapePath, JsonSerializer.Serialize(state, JsonOpts.Tape));
    }

    GameState? ReadTape()
    {
        if (!File.Exists(_tapePath)) return null;
        try
        {
            var state = JsonSerializer.Deserialize<GameState>(File.ReadAllText(_tapePath), JsonOpts.Tape);
            if (state is null || (state.Version != 1 && state.Version != 2) || ! _world.Rooms.ContainsKey(state.RoomId)) return null;
            return Observe.RepairLogs(state, _world);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    void Status()
    {
        var room = _world.Rooms.TryGetValue(_state.RoomId, out var here) ? here.Name : _state.RoomId;
        var hpKind = _state.Hp < 5 ? "warn" : "body";
        Console.Write(Ansi.Paint("body", room));
        Console.Write(Ansi.Paint("exit", "  HP "));
        Console.Write(Ansi.Paint(hpKind, _state.Hp.ToString()));
        Console.Write(Ansi.Paint("exit", "  SCRIP "));
        Console.WriteLine(Ansi.Paint("body", _state.Scrip.ToString()));
        Console.Out.Flush();
    }

    void Show(IEnumerable<GameLine> lines)
    {
        foreach (var line in lines) Ansi.Line(line.Kind, line.Text);
    }

    void Remember(string text)
    {
        if (_history.Count == 0 || _history[^1] != text) _history.Add(text);
    }

    string? Read(string prompt)
    {
        Ansi.Prompt(prompt);
        if (_lineMode || Console.IsInputRedirected) return Console.ReadLine();
        try
        {
            return ReadKeys();
        }
        catch (InvalidOperationException)
        {
            _lineMode = true;
            return Console.ReadLine();
        }
    }

    string ReadKeys()
    {
        var buffer = new StringBuilder();
        var draft = "";
        var at = _history.Count;
        while (true)
        {
            var key = Console.ReadKey(true);
            if (key.Key == ConsoleKey.Enter)
            {
                Console.WriteLine();
                return buffer.ToString();
            }
            if (key.Key == ConsoleKey.Backspace)
            {
                if (buffer.Length == 0) continue;
                buffer.Length--;
                Console.Write("\b \b");
                continue;
            }
            if (key.Key == ConsoleKey.UpArrow)
            {
                if (_history.Count == 0) continue;
                if (at == _history.Count) draft = buffer.ToString();
                at = Math.Max(0, at - 1);
                Replace(buffer, _history[at]);
                continue;
            }
            if (key.Key == ConsoleKey.DownArrow)
            {
                if (at >= _history.Count) continue;
                at++;
                Replace(buffer, at == _history.Count ? draft : _history[at]);
                continue;
            }
            if (key.KeyChar == '\0' || char.IsControl(key.KeyChar)) continue;
            buffer.Append(key.KeyChar);
            Console.Write(key.KeyChar);
        }
    }

    static void Replace(StringBuilder buffer, string next)
    {
        while (buffer.Length > 0)
        {
            buffer.Length--;
            Console.Write("\b \b");
        }
        buffer.Append(next);
        Console.Write(next);
    }

    static string Slice(string text)
    {
        var cleaned = ModelSession.Strip(text);
        var start = cleaned.IndexOf('{');
        var end = cleaned.LastIndexOf('}');
        if (start < 0 || end <= start) return cleaned;
        return cleaned[start..(end + 1)];
    }
}
