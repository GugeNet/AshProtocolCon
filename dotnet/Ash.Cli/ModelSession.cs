using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Ash.Game;
using LLama;
using LLama.Common;
using LLama.Native;
using LLama.Sampling;

namespace Ash.Cli;

sealed class ModelSession : IDisposable
{
//    public const string DefaultModel = @"C:\Users\Geir Gundersen\OneDrive\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
    public const string DefaultModel = @"C:\Users\papag\OneDrive\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf";

    static readonly NativeLogConfig.LLamaLogCallback LogSink = Quiet;
    static bool _bound;

    readonly LLamaWeights _weights;
    readonly StatelessExecutor _executor;
    readonly SemaphoreSlim _gate = new(1, 1);

    public string Backend { get; }

    ModelSession(string backend, LLamaWeights weights, StatelessExecutor executor)
    {
        Backend = backend;
        _weights = weights;
        _executor = executor;
    }

    public static ModelSession Open(string modelPath, string? backend, TextWriter log)
    {
        if (!File.Exists(modelPath)) throw new FileNotFoundException($"Model file not found: {modelPath}");
        var choice = string.IsNullOrWhiteSpace(backend) ? Choose(modelPath, log) : backend.Trim().ToLowerInvariant();
        if (choice is not ("cuda" or "vulkan" or "cpu"))
        {
            throw new InvalidOperationException("Backend must be cuda, vulkan, or cpu.");
        }
        log.WriteLine($"Loading the model on {choice}…");
        log.Flush();
        return Load(modelPath, choice);
    }

    public static ModelSession Load(string modelPath, string backend)
    {
        if (!Backends.Available(backend, out var reason)) throw new InvalidOperationException(reason);
        var dll = Backends.Locate(backend) ?? throw new InvalidOperationException($"{backend} native library was not found.");
        Bind(dll);
        var gpu = backend is "cuda" or "vulkan";
        var parameters = new ModelParams(modelPath)
        {
            ContextSize = 8192,
            GpuLayerCount = gpu ? -1 : 0,
            UseMemorymap = true,
        };
        var weights = LLamaWeights.LoadFromFile(parameters);
        var executor = new StatelessExecutor(weights, parameters);
        return new ModelSession(backend, weights, executor);
    }

