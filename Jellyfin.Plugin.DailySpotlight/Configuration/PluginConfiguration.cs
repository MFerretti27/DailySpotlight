using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.DailySpotlight.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public bool Enabled { get; set; } = true;
    public string Title { get; set; } = "Your daily spotlight";
    public int ItemCount { get; set; } = 12;
    public bool IncludeMovies { get; set; } = true;
    public bool IncludeSeries { get; set; } = true;
    public bool UnwatchedOnly { get; set; }
    public string TimeZoneId { get; set; } = "UTC";
    public string Seed { get; set; } = "DailySpotlight";
}