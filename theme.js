/*
Template theme demonstrating all VPinFE theme patterns.
See theme.md for full documentation.
*/

// Globals
windowName = ""
currentTableIndex = 0;
config = null;
isTablePortrait = false;
tableRotationDegrees = 0;
lastWheelMoveDirection = 0;
lastHeroImageUrl = null;
lastHeroBgUrl = null;
lastRenderedTableIndex = -1;
const mediaPreloadCache = new Map();
let tableView = null;

function setNodeText(node, value) {
    const nextValue = value || '';
    if (node.textContent !== nextValue) {
        node.textContent = nextValue;
    }
}

// init the core interface to VPinFE
const vpin = new VPinFECore();
vpin.init();
window.vpin = vpin // main menu needs this to call back in.

// Register receiveEvent globally BEFORE vpin.ready to avoid timing issues
window.receiveEvent = receiveEvent;

// wait for VPinFECore to be ready
vpin.ready.then(async () => {
    console.log("VPinFECore is fully initialized");

    await vpin.call("get_my_window_name")
        .then(result => {
            windowName = result;
        });

    // Register your input handler. VPinFECore handles all input (keyboard or gamepad)
    // and calls your handler when input is detected.
    vpin.registerInputHandler(handleInput);

    // Optional: load a config.json from your theme dir for user-customizable options
    config = await vpin.call("get_theme_config");

    if (windowName === "table") {
        await applyTableLayout();
        window.addEventListener('resize', () => {
            applyTableLayout().then(() => {
                updateTableWindow();
            });
        });
    }

    // Initialize the display
    updateScreen();
});

// Listener for window events. VPinFECore uses this to send events to all windows.
async function receiveEvent(message) {
    vpin.call("console_out", message); // debug: send to Python CLI console

    // Let VPinFECore handle the data refresh logic (TableDataChange, filters, sorts)
    await vpin.handleEvent(message);

    // Handle UI updates based on event type
    if (message.type == "TableIndexUpdate") {
        currentTableIndex = message.index;
        updateScreen();
    }
    else if (message.type == "TableLaunching") {
        fadeOut();
    }
    else if (message.type == "TableLaunchComplete") {
        fadeIn();
    }
    else if (message.type == "RemoteLaunching") {
        // Remote launch from manager UI
        vpin.stopTableAudio();
        showRemoteLaunchOverlay(message.table_name);
        fadeOut();
    }
    else if (message.type == "RemoteLaunchComplete") {
        // Remote launch completed
        hideRemoteLaunchOverlay();
        fadeIn();
    }
    else if (message.type == "TableDataChange") {
        currentTableIndex = message.index;
        updateScreen();
    }
}

// Input handler function. ***** Only for the "table" window *****
// These actions are passed to your handler:
//   joyleft, joyright, joyup, joydown, joyselect, joyback
// These actions are handled internally by VPinFECore (NOT passed to your handler):
//   joymenu, joycollectionmenu, joyexit
async function handleInput(input) {
    switch (input) {
        case "joyleft":
            lastWheelMoveDirection = -1;
            currentTableIndex = wrapIndex(currentTableIndex - 1, vpin.tableData.length);
            updateScreen();

            // tell other windows the table index changed
            vpin.sendMessageToAllWindows({
                type: 'TableIndexUpdate',
                index: currentTableIndex
            });
            break;
        case "joyright":
            lastWheelMoveDirection = 1;
            currentTableIndex = wrapIndex(currentTableIndex + 1, vpin.tableData.length);
            updateScreen();

            // tell other windows the table index changed
            vpin.sendMessageToAllWindows({
                type: 'TableIndexUpdate',
                index: currentTableIndex
            });
            break;
        case "joyselect":
            vpin.stopTableAudio();
            vpin.sendMessageToAllWindows({ type: "TableLaunching" });
            await fadeOut();
            await vpin.launchTable(currentTableIndex);
            break;
        case "joyback":
            // do something on joyback if you want
            break;
    }
}

