using System.Text.Json;
using Ash.Game;

namespace Ash.Game.Tests;

public class ObserveTests
{
    static ItemDef Item(string id, string name, string kind, int value, string? useText = null) => new()
    {
        Id = id,
        Name = name,
        Aliases = [id, name.ToLowerInvariant()],
        Kind = kind,
        Value = value,
        Text = name,
        UseText = useText,
    };

    static NpcScript Person(string id, string name, Action<NpcScript>? extra = null)
    {
        var script = new NpcScript
        {
            Id = id,
            Name = name,
            Aliases = [id],
            Presence = $"{name} is here.",
            Greeting = "Hello.",
            Combat = new CombatDef { Damage = 1, OnDeathSay = $"{name} falls." },
        };
        extra?.Invoke(script);
        return script;
    }

    static NpcState Body(string id, params string[] inventory) => new()
    {
        Id = id,
        Alive = true,
        Hp = 8,
        MaxHp = 8,
        Mood = "calm",
        Inventory = [.. inventory],
    };

    static RoomDef Room(string id, string name, int x, int y, Dictionary<string, string> exits, Action<RoomDef>? extra = null)
    {
        var room = new RoomDef
        {
            Id = id,
            Name = name,
            Code = id[..3].ToUpperInvariant(),
            X = x,
            Y = y,
            Exits = exits,
            Descriptions = [new RoomDescription { Text = name }],
        };
        extra?.Invoke(room);
        return room;
    }

    static (World World, GameState State) Chapel()
    {
        var sister = Person("sister", "Sister", script =>
        {
            script.Bribe = new Bribe
            {
                Cost = 4,
                Done = new Cond { Place = "bar", Is = "down", Room = "chapel" },
                Change = [new Change { Place = "bar", Is = "down", Room = "chapel" }],
                Gist = "The door is yours.",
            };
            script.Say =
            [
                new SayRule { Includes = "friend", Gist = "Same as everyday." },
                new SayRule
                {
                    Includes = "ash",
                    ConsumeItems = ["cascader"],
                    GrantItems = ["diode"],
                    Gist = "Take this.",
                },
            ];
            script.Shop = new ShopDef { Sells = ["diode"], Buys = ["junk"] };
        });
        var rooms = new List<RoomDef>
        {
            Room("lane", "Lane", 0, 0, new() { ["east"] = "chapel" }),
            Room("chapel", "Chapel", 1, 0, new() { ["west"] = "lane", ["east"] = "nave", ["north"] = "loft" }, room =>
            {
                room.Ground = [new GroundItem { Id = "optic" }];
                room.Npcs = ["sister", "clerk"];
                room.Fixtures = new() { ["bar"] = "up" };
                room.Obstacles =
                [
                    new Obstacle { Dir = "east", When = new Cond { Carrying = "optic" }, Fail = "The east door is shut.", Pass = "The east door stands open." },
                    new Obstacle { Dir = "north", When = new Cond { Place = "bar", Is = "down" }, Fail = "The north door is shut.", Pass = "The north door stands open." },
                ];
            }),
            Room("nave", "Nave", 2, 0, new() { ["west"] = "chapel" }, room => room.Npcs = ["warden"]),
            Room("loft", "Loft", 1, 1, new() { ["south"] = "chapel" }),
        };
        var world = WorldBuilder.Create(
            rooms,
            [sister, Person("clerk", "Clerk"), Person("warden", "Warden")],
            [Body("sister", "diode"), Body("clerk"), Body("warden")],
            [Item("optic", "Optic Defibrillator", "gear", 2), Item("cascader", "Cascader", "junk", 1, "The cascader ticks."), Item("diode", "diode", "junk", 4)],
            "lane");
        var state = WorldBuilder.InitialState(world);
        state.Inventory = ["cascader"];
        return (world, state);
    }

