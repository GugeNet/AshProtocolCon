using System.Diagnostics;
using System.Text.Json;

namespace Ash.Game;

public sealed class NpcObjective
{
    public string Id { get; set; } = "";
    public string Goal { get; set; } = "";
    public string? UtteranceIncludes { get; set; }
    public Cond? When { get; set; }
    public Cond? Done { get; set; }
    public List<string>? RequiresAllItems { get; set; }
    public List<string>? ConsumeItems { get; set; }
    public List<string>? GrantItems { get; set; }
    public List<Change>? Change { get; set; }
}

public sealed class NpcRole
{
    public string Id { get; set; } = "";
    public string Prompt { get; set; } = "";
    public List<NpcObjective> Objectives { get; set; } = [];
}

public sealed class AgentReply
{
    public string Say { get; set; } = "";
    public List<string> Met { get; set; } = [];
}

public sealed class VoiceAsk
{
    public string NpcId { get; set; } = "";
    public NpcRole? Role { get; set; }
    public string? Utterance { get; set; }
    public List<Beat> Beats { get; set; } = [];
    public string Memory { get; set; } = "";
    public bool HasUtterance { get; set; }
}

public sealed class HarnessIo
{
    public required Func<World, GameState, string, CancellationToken, Task<List<GameAction>?>> Interpret { get; init; }
    public required Func<World, GameState, VoiceAsk, CancellationToken, Task<AgentReply>> Voice { get; init; }
    public required Func<string, CancellationToken, Task<NpcRole?>> Role { get; init; }
    public required Func<string, CancellationToken, Task<string>> Memory { get; init; }
    public Func<World, CommandResult, CancellationToken, Task<CommandResult>>? Consult { get; init; }
}

public static class Harness
{
    const string Static = "The local model did not answer.";
    const string Unread = "The cartridge could not read that. The local model did not answer. Slash commands (/help) still work.";

    public static bool EvidenceHolds(GameState state, NpcObjective objective, string utterance)
    {
        if (objective.Done is not null && Facts.Matches(state, objective.Done, state.RoomId)) return false;
        if (objective.UtteranceIncludes is not null && !Engine.WordHas(utterance, objective.UtteranceIncludes)) return false;
        if (objective.When is not null && !Facts.Matches(state, objective.When, state.RoomId)) return false;
        if (objective.RequiresAllItems is not null && !objective.RequiresAllItems.All(state.Inventory.Contains)) return false;
        if (objective.ConsumeItems is not null && !objective.ConsumeItems.All(state.Inventory.Contains)) return false;
        return true;
    }

    public static (GameState State, List<NpcObjective> Flipped) AcceptMarks(
        GameState state,
        NpcRole role,
        string utterance,
        IReadOnlyList<string> met)
    {
        var next = JsonOpts.Clone(state);
        Facts.EnsureState(next);
        var allowed = role.Objectives.ToDictionary(objective => objective.Id);
        var flipped = new List<NpcObjective>();
        foreach (var id in met)
        {
            if (!allowed.TryGetValue(id, out var objective) || !EvidenceHolds(next, objective, utterance)) continue;
            foreach (var itemId in objective.ConsumeItems ?? [])
            {
                var index = next.Inventory.IndexOf(itemId);
                if (index >= 0) next.Inventory.RemoveAt(index);
            }
            foreach (var itemId in objective.GrantItems ?? [])
            {
                if (!next.Inventory.Contains(itemId)) next.Inventory.Add(itemId);
            }
            Facts.ApplyChanges(next, objective.Change);
            flipped.Add(objective);
        }
        return (next, flipped);
    }