// Main update function - called when table index changes or data refreshes.
// All three windows (table, bg, dmd) load the same theme.js, so use windowName
// to branch logic per window.
function updateScreen() {
    if (windowName === "table") {
        updateTableWindow();
        vpin.playTableAudio(currentTableIndex);
        preloadNearbyMedia();
    } else if (windowName === "bg") {
        updateBGWindow();
    } else if (windowName === "dmd") {
        updateDMDWindow();
    }
}

// ---- Table Window (main screen) ----
function updateTableWindow() {
    const container = document.getElementById('rootContainer');
    tableView = ensureTableView(container);

    if (!vpin.tableData || vpin.tableData.length === 0) {
        tableView.shell.style.display = 'none';
        tableView.emptyState.style.display = 'flex';
        return;
    }

    tableView.shell.style.display = '';
    tableView.emptyState.style.display = 'none';

    const table = vpin.getTableMeta(currentTableIndex);
    const info = table.meta.Info || {};
    const vpx = table.meta.VPXFile || {};
    const title = info.Title || vpx.filename || table.tableDirName || 'Unknown Table';
    const manufacturer = info.Manufacturer || vpx.manufacturer || 'Unknown';
    const year = info.Year || vpx.year || '';
    const authors = formatAuthors(info.Authors);
    const tableType = info.Type || vpx.type || '';
    const featureFlags = [
        { key: "detectnfozzy", label: "Nfozzy" },
        { key: "detectfleep", label: "Fleep" },
        { key: "detectssf", label: "SSF" },
        { key: "detectfastflips", label: "FastFlips" },
        { key: "detectlut", label: "LUT" },
        { key: "detectscorebit", label: "ScoreBit" },
        { key: "detectflex", label: "FlexDMD" },
    ];
    const addonFlags = [
        { key: "altSoundExists", label: "AltSound" },
        { key: "altColorExists", label: "AltColor" },
        { key: "pupPackExists", label: "PuP-Pack" },
    ];

    const wheelUrl = vpin.getImageURL(currentTableIndex, 'cab');
    updateWheelCarousel(tableView);
    updateTitleBlock(tableView, {
        eyebrow: [manufacturer, year ? String(year) : '', tableType].filter(Boolean).join(' / '),
        title,
        authors,
        wheelUrl,
    });
    updateHeroMedia(tableView.heroMedia, title);
    updateFeaturePanel(tableView.featurePanel, featureFlags, vpx);
    updateFeaturePanel(tableView.addonPanel, addonFlags, vpx);

    lastRenderedTableIndex = currentTableIndex;
    lastWheelMoveDirection = 0;
}

// ---- BG Window (backglass) ----
function updateBGWindow() {
    const container = document.getElementById('rootContainer');
    if (!vpin.tableData || vpin.tableData.length === 0) {
        container.innerHTML = '';
        return;
    }

    const bgUrl = vpin.getImageURL(currentTableIndex, "bg");
    let img = container.querySelector('img');
    if (!img) {
        img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        container.appendChild(img);
    }
    img.src = bgUrl;
}

// ---- DMD Window ----
function updateDMDWindow() {
    const container = document.getElementById('rootContainer');
    if (!vpin.tableData || vpin.tableData.length === 0) {
        container.innerHTML = '';
        return;
    }

    const dmdUrl = vpin.getImageURL(currentTableIndex, "dmd");
    let img = container.querySelector('img');
    if (!img) {
        img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        container.appendChild(img);
    }
    img.src = dmdUrl;
}

//
// Support functions
//

// circular table index
function wrapIndex(index, length) {
    return (index + length) % length;
}

function formatAuthors(authors) {
    if (Array.isArray(authors) && authors.length > 0) return authors.join(', ');
    if (typeof authors === 'string' && authors.trim()) return authors.trim();
    return 'Unknown author';
}

function isTruthyFlag(value) {
    return value === true || value === "true" || value === 1 || value === "1";
}

