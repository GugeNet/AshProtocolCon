using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Ash.Prompt;

public static class PromptLimits
{
    public const double MinTemperature = 0;
    public const double MaxTemperature = 2;
    public const double MinTopP = 0;
    public const double MaxTopP = 1;
    public const int MinTopK = 0;
    public const int MaxTopK = 500;
    public const int MinSeed = 0;
    public const int MaxSeed = int.MaxValue;
    public const int DefaultMaxTokens = 1024;
    public const int MaxTokensLimit = 8192;

    public static bool TemperatureOk(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value) && value >= MinTemperature && value <= MaxTemperature;

    public static bool TopPOk(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value) && value >= MinTopP && value <= MaxTopP;

    public static bool TopKOk(int value) => value >= MinTopK && value <= MaxTopK;

    public static bool SeedOk(int value) => value >= MinSeed && value <= MaxSeed;

    public static bool MaxTokensOk(int value) => value >= 1 && value <= MaxTokensLimit;
}

public sealed class EngineSession : IAsyncDisposable
{
    readonly TextWriter _input;
    readonly CancellationTokenSource _cancel = new();
    readonly SemaphoreSlim _write = new(1, 1);
    readonly object _state = new();
    readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly CancellationTokenRegistration _registration;
    Task _pump = Task.CompletedTask;

    TaskCompletionSource<EngineReply>? _pending;
    int _pendingId;
    int _nextId;

    public string Model { get; private set; } = "";
    public int GpuLayers { get; private set; }

    EngineSession(TextWriter input, CancellationToken cancel)
    {
        _input = input;
        _registration = cancel.Register(() => _cancel.Cancel());
    }

    public static async Task<EngineSession> ConnectAsync(StreamReader output, StreamWriter input, CancellationToken cancel)
    {
        var session = new EngineSession(input, cancel);
        session._pump = session.PumpAsync(output);
        try
        {
            await session._ready.Task.WaitAsync(cancel);
            return session;
        }
        catch
        {
            await session.DisposeAsync();
            throw;
        }
    }