    static async Task<GameState> Play(World world, GameState state, params string[] commands)
    {
        var current = state;
        foreach (var command in commands)
        {
            current = (await Harness.Play(world, current, command, Support.Offline())).State;
        }
        return current;
    }

    [Fact]
    public void Spoken_lines_keep_the_players_casing()
    {
        Support.SameAction(Engine.ParseCommand("/say How are you, my friend?"), new GameAction { Type = "say", Text = "How are you, my friend?" });
        Support.SameAction(Engine.ParseCommand("/shout Coil sent me"), new GameAction { Type = "say", Text = "Coil sent me" });
        Assert.Equal("meta", Engine.ParseCommand("/look").Type);
    }

    [Fact]
    public async Task An_npc_log_is_the_room_in_order()
    {
        var (world, state) = Chapel();
        Assert.Empty(state.Npcs["sister"].Log);
        Assert.Empty(state.Npcs["warden"].Log);

        var entered = await Harness.Play(world, state, "/e", Support.Offline());
        Assert.Equal(["Null comes into the Chapel."], entered.State.Npcs["sister"].Log);
        Assert.Empty(state.Npcs["sister"].Log);

        var seen = await Play(world, entered.State,
            "/say How are you, my friend?",
            "/use Cascader",
            "/take Optic Defibrillator",
            "/say Do you sell anything?",
            "/buy diode",
            "/say Thank you.",
            "/e");

        Assert.Equal(
            [
                "Null comes into the Chapel.",
                "Null says \"How are you, my friend?\"",
                "I reply \"Same as everyday.\"",
                "Null uses Cascader.",
                "Null takes Optic Defibrillator.",
                "Door to east opens.",
                "Null says \"Do you sell anything?\"",
                "Trade happens - 1 diode for 4 scrip.",
                "Null says \"Thank you.\"",
                "Null goes east.",
            ],
            seen.Npcs["sister"].Log);
        Assert.Equal(
            [
                "Null comes into the Chapel.",
                "Null says \"How are you, my friend?\"",
                "Sister replies \"Same as everyday.\"",
                "Null uses Cascader.",
                "Null takes Optic Defibrillator.",
                "Door to east opens.",
                "Null says \"Do you sell anything?\"",
                "Trade happens - 1 diode for 4 scrip.",
                "Null says \"Thank you.\"",
                "Null goes east.",
            ],
            seen.Npcs["clerk"].Log);
        Assert.Equal(["Null comes into the Nave."], seen.Npcs["warden"].Log);
        Assert.Equal(["Null comes into the Chapel."], entered.State.Npcs["sister"].Log);
    }

    [Fact]
    public async Task Paying_opens_a_door_the_npc_can_see()
    {
        var (world, state) = Chapel();
        var next = await Play(world, state, "/e", "/pay sister");
        Assert.Equal(
            [
                "Null comes into the Chapel.",
                "Null pays me 4 scrip.",
                "Door to north opens.",
                "I reply \"The door is yours.\"",
            ],
            next.Npcs["sister"].Log);
        Assert.Equal("Sister replies \"The door is yours.\"", next.Npcs["clerk"].Log[^1]);
        Assert.Contains("Door to north opens.", next.Npcs["clerk"].Log);
        Assert.Contains("Null pays Sister 4 scrip.", next.Npcs["clerk"].Log);
    }

    [Fact]
    public async Task A_fight_is_written_from_both_sides()
    {
        var (world, state) = Chapel();
        var next = await Play(world, state, "/e", "/attack clerk");
        Assert.Equal(
            ["Null comes into the Chapel.", "Null strikes Clerk with fists.", "Clerk hits Null."],
            next.Npcs["sister"].Log);
        Assert.Equal(
            ["Null comes into the Chapel.", "Null strikes Clerk with fists.", "I hit Null."],
            next.Npcs["clerk"].Log);
    }

