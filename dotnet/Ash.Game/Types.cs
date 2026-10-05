namespace Ash.Game;

public static class Dirs
{
    public static readonly string[] All = ["north", "south", "east", "west"];
}

public sealed class Fact
{
    public string? Carrying { get; set; }
    public string? HeldBy { get; set; }
    public string? Item { get; set; }
    public string? Recalls { get; set; }
    public string? Npc { get; set; }
    public string? Mind { get; set; }
    public string? Place { get; set; }
    public string? Is { get; set; }
    public string? Room { get; set; }
    public string? Wave { get; set; }
    public string? Gone { get; set; }
}

public sealed class Cond
{
    public List<Fact>? All { get; set; }
    public List<Fact>? Any { get; set; }
    public string? Carrying { get; set; }
    public string? HeldBy { get; set; }
    public string? Item { get; set; }
    public string? Recalls { get; set; }
    public string? Npc { get; set; }
    public string? Mind { get; set; }
    public string? Place { get; set; }
    public string? Is { get; set; }
    public string? Room { get; set; }
    public string? Wave { get; set; }
    public string? Gone { get; set; }

    public bool IsWhen => All is not null || Any is not null;

    public Fact ToFact() => new()
    {
        Carrying = Carrying,
        HeldBy = HeldBy,
        Item = Item,
        Recalls = Recalls,
        Npc = Npc,
        Mind = Mind,
        Place = Place,
        Is = Is,
        Room = Room,
        Wave = Wave,
        Gone = Gone,
    };
}

public sealed class Change
{
    public string? Remember { get; set; }
    public string? Line { get; set; }
    public string? Recall { get; set; }
    public string? Npc { get; set; }
    public string? Place { get; set; }
    public string? Is { get; set; }
    public string? Room { get; set; }
    public string? Wave { get; set; }
}

public sealed class Inclination
{
    public string Id { get; set; } = "";
    public string Line { get; set; } = "";
}

public sealed class ItemDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Aliases { get; set; } = [];
    public string Kind { get; set; } = "";
    public int Value { get; set; }
    public int? Damage { get; set; }
    public int? Heal { get; set; }
    public string Text { get; set; } = "";
    public string? UseText { get; set; }
    public Cond? SellWhen { get; set; }
}

public sealed class GroundItem
{
    public string Id { get; set; } = "";
    public Cond? HiddenUntil { get; set; }
}

public sealed class Obstacle
{
    public string Dir { get; set; } = "";
    public Cond? When { get; set; }
    public string Fail { get; set; } = "";
    public string Pass { get; set; } = "";
}

public sealed class ListenStep
{
    public int? At { get; set; }
    public string? RequiresItem { get; set; }
    public List<Change>? Change { get; set; }
    public string Say { get; set; } = "";
}

public sealed class ListenAction
{
    public string? Counter { get; set; }
    public List<ListenStep> Steps { get; set; } = [];
}

public sealed class SearchAction
{
    public Cond? When { get; set; }
    public Cond? Done { get; set; }
    public string Fail { get; set; } = "";
    public List<string>? GrantItems { get; set; }
    public int? GrantScrip { get; set; }
    public List<Change>? Change { get; set; }
    public string Say { get; set; } = "";
    public string Already { get; set; } = "";
}

public sealed class RoomDescription
{
    public Cond? When { get; set; }
    public Cond? Unless { get; set; }
    public string Text { get; set; } = "";
}

public sealed class RoomDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Code { get; set; } = "";
    public int X { get; set; }
    public int Y { get; set; }
    public Dictionary<string, string> Exits { get; set; } = [];
    public Dictionary<string, string>? Fixtures { get; set; }
    public List<RoomDescription> Descriptions { get; set; } = [];
    public List<GroundItem> Ground { get; set; } = [];
    public List<string> Npcs { get; set; } = [];
    public List<Obstacle> Obstacles { get; set; } = [];
    public ListenAction? OnListen { get; set; }
    public SearchAction? OnSearch { get; set; }
    public bool? Win { get; set; }
}

public sealed class TalkRule
{
    public Cond? When { get; set; }
    public string? RequiresItem { get; set; }
    public string? TakeFromSelf { get; set; }
    public List<Change>? Change { get; set; }
    public List<string>? GrantItems { get; set; }
    public string Gist { get; set; } = "";
}

public sealed class Topic
{
    public string Gist { get; set; } = "";
    public List<Change>? Change { get; set; }
}

public sealed class Trade
{
    public string Give { get; set; } = "";
    public string? Receive { get; set; }
    public Cond? Once { get; set; }
    public List<Change>? Change { get; set; }
    public string Gist { get; set; } = "";
}

public sealed class Bribe
{
    public int Cost { get; set; }
    public Cond? Done { get; set; }
    public bool? Heal { get; set; }
    public List<Change>? Change { get; set; }
    public string Gist { get; set; } = "";
    public string? AlreadyGist { get; set; }
}