    public static string ExtractMarkdown(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var markdown = ExtractText(doc.RootElement);
            return string.IsNullOrWhiteSpace(markdown) ? FormatRaw(json) : markdown;
        }
        catch (JsonException)
        {
            return json;
        }
    }

    public async Task<string> CompleteAsync(string prompt, double temperature, double topP, int topK, int? seed, int maxTokens, CancellationToken cancel)
    {
        if (string.IsNullOrWhiteSpace(prompt)) throw new InvalidOperationException("The prompt is empty.");
        if (!PromptLimits.TemperatureOk(temperature)) throw new InvalidOperationException("Temperature must be from 0 to 2.");
        if (!PromptLimits.TopPOk(topP)) throw new InvalidOperationException("Top-p must be from 0 to 1.");
        if (!PromptLimits.TopKOk(topK)) throw new InvalidOperationException("Top-k must be from 0 to 500.");
        if (seed is not null && !PromptLimits.SeedOk(seed.Value)) throw new InvalidOperationException("Seed must be from 0 to 2147483647.");
        if (!PromptLimits.MaxTokensOk(maxTokens)) throw new InvalidOperationException("Max tokens must be from 1 to 8192.");

        var id = Interlocked.Increment(ref _nextId);
        var done = new TaskCompletionSource<EngineReply>(TaskCreationOptions.RunContinuationsAsynchronously);
        var json = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["id"] = id,
            ["prompt"] = prompt,
            ["temperature"] = temperature,
            ["top_p"] = topP,
            ["top_k"] = topK,
            ["seed"] = seed,
            ["max_tokens"] = maxTokens,
        });

        await _write.WaitAsync(cancel);
        try
        {
            lock (_state)
            {
                _pending = done;
                _pendingId = id;
            }
            try
            {
                await _input.WriteLineAsync(json.AsMemory(), cancel);
                await _input.FlushAsync(cancel);
                var reply = await done.Task.WaitAsync(cancel);
                if (!reply.Ok)
                {
                    throw new InvalidOperationException(string.IsNullOrWhiteSpace(reply.Error) ? "The engine returned an error." : reply.Error);
                }
                if (reply.Raw is null) throw new InvalidOperationException("The engine returned no completion.");
                return reply.Raw;
            }
            catch
            {
                lock (_state)
                {
                    if (ReferenceEquals(_pending, done)) _pending = null;
                }
                throw;
            }
        }
        finally
        {
            _write.Release();
        }
    }

    public static string FormatRaw(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
            {
                Indented = true,
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            }))
            {
                doc.WriteTo(writer);
            }
            return Encoding.UTF8.GetString(stream.ToArray());
        }
        catch (JsonException)
        {
            return json;
        }
    }

    public async ValueTask DisposeAsync()
    {
        _cancel.Cancel();
        try { await _pump.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        _registration.Dispose();
        _cancel.Dispose();
        _write.Dispose();
    }

    async Task PumpAsync(StreamReader output)
    {
        try
        {
            while (!_cancel.IsCancellationRequested)
            {
                var line = await output.ReadLineAsync(_cancel.Token);
                if (line is null) break;
                Accept(line);
            }
            const string stopped = "The engine stopped.";
            _ready.TrySetException(new InvalidOperationException(stopped));
            FailPending(stopped);
        }
        catch (OperationCanceledException)
        {
            FailPending("The engine stopped.");
        }
        catch (Exception ex)
        {
            _ready.TrySetException(ex);
            FailPending(ex.Message);
        }
    }

    void Accept(string line)
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || !trimmed.StartsWith('{')) return;
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(trimmed);
        }
        catch (JsonException)
        {
            FailPending("The engine returned invalid JSON.");
            return;
        }
        using (doc)
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("event", out var ev) && ev.ValueKind == JsonValueKind.String)
            {
                HandleEvent(ev.GetString(), root);
                return;
            }
            if (root.TryGetProperty("id", out var idNode) && idNode.TryGetInt32(out var id))
            {
                lock (_state)
                {
                    if (id != _pendingId) return;
                }
            }
            var ok = root.TryGetProperty("ok", out var okNode) && okNode.ValueKind == JsonValueKind.True;
            string? error = root.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String
                ? err.GetString()
                : null;
            string? raw = root.TryGetProperty("raw", out var rawNode) ? rawNode.GetRawText() : null;
            CompletePending(new EngineReply(ok, error, raw));
        }
    }

    void HandleEvent(string? name, JsonElement root)
    {
        if (name == "ready")
        {
            if (root.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String)
            {
                Model = model.GetString() ?? "";
            }
            if (root.TryGetProperty("gpu_layers", out var layers) && layers.TryGetInt32(out var count))
            {
                GpuLayers = count;
            }
            _ready.TrySetResult();
            return;
        }
        if (name == "error")
        {
            var message = root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String
                ? error.GetString() ?? "The engine failed."
                : "The engine failed.";
            _ready.TrySetException(new InvalidOperationException(message));
        }
    }

    void FailPending(string message) => CompletePending(new EngineReply(false, message, null));

    void CompletePending(EngineReply reply)
    {
        TaskCompletionSource<EngineReply>? pending;
        lock (_state)
        {
            pending = _pending;
            _pending = null;
        }
        pending?.TrySetResult(reply);
    }

    readonly record struct EngineReply(bool Ok, string? Error, string? Raw);

    static string? ExtractText(JsonElement node)
    {
        switch (node.ValueKind)
        {
            case JsonValueKind.String:
                return node.GetString();
            case JsonValueKind.Array:
            {
                var parts = new List<string>();
                foreach (var item in node.EnumerateArray())
                {
                    var text = ExtractText(item);
                    if (!string.IsNullOrWhiteSpace(text)) parts.Add(text.Trim());
                }
                return parts.Count == 0 ? null : string.Join("\n\n", parts);
            }
            case JsonValueKind.Object:
            {
                foreach (var key in new[] { "content", "text", "response", "output_text", "completion", "answer" })
                {
                    if (!node.TryGetProperty(key, out var value)) continue;
                    var text = ExtractText(value);
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }

                if (node.TryGetProperty("message", out var message))
                {
                    var text = ExtractText(message);
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }

                if (node.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array)
                {
                    var text = ExtractText(choices);
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }

                if (node.TryGetProperty("candidates", out var candidates) && candidates.ValueKind == JsonValueKind.Array)
                {
                    var text = ExtractText(candidates);
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }

                if (node.TryGetProperty("parts", out var partsNode) && partsNode.ValueKind == JsonValueKind.Array)
                {
                    var text = ExtractText(partsNode);
                    if (!string.IsNullOrWhiteSpace(text)) return text;
                }

                return null;
            }
            default:
                return null;
        }
    }
}
