using System.Runtime.InteropServices;
using System.Text;

namespace Ash.Cli;

static class Ansi
{
    const uint EnableVirtualTerminalProcessing = 0x0004;

    public static bool Enabled { get; private set; }

    public static void Enable()
    {
        Console.OutputEncoding = Encoding.UTF8;
        if (Environment.GetEnvironmentVariable("NO_COLOR") is not null || Console.IsOutputRedirected)
        {
            Enabled = false;
            return;
        }
        if (OperatingSystem.IsWindows()) EnableWindowsVt();
        Enabled = true;
    }

    public static string Paint(string kind, string text)
    {
        if (!Enabled || text.Length == 0) return text;
        var (r, g, b) = kind switch
        {
            "echo" or "exit" => (196, 163, 106),
            "sys" or "speech" or "map" => (154, 215, 195),
            "combat" or "warn" => (255, 77, 58),
            _ => (255, 176, 0),
        };
        return $"\x1b[38;2;{r};{g};{b}m{text}\x1b[0m";
    }

    public static void Line(string kind, string text)
    {
        foreach (var row in text.Replace("\r\n", "\n").Split('\n'))
        {
            Console.WriteLine(Paint(kind, row));
        }
        Console.Out.Flush();
    }

    public static void Prompt(string text)
    {
        Console.Write(Paint("body", text));
        Console.Out.Flush();
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetConsoleMode(IntPtr handle, out uint mode);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleMode(IntPtr handle, uint mode);

    static void EnableWindowsVt()
    {
        var handle = GetStdHandle(-11);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
        if (!GetConsoleMode(handle, out var mode)) return;
        SetConsoleMode(handle, mode | EnableVirtualTerminalProcessing);
    }
}
