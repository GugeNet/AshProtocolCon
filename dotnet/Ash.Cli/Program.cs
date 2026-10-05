namespace Ash.Cli;

static class Program
{
    static int Main(string[] args)
    {
        Ansi.Enable();
        if (!Options.TryParse(args, out var options, out var error))
        {
            Console.Error.WriteLine(error);
            Console.Error.WriteLine("ash --model <gguf> --backend cuda|vulkan|cpu --tape <file>");
            return 1;
        }
        if (options.Probe is not null)
        {
            try
            {
                using var session = ModelSession.Load(options.Model, options.Probe);
                return 0;
            }
            catch (Exception ex)
            {
                while (ex.InnerException is not null) ex = ex.InnerException;
                Console.Error.WriteLine(ex.Message);
                return 1;
            }
        }

        try
        {
            var root = FindRoot();
            var host = new GameHost(root, options.Model, options.Backend, options.Tape);
            host.Run();
            return 0;
        }
        catch (Exception ex)
        {
            Ansi.Line("warn", ex.Message);
            return 1;
        }
    }

    static string FindRoot()
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
        throw new DirectoryNotFoundException("Could not find public/ash/index.json above this directory.");
    }
}

sealed class Options
{
    public string Model { get; init; } = ModelSession.DefaultModel;
    public string? Backend { get; init; }
    public string? Tape { get; init; }
    public string? Probe { get; init; }

    public static bool TryParse(string[] args, out Options options, out string error)
    {
        var model = Environment.GetEnvironmentVariable("ASH_MODEL");
        string? backend = null;
        string? tape = null;
        string? probe = null;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            string? Next()
            {
                if (i + 1 >= args.Length) return null;
                i++;
                return args[i];
            }
            switch (arg)
            {
                case "--model":
                    model = Next();
                    if (string.IsNullOrWhiteSpace(model))
                    {
                        options = new Options();
                        error = "--model needs a path.";
                        return false;
                    }
                    break;
                case "--backend":
                    backend = Next()?.ToLowerInvariant();
                    if (backend is not ("cuda" or "vulkan" or "cpu"))
                    {
                        options = new Options();
                        error = "--backend must be cuda, vulkan, or cpu.";
                        return false;
                    }
                    break;
                case "--tape":
                    tape = Next();
                    if (string.IsNullOrWhiteSpace(tape))
                    {
                        options = new Options();
                        error = "--tape needs a path.";
                        return false;
                    }
                    break;
                case "--probe":
                    probe = Next()?.ToLowerInvariant();
                    if (probe is not ("cuda" or "vulkan" or "cpu"))
                    {
                        options = new Options();
                        error = "--probe must be cuda, vulkan, or cpu.";
                        return false;
                    }
                    break;
                default:
                    options = new Options();
                    error = $"Unknown argument {arg}.";
                    return false;
            }
        }
        options = new Options
        {
            Model = string.IsNullOrWhiteSpace(model) ? ModelSession.DefaultModel : model,
            Backend = backend,
            Tape = tape,
            Probe = probe,
        };
        error = "";
        return true;
    }
}
