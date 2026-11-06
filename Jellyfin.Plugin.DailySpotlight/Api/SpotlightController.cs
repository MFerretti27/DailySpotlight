using System.Globalization;
using Jellyfin.Data.Enums;
using Jellyfin.Plugin.DailySpotlight.Services;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Dto;
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
    public ActionResult<SpotlightResponse> GetItems()
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
            // Limit queries to the user's visible top-level libraries as well as content restrictions.
            var libraryIds = libraryManager.GetUserRootFolder().GetChildren(user, true)
                .Where(folder => folder.IsVisible(user)).Select(folder => folder.Id).ToArray();
            if (libraryIds.Length > 0)
            {
                var query = new InternalItemsQuery(user)
                {
                    Recursive = true,
                    TopParentIds = libraryIds,
                    IncludeItemTypes = types.ToArray(),
                    IsPlayed = config.UnwatchedOnly ? false : null,
                    IsMissing = false,
                    IsVirtualItem = false,
                    EnableTotalRecordCount = false
                };
                var candidates = libraryManager.GetItemList(query)
                    .Where(item => item.IsVisibleStandalone(user));
                var selected = DailySelection.Select(candidates, item => item.Id,
                    userId, day, config.Seed, config.ItemCount);
                items = dtoService.GetBaseItemDtos(selected, new DtoOptions(), user);
            }
        }

        return Ok(new SpotlightResponse(config.Enabled, config.Title,
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

public sealed record SpotlightResponse(bool Enabled, string Title, string Date, IReadOnlyList<BaseItemDto> Items);