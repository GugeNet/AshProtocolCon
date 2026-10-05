namespace Ash.Game;

public static class Observe
{
    const string Player = "Null";

    static HashSet<string> PlacedItems(GameState state)
    {
        var ids = new HashSet<string>();
        foreach (var id in state.Inventory) ids.Add(id);
        foreach (var pile in state.RoomItems.Values)
        {
            foreach (var id in pile) ids.Add(id);
        }
        foreach (var npc in state.Npcs.Values)
        {
            foreach (var id in npc.Inventory) ids.Add(id);
        }
        return ids;
    }

    static bool Claim(HashSet<string> held, string itemId)
    {
        if (!held.Add(itemId)) return false;
        return true;
    }

    public static GameState RepairLogs(GameState state, World? world = null)
    {
        state.Npcs ??= [];
        state.PlayerLog ??= [];
        state.Inventory ??= [];
        state.RoomItems ??= [];
        foreach (var npc in state.Npcs.Values)
        {
            npc.Log ??= [];
            npc.Inventory ??= [];
            npc.Mind ??= [];
        }
        if (world is null) return Facts.EnsureState(state);
        var held = PlacedItems(state);
        foreach (var (id, npc) in world.Npcs)
        {
            if (state.Npcs.ContainsKey(id)) continue;
            var inventory = npc.State.Inventory.Where(itemId => Claim(held, itemId)).ToList();
            var runtime = new NpcRuntime
            {
                Alive = npc.State.Alive,
                Hp = npc.State.Hp,
                MaxHp = npc.State.MaxHp,
                Hostile = npc.State.Hostile,
                Inventory = inventory,
                Mind = [],
                Log = [],
            };
            state.Npcs[id] = runtime;
            var here = world.Rooms.Values.FirstOrDefault(room => room.Npcs.Contains(id));
            if (here is not null && here.Id == state.RoomId && runtime.Alive)
            {
                runtime.Log.Add($"{Player} comes into the {here.Name}.");
            }
        }
        foreach (var room in world.Rooms.Values)
        {
            if (state.RoomItems.ContainsKey(room.Id)) continue;
            state.RoomItems[room.Id] = room.Ground
                .Select(ground => ground.Id)
                .Where(itemId => Claim(held, itemId))
                .ToList();
        }
        Facts.EnsureState(state, world);
        return state;
    }

    public static void Remember(GameState state, string text)
    {
        var flat = Facts.Collapse(text);
        if (flat.Length == 0) return;
        state.PlayerLog.Add(flat);
    }

    public static List<string> Witnesses(World world, GameState state, string? roomId = null)
    {
        roomId ??= state.RoomId;
        if (!world.Rooms.TryGetValue(roomId, out var room)) return [];
        return room.Npcs.Where(id => state.Npcs.TryGetValue(id, out var npc) && npc.Alive).ToList();
    }

    public static void Witness(GameState state, IEnumerable<string> ids, string text)
    {
        foreach (var id in ids)
        {
            if (!state.Npcs.TryGetValue(id, out var npc)) continue;
            npc.Log.Add(text);
        }
    }

    public static void WitnessAs(GameState state, IEnumerable<string> ids, string selfId, string mine, string theirs)
    {
        foreach (var id in ids)
        {
            if (!state.Npcs.TryGetValue(id, out var npc)) continue;
            npc.Log.Add(id == selfId ? mine : theirs);
        }
    }

    public static string Quote(string text)
    {
        var flat = Facts.Collapse(text);
        var wrapped =
            (flat.StartsWith('"') && flat.EndsWith('"') && flat.Length >= 2)
            || (flat.StartsWith('“') && flat.EndsWith('”') && flat.Length >= 2);
        var bare = wrapped ? flat[1..^1].Trim() : flat;
        return $"\"{bare}\"";
    }

    public static string EnglishList(IReadOnlyList<string> parts)
    {
        if (parts.Count <= 1) return parts.Count == 0 ? "" : parts[0];
        if (parts.Count == 2) return $"{parts[0]} and {parts[1]}";
        return $"{string.Join(", ", parts.Take(parts.Count - 1))}, and {parts[^1]}";
    }

    public static string TradeNote(string exchange) => $"Trade happens - {exchange}.";

    public static string MemoryPrompt(IReadOnlyList<string>? log)
    {
        if (log is null || log.Count == 0) return "";
        var recent = log.Count > 80
            ? new[] { "(Earlier events omitted.)" }.Concat(log.Skip(log.Count - 80))
            : log;
        return string.Join('\n', new[] { "WHAT YOU HAVE SEEN", "These events already happened. Remember them." }.Concat(recent));
    }

    public static string MemoryFileSection(string text)
    {
        var trimmed = text.Replace("\r\n", "\n").Trim();
        if (trimmed.Length == 0) return "";
        return string.Join('\n', ["MEMORY", "This is your long memory, written while you slept. It is yours.", trimmed]);
    }

    static bool DoorOpen(GameState state, Obstacle obstacle, string roomId) =>
        obstacle.When is not null && Facts.Matches(state, obstacle.When, roomId);

    public static List<string> BlockedDirs(World world, GameState state, string roomId)
    {
        if (!world.Rooms.TryGetValue(roomId, out var room)) return [];
        var dirs = new List<string>();
        foreach (var obstacle in room.Obstacles)
        {
            if (!DoorOpen(state, obstacle, roomId) && !dirs.Contains(obstacle.Dir)) dirs.Add(obstacle.Dir);
        }
        return dirs;
    }

    public static void NoteOpenedDoors(World world, GameState state, string roomId, IReadOnlyList<string> was)
    {
        if (state.RoomId != roomId) return;
        var now = BlockedDirs(world, state, roomId).ToHashSet();
        var ids = Witnesses(world, state, roomId);
        foreach (var dir in was)
        {
            if (now.Contains(dir)) continue;
            Witness(state, ids, $"Door to {dir} opens.");
            Remember(state, $"Door to {dir} opens.");
        }
    }

    public static void NoteArrival(World world, GameState state, string roomId)
    {
        if (!world.Rooms.TryGetValue(roomId, out var room)) return;
        Witness(state, Witnesses(world, state, roomId), $"{Player} comes into the {room.Name}.");
        Remember(state, $"I come into the {room.Name}.");
    }

    public static void NoteSpeech(World world, GameState state, string roomId, string speakerId, string text)
    {
        var flat = Facts.Collapse(text);
        if (flat.Length == 0) return;
        if (!world.Npcs.TryGetValue(speakerId, out var npc)) return;
        var said = Quote(flat);
        WitnessAs(
            state,
            Witnesses(world, state, roomId),
            speakerId,
            $"I reply {said}",
            $"{npc.Script.Name} replies {said}");
        Remember(state, $"{npc.Script.Name} replies {said}");
    }
}
