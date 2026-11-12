const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const modulePromise = import('../../scripts/create-manifest.mjs');
const projectXml = readFileSync('Jellyfin.Plugin.DailySpotlight/Jellyfin.Plugin.DailySpotlight.csproj', 'utf8');
const input = {
    repository: 'MFerretti27/DailySpotlight', tag: 'v1.2.3', archiveName: 'DailySpotlight_1.2.3.zip',
    archiveBytes: Buffer.from('fixture archive bytes'), projectXml, now: new Date('2026-11-05T12:00:00Z')
};

test('catalog artwork is a valid 1280 by 720 PNG', async () => {
    const { default: sharp } = await import('sharp');
    const metadata = await sharp('assets/dailyspotlight.png').metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1280);
    assert.equal(metadata.height, 720);
});

test('generates a Jellyfin repository array with pinned asset URL, ABI and exact MD5', async () => {
    const { createManifest } = await modulePromise;
    const manifest = createManifest(input);
    assert.equal(manifest.length, 1);
    assert.equal(manifest[0].guid, '60f798d5-340e-47bc-b618-50a1a040d454');
    assert.equal(manifest[0].imageUrl, 'https://github.com/MFerretti27/DailySpotlight/releases/download/v1.2.3/dailyspotlight.png');
    const release = manifest[0].versions[0];
    assert.equal(release.version, '1.2.3.0');
    assert.equal(release.targetAbi, '12.4.0.0');
    assert.equal(release.sourceUrl, 'https://github.com/MFerretti27/DailySpotlight/releases/download/v1.2.3/DailySpotlight_1.2.3.zip');
    assert.equal(release.checksum, createHash('md5').update(input.archiveBytes).digest('hex'));
    assert.match(release.checksum, /^[a-f0-9]{32}$/);
    assert.equal(release.timestamp, '2026-11-05T12:00:00.000Z');
    assert.match(release.changelog, /\[release notes and setup instructions\]\(https:\/\/github\.com\/MFerretti27\/DailySpotlight\/releases\/tag\/v1\.2\.3\)/);
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
});

test('preserves and sorts published releases with clickable changelog links', async () => {
    const { createManifest } = await modulePromise;
    const older = version => createManifest({
        ...input, tag: `v${version}`, archiveName: `DailySpotlight_${version}.zip`
    });
    const oldManifest = older('1.0.0');
    const oldEntry = oldManifest[0].versions[0];
    oldEntry.changelog = 'Original notes. See https://github.com/MFerretti27/DailySpotlight/releases/tag/v1.0.0.';
    oldEntry.targetAbi = '10.10.0.0';
    const alreadyLinked = older('1.0.10');
    const previousReleases = [
        { tag: 'v1.0.0', manifest: oldManifest },
        { tag: 'v1.0.10', manifest: alreadyLinked }
    ];
    const releases = createManifest({ ...input, previousReleases })[0].versions;
    assert.deepEqual(releases.map(release => release.version), ['1.2.3.0', '1.0.10.0', '1.0.0.0']);
    assert.equal(releases[2].checksum, oldEntry.checksum);
    assert.equal(releases[2].targetAbi, '10.10.0.0');
    assert.equal(releases[2].timestamp, oldEntry.timestamp);
    assert.equal(releases[2].changelog, 'Original notes. See [https://github.com/MFerretti27/DailySpotlight/releases/tag/v1.0.0](https://github.com/MFerretti27/DailySpotlight/releases/tag/v1.0.0).');
    assert.equal(releases[1].changelog, alreadyLinked[0].versions[0].changelog);
    assert.equal(oldEntry.changelog, 'Original notes. See https://github.com/MFerretti27/DailySpotlight/releases/tag/v1.0.0.');
});

test('rejects invalid, duplicate, or newer published release history', async () => {
    const { createManifest } = await modulePromise;
    const old = createManifest({ ...input, tag: 'v1.0.0', archiveName: 'DailySpotlight_1.0.0.zip' });
    const previous = { tag: 'v1.0.0', manifest: old };
    assert.throws(() => createManifest({ ...input, previousReleases: [previous, previous] }), /Duplicate/);
    assert.throws(() => createManifest({ ...input, previousReleases: [{ tag: 'v1.0.1', manifest: old }] }), /Invalid manifest/);
    assert.throws(() => createManifest({ ...input, tag: 'v0.9.0', archiveName: 'DailySpotlight_0.9.0.zip',
        previousReleases: [previous] }), /newer than all published/);
    old[0].versions[0].checksum = 'bad';
    assert.throws(() => createManifest({ ...input, previousReleases: [previous] }), /Invalid manifest/);
});

