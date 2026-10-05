namespace Ash.Game;

public static class WorldBuilder
{
    static readonly Dictionary<string, (int X, int Y)> Delta = new()
    {
        ["north"] = (0, 1),
        ["south"] = (0, -1),
        ["east"] = (1, 0),
        ["west"] = (-1, 0),
    };

    public static World Create(
        IReadOnlyList<RoomDef> roomsIn,
        IReadOnlyList<NpcScript> scripts,
        IReadOnlyList<NpcState> states,
        IReadOnlyList<ItemDef> itemsIn,
        string start = "silt-dock")
    {
        var items = new Dictionary<string, ItemDef>();
        foreach (var item in itemsIn)
        {
            if (items.ContainsKey(item.Id)) throw new InvalidDataException($"duplicate item {item.Id}");
            items[item.Id] = item;
        }

        var rooms = new Dictionary<string, RoomDef>();
        foreach (var room in roomsIn)
        {
            if (rooms.ContainsKey(room.Id)) throw new InvalidDataException($"duplicate room {room.Id}");
            rooms[room.Id] = room;
        }

        var npcs = new Dictionary<string, NpcPair>();
        foreach (var script in scripts)
        {
            var state = states.FirstOrDefault(s => s.Id == script.Id);
            if (state is null) throw new InvalidDataException($"npc {script.Id} missing state");
            if (npcs.ContainsKey(script.Id)) throw new InvalidDataException($"duplicate npc {script.Id}");
            npcs[script.Id] = new NpcPair { Script = script, State = state };
        }
        foreach (var state in states)
        {
            if (!npcs.ContainsKey(state.Id)) throw new InvalidDataException($"state {state.Id} missing script");
        }
        if (!rooms.ContainsKey(start)) throw new InvalidDataException($"missing start room {start}");

        void NeedItem(string id, string where)
        {
            if (!items.ContainsKey(id)) throw new InvalidDataException($"unknown item {id} at {where}");
        }
        void CheckCond(Cond? cond, string where)
        {
            foreach (var fact in Facts.EachFact(cond))
            {
                if (fact.Carrying is not null) NeedItem(fact.Carrying, where);
                if (fact.HeldBy is not null)
                {
                    if (!npcs.ContainsKey(fact.HeldBy)) throw new InvalidDataException($"unknown npc {fact.HeldBy} at {where}");
                    NeedItem(fact.Item ?? "", where);
                }
                if (fact.Recalls is not null && fact.Npc is not null && !npcs.ContainsKey(fact.Npc))
                {
                    throw new InvalidDataException($"unknown npc {fact.Npc} at {where}");
                }
                if (fact.Gone is not null && !npcs.ContainsKey(fact.Gone))
                {
                    throw new InvalidDataException($"unknown npc {fact.Gone} at {where}");
                }
                if (fact.Place is not null && fact.Room is not null && !rooms.ContainsKey(fact.Room))
                {
                    throw new InvalidDataException($"unknown room {fact.Room} at {where}");
                }
            }
        }
        void CheckChanges(List<Change>? changes, string where)
        {
            foreach (var change in changes ?? [])
            {
                if (change.Recall is not null && change.Npc is not null && !npcs.ContainsKey(change.Npc))
                {
                    throw new InvalidDataException($"unknown npc {change.Npc} at {where}");
                }
                if (change.Place is not null && change.Room is not null && !rooms.ContainsKey(change.Room))
                {
                    throw new InvalidDataException($"unknown room {change.Room} at {where}");
                }
            }
        }

        foreach (var item in items.Values) CheckCond(item.SellWhen, $"{item.Id} sell");
        foreach (var room in rooms.Values)
        {
            foreach (var dir in Dirs.All)
            {
                if (!room.Exits.TryGetValue(dir, out var destId) || destId.Length == 0) continue;
                if (!rooms.TryGetValue(destId, out var dest))
                {
                    throw new InvalidDataException($"{room.Id} exit {dir} → missing {destId}");
                }
                var (dx, dy) = Delta[dir];
                if (dest.X != room.X + dx || dest.Y != room.Y + dy)
                {
                    throw new InvalidDataException(
                        $"{room.Id} {dir} to {destId} is not adjacent ({room.X},{room.Y}) → ({dest.X},{dest.Y})");
                }
            }
            foreach (var npcId in room.Npcs)
            {
                if (!npcs.ContainsKey(npcId)) throw new InvalidDataException($"{room.Id} unknown npc {npcId}");
            }
            foreach (var desc in room.Descriptions)
            {
                CheckCond(desc.When, room.Id);
                CheckCond(desc.Unless, room.Id);
            }
            foreach (var ground in room.Ground)
            {
                NeedItem(ground.Id, room.Id);
                CheckCond(ground.HiddenUntil, room.Id);
            }
            foreach (var step in room.OnListen?.Steps ?? [])
            {
                if (step.RequiresItem is not null) NeedItem(step.RequiresItem, $"{room.Id} listen");
                CheckChanges(step.Change, $"{room.Id} listen");
            }
            if (room.OnSearch is not null)
            {
                CheckCond(room.OnSearch.When, $"{room.Id} search");
                CheckCond(room.OnSearch.Done, $"{room.Id} search");
                CheckChanges(room.OnSearch.Change, $"{room.Id} search");
                foreach (var id in room.OnSearch.GrantItems ?? []) NeedItem(id, $"{room.Id} search");
            }
            foreach (var obstacle in room.Obstacles) CheckCond(obstacle.When, $"{room.Id} obstacle");
        }

        foreach (var pair in npcs.Values)
        {
            var script = pair.Script;
            foreach (var id in pair.State.Inventory) NeedItem(id, $"{script.Id} pack");
            foreach (var id in script.Shop?.Sells ?? []) NeedItem(id, $"{script.Id} shop");
            foreach (var alt in script.PresenceWhen ?? []) CheckCond(alt.When, $"{script.Id} presence");
            foreach (var topic in script.Topics.Values) CheckChanges(topic.Change, $"{script.Id} topic");
            foreach (var trade in script.Trades)
            {
                NeedItem(trade.Give, $"{script.Id} trade");
                if (trade.Receive is not null) NeedItem(trade.Receive, $"{script.Id} trade receive");
                CheckCond(trade.Once, $"{script.Id} trade");
                CheckChanges(trade.Change, $"{script.Id} trade");
            }
            if (script.Bribe is not null)
            {
                CheckCond(script.Bribe.Done, $"{script.Id} bribe");
                CheckChanges(script.Bribe.Change, $"{script.Id} bribe");
            }
            if (script.Story is not null)
            {
                CheckCond(script.Story.When, $"{script.Id} story");
                CheckCond(script.Story.Done, $"{script.Id} story");
                CheckChanges(script.Story.Change, $"{script.Id} story");
            }
            foreach (var rule in script.OnTalk ?? [])
            {
                CheckCond(rule.When, $"{script.Id} talk");
                if (rule.RequiresItem is not null) NeedItem(rule.RequiresItem, $"{script.Id} talk");
                if (rule.TakeFromSelf is not null) NeedItem(rule.TakeFromSelf, $"{script.Id} talk");
                CheckChanges(rule.Change, $"{script.Id} talk");
                foreach (var id in rule.GrantItems ?? []) NeedItem(id, $"{script.Id} grant");
            }
            foreach (var rule in script.Say)
            {
                CheckCond(rule.When, $"{script.Id} say");
                CheckChanges(rule.Change, $"{script.Id} say");
                foreach (var id in rule.RequiresAllItems ?? []) NeedItem(id, $"{script.Id} say");
                foreach (var id in rule.ConsumeItems ?? []) NeedItem(id, $"{script.Id} consume");
                foreach (var id in rule.GrantItems ?? []) NeedItem(id, $"{script.Id} say grant");
            }
            CheckChanges(script.Combat.OnDeath, $"{script.Id} death");
        }

        var placed = new HashSet<string>();
        foreach (var script in npcs.Values.Select(pair => pair.Script))
        {
            foreach (var room in rooms.Values)
            {
                if (!room.Npcs.Contains(script.Id)) continue;
                if (!placed.Add(script.Id)) throw new InvalidDataException($"npc {script.Id} in two rooms");
            }
            if (!placed.Contains(script.Id)) throw new InvalidDataException($"npc {script.Id} not placed");
        }

        return new World { Start = start, Items = items, Rooms = rooms, Npcs = npcs };
    }

