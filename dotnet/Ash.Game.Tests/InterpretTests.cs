using Ash.Game;

namespace Ash.Game.Tests;

public class InterpretTests
{
    static List<string> Names(Scene scene) => Interpreter.ToolsFor(scene).Select(tool => tool.Name).ToList();

    static List<string>? EnumOf(Scene scene, string tool, string param)
    {
        var spec = Interpreter.ToolsFor(scene).First(entry => entry.Name == tool);
        return spec.Parameters[param];
    }

    static GameAction Run(Scene scene, string name, Dictionary<string, object?> args, string input = "x") =>
        Interpreter.CallToAction(new ToolCall { Name = name, Arguments = args }, scene, input);

    [Fact]
    public void The_room_publishes_only_useful_tools()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var dock = Interpreter.SceneOf(world, state);
        Assert.Contains("talk_to", Names(dock));
        Assert.Contains("take_item", Names(dock));
        Assert.DoesNotContain("ask_for_fortune", Names(dock));
        Assert.DoesNotContain("buy_item", Names(dock));
        Assert.Equal(["north", "east"], EnumOf(dock, "move", "direction"));
        Assert.Equal(["old-coil"], EnumOf(dock, "talk_to", "person"));
        Assert.Equal(["frayed-cable"], EnumOf(dock, "take_item", "item"));

        state.RoomId = "lantern-market";
        var market = Interpreter.SceneOf(world, state);
        Assert.Contains("buy_item", Names(market));
        Assert.Contains("breather", EnumOf(market, "buy_item", "item")!);

        state.RoomId = "glass-booth";
        var booth = Interpreter.SceneOf(world, state);
        Assert.Contains("ask_for_fortune", Names(booth));
        Assert.Equal(["madam-wick"], EnumOf(booth, "ask_for_fortune", "reader"));
        Assert.Contains("crystal-ball", EnumOf(booth, "take_item", "item")!);