function hasUsableMedia(url) {
    return Boolean(url) && !String(url).includes('file_missing');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function buildWheelCarousel() {
    const carousel = document.createElement('div');
    carousel.className = 'wheel-carousel';

    const track = document.createElement('div');
    track.className = 'wheel-track';
    if (lastWheelMoveDirection > 0) {
        track.classList.add('reel-next');
    } else if (lastWheelMoveDirection < 0) {
        track.classList.add('reel-prev');
    }

    const visibleCount = isTablePortrait ? 5 : 5;
    const half = Math.floor(visibleCount / 2);
    for (let offset = -half; offset <= half; offset += 1) {
        const index = wrapIndex(currentTableIndex + offset, vpin.getTableCount());
        const table = vpin.getTableMeta(index);
        const info = table.meta.Info || {};
        const vpx = table.meta.VPXFile || {};
        const title = info.Title || vpx.filename || table.tableDirName || 'Unknown Table';
        const wheelUrl = vpin.getImageURL(index, 'wheel');

        const card = document.createElement('div');
        card.className = `wheel-card${offset === 0 ? ' active' : ''}${Math.abs(offset) === 1 ? ' dim-near' : ''}`;
        card.dataset.offset = String(offset);

        if (hasUsableMedia(wheelUrl)) {
            const img = document.createElement('img');
            img.src = wheelUrl;
            img.alt = title;
            img.onerror = () => {
                const fallback = document.createElement('div');
                fallback.className = 'wheel-fallback';
                fallback.textContent = title;
                img.replaceWith(fallback);
            };
            card.appendChild(img);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'wheel-fallback';
            fallback.textContent = title;
            card.appendChild(fallback);
        }

        track.appendChild(card);
    }

    carousel.appendChild(track);
    return carousel;
}

function buildHeroImage(imageUrl, title) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = title;
    img.className = 'hero-media-asset';
    img.onerror = () => {
        img.removeAttribute('src');
        img.alt = `${title} media unavailable`;
    };
    return img;
}

function preloadImage(url) {
    if (!hasUsableMedia(url)) return;
    if (mediaPreloadCache.has(url)) return;

    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    const promise = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
    mediaPreloadCache.set(url, promise);

    // Keep cache bounded.
    if (mediaPreloadCache.size > 18) {
        const firstKey = mediaPreloadCache.keys().next().value;
        mediaPreloadCache.delete(firstKey);
    }
}

function preloadNearbyMedia() {
    if (!vpin.tableData || vpin.getTableCount() === 0) return;

    const indices = [
        currentTableIndex,
        wrapIndex(currentTableIndex - 1, vpin.getTableCount()),
        wrapIndex(currentTableIndex + 1, vpin.getTableCount()),
    ];

    indices.forEach((index) => {
        preloadImage(vpin.getImageURL(index, 'table'));
        preloadImage(vpin.getImageURL(index, 'bg'));
        preloadImage(vpin.getImageURL(index, 'wheel'));
        preloadImage(vpin.getImageURL(index, 'cab'));
    });
}

function buildDetailCard(label, value) {
    const card = document.createElement('div');
    card.className = 'detail-card';
    card.innerHTML = `
        <div class="detail-label">${escapeHtml(label)}</div>
        <div class="detail-value">${escapeHtml(value)}</div>
    `;
    return card;
}

function buildFeaturePanel(title, items, vpx) {
    const panel = document.createElement('section');
    panel.className = 'feature-panel';

    const heading = document.createElement('h2');
    heading.className = 'feature-panel-title';
    heading.textContent = title;
    panel.appendChild(heading);

    const strip = document.createElement('div');
    strip.className = 'feature-strip';
    items.forEach(({ key, label }) => {
        const tag = document.createElement('div');
        const isOn = isTruthyFlag(vpx[key]);
        tag.className = `feature-tag${isOn ? ' active' : ''}`;
        tag.textContent = label;
        strip.appendChild(tag);
    });

    panel.appendChild(strip);
    return panel;
}