test('loads every stable published release across pages and rejects missing manifests', async () => {
    const { loadPublishedReleaseManifests } = await modulePromise;
    const calls = [];
    const releases = [[
        { tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [{ name: 'manifest.json' }] },
        { tag_name: 'v1.1.0', draft: true, prerelease: false, assets: [] }
    ], [
        { tag_name: 'v1.0.1', draft: false, prerelease: false, assets: [{ name: 'manifest.json' }] },
        { tag_name: 'v1.2.0-beta', draft: false, prerelease: true, assets: [] }
    ]];
    const runGh = args => {
        calls.push(args);
        return args[0] === 'api' ? JSON.stringify(releases) : JSON.stringify([{ tag: args[2] }]);
    };
    const result = loadPublishedReleaseManifests(input.repository, runGh);
    assert.deepEqual(result.map(item => item.tag), ['v1.0.0', 'v1.0.1']);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], ['api', '--paginate', '--slurp', 'repos/MFerretti27/DailySpotlight/releases?per_page=100']);
    assert.deepEqual(calls[1], ['release', 'download', 'v1.0.0', '--repo', input.repository, '--pattern', 'manifest.json', '--output', '-']);
    releases[0][0].assets = [];
    assert.throws(() => loadPublishedReleaseManifests(input.repository, runGh), /v1.0.0 is missing manifest.json/);
});

test('only stable canonical version tags are accepted', async () => {
    const { parseReleaseTag } = await modulePromise;
    assert.deepEqual(parseReleaseTag('v1.2.3'), { version: '1.2.3', manifestVersion: '1.2.3.0' });
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-beta', 'v01.2.3', 'v65535.0.0', 'v1.2.3\n']) {
        assert.throws(() => parseReleaseTag(tag));
    }
});

test('resolves the next stable release tag or validates an explicit version', async () => {
    const { getLatestReleaseTag, resolveReleaseTag } = await modulePromise;
    assert.equal(resolveReleaseTag([]), 'v1.0.0');
    assert.equal(resolveReleaseTag(['v1.0.9', 'v1.0.10', 'not-a-release']), 'v1.0.11');
    assert.equal(getLatestReleaseTag(['v1.0.9', 'v1.0.10', 'not-a-release']), 'v1.0.10');
    assert.equal(resolveReleaseTag(['v1.2.3'], '1.3.0'), 'v1.3.0');
    assert.equal(resolveReleaseTag(['v1.2.3'], 'v1.2.4'), 'v1.2.4');
    assert.equal(resolveReleaseTag(['v1.2.3', 'v1.2.4'], '', 'v1.2.4'), 'v1.2.4');
    assert.equal(resolveReleaseTag(['v1.2.65534']), 'v1.3.0');
    assert.throws(() => resolveReleaseTag(['v1.2.3'], '1.2.3'), /already exists/);
    assert.throws(() => resolveReleaseTag(['v1.2.3'], '1.2.2'), /greater than the latest/);
    assert.throws(() => resolveReleaseTag([], '1.2'), /Release tags must be/);
});

test('rejects mismatched archives, invalid repository names and inconsistent server packages', async () => {
    const { createManifest } = await modulePromise;
    assert.throws(() => createManifest({ ...input, archiveName: 'DailySpotlight_1.0.0.zip' }));
    assert.throws(() => createManifest({ ...input, archiveBytes: Buffer.alloc(0) }));
    assert.throws(() => createManifest({ ...input, repository: 'https://github.com/owner/repo' }));
    assert.throws(() => createManifest({ ...input, projectXml: '' }));
    assert.throws(() => createManifest({ ...input,
        projectXml: projectXml.replace('Include="Jellyfin.Model" Version="12.4.0"', 'Include="Jellyfin.Model" Version="12.3.0"') }));
});