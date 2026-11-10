const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');

const html = readFileSync('Jellyfin.Plugin.DailySpotlight/Configuration/configPage.html', 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('requires movies or series before saving settings', async () => {
    let updateCalls = 0;
    let savedConfig;
    const config = {
        Enabled: true,
        IncludeMovies: false,
        IncludeSeries: false,
        UnwatchedOnly: false,
        ShowShuffleButton: true,
        Title: 'Daily Spotlight',
        HomePosition: 'after-my-media',
        TimeZoneId: 'UTC',
        Seed: 'DailySpotlight',
        ItemCount: 20
    };
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    dom.window.Dashboard = {
        showLoadingMsg() {},
        hideLoadingMsg() {},
        processPluginConfigurationUpdateResult() {},
        alert(message) { throw new Error(message); }
    };
    dom.window.ApiClient = {
        getPluginConfiguration: async () => ({ ...config }),
        updatePluginConfiguration: async (_, updatedConfig) => {
            updateCalls += 1;
            savedConfig = updatedConfig;
            return {};
        }
    };
    dom.window.eval(dom.window.document.querySelector('script').textContent);

    try {
        dom.window.document.querySelector('#DailySpotlightConfigPage')
            .dispatchEvent(new dom.window.Event('pageshow'));
        await flush();
        const form = dom.window.document.querySelector('#DailySpotlightConfigForm');
        const submit = () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

        submit();
        assert.equal(updateCalls, 0);
        const error = dom.window.document.querySelector('#MediaTypeError');
        assert.equal(error.hidden, false);
        assert.equal(error.textContent.trim(), 'Select at least one: movies or series.');
        assert.equal(error.style.color, 'rgb(229, 57, 53)');
        assert.ok(error.compareDocumentPosition(dom.window.document.querySelector('#IncludeMovies')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
        assert.equal(dom.window.document.activeElement.id, 'IncludeMovies');
        assert.equal(dom.window.document.querySelector('#HomePosition').value, 'after-my-media');

        dom.window.document.querySelector('#IncludeSeries').checked = true;
        dom.window.document.querySelector('#IncludeSeries')
            .dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(dom.window.document.querySelector('#MediaTypeError').hidden, true);
        dom.window.document.querySelector('#HomePosition').value = 'after-latest-media';

        submit();
        await flush();
        assert.equal(updateCalls, 1);
        assert.equal(savedConfig.HomePosition, 'after-latest-media');
    } finally {
        dom.window.close();
    }
});