function ensureTableView(container) {
    if (tableView && tableView.container === container) return tableView;

    container.innerHTML = '';

    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No tables found';
    emptyState.style.display = 'none';

    const shell = document.createElement('div');
    shell.className = 'table-shell';

    const wheelColumn = document.createElement('section');
    wheelColumn.className = 'wheel-column';
    const carousel = document.createElement('div');
    carousel.className = 'wheel-carousel';
    const selectionHalo = document.createElement('div');
    selectionHalo.className = 'wheel-selection-halo';
    const wheelTrack = createWheelTrack();
    carousel.appendChild(selectionHalo);
    carousel.appendChild(wheelTrack);
    wheelColumn.appendChild(carousel);

    const heroColumn = document.createElement('section');
    heroColumn.className = 'hero-column';

    const titleHeader = document.createElement('div');
    titleHeader.className = 'title-header';
    titleHeader.innerHTML = `
        <div class="title-copy">
            <div class="title-main">
                <div class="title-wheel"></div>
                <div class="title-text">
                    <div class="eyebrow"></div>
                    <h1 class="table-title"></h1>
                    <div class="meta-line"></div>
                </div>
            </div>
        </div>
    `;

    const heroMedia = document.createElement('div');
    heroMedia.className = 'hero-media';

    const featureSections = document.createElement('div');
    featureSections.className = 'feature-sections';
    const featurePanel = buildFeaturePanel('Features', [], {});
    const addonPanel = buildFeaturePanel('Add-ons', [], {});
    featureSections.appendChild(featurePanel);
    featureSections.appendChild(addonPanel);

    heroColumn.appendChild(titleHeader);
    heroColumn.appendChild(heroMedia);
    heroColumn.appendChild(featureSections);

    shell.appendChild(wheelColumn);
    shell.appendChild(heroColumn);
    container.appendChild(emptyState);
    container.appendChild(shell);

    tableView = {
        container,
        emptyState,
        shell,
        wheelCarousel: carousel,
        wheelTrack,
        titleHeader,
        titleWheel: titleHeader.querySelector('.title-wheel'),
        eyebrow: titleHeader.querySelector('.eyebrow'),
        title: titleHeader.querySelector('.table-title'),
        authorLine: titleHeader.querySelector('.meta-line'),
        heroMedia,
        featurePanel,
        addonPanel,
    };
    return tableView;
}

function createWheelTrack() {
    const wheelTrack = document.createElement('div');
    wheelTrack.className = 'wheel-track';
    for (let offset = -3; offset <= 3; offset += 1) {
        const card = document.createElement('div');
        card.className = 'wheel-card';
        card.dataset.offset = String(offset);
        wheelTrack.appendChild(card);
    }
    return wheelTrack;
}

function renderWheelCarousel(track, centerIndex) {
    const cards = Array.from(track.children);
    cards.forEach((card) => {
        const offset = Number(card.dataset.offset || 0);
        const index = wrapIndex(centerIndex + offset, vpin.getTableCount());
        const table = vpin.getTableMeta(index);
        const info = table.meta.Info || {};
        const vpx = table.meta.VPXFile || {};
        const title = info.Title || vpx.filename || table.tableDirName || 'Unknown Table';
        const wheelUrl = vpin.getImageURL(index, 'wheel');
        const isActive = offset === 0;
        const isNear = Math.abs(offset) === 1;

        card.className = `wheel-card${isActive ? ' active' : ''}${isNear ? ' dim-near' : ''}`;

        let img = card.querySelector('img');
        let fallback = card.querySelector('.wheel-fallback');

        if (hasUsableMedia(wheelUrl)) {
            if (!img) {
                img = document.createElement('img');
                img.onerror = () => {
                    img.removeAttribute('src');
                    img.style.display = 'none';
                    let nextFallback = card.querySelector('.wheel-fallback');
                    if (!nextFallback) {
                        nextFallback = document.createElement('div');
                        nextFallback.className = 'wheel-fallback';
                        card.appendChild(nextFallback);
                    }
                    nextFallback.textContent = title;
                    nextFallback.style.display = '';
                };
                card.appendChild(img);
            }
            img.alt = title;
            if (img.src !== wheelUrl) {
                img.src = wheelUrl;
            }
            img.style.display = '';
            if (fallback) fallback.style.display = 'none';
        } else {
            if (!fallback) {
                fallback = document.createElement('div');
                fallback.className = 'wheel-fallback';
                card.appendChild(fallback);
            }
            fallback.textContent = title;
            fallback.style.display = '';
            if (img) {
                img.removeAttribute('src');
                img.style.display = 'none';
            }
        }
    });
}