    public static GameState InitialState(World world)
    {
        var npcs = new Dictionary<string, NpcRuntime>();
        foreach (var (id, npc) in world.Npcs)
        {
            npcs[id] = new NpcRuntime
            {
                Alive = npc.State.Alive,
                Hp = npc.State.Hp,
                MaxHp = npc.State.MaxHp,
                Hostile = npc.State.Hostile,
                Inventory = [.. npc.State.Inventory],
                Mind = [],
                Log = [],
            };
        }
        var roomItems = new Dictionary<string, List<string>>();
        var places = new Dictionary<string, Dictionary<string, string>>();
        foreach (var room in world.Rooms.Values)
        {
            roomItems[room.Id] = room.Ground.Select(ground => ground.Id).ToList();
            places[room.Id] = room.Fixtures is null
                ? []
                : new Dictionary<string, string>(room.Fixtures);
        }
        var state = new GameState
        {
            Version = 2,
            Mode = "play",
            RoomId = world.Start,
            PreviousRoomId = null,
            Hp = 14,
            MaxHp = 14,
            Scrip = 24,
            Inventory = ["bent-multitool", "stim"],
            Mind = [],
            Places = places,
            Air = [],
            Counters = [],
            Turns = 0,
            Visited = [world.Start],
            Npcs = npcs,
            RoomItems = roomItems,
            CombatWith = null,
            PlayerLog = [],
        };
        Facts.EnsureState(state, world);
        Observe.NoteArrival(world, state, world.Start);
        return state;
    }

    public static World LoadCartridge(string ashDir)
    {
        var index = JsonOpts.Read<CartridgeIndex>(Path.Combine(ashDir, "index.json"));
        var items = JsonOpts.Read<List<ItemDef>>(Path.Combine(ashDir, "items.json"));
        var rooms = index.Rooms.Select(id => JsonOpts.Read<RoomDef>(Path.Combine(ashDir, "rooms", $"{id}.json"))).ToList();
        var scripts = new List<NpcScript>();
        var states = new List<NpcState>();
        foreach (var id in index.Npcs)
        {
            var folder = Path.Combine(ashDir, "npcs", id);
            scripts.Add(JsonOpts.Read<NpcScript>(Path.Combine(folder, "script.json")));
            states.Add(JsonOpts.Read<NpcState>(Path.Combine(folder, "state.json")));
        }
        return Create(rooms, scripts, states, items, index.Start);
    }
}

public sealed class CartridgeIndex
{
    public string Start { get; set; } = "";
    public List<string> Rooms { get; set; } = [];
    public List<string> Npcs { get; set; } = [];
}