    [Fact]
    public async Task What_an_npc_gives_and_takes_is_part_of_the_reply()
    {
        var (world, state) = Chapel();
        var next = await Play(world, state, "/e", "/say ash");
        Assert.Equal(
            [
                "Null comes into the Chapel.",
                "Null says \"ash\"",
                "Null hands over Cascader.",
                "I give Null diode.",
                "I reply \"Take this.\"",
            ],
            next.Npcs["sister"].Log);
        Assert.Contains("Sister gives Null diode.", next.Npcs["clerk"].Log);
        Assert.Contains("diode", next.Inventory);
        Assert.DoesNotContain("cascader", next.Inventory);
    }

    [Fact]
    public void A_tape_from_before_the_log_still_records_the_next_thing()
    {
        var (world, state) = Chapel();
        var arrived = Engine.ApplyCommand(world, state, "e").State;
        arrived.Npcs["sister"].Log = null!;
        var waited = Engine.ApplyCommand(world, arrived, "wait").State;
        Assert.Equal(["Null waits."], waited.Npcs["sister"].Log);
        Assert.Null(arrived.Npcs["sister"].Log);
    }

    [Fact]
    public void Memory_prompt_keeps_the_log_and_trims_the_oldest_lines()
    {
        Assert.Equal("", Observe.MemoryPrompt([]));
        Assert.Matches("WHAT YOU HAVE SEEN", Observe.MemoryPrompt(["Null says \"hello\""]));
        Assert.Matches("Null says \"hello\"", Observe.MemoryPrompt(["Null says \"hello\""]));
        var longLog = Enumerable.Range(0, 90).Select(index => $"line {index}").ToList();
        var prompt = Observe.MemoryPrompt(longLog);
        Assert.Matches("Earlier events omitted", prompt);
        Assert.DoesNotContain("line 0", prompt);
        Assert.Matches("line 89", prompt);
        var repaired = Observe.RepairLogs(new GameState
        {
            Npcs = new() { ["sister"] = new NpcRuntime { Log = null! } },
        });
        Assert.Empty(repaired.Npcs["sister"].Log);
    }

    [Fact]
    public void A_tape_from_before_Madam_Wick_still_finds_her()
    {
        var world = Support.Cartridge();
        var standing = WorldBuilder.InitialState(world);
        standing.Npcs.Remove("madam-wick");
        standing.RoomItems.Remove("glass-booth");
        standing.RoomId = "glass-booth";
        var looked = Engine.ApplyCommand(world, standing, "look");
        Assert.Matches("Madam Wick sits too straight", Support.Shown(looked));
        Assert.Equal(["crystal-ball"], looked.State.Npcs["madam-wick"].Inventory);
        Assert.Equal(
            ["Null comes into the Glass Booth.", "Null looks around."],
            looked.State.Npcs["madam-wick"].Log);
        Assert.Empty(looked.State.RoomItems["glass-booth"]);

        var market = WorldBuilder.InitialState(world);
        market.Npcs.Remove("madam-wick");
        var walked = Engine.ApplyCommand(world, market, "n");
        var west = Engine.ApplyCommand(world, walked.State, "w");
        Assert.Matches("Madam Wick", Support.Shown(west));
        Assert.Equal(["Null comes into the Glass Booth."], west.State.Npcs["madam-wick"].Log);

        var carrying = WorldBuilder.InitialState(world);
        carrying.Npcs.Remove("madam-wick");
        carrying.Inventory.Add("crystal-ball");
        carrying.RoomId = "lantern-market";
        var repaired = Observe.RepairLogs(carrying, world);
        Assert.Empty(repaired.Npcs["madam-wick"].Inventory);
        Assert.Empty(repaired.Npcs["madam-wick"].Log);
        var described = Engine.DescribeRoom(world, new GameState
        {
            Version = repaired.Version,
            Mode = repaired.Mode,
            RoomId = "glass-booth",
            Hp = repaired.Hp,
            MaxHp = repaired.MaxHp,
            Scrip = repaired.Scrip,
            Inventory = repaired.Inventory,
            Mind = repaired.Mind,
            Places = repaired.Places,
            Air = repaired.Air,
            Counters = repaired.Counters,
            Turns = repaired.Turns,
            Visited = repaired.Visited,
            Npcs = repaired.Npcs,
            RoomItems = repaired.RoomItems,
            PlayerLog = repaired.PlayerLog,
        });
        Assert.Matches("Madam Wick", string.Join('\n', described.Select(line => line.Text)));
    }