        state.RoomId = "scrap-yard";
        Assert.DoesNotContain("insulated-gloves", Interpreter.SceneOf(world, state).Ground);
    }

    [Fact]
    public void Asking_what_the_ball_says_is_a_fortune()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        state.RoomId = "glass-booth";
        var scene = Interpreter.SceneOf(world, state);
        var tool = Interpreter.ToolsFor(scene).First(entry => entry.Name == "ask_for_fortune");
        Assert.Matches("what the crystal ball says", tool.Description);
        Support.SameAction(
            Interpreter.CallToAction(new ToolCall { Name = "ask_for_fortune", Arguments = new() { ["reader"] = "madam-wick" } }, scene, "x"),
            new GameAction { Type = "talk", Target = "madam-wick", Topic = "fortune" });
        Assert.Matches("holding crystal ball", Interpreter.InterpretPrompt(world, state, scene));
    }

    [Fact]
    public void Each_tool_call_becomes_an_action()
    {
        var world = Support.Cartridge();
        var dock = Interpreter.SceneOf(world, WorldBuilder.InitialState(world));
        Support.SameAction(Run(dock, "move", new() { ["direction"] = "north" }), new GameAction { Type = "go", Dir = "north" });
        Support.SameAction(Run(dock, "take_item", new() { ["item"] = "frayed-cable" }), new GameAction { Type = "take", Target = "frayed-cable" });
        Support.SameAction(
            Run(dock, "talk_to", new() { ["person"] = "old-coil", ["topic"] = "ash" }),
            new GameAction { Type = "talk", Target = "old-coil", Topic = "ash" });
        Support.SameAction(Run(dock, "talk_to", new() { ["person"] = "old-coil", ["topic"] = "" }), new GameAction { Type = "talk", Target = "old-coil" });
        Support.SameAction(
            Run(dock, "give_item", new() { ["item"] = "stim", ["person"] = "old-coil" }),
            new GameAction { Type = "give", Item = "stim", Npc = "old-coil" });
        Support.SameAction(Run(dock, "examine", new() { ["target"] = "self" }), new GameAction { Type = "examine", Target = "me" });
        Support.SameAction(Run(dock, "show_screen", new() { ["screen"] = "inventory" }), new GameAction { Type = "meta", Cmd = "inv" });
        Support.SameAction(Run(dock, "say", new() { ["words"] = "Coil sent me" }), new GameAction { Type = "say", Text = "Coil sent me" });
        Support.SameAction(Run(dock, "say", [], "  the word is ash "), new GameAction { Type = "say", Text = "the word is ash" });
    }

    [Fact]
    public void A_bad_call_names_the_valid_choices()
    {
        var dock = Interpreter.SceneOf(Support.Cartridge(), WorldBuilder.InitialState(Support.Cartridge()));
        void Bad(string name, Dictionary<string, object?> args) =>
            Assert.Throws<ToolError>(() => Run(dock, name, args));
        Bad("dance", []);
        Bad("buy_item", new() { ["item"] = "knife" });
        Bad("ask_for_fortune", new() { ["reader"] = "madam-wick" });
        Bad("take_item", new() { ["item"] = "protocol-key" });
        Bad("move", new() { ["direction"] = "south" });
        Bad("talk_to", new() { ["person"] = "pike" });
        Bad("move", []);
        var error = Assert.Throws<ToolError>(() => Run(dock, "talk_to", new() { ["person"] = "pike" }));
        Assert.Matches("Choose one of: old-coil", error.Message);
    }

    static List<ChatMessage> Copy(IReadOnlyList<ChatMessage> messages) =>
        messages.Select(message => new ChatMessage
        {
            Role = message.Role,
            Content = message.Content,
            ToolName = message.ToolName,
        }).ToList();

    [Fact]
    public async Task Interpret_runs_calls_in_order()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var sent = new List<(List<ChatMessage> Messages, int Tools)>();
        var actions = await Interpreter.Read(world, state, "grab the cable and head north", (tools, messages, _) =>
        {
            sent.Add((Copy(messages), tools.Count));
            return Task.FromResult(new ModelReply
            {
                Calls =
                [
                    new ToolCall { Name = "take_item", Arguments = new() { ["item"] = "frayed-cable" } },
                    new ToolCall { Name = "move", Arguments = Interpreter.ArgumentsFrom("{\"direction\":\"north\"}") },
                ],
            });
        });
        Assert.Single(sent);
        Assert.True(sent[0].Tools > 5);
        Assert.Equal("grab the cable and head north", sent[0].Messages[^1].Content);
        Assert.NotNull(actions);
        Assert.Equal(2, actions.Count);
        Support.SameAction(actions[0], new GameAction { Type = "take", Target = "frayed-cable" });
        Support.SameAction(actions[1], new GameAction { Type = "go", Dir = "north" });
    }

    [Fact]
    public async Task A_wrong_call_goes_back_once()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var replies = new Queue<ModelReply>([
            new ModelReply { Calls = [new ToolCall { Name = "talk_to", Arguments = new() { ["person"] = "mare-voss" } }] },
            new ModelReply { Calls = [new ToolCall { Name = "talk_to", Arguments = new() { ["person"] = "old-coil" } }] },
        ]);
        var sent = new List<List<ChatMessage>>();
        var actions = await Interpreter.Read(world, state, "talk to the old man", (_, messages, _) =>
        {
            sent.Add(Copy(messages));
            return Task.FromResult(replies.Dequeue());
        });
        Assert.Equal(2, sent.Count);
        var error = sent[1][^1];
        Assert.Equal("tool", error.Role);
        Assert.Equal("talk_to", error.ToolName);
        Assert.Matches("no person \"mare-voss\"", error.Content);
        Assert.NotNull(actions);
        Assert.Single(actions);
        Support.SameAction(actions[0], new GameAction { Type = "talk", Target = "old-coil" });
    }

    [Fact]
    public async Task Prose_is_nudged_once()
    {
        var world = Support.Cartridge();
        var state = WorldBuilder.InitialState(world);
        var replies = new Queue<string>(["You look around.", "Still prose."]);
        var sent = new List<List<ChatMessage>>();
        var actions = await Interpreter.Read(world, state, "hmm", (_, messages, _) =>
        {
            sent.Add(Copy(messages));
            return Task.FromResult(new ModelReply { Content = replies.Dequeue() });
        });
        Assert.Equal(2, sent.Count);
        Assert.Matches("Call one of the tools", sent[1][^1].Content);
        Assert.Null(actions);
    }
}
