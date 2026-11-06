# DailySpotlight

<p align="center">
	<img src="assets/dailyspotlight.png" alt="DailySpotlight — A fresh pick. Every day." width="900">
</p>

<p align="center">
	<a href="https://github.com/MFerretti27/DailySpotlight/actions/workflows/ci.yml">
		<img src="https://github.com/MFerretti27/DailySpotlight/actions/workflows/ci.yml/badge.svg" alt="Build and test status">
	</a>
	<a href="https://github.com/MFerretti27/DailySpotlight/releases">
		<img src="https://img.shields.io/github/downloads/MFerretti27/DailySpotlight/total?label=release%20downloads&amp;color=00a4dc" alt="Total GitHub release asset downloads">
	</a>
</p>

Rediscover your Jellyfin library with a daily row of movie and series picks.

## What it does

- Shows a horizontally scrolling poster row at the top of the legacy Jellyfin Web home tab.
- Chooses deterministic, shuffled picks for each user and calendar day.
- Resets at midnight in a configurable time zone (UTC by default).
- Supports movies, series, 1–50 picks, and an unwatched-only filter.
- Respects the signed-in user's accessible libraries and content restrictions.
- Opens the normal Jellyfin item detail page when a poster is selected.
- Includes dashboard settings, authenticated API, embedded web script, tests, and ZIP packaging.

**Compatibility:** this initial version targets **Jellyfin Server 12.4 / .NET 10** and the **legacy Jellyfin Web home layout**. It does not target Jellyfin 10.10/10.11, the modern web layout, or native TV/mobile home screens. Installing a server plugin alone cannot add UI to every Jellyfin client.

## Install the server plugin


Add this **URL**  in **Dashboard → Plugins → Repositories → Add**:

```text
https://github.com/MFerretti27/DailySpotlight/releases/latest/download/manifest.json
```

Name the repository **DailySpotlight**, save, then open the **Catalog**, select **DailySpotlight**, install, and restart Jellyfin.

### Manual installation

1. Back up your Jellyfin configuration.
2. Stop Jellyfin.
3. Create a `DailySpotlight_1.0.0` folder inside **your Jellyfin data directory's `plugins` folder** and extract the ZIP there. For the official Docker image, this is normally `/config/plugins/DailySpotlight_1.0.0/`.
4. Start Jellyfin.
5. Open **Dashboard → Plugins → DailySpotlight → Settings**, configure the row, and save.

The server should expose `GET /DailySpotlight/Client.js` and authenticated `GET /DailySpotlight/Items` relative to its configured base URL. The latter requires a signed-in user token; administrator API keys are not a substitute for a user session.

## Install the web home row

The companion script must be loaded by the **web client you actually use**. The server plugin does not modify Jellyfin Web files automatically.

1. Back up Jellyfin Web's `index.html`.
2. Add this just before its closing `</body>` tag:

	 ```html
	 <script defer src="../DailySpotlight/Client.js"></script>
	 ```

3. Reload Jellyfin Web, using a hard refresh if needed, and sign in.

The relative URL works when the web document is served under `/web/`, including deployments such as `/jellyfin/web/`. If your client is hosted somewhere else, adjust the script URL to point at your server's `DailySpotlight/Client.js` endpoint. Separately hosted clients also need correctly configured CORS and content-security policy; same-origin hosting is recommended.

Common web directories include `/usr/share/jellyfin/web` (Linux packages) and `/jellyfin/jellyfin-web` (official Docker image). Paths vary: inspect your installation rather than assuming these exist. Docker web files may need to be supplied by a custom image or persistent mount; edits inside a running container disappear when it is recreated. Do not mount only an index document from a different Jellyfin release because hashed bundle filenames change.

**Web updates can replace the index document.** Reapply the script tag after updating and confirm the plugin still matches the server ABI. Custom CSS by itself cannot load this JavaScript. No row appears in the modern web layout or native clients.

To uninstall, remove the script tag, stop Jellyfin, remove the plugin folder, and restart.

## Settings

| Setting | Default | Behavior |
| --- | --- | --- |
| Enabled | On | Disabling removes the row on its next refresh. |
| Title | Your daily spotlight | Heading displayed above the posters. |
| Item count | 12 | Clamped to 1–50 by the server. |
| Include movies / series | Both on | Disabling both produces no picks. |
| Unwatched only | Off | Uses Jellyfin's played state, including its series semantics. |
| Time zone | UTC | IANA ID such as `America/New_York`; invalid identifiers fall back to UTC. |
| Seed | DailySpotlight | Changing it reshuffles the ranking. Not a secret. |

Picks are stable **while the eligible library, watched state, user, and settings remain unchanged**. New media, removals, permission changes, or unwatched-state changes can alter the row during the day. Consecutive days may contain some of the same titles; this is daily random discovery, not a no-repeat scheduler. Small libraries show fewer picks.

