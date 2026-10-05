using System.Text.Json;
using System.Text.Json.Serialization;

namespace Ash.Game;

public static class JsonOpts
{
    public static readonly JsonSerializerOptions Cartridge = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static readonly JsonSerializerOptions Tape = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true,
    };

    public static T Read<T>(string path)
    {
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<T>(json, Cartridge)
            ?? throw new InvalidDataException($"Cartridge missing {path}");
    }

    public static GameState Clone(GameState state)
    {
        var json = JsonSerializer.Serialize(state, Tape);
        return JsonSerializer.Deserialize<GameState>(json, Tape)
            ?? throw new InvalidDataException("The tape could not be copied.");
    }
}