function getWheelStep(track) {
    const cards = Array.from(track.children);
    if (cards.length < 2) return 0;
    const first = cards[0];
    const second = cards[1];
    if (isTablePortrait) {
        return second.offsetLeft - first.offsetLeft;
    }
    return second.offsetTop - first.offsetTop;
}

function updateWheelCarousel(view) {
    const carousel = view.wheelCarousel;
    let track = view.wheelTrack;
    if (view.wheelTrackResetTimer) {
        clearTimeout(view.wheelTrackResetTimer);
        view.wheelTrackResetTimer = null;
    }

    const existingTracks = Array.from(carousel.querySelectorAll('.wheel-track'));
    existingTracks.forEach((existingTrack) => {
        existingTrack.getAnimations().forEach((animation) => animation.cancel());
        existingTrack.classList.remove('wheel-track-transition');
        existingTrack.style.transform = '';
        existingTrack.style.zIndex = '';
        if (existingTrack !== track) {
            existingTrack.remove();
        }
    });

    const canAnimate =
        lastRenderedTableIndex !== -1 &&
        lastWheelMoveDirection !== 0 &&
        vpin.getTableCount() > 1;

    if (!canAnimate) {
        renderWheelCarousel(track, currentTableIndex);
        return;
    }

    renderWheelCarousel(track, lastRenderedTableIndex);
    const step = getWheelStep(track);
    if (!step) {
        renderWheelCarousel(track, currentTableIndex);
        return;
    }

    const incomingTrack = createWheelTrack();
    renderWheelCarousel(incomingTrack, currentTableIndex);
    incomingTrack.classList.add('wheel-track-transition');
    incomingTrack.style.zIndex = '2';
    track.classList.add('wheel-track-transition');
    track.style.zIndex = '1';
    carousel.appendChild(incomingTrack);

    const outgoingDelta = lastWheelMoveDirection > 0 ? -step : step;
    const incomingStart = -outgoingDelta;
    const translateValue = (value) => (
        isTablePortrait ? `translateX(${value}px)` : `translateY(${value}px)`
    );

    incomingTrack.style.transform = translateValue(incomingStart);
    incomingTrack.offsetWidth;

    const animationDuration = 520;
    const animationOptions = {
        duration: animationDuration,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'forwards',
    };

    track.animate(
        [
            { transform: translateValue(0) },
            { transform: translateValue(outgoingDelta) },
        ],
        animationOptions
    );

    incomingTrack.animate(
        [
            { transform: translateValue(incomingStart) },
            { transform: translateValue(0) },
        ],
        animationOptions
    );

    view.wheelTrackResetTimer = setTimeout(() => {
        track.remove();
        incomingTrack.classList.remove('wheel-track-transition');
        incomingTrack.style.transform = '';
        incomingTrack.style.zIndex = '';
        view.wheelTrack = incomingTrack;
        view.wheelTrackResetTimer = null;
    }, animationDuration);
}

function updateTitleBlock(view, data) {
    setNodeText(view.eyebrow, data.eyebrow);
    setNodeText(view.title, data.title);
    setNodeText(view.authorLine, data.authors);
    updateTitleWheel(view.titleWheel, data.wheelUrl, data.title);
}

