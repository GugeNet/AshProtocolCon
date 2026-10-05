using Ash.Game;

namespace Ash.Game.Tests;

public class HarnessTests
{
    static GameState ArchivistState(List<Inclination>? mind = null) => new()
    {
        Version = 2,
        Mode = "play",
        RoomId = "silt-dock",
        Hp = 14,
        MaxHp = 14,
        Scrip = 24,
        Inventory = ["shard-a", "shard-b"],
        Mind = mind ?? [new Inclination { Id = "hymn", Line = "The chapel asked what remains when the fire is spent. The word sits behind my teeth." }],
        Places = new() { ["protocol-gate"] = new() { ["seal"] = "shut" } },
        Turns = 1,
        Visited = ["silt-dock"],
    };

    static NpcRole Archivist() => new()
    {
        Id = "archivist",
        Prompt = "lock",
        Objectives =
        [
            new NpcObjective
            {
                Id = "open-the-seal",
                Goal = "the chapel's answer, with both metals",
                UtteranceIncludes = "ash",
                When = new Cond { Mind = "hymn" },
                Done = new Cond { Place = "seal", Is = "open", Room = "protocol-gate" },
                RequiresAllItems = ["shard-a", "shard-b"],
                ConsumeItems = ["shard-a", "shard-b"],
                GrantItems = ["protocol-key"],
                Change = [new Change { Place = "seal", Is = "open", Room = "protocol-gate" }],
            },
        ],
    };

    static (World World, GameState State) Pocket()
    {
        var filter = new ItemDef
        {
            Id = "clean-filter",
            Name = "clean filter",
            Aliases = ["filter", "clean filter"],
            Kind = "junk",
            Value = 5,
            Text = "A filter that has not yet learned the ash.",
        };
        var lens = new ItemDef
        {
            Id = "optic-lens",
            Name = "optic lens",
            Aliases = ["lens", "optic", "eye"],
            Kind = "gear",
            Value = 12,
            Text = "An intact lens.",
        };
        var room = new RoomDef
        {
            Id = "glass-orchard",
            Name = "Glass Orchard",
            Code = "ORC",
            Descriptions = [new RoomDescription { Text = "Glass trees." }],
            Ground = [new GroundItem { Id = "clean-filter" }, new GroundItem { Id = "optic-lens" }],
        };
        var world = WorldBuilder.Create([room], [], [], [filter, lens], room.Id);
        return (world, WorldBuilder.InitialState(world));
    }

    [Fact]
    public void Slash_line_runs_as_written()
    {
        Support.SameAction(Engine.ParseCommand("/go north"), new GameAction { Type = "go", Dir = "north" });
        Support.SameAction(Engine.ParseCommand("/n"), new GameAction { Type = "go", Dir = "north" });
        Support.SameAction(Engine.ParseCommand("/take the clean filter"), new GameAction { Type = "take", Target = "the clean filter" });
        Support.SameAction(Engine.ParseCommand("/say The Chapel is north"), new GameAction { Type = "say", Text = "The Chapel is north" });
        Support.SameAction(Engine.ParseCommand("/look"), new GameAction { Type = "meta", Cmd = "look" });
        Support.SameAction(Engine.ParseCommand("/i"), new GameAction { Type = "meta", Cmd = "inv" });
        Support.SameAction(Engine.ParseCommand("/frobnicate"), new GameAction { Type = "meta", Cmd = "frobnicate" });
        Support.SameAction(Engine.ParseCommand("/coil sent me"), new GameAction { Type = "unknown", Raw = "coil sent me" });
        Assert.True(Engine.IsCartridgeMeta("/save"));
        Assert.False(Engine.IsCartridgeMeta("save"));
        Assert.False(Engine.IsCartridgeMeta("/go north"));
    }

    [Fact]
    public void Objective_closes_only_when_evidence_holds()
    {
        var here = ArchivistState();
        var role = Archivist();
        Assert.True(Harness.EvidenceHolds(here, role.Objectives[0], "the word is ash"));
        Assert.False(Harness.EvidenceHolds(here, role.Objectives[0], "open the gate"));

        var refused = Harness.AcceptMarks(here, role, "open the gate", ["open-the-seal", "lower-the-chain"]);
        Assert.Empty(refused.Flipped);
        Assert.Equal("shut", refused.State.Places["protocol-gate"]["seal"]);
        Assert.Equal(["shard-a", "shard-b"], refused.State.Inventory);

        var opened = Harness.AcceptMarks(here, role, "the word is ash", ["open-the-seal"]);
        Assert.Equal(["open-the-seal"], opened.Flipped.Select(objective => objective.Id));
        Assert.Equal("open", opened.State.Places["protocol-gate"]["seal"]);
        Assert.Equal(["protocol-key"], opened.State.Inventory);

        var again = Harness.AcceptMarks(opened.State, role, "ash", ["open-the-seal"]);
        Assert.Empty(again.Flipped);
        Assert.Equal(["protocol-key"], again.State.Inventory);
    }