    public async Task<string> CompleteAsync(
        IReadOnlyList<(string Role, string Content)> messages,
        float temperature,
        int maxTokens,
        CancellationToken cancel)
    {
        var prompt = ChatMl(messages);
        await _gate.WaitAsync(cancel);
        try
        {
            using var sampling = new DefaultSamplingPipeline
            {
                Temperature = temperature,
                TopK = temperature <= 0 ? 1 : 40,
                TopP = temperature <= 0 ? 1 : 0.9f,
                MinP = temperature <= 0 ? 0 : 0.05f,
                Seed = temperature <= 0 ? 1u : (uint)Random.Shared.NextInt64(1, int.MaxValue),
            };
            var inference = new InferenceParams
            {
                MaxTokens = maxTokens,
                AntiPrompts = ["<|im_end|>", "<|im_start|>"],
                SamplingPipeline = sampling,
            };
            var text = new StringBuilder();
            await foreach (var token in _executor.InferAsync(prompt, inference, cancel))
            {
                text.Append(token);
            }
            return Strip(text.ToString());
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<ModelReply> ToolsAsync(IReadOnlyList<ToolSpec> tools, List<ChatMessage> messages, CancellationToken cancel)
    {
        var system = new StringBuilder();
        var first = messages.FirstOrDefault(message => message.Role == "system");
        if (first is not null) system.AppendLine(first.Content);
        system.AppendLine();
        system.AppendLine("TOOLS");
        foreach (var tool in tools)
        {
            system.AppendLine($"- {tool.Name}: {tool.Description}");
            foreach (var (key, values) in tool.Parameters)
            {
                var required = tool.Required.Contains(key) ? "required" : "optional";
                var choices = values is null || values.Count == 0 ? "string" : string.Join(" | ", values);
                system.AppendLine($"    {key} ({required}): {choices}");
            }
        }
        system.AppendLine();
        system.AppendLine("Reply with only this JSON and nothing else:");
        system.AppendLine("{\"calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}");

        var chat = new List<(string Role, string Content)> { ("system", system.ToString().Trim()) };
        foreach (var message in messages)
        {
            if (message.Role == "system") continue;
            var role = message.Role == "assistant" ? "assistant" : "user";
            var body = message.Role == "tool"
                ? $"Tool {message.ToolName} returned: {message.Content}"
                : message.Content;
            if (message.Role == "assistant" && message.ToolCalls is { Count: > 0 } && body.Length == 0)
            {
                body = JsonSerializer.Serialize(message.ToolCalls.Select(call => new { name = call.Name, arguments = call.Arguments }));
            }
            chat.Add((role, body));
        }
        return CompleteAsync(chat, 0, 512, cancel).ContinueWith(task => ParseCalls(task.GetAwaiter().GetResult()), cancel, TaskContinuationOptions.None, TaskScheduler.Default);
    }

    public void Dispose()
    {
        if (_executor is IDisposable disposable) disposable.Dispose();
        _weights.Dispose();
        _gate.Dispose();
    }

    static string Choose(string modelPath, TextWriter log)
    {
        foreach (var name in new[] { "cuda", "vulkan" })
        {
            if (!Backends.Available(name, out var reason))
            {
                log.WriteLine(reason);
                log.Flush();
                continue;
            }
            log.WriteLine($"Trying {name}…");
            log.Flush();
            if (Probe(name, modelPath, out var detail)) return name;
            log.WriteLine($"{name} did not load the model.");
            if (!string.IsNullOrWhiteSpace(detail)) log.WriteLine(detail.Trim());
            log.Flush();
        }
        if (!Backends.Available("cpu", out var cpu)) throw new InvalidOperationException(cpu);
        return "cpu";
    }

    static bool Probe(string backend, string modelPath, out string detail)
    {
        detail = "";
        var exe = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exe)) return false;
        var start = new System.Diagnostics.ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add("--probe");
        start.ArgumentList.Add(backend);
        start.ArgumentList.Add("--model");
        start.ArgumentList.Add(modelPath);
        using var process = System.Diagnostics.Process.Start(start);
        if (process is null) return false;
        var standardOutput = process.StandardOutput.ReadToEndAsync();
        var standardError = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(180_000))
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            detail = "Probe timed out.";
            return false;
        }
        Task.WaitAll(standardOutput, standardError);
        var stderr = standardError.Result;
        var stdout = standardOutput.Result;
        if (process.ExitCode == 0) return true;
        detail = string.IsNullOrWhiteSpace(stderr) ? stdout : stderr;
        return false;
    }

    static void Bind(string dll)
    {
        if (_bound) return;
        var folder = Path.GetDirectoryName(dll) ?? throw new InvalidOperationException("The native library has no folder.");
        StageCpuRuntime(folder);
        SetDllDirectory(folder);
        var mtmd = Path.Combine(folder, "mtmd.dll");
        if (File.Exists(mtmd)) NativeLibraryConfig.All.WithLibrary(dll, mtmd);
        else NativeLibraryConfig.LLama.WithLibrary(dll);
        NativeLogConfig.llama_log_set(LogSink);
        _bound = true;
    }

    // The CUDA and Vulkan ggml.dll files import ggml-cpu.dll. That library is shipped
    // only beside the CPU builds, so a GPU folder cannot load until a copy sits with it.
    static void StageCpuRuntime(string folder)
    {
        var target = Path.Combine(folder, "ggml-cpu.dll");
        var cpuLlama = Backends.Locate("cpu");
        if (cpuLlama is null) throw new InvalidOperationException("The CPU native library was not found.");
        var source = Path.Combine(Path.GetDirectoryName(cpuLlama)!, "ggml-cpu.dll");
        if (!File.Exists(source)) throw new InvalidOperationException("ggml-cpu.dll was not found beside the CPU backend.");
        if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase)) return;
        if (File.Exists(target) && new FileInfo(source).Length == new FileInfo(target).Length) return;
        File.Copy(source, target, overwrite: true);
    }

    static void Quiet(LLamaLogLevel level, string message)
    {
        if (level == LLamaLogLevel.Error) Console.Error.Write(message);
    }

    static string ChatMl(IReadOnlyList<(string Role, string Content)> messages)
    {
        var text = new StringBuilder();
        foreach (var (role, content) in messages)
        {
            text.Append("<|im_start|>").Append(role).Append('\n');
            text.Append(content.Trim()).Append("<|im_end|>\n");
        }
        text.Append("<|im_start|>assistant\n");
        return text.ToString();
    }

    public static string Strip(string text)
    {
        var cleaned = text.Replace("<|im_end|>", "").Replace("<|im_start|>", "").Trim();
        if (!cleaned.StartsWith("```")) return cleaned;
        var lines = cleaned.Split('\n').ToList();
        if (lines.Count > 0 && lines[0].StartsWith("```")) lines.RemoveAt(0);
        if (lines.Count > 0 && lines[^1].Trim() == "```") lines.RemoveAt(lines.Count - 1);
        return string.Join('\n', lines).Trim();
    }

    public static ModelReply ParseCalls(string text)
    {
        var cleaned = Strip(text);
        var start = cleaned.IndexOf('{');
        var end = cleaned.LastIndexOf('}');
        if (start < 0 || end <= start) return new ModelReply { Content = cleaned };
        try
        {
            using var doc = JsonDocument.Parse(cleaned[start..(end + 1)]);
            if (!doc.RootElement.TryGetProperty("calls", out var calls) || calls.ValueKind != JsonValueKind.Array)
            {
                return new ModelReply { Content = cleaned };
            }
            var list = new List<ToolCall>();
            foreach (var call in calls.EnumerateArray())
            {
                if (call.ValueKind != JsonValueKind.Object) continue;
                var name = call.TryGetProperty("name", out var named) && named.ValueKind == JsonValueKind.String
                    ? named.GetString() ?? ""
                    : "";
                var arguments = call.TryGetProperty("arguments", out var args)
                    ? Interpreter.ArgumentsFrom(args.Clone())
                    : [];
                list.Add(new ToolCall { Name = name, Arguments = arguments });
            }
            return new ModelReply { Content = cleaned, Calls = list };
        }
        catch (JsonException)
        {
            return new ModelReply { Content = cleaned };
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool SetDllDirectory(string path);
}