The web row refreshes when Home is shown, when the browser becomes visible, and roughly once per minute while visible. No plugin-specific recommendation database or scheduled task is needed. For correctness after permission changes, server requests re-query the eligible library rather than serving an all-day permission cache. This first version loads eligible candidates and sorts their hashes per request; very large libraries may need a later bounded-selection optimization.

## API

`GET /DailySpotlight/Items` returns a standard JSON envelope:

```json
{
	"Enabled": true,
	"Title": "Your daily spotlight",
	"Date": "2026-11-05",
	"Items": []
}
```

`Items` contains Jellyfin `BaseItemDto` objects. Identity comes from the authenticated `Jellyfin-UserId` claim, never a query parameter. Responses are marked `no-store`. The public JavaScript asset contains no tokens or library data, and requests use the current client's token without persisting it.

## Development and validation

```sh
dotnet test tests/DailySpotlight.Tests/DailySpotlight.Tests.csproj -c Release
npm ci
npm test
npm run check
```

VS Code build, test, and package tasks are included. CI runs the server, web, and release-manifest tests and uploads the plugin ZIP. `build.yaml` describes the release for Jellyfin's plugin build tooling; it is **not** a hosted plugin repository manifest. The release workflow generates the actual repository manifest from the uploaded archive's bytes.

## Publish a GitHub Release

The **Publish Jellyfin plugin** workflow runs when a stable version tag such as `v1.0.0` is pushed. Commit and push the project and workflow first, then create and push the tag:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Use a new, increasing `vMAJOR.MINOR.PATCH` tag for each release. Prerelease suffixes and four-component tags are rejected. The tag determines the assembly/package version even if the project file's development version has not changed. Never move a published tag or replace its ZIP: installed versions and checksums must remain trustworthy.

The workflow:

1. Validates the version tag, runs the .NET tests and the web/manifest tests.
2. Builds a ZIP containing only the versioned plugin assembly.
3. Generates `manifest.json` with a four-component plugin version, the Jellyfin package ABI, a tag-pinned ZIP download URL, and an **MD5** checksum as required by Jellyfin's installer.
4. Creates a draft GitHub Release and uploads the plugin ZIP, `manifest.json`, the standalone companion `dailyspotlight.js` (also embedded in the DLL), and the catalog banner `dailyspotlight.png`.
5. Adds installation instructions to the release notes, then publishes the release as **Latest** so the stable repository URL resolves.

The manifest's `imageUrl` points to that release's banner asset, allowing Jellyfin to show the artwork in its plugin catalog. Artwork is available in `assets/dailyspotlight.svg` (editable source) and `assets/dailyspotlight.png` (1280 × 720 release image). After changing the SVG, run `npm run artwork` and commit the updated PNG. The workflow uploads the committed PNG, which is validated by the test suite. Existing releases will not gain the image until a new version is published and Jellyfin refreshes the repository.

Only the release job receives `contents: write`; it uses GitHub's built-in `GITHUB_TOKEN`, with no personal access token required. Repository or organization policy must allow that token to create releases. Failed uploads leave a draft that can be completed by rerunning the workflow. Reruns refuse to replace assets on an already published release. If you manually create future releases, include a valid manifest asset or the `/releases/latest/download/manifest.json` URL can stop working.

The manifest advertises the latest release only, not a historical version catalog. The ZIP URL inside it is pinned to that release tag. Forks automatically use their own GitHub repository in generated manifests and release notes; update the installation URL above when documenting a fork.

To check manifest generation locally after packaging:

```sh
node scripts/create-manifest.mjs MFerretti27/DailySpotlight v1.0.0 artifacts/DailySpotlight_1.0.0.zip artifacts/manifest.json
```

The repository URL will not work until the first release workflow completes. Adding this URL does not publish anything by itself.

## Live validation

Open `tests/web/preview.html` in a browser for a mock home-screen preview with fictional media. It exercises the real companion script but does not connect to Jellyfin.

Automated coverage includes deterministic selection, input-order independence, uniqueness, count bounds, time zones/DST, safe DOM text rendering, authenticated base-path-aware requests, duplicate script loading, logout, and stale account-switch responses. These tests do **not** constitute a live Jellyfin server integration test.

Before deployment, test against a disposable Jellyfin 12.4 server with real libraries:

- Confirm the plugin loads without errors and settings survive a restart.
- Confirm the row appears on the legacy home tab and its posters open the correct items.
- Compare two accounts, including one with blocked libraries and parental restrictions.
- Confirm anonymous requests and API-key-only requests to the items endpoint are rejected.
- Verify unwatched filtering, empty libraries, disabled state, and missing artwork.
- Check a reverse-proxy base path, login/logout, navigation, and the daily reset.

No existing Jellyfin server or web installation was modified to create this project.
