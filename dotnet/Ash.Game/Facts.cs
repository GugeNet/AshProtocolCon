namespace Ash.Game;

public static class Facts
{
    const string Hymn = "The chapel asked what remains when the fire is spent. The word sits behind my teeth.";
    const string ToldAsh = "I told him ASH is coughing in the chapel radio, north of the market.";
    const string TradedLight = "I took his stim and gave him the glowcapsule. The tin is empty of light.";
    const string PaidStory = "I paid him six scrip for the story of the radio using his voice.";
    const string SavedWord = "I told him to save the word Ash for the gate and the copy of himself.";
    const string GaveTape = "I pressed the cipher tape into his hand.";

    public static IEnumerable<Fact> EachFact(Cond? cond)
    {
        if (cond is null) yield break;
        if (cond.IsWhen)
        {
            if (cond.All is not null)
            {
                foreach (var fact in cond.All) yield return fact;
            }
            if (cond.Any is not null)
            {
                foreach (var fact in cond.Any) yield return fact;
            }
            yield break;
        }
        yield return cond.ToFact();
    }

    static void RememberLine(GameState state, string line)
    {
        var flat = Collapse(line);
        if (flat.Length == 0) return;
        state.PlayerLog.Add(flat);
    }

    public static string Collapse(string line)
    {
        return string.Join(' ', line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    static bool AddMind(List<Inclination> list, string id, string line)
    {
        if (list.Any(item => item.Id == id)) return false;
        list.Add(new Inclination { Id = id, Line = line });
        return true;
    }

    public static bool FactHolds(GameState state, Fact fact, string here)
    {
        if (fact.Carrying is not null) return state.Inventory.Contains(fact.Carrying);
        if (fact.HeldBy is not null)
        {
            return state.Npcs.TryGetValue(fact.HeldBy, out var npc) && npc.Inventory.Contains(fact.Item ?? "");
        }
        if (fact.Recalls is not null)
        {
            return state.Npcs.TryGetValue(fact.Npc ?? "", out var npc)
                && npc.Mind.Any(item => item.Id == fact.Recalls);
        }
        if (fact.Mind is not null) return state.Mind.Any(item => item.Id == fact.Mind);
        if (fact.Place is not null)
        {
            var room = fact.Room ?? here;
            return state.Places.TryGetValue(room, out var fixtures)
                && fixtures.TryGetValue(fact.Place, out var value)
                && value == fact.Is;
        }
        if (fact.Wave is not null) return state.Air.Contains(fact.Wave);
        if (fact.Gone is not null)
        {
            return state.Npcs.TryGetValue(fact.Gone, out var npc) && !npc.Alive;
        }
        return false;
    }

    public static bool Matches(GameState state, Cond? cond, string here)
    {
        if (cond is null) return true;
        if (cond.IsWhen)
        {
            if (cond.All is not null && !cond.All.All(fact => FactHolds(state, fact, here))) return false;
            if (cond.Any is not null && !cond.Any.Any(fact => FactHolds(state, fact, here))) return false;
            return true;
        }
        return FactHolds(state, cond.ToFact(), here);
    }

    public static void ApplyChanges(GameState state, List<Change>? changes, string? actor = null)
    {
        if (changes is null || changes.Count == 0) return;
        EnsureState(state);
        foreach (var change in changes)
        {
            if (change.Remember is not null)
            {
                if (AddMind(state.Mind, change.Remember, change.Line ?? "")) RememberLine(state, change.Line ?? "");
                continue;
            }
            if (change.Recall is not null)
            {
                var npcId = change.Npc ?? actor;
                if (npcId is null || !state.Npcs.TryGetValue(npcId, out var npc)) continue;
                if (AddMind(npc.Mind, change.Recall, change.Line ?? "")) npc.Log.Add(change.Line ?? "");
                continue;
            }
            if (change.Place is not null && change.Room is not null)
            {
                if (!state.Places.TryGetValue(change.Room, out var room))
                {
                    room = [];
                    state.Places[change.Room] = room;
                }
                room[change.Place] = change.Is ?? "";
                continue;
            }
            if (change.Wave is not null && !state.Air.Contains(change.Wave)) state.Air.Add(change.Wave);
        }
    }

    static bool On(Dictionary<string, bool>? flags, string id) =>
        flags is not null && flags.TryGetValue(id, out var value) && value;

    static void MigrateFlags(GameState state)
    {
        var flags = state.Flags;
        if (flags is null) return;

        if (On(flags, "hymn_heard")) AddMind(state.Mind, "hymn", Hymn);
        if (On(flags, "password_known") && !state.Air.Contains("cinder")) state.Air.Add("cinder");
        if (On(flags, "shard_a_found")) SetPlace(state, "ash-well", "cache", "empty");
        if (On(flags, "gate_open")) SetPlace(state, "protocol-gate", "seal", "open");
        if (On(flags, "ferryman_paid")) SetPlace(state, "black-canal", "skiff", "loose");
        if (On(flags, "pike_passed")) SetPlace(state, "smugglers-cut", "chain", "down");
        if (On(flags, "kite_passed")) SetPlace(state, "watchtower", "hatch", "open");
        if (On(flags, "razor_passed")) SetPlace(state, "combat-pit", "stair", "clear");

        void Recall(string npcId, string id, string line)
        {
            if (!state.Npcs.TryGetValue(npcId, out var npc)) return;
            AddMind(npc.Mind, id, line);
        }
        if (On(flags, "heard_coil_ash")) Recall("old-coil", "told-ash", ToldAsh);
        if (On(flags, "coil_traded")) Recall("old-coil", "traded-light", TradedLight);
        if (On(flags, "coil_story")) Recall("old-coil", "paid-story", PaidStory);
        if (On(flags, "heard_sister_ash")) Recall("sister-static", "saved-the-word", SavedWord);
        if (On(flags, "cipher_got")) Recall("ash-fragment", "gave-tape", GaveTape);

        state.Flags = null;
    }

    static void SetPlace(GameState state, string roomId, string name, string value)
    {
        if (!state.Places.TryGetValue(roomId, out var room))
        {
            room = [];
            state.Places[roomId] = room;
        }
        room[name] = value;
    }

    public static GameState EnsureState(GameState state, World? world = null)
    {
        state.Mind ??= [];
        state.Air ??= [];
        state.Places ??= [];
        state.PlayerLog ??= [];
        state.Inventory ??= [];
        state.Npcs ??= [];
        foreach (var npc in state.Npcs.Values)
        {
            npc.Mind ??= [];
            npc.Log ??= [];
            npc.Inventory ??= [];
        }
        if (world is not null)
        {
            foreach (var room in world.Rooms.Values)
            {
                if (!state.Places.TryGetValue(room.Id, out var have))
                {
                    have = [];
                    state.Places[room.Id] = have;
                }
                if (room.Fixtures is null) continue;
                foreach (var (name, value) in room.Fixtures)
                {
                    if (!have.ContainsKey(name)) have[name] = value;
                }
            }
        }
        MigrateFlags(state);
        state.Version = 2;
        return state;
    }
}
