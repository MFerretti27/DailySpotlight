using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Jellyfin.Plugin.DailySpotlight.Configuration;

namespace Jellyfin.Plugin.DailySpotlight;

public sealed class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
        if (string.Equals(Configuration.Title, "Your daily spotlight", StringComparison.Ordinal))
        {
            Configuration.Title = "Daily Spotlight";
            UpdateConfiguration(Configuration);
        }
    }

    public static Plugin? Instance { get; private set; }
    public override string Name => "DailySpotlight";
    public override string Description => "Rediscover your library with daily media picks.";
    public override Guid Id => Guid.Parse("60f798d5-340e-47bc-b618-50a1a040d454");

    public IEnumerable<PluginPageInfo> GetPages() =>
    [
        new PluginPageInfo
        {
            Name = Name,
            DisplayName = "Daily Spotlight",
            EmbeddedResourcePath = "Jellyfin.Plugin.DailySpotlight.Configuration.configPage.html",
            EnableInMainMenu = true,
            MenuSection = "plugins",
            MenuIcon = "highlight"
        }
    ];
}