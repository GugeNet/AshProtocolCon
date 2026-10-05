using System.Diagnostics;
using System.IO;
using System.Text;

namespace Ash.Prompt;

public sealed class EngineHost : IDisposable
{
    readonly Process _process;
    bool _stopped;

    public EngineSession Session { get; }

    EngineHost(Process process, EngineSession session)
    {
        _process = process;
        Session = session;
    }

    public static string FindRoot(params string[] starts)
    {
        if (starts.Length == 0)
        {
            starts = [Directory.GetCurrentDirectory(), AppContext.BaseDirectory];
        }
        foreach (var start in starts)
        {
            if (string.IsNullOrWhiteSpace(start)) continue;
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "hypnos.py"))
                    && File.Exists(Path.Combine(dir.FullName, "prompt_engine.py")))
                {
                    return dir.FullName;
                }
                dir = dir.Parent;
            }
        }
        throw new DirectoryNotFoundException("Could not find hypnos.py and prompt_engine.py above this directory.");
    }

    public static string LocatePython()
    {
        var fromEnv = Environment.GetEnvironmentVariable("ASH_PYTHON");
        if (IsPython(fromEnv)) return fromEnv!;
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var pinned = Path.Combine(local, "Programs", "Python", "Python313", "python.exe");
        if (File.Exists(pinned)) return pinned;
        var found = WherePython();
        if (found is not null) return found;
        throw new InvalidOperationException("Python was not found. Set ASH_PYTHON to the python.exe that runs hypnos.py.");
    }

    public static async Task<EngineHost> StartAsync(CancellationToken cancel, Action<string>? log)
    {
        var root = FindRoot();
        var python = LocatePython();
        var script = Path.Combine(root, "prompt_engine.py");
        if (!File.Exists(script)) throw new FileNotFoundException("prompt_engine.py was not found.", script);

        log?.Invoke("Loading the model…");
        var process = StartProcess(python, script, root);
        var stderr = new StringBuilder();
        var stderrTask = PumpStderr(process, stderr, log, cancel);
        using var killOnCancel = cancel.Register(() => Stop(process));
        try
        {
            var session = await EngineSession.ConnectAsync(process.StandardOutput, process.StandardInput, cancel);
            return new EngineHost(process, session);
        }
        catch (Exception ex)
        {
            Stop(process);
            try { await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
            try { await stderrTask.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
            try { process.Dispose(); } catch { }
            if (ex is OperationCanceledException) throw;
            var tail = stderr.ToString().Trim();
            var message = string.IsNullOrWhiteSpace(tail) ? ex.Message : ex.Message + Environment.NewLine + tail;
            throw new InvalidOperationException(message, ex);
        }
    }

    public void Stop()
    {
        if (_stopped) return;
        _stopped = true;
        Stop(_process);
        try { _process.Dispose(); } catch (InvalidOperationException) { }
    }

    public void Dispose() => Stop();

    static Process StartProcess(string python, string script, string root)
    {
        var start = new ProcessStartInfo(python)
        {
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        start.ArgumentList.Add("-u");
        start.ArgumentList.Add("-X");
        start.ArgumentList.Add("utf8");
        start.ArgumentList.Add(script);
        start.Environment["PYTHONIOENCODING"] = "utf-8";
        start.Environment["PYTHONUTF8"] = "1";
        start.Environment["PYTHONUNBUFFERED"] = "1";
        return Process.Start(start) ?? throw new InvalidOperationException("The engine process did not start.");
    }

    static async Task PumpStderr(Process process, StringBuilder sink, Action<string>? log, CancellationToken cancel)
    {
        try
        {
            while (true)
            {
                var line = await process.StandardError.ReadLineAsync(cancel);
                if (line is null) break;
                if (string.IsNullOrWhiteSpace(line)) continue;
                lock (sink)
                {
                    sink.AppendLine(line);
                    if (sink.Length > 4000) sink.Remove(0, sink.Length - 3000);
                }
                log?.Invoke(line.Trim());
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    static void Stop(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
        }
    }

    static bool IsPython(string? path) =>
        !string.IsNullOrWhiteSpace(path)
        && path.EndsWith("python.exe", StringComparison.OrdinalIgnoreCase)
        && File.Exists(path);

    static string? WherePython()
    {
        try
        {
            var start = new ProcessStartInfo("where.exe", "python")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(start);
            if (process is null) return null;
            var output = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(3000)) return null;
            foreach (var line in output.Split('\n'))
            {
                var path = line.Trim();
                if (IsPython(path)) return path;
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception)
        {
        }
        return null;
    }
}
