/* DailySpotlight companion for Jellyfin Web's legacy home screen. */
(function () {
    'use strict';
    if (window.__dailySpotlightLoaded) return;
    window.__dailySpotlightLoaded = true;

    const style = document.createElement('style');
    style.textContent = `
        .dailySpotlight { margin: 1.6em 0 2em; padding: 0 max(3.3%, 1em); }
        .dailySpotlightHeader { display: flex; align-items: baseline; gap: 1em; flex-wrap: wrap; margin-bottom: 1em; }
        .dailySpotlight h2 { margin: 0; font-size: 1.45em; font-weight: 650; }
        .dailySpotlightDate { opacity: .65; font-size: .85em; }
        .dailySpotlightRail { display: flex; gap: 1.1em; overflow-x: auto; padding: .4em .25em 1em; scroll-snap-type: x proximity; }
        .dailySpotlightCard { flex: 0 0 clamp(130px, 13vw, 190px); color: inherit; text-decoration: none; scroll-snap-align: start; border-radius: .7em; }
        .dailySpotlightCard:focus-visible { outline: 3px solid #00a4dc; outline-offset: 4px; }
        .dailySpotlightArtwork { position: relative; aspect-ratio: 2/3; overflow: hidden; border-radius: .7em; background: linear-gradient(135deg, #173a49, #29223c); box-shadow: 0 5px 18px #0004; transition: transform .18s; }
        .dailySpotlightCard:hover .dailySpotlightArtwork { transform: translateY(-3px); }
        .dailySpotlightArtwork img { position: absolute; width: 100%; height: 100%; object-fit: cover; }
        .dailySpotlightPlaceholder { display: grid; place-items: center; height: 100%; padding: 0 1em; text-align: center; font-size: 1.2em; }
        .dailySpotlightName { margin-top: .65em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dailySpotlightMeta { opacity: .65; font-size: .85em; margin-top: .3em; }
        @media (prefers-reduced-motion: reduce) { .dailySpotlightArtwork { transition: none; } }
    `;
    document.head.append(style);

    let lastIdentity = '';
    let lastSuccess = 0;
    let inFlight = false;
    let scheduled;

    function context() {
        const client = window.ApiClient;
        const home = document.querySelector('#indexPage:not(.hide) #homeTab:not(.hide)');
        if (!home || !home.querySelector('.sections') || !client?.getCurrentUserId?.() || !client.accessToken?.()) return null;
        return { home, client, identity: `${client.serverAddress()}|${client.getCurrentUserId()}` };
    }

    function render(home, client, result) {
        const signature = JSON.stringify(result);
        const existing = home.querySelector('.dailySpotlight');
        // Preserve keyboard focus and horizontal scroll during unchanged polling responses.
        if (existing?.__dailySpotlightSignature === signature) return;
        home.querySelector('.dailySpotlight')?.remove();
        if (!result.Enabled || !Array.isArray(result.Items) || !result.Items.length) return;
        const section = document.createElement('section');
        section.className = 'dailySpotlight';
        section.__dailySpotlightSignature = signature;
        section.setAttribute('aria-label', result.Title || 'Your daily spotlight');
        const header = document.createElement('div');
        header.className = 'dailySpotlightHeader';
        const title = document.createElement('h2');
        title.textContent = result.Title || 'Your daily spotlight';
        const date = document.createElement('span');
        date.className = 'dailySpotlightDate';
        date.textContent = `Picked for ${result.Date}`;
        header.append(title, date);
        const rail = document.createElement('div');
        rail.className = 'dailySpotlightRail';
        for (const item of result.Items) {
            if (!/^[0-9a-f-]{32,36}$/i.test(item.Id || '')) continue;
            const card = document.createElement('a');
            card.className = 'dailySpotlightCard';
            card.href = `#/details?id=${encodeURIComponent(item.Id)}&serverId=${encodeURIComponent(client.serverId())}`;
            card.setAttribute('aria-label', item.Name || 'View media');
            const artwork = document.createElement('div');
            artwork.className = 'dailySpotlightArtwork';
            const placeholder = document.createElement('div');
            placeholder.className = 'dailySpotlightPlaceholder';
            placeholder.setAttribute('aria-hidden', 'true');
            placeholder.textContent = item.Name || 'No artwork';
            artwork.append(placeholder);
            if (item.ImageTags?.Primary) {
                const image = document.createElement('img');
                image.alt = '';
                image.loading = 'lazy';
                image.decoding = 'async';
                image.src = client.getImageUrl(item.Id, { type: 'Primary', maxWidth: 400, tag: item.ImageTags.Primary });
                image.addEventListener('error', () => image.remove(), { once: true });
                artwork.append(image);
            }
            const name = document.createElement('div');
            name.className = 'dailySpotlightName';
            name.textContent = item.Name || 'Untitled';
            const meta = document.createElement('div');
            meta.className = 'dailySpotlightMeta';
            meta.textContent = [item.ProductionYear, item.Type === 'Series' ? 'Series' : 'Movie'].filter(Boolean).join(' · ');
            card.append(artwork, name, meta);
            rail.append(card);
        }
        if (!rail.children.length) return;
        section.append(header, rail);
        // Outside .sections: Jellyfin clears that container when home settings change.
        home.prepend(section);
    }

    async function refresh(force) {
        const current = context();
        if (!current) {
            document.querySelectorAll('.dailySpotlight').forEach(row => row.remove());
            lastIdentity = '';
            return;
        }
        if (current.identity !== lastIdentity) {
            document.querySelectorAll('.dailySpotlight').forEach(row => row.remove());
            lastSuccess = 0;
        }
        if (inFlight || (!force && current.identity === lastIdentity && Date.now() - lastSuccess < 60000)) return;
        inFlight = true;
        lastIdentity = current.identity;
        try {
            const response = await fetch(current.client.getUrl('DailySpotlight/Items'), {
                headers: { 'X-Emby-Token': current.client.accessToken() },
                cache: 'no-store'
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            const latest = context();
            // Ignore responses from a previous user, server, or detached home view.
            if (!latest || latest.identity !== current.identity || latest.home !== current.home) return;
            lastSuccess = Date.now();
            render(current.home, current.client, result);
        } catch (error) {
            current.home.querySelector('.dailySpotlight')?.remove();
            // Throttle errors too: DOM mutations must not cause a request loop.
            lastSuccess = Date.now();
            console.warn('DailySpotlight: unable to load daily picks.', error);
        } finally {
            inFlight = false;
        }
    }

    function schedule() {
        clearTimeout(scheduled);
        scheduled = setTimeout(() => refresh(false), 80);
    }
    document.addEventListener('viewshow', () => refresh(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
    window.addEventListener('hashchange', schedule);
    // Also detects delayed login/client initialization and home DOM reconstruction.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { if (!document.hidden) refresh(false); }, 60000);
    refresh(false);
})();