import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseReleaseTag(tag) {
    const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
    if (!match || match[0] !== tag || match.slice(1).some(part => Number(part) > 65534 || String(Number(part)) !== part)) {
        throw new Error('Release tags must be vMAJOR.MINOR.PATCH with canonical numeric components from 0 to 65534.');
    }
    return { version: match.slice(1).join('.'), manifestVersion: `${match.slice(1).join('.')}.0` };
}

export function createManifest({ repository, tag, archiveName, archiveBytes, projectXml, now = new Date() }) {
    const { version, manifestVersion } = parseReleaseTag(tag);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
        throw new Error('Repository must be GitHub OWNER/REPOSITORY.');
    }
    if (archiveName !== `DailySpotlight_${version}.zip` || !archiveBytes.length) {
        throw new Error('Archive must be a nonempty DailySpotlight_VERSION.zip matching the release tag.');
    }
    const controllerVersion = /<PackageReference\s+Include="Jellyfin.Controller"\s+Version="(\d+\.\d+\.\d+)"/.exec(projectXml)?.[1];
    const modelVersion = /<PackageReference\s+Include="Jellyfin.Model"\s+Version="(\d+\.\d+\.\d+)"/.exec(projectXml)?.[1];
    if (!controllerVersion || controllerVersion !== modelVersion) {
        throw new Error('Expected matching pinned Jellyfin.Controller and Jellyfin.Model package versions.');
    }
    return [{
        guid: '60f798d5-340e-47bc-b618-50a1a040d454',
        name: 'DailySpotlight',
        description: 'Daily movie and series picks from each user\'s accessible libraries. The home row requires the companion script in the legacy Jellyfin Web layout; native clients are not modified.',
        overview: 'Rediscover your library with daily media picks.',
        owner: repository.split('/')[0],
        category: 'General',
        imageUrl: `https://github.com/${repository}/releases/download/${tag}/dailyspotlight.png`,
        versions: [{
            version: manifestVersion,
            changelog: `DailySpotlight ${version}. See https://github.com/${repository}/releases/tag/${tag} for release notes and setup instructions.`,
            targetAbi: `${controllerVersion}.0`,
            sourceUrl: `https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
            // Jellyfin's plugin installer expects MD5, not SHA-256. Hash the exact uploaded ZIP bytes.
            checksum: createHash('md5').update(archiveBytes).digest('hex'),
            timestamp: now.toISOString()
        }]
    }];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [repository, tag, archivePath, outputPath] = process.argv.slice(2);
    if (!repository || !tag || !archivePath || !outputPath || process.argv.length !== 6) {
        throw new Error('Usage: node scripts/create-manifest.mjs OWNER/REPO vX.Y.Z ARCHIVE_PATH OUTPUT_PATH');
    }
    const projectXml = readFileSync(new URL('../Jellyfin.Plugin.DailySpotlight/Jellyfin.Plugin.DailySpotlight.csproj', import.meta.url), 'utf8');
    const manifest = createManifest({ repository, tag, archiveName: basename(archivePath),
        archiveBytes: readFileSync(archivePath), projectXml });
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Created ${outputPath} for ${tag}, ABI ${manifest[0].versions[0].targetAbi}`);
}