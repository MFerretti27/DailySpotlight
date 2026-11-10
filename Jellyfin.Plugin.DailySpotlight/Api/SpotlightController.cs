using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.DailySpotlight.Services;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.DailySpotlight.Api;

[ApiController]
[Authorize]
[Route("DailySpotlight")]
public sealed class SpotlightController(
    ILibraryManager libraryManager,
    IUserManager userManager,
    IDtoService dtoService) : ControllerBase
{
    [HttpGet("Items")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public ActionResult<SpotlightResponse> GetItems([FromQuery] bool shuffle = false)
    {
        // Never accept a caller-supplied user ID or treat an administrator API key as a user.
        if (string.Equals(User.FindFirst("Jellyfin-IsApiKey")?.Value, "True", StringComparison.OrdinalIgnoreCase)
            || !Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var userId)
            || userId == Guid.Empty || userManager.GetUserById(userId) is not { } user)
        {
            return Unauthorized();
        }

        var config = Plugin.Instance?.Configuration;
        if (config is null)
        {
            return StatusCode(503);
        }

        var day = DailySelection.GetDay(DateTimeOffset.UtcNow, config.TimeZoneId);
        var types = new List<BaseItemKind>();
        if (config.IncludeMovies) types.Add(BaseItemKind.Movie);
        if (config.IncludeSeries) types.Add(BaseItemKind.Series);

        IReadOnlyList<BaseItemDto> items = [];
        if (config.Enabled && types.Count > 0)
        {
            var query = new InternalItemsQuery(user)
            {
                Recursive = true,
                IncludeItemTypes = types.ToArray(),
                IsPlayed = config.UnwatchedOnly ? false : null,
                IsMissing = false,
                IsVirtualItem = false,
                EnableTotalRecordCount = false
            };
            // Jellyfin 12.4 requires this helper to apply the user's accessible library scope.
            libraryManager.ConfigureUserAccess(query, user);
            var candidates = libraryManager.GetItemList(query)
                .Where(item => item.IsVisibleStandalone(user));
            var selectionSeed = shuffle ? $"{config.Seed}|{Guid.NewGuid():N}" : config.Seed;
            var selected = DailySelection.Select(candidates, item => item.Id,
                userId, day, selectionSeed, config.ItemCount);
            var dtoOptions = new DtoOptions
            {
                EnableImages = true,
                EnableUserData = true,
                ImageTypes = [ImageType.Primary],
                ImageTypeLimit = 1
            };
            items = dtoService.GetBaseItemDtos(selected, dtoOptions, user);
        }

        return Ok(new SpotlightResponse(config.Enabled, config.Title, config.ShowShuffleButton,
            config.IncludeMovies && config.IncludeSeries,
            day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), items));
    }

    // Public executable asset contains no configuration, library data, or credentials.
    [AllowAnonymous]
    [HttpGet("Client.js")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public IActionResult GetClientScript()
    {
        var stream = typeof(Plugin).Assembly.GetManifestResourceStream(
            "Jellyfin.Plugin.DailySpotlight.Web.dailyspotlight.js");
        return stream is null ? NotFound() : File(stream, "application/javascript; charset=utf-8");
    }
}

public sealed record SpotlightResponse(
    bool Enabled,
    string Title,
    bool ShowShuffleButton,
    bool ShowMediaType,
    string Date,
    IReadOnlyList<BaseItemDto> Items);