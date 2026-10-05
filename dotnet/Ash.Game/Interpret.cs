using System.Text.Json;

namespace Ash.Game;

public sealed class ToolError : Exception
{
    public ToolError(string message) : base(message) { }
}

public sealed class Scene
{
    public List<string> Dirs { get; set; } = [];
    public List<string> Npcs { get; set; } = [];
    public List<string> Ground { get; set; } = [];
    public List<string> Carried { get; set; } = [];
    public List<string> Stock { get; set; } = [];
    public List<string> Readers { get; set; } = [];
    public bool Merchant { get; set; }
}

public sealed class ToolCall
{
    public string Name { get; set; } = "";
    public Dictionary<string, object?> Arguments { get; set; } = [];
}

public sealed class ChatMessage
{
    public string Role { get; set; } = "";
    public string Content { get; set; } = "";
    public string? ToolName { get; set; }
    public List<ToolCall>? ToolCalls { get; set; }
}

public sealed class ModelReply
{
    public string Content { get; set; } = "";
    public List<ToolCall> Calls { get; set; } = [];
}

public sealed class ToolSpec
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public Dictionary<string, List<string>?> Parameters { get; set; } = [];
    public List<string> Required { get; set; } = [];
}

public delegate Task<ModelReply> ChatTools(IReadOnlyList<ToolSpec> tools, List<ChatMessage> messages, CancellationToken cancel);

public static class Interpreter
{
    const int MaxCalls = 3;
    const int Attempts = 2;
    const string Self = "self";

    static readonly Dictionary<string, string> Screens = new()
    {
        ["inventory"] = "inv",
        ["status"] = "status",
        ["map"] = "map",
        ["help"] = "help",
    };

    sealed class GameTool
    {
        public string Name { get; init; } = "";
        public string Description { get; init; } = "";
        public Dictionary<string, bool> Params { get; init; } = [];
        public Func<Scene, bool> Available { get; init; } = _ => true;
        public Func<Dictionary<string, object?>, Scene, string, GameAction> Run { get; init; } = (_, _, _) => GameAction.Of("none");
    }

    static List<string> Unique(IEnumerable<string> ids) => ids.Distinct().ToList();

    public static Scene SceneOf(World world, GameState state)
    {
        var room = world.Rooms[state.RoomId];
        var npcs = room.Npcs.Where(id => state.Npcs.TryGetValue(id, out var npc) && npc.Alive).ToList();
        var merchants = npcs.Where(id => world.Npcs[id].Script.Shop is not null).ToList();
        var stock = Unique(merchants.SelectMany(id =>
        {
            var sells = world.Npcs[id].Script.Shop?.Sells ?? [];
            return state.Npcs[id].Inventory.Where(sells.Contains);
        }));
        var readers = npcs.Where(id =>
            state.Npcs[id].Inventory.Any(itemId => world.Items.TryGetValue(itemId, out var item) && item.Kind == "oracle")).ToList();
        return new Scene
        {
            Dirs = Dirs.All.Where(dir => room.Exits.ContainsKey(dir)).ToList(),
            Npcs = npcs,
            Ground = Unique(Engine.ItemsInRoom(world, state).Select(item => item.Id).Concat(Engine.OraclesInHands(world, state).Select(item => item.Id))),
            Carried = Unique(state.Inventory).Where(world.Items.ContainsKey).ToList(),
            Stock = stock,
            Readers = readers,
            Merchant = merchants.Count > 0,
        };
    }

