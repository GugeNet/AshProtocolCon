using System.Globalization;
using System.Threading;
using System.Windows;
using System.Windows.Input;
using Markdig;

namespace Ash.Prompt;

public partial class MainWindow : Window
{
    readonly CancellationTokenSource _lifetime = new();
    EngineHost? _host;
    int _loading = 1;
    bool _busy;

    public MainWindow()
    {
        InitializeComponent();
        TemperatureSlider.Value = 0.8;
        TemperatureSlider.ValueChanged += (_, e) =>
        {
            if (TemperatureBox.IsFocused) return;
            TemperatureBox.Text = e.NewValue.ToString("0.##", CultureInfo.InvariantCulture);
        };
        Loaded += OnLoaded;
    }

    async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        try
        {
            _host = await EngineHost.StartAsync(_lifetime.Token, ShowLoadLog);
            Volatile.Write(ref _loading, 0);
            ModelText.Text = _host.Session.Model;
            ModelText.ToolTip = _host.Session.Model;
            LayersText.Text = _host.Session.GpuLayers switch
            {
                0 => "CPU",
                < 0 => "GPU",
                _ => $"GPU ({_host.Session.GpuLayers} layers)",
            };
            SetStatus("Ready.");
            SendButton.IsEnabled = true;
            PromptBox.Focus();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            ResponseBox.Text = ex.Message;
            ShowMarkdown(ex.Message);
        }
    }

    void ShowLoadLog(string line)
    {
        if (Volatile.Read(ref _loading) == 0 || Dispatcher.HasShutdownStarted) return;
        Dispatcher.Invoke(() =>
        {
            if (Volatile.Read(ref _loading) == 1) SetStatus(line);
        });
    }

    void OnPromptKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || Keyboard.Modifiers != ModifierKeys.Control) return;
        e.Handled = true;
        _ = SendAsync();
    }

    void OnSend(object sender, RoutedEventArgs e) => _ = SendAsync();

    async Task SendAsync()
    {
        if (_busy || _host is null) return;
        var prompt = PromptBox.Text;
        if (string.IsNullOrWhiteSpace(prompt))
        {
            SetStatus("Write a prompt first.");
            return;
        }
        if (!TryTemperature(out var temperature)
            || !TryTopP(out var topP)
            || !TryTopK(out var topK)
            || !TrySeed(out var seed)
            || !TryMaxTokens(out var maxTokens)) return;

        _busy = true;
        SendButton.IsEnabled = false;
        SetStatus("Generating…");
        try
        {
            var raw = await _host.Session.CompleteAsync(prompt, temperature, topP, topK, seed, maxTokens, _lifetime.Token);
            ResponseBox.Text = EngineSession.FormatRaw(raw);
            ResponseBox.CaretIndex = 0;
            ResponseBox.ScrollToHome();
            ShowMarkdown(EngineSession.ExtractMarkdown(raw));
            SetStatus("Ready.");
        }
        catch (OperationCanceledException)
        {
            SetStatus("Stopped.");
        }
        catch (Exception ex)
        {
            ResponseBox.Text = ex.Message;
            ShowMarkdown(ex.Message);
            SetStatus(ex.Message);
        }
        finally
        {
            _busy = false;
            SendButton.IsEnabled = _host is not null && !_lifetime.IsCancellationRequested;
        }
    }

    bool TryTemperature(out double temperature)
    {
        var text = TemperatureBox.Text.Trim().Replace(',', '.');
        var parsed = double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out temperature);
        if (!parsed || !PromptLimits.TemperatureOk(temperature))
        {
            SetStatus("Temperature must be from 0 to 2.");
            temperature = 0;
            return false;
        }
        TemperatureSlider.Value = Math.Clamp(temperature, PromptLimits.MinTemperature, PromptLimits.MaxTemperature);
        return true;
    }

    bool TryMaxTokens(out int maxTokens)
    {
        if (!int.TryParse(MaxTokensBox.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out maxTokens)
            || !PromptLimits.MaxTokensOk(maxTokens))
        {
            SetStatus("Max tokens must be from 1 to 8192.");
            maxTokens = 0;
            return false;
        }
        return true;
    }

    bool TryTopP(out double topP)
    {
        var text = TopPBox.Text.Trim().Replace(',', '.');
        var parsed = double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out topP);
        if (!parsed || !PromptLimits.TopPOk(topP))
        {
            SetStatus("Top-p must be from 0 to 1.");
            topP = 0;
            return false;
        }
        return true;
    }

    bool TryTopK(out int topK)
    {
        if (!int.TryParse(TopKBox.Text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out topK)
            || !PromptLimits.TopKOk(topK))
        {
            SetStatus("Top-k must be from 0 to 500.");
            topK = 0;
            return false;
        }
        return true;
    }

    bool TrySeed(out int? seed)
    {
        var text = SeedBox.Text.Trim();
        if (text.Length == 0 || text.Equals("random", StringComparison.OrdinalIgnoreCase))
        {
            seed = null;
            return true;
        }
        if (int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            && PromptLimits.SeedOk(value))
        {
            seed = value;
            return true;
        }
        SetStatus("Seed must be random or from 0 to 2147483647.");
        seed = null;
        return false;
    }

    void SetStatus(string text) => StatusText.Text = text.Replace('\n', ' ').Trim();

    void ShowMarkdown(string markdown)
    {
        if (FindName("MarkdownBrowser") is not System.Windows.Controls.WebBrowser browser) return;
        var content = string.IsNullOrWhiteSpace(markdown) ? "_(empty response)_" : markdown;
        var body = Markdown.ToHtml(content);
        var html = """
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
body { font-family: 'Segoe UI', sans-serif; font-size: 14px; margin: 12px; line-height: 1.45; }
pre, code { font-family: 'Cascadia Mono', Consolas, monospace; }
pre { background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto; }
blockquote { border-left: 3px solid #ddd; margin: 0; padding-left: 10px; color: #555; }
</style>
</head>
<body>
__BODY__
</body>
</html>
""";
        browser.NavigateToString(html.Replace("__BODY__", body, StringComparison.Ordinal));
    }

    protected override void OnClosed(EventArgs e)
    {
        _lifetime.Cancel();
        _host?.Stop();
        _lifetime.Dispose();
        base.OnClosed(e);
    }
}
