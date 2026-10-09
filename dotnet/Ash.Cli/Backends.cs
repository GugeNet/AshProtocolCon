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
        if (name == "cuda" && !CudaRuntime(out reason))
        {
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

    static bool CudaRuntime(out string reason)
    {
        TryAddBundledCudaBins();

        if (Library("cudart64_12.dll") && Library("cublas64_12.dll"))
        {
            reason = "";
            return true;
        }

        var cudaPath = Environment.GetEnvironmentVariable("CUDA_PATH");
        if (TryAddCudaBin(cudaPath) && Library("cudart64_12.dll") && Library("cublas64_12.dll"))
        {
            reason = "";
            return true;
        }

        var vars = Environment.GetEnvironmentVariables();
        foreach (var key in vars.Keys.OfType<string>().Where(name => name.StartsWith("CUDA_PATH_V", StringComparison.OrdinalIgnoreCase)).OrderByDescending(name => name, StringComparer.OrdinalIgnoreCase))
        {
            if (TryAddCudaBin(Environment.GetEnvironmentVariable(key)) && Library("cudart64_12.dll") && Library("cublas64_12.dll"))
            {
                reason = "";
                return true;
            }
        }

        if (TryAddNewestCudaBin() && Library("cudart64_12.dll") && Library("cublas64_12.dll"))
        {
            reason = "";
            return true;
        }

        reason = "CUDA 12 runtime libraries were not found (missing cudart64_12.dll or cublas64_12.dll). Install CUDA 12 runtime/toolkit or add its bin folder to PATH.";
        return false;
    }

    static void TryAddBundledCudaBins()
    {
        foreach (var root in SearchRoots())
        {
            var redist = Path.Combine(root, ".cuda-redist", "nvidia");
            if (!Directory.Exists(redist)) continue;

            TryAddPath(Path.Combine(redist, "cuda_runtime", "bin"));
            TryAddPath(Path.Combine(redist, "cublas", "bin"));
            return;
        }
    }

    static IEnumerable<string> SearchRoots()
    {
        static IEnumerable<string> Up(string start)
        {
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                yield return dir.FullName;
                dir = dir.Parent;
            }
        }

        foreach (var path in Up(AppContext.BaseDirectory)) yield return path;
        foreach (var path in Up(Directory.GetCurrentDirectory())) yield return path;
    }

    static bool TryAddNewestCudaBin()
    {
        var root = @"C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA";
        if (!Directory.Exists(root)) return false;
        var dirs = Directory.GetDirectories(root, "v12.*", SearchOption.TopDirectoryOnly)
            .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase);
        foreach (var dir in dirs)
        {
            if (TryAddCudaBin(dir)) return true;
        }
        return false;
    }

    static bool TryAddCudaBin(string? cudaRoot)
    {
        if (string.IsNullOrWhiteSpace(cudaRoot)) return false;
        var bin = Path.Combine(cudaRoot, "bin");
        return TryAddPath(bin);
    }

    static bool TryAddPath(string pathToAdd)
    {
        if (!Directory.Exists(pathToAdd)) return false;
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        if (path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Any(entry => string.Equals(entry.Trim(), pathToAdd, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }
        Environment.SetEnvironmentVariable("PATH", string.IsNullOrEmpty(path) ? pathToAdd : $"{pathToAdd}{Path.PathSeparator}{path}");
        return true;
    }

    static bool Library(string file)
    {
        if (!NativeLibrary.TryLoad(file, out var handle)) return false;
        NativeLibrary.Free(handle);
        return true;
    }
}
