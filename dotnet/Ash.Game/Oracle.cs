using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ash.Game;

public sealed class Reading
{
    public string Name { get; set; } = "";
    public string Memory { get; set; } = "";
    public string Log { get; set; } = "";
}

public sealed class OracleIo
{
    public required Func<string, CancellationToken, Task<Reading>> Read { get; init; }
    public Func<string, string, Reading, CancellationToken, Task<string>>? Whisper { get; init; }
    public Func<World, GameState, string, string, CancellationToken, Task<string>>? Cryptic { get; init; }
    public string Prompt { get; init; } = "";
    public Func<IReadOnlyList<string>, string>? Pick { get; init; }
}

public static class Oracle
{
    const string Dark = "The glass stays dark. There is nobody else here to read.";
    const string Empty = "The glass is empty. Nothing is written there yet.";
    const string Fog = "The glass fogs and keeps its secret.";
    const string Hypnos = "The cartridge cannot read a memory. Hypnos did not answer.";
    const string NoPrompt = "The crystal ball has no voice to read with.";

    static readonly Regex AboutTheBall = new(@"\b(fortune|crystal ball|the glass|whispers)\b", RegexOptions.IgnoreCase);
    static readonly Regex Scratch = new(@"\b(we are writing|you are a crystal|thinking process|the ball whispered about|now tell null)\b", RegexOptions.IgnoreCase);

    public static List<string> PeopleBeside(World world, GameState state, string activator)
    {
        if (!world.Rooms.TryGetValue(state.RoomId, out var room)) return [];
        var ids = new List<string>();
        if (activator != Journal.PlayerId) ids.Add(Journal.PlayerId);
        foreach (var id in room.Npcs)
        {
            if (id == activator) continue;
            if (!state.Npcs.TryGetValue(id, out var npc) || !npc.Alive) continue;
            ids.Add(id);
        }
        return ids;
    }

    public static string PersonName(World world, string id)
    {
        if (id == Journal.PlayerId) return Journal.PlayerName;
        return world.Npcs.TryGetValue(id, out var npc) ? npc.Script.Name : id;
    }

    public static string CleanWhisper(string content)
    {
        var text = Facts.Collapse(content);
        text = Regex.Replace(text, @"<think>[\s\S]*?</think>", "", RegexOptions.IgnoreCase).Trim();
        var fromJson = FieldFromJson(text, "whisper");
        if (fromJson is not null) text = fromJson;
        if ((text.StartsWith('"') && text.EndsWith('"') && text.Length >= 2)
            || (text.StartsWith('“') && text.EndsWith('”') && text.Length >= 2))
        {
            text = text[1..^1].Trim();
        }
        if (text.Length == 0) return "";
        if (Scratch.IsMatch(text)) return "";
        if (text.Length > 400) text = text[..400].Trim();
        return text;
    }