function updateTitleWheel(container, imageUrl, title) {
    let img = container.querySelector('img');
    let fallback = container.querySelector('.wheel-fallback');
    if (hasUsableMedia(imageUrl)) {
        if (!img) {
            img = document.createElement('img');
            img.onerror = () => {
                img.removeAttribute('src');
                img.style.display = 'none';
                let nextFallback = container.querySelector('.wheel-fallback');
                if (!nextFallback) {
                    nextFallback = document.createElement('div');
                    nextFallback.className = 'wheel-fallback';
                    container.appendChild(nextFallback);
                }
                nextFallback.textContent = title;
                nextFallback.style.display = '';
            };
            container.appendChild(img);
        }
        img.alt = title;
        if (img.src !== imageUrl) {
            img.src = imageUrl;
        }
        img.style.display = '';
        if (fallback) fallback.style.display = 'none';
    } else {
        if (!fallback) {
            fallback = document.createElement('div');
            fallback.className = 'wheel-fallback';
            container.appendChild(fallback);
        }
        fallback.textContent = title;
        fallback.style.display = '';
        if (img) {
            img.removeAttribute('src');
            img.style.display = 'none';
        }
    }
}

function updateHeroMedia(container, title) {
    const imageUrl = vpin.getImageURL(currentTableIndex, 'table');
    const bgUrl = vpin.getImageURL(currentTableIndex, 'bg');
    const previousLayer = container.querySelector('.hero-media-frame.is-active, .hero-media-frame');

    if (
        previousLayer &&
        previousLayer.dataset.imageUrl === imageUrl &&
        previousLayer.dataset.bgUrl === bgUrl
    ) {
        previousLayer.classList.remove('is-entering', 'is-exiting');
        previousLayer.classList.add('is-active');
        return;
    }

    const frame = document.createElement('div');
    frame.className = 'hero-media-frame hero-media-layer is-entering';
    frame.dataset.imageUrl = imageUrl;
    frame.dataset.bgUrl = bgUrl;

    if (isTablePortrait) {
        const bgImage = document.createElement('img');
        bgImage.className = 'hero-media-bg';
        bgImage.src = bgUrl;
        bgImage.alt = '';
        bgImage.setAttribute('aria-hidden', 'true');
        bgImage.onerror = () => {
            bgImage.style.display = 'none';
        };
        frame.appendChild(bgImage);

        const bgOverlay = document.createElement('div');
        bgOverlay.className = 'hero-media-bg-overlay';
        frame.appendChild(bgOverlay);
    }

    const videoUrl = vpin.getVideoURL(currentTableIndex, 'table');
    let activated = false;
    const activateLayer = () => {
        if (activated) return;
        activated = true;
        requestAnimationFrame(() => {
            frame.classList.remove('is-entering');
            frame.classList.add('is-active');
            if (previousLayer) {
                previousLayer.classList.add('is-exiting');
                setTimeout(() => previousLayer.remove(), 220);
            }
        });
    };

    if (hasUsableMedia(videoUrl)) {
        const video = document.createElement('video');
        video.src = videoUrl;
        video.poster = imageUrl;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.className = 'hero-media-asset';
        video.onerror = () => {
            const fallback = buildHeroImage(imageUrl, title);
            video.replaceWith(fallback);
            applyMediaRotation(fallback);
            activateLayer();
        };
        video.addEventListener('loadeddata', activateLayer, { once: true });
        frame.appendChild(video);
        applyMediaRotation(video);
    } else {
        const image = buildHeroImage(imageUrl, title);
        if (image.complete) {
            activateLayer();
        } else {
            image.addEventListener('load', activateLayer, { once: true });
            image.addEventListener('error', activateLayer, { once: true });
        }
        frame.appendChild(image);
        applyMediaRotation(image);
    }

    container.appendChild(frame);
    lastHeroImageUrl = imageUrl;
    lastHeroBgUrl = bgUrl;
    setTimeout(activateLayer, 16);
}

function updateFeaturePanel(panel, items, vpx) {
    const strip = panel.querySelector('.feature-strip');
    strip.innerHTML = '';
    items.forEach(({ key, label }) => {
        const tag = document.createElement('div');
        const isOn = isTruthyFlag(vpx[key]);
        tag.className = `feature-tag${isOn ? ' active' : ''}`;
        tag.textContent = label;
        strip.appendChild(tag);
    });
}

