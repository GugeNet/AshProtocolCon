using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Ash.Prompt.Tests;

public class EngineTests
{
    [Fact]
    public void Temperature_matches_the_oneiroi_range()
    {
        Assert.True(PromptLimits.TemperatureOk(0));
        Assert.True(PromptLimits.TemperatureOk(2));
        Assert.True(PromptLimits.TemperatureOk(1.4));
        Assert.False(PromptLimits.TemperatureOk(-0.1));
        Assert.False(PromptLimits.TemperatureOk(2.1));
        Assert.False(PromptLimits.TemperatureOk(double.NaN));
        Assert.False(PromptLimits.TemperatureOk(double.PositiveInfinity));
        Assert.True(PromptLimits.TopPOk(0));
        Assert.True(PromptLimits.TopPOk(1));
        Assert.False(PromptLimits.TopPOk(-0.1));
        Assert.False(PromptLimits.TopPOk(1.1));
        Assert.True(PromptLimits.TopKOk(0));
        Assert.True(PromptLimits.TopKOk(500));
        Assert.False(PromptLimits.TopKOk(-1));
        Assert.False(PromptLimits.TopKOk(501));
        Assert.True(PromptLimits.SeedOk(0));
        Assert.True(PromptLimits.SeedOk(int.MaxValue));
        Assert.False(PromptLimits.SeedOk(-1));
        Assert.True(PromptLimits.MaxTokensOk(1));
        Assert.True(PromptLimits.MaxTokensOk(8192));
        Assert.False(PromptLimits.MaxTokensOk(0));
        Assert.False(PromptLimits.MaxTokensOk(8193));
    }

    [Fact]
    public void FindRoot_walks_up_to_the_engine_scripts()
    {
        var root = Directory.CreateTempSubdirectory("ash-prompt-");
        try
        {
            File.WriteAllText(Path.Combine(root.FullName, "hypnos.py"), "");
            File.WriteAllText(Path.Combine(root.FullName, "prompt_engine.py"), "");
            var nested = Directory.CreateDirectory(Path.Combine(root.FullName, "a", "b"));
            Assert.Equal(root.FullName, EngineHost.FindRoot(nested.FullName));
        }
        finally
        {
            root.Delete(true);
        }
    }

    [Fact]
    public void LocatePython_finds_an_installed_interpreter()
    {
        var python = EngineHost.LocatePython();
        Assert.True(File.Exists(python));
        Assert.EndsWith("python.exe", python, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void FormatRaw_indents_the_completion()
    {
        var pretty = EngineSession.FormatRaw("{\"choices\":[{\"message\":{\"content\":\"Hi\"}}]}");
        Assert.Contains("choices", pretty);
        Assert.Contains("\n", pretty);
        Assert.Contains("Hi", pretty);
    }

    [Fact]
    public async Task CompleteAsync_returns_the_engine_completion_unchanged()
    {
        await using var link = await EngineLink.Open();
        Assert.Equal("Qwen.gguf", link.Session.Model);
        Assert.Equal(-1, link.Session.GpuLayers);

        var completing = link.Session.CompleteAsync("Hello", 0.8, 0.95, 40, null, 32, CancellationToken.None);
        var requestLine = await link.EngineStdin.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
        using (var request = JsonDocument.Parse(requestLine!))
        {
            Assert.Equal("Hello", request.RootElement.GetProperty("prompt").GetString());
            Assert.Equal(0.8, request.RootElement.GetProperty("temperature").GetDouble(), 3);
            Assert.Equal(0.95, request.RootElement.GetProperty("top_p").GetDouble(), 3);
            Assert.Equal(40, request.RootElement.GetProperty("top_k").GetInt32());
            Assert.Equal(JsonValueKind.Null, request.RootElement.GetProperty("seed").ValueKind);
            Assert.Equal(32, request.RootElement.GetProperty("max_tokens").GetInt32());
        }

        await link.EngineStdout.WriteLineAsync(
            "{\"id\":1,\"ok\":true,\"raw\":{\"choices\":[{\"message\":{\"content\":\"  Hi  \"}}],\"usage\":{\"completion_tokens\":2}}}");
        var raw = await completing.WaitAsync(TimeSpan.FromSeconds(5));
        using var completion = JsonDocument.Parse(raw);
        Assert.Equal("  Hi  ", completion.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString());
        Assert.Equal(2, completion.RootElement.GetProperty("usage").GetProperty("completion_tokens").GetInt32());
    }

    [Fact]
    public async Task CompleteAsync_throws_the_engine_error()
    {
        await using var link = await EngineLink.Open();
        var completing = link.Session.CompleteAsync("Hello", 1.4, 0.95, 40, 1234, 16, CancellationToken.None);
        await link.EngineStdin.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5));
        await link.EngineStdout.WriteLineAsync("{\"id\":1,\"ok\":false,\"error\":\"Temperature must be from 0 to 2.\"}");
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => completing);
        Assert.Equal("Temperature must be from 0 to 2.", error.Message);
    }
}

sealed class EngineLink : IAsyncDisposable
{
    public EngineSession Session { get; }
    public StreamWriter EngineStdout { get; }
    public StreamReader EngineStdin { get; }
    readonly StreamWriter _sessionStdin;
    readonly StreamReader _sessionStdout;

    EngineLink(EngineSession session, StreamWriter engineStdout, StreamReader engineStdin, StreamWriter sessionStdin, StreamReader sessionStdout)
    {
        Session = session;
        EngineStdout = engineStdout;
        EngineStdin = engineStdin;
        _sessionStdin = sessionStdin;
        _sessionStdout = sessionStdout;
    }

    public static async Task<EngineLink> Open()
    {
        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        var stdoutServer = new AnonymousPipeServerStream(PipeDirection.Out);
        var stdoutClient = new AnonymousPipeClientStream(PipeDirection.In, stdoutServer.GetClientHandleAsString());
        var stdinServer = new AnonymousPipeServerStream(PipeDirection.In);
        var stdinClient = new AnonymousPipeClientStream(PipeDirection.Out, stdinServer.GetClientHandleAsString());

        var engineStdout = new StreamWriter(stdoutServer, utf8) { AutoFlush = true };
        var sessionStdout = new StreamReader(stdoutClient, utf8);
        var sessionStdin = new StreamWriter(stdinClient, utf8) { AutoFlush = true };
        var engineStdin = new StreamReader(stdinServer, utf8);

        var connect = EngineSession.ConnectAsync(sessionStdout, sessionStdin, CancellationToken.None);
        await engineStdout.WriteLineAsync("{\"event\":\"ready\",\"model\":\"Qwen.gguf\",\"gpu_layers\":-1}");
        var session = await connect.WaitAsync(TimeSpan.FromSeconds(5));
        return new EngineLink(session, engineStdout, engineStdin, sessionStdin, sessionStdout);
    }

    public async ValueTask DisposeAsync()
    {
        try { await Session.DisposeAsync(); } catch { }
        try { EngineStdout.Dispose(); } catch { }
        try { _sessionStdin.Dispose(); } catch { }
        try { EngineStdin.Dispose(); } catch { }
        try { _sessionStdout.Dispose(); } catch { }
    }
}
