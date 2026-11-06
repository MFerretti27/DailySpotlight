using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.DailySpotlight.Services;

/// <summary>Stateless daily ranking, independent of database order and process restarts.</summary>
public static class DailySelection
{
    public static DateOnly GetDay(DateTimeOffset now, string? timeZoneId)
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId ?? "UTC");
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        {
            zone = TimeZoneInfo.Utc;
        }

        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
    }

    public static IReadOnlyList<T> Select<T>(IEnumerable<T> candidates, Func<T, Guid> getId,
        Guid userId, DateOnly day, string? seed, int count)
    {
        var prefix = $"{seed}|{day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}|{userId:N}|";
        return candidates
            .DistinctBy(getId)
            .Select(item => (Item: item, Id: getId(item), Rank: Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(prefix + getId(item).ToString("N"))))))
            .OrderBy(entry => entry.Rank, StringComparer.Ordinal)
            .ThenBy(entry => entry.Id)
            .Take(Math.Clamp(count, 1, 50))
            .Select(entry => entry.Item)
            .ToArray();
    }
}