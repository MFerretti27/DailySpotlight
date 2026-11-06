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
    assert.deepEqual(JSON.parse(JSON.stringify(manifest)), manifest);
});

test('only stable canonical version tags are accepted', async () => {
    const { parseReleaseTag } = await modulePromise;
    assert.deepEqual(parseReleaseTag('v1.2.3'), { version: '1.2.3', manifestVersion: '1.2.3.0' });
    for (const tag of ['1.2.3', 'v1.2', 'v1.2.3.4', 'v1.2.3-beta', 'v01.2.3', 'v65535.0.0', 'v1.2.3\n']) {
        assert.throws(() => parseReleaseTag(tag));
    }
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