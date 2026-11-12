import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

export function getLatestReleaseTag(existingTags) {
    const parsedTags = existingTags.flatMap(tag => {
        try {
            return [{ tag, parts: parseReleaseTag(tag).version.split('.').map(Number) }];
        } catch {
            return [];
        }
    });
    const compareParts = (left, right) => {
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return left[index] - right[index];
        }
        return 0;
    };
    const latest = parsedTags.reduce((current, candidate) =>
        !current || compareParts(candidate.parts, current.parts) > 0 ? candidate : current, undefined);
    return latest?.tag;
}

export function resolveReleaseTag(existingTags, requestedVersion = '', resumeTag = '') {
    const latestTag = getLatestReleaseTag(existingTags);
    const parseParts = tag => parseReleaseTag(tag).version.split('.').map(Number);
    const compareParts = (left, right) => {
        for (let index = 0; index < left.length; index += 1) {
            if (left[index] !== right[index]) return left[index] - right[index];
        }
        return 0;
    };
    const latestParts = latestTag ? parseParts(latestTag) : undefined;

    const input = requestedVersion.trim();
    if (input) {
        const tag = input.startsWith('v') ? input : `v${input}`;
        const requestedParts = parseParts(tag);
        if (existingTags.includes(tag)) {
            throw new Error(`Release tag ${tag} already exists.`);
        }
        if (latestTag && compareParts(requestedParts, latestParts) <= 0) {
            throw new Error(`Release version ${tag} must be greater than the latest tag ${latestTag}.`);
        }
        return tag;
    }

    if (resumeTag) {
        if (!existingTags.includes(resumeTag)) {
            throw new Error(`Cannot resume release because tag ${resumeTag} does not exist.`);
        }
        parseReleaseTag(resumeTag);
        return resumeTag;
    }

    if (!latestTag) return 'v1.0.0';

    const [major, minor, patch] = latestParts;
    if (patch < 65534) return `v${major}.${minor}.${patch + 1}`;
    if (minor < 65534) return `v${major}.${minor + 1}.0`;
    if (major < 65534) return `v${major + 1}.0.0`;
    throw new Error('Cannot automatically increment the release version beyond v65534.65534.65534.');
}

export function loadPublishedReleaseManifests(repository, runGh = args =>
    execFileSync('gh', args, { encoding: 'utf8' })) {
    const pages = JSON.parse(runGh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`]));
    return pages.flat().filter(release => {
        if (release.draft || release.prerelease) return false;
        try {
            parseReleaseTag(release.tag_name);
            return true;
        } catch {
            return false;
        }
    }).map(release => {
        if (!release.assets.some(asset => asset.name === 'manifest.json')) {
            throw new Error(`Published release ${release.tag_name} is missing manifest.json.`);
        }
        const content = runGh(['release', 'download', release.tag_name, '--repo', repository,
            '--pattern', 'manifest.json', '--output', '-']);
        return { tag: release.tag_name, manifest: JSON.parse(content) };
    });
}

export function createManifest({ repository, tag, archiveName, archiveBytes, projectXml, now = new Date(), previousReleases = [] }) {
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
    const releaseUrl = releaseTag => `https://github.com/${repository}/releases/tag/${releaseTag}`;
    const changelog = (releaseVersion, releaseTag) =>
        `DailySpotlight ${releaseVersion}. See [release notes and setup instructions](${releaseUrl(releaseTag)}).`;
    const previousVersions = previousReleases.map(previous => {
        const previousTag = parseReleaseTag(previous.tag);
        const plugin = Array.isArray(previous.manifest) &&
            previous.manifest.find(entry => entry.guid === '60f798d5-340e-47bc-b618-50a1a040d454');
        const entry = plugin && Array.isArray(plugin.versions) &&
            plugin.versions.find(item => item.version === previousTag.manifestVersion);
        const expectedSource = `https://github.com/${repository}/releases/download/${previous.tag}/DailySpotlight_${previousTag.version}.zip`;
        if (!entry || entry.sourceUrl !== expectedSource || !/^[a-f0-9]{32}$/i.test(entry.checksum) ||
            typeof entry.targetAbi !== 'string' || !entry.targetAbi || !Number.isFinite(Date.parse(entry.timestamp))) {
            throw new Error(`Invalid manifest for published release ${previous.tag}.`);
        }
        const url = releaseUrl(previous.tag);
        const originalChangelog = typeof entry.changelog === 'string' ? entry.changelog : '';
        const linkedChangelog = originalChangelog.includes(`[${url}](${url})`) || originalChangelog.includes(`](${url})`)
            ? originalChangelog
            : originalChangelog.includes(url)
                ? originalChangelog.replace(url, `[${url}](${url})`)
                : `${originalChangelog}${originalChangelog ? '\n\n' : ''}[Release notes and setup instructions](${url}).`;
        return { ...entry, changelog: linkedChangelog };
    });
    const allTags = [tag, ...previousReleases.map(release => release.tag)];
    if (new Set(allTags).size !== allTags.length) throw new Error('Duplicate release tags in manifest history.');
    if (getLatestReleaseTag(allTags) !== tag) {
        throw new Error(`Release ${tag} must be newer than all published releases.`);
    }
    const compareVersions = (left, right) => {
        const leftParts = left.version.split('.').map(Number);
        const rightParts = right.version.split('.').map(Number);
        for (let index = 0; index < leftParts.length; index += 1) {
            if (leftParts[index] !== rightParts[index]) return rightParts[index] - leftParts[index];
        }
        return 0;
    };
    return [{
        guid: '60f798d5-340e-47bc-b618-50a1a040d454',
        name: 'DailySpotlight',
        description: 'Daily movie and series picks from each user\'s accessible libraries. The home row is automatically injected into the legacy Jellyfin Web layout; native clients are not modified.',
        overview: 'Rediscover your library with daily media picks.',
        owner: repository.split('/')[0],
        category: 'General',
        imageUrl: `https://github.com/${repository}/releases/download/${tag}/dailyspotlight.png`,
        versions: [{
            version: manifestVersion,
            changelog: changelog(version, tag),
            targetAbi: `${controllerVersion}.0`,
            sourceUrl: `https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
            // Jellyfin's plugin installer expects MD5, not SHA-256. Hash the exact uploaded ZIP bytes.
            checksum: createHash('md5').update(archiveBytes).digest('hex'),
            timestamp: now.toISOString()
        }, ...previousVersions].sort(compareVersions)
    }];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [repository, tag, archivePath, outputPath, historyOption] = process.argv.slice(2);
    if (!repository || !tag || !archivePath || !outputPath ||
        (historyOption !== undefined && historyOption !== '--published-history') || process.argv.length > 7) {
        throw new Error('Usage: node scripts/create-manifest.mjs OWNER/REPO vX.Y.Z ARCHIVE_PATH OUTPUT_PATH [--published-history]');
    }
    const projectXml = readFileSync(new URL('../Jellyfin.Plugin.DailySpotlight/Jellyfin.Plugin.DailySpotlight.csproj', import.meta.url), 'utf8');
    const manifest = createManifest({ repository, tag, archiveName: basename(archivePath),
        archiveBytes: readFileSync(archivePath), projectXml,
        previousReleases: historyOption ? loadPublishedReleaseManifests(repository) : [] });
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Created ${outputPath} for ${tag}, ABI ${manifest[0].versions[0].targetAbi}`);
}