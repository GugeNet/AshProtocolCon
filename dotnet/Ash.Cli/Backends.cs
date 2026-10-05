using System.Runtime.InteropServices;
using System.Runtime.Intrinsics.X86;

namespace Ash.Cli;

static class Backends
{
    public static bool Available(string name, out string reason)
    {
        var dll = Locate(name);
        if (dll is null)
        {
            reason = $"{name} native library was not found next to the program.";
            return false;
        }
        if (name == "cuda" && !Driver("nvcuda.dll"))
        {
            reason = "CUDA is not on this machine.";
            return false;
        }
        if (name == "vulkan" && !Driver("vulkan-1.dll"))
        {
            reason = "Vulkan is not on this machine.";
            return false;
        }
        reason = "";
        return true;
    }

    public static string? Locate(string name)
    {
        var root = Path.Combine(AppContext.BaseDirectory, "runtimes");
        if (!Directory.Exists(root)) return null;
        if (name == "cpu") return CpuDll(root);
        var folder = name == "cuda" ? "cuda12" : name;
        return Directory.EnumerateFiles(root, "llama.dll", SearchOption.AllDirectories)
            .FirstOrDefault(path => path.Contains($"{Path.DirectorySeparatorChar}{folder}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
    }

    static string? CpuDll(string root)
    {
        string[] order = Avx512F.IsSupported
            ? ["avx512", "avx2", "avx", "noavx"]
            : Avx2.IsSupported
                ? ["avx2", "avx", "noavx"]
                : Avx.IsSupported
                    ? ["avx", "noavx"]
                    : ["noavx"];
        var files = Directory.EnumerateFiles(root, "llama.dll", SearchOption.AllDirectories).ToList();
        foreach (var folder in order)
        {
            var match = files.FirstOrDefault(path => path.Contains($"{Path.DirectorySeparatorChar}{folder}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase));
            if (match is not null) return match;
        }
        return null;
    }

    static bool Driver(string file)
    {
        if (!NativeLibrary.TryLoad(file, out var handle)) return false;
        NativeLibrary.Free(handle);
        return true;
    }
}