public sealed class Story
{
    public Cond? When { get; set; }
    public Cond? Done { get; set; }
    public int? GrantScrip { get; set; }
    public List<Change>? Change { get; set; }
    public string Gist { get; set; } = "";
    public string ElseGist { get; set; } = "";
    public string? AlreadyGist { get; set; }
}

public sealed class SayRule
{
    public string Includes { get; set; } = "";
    public Cond? When { get; set; }
    public List<string>? RequiresAllItems { get; set; }
    public List<Change>? Change { get; set; }
    public List<string>? ConsumeItems { get; set; }
    public List<string>? GrantItems { get; set; }
    public string Gist { get; set; } = "";
}

public sealed class ShopDef
{
    public List<string> Sells { get; set; } = [];
    public List<string> Buys { get; set; } = [];
}

public sealed class CombatDef
{
    public int Damage { get; set; }
    public int Scrip { get; set; }
    public bool? Unkillable { get; set; }
    public string? RefuseGist { get; set; }
    public List<Change>? OnDeath { get; set; }
    public string OnDeathSay { get; set; } = "";
}

public sealed class PresenceWhen
{
    public Cond? When { get; set; }
    public string Text { get; set; } = "";
}

public sealed class NpcScript
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Aliases { get; set; } = [];
    public string Presence { get; set; } = "";
    public List<PresenceWhen>? PresenceWhen { get; set; }
    public string Greeting { get; set; } = "";
    public Dictionary<string, Topic> Topics { get; set; } = [];
    public List<TalkRule>? OnTalk { get; set; }
    public List<Trade> Trades { get; set; } = [];
    public Bribe? Bribe { get; set; }
    public Story? Story { get; set; }
    public List<SayRule> Say { get; set; } = [];
    public CombatDef Combat { get; set; } = new();
    public ShopDef? Shop { get; set; }
}

public sealed class NpcState
{
    public string Id { get; set; } = "";
    public bool Alive { get; set; }
    public int Hp { get; set; }
    public int MaxHp { get; set; }
    public bool Hostile { get; set; }
    public string Mood { get; set; } = "";
    public List<string> Inventory { get; set; } = [];
}

public sealed class NpcRuntime
{
    public bool Alive { get; set; }
    public int Hp { get; set; }
    public int MaxHp { get; set; }
    public bool Hostile { get; set; }
    public List<string> Inventory { get; set; } = [];
    public List<Inclination> Mind { get; set; } = [];
    public List<string> Log { get; set; } = [];
}

public sealed class GameState
{
    public int Version { get; set; }
    public string Mode { get; set; } = "play";
    public string RoomId { get; set; } = "";
    public string? PreviousRoomId { get; set; }
    public int Hp { get; set; }
    public int MaxHp { get; set; }
    public int Scrip { get; set; }
    public List<string> Inventory { get; set; } = [];
    public List<Inclination> Mind { get; set; } = [];
    public Dictionary<string, Dictionary<string, string>> Places { get; set; } = [];
    public List<string> Air { get; set; } = [];
    public Dictionary<string, int> Counters { get; set; } = [];
    public int Turns { get; set; }
    public List<string> Visited { get; set; } = [];
    public Dictionary<string, NpcRuntime> Npcs { get; set; } = [];
    public Dictionary<string, List<string>> RoomItems { get; set; } = [];
    public string? CombatWith { get; set; }
    public List<string> PlayerLog { get; set; } = [];
    public Dictionary<string, bool>? Flags { get; set; }
}

public sealed class World
{
    public string Start { get; set; } = "";
    public Dictionary<string, ItemDef> Items { get; set; } = [];
    public Dictionary<string, RoomDef> Rooms { get; set; } = [];
    public Dictionary<string, NpcPair> Npcs { get; set; } = [];
}

public sealed class NpcPair
{
    public NpcScript Script { get; set; } = new();
    public NpcState State { get; set; } = new();
}

public sealed class GameLine
{
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
}

public sealed class Beat
{
    public string NpcId { get; set; } = "";
    public string Event { get; set; } = "";
    public string Gist { get; set; } = "";
}

public sealed class Consult
{
    public string? Subject { get; set; }
    public string Activator { get; set; } = "";
    public string ItemId { get; set; } = "";
}

public sealed class CommandResult
{
    public GameState State { get; set; } = new();
    public List<GameLine> Lines { get; set; } = [];
    public string Effect { get; set; } = "none";
    public Consult? Consult { get; set; }
    public List<Beat>? Beats { get; set; }
}

public sealed class GameAction
{
    public string Type { get; set; } = "";
    public string? Dir { get; set; }
    public string? Target { get; set; }
    public string? Topic { get; set; }
    public string? Item { get; set; }
    public string? Npc { get; set; }
    public string? Text { get; set; }
    public string? Cmd { get; set; }
    public string? Raw { get; set; }

    public static GameAction Of(string type) => new() { Type = type };
}