    [Fact]
    public async Task Slash_take_puts_the_item_in_hand()
    {
        var (world, state) = Pocket();
        var plain = await Harness.Play(world, state, "/take clean filter", Support.Offline());
        Assert.Contains("clean-filter", plain.State.Inventory);
        Assert.DoesNotContain("clean-filter", plain.State.RoomItems["glass-orchard"]);
        Assert.DoesNotContain("clean-filter", state.Inventory);
        Assert.Matches("Taken: clean filter", Support.Shown(plain));

        var article = await Harness.Play(world, state, "/take the clean filter", Support.Offline());
        Assert.Contains("clean-filter", article.State.Inventory);
        Assert.DoesNotContain("clean-filter", article.State.RoomItems["glass-orchard"]);
        Assert.Matches("Taken: clean filter", Support.Shown(article));
    }

    [Fact]
    public async Task Plain_input_runs_the_interpreter_action()
    {
        var (world, state) = Pocket();
        var heard = "";
        var io = Support.Offline();
        io = new HarnessIo
        {
            Interpret = (_, _, input, _) =>
            {
                heard = input;
                return Task.FromResult<List<GameAction>?>([new GameAction { Type = "take", Target = "clean-filter" }]);
            },
            Role = io.Role,
            Memory = io.Memory,
            Voice = io.Voice,
        };
        var result = await Harness.Play(world, state, "pocket that filter thing", io);
        Assert.Equal("pocket that filter thing", heard);
        Assert.Contains("clean-filter", result.State.Inventory);
        Assert.Contains("optic-lens", result.State.RoomItems["glass-orchard"]);
        Assert.Equal(state.Turns + 1, result.State.Turns);
    }

    [Fact]
    public async Task Several_calls_run_in_order()
    {
        var (world, state) = Pocket();
        var io = Support.Offline();
        var result = await Harness.Play(world, state, "take the filter and the lens", new HarnessIo
        {
            Interpret = (_, _, _, _) => Task.FromResult<List<GameAction>?>([
                new GameAction { Type = "take", Target = "clean-filter" },
                new GameAction { Type = "take", Target = "optic-lens" },
            ]),
            Role = io.Role,
            Memory = io.Memory,
            Voice = io.Voice,
        });
        Assert.Contains("clean-filter", result.State.Inventory);
        Assert.Contains("optic-lens", result.State.Inventory);
        Assert.Equal(state.Turns + 2, result.State.Turns);
        Assert.Matches("Taken: clean filter[\\s\\S]*Taken: optic lens", Support.Shown(result));
    }

    [Fact]
    public async Task Unreadable_line_costs_no_turn()
    {
        var (world, state) = Pocket();
        var io = Support.Offline();
        Func<World, GameState, string, CancellationToken, Task<List<GameAction>?>>[] readers =
        [
            (_, _, _, _) => Task.FromResult<List<GameAction>?>(null),
            (_, _, _, _) => throw new InvalidOperationException("down"),
        ];
        foreach (var interpret in readers)
        {
            var result = await Harness.Play(world, state, "pick up the filter", new HarnessIo
            {
                Interpret = interpret,
                Role = io.Role,
                Memory = io.Memory,
                Voice = io.Voice,
            });
            Assert.Same(state, result.State);
            Assert.Equal(state.Turns, result.State.Turns);
            Assert.Contains("Slash commands", Support.Shown(result));
        }
    }

    [Fact]
    public void Come_into_possession_moves_the_ground_item()
    {
        var (world, state) = Pocket();
        var next = JsonOpts.Clone(state);
        var owned = Engine.ComeIntoPossession(world, next, "clean-filter");
        Assert.True(owned.Ok);
        Assert.Equal("clean-filter", owned.State.Inventory[^1]);
        Assert.DoesNotContain("clean-filter", owned.State.RoomItems["glass-orchard"]);
        Assert.Contains("clean-filter", state.RoomItems["glass-orchard"]);
    }

    [Fact]
    public void Seal_stays_shut_without_the_hymn()
    {
        var blind = ArchivistState([]);
        var closed = Harness.AcceptMarks(blind, Archivist(), "ash", ["open-the-seal"]);
        Assert.Empty(closed.Flipped);
        Assert.Equal("shut", closed.State.Places["protocol-gate"]["seal"]);
        Assert.Contains("shard-a", closed.State.Inventory);
    }
}
