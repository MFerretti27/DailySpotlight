using Jellyfin.Plugin.DailySpotlight.Services;
using Xunit;

namespace DailySpotlight.Tests;

public sealed class DailySelectionTests
{
    private static readonly Guid UserId = Guid.Parse("910b57b8-1834-49dc-80f4-1d48b26aa109");
    private static readonly DateOnly Day = new(2026, 11, 5);
    private static readonly Guid[] Items = Enumerable.Range(1, 200)
        .Select(value => new Guid(value, 0, 0, new byte[8])).ToArray();

    private static IReadOnlyList<Guid> Pick(IEnumerable<Guid> items, DateOnly? day = null,
        Guid? user = null, string seed = "test", int count = 12) =>
        DailySelection.Select(items, id => id, user ?? UserId, day ?? Day, seed, count);

    [Fact]
    public void PicksAreStableAndIndependentOfLibraryOrder() =>
        Assert.Equal(Pick(Items), Pick(Items.Reverse()));

    [Fact]
    public void PicksChangeWithDayUserOrSeed()
    {
        var original = Pick(Items);
        Assert.False(original.SequenceEqual(Pick(Items, day: Day.AddDays(1))));
        Assert.False(original.SequenceEqual(Pick(Items, user: Guid.Empty)));
        Assert.False(original.SequenceEqual(Pick(Items, seed: "other")));
    }

    [Fact]
    public void PicksAreUniqueAndNeverInventCandidates()
    {
        var picks = Pick(Items.Concat(Items));
        Assert.Equal(12, picks.Count);
        Assert.Equal(picks.Count, picks.Distinct().Count());
        Assert.All(picks, item => Assert.Contains(item, Items));
    }

    [Theory]
    [InlineData(-10, 1)]
    [InlineData(0, 1)]
    [InlineData(8, 8)]
    [InlineData(500, 50)]
    public void CountIsClamped(int requested, int expected) =>
        Assert.Equal(expected, Pick(Items, count: requested).Count);

    [Fact]
    public void EmptyAndSmallLibrariesAreSupported()
    {
        Assert.Empty(Pick([]));
        Assert.Equal(2, Pick(Items.Take(2)).Count);
    }

    [Fact]
    public void DailyResetUsesConfiguredZone()
    {
        var now = DateTimeOffset.Parse("2026-11-05T01:00:00Z");
        Assert.Equal(new DateOnly(2026, 11, 4), DailySelection.GetDay(now, "America/New_York"));
        Assert.Equal(Day, DailySelection.GetDay(now, "UTC"));
        Assert.Equal(Day, DailySelection.GetDay(now, "not-a-time-zone"));
        Assert.Equal(Day, DailySelection.GetDay(now, null));
    }

    [Fact]
    public void DaylightSavingTransitionResetsAtLocalMidnight()
    {
        Assert.Equal(new DateOnly(2026, 11, 1), DailySelection.GetDay(
            DateTimeOffset.Parse("2026-11-01T06:30:00Z"), "America/New_York"));
        Assert.Equal(new DateOnly(2026, 11, 2), DailySelection.GetDay(
            DateTimeOffset.Parse("2026-11-02T05:00:00Z"), "America/New_York"));
    }
}