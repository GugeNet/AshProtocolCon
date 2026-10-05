using System.Text.Json;
using System.Text.RegularExpressions;

namespace Ash.Game;

public sealed class JournalPerson
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Log { get; set; } = [];
}

public sealed class MemoryFile
{
    public string Memory { get; set; } = "";
}

public static class Journal
{
    public const string HypnosMarker = "--- hypnos ---";
    public const string PlayerId = "null";
    public const string PlayerName = "Null";

    public static string PersonFileName(string name)
    {
        var cleaned = Regex.Replace(name, @"[<>:""/\\|?*\u0000-\u001f]", "");
        cleaned = Regex.Replace(cleaned, @"\s+", " ").Trim().TrimEnd('.', ' ');
        if (cleaned.Length == 0 || cleaned is "." or "..") return "unnamed";
        return cleaned;
    }

    public static string LogFileName(string name) => $"{PersonFileName(name)}.log";

    public static string MemoryFileName(string name) => $"{PersonFileName(name)}.memory.json";

    public static string LegacyMemoryFileName(string name) => $"{PersonFileName(name)}.memory.txt";

    public static string MergeJournal(string existing, IReadOnlyList<string> lines)
    {
        var events = lines.Select(line => line.Replace("\r", "")).Where(line => line.Length > 0).ToList();
        if (events.Count == 0) return "";
        var fileLines = existing.Replace("\r\n", "\n").Split('\n').ToList();
        if (fileLines.Count > 0 && fileLines[^1] == "") fileLines.RemoveAt(fileLines.Count - 1);
        var last = -1;
        for (var index = 0; index < fileLines.Count; index++)
        {
            if (fileLines[index] == HypnosMarker) last = index;
        }
        if (last < 0) return string.Join('\n', events) + "\n";
        var prior = fileLines.Take(last).Where(line => line != HypnosMarker && line.Length > 0).ToList();
        var matches = prior.Count <= events.Count && prior.Select((line, index) => line == events[index]).All(ok => ok);
        if (!matches) return string.Join('\n', events) + "\n";
        var fresh = events.Skip(prior.Count);
        return string.Join('\n', fileLines.Take(last + 1).Concat(fresh)) + "\n";
    }

    public static List<JournalPerson> People(World world, GameState state)
    {
        var people = world.Npcs.Select(pair => new JournalPerson
        {
            Id = pair.Key,
            Name = pair.Value.Script.Name,
            Log = state.Npcs.TryGetValue(pair.Key, out var npc) ? npc.Log : [],
        }).ToList();
        people.Add(new JournalPerson
        {
            Id = PlayerId,
            Name = PlayerName,
            Log = state.PlayerLog ?? [],
        });
        return people;
    }

    public static void Publish(string journalsDir, World world, GameState state)
    {
        Directory.CreateDirectory(journalsDir);
        foreach (var person in People(world, state))
        {
            var path = Path.Combine(journalsDir, LogFileName(person.Name));
            var existing = File.Exists(path) ? File.ReadAllText(path) : "";
            File.WriteAllText(path, MergeJournal(existing, person.Log));
        }
    }

    public static string ReadMemory(string journalsDir, string name)
    {
        var jsonPath = Path.Combine(journalsDir, MemoryFileName(name));
        if (File.Exists(jsonPath))
        {
            try
            {
                var row = JsonSerializer.Deserialize<MemoryFile>(File.ReadAllText(jsonPath), JsonOpts.Cartridge);
                return row?.Memory ?? "";
            }
            catch (JsonException)
            {
                return "";
            }
        }
        var legacy = Path.Combine(journalsDir, LegacyMemoryFileName(name));
        return File.Exists(legacy) ? File.ReadAllText(legacy) : "";
    }
}
