using System.Text.RegularExpressions;

namespace Ash.Game;

public static class Engine
{
    public const string SaveKey = "ash-protocol-tape-v1";

    static readonly Dictionary<string, string> DirAlias = new()
    {
        ["n"] = "north",
        ["s"] = "south",
        ["e"] = "east",
        ["w"] = "west",
        ["north"] = "north",
        ["south"] = "south",
        ["east"] = "east",
        ["west"] = "west",
    };

    static readonly HashSet<string> Meta = ["help", "inv", "status", "map", "save", "load", "clear", "restart", "exit"];

    public static GameLine Line(string kind, string text) => new() { Kind = kind, Text = text };

    public static bool IsSlashed(string input) => input.TrimStart().StartsWith('/');

    public static GameAction ParseCommand(string raw)
    {
        var trimmed = Regex.Replace(raw.Trim(), @"\s+", " ");
        var slashed = trimmed.StartsWith('/');
        var squashed = slashed ? trimmed[1..].Trim() : trimmed;
        if (squashed.Length == 0) return slashed ? GameAction.Of("meta") : GameAction.Of("empty");
        if (slashed && !squashed.Contains(' '))
        {
            var cmd = AliasMeta(squashed.ToLowerInvariant());
            if (Meta.Contains(cmd) || cmd == "look") return new GameAction { Type = "meta", Cmd = cmd };
        }
        var parsed = ParseVerb(squashed);
        if (slashed && parsed.Type == "unknown" && !squashed.Contains(' '))
        {
            return new GameAction { Type = "meta", Cmd = AliasMeta(squashed.ToLowerInvariant()) };
        }
        return parsed;
    }

    static GameAction ParseVerb(string squashed)
    {
        var lower = squashed.ToLowerInvariant();
        if (Regex.IsMatch(lower, @"^(help|\?)$")) return new GameAction { Type = "meta", Cmd = "help" };
        if (Regex.IsMatch(lower, @"^(inventory|inv|i)$")) return new GameAction { Type = "meta", Cmd = "inv" };
        if (Regex.IsMatch(lower, @"^(status|stats|score)$")) return new GameAction { Type = "meta", Cmd = "status" };
        if (lower == "map") return new GameAction { Type = "meta", Cmd = "map" };
        if (lower == "save") return new GameAction { Type = "meta", Cmd = "save" };
        if (lower == "load") return new GameAction { Type = "meta", Cmd = "load" };
        if (lower == "clear") return new GameAction { Type = "meta", Cmd = "clear" };
        if (lower == "restart") return new GameAction { Type = "meta", Cmd = "restart" };
        if (Regex.IsMatch(lower, @"^(exit|quit)$")) return new GameAction { Type = "meta", Cmd = "exit" };

        var match = Regex.Match(lower, @"^(?:go|walk|move|run|head)(?:\s+to)?\s+(north|south|east|west|n|s|e|w)$");
        if (match.Success) return new GameAction { Type = "go", Dir = DirAlias[match.Groups[1].Value] };
        if (Regex.IsMatch(lower, @"^(north|south|east|west|n|s|e|w)$"))
        {
            return new GameAction { Type = "go", Dir = DirAlias[lower] };
        }
        if (Regex.IsMatch(lower, @"^(look|l)$")) return GameAction.Of("look");
        match = Regex.Match(lower, @"^(?:look|examine|inspect|x)\s+(?:at\s+)?(.+)$");
        if (match.Success) return new GameAction { Type = "examine", Target = match.Groups[1].Value };
        if (Regex.IsMatch(lower, @"^(search|rummage)$")) return GameAction.Of("search");
        if (Regex.IsMatch(lower, @"^(listen|pray|kneel)$")) return GameAction.Of("listen");
        match = Regex.Match(lower, @"^(?:take|get|grab|pick up|pocket|loot)\s+(.+)$");
        if (match.Success) return new GameAction { Type = "take", Target = match.Groups[1].Value };
        match = Regex.Match(lower, @"^(?:drop|leave)\s+(.+)$");
        if (match.Success) return new GameAction { Type = "drop", Target = match.Groups[1].Value };
        match = Regex.Match(lower, @"^(?:ask|talk|speak)(?:\s+to|\s+with)?\s+(.+?)\s+for\s+(?:(?:a|the|my|your)\s+)?fortune$");
        if (match.Success) return new GameAction { Type = "talk", Target = match.Groups[1].Value, Topic = "fortune" };
        match = Regex.Match(lower, @"^(?:talk|speak|ask)(?:\s+to|\s+with)?\s+(.+?)(?:\s+about\s+(.+))?$");
        if (match.Success)
        {
            var topic = match.Groups[2].Success ? match.Groups[2].Value : null;
            return new GameAction { Type = "talk", Target = match.Groups[1].Value, Topic = topic };
        }
        match = Regex.Match(lower, @"^give\s+(.+?)\s+to\s+(.+)$");
        if (match.Success) return new GameAction { Type = "give", Item = match.Groups[1].Value, Npc = match.Groups[2].Value };
        match = Regex.Match(lower, @"^buy\s+(.+)$");
        if (match.Success) return new GameAction { Type = "buy", Item = match.Groups[1].Value };
        match = Regex.Match(lower, @"^sell\s+(.+)$");
        if (match.Success) return new GameAction { Type = "sell", Item = match.Groups[1].Value };
        match = Regex.Match(lower, @"^(?:pay|bribe)\s+(.+)$");
        if (match.Success) return new GameAction { Type = "pay", Npc = match.Groups[1].Value };
        if (lower == "heal") return new GameAction { Type = "pay", Npc = "doc" };
        match = Regex.Match(lower, @"^heal\s+(.+)$");
        if (match.Success) return new GameAction { Type = "pay", Npc = match.Groups[1].Value };
        match = Regex.Match(lower, @"^(?:attack|fight|kill|hit|strike)\s+(.+)$");
        if (match.Success) return new GameAction { Type = "attack", Target = match.Groups[1].Value };
        if (Regex.IsMatch(lower, @"^(flee|run away|escape)$")) return GameAction.Of("flee");
        match = Regex.Match(lower, @"^use\s+(.+)$");
        if (match.Success) return new GameAction { Type = "use", Item = match.Groups[1].Value };
        match = Regex.Match(squashed, @"^(?:say|answer|shout)\s+(.+)$", RegexOptions.IgnoreCase);
        if (match.Success) return new GameAction { Type = "say", Text = match.Groups[1].Value.Trim() };
        match = Regex.Match(lower, @"^tell\s+(.+?)\s+(?:a\s+)?story$");
        if (match.Success) return new GameAction { Type = "story", Npc = match.Groups[1].Value };
        if (Regex.IsMatch(lower, @"^(trade|shop|wares|browse)$")) return GameAction.Of("trade");
        if (Regex.IsMatch(lower, @"^(wait|rest|z)$")) return GameAction.Of("wait");
        return new GameAction { Type = "unknown", Raw = squashed };
    }

    static string AliasMeta(string cmd) => cmd switch
    {
        "inventory" or "i" => "inv",
        "stats" or "score" => "status",
        "quit" => "exit",
        "?" => "help",
        _ => cmd,
    };

    public static bool WordHas(string text, string needle)
    {
        var escaped = Regex.Escape(needle);
        return Regex.IsMatch(text, $@"\b{escaped}\b", RegexOptions.IgnoreCase);
    }

    public static string ItemName(World world, string id) =>
        world.Items.TryGetValue(id, out var item) ? item.Name : id;

    static string Named(World world, IReadOnlyList<string> ids) =>
        Observe.EnglishList(ids.Select(id => ItemName(world, id)).ToList());

