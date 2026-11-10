const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const script = readFileSync('Jellyfin.Plugin.DailySpotlight/Web/dailyspotlight.js', 'utf8');
const id = '910b57b8183449dc80f41d48b26aa109';

function setup(response, ajaxImpl) {
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="indexPage"><div id="homeTab"><div class="sections"><section class="verticalSection section0"><h2 class="sectionTitle">My Media</h2><div class="homeLibraryButtonContainer"></div></section><section class="verticalSection section1"><h2 class="sectionTitle">Latest Movies</h2></section></div></div></div></body></html>', {
        url: 'https://jellyfin.example/web/', runScripts: 'outside-only'
    });
    const requests = [];
    const upgraded = [];
    dom.window.CustomElements = { upgradeSubtree: element => upgraded.push(element) };
    dom.window.ApiClient = {
        getCurrentUserId: () => 'user-1', accessToken: () => 'test-token',
        serverAddress: () => 'https://jellyfin.example/jellyfin', serverId: () => 'server-1',
        getUrl: path => `https://jellyfin.example/jellyfin/${path}`,
        getScaledImageUrl: (item, options) => `https://jellyfin.example/jellyfin/Items/${item}/Images/${options.type}?width=${options.width}&tag=${options.tag || ''}`
    };
    dom.window.ApiClient.ajax = async options => {
        requests.push(options);
        return ajaxImpl ? ajaxImpl(options) : response;
    };
    dom.window.eval(script);
    return { dom, requests, upgraded, document: dom.window.document };
}