    static string Str(IReadOnlyDictionary<string, object?> args, string key)
    {
        if (!args.TryGetValue(key, out var value) || value is null) return "";
        if (value is JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.String) return element.GetString()?.Trim() ?? "";
            return element.ToString().Trim();
        }
        return value.ToString()?.Trim() ?? "";
    }

    static string Pick(IReadOnlyDictionary<string, object?> args, string key, IReadOnlyList<string> allowed, string what)
    {
        var value = Str(args, key);
        if (value.Length == 0) throw new ToolError($"{key} is required. Choose one of: {string.Join(", ", allowed)}.");
        if (!allowed.Contains(value)) throw new ToolError($"There is no {what} \"{value}\" here. Choose one of: {string.Join(", ", allowed)}.");
        return value;
    }

    static readonly GameTool[] Tools =
    [
        new()
        {
            Name = "move",
            Description = "Walk out of the room through an exit.",
            Params = new() { ["direction"] = true },
            Available = scene => scene.Dirs.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "go", Dir = Pick(args, "direction", scene.Dirs, "exit") },
        },
        new()
        {
            Name = "look_around",
            Description = "Look around the room again: its description, exits, items, and people.",
            Available = _ => true,
            Run = (_, _, _) => GameAction.Of("look"),
        },
        new()
        {
            Name = "examine",
            Description = "Look closely at one person, one item, or at Null himself (target self).",
            Params = new() { ["target"] = true },
            Available = _ => true,
            Run = (args, scene, _) =>
            {
                var allowed = scene.Npcs.Concat(scene.Ground).Concat(scene.Carried).Concat(scene.Stock).Append(Self).ToList();
                var target = Pick(args, "target", allowed, "target");
                return new GameAction { Type = "examine", Target = target == Self ? "me" : target };
            },
        },
        new()
        {
            Name = "search_room",
            Description = "Search the room for anything hidden.",
            Available = _ => true,
            Run = (_, _, _) => GameAction.Of("search"),
        },
        new()
        {
            Name = "listen",
            Description = "Stand still and listen to the room. Also use it to pray or kneel.",
            Available = _ => true,
            Run = (_, _, _) => GameAction.Of("listen"),
        },
        new()
        {
            Name = "take_item",
            Description = "Pick up an item lying here, or take an item out of someone's hands.",
            Params = new() { ["item"] = true },
            Available = scene => scene.Ground.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "take", Target = Pick(args, "item", scene.Ground, "item") },
        },
        new()
        {
            Name = "drop_item",
            Description = "Put down an item Null carries.",
            Params = new() { ["item"] = true },
            Available = scene => scene.Carried.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "drop", Target = Pick(args, "item", scene.Carried, "carried item") },
        },
        new()
        {
            Name = "use_item",
            Description = "Use an item Null carries: take a stim, operate gear. If Null holds a crystal ball himself, this is how he looks into it.",
            Params = new() { ["item"] = true },
            Available = scene => scene.Carried.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "use", Item = Pick(args, "item", scene.Carried, "carried item") },
        },
        new()
        {
            Name = "talk_to",
            Description = "Talk to a person, or ask them about a subject. Put the subject in topic, using one of their listed topics when it fits.",
            Params = new() { ["person"] = true, ["topic"] = false },
            Available = scene => scene.Npcs.Count > 0,
            Run = (args, scene, _) =>
            {
                var person = Pick(args, "person", scene.Npcs, "person");
                var topic = Str(args, "topic");
                return topic.Length > 0
                    ? new GameAction { Type = "talk", Target = person, Topic = topic }
                    : new GameAction { Type = "talk", Target = person };
            },
        },
        new()
        {
            Name = "ask_for_fortune",
            Description = "Ask the person holding a crystal ball to read Null's fortune in it. Use this whenever the player asks what the crystal ball says, sees, or shows, asks for a reading, a fortune, or a prophecy, or asks someone to look into the ball for him.",
            Params = new() { ["reader"] = true },
            Available = scene => scene.Readers.Count > 0,
            Run = (args, scene, _) => new GameAction
            {
                Type = "talk",
                Target = Pick(args, "reader", scene.Readers, "person holding a crystal ball"),
                Topic = "fortune",
            },
        },
        new()
        {
            Name = "say",
            Description = "Null speaks words aloud to the room: a password, an answer to a question, a reply, a greeting, or a statement. Copy the words exactly as the player typed them.",
            Params = new() { ["words"] = true },
            Available = _ => true,
            Run = (args, _, input) => new GameAction { Type = "say", Text = Str(args, "words") is { Length: > 0 } words ? words : input.Trim() },
        },
        new()
        {
            Name = "give_item",
            Description = "Hand an item Null carries to a person, as a gift or a swap.",
            Params = new() { ["item"] = true, ["person"] = true },
            Available = scene => scene.Npcs.Count > 0 && scene.Carried.Count > 0,
            Run = (args, scene, _) => new GameAction
            {
                Type = "give",
                Item = Pick(args, "item", scene.Carried, "carried item"),
                Npc = Pick(args, "person", scene.Npcs, "person"),
            },
        },
        new()
        {
            Name = "tell_story",
            Description = "Tell a person a story, or tell them about something that happened to Null.",
            Params = new() { ["person"] = true },
            Available = scene => scene.Npcs.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "story", Npc = Pick(args, "person", scene.Npcs, "person") },
        },
        new()
        {
            Name = "pay",
            Description = "Pay a person scrip: a bribe, a toll, a fare, or a healer's fee.",
            Params = new() { ["person"] = true },
            Available = scene => scene.Npcs.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "pay", Npc = Pick(args, "person", scene.Npcs, "person") },
        },
        new()
        {
            Name = "show_wares",
            Description = "See what the merchant here sells, at what price, and what they buy.",
            Available = scene => scene.Merchant,
            Run = (_, _, _) => GameAction.Of("trade"),
        },
        new()
        {
            Name = "buy_item",
            Description = "Buy an item from the merchant for scrip. Only when the player clearly says to buy it. Asking a price is talk_to with that item as topic.",
            Params = new() { ["item"] = true },
            Available = scene => scene.Merchant && scene.Stock.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "buy", Item = Pick(args, "item", scene.Stock, "item for sale") },
        },
        new()
        {
            Name = "sell_item",
            Description = "Sell an item Null carries to the merchant for scrip. Any offer to sell is this tool, never give_item.",
            Params = new() { ["item"] = true },
            Available = scene => scene.Merchant && scene.Carried.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "sell", Item = Pick(args, "item", scene.Carried, "carried item") },
        },
        new()
        {
            Name = "attack",
            Description = "Fight a person.",
            Params = new() { ["person"] = true },
            Available = scene => scene.Npcs.Count > 0,
            Run = (args, scene, _) => new GameAction { Type = "attack", Target = Pick(args, "person", scene.Npcs, "person") },
        },
        new()
        {
            Name = "flee",
            Description = "Run away from a fight.",
            Available = _ => true,
            Run = (_, _, _) => GameAction.Of("flee"),
        },
        new()
        {
            Name = "wait",
            Description = "Let a moment pass.",
            Available = _ => true,
            Run = (_, _, _) => GameAction.Of("wait"),
        },
        new()
        {
            Name = "show_screen",
            Description = "Show one of the game's screens: what Null carries, his status, the map, or help.",
            Params = new() { ["screen"] = true },
            Available = _ => true,
            Run = (args, _, _) => new GameAction { Type = "meta", Cmd = Screens[Pick(args, "screen", Screens.Keys.ToList(), "screen")] },
        },
    ];

    static List<string>? EnumFor(GameTool tool, string key, Scene scene)
    {
        if (key == "direction") return scene.Dirs;
        if (key == "person") return scene.Npcs;
        if (key == "reader") return scene.Readers;
        if (key == "screen") return Screens.Keys.ToList();
        if (key == "target") return scene.Npcs.Concat(scene.Ground).Concat(scene.Carried).Concat(scene.Stock).Append(Self).ToList();
        if (key != "item") return null;
        if (tool.Name == "take_item") return scene.Ground;
        if (tool.Name == "buy_item") return scene.Stock;
        return scene.Carried;
    }

    public static List<ToolSpec> ToolsFor(Scene scene)
    {
        return Tools.Where(tool => tool.Available(scene)).Select(tool =>
        {
            var spec = new ToolSpec { Name = tool.Name, Description = tool.Description };
            foreach (var (key, required) in tool.Params)
            {
                var values = EnumFor(tool, key, scene);
                spec.Parameters[key] = values is null ? null : Unique(values);
                if (required) spec.Required.Add(key);
            }
            return spec;
        }).ToList();
    }

    static string ItemRow(World world, string id)
    {
        var item = world.Items[id];
        var aliases = item.Aliases.Where(alias => alias != item.Name.ToLowerInvariant()).ToList();
        return aliases.Count > 0 ? $"{id} — {item.Name} ({string.Join(", ", aliases)})" : $"{id} — {item.Name}";
    }

    public static string InterpretPrompt(World world, GameState state, Scene scene)
    {
        var room = world.Rooms[state.RoomId];
        var blocked = Observe.BlockedDirs(world, state, state.RoomId);
        var exits = scene.Dirs.Select(dir => blocked.Contains(dir) ? $"{dir} (blocked)" : dir).ToList();
        var crowd = scene.Npcs.Select(id =>
        {
            var script = world.Npcs[id].Script;
            var topics = script.Topics.Keys.ToList();
            var parts = new List<string> { $"{id} — {script.Name}; also called {string.Join(", ", script.Aliases)}" };
            if (topics.Count > 0) parts.Add($"topics: {string.Join(", ", topics)}");
            if (script.Shop is not null) parts.Add("merchant");
            if (state.Npcs[id].Hostile) parts.Add("hostile");
            var held = state.Npcs[id].Inventory.Where(itemId => world.Items.TryGetValue(itemId, out var item) && item.Kind == "oracle").ToList();
            if (held.Count > 0) parts.Add($"holding {string.Join(", ", held.Select(itemId => world.Items[itemId].Name))}");
            return $"- {string.Join("; ", parts)}";
        }).ToList();
        List<string> List(IReadOnlyList<string> ids) =>
            ids.Count > 0 ? ids.Select(id => $"- {ItemRow(world, id)}").ToList() : ["- (nothing)"];
        var lines = new List<string>
        {
            "You are the hands of Null, the player character in the text game Ash Protocol.",
            "Read what the player typed and carry it out by calling the game tools. You are not a character and you never answer in prose.",
            "Call the one tool that does what the player means. If the player asks for two things in a row, call both tools in that order.",
            "Use only the ids listed below. Articles like the, a, an do not matter. Pronouns like it, him, or her point at the most obvious person or item here.",
            "When the player addresses someone, the person here is meant even if the name is only a title or a description.",
            "If the player states something, answers, or says a word aloud, call say. Prefer say over doing nothing whenever someone is here to hear it.",
            "",
            $"ROOM: {room.Name}",
            $"EXITS: {(exits.Count > 0 ? string.Join(", ", exits) : "none")}",
            "PEOPLE HERE:",
        };
        lines.AddRange(crowd.Count > 0 ? crowd : ["- (nobody)"]);
        lines.Add("ITEMS HERE:");
        lines.AddRange(List(scene.Ground));
        lines.Add("NULL CARRIES:");
        lines.AddRange(List(scene.Carried));
        if (scene.Stock.Count > 0)
        {
            lines.Add("FOR SALE:");
            lines.AddRange(List(scene.Stock));
        }
        return string.Join('\n', lines);
    }

    public static GameAction CallToAction(ToolCall call, Scene scene, string input)
    {
        var tool = Tools.FirstOrDefault(entry => entry.Name == call.Name);
        if (tool is null || !tool.Available(scene))
        {
            var names = Tools.Where(entry => entry.Available(scene)).Select(entry => entry.Name);
            throw new ToolError($"There is no tool \"{call.Name}\" here. Use one of: {string.Join(", ", names)}.");
        }
        return tool.Run(call.Arguments, scene, input);
    }

    public static Dictionary<string, object?> ArgumentsFrom(object? value)
    {
        switch (value)
        {
            case null:
                return [];
            case string text:
                try
                {
                    return ArgumentsFrom(JsonSerializer.Deserialize<JsonElement>(text));
                }
                catch (JsonException)
                {
                    return [];
                }
            case JsonElement element when element.ValueKind == JsonValueKind.String:
                return ArgumentsFrom(element.GetString());
            case JsonElement element when element.ValueKind == JsonValueKind.Object:
                var parsed = new Dictionary<string, object?>();
                foreach (var property in element.EnumerateObject())
                {
                    parsed[property.Name] = property.Value.ValueKind == JsonValueKind.String
                        ? property.Value.GetString()
                        : property.Value.GetRawText();
                }
                return parsed;
            case Dictionary<string, object?> ready:
                return ready;
            default:
                return [];
        }
    }

    public static async Task<List<GameAction>?> Read(
        World world,
        GameState state,
        string input,
        ChatTools chat,
        CancellationToken cancel = default)
    {
        var scene = SceneOf(world, state);
        var tools = ToolsFor(scene);
        var messages = new List<ChatMessage>
        {
            new() { Role = "system", Content = InterpretPrompt(world, state, scene) },
            new() { Role = "user", Content = input.Trim() },
        };
        for (var attempt = 0; attempt < Attempts; attempt++)
        {
            var reply = await chat(tools, messages, cancel);
            var actions = new List<GameAction>();
            var errors = new List<(string Name, string Message)>();
            foreach (var call in reply.Calls.Take(MaxCalls))
            {
                call.Arguments = ArgumentsFrom(call.Arguments);
                try
                {
                    actions.Add(CallToAction(call, scene, input));
                }
                catch (ToolError error)
                {
                    errors.Add((call.Name, error.Message));
                }
            }
            if (actions.Count > 0 && (errors.Count == 0 || attempt == Attempts - 1)) return actions;
            messages.Add(new ChatMessage
            {
                Role = "assistant",
                Content = reply.Content,
                ToolCalls = reply.Calls,
            });
            if (errors.Count > 0)
            {
                foreach (var error in errors)
                {
                    messages.Add(new ChatMessage { Role = "tool", ToolName = error.Name, Content = $"Error: {error.Message}" });
                }
            }
            else
            {
                messages.Add(new ChatMessage { Role = "user", Content = "Do not answer in prose. Call one of the tools." });
            }
        }
        return null;
    }
}
