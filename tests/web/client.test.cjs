const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const script = readFileSync('Jellyfin.Plugin.DailySpotlight/Web/dailyspotlight.js', 'utf8');
const id = '910b57b8183449dc80f41d48b26aa109';

function setup(response, fetchImpl) {
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="indexPage"><div id="homeTab"><div class="sections"></div></div></div></body></html>', {
        url: 'https://jellyfin.example/web/', runScripts: 'outside-only'
    });
    const requests = [];
    dom.window.ApiClient = {
        getCurrentUserId: () => 'user-1', accessToken: () => 'test-token',
        serverAddress: () => 'https://jellyfin.example/jellyfin', serverId: () => 'server-1',
        getUrl: path => `https://jellyfin.example/jellyfin/${path}`,
        getImageUrl: item => `https://jellyfin.example/jellyfin/Items/${item}/Images/Primary`
    };
    dom.window.fetch = async (...args) => {
        requests.push(args);
        return fetchImpl ? fetchImpl(...args) : { ok: true, json: async () => response };
    };
    dom.window.eval(script);
    return { dom, requests, document: dom.window.document };
}

const result = { Enabled: true, Title: 'Daily picks', Date: '2026-11-05', Items: [
    { Id: id, Name: 'Example film', Type: 'Movie', ProductionYear: 2024, ImageTags: { Primary: 'tag' } }
] };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('renders accessible poster cards and authenticated base-path-aware requests', async () => {
    const app = setup(result);
    try {
        await flush();
        assert.equal(app.document.querySelectorAll('.dailySpotlightCard').length, 1);
        assert.equal(app.document.querySelector('h2').textContent, 'Daily picks');
        assert.equal(app.document.querySelector('a').getAttribute('href'), `#/details?id=${id}&serverId=server-1`);
        assert.equal(app.requests[0][0], 'https://jellyfin.example/jellyfin/DailySpotlight/Items');
        assert.equal(app.requests[0][1].headers['X-Emby-Token'], 'test-token');
        app.dom.window.eval(script);
        assert.equal(app.requests.length, 1);
        const originalCard = app.document.querySelector('a');
        app.document.dispatchEvent(new app.dom.window.CustomEvent('viewshow'));
        await flush();
        assert.equal(app.document.querySelector('a'), originalCard);
    } finally { app.dom.window.close(); }
});

test('treats titles and media names as text, never HTML', async () => {
    const app = setup({ ...result, Title: '<img src=x onerror=alert(1)>', Items: [
        { Id: id, Name: '<script>bad()</script>', Type: 'Series' },
        { Id: 'javascript:bad()', Name: 'Invalid' }
    ] });
    try {
        await flush();
        assert.equal(app.document.querySelector('h2').textContent, '<img src=x onerror=alert(1)>');
        assert.equal(app.document.querySelectorAll('script, img').length, 0);
        assert.equal(app.document.querySelectorAll('.dailySpotlightCard').length, 1);
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
        resolve({ ok: true, json: async () => result });
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