    static void NoteTalk(World world, GameState state, string npcId, string? topic)
    {
        var name = world.Npcs[npcId].Script.Name;
        var about = topic is null ? "" : $" about {topic}";
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, $"Null talks to me{about}.", $"Null talks to {name}{about}.");
        Observe.Remember(state, $"I talk to {name}{about}.");
    }

    static void NoteGift(World world, GameState state, string npcId, IReadOnlyList<string> ids)
    {
        if (ids.Count == 0) return;
        var name = world.Npcs[npcId].Script.Name;
        var goods = Named(world, ids);
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, $"I give Null {goods}.", $"{name} gives Null {goods}.");
    }

    static void NoteScrip(World world, GameState state, string npcId, int amount)
    {
        if (amount == 0) return;
        var name = world.Npcs[npcId].Script.Name;
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, $"I give Null {amount} scrip.", $"{name} gives Null {amount} scrip.");
    }

    static void NoteOffer(World world, GameState state, string npcId, string item)
    {
        var name = world.Npcs[npcId].Script.Name;
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, $"Null offers {item} to me.", $"Null offers {item} to {name}.");
        Observe.Remember(state, $"I offer {item} to {name}.");
    }

    static bool HasItem(GameState state, string id) => state.Inventory.Contains(id);

    static void AddItem(GameState state, string id) => state.Inventory.Add(id);

    static bool RemoveItem(GameState state, string id)
    {
        var index = state.Inventory.IndexOf(id);
        if (index < 0) return false;
        state.Inventory.RemoveAt(index);
        return true;
    }

    static string BareNoun(string query)
    {
        var q = Regex.Replace(query.ToLowerInvariant().Trim(), @"\s+", " ");
        q = Regex.Replace(q, @"[.,!?;:]+$", "").Trim();
        while (Regex.IsMatch(q, @"^(?:the|a|an|some|my|your|that|this)\s+"))
        {
            q = Regex.Replace(q, @"^(?:the|a|an|some|my|your|that|this)\s+", "");
        }
        return Regex.Replace(q, @"[.,!?;:]+$", "").Trim();
    }

    static ItemDef? MatchItem(World world, string query, IEnumerable<string> ids)
    {
        var q = BareNoun(query);
        if (q.Length < 2) return null;
        var pool = ids.Where(world.Items.ContainsKey).Select(id => world.Items[id]).ToList();
        int Score(ItemDef item)
        {
            if (item.Id == q || item.Name.ToLowerInvariant() == q) return 100;
            if (item.Aliases.Any(alias => alias == q)) return 90;
            if (item.Name.ToLowerInvariant().Contains(q) || item.Aliases.Any(alias => alias.Contains(q))) return 60;
            return 0;
        }
        var ranked = pool
            .Select(item => (item, score: Score(item)))
            .Where(row => row.score > 0)
            .OrderByDescending(row => row.score)
            .ToList();
        if (ranked.Count == 0) return null;
        if (ranked.Count > 1 && ranked[0].score == ranked[1].score && ranked[0].item.Id != ranked[1].item.Id) return null;
        return ranked[0].item;
    }

    public static ItemDef? FindItem(World world, string query, IEnumerable<string> ids) => MatchItem(world, query, ids);

    static List<string> VisibleGround(World world, GameState state, RoomDef room)
    {
        if (!state.RoomItems.TryGetValue(room.Id, out var pile)) return [];
        return pile.Where(id =>
        {
            var spec = room.Ground.FirstOrDefault(ground => ground.Id == id);
            if (spec?.HiddenUntil is not null && !Facts.Matches(state, spec.HiddenUntil, room.Id)) return false;
            return true;
        }).ToList();
    }

    public static List<ItemDef> ItemsInRoom(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        return VisibleGround(world, state, room)
            .Where(world.Items.ContainsKey)
            .Select(id => world.Items[id])
            .ToList();
    }

    public static bool IsCartridgeMeta(string input) => IsSlashed(input) && ParseCommand(input).Type == "meta";

    public static List<ItemDef> OraclesInHands(World world, GameState state)
    {
        var items = new List<ItemDef>();
        if (!world.Rooms.TryGetValue(state.RoomId, out var room)) return items;
        foreach (var npcId in room.Npcs)
        {
            if (!state.Npcs.TryGetValue(npcId, out var npc) || !npc.Alive) continue;
            foreach (var id in npc.Inventory)
            {
                if (!world.Items.TryGetValue(id, out var item) || item.Kind != "oracle") continue;
                if (items.Any(held => held.Id == item.Id)) continue;
                items.Add(item);
            }
        }
        return items;
    }

    static string? OracleHolder(World world, GameState state, string itemId)
    {
        if (!world.Items.TryGetValue(itemId, out var item) || item.Kind != "oracle") return null;
        if (!world.Rooms.TryGetValue(state.RoomId, out var room)) return null;
        foreach (var npcId in room.Npcs)
        {
            if (!state.Npcs.TryGetValue(npcId, out var npc) || !npc.Alive) continue;
            if (npc.Inventory.Contains(itemId)) return npcId;
        }
        return null;
    }

    static List<GameLine> TakeItem(World world, GameState state, string itemId)
    {
        world.Items.TryGetValue(itemId, out var item);
        var onGround = ItemsInRoom(world, state).Any(entry => entry.Id == itemId);
        var holder = onGround ? null : OracleHolder(world, state, itemId);
        if (item is null || (!onGround && holder is null))
        {
            return [Line("warn", $"There is no {item?.Name ?? itemId} here you can take.")];
        }
        if (onGround)
        {
            var pile = state.RoomItems[state.RoomId];
            var index = pile.IndexOf(item.Id);
            if (index >= 0) pile.RemoveAt(index);
            Observe.Witness(state, Observe.Witnesses(world, state), $"Null takes {item.Name}.");
            Observe.Remember(state, $"I take the {item.Name}.");
        }
        else if (holder is not null)
        {
            var pack = state.Npcs[holder].Inventory;
            var held = pack.IndexOf(item.Id);
            if (held >= 0) pack.RemoveAt(held);
            var name = world.Npcs[holder].Script.Name;
            Observe.WitnessAs(state, Observe.Witnesses(world, state), holder, $"Null takes {item.Name} from me.", $"Null takes {item.Name} from {name}.");
            Observe.Remember(state, $"I take the {item.Name} from {name}.");
        }
        state.Inventory.Add(item.Id);
        return [Line("good", $"Taken: {item.Name}.")];
    }

    static List<GameLine> DoTake(World world, GameState state, string target)
    {
        var ground = ItemsInRoom(world, state).Select(item => item.Id);
        var held = OraclesInHands(world, state).Select(item => item.Id);
        var item = MatchItem(world, target, ground) ?? MatchItem(world, target, held);
        if (item is null) return [Line("warn", "There is nothing here by that name you can take.")];
        return TakeItem(world, state, item.Id);
    }

    public static (bool Ok, GameState State, List<GameLine> Lines) ComeIntoPossession(World world, GameState state, string itemId)
    {
        Observe.RepairLogs(state, world);
        var roomId = state.RoomId;
        var wasBlocked = Observe.BlockedDirs(world, state, roomId);
        var before = state.Inventory.Count;
        var lines = TakeItem(world, state, itemId);
        Observe.NoteOpenedDoors(world, state, roomId, wasBlocked);
        return (state.Inventory.Count > before, state, lines);
    }

    static int NpcScore(NpcScript script, string query)
    {
        var q = query.ToLowerInvariant().Trim();
        if (script.Id == q || script.Name.ToLowerInvariant() == q) return 100;
        if (script.Aliases.Any(alias => alias == q)) return 90;
        if (script.Aliases.Any(alias => q.Contains(alias) || alias.Contains(q))) return 70;
        if (script.Name.ToLowerInvariant().Contains(q)) return 60;
        return 0;
    }

    static string? MatchNpc(World world, GameState state, string query, bool onlyAlive = true)
    {
        var room = world.Rooms[state.RoomId];
        var ranked = room.Npcs
            .Select(id => (id, score: NpcScore(world.Npcs[id].Script, query)))
            .Where(row => row.score > 0)
            .Where(row => !onlyAlive || state.Npcs[row.id].Alive)
            .OrderByDescending(row => row.score)
            .ToList();
        return ranked.Count == 0 ? null : ranked[0].id;
    }

    static ItemDef? BestWeapon(World world, GameState state)
    {
        ItemDef? best = null;
        foreach (var id in state.Inventory)
        {
            if (!world.Items.TryGetValue(id, out var item) || item.Kind != "weapon") continue;
            if (best is null || (item.Damage ?? 0) > (best.Damage ?? 0)) best = item;
        }
        return best;
    }

    static bool ObstacleOpen(GameState state, Obstacle obstacle, string roomId) =>
        obstacle.When is not null && Facts.Matches(state, obstacle.When, roomId);

    static bool DirBlocked(RoomDef room, GameState state, string dir) =>
        room.Obstacles.Any(obstacle => obstacle.Dir == dir && !ObstacleOpen(state, obstacle, room.Id));

    public static List<GameLine> DescribeRoom(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        var lines = new List<GameLine> { Line("room", room.Name.ToUpperInvariant()) };
        var text = room.Descriptions.Count > 0 ? room.Descriptions[0].Text : "";
        foreach (var desc in room.Descriptions)
        {
            if (desc.When is not null && !Facts.Matches(state, desc.When, room.Id)) continue;
            if (desc.Unless is not null && Facts.Matches(state, desc.Unless, room.Id)) continue;
            text = desc.Text;
        }
        lines.Add(Line("body", text));
        var exits = Dirs.All.Where(dir => room.Exits.ContainsKey(dir)).Select(dir =>
            DirBlocked(room, state, dir) ? $"{dir} (blocked)" : dir).ToList();
        lines.Add(Line("exit", exits.Count > 0 ? $"Exits: {string.Join(", ", exits)}." : "Exits: none."));
        var stuff = VisibleGround(world, state, room);
        if (stuff.Count > 0)
        {
            lines.Add(Line("body", $"You see: {string.Join(", ", stuff.Select(id => ItemName(world, id)))}."));
        }
        foreach (var npcId in room.Npcs)
        {
            if (!state.Npcs.TryGetValue(npcId, out var runtime) || !runtime.Alive) continue;
            var script = world.Npcs[npcId].Script;
            var presence = script.Presence;
            foreach (var alt in script.PresenceWhen ?? [])
            {
                if (Facts.Matches(state, alt.When, state.RoomId)) presence = alt.Text;
            }
            lines.Add(Line("speech", presence));
            if (runtime.Hostile) lines.Add(Line("warn", $"{script.Name} is hostile."));
        }
        return lines;
    }

    public static List<GameLine> IntroLines() =>
    [
        Line("body", "You are Null, a silt-runner with a cracked optic and twenty-four scrip. Three nights ago the market radio used your voice to say: bring the key to the Spire. You do not have the key. You have a dock, a debt, and the habit of trying doors."),
    ];

    static List<GameLine> HelpLines() =>
    [
        Line("sys", string.Join('\n', [
            "ASH PROTOCOL",
            "",
            "Type what Null does or says, in your own words.",
            "The cartridge reads it and the people in the room answer.",
            "",
            "A line that starts with / skips the reading and runs as written:",
            "  /go north   /n /s /e /w",
            "  /look at <thing>     /search     /listen",
            "  /take <item>         /drop <item>",
            "  /talk <name>         /talk <name> about <topic>",
            "  /ask <name> for a fortune",
            "  /give <item> to <name>          /tell <name> a story",
            "  /say <words>",
            "  /buy <item>   /sell <item>   /trade   /pay <name>   /heal",
            "  /use <item>   /attack <name>   /flee   /wait",
            "",
            "CONSOLE",
            "  /help     verbs and slash commands",
            "  /look     reprint the room",
            "  /inv      what you carry",
            "  /status   body, scrip, weapon",
            "  /map      rooms you have seen",
            "  /save     write the tape",
            "  /load     read the tape",
            "  /clear    clear the scrollback",
            "  /restart  boot a new life",
            "  /exit     cut the power",
            "",
            "You win when you reach the final room.",
        ])),
    ];

    static List<GameLine> InvLines(World world, GameState state)
    {
        if (state.Inventory.Count == 0) return [Line("sys", $"CARRYING: nothing.\nSCRIP: {state.Scrip}")];
        var counts = new Dictionary<string, int>();
        foreach (var id in state.Inventory) counts[id] = counts.GetValueOrDefault(id) + 1;
        var rows = counts.Select(pair =>
        {
            var name = ItemName(world, pair.Key);
            return pair.Value > 1 ? $"  {name} x{pair.Value}" : $"  {name}";
        });
        return [Line("sys", $"CARRYING:\n{string.Join('\n', rows)}\nSCRIP: {state.Scrip}")];
    }

    static List<GameLine> StatusLines(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        var weapon = BestWeapon(world, state);
        var weaponText = weapon is null ? "fists (1)" : $"{weapon.Name} ({weapon.Damage})";
        return [Line("sys", string.Join('\n', [
            "NULL  ·  SILT RUNNER",
            $"HP {state.Hp}/{state.MaxHp}",
            $"SCRIP {state.Scrip}",
            $"WEAPON {weaponText}",
            $"ROOM {room.Name}",
            $"TURN {state.Turns}",
            $"SEEN {state.Visited.Count}/{world.Rooms.Count}",
        ]))];
    }

    public static string MapText(World world, GameState state)
    {
        var known = new HashSet<string>(state.Visited);
        foreach (var id in state.Visited)
        {
            var room = world.Rooms[id];
            foreach (var dir in Dirs.All)
            {
                if (room.Exits.TryGetValue(dir, out var next)) known.Add(next);
            }
        }
        var cells = world.Rooms.Values.Where(room => known.Contains(room.Id)).ToList();
        if (cells.Count == 0) return "(no map)";
        var minX = cells.Min(room => room.X);
        var maxX = cells.Max(room => room.X);
        var minY = cells.Min(room => room.Y);
        var maxY = cells.Max(room => room.Y);
        RoomDef? At(int x, int y) => world.Rooms.Values.FirstOrDefault(room => room.X == x && room.Y == y && known.Contains(room.Id));
        var rows = new List<string> { "MAP  ·  * you    ???? unseen" };
        for (var y = maxY; y >= minY; y--)
        {
            var row = "";
            for (var x = minX; x <= maxX; x++)
            {
                var room = At(x, y);
                if (room is null)
                {
                    row += "      ";
                    continue;
                }
                var seen = state.Visited.Contains(room.Id);
                var mark = room.Id == state.RoomId ? $"{room.Code}*" : seen ? $"{room.Code} " : "????";
                var cell = mark.PadRight(4);
                if (cell.Length > 4) cell = cell[..4];
                room.Exits.TryGetValue("east", out var eastId);
                var east = eastId is not null && world.Rooms.TryGetValue(eastId, out var found) ? found : null;
                var linked = east is not null
                    && known.Contains(east.Id)
                    && east.X == x + 1
                    && east.Y == y
                    && (seen || state.Visited.Contains(east.Id));
                row += cell;
                row += linked ? "--" : "  ";
            }
            rows.Add(Regex.Replace(row, @"\s+$", ""));
            if (y == minY) continue;
            var links = "";
            for (var x = minX; x <= maxX; x++)
            {
                var room = At(x, y);
                string? southId = null;
                room?.Exits.TryGetValue("south", out southId);
                var south = southId is not null && world.Rooms.TryGetValue(southId, out var found) ? found : null;
                var linked = room is not null
                    && south is not null
                    && known.Contains(south.Id)
                    && south.X == x
                    && south.Y == y - 1
                    && (state.Visited.Contains(room.Id) || state.Visited.Contains(south.Id));
                links += linked ? " |    " : "      ";
            }
            rows.Add(Regex.Replace(links, @"\s+$", ""));
        }
        return string.Join('\n', rows);
    }

    static GameLine? TopicHint(NpcScript script)
    {
        if (script.Topics.Count == 0) return null;
        return Line("exit", $"Ask about: {string.Join(", ", script.Topics.Keys)}.");
    }

    static string? MerchantIn(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        foreach (var id in room.Npcs)
        {
            if (!state.Npcs[id].Alive) continue;
            if (world.Npcs[id].Script.Shop is not null) return id;
        }
        return null;
    }

    static bool CanSell(ItemDef item, GameState state, IReadOnlyList<string> buys)
    {
        if (item.SellWhen is not null && !Facts.Matches(state, item.SellWhen, state.RoomId)) return false;
        if (item.Kind is "key" or "oracle") return false;
        return buys.Contains(item.Kind);
    }

    static bool Hurt(World world, GameState state, int amount, List<GameLine> lines, string source)
    {
        state.Hp = Math.Max(0, state.Hp - amount);
        lines.Add(Line("combat", $"{source} (-{amount} HP, {state.Hp} left)."));
        if (state.Hp > 0) return false;
        Observe.Witness(state, Observe.Witnesses(world, state), "Null falls.");
        Observe.Remember(state, "I fall.");
        state.Mode = "dead";
        state.CombatWith = null;
        lines.Add(Line("warn", "The world goes out like a monitor.\nYou are a rumor in Cinder Reach.\nThe tape still holds the moment before this. /load it, or /restart."));
        return true;
    }

    static void KillNpc(World world, GameState state, string npcId, List<GameLine> lines)
    {
        var script = world.Npcs[npcId].Script;
        var runtime = state.Npcs[npcId];
        var watching = Observe.Witnesses(world, state);
        Observe.WitnessAs(state, watching, npcId, "I fall.", $"{script.Name} falls.");
        runtime.Hp = 0;
        runtime.Alive = false;
        runtime.Hostile = false;
        if (state.CombatWith == npcId) state.CombatWith = null;
        var roomId = state.RoomId;
        foreach (var id in runtime.Inventory) state.RoomItems[roomId].Add(id);
        var dropped = runtime.Inventory.Select(id => ItemName(world, id)).ToList();
        runtime.Inventory = [];
        state.Scrip += script.Combat.Scrip;
        Facts.ApplyChanges(state, script.Combat.OnDeath, npcId);
        var left = Observe.Witnesses(world, state);
        if (dropped.Count > 0) Observe.Witness(state, left, $"{script.Name} drops {Observe.EnglishList(dropped)}.");
        if (script.Combat.Scrip > 0) Observe.Witness(state, left, $"Null takes {script.Combat.Scrip} scrip.");
        lines.Add(Line("combat", script.Combat.OnDeathSay));
        if (script.Combat.Scrip > 0) lines.Add(Line("good", $"You take {script.Combat.Scrip} scrip."));
        if (dropped.Count > 0) lines.Add(Line("good", $"Left on the ground: {string.Join(", ", dropped)}."));
    }

    static bool Retaliate(World world, GameState state, string npcId, List<GameLine> lines)
    {
        var script = world.Npcs[npcId].Script;
        var runtime = state.Npcs[npcId];
        if (!runtime.Alive) return false;
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, "I hit Null.", $"{script.Name} hits Null.");
        Observe.Remember(state, $"{script.Name} hits me.");
        return Hurt(world, state, script.Combat.Damage, lines, $"{script.Name} hits you");
    }

    static string EndRank(GameState state)
    {
        var kills = new[] { "drone-mite", "pike", "sentry-kite", "razor-saint" }
            .Count(id => state.Npcs.TryGetValue(id, out var npc) && !npc.Alive);
        if (kills == 0 && state.Hp >= 8) return "PACIFIST SIGNAL";
        if (state.Hp >= 10) return "LANTERN COURIER";
        if (state.Hp >= 4) return "ASH APPRENTICE";
        return "BLOODY RECEIPT";
    }

    static List<GameLine> WinLines(World world, GameState state) =>
    [
        Line("good", $"TURNS {state.Turns}    ROOMS {state.Visited.Count}/{world.Rooms.Count}    HP {state.Hp}    SCRIP {state.Scrip}"),
        Line("good", $"RANK: {EndRank(state)}"),
        Line("sys", "The cartridge hums. /save if you want the tape. /exit cuts the power."),
    ];

    static List<GameLine> Move(World world, GameState state, string dir, string how = "goes")
    {
        var room = world.Rooms[state.RoomId];
        var origin = state.RoomId;
        if (!room.Exits.TryGetValue(dir, out var destId))
        {
            Observe.Witness(state, Observe.Witnesses(world, state, origin), $"Null tries to go {dir}.");
            Observe.Remember(state, $"I try to go {dir}.");
            return [Line("warn", $"No passage {dir}. Sintered glass, posters, and the idea of a wall.")];
        }
        var obstacles = room.Obstacles.Where(obstacle => obstacle.Dir == dir).ToList();
        foreach (var obstacle in obstacles)
        {
            if (ObstacleOpen(state, obstacle, room.Id)) continue;
            Observe.Witness(state, Observe.Witnesses(world, state, origin), $"Null tries to go {dir}.");
            Observe.Remember(state, $"I try to go {dir}.");
            return [Line("warn", obstacle.Fail)];
        }
        var lines = new List<GameLine>();
        foreach (var obstacle in obstacles)
        {
            if (obstacle.Pass.Length > 0) lines.Add(Line("good", obstacle.Pass));
        }
        if (state.CombatWith is not null)
        {
            var foe = state.CombatWith;
            if (state.Npcs.TryGetValue(foe, out var fighter) && fighter.Alive && fighter.Hostile)
            {
                if (Retaliate(world, state, foe, lines)) return lines;
            }
            state.CombatWith = null;
        }
        Observe.Witness(state, Observe.Witnesses(world, state, origin), $"Null {how} {dir}.");
        Observe.Remember(state, how == "flees" ? $"I flee {dir}." : $"I go {dir}.");
        state.PreviousRoomId = state.RoomId;
        state.RoomId = destId;
        if (!state.Visited.Contains(destId)) state.Visited.Add(destId);
        Observe.NoteArrival(world, state, destId);
        lines.AddRange(DescribeRoom(world, state));
        if (world.Rooms[destId].Win == true)
        {
            state.Mode = "won";
            lines.AddRange(WinLines(world, state));
        }
        return lines;
    }

    static List<GameLine> DoSearch(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        var watching = Observe.Witnesses(world, state);
        Observe.Witness(state, watching, "Null searches.");
        Observe.Remember(state, "I search.");
        var action = room.OnSearch;
        if (action is null)
        {
            var stuff = VisibleGround(world, state, room);
            if (stuff.Count == 0) return [Line("body", "You search. The room has already shown you its teeth.")];
            return [Line("body", $"You search and find only what was already in the open: {string.Join(", ", stuff.Select(id => ItemName(world, id)))}.")];
        }
        if (Facts.Matches(state, action.Done, room.Id)) return [Line("body", action.Already)];
        if (action.When is not null && !Facts.Matches(state, action.When, room.Id)) return [Line("warn", action.Fail)];
        Facts.ApplyChanges(state, action.Change);
        foreach (var id in action.GrantItems ?? []) AddItem(state, id);
        if (action.GrantScrip is not null) state.Scrip += action.GrantScrip.Value;
        var found = new List<string>();
        if (action.GrantItems is { Count: > 0 }) found.Add(Named(world, action.GrantItems));
        if (action.GrantScrip is > 0) found.Add($"{action.GrantScrip} scrip");
        if (found.Count > 0)
        {
            Observe.Witness(state, watching, $"Null finds {Observe.EnglishList(found)}.");
            Observe.Remember(state, $"I find {Observe.EnglishList(found)}.");
        }
        return [Line("good", action.Say)];
    }

    static List<GameLine> DoListen(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        var watching = Observe.Witnesses(world, state);
        Observe.Witness(state, watching, "Null listens.");
        Observe.Remember(state, "I listen.");
        var action = room.OnListen;
        if (action is null) return [Line("body", "You listen. The city chews itself, somewhere else.")];
        if (action.Counter is null)
        {
            var step = action.Steps.Count > 0 ? action.Steps[0] : null;
            if (step is null) return [Line("body", "Silence, which is a kind of answer.")];
            Facts.ApplyChanges(state, step.Change);
            Observe.Witness(state, watching, $"The room says {Observe.Quote(step.Say)}");
            Observe.Remember(state, $"The room says {Observe.Quote(step.Say)}");
            return [Line("speech", step.Say)];
        }
        var n = state.Counters.GetValueOrDefault(action.Counter) + 1;
        state.Counters[action.Counter] = n;
        var at = action.Steps.Where(step => step.At == n).ToList();
        var withItem = at.FirstOrDefault(step => step.RequiresItem is not null && HasItem(state, step.RequiresItem));
        var plain = at.FirstOrDefault(step => step.RequiresItem is null);
        var chosen = withItem ?? plain;
        if (chosen is null) return [Line("body", "Only wind, and the wind is out of new words.")];
        Facts.ApplyChanges(state, chosen.Change);
        Observe.Witness(state, watching, $"The room says {Observe.Quote(chosen.Say)}");
        Observe.Remember(state, $"The room says {Observe.Quote(chosen.Say)}");
        return [Line("speech", chosen.Say)];
    }

    static List<GameLine> DoDrop(World world, GameState state, string target)
    {
        var item = MatchItem(world, target, state.Inventory);
        if (item is null) return [Line("warn", $"You are not carrying {target}.")];
        RemoveItem(state, item.Id);
        state.RoomItems[state.RoomId].Add(item.Id);
        Observe.Witness(state, Observe.Witnesses(world, state), $"Null drops {item.Name}.");
        Observe.Remember(state, $"I drop the {item.Name}.");
        return [Line("body", $"Dropped: {item.Name}.")];
    }

    static List<GameLine> DoExamine(World world, GameState state, string target)
    {
        var watching = Observe.Witnesses(world, state);
        if (Regex.IsMatch(target.ToLowerInvariant(), @"^(me|self|myself|null)$"))
        {
            Observe.Witness(state, watching, "Null looks at himself.");
            Observe.Remember(state, "I look at myself.");
            return [Line("body", "Null. Cracked optic, wet boots, the posture of a person who will try the door anyway.")];
        }
        var room = world.Rooms[state.RoomId];
        var npcId = MatchNpc(world, state, target, false);
        if (npcId is not null && state.Npcs[npcId].Alive)
        {
            var script = world.Npcs[npcId].Script;
            var runtime = state.Npcs[npcId];
            Observe.WitnessAs(state, watching, npcId, "Null looks at me.", $"Null looks at {script.Name}.");
            Observe.Remember(state, $"I look at {script.Name}.");
            var stance = script.Combat.Unkillable == true
                ? "not a body you can end"
                : runtime.Hostile ? "hostile" : "not hostile";
            return [Line("speech", $"{script.Name}. {script.Presence} ({runtime.Hp}/{runtime.MaxHp}, {stance}.)")];
        }
        var item = MatchItem(world, target, state.Inventory.Concat(VisibleGround(world, state, room)));
        if (item is null) return [Line("warn", $"You see no {target} worth a longer look.")];
        Observe.Witness(state, watching, $"Null looks at {item.Name}.");
        Observe.Remember(state, $"I look at the {item.Name}.");
        return [Line("body", item.Text)];
    }

    static List<GameLine> DoUse(World world, GameState state, string target)
    {
        var item = MatchItem(world, target, state.Inventory);
        if (item is null) return [Line("warn", $"You are not carrying {target}.")];
        if (item.Kind == "heal")
        {
            if (state.Hp >= state.MaxHp) return [Line("body", "You are already as whole as this town allows.")];
            RemoveItem(state, item.Id);
            var before = state.Hp;
            state.Hp = Math.Min(state.MaxHp, state.Hp + (item.Heal ?? 0));
            Observe.Witness(state, Observe.Witnesses(world, state), $"Null uses {item.Name}.");
            Observe.Remember(state, $"I use the {item.Name}.");
            return [Line("good", $"You take the {item.Name}. HP {before} → {state.Hp}.")];
        }
        Observe.Witness(state, Observe.Witnesses(world, state), $"Null uses {item.Name}.");
        Observe.Remember(state, $"I use the {item.Name}.");
        if (item.Kind == "oracle") return [Line("body", $"You cup the {item.Name}. The glass goes cold.")];
        if (item.UseText is not null) return [Line("body", item.UseText)];
        return [Line("body", $"You fuss with the {item.Name}. The room declines to change.")];
    }

    static void AddBeat(List<Beat> beats, string npcId, string ev, string gist)
    {
        if (gist.Trim().Length == 0) return;
        beats.Add(new Beat { NpcId = npcId, Event = ev, Gist = gist.Trim() });
    }

    static List<GameLine> Received(World world, IReadOnlyList<string> ids) =>
        ids.Count > 0 ? [Line("good", $"You receive {Named(world, ids)}.")] : [];

    static string? MatchTopic(NpcScript script, string query)
    {
        var q = Regex.Replace(query.ToLowerInvariant(), @"^the\s+", "").Trim();
        if (script.Topics.ContainsKey(q)) return q;
        return script.Topics.Keys.FirstOrDefault(key => q.Contains(key) || key.Contains(q));
    }

    static bool TalkOk(GameState state, TalkRule rule, string npcId)
    {
        if (rule.When is not null && !Facts.Matches(state, rule.When, state.RoomId)) return false;
        if (rule.RequiresItem is not null && !HasItem(state, rule.RequiresItem)) return false;
        if (rule.TakeFromSelf is not null && !state.Npcs[npcId].Inventory.Contains(rule.TakeFromSelf)) return false;
        return true;
    }

    static bool SayOk(GameState state, SayRule rule)
    {
        if (rule.When is not null && !Facts.Matches(state, rule.When, state.RoomId)) return false;
        if (rule.RequiresAllItems is not null && !rule.RequiresAllItems.All(id => HasItem(state, id))) return false;
        return true;
    }

    static List<GameLine> DoTalk(World world, GameState state, List<Beat> beats, string target, string? topic)
    {
        var npcId = MatchNpc(world, state, target);
        if (npcId is null) return [Line("warn", "No one here answers to that.")];
        var script = world.Npcs[npcId].Script;
        var hint = TopicHint(script);
        if (topic is not null)
        {
            var ev = $"Null asks you about {topic}.";
            var key = MatchTopic(script, topic);
            NoteTalk(world, state, npcId, topic);
            if (key is null)
            {
                AddBeat(beats, npcId, ev, $"Answer in character. You know nothing special about {topic}, so do not invent facts about it.");
                return hint is null ? [] : [hint];
            }
            var entry = script.Topics[key];
            Facts.ApplyChanges(state, entry.Change, npcId);
            AddBeat(beats, npcId, ev, entry.Gist);
            return [];
        }
        var greeting = "Null talks to you.";
        if (script.OnTalk is { Count: > 0 })
        {
            var rule = script.OnTalk.FirstOrDefault(candidate => TalkOk(state, candidate, npcId));
            if (rule is not null)
            {
                Facts.ApplyChanges(state, rule.Change, npcId);
                var granted = (rule.GrantItems ?? []).Where(id => !HasItem(state, id)).ToList();
                if (rule.TakeFromSelf is not null)
                {
                    var held = state.Npcs[npcId].Inventory;
                    var index = held.IndexOf(rule.TakeFromSelf);
                    if (index >= 0)
                    {
                        held.RemoveAt(index);
                        if (!HasItem(state, rule.TakeFromSelf)) granted.Add(rule.TakeFromSelf);
                    }
                }
                foreach (var id in granted) AddItem(state, id);
                NoteTalk(world, state, npcId, null);
                NoteGift(world, state, npcId, granted);
                AddBeat(beats, npcId, greeting, rule.Gist);
                var lines = Received(world, granted);
                if (hint is not null) lines.Add(hint);
                return lines;
            }
        }
        NoteTalk(world, state, npcId, null);
        AddBeat(beats, npcId, greeting, script.Greeting.Length > 0 ? script.Greeting : "Acknowledge them in character.");
        return hint is null ? [] : [hint];
    }

    static List<GameLine> DoSay(World world, GameState state, List<Beat> beats, string text)
    {
        var room = world.Rooms[state.RoomId];
        var listening = room.Npcs.Where(npcId => state.Npcs.TryGetValue(npcId, out var npc) && npc.Alive).ToList();
        if (listening.Count == 0) return [Line("body", "Your words sit in the ash. Nobody picks them up.")];
        var ev = $"Null says {Observe.Quote(text)}";
        foreach (var npcId in listening)
        {
            var script = world.Npcs[npcId].Script;
            foreach (var rule in script.Say)
            {
                if (!WordHas(text, rule.Includes)) continue;
                if (!SayOk(state, rule)) continue;
                Facts.ApplyChanges(state, rule.Change, npcId);
                var consumed = new List<string>();
                foreach (var id in rule.ConsumeItems ?? [])
                {
                    if (RemoveItem(state, id)) consumed.Add(id);
                }
                foreach (var id in rule.GrantItems ?? []) AddItem(state, id);
                if (consumed.Count > 0)
                {
                    Observe.Witness(state, Observe.Witnesses(world, state), $"Null hands over {Named(world, consumed)}.");
                }
                NoteGift(world, state, npcId, rule.GrantItems ?? []);
                AddBeat(beats, npcId, ev, rule.Gist);
                var lines = new List<GameLine>();
                if (consumed.Count > 0) lines.Add(Line("good", $"You hand over {Named(world, consumed)}."));
                lines.AddRange(Received(world, rule.GrantItems ?? []));
                return lines;
            }
        }
        return [];
    }

    static void RtTake(GameState state, string npcId, string itemId) => state.Npcs[npcId].Inventory.Add(itemId);

    static List<GameLine> DoGive(World world, GameState state, List<Beat> beats, string itemQuery, string npcQuery)
    {
        var item = MatchItem(world, itemQuery, state.Inventory);
        if (item is null) return [Line("warn", $"You are not carrying {itemQuery}.")];
        var npcId = MatchNpc(world, state, npcQuery);
        if (npcId is null) return [Line("warn", "No one here to take it.")];
        var script = world.Npcs[npcId].Script;
        var ev = $"Null offers you the {item.Name}.";
        var trade = script.Trades.FirstOrDefault(entry => entry.Give == item.Id);
        if (trade is null && item.Kind == "oracle")
        {
            RemoveItem(state, item.Id);
            state.Npcs[npcId].Inventory.Add(item.Id);
            Observe.WitnessAs(
                state,
                Observe.Witnesses(world, state),
                npcId,
                $"Null gives me the {item.Name}.",
                $"Null gives {script.Name} the {item.Name}.");
            Observe.Remember(state, $"I give {script.Name} the {item.Name}.");
            return [Line("good", $"{script.Name} takes the {item.Name}.")];
        }
        List<GameLine> Refuse(string gist)
        {
            NoteOffer(world, state, npcId, item.Name);
            AddBeat(beats, npcId, ev, gist);
            return [Line("sys", $"{script.Name} does not take the {item.Name}.")];
        }
        if (trade is null) return Refuse($"Refuse the {item.Name}. You have no use for it.");
        if (trade.Once is not null && Facts.Matches(state, trade.Once, state.RoomId))
        {
            return Refuse($"Refuse the {item.Name}. You already made that deal with them once.");
        }
        var runtime = state.Npcs[npcId];
        if (trade.Receive is not null)
        {
            var held = runtime.Inventory.IndexOf(trade.Receive);
            if (held < 0)
            {
                return Refuse($"Refuse the {item.Name}. You have nothing left to give for it; the {ItemName(world, trade.Receive)} is gone.");
            }
            runtime.Inventory.RemoveAt(held);
            AddItem(state, trade.Receive);
        }
        RemoveItem(state, item.Id);
        RtTake(state, npcId, item.Id);
        Facts.ApplyChanges(state, trade.Change, npcId);
        var exchange = trade.Receive is null ? item.Name : $"{item.Name} for {ItemName(world, trade.Receive)}";
        Observe.Witness(state, Observe.Witnesses(world, state), Observe.TradeNote(exchange));
        AddBeat(beats, npcId, $"Null gives you the {item.Name}.", trade.Gist);
        var lines = new List<GameLine> { Line("good", $"{script.Name} takes the {item.Name}.") };
        lines.AddRange(Received(world, trade.Receive is null ? [] : [trade.Receive]));
        return lines;
    }

    static List<GameLine> DoStory(World world, GameState state, List<Beat> beats, string npcQuery)
    {
        var npcId = MatchNpc(world, state, npcQuery);
        if (npcId is null) return [Line("warn", "You tell the story to the furniture. The furniture is unmoved.")];
        var script = world.Npcs[npcId].Script;
        var story = script.Story;
        var ev = "Null tells you a story.";
        Observe.WitnessAs(state, Observe.Witnesses(world, state), npcId, "Null tells me a story.", $"Null tells {script.Name} a story.");
        if (story is null)
        {
            AddBeat(beats, npcId, ev, "You are not interested in their story. You are not their audience.");
            return [];
        }
        if (story.Done is not null && Facts.Matches(state, story.Done, state.RoomId))
        {
            AddBeat(beats, npcId, ev, story.AlreadyGist ?? "You have heard that one already.");
            return [];
        }
        if (story.When is not null && !Facts.Matches(state, story.When, state.RoomId))
        {
            AddBeat(beats, npcId, ev, story.ElseGist.Length > 0 ? story.ElseGist : "The story does not move you.");
            return [];
        }
        Facts.ApplyChanges(state, story.Change, npcId);
        if (story.GrantScrip is not null) state.Scrip += story.GrantScrip.Value;
        NoteScrip(world, state, npcId, story.GrantScrip ?? 0);
        AddBeat(beats, npcId, ev, story.Gist);
        return story.GrantScrip is > 0
            ? [Line("good", $"{script.Name} gives you {story.GrantScrip} scrip. You have {state.Scrip}.")]
            : [];
    }

    static List<GameLine> DoPay(World world, GameState state, List<Beat> beats, string npcQuery)
    {
        var npcId = MatchNpc(world, state, npcQuery);
        if (npcId is null) return [Line("warn", "No one here is taking payment.")];
        var script = world.Npcs[npcId].Script;
        var bribe = script.Bribe;
        var ev = "Null offers you scrip.";
        if (bribe is null)
        {
            AddBeat(beats, npcId, ev, "Refuse the money. You do not sell what they are trying to buy.");
            return [Line("sys", $"{script.Name} does not take the scrip.")];
        }
        if (bribe.Done is not null && Facts.Matches(state, bribe.Done, state.RoomId))
        {
            AddBeat(beats, npcId, ev, bribe.AlreadyGist ?? "That debt is already settled. Refuse more money.");
            return [Line("sys", "That is already paid.")];
        }
        if (bribe.Heal == true && state.Hp >= state.MaxHp)
        {
            AddBeat(beats, npcId, ev, "They are not hurt. Tell them to come back when they are actually broken.");
            return [Line("sys", "You are not hurt.")];
        }
        if (state.Scrip < bribe.Cost) return [Line("warn", $"You need {bribe.Cost} scrip. You have {state.Scrip}.")];
        state.Scrip -= bribe.Cost;
        Facts.ApplyChanges(state, bribe.Change, npcId);
        var before = state.Hp;
        if (bribe.Heal == true) state.Hp = state.MaxHp;
        Observe.WitnessAs(
            state,
            Observe.Witnesses(world, state),
            npcId,
            $"Null pays me {bribe.Cost} scrip.",
            $"Null pays {script.Name} {bribe.Cost} scrip.");
        AddBeat(beats, npcId, $"Null pays you {bribe.Cost} scrip.", bribe.Gist);
        var lines = new List<GameLine> { Line("good", $"You pay {script.Name} {bribe.Cost} scrip. {state.Scrip} left.") };
        if (bribe.Heal == true) lines.Add(Line("good", $"HP {before} → {state.Hp}."));
        return lines;
    }

    static List<GameLine> DoBuy(World world, GameState state, List<Beat> beats, string itemQuery)
    {
        var npcId = MerchantIn(world, state);
        if (npcId is null) return [Line("warn", "Nobody here is selling.")];
        var script = world.Npcs[npcId].Script;
        var shop = script.Shop;
        if (shop is null) return [Line("warn", "Nobody here is selling.")];
        var item = MatchItem(world, itemQuery, shop.Sells);
        if (item is null) return [Line("warn", $"{script.Name} does not stock {itemQuery}. Try: trade.")];
        var runtime = state.Npcs[npcId];
        if (!runtime.Inventory.Contains(item.Id))
        {
            AddBeat(beats, npcId, $"Null asks to buy the {item.Name}.", $"You are out of {item.Name}. It is gone.");
            return [Line("warn", $"{script.Name} has no {item.Name} left.")];
        }
        if (state.Scrip < item.Value) return [Line("warn", $"{item.Name} costs {item.Value} scrip. You have {state.Scrip}.")];
        state.Scrip -= item.Value;
        runtime.Inventory.RemoveAt(runtime.Inventory.IndexOf(item.Id));
        AddItem(state, item.Id);
        Observe.Witness(state, Observe.Witnesses(world, state), Observe.TradeNote($"1 {item.Name} for {item.Value} scrip"));
        return [Line("good", $"Bought {item.Name} for {item.Value} scrip. {state.Scrip} left.")];
    }

    static List<GameLine> DoSell(World world, GameState state, List<Beat> beats, string itemQuery)
    {
        var npcId = MerchantIn(world, state);
        if (npcId is null) return [Line("warn", "Nobody here is buying.")];
        var script = world.Npcs[npcId].Script;
        var shop = script.Shop;
        if (shop is null) return [Line("warn", "Nobody here is buying.")];
        var item = MatchItem(world, itemQuery, state.Inventory);
        if (item is null) return [Line("warn", $"You are not carrying {itemQuery}.")];
        if (!CanSell(item, state, shop.Buys))
        {
            var ev = $"Null tries to sell you the {item.Name}.";
            if (item.SellWhen is not null && !Facts.Matches(state, item.SellWhen, state.RoomId))
            {
                AddBeat(beats, npcId, ev, $"Refuse to buy the {item.Name}. They still need it; come back after.");
            }
            else
            {
                AddBeat(beats, npcId, ev, $"Refuse to buy the {item.Name}. You do not deal in that.");
            }
            return [Line("sys", $"{script.Name} will not buy the {item.Name}.")];
        }
        RemoveItem(state, item.Id);
        RtTake(state, npcId, item.Id);
        state.Scrip += item.Value;
        Observe.Witness(state, Observe.Witnesses(world, state), Observe.TradeNote($"1 {item.Name} for {item.Value} scrip"));
        return [Line("good", $"Sold {item.Name} for {item.Value} scrip. You now have {state.Scrip}.")];
    }

    static List<GameLine> DoTrade(World world, GameState state)
    {
        Observe.Witness(state, Observe.Witnesses(world, state), "Null looks over the wares.");
        Observe.Remember(state, "I look over the wares.");
        var npcId = MerchantIn(world, state);
        if (npcId is null) return [Line("body", "Nobody here has wares. The room is not a shop, however much it charges you.")];
        var script = world.Npcs[npcId].Script;
        var shop = script.Shop!;
        var runtime = state.Npcs[npcId];
        var counts = new Dictionary<string, int>();
        foreach (var id in runtime.Inventory)
        {
            if (!shop.Sells.Contains(id)) continue;
            counts[id] = counts.GetValueOrDefault(id) + 1;
        }
        var rows = counts.Select(pair =>
        {
            var item = world.Items[pair.Key];
            return $"  {item.Name} — {item.Value} scrip{(pair.Value > 1 ? $" ({pair.Value})" : "")}";
        }).ToList();
        var stock = rows.Count > 0 ? string.Join('\n', rows) : "  (shelves bare)";
        return [Line("sys", $"{script.Name.ToUpperInvariant()}  ·  WARES\n{stock}\nBuys: {string.Join(", ", shop.Buys)}.\nSay what you want to buy or sell, or /buy <item>  /sell <item>.")];
    }

    static List<GameLine> DoAttack(World world, GameState state, List<Beat> beats, string target)
    {
        var npcId = MatchNpc(world, state, target);
        if (npcId is null)
        {
            Observe.Witness(state, Observe.Witnesses(world, state), "Null swings at nothing.");
            Observe.Remember(state, "I swing at nothing.");
            return [Line("warn", "You swing at nothing, which is a kind of practice.")];
        }
        var script = world.Npcs[npcId].Script;
        var runtime = state.Npcs[npcId];
        var weapon = BestWeapon(world, state);
        var withWhat = weapon?.Name ?? "fists";
        Observe.Witness(state, Observe.Witnesses(world, state), $"Null strikes {script.Name} with {withWhat}.");
        Observe.Remember(state, weapon is null ? $"I strike {script.Name} with fists." : $"I strike {script.Name} with the {withWhat}.");
        if (script.Combat.Unkillable == true)
        {
            AddBeat(
                beats,
                npcId,
                $"Null strikes at you with {(weapon is null ? "fists" : $"the {withWhat}")}.",
                script.Combat.RefuseGist ?? "The blow does nothing to you. You cannot be hurt this way.");
            return [Line("combat", $"Your blow does nothing to {script.Name}.")];
        }
        runtime.Hostile = true;
        state.CombatWith = npcId;
        var damage = weapon?.Damage ?? 1;
        runtime.Hp -= damage;
        var lines = new List<GameLine>
        {
            Line("combat", $"You strike {script.Name} with {(weapon is null ? "your fists" : weapon.Name)} for {damage}. ({Math.Max(0, runtime.Hp)}/{runtime.MaxHp})"),
        };
        if (runtime.Hp <= 0)
        {
            KillNpc(world, state, npcId, lines);
            return lines;
        }
        if (Retaliate(world, state, npcId, lines)) return lines;
        return lines;
    }

    static List<GameLine> DoFlee(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        string? foe = state.CombatWith is not null && state.Npcs.TryGetValue(state.CombatWith, out var fighting) && fighting.Alive
            ? state.CombatWith
            : room.Npcs.FirstOrDefault(id => state.Npcs[id].Alive && state.Npcs[id].Hostile);
        if (foe is null) return [Line("body", "Nothing is chasing you. The city does that later.")];
        var lines = new List<GameLine>();
        if (Retaliate(world, state, foe, lines)) return lines;
        state.CombatWith = null;
        var back = state.PreviousRoomId;
        var backDir = Dirs.All.FirstOrDefault(dir => room.Exits.TryGetValue(dir, out var dest) && dest == back && !DirBlocked(room, state, dir));
        var dir = backDir ?? Dirs.All.FirstOrDefault(candidate => room.Exits.ContainsKey(candidate) && !DirBlocked(room, state, candidate));
        if (dir is null || !room.Exits.ContainsKey(dir))
        {
            Observe.Witness(state, Observe.Witnesses(world, state), "Null tries to flee.");
            Observe.Remember(state, "I try to flee.");
            lines.Add(Line("warn", "Nowhere to run. The room is a fist."));
            return lines;
        }
        lines.Add(Line("good", $"You break {dir}."));
        lines.AddRange(Move(world, state, dir, "flees"));
        return lines;
    }

    static bool IsFortune(string topic) =>
        Regex.IsMatch(topic.Trim().ToLowerInvariant(), @"^(?:(?:a|the|my|your)\s+)?fortune$");

    static string? HeldOracle(World world, GameState state, string npcId)
    {
        if (!state.Npcs.TryGetValue(npcId, out var npc)) return null;
        return npc.Inventory.FirstOrDefault(id => world.Items.TryGetValue(id, out var item) && item.Kind == "oracle");
    }

    static (List<GameLine> Lines, Consult? Consult) BeginFortune(World world, GameState state, List<Beat> beats, string npcId)
    {
        var script = world.Npcs[npcId].Script;
        NoteTalk(world, state, npcId, "fortune");
        var itemId = HeldOracle(world, state, npcId);
        if (itemId is null)
        {
            AddBeat(beats, npcId, "Null asks you for a fortune.", "The glass is not in your hands, so there is no fortune. You do not read palms: palms lie, and they charge extra.");
            return ([Line("sys", $"{script.Name} has no crystal ball to read.")], null);
        }
        var name = world.Items.TryGetValue(itemId, out var item) ? item.Name : "crystal ball";
        return (
            [Line("body", $"{script.Name} sets both hands on the {name} and listens.")],
            new Consult { Activator = npcId, ItemId = itemId, Subject = Journal.PlayerId });
    }

    static List<GameLine> DoWait(World world, GameState state)
    {
        Observe.Witness(state, Observe.Witnesses(world, state), "Null waits.");
        Observe.Remember(state, "I wait.");
        var foe = state.CombatWith;
        if (foe is not null && state.Npcs.TryGetValue(foe, out var fighter) && fighter.Alive && fighter.Hostile)
        {
            var lines = new List<GameLine> { Line("body", "You hesitate.") };
            Retaliate(world, state, foe, lines);
            return lines;
        }
        return [Line("body", "You wait. The ash keeps its appointments.")];
    }

    static CommandResult? MetaResult(World world, GameState state, string cmd)
    {
        if (cmd == "help") return new CommandResult { State = state, Lines = HelpLines() };
        if (cmd == "look") return new CommandResult { State = state, Lines = DescribeRoom(world, state) };
        if (cmd == "inv") return new CommandResult { State = state, Lines = InvLines(world, state) };
        if (cmd == "status") return new CommandResult { State = state, Lines = StatusLines(world, state) };
        if (cmd == "map") return new CommandResult { State = state, Lines = [Line("map", MapText(world, state))] };
        if (cmd == "save") return new CommandResult { State = state, Lines = [Line("sys", "Writing tape…")], Effect = "save" };
        if (cmd == "load") return new CommandResult { State = state, Lines = [Line("sys", "Reading tape…")], Effect = "load" };
        if (cmd == "clear") return new CommandResult { State = state, Lines = [], Effect = "clear" };
        if (cmd == "exit") return new CommandResult { State = state, Lines = [], Effect = "exit" };
        if (cmd == "restart") return new CommandResult { State = state, Lines = [], Effect = "restart" };
        return null;
    }

    public static CommandResult ApplyCommand(World world, GameState prev, string input) =>
        ApplyAction(world, prev, ParseCommand(input));

    public static CommandResult ApplyAction(World world, GameState prev, GameAction parsed)
    {
        if (parsed.Type == "empty") return new CommandResult { State = prev, Lines = [] };
        if (parsed.Type == "none")
        {
            return new CommandResult
            {
                State = prev,
                Lines = [Line("body", "Nothing comes of that. Put it another way, or try /help.")],
            };
        }
        if (parsed.Type == "meta")
        {
            var meta = MetaResult(world, prev, parsed.Cmd ?? "");
            if (meta is not null) return meta;
            return new CommandResult
            {
                State = prev,
                Lines = [Line("warn", $"Unknown console command /{parsed.Cmd}. Try /help, or drop the slash and say it.")],
            };
        }
        if (prev.Mode == "won")
        {
            return new CommandResult
            {
                State = prev,
                Lines = [Line("sys", "The cartridge has ended. /restart for another life, or /exit to cut power.")],
            };
        }
        if (prev.Mode == "dead")
        {
            return new CommandResult
            {
                State = prev,
                Lines = [Line("warn", "You are a rumor. /load the last tape, or /restart.")],
            };
        }

        var state = JsonOpts.Clone(prev);
        Observe.RepairLogs(state, world);
        state.Turns += 1;
        var roomId = state.RoomId;
        var wasBlocked = Observe.BlockedDirs(world, state, roomId);
        if (parsed.Type == "say")
        {
            Observe.Witness(state, Observe.Witnesses(world, state), $"Null says {Observe.Quote(parsed.Text ?? "")}");
            Observe.Remember(state, $"I say {Observe.Quote(parsed.Text ?? "")}");
        }
        var beats = new List<Beat>();
        List<GameLine> lines;
        Consult? consult = null;
        switch (parsed.Type)
        {
            case "unknown":
                lines = [Line("warn", $"ASH does not know \"/{parsed.Raw}\". /help lists the commands, or drop the slash and say it.")];
                break;
            case "go":
                lines = Move(world, state, parsed.Dir ?? "");
                break;
            case "look":
                Observe.Witness(state, Observe.Witnesses(world, state), "Null looks around.");
                Observe.Remember(state, "I look around.");
                lines = DescribeRoom(world, state);
                break;
            case "examine":
                lines = DoExamine(world, state, parsed.Target ?? "");
                break;
            case "search":
                lines = DoSearch(world, state);
                break;
            case "listen":
                lines = DoListen(world, state);
                break;
            case "take":
                lines = DoTake(world, state, parsed.Target ?? "");
                break;
            case "drop":
                lines = DoDrop(world, state, parsed.Target ?? "");
                break;
            case "talk":
                var fortuneNpc = parsed.Topic is not null && IsFortune(parsed.Topic)
                    ? MatchNpc(world, state, parsed.Target ?? "")
                    : null;
                if (fortuneNpc is not null)
                {
                    var fortune = BeginFortune(world, state, beats, fortuneNpc);
                    lines = fortune.Lines;
                    consult = fortune.Consult;
                    break;
                }
                lines = DoTalk(world, state, beats, parsed.Target ?? "", parsed.Topic);
                break;
            case "give":
                lines = DoGive(world, state, beats, parsed.Item ?? "", parsed.Npc ?? "");
                break;
            case "buy":
                lines = DoBuy(world, state, beats, parsed.Item ?? "");
                break;
            case "sell":
                lines = DoSell(world, state, beats, parsed.Item ?? "");
                break;
            case "pay":
                lines = DoPay(world, state, beats, parsed.Npc ?? "");
                break;
            case "attack":
                lines = DoAttack(world, state, beats, parsed.Target ?? "");
                break;
            case "flee":
                lines = DoFlee(world, state);
                break;
            case "use":
                var used = MatchItem(world, parsed.Item ?? "", state.Inventory);
                lines = DoUse(world, state, parsed.Item ?? "");
                if (used?.Kind == "oracle") consult = new Consult { Activator = Journal.PlayerId, ItemId = used.Id };
                break;
            case "say":
                lines = DoSay(world, state, beats, parsed.Text ?? "");
                break;
            case "story":
                lines = DoStory(world, state, beats, parsed.Npc ?? "");
                break;
            case "trade":
                lines = DoTrade(world, state);
                break;
            case "wait":
                lines = DoWait(world, state);
                break;
            default:
                lines = [Line("warn", "The parser shrugged.")];
                break;
        }
        Observe.NoteOpenedDoors(world, state, roomId, wasBlocked);
        if (state.RoomId == roomId && state.Mode == "play")
        {
            var still = Observe.BlockedDirs(world, state, roomId);
            foreach (var dir in wasBlocked)
            {
                if (!still.Contains(dir)) lines.Add(Line("good", $"The way {dir} is open."));
            }
        }
        return new CommandResult
        {
            State = state,
            Lines = lines,
            Consult = consult,
            Beats = beats.Count > 0 ? beats : null,
        };
    }
}
