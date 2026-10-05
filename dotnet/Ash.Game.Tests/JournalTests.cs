using System.Text.Json;
using Ash.Game;

namespace Ash.Game.Tests;

public class JournalTests
{
    [Fact]
    public void Files_use_the_persons_name()
    {
        Assert.Equal("Old Coil", Journal.PersonFileName("Old Coil"));
        Assert.Equal("the Archivist", Journal.PersonFileName("  the Archivist  "));
        Assert.Equal("abc", Journal.PersonFileName("a/b\\c"));
        Assert.Equal("unnamed", Journal.PersonFileName(".."));
        Assert.Equal("dot", Journal.PersonFileName("dot."));
        Assert.Equal("Old Coil.log", Journal.LogFileName("Old Coil"));
        Assert.Equal("Mare Voss.memory.json", Journal.MemoryFileName("Mare Voss"));
        Assert.Equal("Old Coil.memory.txt", Journal.LegacyMemoryFileName("Old Coil"));
    }

    [Fact]
    public void Merge_keeps_the_marker_and_appends_new_lines()
    {
        var marked = string.Join('\n', ["Null comes into the Silt Dock.", Journal.HypnosMarker, "Null waits."]) + "\n";
        var again = Journal.MergeJournal(marked, ["Null comes into the Silt Dock.", "Null waits.", "Null goes north."]);
        Assert.Equal(string.Join('\n', ["Null comes into the Silt Dock.", Journal.HypnosMarker, "Null waits.", "Null goes north."]) + "\n", again);
        Assert.Equal(again, Journal.MergeJournal(again, ["Null comes into the Silt Dock.", "Null waits.", "Null goes north."]));
        Assert.Equal("", Journal.MergeJournal(marked, []));
        Assert.Equal("Null comes into the Chapel.\n", Journal.MergeJournal(marked, ["Null comes into the Chapel."]));
    }

    [Fact]
    public void Memory_file_becomes_the_memory_section()
    {
        Assert.Equal("", Observe.MemoryFileSection("  "));
        var section = Observe.MemoryFileSection("You remember the dock.\r\nNull took the cable.");
        Assert.Matches("^MEMORY\n", section);
        Assert.EndsWith("You remember the dock.\nNull took the cable.", section);
    }

    [Fact]
    public void Journal_lists_every_person()
    {
        var script = new NpcScript
        {
            Id = "sister",
            Name = "Sister Static",
            Aliases = ["sister"],
            Presence = "Sister is here.",
            Greeting = "Hello.",
            Combat = new CombatDef { Damage = 1, OnDeathSay = "Sister falls." },
        };
        var body = new NpcState { Id = "sister", Alive = true, Hp = 8, MaxHp = 8, Mood = "calm" };
        var room = new RoomDef
        {
            Id = "chapel",
            Name = "Chapel",
            Code = "CHP",
            Descriptions = [new RoomDescription { Text = "Chapel." }],
            Npcs = ["sister"],
        };
        var world = WorldBuilder.Create([room], [script], [body], [], "chapel");
        var game = WorldBuilder.InitialState(world);
        game.Npcs["sister"].Log.Add("Null says \"hello\"");
        var people = Journal.People(world, game);
        Assert.Equal(["sister", "null"], people.Select(person => person.Id));
        Assert.Equal(["Sister Static", "Null"], people.Select(person => person.Name));
        Assert.Equal(["Null comes into the Chapel.", "Null says \"hello\""], people[0].Log);
        Assert.Equal(["I come into the Chapel."], people[1].Log);
    }

    [Fact]
    public void Json_memory_wins_and_a_text_file_still_reads()
    {
        var dir = Directory.CreateTempSubdirectory("ash-journal-");
        try
        {
            File.WriteAllText(Path.Combine(dir.FullName, "Old Coil.memory.txt"), "from the text file\n");
            Assert.Equal("from the text file\n", Journal.ReadMemory(dir.FullName, "Old Coil"));
            File.WriteAllText(
                Path.Combine(dir.FullName, "Old Coil.memory.json"),
                JsonSerializer.Serialize(new MemoryFile { Memory = "from the json file" }));
            Assert.Equal("from the json file", Journal.ReadMemory(dir.FullName, "Old Coil"));
        }
        finally
        {
            dir.Delete(true);
        }
    }
}
