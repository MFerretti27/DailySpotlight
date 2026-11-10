using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.DailySpotlight.Configuration;

public sealed class PluginConfiguration : BasePluginConfiguration
{
    public bool Enabled { get; set; } = true;
    public string Title { get; set; } = "Daily Spotlight";
    public int ItemCount { get; set; } = 20;
    public string HomePosition { get; set; } = "after-my-media";
    public bool IncludeMovies { get; set; } = true;
    public bool IncludeSeries { get; set; } = true;
    public bool UnwatchedOnly { get; set; }
    public bool ShowShuffleButton { get; set; } = true;
    public string TimeZoneId { get; set; } = "UTC";
    public string Seed { get; set; } = "DailySpotlight";
}