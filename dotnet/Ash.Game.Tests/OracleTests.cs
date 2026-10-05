using Ash.Game;

namespace Ash.Game.Tests;

public class OracleTests
{
    static readonly ItemDef Ball = new()
    {
        Id = "crystal-ball",
        Name = "crystal ball",
        Aliases = ["crystal ball", "ball", "crystal", "orb"],
        Kind = "oracle",
        Text = "Glass.",
    };

    static NpcScript Person(string id, string name, params string[] aliases) => new()
    {
        Id = id,
        Name = name,
        Aliases = [.. aliases],
        Presence = $"{name} is here.",
        Greeting = "Hello.",
        Combat = new CombatDef { Damage = 1, OnDeathSay = $"{name} falls." },
    };

    static NpcState Body(string id, params string[] inventory) => new()
    {
        Id = id,
        Alive = true,
        Hp = 8,
        MaxHp = 8,
        Mood = "odd",
        Inventory = [.. inventory],
    };

    static (World World, GameState State) Booth()
    {
        var booth = new RoomDef
        {
            Id = "glass-booth",
            Name = "Glass Booth",
            Code = "GLS",
            Exits = new() { ["east"] = "lane" },
            Descriptions = [new RoomDescription { Text = "A booth." }],
            Npcs = ["madam-wick", "mare-voss"],
        };
        var lane = new RoomDef
        {
            Id = "lane",
            Name = "Lane",
            Code = "LAN",
            X = 1,
            Exits = new() { ["west"] = "glass-booth" },
            Descriptions = [new RoomDescription { Text = "A lane." }],
        };
        var world = WorldBuilder.Create(
            [booth, lane],
            [Person("madam-wick", "Madam Wick", "wick", "madam"), Person("mare-voss", "Mare Voss", "mare")],
            [Body("madam-wick", "crystal-ball"), Body("mare-voss")],
            [Ball],
            "glass-booth");
        return (world, WorldBuilder.InitialState(world));
    }

    static OracleIo Io(
        Func<string, CancellationToken, Task<Reading>> read,
        Func<string, string, Reading, CancellationToken, Task<string>>? whisper = null,
        Func<World, GameState, string, string, CancellationToken, Task<string>>? cryptic = null,
        Func<IReadOnlyList<string>, string>? pick = null) => new()
    {
        Prompt = "You are the glass.",
        Read = read,
        Whisper = whisper ?? ((_, _, _, _) => Task.FromResult("He waited on the dock.")),
        Cryptic = cryptic ?? ((_, _, _, _, _) => Task.FromResult("Your boots remember a room you have not named.")),
        Pick = pick ?? (ids => ids[0]),
    };

    [Fact]
    public async Task A_fortune_reads_Null_and_he_hears_the_ball()
    {
        var (world, state) = Booth();
        Assert.Equal([Journal.PlayerId, "mare-voss"], Oracle.PeopleBeside(world, state, "madam-wick"));
        Assert.Equal(["madam-wick", "mare-voss"], Oracle.PeopleBeside(world, state, Journal.PlayerId));

        var asked = Engine.ApplyCommand(world, state, "ask wick for a fortune");
        Assert.Equal("madam-wick", asked.Consult?.Activator);
        Assert.Equal("crystal-ball", asked.Consult?.ItemId);
        Assert.Equal(Journal.PlayerId, asked.Consult?.Subject);
        var reads = new List<string>();
        var heardByWick = "";
        var told = await Oracle.Consult(world, asked, new OracleIo
        {
            Prompt = "You are the glass.",
            Pick = _ => "mare-voss",
            Read = (id, _) =>
            {
                reads.Add(id);
                return Task.FromResult(new Reading { Name = "Null", Memory = "I went to the dock.", Log = "I wait." });
            },
            Whisper = (_, subject, reading, _) =>
            {
                Assert.Equal("Null", subject);
                Assert.Matches("dock", reading.Memory);
                return Task.FromResult("He waited on the dock.");
            },
            Cryptic = (_, _, _, whisper, _) =>
            {
                heardByWick = whisper;
                return Task.FromResult("Docks keep people, receipt. Move before it keeps you.");
            },
        });
        Assert.Equal([Journal.PlayerId], reads);
        Assert.Equal("He waited on the dock.", heardByWick);
        var shown = Support.Shown(told);
        Assert.Matches("The crystal ball whispers, \"He waited on the dock\\.\"", shown);
        Assert.Matches("Madam Wick: Docks keep people, receipt", shown);
        Assert.Contains(told.State.Npcs["madam-wick"].Log, entry => entry.Contains("He waited on the dock."));
        Assert.Contains(told.State.PlayerLog, entry => entry.Contains("He waited on the dock."));
        Assert.DoesNotContain(told.State.Npcs["mare-voss"].Log, entry => entry.Contains("waited on the dock"));
        Assert.Contains(told.State.Npcs["mare-voss"].Log, entry => entry.Contains("Docks keep people"));
        Assert.Contains(told.State.PlayerLog, entry => entry.Contains("I talk to Madam Wick about fortune."));
    }

