/* DailySpotlight companion for Jellyfin Web's legacy home screen. */
(function () {
    'use strict';
    if (window.__dailySpotlightLoaded) return;
    window.__dailySpotlightLoaded = true;

    const style = document.createElement('style');
    style.textContent = `
        .dailySpotlightPoster { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .dailySpotlight .cardText { text-align: center !important; }
        .dailySpotlight .cardText a,
        .dailySpotlight .cardText .textActionButton { text-decoration: none !important; }
        .dailySpotlightHeader { display: flex; align-items: center; justify-content: space-between; }
        .dailySpotlightShuffleButton { flex: 0 0 auto; width: 2em; height: 2em; min-width: 2em; padding: 0.25em !important; font-size: 80%; }
        .dailySpotlightShuffleButton .material-icons { font-size: 1.25em; }
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
        section.className = 'verticalSection dailySpotlight';
        section.__dailySpotlightSignature = signature;
        section.setAttribute('aria-label', result.Title || 'Daily Spotlight');
        const header = document.createElement('div');
        header.className = 'sectionTitleContainer sectionTitleContainer-cards padded-left';
        const title = document.createElement('h2');
        title.className = 'sectionTitle sectionTitle-cards';
        title.textContent = result.Title || 'Daily Spotlight';
        header.append(title);
        if (result.ShowShuffleButton !== false) {
            const shuffleButton = document.createElement('button');
            shuffleButton.type = 'button';
            shuffleButton.setAttribute('is', 'paper-icon-button-light');
            shuffleButton.className = 'dailySpotlightShuffleButton autoSize';
            shuffleButton.title = 'Get different daily picks';
            shuffleButton.setAttribute('aria-label', 'Get different daily picks');
            const icon = document.createElement('span');
            icon.className = 'material-icons shuffle';
            icon.setAttribute('aria-hidden', 'true');
            shuffleButton.append(icon);
            shuffleButton.addEventListener('click', () => {
                if (inFlight) return;
                shuffleButton.disabled = true;
                refresh(true, true);
            });
            header.append(shuffleButton);
        }

        const scroller = document.createElement('div');
        scroller.setAttribute('is', 'emby-scroller');
        scroller.setAttribute('data-horizontal', 'true');
        scroller.setAttribute('data-centerfocus', 'true');
        scroller.className = 'padded-top-focusscale padded-bottom-focusscale';
        const rail = document.createElement('div');
        rail.setAttribute('is', 'emby-itemscontainer');
        rail.className = 'itemsContainer scrollSlider focuscontainer-x dailySpotlightRail';
        for (const item of result.Items) {
            if (!/^[0-9a-f-]{32,36}$/i.test(item.Id || '')) continue;
            const serverId = client.serverId();
            const userData = item.UserData || {};
            const card = document.createElement('div');
            card.className = 'card card-hoverable overflowPortraitCard dailySpotlightCard card-withuserdata';
            card.dataset.id = item.Id;
            card.dataset.serverid = serverId;
            card.dataset.type = item.Type || '';
            card.dataset.mediatype = item.MediaType || 'Video';
            card.dataset.isfolder = String(item.IsFolder === true);
            const box = document.createElement('div');
            box.className = 'cardBox cardBox-bottompadded';
            const scalable = document.createElement('div');
            scalable.className = 'cardScalable';
            const padder = document.createElement('div');
            padder.className = 'cardPadder cardPadder-overflowPortrait';
            const artwork = document.createElement('a');
            artwork.className = 'cardImageContainer cardContent coveredImage itemAction';
            artwork.href = `#/details?id=${encodeURIComponent(item.Id)}&serverId=${encodeURIComponent(serverId)}`;
            artwork.dataset.action = 'link';
            artwork.dataset.id = item.Id;
            artwork.dataset.serverid = serverId;
            artwork.dataset.type = item.Type || '';
            artwork.dataset.mediatype = item.MediaType || 'Video';
            artwork.dataset.isfolder = String(item.IsFolder === true);
            artwork.setAttribute('aria-label', item.Name || 'View media');
            const image = document.createElement('img');
            image.className = 'dailySpotlightPoster';
            image.alt = '';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.src = client.getScaledImageUrl(item.Id, {
                type: 'Primary', width: 400, tag: item.ImageTags?.Primary
            });
            image.addEventListener('error', () => image.remove(), { once: true });
            artwork.append(image);
            scalable.append(padder, artwork);

            const hoverMenu = document.createElement('div');
            hoverMenu.className = 'cardOverlayContainer itemAction';
            hoverMenu.dataset.action = 'link';
            const buttonClass = 'cardOverlayButton cardOverlayButton-hover itemAction paper-icon-button-light';
            const play = document.createElement('button');
            play.type = 'button';
            play.setAttribute('is', 'paper-icon-button-light');
            play.className = `${buttonClass} cardOverlayFab-primary`;
            play.dataset.action = 'resume';
            play.title = 'Play';
            const playIcon = document.createElement('span');
            playIcon.className = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow';
            playIcon.setAttribute('aria-hidden', 'true');
            play.append(playIcon);
            hoverMenu.append(play);

            const controls = document.createElement('div');
            controls.className = 'cardOverlayButton-br flex';
            if (item.Type === 'Movie' || item.Type === 'Series') {
                const played = document.createElement('button');
                played.type = 'button';
                played.setAttribute('is', 'emby-playstatebutton');
                played.className = `${buttonClass} cardOverlayButton-hover`;
                played.dataset.action = 'none';
                played.dataset.id = item.Id;
                played.dataset.serverid = serverId;
                played.dataset.itemtype = item.Type;
                played.dataset.played = String(userData.Played === true);
                const playedIcon = document.createElement('span');
                playedIcon.className = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover check';
                playedIcon.setAttribute('aria-hidden', 'true');
                played.append(playedIcon);
                controls.append(played);
            }

            const favorite = document.createElement('button');
            favorite.type = 'button';
            favorite.setAttribute('is', 'emby-ratingbutton');
            favorite.className = `${buttonClass} cardOverlayButton-hover`;
            favorite.dataset.action = 'none';
            favorite.dataset.id = item.Id;
            favorite.dataset.serverid = serverId;
            favorite.dataset.itemtype = item.Type || '';
            favorite.dataset.likes = userData.Likes == null ? '' : String(userData.Likes);
            favorite.dataset.isfavorite = String(userData.IsFavorite === true);
            const favoriteIcon = document.createElement('span');
            favoriteIcon.className = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover favorite';
            favoriteIcon.setAttribute('aria-hidden', 'true');
            favorite.append(favoriteIcon);
            controls.append(favorite);

            const more = document.createElement('button');
            more.type = 'button';
            more.setAttribute('is', 'paper-icon-button-light');
            more.className = buttonClass;
            more.dataset.action = 'menu';
            more.title = 'More';
            const moreIcon = document.createElement('span');
            moreIcon.className = 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover more_vert';
            moreIcon.setAttribute('aria-hidden', 'true');
            more.append(moreIcon);
            controls.append(more);
            hoverMenu.append(controls);
            scalable.append(hoverMenu);

            const footer = document.createElement('div');
            footer.className = 'cardFooter cardFooter-transparent';
            const name = document.createElement('div');
            name.className = 'cardText cardTextCentered cardText-first';
            name.textContent = item.Name || 'Untitled';
            const meta = document.createElement('div');
            meta.className = 'cardText cardTextCentered cardText-secondary';
            meta.textContent = [item.ProductionYear, item.Type === 'Series' ? 'Series' : 'Movie'].filter(Boolean).join(' · ');
            footer.append(name, meta);
            box.append(scalable, footer);
            card.append(box);
            rail.append(card);
        }
        if (!rail.children.length) return;
        scroller.append(rail);
        section.append(header, scroller);
        const sections = home.querySelector('.sections');
        const libraryTiles = sections.querySelector('.homeLibraryButtonContainer');
        let myMediaSection = libraryTiles?.closest('.verticalSection');
        if (!myMediaSection) {
            const myMediaTitle = window.Globalize?.translate?.('HeaderMyMedia') || 'My Media';
            myMediaSection = Array.from(sections.children).find(candidate =>
                candidate.querySelector('.sectionTitle')?.textContent.trim() === myMediaTitle);
        }
        // My Media is the default first section when the home section uses card tiles.
        myMediaSection ||= sections.querySelector(':scope > .section0');
        if (myMediaSection) {
            myMediaSection.insertAdjacentElement('afterend', section);
        } else {
            sections.prepend(section);
        }
        window.CustomElements?.upgradeSubtree(section);
    }

    async function refresh(force, shuffle = false) {
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
            const result = await current.client.ajax({
                type: 'GET',
                url: current.client.getUrl(`DailySpotlight/Items${shuffle ? '?shuffle=true' : ''}`),
                dataType: 'json'
            });
            const latest = context();
            // Ignore responses from a previous user, server, or detached home view.
            if (!latest || latest.identity !== current.identity || latest.home !== current.home) return;
            lastSuccess = Date.now();
            render(current.home, current.client, result);
        } catch (error) {
            if (!shuffle) current.home.querySelector('.dailySpotlight')?.remove();
            // Throttle errors too: DOM mutations must not cause a request loop.
            lastSuccess = Date.now();
            console.warn('DailySpotlight: unable to load daily picks.', error);
        } finally {
            inFlight = false;
            current.home.querySelector('.dailySpotlightShuffleButton')?.removeAttribute('disabled');
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