using Ash.Game;

namespace Ash.Game.Tests;

public class WalkthroughTests
{
    [Fact]
    public void Cartridge_is_a_connected_maze()
    {
        var root = Path.Combine(Support.RepoRoot(), "public", "ash");
        var diskRooms = Directory.GetFiles(Path.Combine(root, "rooms"), "*.json");
        Assert.Equal(21, diskRooms.Length);
        var world = WorldBuilder.LoadCartridge(root);
        Assert.Equal(21, world.Rooms.Count);
        Assert.True(world.Rooms["spire-core"].Win);
        var seen = new HashSet<string>();
        var queue = new Stack<string>();
        queue.Push(world.Start);
        while (queue.Count > 0)
        {
            var id = queue.Pop();
            if (!seen.Add(id)) continue;
            foreach (var next in world.Rooms[id].Exits.Values)
            {
                if (!string.IsNullOrEmpty(next)) queue.Push(next);
            }
        }
        Assert.Equal(21, seen.Count);
        Assert.Equal("glass-booth", world.Rooms["lantern-market"].Exits["west"]);
        Assert.Equal("lantern-market", world.Rooms["glass-booth"].Exits["east"]);
        Assert.Equal(["crystal-ball"], world.Npcs["madam-wick"].State.Inventory);
        Assert.Equal("oracle", world.Items["crystal-ball"].Kind);
        foreach (var id in world.Npcs.Keys)
        {
            var folder = Path.Combine(root, "npcs", id);
            Assert.True(File.Exists(Path.Combine(folder, "script.json")));
            Assert.True(File.Exists(Path.Combine(folder, "state.json")));
        }
    }

    [Fact]
    public async Task Pacifist_route_reaches_the_spire()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        string[] commands =
        [
            "take cable", "talk coil about ash", "tell coil a story", "give stim to coil",
            "n", "sell cable", "buy breather", "n", "listen", "s", "e", "n",
            "take lens", "take slag", "take filter", "s", "w", "sell slag", "buy knife",
            "e", "n", "e", "listen", "e", "say cinder", "e", "talk ash",
            "w", "w", "w", "s", "w", "s", "e", "e", "say coil sent me", "s",
            "search", "e", "e", "sell lens", "buy wafer", "w", "give knife to razor",
            "s", "s", "say ash", "s",
        ];
        foreach (var command in commands)
        {
            var result = await Harness.Play(world, state, $"/{command}", Support.Offline());
            state = result.State;
            if (state.Mode == "dead")
            {
                Assert.Fail($"died on \"{command}\": {Support.Shown(result)}");
            }
        }
        Assert.Equal("won", state.Mode);
        Assert.Equal("spire-core", state.RoomId);
        Assert.True(state.Visited.Count >= 16);
        Assert.Contains("protocol-key", state.Inventory);
        Assert.Contains(state.Mind, item => item.Id == "hymn");
        Assert.Equal("open", state.Places["protocol-gate"]["seal"]);
    }

    [Fact]
    public void Shortcuts_stay_shut()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var result = Engine.ApplyCommand(world, state, "e");
        Assert.Equal("flooded-underpass", result.State.RoomId);
        result = Engine.ApplyCommand(world, result.State, "e");
        Assert.Matches("(?i)breather", Support.Shown(result));
        Assert.Equal("flooded-underpass", result.State.RoomId);

        state = WorldBuilder.InitialState(world);
        state = Engine.ApplyCommand(world, state, "n").State;
        state = Engine.ApplyCommand(world, state, "e").State;
        state = Engine.ApplyCommand(world, state, "e").State;
        state = Engine.ApplyCommand(world, state, "s").State;
        result = Engine.ApplyCommand(world, state, "s");
        Assert.Equal("smugglers-cut", result.State.RoomId);
        Assert.Matches("Pike|paid", Support.Shown(result));

        state.Places["combat-pit"]["stair"] = "clear";
        state.RoomId = "combat-pit";
        result = Engine.ApplyCommand(world, state, "s");
        Assert.Equal("combat-pit", result.State.RoomId);
        Assert.Matches("(?i)cipher", Support.Shown(result));
    }

    [Fact]
    public void Version_one_flags_become_world_facts()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        state.Version = 1;
        state.Flags = new Dictionary<string, bool>
        {
            ["hymn_heard"] = true,
            ["password_known"] = true,
            ["gate_open"] = true,
            ["pike_passed"] = true,
            ["ferryman_paid"] = true,
            ["kite_passed"] = true,
            ["razor_passed"] = true,
            ["shard_a_found"] = true,
            ["heard_coil_ash"] = true,
            ["coil_traded"] = true,
            ["coil_story"] = true,
            ["heard_sister_ash"] = true,
            ["cipher_got"] = true,
        };
        Facts.EnsureState(state, world);
        Assert.Equal(2, state.Version);
        Assert.Null(state.Flags);
        Assert.Contains(state.Mind, item => item.Id == "hymn");
        Assert.Contains("cinder", state.Air);
        Assert.Equal("open", state.Places["protocol-gate"]["seal"]);
        Assert.Equal("down", state.Places["smugglers-cut"]["chain"]);
        Assert.Equal("loose", state.Places["black-canal"]["skiff"]);
        Assert.Equal("open", state.Places["watchtower"]["hatch"]);
        Assert.Equal("clear", state.Places["combat-pit"]["stair"]);
        Assert.Equal("empty", state.Places["ash-well"]["cache"]);
        Assert.Contains(state.Npcs["old-coil"].Mind, item => item.Id == "told-ash");
        Assert.Contains(state.Npcs["old-coil"].Mind, item => item.Id == "traded-light");
        Assert.Contains(state.Npcs["old-coil"].Mind, item => item.Id == "paid-story");
        Assert.Contains(state.Npcs["sister-static"].Mind, item => item.Id == "saved-the-word");
        Assert.Contains(state.Npcs["ash-fragment"].Mind, item => item.Id == "gave-tape");
    }

    [Fact]
    public void A_killing_blow_leaves_the_previous_moment()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        state.RoomId = "scrap-yard";
        state.Hp = 1;
        var result = Engine.ApplyCommand(world, state, "attack drone");
        Assert.Equal("dead", result.State.Mode);
        Assert.Equal("play", state.Mode);
        Assert.Equal(1, state.Hp);
    }
}