    [Fact]
    public async Task Using_the_ball_shows_the_whisper_and_leaves_the_subject_untold()
    {
        var (world, state) = Booth();
        state.Inventory.Add("crystal-ball");
        var used = Engine.ApplyCommand(world, state, "use crystal ball");
        Assert.Equal(Journal.PlayerId, used.Consult?.Activator);
        var told = await Oracle.Consult(world, used, Io(
            (_, _) => Task.FromResult(new Reading { Name = "Madam Wick", Memory = "", Log = "Null comes into the Glass Booth." }),
            whisper: (_, _, _, _) => Task.FromResult("She argued with Tuesday."),
            pick: _ => "madam-wick"));
        Assert.Matches("The crystal ball whispers, \"She argued with Tuesday\\.\"", Support.Shown(told));
        Assert.Contains("The crystal ball whispers \"She argued with Tuesday.\"", told.State.PlayerLog);
        Assert.DoesNotContain(told.State.Npcs["madam-wick"].Log, entry => entry.Contains("Tuesday"));
        Assert.DoesNotContain(told.State.Npcs["mare-voss"].Log, entry => entry.Contains("Tuesday"));
    }

    [Fact]
    public async Task The_glass_stays_dark_or_empty()
    {
        var (world, state) = Booth();
        state.Inventory.Add("crystal-ball");
        state.RoomId = "lane";
        var alone = Engine.ApplyCommand(world, state, "use orb");
        var reads = 0;
        var dark = await Oracle.Consult(world, alone, Io((_, _) =>
        {
            reads += 1;
            return Task.FromResult(new Reading { Name = "Null", Memory = "x", Log = "y" });
        }));
        Assert.Equal(0, reads);
        Assert.Matches("nobody else", Support.Shown(dark));

        var (again, fresh) = Booth();
        fresh.Inventory.Add("crystal-ball");
        var used = Engine.ApplyCommand(again, fresh, "use ball");
        var whispered = 0;
        var empty = await Oracle.Consult(again, used, Io(
            (_, _) => Task.FromResult(new Reading { Name = "Madam Wick", Memory = "  ", Log = "" }),
            whisper: (_, _, _, _) =>
            {
                whispered += 1;
                return Task.FromResult("Invented.");
            }));
        Assert.Equal(0, whispered);
        Assert.Matches("Nothing is written", Support.Shown(empty));
        Assert.DoesNotContain(empty.State.PlayerLog, entry => entry.Contains("Invented"));
    }

    [Fact]
    public async Task Null_can_take_the_ball_and_a_fortune_needs_it_in_her_hands()
    {
        var (world, state) = Booth();
        var taken = await Harness.Play(world, state, "/take the crystal ball", Support.Offline());
        Assert.Contains("crystal-ball", taken.State.Inventory);
        Assert.DoesNotContain("crystal-ball", taken.State.Npcs["madam-wick"].Inventory);
        Assert.Contains(taken.State.PlayerLog, entry => entry.Contains("I take the crystal ball from Madam Wick."));
        Assert.Contains(taken.State.Npcs["madam-wick"].Log, entry => entry.Contains("from me"));

        var refused = Engine.ApplyCommand(world, taken.State, "ask madam for a fortune");
        Assert.Null(refused.Consult);
        Assert.Matches("no crystal ball", Support.Shown(refused));
        Assert.Matches("palms", refused.Beats?[0].Gist ?? "");

        var returned = Engine.ApplyCommand(world, refused.State, "give ball to wick");
        Assert.DoesNotContain("crystal-ball", returned.State.Inventory);
        Assert.Contains("crystal-ball", returned.State.Npcs["madam-wick"].Inventory);
        var ready = Engine.ApplyCommand(world, returned.State, "talk wick about fortune");
        Assert.Equal("madam-wick", ready.Consult?.Activator);
    }

    [Fact]
    public async Task A_cut_off_reading_shows_her_words()
    {
        var (world, state) = Booth();
        var asked = Engine.ApplyCommand(world, state, "ask wick for a fortune");
        var told = await Oracle.Consult(world, asked, Io(
            (_, _) => Task.FromResult(new Reading { Name = "Null", Memory = "I went to the dock.", Log = "" }),
            cryptic: (_, _, _, _, _) => Task.FromResult("{ \"say\": \"The dock remembers you, receipt. It wants you back, and it should not get")));
        var shown = Support.Shown(told);
        Assert.Matches("Madam Wick: The dock remembers you, receipt\\.", shown);
        Assert.DoesNotContain("{", shown);
        Assert.DoesNotContain("should not get", shown);
    }

    [Fact]
    public async Task A_parroted_cue_is_dropped()
    {
        var (world, state) = Booth();
        var asked = Engine.ApplyCommand(world, state, "ask wick for a fortune");
        var told = await Oracle.Consult(world, asked, Io(
            (_, _) => Task.FromResult(new Reading { Name = "Null", Memory = "I went to the dock.", Log = "" }),
            cryptic: (_, _, _, _, _) => Task.FromResult(
                "The ball whispered about Null: \"He waited on the dock.\" Now tell Null what you make of it.")));
        var shown = Support.Shown(told);
        Assert.Matches("The crystal ball whispers, \"He waited on the dock\\.\"", shown);
        Assert.DoesNotContain("Madam Wick:", shown);
    }
}