const result = { Enabled: true, Title: 'Daily picks', ShowShuffleButton: true, ShowMediaType: true, Date: '2026-11-05', Items: [
    { Id: id, Name: 'Example film', Type: 'Movie', ProductionYear: 2024, ImageTags: { Primary: 'tag' } }
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('renders accessible poster cards and authenticated base-path-aware requests', async () => {
    const app = setup(result);
    try {
        await flush();
        assert.equal(app.document.querySelectorAll('.dailySpotlightCard.overflowPortraitCard').length, 1);
        assert.equal(app.document.querySelector('.dailySpotlight .sectionTitle').textContent, 'Daily picks');
        assert.equal(app.document.querySelector('.dailySpotlightDate'), null);
        assert.equal(app.document.querySelector('.dailySpotlightCard .cardImageContainer').getAttribute('href'), `#/details?id=${id}&serverId=server-1`);
        assert.equal(app.document.querySelector('.dailySpotlightCard').dataset.id, id);
        assert.ok(app.document.querySelector('.dailySpotlightCard.card-hoverable [data-action="resume"]'));
        assert.equal(app.document.querySelector('.dailySpotlightCard button[is="emby-playstatebutton"]')?.dataset.played, 'false');
        assert.equal(app.document.querySelector('.dailySpotlightCard button[is="emby-ratingbutton"]')?.dataset.isfavorite, 'false');
        assert.ok(app.document.querySelector('.dailySpotlightCard [data-action="menu"]'));
        const posterScalable = app.document.querySelector('.dailySpotlightCard .cardScalable');
        assert.ok(posterScalable.contains(posterScalable.querySelector('.cardOverlayContainer')));
        assert.equal(app.document.querySelector('.dailySpotlightCard .cardFooter').parentElement, app.document.querySelector('.dailySpotlightCard .cardBox'));
        assert.ok(app.document.querySelector('.dailySpotlightShuffleButton'));
        assert.equal(app.document.querySelector('.dailySpotlight').previousElementSibling.querySelector('.sectionTitle').textContent, 'My Media');
        assert.ok(app.document.querySelector('.itemsContainer.scrollSlider'));
        assert.ok(app.document.querySelector('.cardTextCentered'));
        assert.ok(app.document.querySelector('.dailySpotlight .cardText').textContent.includes('Example film'));
        assert.equal(app.document.querySelector('.dailySpotlight .cardText-secondary').textContent, '2024 · Movie');
        const rowStyles = app.document.querySelector('style').textContent;
        assert.match(rowStyles, /\.dailySpotlightShuffleButton \{ flex: 0 0 auto; width: 2em; height: 2em; min-width: 2em;/);
        assert.ok(app.document.querySelector('.cardPadder-overflowPortrait'));
        assert.doesNotMatch(rowStyles, /\.dailySpotlight \.portraitCard/);
        assert.match(rowStyles, /\.dailySpotlight \.cardText \{ text-align: center !important; \}/);
        assert.match(rowStyles, /text-decoration: none !important;/);
        assert.equal(app.upgraded[0], app.document.querySelector('.dailySpotlight'));
        assert.equal(app.document.querySelector('.dailySpotlightPoster').getAttribute('src'),
            `https://jellyfin.example/jellyfin/Items/${id}/Images/Primary?width=400&tag=tag`);
        assert.equal(app.requests[0].url, 'https://jellyfin.example/jellyfin/DailySpotlight/Items');
        assert.equal(app.requests[0].type, 'GET');
        assert.equal(app.requests[0].dataType, 'json');
        app.dom.window.eval(script);
        assert.equal(app.requests.length, 1);
        const originalCard = app.document.querySelector('.dailySpotlightCard');
        app.document.dispatchEvent(new app.dom.window.CustomEvent('viewshow'));
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlightCard'), originalCard);
    } finally { app.dom.window.close(); }
});

test('hides media type labels when only one media type is enabled', async () => {
    const app = setup({ ...result, ShowMediaType: false, Items: [
        { Id: id, Name: 'Example film', Type: 'Movie', ProductionYear: 2024 },
        { Id: '510b57b8183449dc80f41d48b26aa101', Name: 'Example series', Type: 'Series', ProductionYear: 2023 }
    ] });
    try {
        await flush();
        assert.deepEqual(
            Array.from(app.document.querySelectorAll('.dailySpotlight .cardText-secondary'), meta => meta.textContent),
            ['2024', '2023']
        );
    } finally { app.dom.window.close(); }
});

test('shuffle button requests and displays a fresh selection', async () => {
    const newId = '510b57b8183449dc80f41d48b26aa101';
    const shuffledResult = { ...result, Items: [
        { Id: newId, Name: 'A different film', Type: 'Movie', ProductionYear: 2022 }
    ] };
    let callCount = 0;
    const app = setup(result, () => (++callCount === 1 ? result : shuffledResult));
    try {
        await flush();
        app.document.querySelector('.dailySpotlightShuffleButton').click();
        await flush();
        assert.equal(app.requests[1].url, 'https://jellyfin.example/jellyfin/DailySpotlight/Items?shuffle=true');
        assert.equal(app.document.querySelector('.dailySpotlightCard .cardImageContainer').getAttribute('href'), `#/details?id=${newId}&serverId=server-1`);
        assert.equal(app.document.querySelector('.dailySpotlightShuffleButton').disabled, false);
    } finally { app.dom.window.close(); }
});

test('hides the shuffle button when disabled by an administrator', async () => {
    const app = setup({ ...result, ShowShuffleButton: false });
    try {
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlightShuffleButton'), null);
    } finally { app.dom.window.close(); }
});

test('uses Daily Spotlight when the configured heading is empty', async () => {
    const app = setup({ ...result, Title: '' });
    try {
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlight .sectionTitle').textContent, 'Daily Spotlight');
    } finally { app.dom.window.close(); }
});

test('treats titles and media names as text, never HTML', async () => {
    const app = setup({ ...result, Title: '<img src=x onerror=alert(1)>', Items: [
        { Id: id, Name: '<script>bad()</script>', Type: 'Series' },
        { Id: 'javascript:bad()', Name: 'Invalid' }
    ] });
    try {
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlight .sectionTitle').textContent, '<img src=x onerror=alert(1)>');
        assert.equal(app.document.querySelectorAll('script').length, 0);
        assert.equal(app.document.querySelectorAll('.dailySpotlightPoster').length, 1);
        assert.equal(app.document.querySelectorAll('.dailySpotlightCard').length, 1);
    } finally { app.dom.window.close(); }
});

test('attempts to load the primary poster when the item has no image tag', async () => {
    const app = setup({ ...result, Items: [{ Id: id, Name: 'No tag movie', Type: 'Movie' }] });
    try {
        await flush();
        const image = app.document.querySelector('.dailySpotlightPoster');
        assert.ok(image);
        assert.equal(image.getAttribute('src'),
            `https://jellyfin.example/jellyfin/Items/${id}/Images/Primary?width=400&tag=`);
    } finally { app.dom.window.close(); }
});

test('disabled and empty responses do not insert a row', async () => {
    for (const response of [{ ...result, Enabled: false }, { ...result, Items: [] }]) {
        const app = setup(response);
        try { await flush(); assert.equal(app.document.querySelector('.dailySpotlight'), null); }
        finally { app.dom.window.close(); }
    }
});

test('a late response after user switching is discarded', async () => {
    let resolve;
    const app = setup(result, () => new Promise(done => { resolve = done; }));
    try {
        app.dom.window.ApiClient.getCurrentUserId = () => 'user-2';
        resolve(result);
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlight'), null);
    } finally { app.dom.window.close(); }
});

test('logout removes existing picks', async () => {
    const app = setup(result);
    try {
        await flush();
        app.dom.window.ApiClient.getCurrentUserId = () => null;
        app.document.dispatchEvent(new app.dom.window.CustomEvent('viewshow'));
        await flush();
        assert.equal(app.document.querySelector('.dailySpotlight'), null);
    } finally { app.dom.window.close(); }
});