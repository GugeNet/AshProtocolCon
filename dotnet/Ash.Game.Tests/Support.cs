using Ash.Game;

namespace Ash.Game.Tests;

static class Support
{
    public static string RepoRoot()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "public", "ash", "index.json"))) return dir.FullName;
                dir = dir.Parent;
            }
        }
        throw new InvalidOperationException("The cartridge was not found above the working directory.");
    }

    public static World Cartridge() => WorldBuilder.LoadCartridge(Path.Combine(RepoRoot(), "public", "ash"));

    public static HarnessIo Offline(Func<World, GameState, VoiceAsk, CancellationToken, Task<AgentReply>>? voice = null) => new()
    {
        Interpret = (_, _, _, _) => throw new InvalidOperationException("slash commands do not need the model"),
        Role = (_, _) => Task.FromResult<NpcRole?>(null),
        Memory = (_, _) => Task.FromResult(""),
        Voice = voice ?? ((_, _, ask, _) => Task.FromResult(new AgentReply
        {
            Say = string.Join(" ", ask.Beats.Select(beat => beat.Gist)),
            Met = [],
        })),
    };

    public static string Shown(CommandResult result) => string.Join('\n', result.Lines.Select(line => line.Text));

    public static void SameAction(GameAction actual, GameAction expected)
    {
        Assert.Equal(expected.Type, actual.Type);
        Assert.Equal(expected.Dir, actual.Dir);
        Assert.Equal(expected.Target, actual.Target);
        Assert.Equal(expected.Topic, actual.Topic);
        Assert.Equal(expected.Item, actual.Item);
        Assert.Equal(expected.Npc, actual.Npc);
        Assert.Equal(expected.Text, actual.Text);
        Assert.Equal(expected.Cmd, actual.Cmd);
        Assert.Equal(expected.Raw, actual.Raw);
    }
}