    [Fact]
    public async Task Coil_sees_the_dock_and_mare_sees_the_arrival()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        Assert.Equal(["Null comes into the Silt Dock."], state.Npcs["old-coil"].Log);
        Assert.Empty(state.Npcs["mare-voss"].Log);
        state = (await Harness.Play(world, state, "/take cable", Support.Offline())).State;
        state = (await Harness.Play(world, state, "/n", Support.Offline())).State;
        Assert.Equal(
            ["Null comes into the Silt Dock.", "Null takes frayed cable.", "Null goes north."],
            state.Npcs["old-coil"].Log);
        Assert.Equal(["Null comes into the Lantern Market."], state.Npcs["mare-voss"].Log);
        Assert.Empty(state.Npcs["sister-static"].Log);
        Assert.Equal(
            ["I come into the Silt Dock.", "I take the frayed cable.", "I go north.", "I come into the Lantern Market."],
            state.PlayerLog);
    }

    [Fact]
    public void The_engine_hands_over_a_gist_and_shows_what_changed()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var asked = Engine.ApplyCommand(world, state, "talk coil about ash");
        Assert.DoesNotContain(asked.Lines, line => line.Kind == "speech");
        Assert.NotNull(asked.Beats);
        Assert.Single(asked.Beats);
        Assert.Equal("old-coil", asked.Beats[0].NpcId);
        Assert.Equal("Null asks you about ash.", asked.Beats[0].Event);
        Assert.Matches("chapel", asked.Beats[0].Gist);
        Assert.Contains(asked.State.Npcs["old-coil"].Mind, item => item.Id == "told-ash");

        var traded = Engine.ApplyCommand(world, asked.State, "give stim to coil");
        Assert.DoesNotContain(traded.Lines, line => line.Kind == "speech");
        var shown = Support.Shown(traded);
        Assert.Matches("Old Coil takes the stim", shown);
        Assert.Matches("You receive glowcapsule", shown);
        Assert.Matches("glowcapsule", traded.Beats?[0].Gist ?? "");

        var unknown = Engine.ApplyCommand(world, state, "talk coil about weather");
        Assert.Matches("nothing special about weather", unknown.Beats?[0].Gist ?? "");
        Assert.Matches("Ask about", Support.Shown(unknown));
    }

    [Fact]
    public async Task The_voiced_reply_is_printed_and_logged()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        VoiceAsk? seen = null;
        var offline = Support.Offline();
        var result = await Harness.Play(world, state, "/talk coil about ash", new HarnessIo
        {
            Interpret = offline.Interpret,
            Role = offline.Role,
            Memory = offline.Memory,
            Voice = (_, _, ask, _) =>
            {
                seen = ask;
                return Task.FromResult(new AgentReply { Say = "Chapel. North of the market. Kneel.", Met = [] });
            },
        });
        Assert.NotNull(seen);
        Assert.Equal("old-coil", seen.NpcId);
        Assert.Null(seen.Utterance);
        var prompt = Harness.VoicePrompt(world, result.State, seen);
        Assert.Matches("YOU MUST GET ACROSS", prompt);
        Assert.Matches("coughing in the chapel radio", prompt);
        Assert.Matches("met must be an empty list", prompt);
        Assert.Matches("Old Coil: Chapel\\. North of the market\\. Kneel\\.", Support.Shown(result));
        Assert.Equal("I reply \"Chapel. North of the market. Kneel.\"", result.State.Npcs["old-coil"].Log[^1]);
    }

    [Fact]
    public async Task A_lost_reply_still_leaves_the_trade_done()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var offline = Support.Offline();
        var result = await Harness.Play(world, state, "/give stim to coil", new HarnessIo
        {
            Interpret = offline.Interpret,
            Role = offline.Role,
            Memory = offline.Memory,
            Voice = (_, _, _, _) => throw new InvalidOperationException("down"),
        });
        var shown = Support.Shown(result);
        Assert.Contains("glowcapsule", result.State.Inventory);
        Assert.Matches("You receive glowcapsule", shown);
        Assert.Matches("Old Coil's reply is lost in static", shown);
        Assert.DoesNotContain(result.State.Npcs["old-coil"].Log, entry => entry.StartsWith("I reply"));
    }

    [Fact]
    public async Task Free_speech_reaches_everyone_and_only_the_rule_gets_a_gist()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        state.RoomId = "smugglers-cut";
        state.Npcs["old-coil"].Mind.Add(new Inclination
        {
            Id = "told-ash",
            Line = "I told him ASH is coughing in the chapel radio, north of the market.",
        });
        var asks = new List<VoiceAsk>();
        var offline = Support.Offline();
        var result = await Harness.Play(world, state, "/say Coil sent me", new HarnessIo
        {
            Interpret = offline.Interpret,
            Role = offline.Role,
            Memory = offline.Memory,
            Voice = (_, _, ask, _) =>
            {
                asks.Add(ask);
                return Task.FromResult(new AgentReply { Say = "Walk.", Met = [] });
            },
        });
        Assert.Equal("down", result.State.Places["smugglers-cut"]["chain"]);
        Assert.All(asks, ask => Assert.Equal("Coil sent me", ask.Utterance));
        var pike = asks.First(ask => ask.NpcId == "pike");
        Assert.Matches("south door is open", pike.Beats[0].Gist);
        Assert.Matches("The way south is open", Support.Shown(result));
    }

    [Fact]
    public void No_prewritten_dialogue_is_left_in_the_cartridge()
    {
        var root = Path.Combine(Support.RepoRoot(), "public", "ash", "npcs");
        foreach (var folder in Directory.GetDirectories(root))
        {
            var id = Path.GetFileName(folder);
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(folder, "script.json")));
            var script = doc.RootElement;
            var rows = new List<JsonElement>();
            if (script.TryGetProperty("topics", out var topics) && topics.ValueKind == JsonValueKind.Object)
            {
                foreach (var topic in topics.EnumerateObject()) rows.Add(topic.Value);
            }
            void AddArray(string name)
            {
                if (script.TryGetProperty(name, out var list) && list.ValueKind == JsonValueKind.Array)
                {
                    foreach (var entry in list.EnumerateArray()) rows.Add(entry);
                }
            }
            AddArray("onTalk");
            AddArray("trades");
            AddArray("say");
            if (script.TryGetProperty("bribe", out var bribe) && bribe.ValueKind == JsonValueKind.Object) rows.Add(bribe);
            if (script.TryGetProperty("story", out var story) && story.ValueKind == JsonValueKind.Object) rows.Add(story);
            foreach (var row in rows)
            {
                Assert.False(row.TryGetProperty("say", out _), $"{id} still has a say line");
                Assert.False(row.TryGetProperty("already", out _) || row.TryGetProperty("elseSay", out _), $"{id} still has prose");
                Assert.True(row.TryGetProperty("gist", out var gist) && gist.ValueKind == JsonValueKind.String && gist.GetString()!.Trim().Length > 0, $"{id} has an empty gist");
            }
            var combat = script.GetProperty("combat");
            Assert.False(combat.TryGetProperty("refuse", out _), $"{id} still has a refuse line");
        }
    }
}