function getTableSubtitle() {
    const table = vpin.getTableMeta(currentTableIndex);
    const info = table.meta.Info || {};
    const vpx = table.meta.VPXFile || {};
    const manufacturer = info.Manufacturer || vpx.manufacturer || 'Unknown manufacturer';
    const year = info.Year || vpx.year || '';
    const type = info.Type || vpx.type || 'Pinball table';
    return `${manufacturer}${year ? ' • ' + year : ''}${type ? ' • ' + type : ''}`;
}

function getMediaModeLabel() {
    if (!isTablePortrait) return 'Landscape view';
    return 'Portrait cab view';
}

function applyMediaRotation(element) {
    if (!element) return;

    const normalized = ((tableRotationDegrees % 360) + 360) % 360;
    const swapAxes = normalized === 90 || normalized === 270;
    const mediaRotation = swapAxes ? -tableRotationDegrees : tableRotationDegrees;
    if (swapAxes) {
        element.style.width = '177.78%';
        element.style.height = '56.25%';
        element.style.maxWidth = 'none';
        element.style.maxHeight = 'none';
        element.style.objectFit = 'fill';
        element.style.transform = `rotate(${mediaRotation}deg)`;
    } else {
        element.style.width = '100%';
        element.style.height = '100%';
        element.style.maxWidth = '';
        element.style.maxHeight = '';
        element.style.objectFit = 'cover';
        element.style.transform = mediaRotation !== 0
            ? `rotate(${mediaRotation}deg)`
            : 'none';
    }
}

async function applyTableLayout() {
    if (windowName !== "table") return;

    const screen = document.getElementById('tableScreen');
    const overlayRoot = document.getElementById('overlay-root');
    if (!screen) return;

    const cabMode = await vpin.call("get_cab_mode");
    const rotationDegree = await vpin.call("get_table_rotation");
    tableRotationDegrees = rotationDegree;
    const normalized = ((rotationDegree % 360) + 360) % 360;
    const swapAxes = normalized === 90 || normalized === 270;
    isTablePortrait = swapAxes;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const baseWidth = swapAxes ? 1080 : 1920;
    const baseHeight = swapAxes ? 1920 : 1080;
    const scale = swapAxes
        ? Math.min(vw / baseHeight, vh / baseWidth)
        : Math.min(vw / baseWidth, vh / baseHeight);

    screen.style.width = `${baseWidth}px`;
    screen.style.height = `${baseHeight}px`;
    screen.style.transform = rotationDegree !== 0
        ? `rotate(${rotationDegree}deg) scale(${scale})`
        : `scale(${scale})`;
    screen.style.visibility = "visible";

    if (overlayRoot) {
        if (rotationDegree !== 0) {
            overlayRoot.style.width = `${baseWidth}px`;
            overlayRoot.style.height = `${baseHeight}px`;
            overlayRoot.style.top = '50%';
            overlayRoot.style.left = '50%';
            overlayRoot.style.transform = `translate(-50%, -50%) rotate(${rotationDegree}deg) scale(${scale})`;
        } else {
            overlayRoot.style.width = '100vw';
            overlayRoot.style.height = '100vh';
            overlayRoot.style.top = '0';
            overlayRoot.style.left = '0';
            overlayRoot.style.transform = 'none';
        }
    }

    document.body.classList.toggle('table-screen-portrait', isTablePortrait);
    document.body.classList.toggle('table-screen-cab', Boolean(cabMode));
}

// Fade transition using the fadeOverlay pattern
function fadeOut() {
    const overlay = document.getElementById("fadeOverlay");
    if (overlay) overlay.classList.add("show");
}

function fadeIn() {
    const overlay = document.getElementById("fadeOverlay");
    if (overlay) overlay.classList.remove("show");
}

// Remote launch overlay functions
function showRemoteLaunchOverlay(tableName) {
    const overlay = document.getElementById('remote-launch-overlay');
    const nameEl = document.getElementById('remote-launch-table-name');
    if (overlay && nameEl) {
        nameEl.textContent = tableName || 'Unknown Table';
        overlay.style.display = 'flex';
    }
}

function hideRemoteLaunchOverlay() {
    const overlay = document.getElementById('remote-launch-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}