    public static NpcRole? AsRole(string id, JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Object) return null;
        if (!raw.TryGetProperty("id", out var rid) || rid.GetString() != id) return null;
        if (!raw.TryGetProperty("prompt", out var prompt) || prompt.ValueKind != JsonValueKind.String) return null;
        var objectives = new List<NpcObjective>();
        if (raw.TryGetProperty("objectives", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var entry in list.EnumerateArray())
            {
                var objective = AsObjective(entry);
                if (objective is not null) objectives.Add(objective);
            }
        }
        return new NpcRole { Id = id, Prompt = prompt.GetString() ?? "", Objectives = objectives };
    }

    static NpcObjective? AsObjective(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Object) return null;
        if (!raw.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String) return null;
        if (!raw.TryGetProperty("goal", out var goal) || goal.ValueKind != JsonValueKind.String) return null;
        return new NpcObjective
        {
            Id = id.GetString() ?? "",
            Goal = goal.GetString() ?? "",
            UtteranceIncludes = StringProp(raw, "utteranceIncludes"),
            When = CondProp(raw, "when"),
            Done = CondProp(raw, "done"),
            RequiresAllItems = StringsProp(raw, "requiresAllItems"),
            ConsumeItems = StringsProp(raw, "consumeItems"),
            GrantItems = StringsProp(raw, "grantItems"),
            Change = ChangesProp(raw, "change"),
        };
    }

    static string? StringProp(JsonElement raw, string name) =>
        raw.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    static List<string>? StringsProp(JsonElement raw, string name)
    {
        if (!raw.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) return null;
        var list = new List<string>();
        foreach (var entry in value.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.String) return null;
            list.Add(entry.GetString() ?? "");
        }
        return list;
    }

    static Cond? CondProp(JsonElement raw, string name)
    {
        if (!raw.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Object) return null;
        return JsonSerializer.Deserialize<Cond>(value.GetRawText(), JsonOpts.Cartridge);
    }

    static List<Change>? ChangesProp(JsonElement raw, string name)
    {
        if (!raw.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) return null;
        return JsonSerializer.Deserialize<List<Change>>(value.GetRawText(), JsonOpts.Cartridge);
    }

    public static NpcRole? LoadRole(string ashDir, string id)
    {
        var path = Path.Combine(ashDir, "npcs", id, "role.json");
        if (!File.Exists(path)) return null;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            return AsRole(id, doc.RootElement);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static string LoadOraclePrompt(string ashDir, string itemId)
    {
        var path = Path.Combine(ashDir, "oracles", $"{itemId}.json");
        if (!File.Exists(path)) return "";
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            if (!root.TryGetProperty("id", out var id) || id.GetString() != itemId) return "";
            if (!root.TryGetProperty("prompt", out var prompt) || prompt.ValueKind != JsonValueKind.String) return "";
            return prompt.GetString() ?? "";
        }
        catch (JsonException)
        {
            return "";
        }
    }

    public static string VoicePrompt(World world, GameState state, VoiceAsk ask)
    {
        var npc = world.Npcs[ask.NpcId];
        var script = npc.Script;
        state.Npcs.TryGetValue(ask.NpcId, out var runtime);
        var room = world.Rooms[state.RoomId];
        var parts = new List<string>
        {
            $"You are {script.Name} in the text game Ash Protocol. Stay in that life. One to three sentences.",
            "The say field is spoken dialogue only. Do not prefix your name. Do not narrate actions. Do not mention JSON, objectives, or that you are a model.",
            runtime?.Hostile == true ? "You are hostile. Threaten. Do not help. met must be an empty list." : "",
            $"Mood: {npc.State.Mood}.",
            "",
            "ROLE",
            ask.Role?.Prompt.Trim() ?? "",
            "",
            $"ROOM: {room.Name}.",
            PresenceOf(script, state),
            "",
            Observe.MemoryFileSection(ask.Memory),
            "",
            MindSection(runtime?.Mind.Select(item => item.Line).ToList() ?? []),
            "",
            Observe.MemoryPrompt(runtime?.Log),
        };
        if (ask.HasUtterance && ask.Role is not null)
        {
            parts.Add("");
            parts.Add("OBJECTIVES");
            parts.Add(ObjectiveBrief(ask.Role, state, ask.Utterance ?? ""));
            parts.Add("");
            parts.Add("If a line says EVIDENCE HOLDS and the objective is OPEN, put that objective id in met.");
            parts.Add("If a line says EVIDENCE DOES NOT HOLD, or the objective is ALREADY MET, do not put that id in met.");
            parts.Add("Never put an id in met that is not listed.");
        }
        else
        {
            parts.Add("");
            parts.Add("met must be an empty list.");
        }
        if (ask.Beats.Count > 0)
        {
            parts.Add("");
            parts.Add("WHAT JUST HAPPENED");
            parts.AddRange(Distinct(ask.Beats.Select(beat => beat.Event)).Select(ev => $"- {ev}"));
            parts.Add("");
            parts.Add("YOU MUST GET ACROSS");
            parts.AddRange(Distinct(ask.Beats.Select(beat => beat.Gist)).Select(gist => $"- {gist}"));
            parts.Add("");
            parts.Add("Those lines are notes about you: in them, you are you and they are Null.");
            parts.Add("Speak to Null directly, as yourself. Never read the notes aloud or repeat them as instructions.");
            parts.Add("Convey every fact under YOU MUST GET ACROSS, in your own voice. Never contradict it.");
            parts.Add("Do not add prices, items, or places that are not in it or in your ROLE.");
        }
        return string.Join('\n', parts.Where(part => part.Length > 0));
    }

    static string PresenceOf(NpcScript script, GameState state)
    {
        var text = script.Presence;
        foreach (var alt in script.PresenceWhen ?? [])
        {
            if (Facts.Matches(state, alt.When, state.RoomId)) text = alt.Text;
        }
        return text;
    }

    static string ObjectiveBrief(NpcRole role, GameState state, string utterance)
    {
        if (role.Objectives.Count == 0) return "You have no objectives. met must be an empty list.";
        return string.Join('\n', role.Objectives.Select(objective =>
        {
            var open = objective.Done is not null && Facts.Matches(state, objective.Done, state.RoomId) ? "ALREADY MET" : "OPEN";
            var evidence = open == "OPEN" && EvidenceHolds(state, objective, utterance)
                ? "EVIDENCE HOLDS"
                : "EVIDENCE DOES NOT HOLD";
            return $"- {objective.Id} — {open} — {evidence}. {objective.Goal}";
        }));
    }

    static List<string> Distinct(IEnumerable<string> texts) => texts.Distinct().ToList();

    static string MindSection(IReadOnlyList<string> lines)
    {
        if (lines.Count == 0) return "";
        return string.Join('\n', new[] { "WHAT YOU HOLD IN MIND", "These inclinations are already yours. They are memory." }.Concat(lines.Select(entry => $"- {entry}")));
    }

    public static string VoiceCue(VoiceAsk ask)
    {
        var gists = string.Join(' ', Distinct(ask.Beats.Select(beat => beat.Gist)));
        var brief = gists.Length > 0 ? $"\n\nIn your reply, get across: {gists}" : "";
        if (ask.HasUtterance) return $"Null says: {ask.Utterance}{brief}";
        var events = string.Join(' ', Distinct(ask.Beats.Select(beat => beat.Event)));
        return $"{events}{brief}";
    }

    public static AgentReply ParseReply(string content)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(content);
        }
        catch (JsonException)
        {
            return new AgentReply { Say = CleanSay(content) };
        }
        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return new AgentReply();
            var say = doc.RootElement.TryGetProperty("say", out var sayValue) && sayValue.ValueKind == JsonValueKind.String
                ? CleanSay(sayValue.GetString() ?? "")
                : "";
            var met = new List<string>();
            if (doc.RootElement.TryGetProperty("met", out var metValue) && metValue.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in metValue.EnumerateArray())
                {
                    if (entry.ValueKind == JsonValueKind.String) met.Add(entry.GetString() ?? "");
                }
            }
            return new AgentReply { Say = say, Met = met };
        }
    }

    static string CleanSay(string text)
    {
        var say = Facts.Collapse(text);
        if ((say.StartsWith('"') && say.EndsWith('"')) || (say.StartsWith('“') && say.EndsWith('”')))
        {
            say = say.Length >= 2 ? say[1..^1].Trim() : say;
        }
        if (say.Length > 400) say = say[..400].Trim();
        return say;
    }

    public static async Task<CommandResult> Play(
        World world,
        GameState prev,
        string input,
        HarnessIo io,
        CancellationToken cancel = default)
    {
        List<GameAction>? actions;
        if (prev.Mode != "play" || Engine.IsSlashed(input))
        {
            actions = [Engine.ParseCommand(input)];
        }
        else
        {
            try
            {
                actions = await io.Interpret(world, prev, input, cancel);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                actions = null;
            }
            if (actions is null || actions.Count == 0)
            {
                return new CommandResult { State = prev, Lines = [Engine.Line("warn", Unread)] };
            }
        }

        var state = prev;
        var lines = new List<GameLine>();
        var effect = "none";
        foreach (var action in actions)
        {
            var roomId = state.RoomId;
            var step = await RunAction(world, state, action, io, cancel);
            state = step.State;
            lines.AddRange(step.Lines);
            effect = step.Effect;
            if (state.Mode != "play" || state.RoomId != roomId || effect != "none") break;
        }
        return new CommandResult { State = state, Lines = lines, Effect = effect };
    }

    static async Task<CommandResult> RunAction(
        World world,
        GameState prev,
        GameAction action,
        HarnessIo io,
        CancellationToken cancel)
    {
        var result = Engine.ApplyAction(world, prev, action);
        if (result.State.Mode != "play") return result;
        if (result.Consult is not null)
        {
            if (io.Consult is null)
            {
                return new CommandResult
                {
                    State = result.State,
                    Lines = [.. result.Lines, Engine.Line("warn", "The cartridge cannot read a memory. Hypnos did not answer.")],
                    Effect = result.Effect,
                };
            }
            var read = await io.Consult(world, result, cancel);
            return new CommandResult { State = read.State, Lines = read.Lines, Effect = read.Effect };
        }
        var heard = await VoiceRoom(
            world,
            result.State,
            action.Type == "say" ? action.Text : null,
            action.Type == "say",
            result.Beats ?? [],
            io,
            cancel);
        return new CommandResult
        {
            State = heard.State,
            Lines = [.. result.Lines, .. heard.Lines],
            Effect = result.Effect,
        };
    }

    public static async Task<CommandResult> VoiceRoom(
        World world,
        GameState state,
        string? utterance,
        bool speech,
        List<Beat> beats,
        HarnessIo io,
        CancellationToken cancel)
    {
        var roomId = state.RoomId;
        var room = world.Rooms[roomId];
        var present = room.Npcs.Where(id => state.Npcs.TryGetValue(id, out var npc) && npc.Alive).ToList();
        var speakers = present.Where(id => speech || beats.Any(beat => beat.NpcId == id)).ToList();
        if (speakers.Count == 0) return new CommandResult { State = state };
        var wasBlocked = Observe.BlockedDirs(world, state, roomId);
        var replies = new List<(string Id, NpcRole? Role, List<Beat> Beats, string Say, List<string> Met, string Error)>();
        foreach (var id in speakers)
        {
            var mine = beats.Where(beat => beat.NpcId == id).ToList();
            try
            {
                var role = await io.Role(id, cancel);
                var memory = await io.Memory(world.Npcs[id].Script.Name, cancel);
                var reply = await io.Voice(world, state, new VoiceAsk
                {
                    NpcId = id,
                    Role = role,
                    Utterance = utterance,
                    HasUtterance = speech,
                    Beats = mine,
                    Memory = memory,
                }, cancel);
                replies.Add((id, role, mine, reply.Say, reply.Met, ""));
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                replies.Add((id, null, mine, "", [], error.Message));
            }
        }

        if (beats.Count == 0 && replies.All(reply => reply.Error.Length > 0))
        {
            return new CommandResult
            {
                State = state,
                Lines = [Engine.Line("warn", $"The cartridge cannot hear the room. {Static}")],
            };
        }

        var next = state;
        var lines = new List<GameLine>();
        foreach (var reply in replies)
        {
            var script = world.Npcs[reply.Id].Script;
            if (reply.Say.Length > 0)
            {
                lines.Add(Engine.Line("speech", $"{script.Name}: {reply.Say}"));
                Observe.NoteSpeech(world, next, roomId, reply.Id, reply.Say);
            }
            else if (reply.Beats.Count > 0)
            {
                lines.Add(reply.Error.Length > 0
                    ? Engine.Line("warn", $"{script.Name}'s reply is lost in static. {Static}")
                    : Engine.Line("body", $"{script.Name} says nothing."));
            }
            if (!speech || reply.Role is null || reply.Met.Count == 0 || state.Npcs[reply.Id].Hostile) continue;
            var applied = AcceptMarks(next, reply.Role, utterance ?? "", reply.Met);
            next = applied.State;
            foreach (var objective in applied.Flipped)
            {
                lines.Add(Engine.Line("sys", $"{script.Name} meets an objective: {objective.Id.Replace('-', ' ')}."));
                if (objective.ConsumeItems is { Count: > 0 })
                {
                    var handed = Observe.EnglishList(objective.ConsumeItems.Select(id => Engine.ItemName(world, id)).ToList());
                    Observe.Witness(next, Observe.Witnesses(world, next), $"Null hands over {handed}.");
                }
                if (objective.GrantItems is { Count: > 0 })
                {
                    var names = objective.GrantItems.Select(id => Engine.ItemName(world, id)).ToList();
                    var goods = Observe.EnglishList(names);
                    Observe.WitnessAs(
                        next,
                        Observe.Witnesses(world, next),
                        reply.Id,
                        $"I give Null {goods}.",
                        $"{script.Name} gives Null {goods}.");
                    lines.Add(Engine.Line("good", $"You receive {string.Join(", ", names)}."));
                }
            }
        }
        if (speech && lines.Count == 0) lines.Add(Engine.Line("body", "The room lets the words settle."));
        Observe.NoteOpenedDoors(world, next, roomId, wasBlocked);
        var still = Observe.BlockedDirs(world, next, roomId);
        foreach (var dir in wasBlocked)
        {
            if (!still.Contains(dir)) lines.Add(Engine.Line("good", $"The way {dir} is open."));
        }
        return new CommandResult { State = next, Lines = lines };
    }

    public static Reading ReadHypnos(string root, string npcId)
    {
        var start = new ProcessStartInfo
        {
            FileName = "python",
            WorkingDirectory = root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("hypnos.py");
        start.ArgumentList.Add("--read-only");
        start.ArgumentList.Add("--npc");
        start.ArgumentList.Add(npcId);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Hypnos did not start.");
        var stdout = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException($"Hypnos answered {process.ExitCode}");
        using var doc = JsonDocument.Parse(stdout);
        var rootElement = doc.RootElement;
        return new Reading
        {
            Name = rootElement.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() ?? npcId : npcId,
            Memory = rootElement.TryGetProperty("memory", out var memory) && memory.ValueKind == JsonValueKind.String ? memory.GetString() ?? "" : "",
            Log = rootElement.TryGetProperty("log", out var log) && log.ValueKind == JsonValueKind.String ? log.GetString() ?? "" : "",
        };
    }
}