    public static string? FieldFromJson(string text, string field)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0) return null;
        if (end <= start) return CutOffField(text, field);
        try
        {
            var row = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(text[start..(end + 1)]);
            if (row is null || !row.TryGetValue(field, out var value) || value.ValueKind != JsonValueKind.String) return null;
            return Facts.Collapse(value.GetString() ?? "");
        }
        catch (JsonException)
        {
            return CutOffField(text, field);
        }
    }

    static string? CutOffField(string text, string field)
    {
        var match = Regex.Match(text, $"\"{field}\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)");
        if (!match.Success) return null;
        var value = Facts.Collapse(match.Groups[1].Value.Replace("\\\"", "\"").Replace("\\n", " "));
        var sentence = Regex.Match(value, @"^.*[.!?…](?=\s|$)");
        return sentence.Success ? sentence.Value : value;
    }

    static string PickOne(IReadOnlyList<string> ids) =>
        ids[Random.Shared.Next(ids.Count)];

    static void ApplyWhisper(GameState state, string activator, string whisper)
    {
        var heard = $"The crystal ball whispers {Observe.Quote(whisper)}";
        Observe.Remember(state, heard);
        if (activator == Journal.PlayerId) return;
        if (!state.Npcs.TryGetValue(activator, out var npc)) return;
        npc.Log.Add(heard);
    }

    static GameLine Spoken(World world, GameState state, string activator, string text)
    {
        if (activator == Journal.PlayerId) return Engine.Line("body", text);
        var name = PersonName(world, activator);
        Observe.NoteSpeech(world, state, state.RoomId, activator, text);
        return Engine.Line("speech", $"{name}: {text}");
    }

    public static async Task<CommandResult> Consult(World world, CommandResult result, OracleIo io, CancellationToken cancel = default)
    {
        var consult = result.Consult;
        if (consult is null) return result;
        var state = result.State;
        var beside = PeopleBeside(world, state, consult.Activator);
        if (beside.Count == 0)
        {
            return new CommandResult
            {
                State = state,
                Lines = [.. result.Lines, Spoken(world, state, consult.Activator, Dark)],
                Effect = result.Effect,
            };
        }

        var subject = consult.Subject is not null && beside.Contains(consult.Subject)
            ? consult.Subject
            : (io.Pick ?? PickOne)(beside);
        Reading reading;
        try
        {
            reading = await io.Read(subject, cancel);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return new CommandResult
            {
                State = state,
                Lines = [.. result.Lines, Engine.Line("warn", Hypnos)],
                Effect = result.Effect,
            };
        }
        if (consult.Activator != Journal.PlayerId)
        {
            var reader = PersonName(world, consult.Activator);
            var kept = reading.Log.Split(["\r\n", "\n"], StringSplitOptions.None).Where(entry => !entry.Contains(reader));
            reading = new Reading { Name = reading.Name, Memory = reading.Memory, Log = string.Join('\n', kept) };
        }
        if (reading.Memory.Trim().Length == 0 && reading.Log.Trim().Length == 0)
        {
            return new CommandResult
            {
                State = state,
                Lines = [.. result.Lines, Spoken(world, state, consult.Activator, Empty)],
                Effect = result.Effect,
            };
        }
        if (io.Prompt.Trim().Length == 0)
        {
            return new CommandResult
            {
                State = state,
                Lines = [.. result.Lines, Engine.Line("warn", NoPrompt)],
                Effect = result.Effect,
            };
        }

        var whisper = "";
        try
        {
            if (io.Whisper is not null)
            {
                whisper = CleanWhisper(await io.Whisper(io.Prompt, PersonName(world, subject), reading, cancel));
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            whisper = "";
        }
        if (whisper.Length == 0)
        {
            return new CommandResult
            {
                State = state,
                Lines = [.. result.Lines, Spoken(world, state, consult.Activator, Fog)],
                Effect = result.Effect,
            };
        }

        ApplyWhisper(state, consult.Activator, whisper);
        var shown = new List<GameLine>(result.Lines)
        {
            Engine.Line("speech", $"The crystal ball whispers, {Observe.Quote(whisper)}"),
        };
        if (consult.Activator == Journal.PlayerId)
        {
            return new CommandResult { State = state, Lines = shown, Effect = result.Effect };
        }

        var cryptic = "";
        try
        {
            if (io.Cryptic is not null)
            {
                var raw = await io.Cryptic(world, state, consult.Activator, whisper, cancel);
                cryptic = CleanWhisper(FieldFromJson(raw, "say") ?? raw);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            cryptic = "";
        }
        if (cryptic.Length == 0) return new CommandResult { State = state, Lines = shown, Effect = result.Effect };
        shown.Add(Spoken(world, state, consult.Activator, cryptic));
        return new CommandResult { State = state, Lines = shown, Effect = result.Effect };
    }

    public static string Readable(string log) =>
        string.Join('\n', log.Split(["\r\n", "\n"], StringSplitOptions.None)
            .Where(entry => entry.Trim().Length > 0 && !AboutTheBall.IsMatch(entry))).Trim();
}
