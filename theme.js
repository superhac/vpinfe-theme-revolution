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

// Audio manager for table audio with crossfade.
// Works on both backends:
//   Chromium: direct audio.play() via --autoplay-policy flag
//   pywebview: falls back to trigger_audio_play via Python's evaluate_js
const tableAudio = {
    audio: Object.assign(new Audio(), { loop: true }),
    fadeId: null,
    fadeDuration: 500,
    maxVolume: 0.8,
    currentUrl: null,

    play(url, retries = 3) {
        if (!url) { this.stop(); return; }
        if (this.currentUrl === url && !this.audio.paused) return;

        const audio = this.audio;
        clearInterval(this.fadeId);
        audio.pause();
        audio.volume = 0;
        audio.src = url;
        this.currentUrl = url;

        audio.play().then(() => {
            if (this.currentUrl === url) this._fade(0, this.maxVolume);
        }).catch(e => {
            if (e.name === 'NotAllowedError') {
                // Autoplay blocked (pywebview/WebKitGTK) - fall back to Python bridge
                this._retries = retries;
                this._triggerWhenReady(url);
            } else {
                if (retries > 0 && this.currentUrl === url) {
                    setTimeout(() => this.play(url, retries - 1), 1000);
                }
            }
        });
    },

    _triggerWhenReady(url) {
        if (this.currentUrl !== url) return;
        if (this.audio.readyState >= 2) {
            vpin.call("trigger_audio_play").catch(() => {});
        } else {
            this.audio.addEventListener('canplay', () => {
                if (this.currentUrl === url) {
                    vpin.call("trigger_audio_play").catch(() => {});
                }
            }, { once: true });
        }
    },

    // Called from Python via evaluate_js (pywebview privileged context)
    _resumePlay() {
        const url = this.currentUrl;
        const retries = this._retries || 0;
        if (!url) return;
        this.audio.play().then(() => {
            if (this.currentUrl === url) this._fade(0, this.maxVolume);
        }).catch(e => {
            if (retries > 0 && this.currentUrl === url) {
                this._retries = retries - 1;
                setTimeout(() => this._triggerWhenReady(url), 500);
            }
        });
    },

    stop() {
        if (this.audio && !this.audio.paused) {
            this._fade(this.audio.volume, 0, () => {
                this.audio.pause();
                this.currentUrl = null;
            });
        } else {
            clearInterval(this.fadeId);
            this.currentUrl = null;
        }
    },

    _fade(from, to, onComplete) {
        clearInterval(this.fadeId);
        const audio = this.audio;
        if (!audio) { if (onComplete) onComplete(); return; }
        audio.volume = from;
        const steps = this.fadeDuration / 20;
        const delta = (to - from) / steps;
        this.fadeId = setInterval(() => {
            const next = audio.volume + delta;
            if ((delta > 0 && next >= to) || (delta < 0 && next <= to) || delta === 0) {
                audio.volume = to;
                clearInterval(this.fadeId);
                if (onComplete) onComplete();
            } else {
                audio.volume = next;
            }
        }, 20);
    }
};

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
            applyTableLayout().then(() => updateTableWindow());
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
        tableAudio.stop();
        fadeOut();
    }
    else if (message.type == "TableLaunchComplete") {
        fadeIn();
        if (windowName === "table") tableAudio.play(vpin.getAudioURL(currentTableIndex));
    }
    else if (message.type == "RemoteLaunching") {
        // Remote launch from manager UI
        tableAudio.stop();
        showRemoteLaunchOverlay(message.table_name);
        fadeOut();
    }
    else if (message.type == "RemoteLaunchComplete") {
        // Remote launch completed
        hideRemoteLaunchOverlay();
        fadeIn();
        if (windowName === "table") tableAudio.play(vpin.getAudioURL(currentTableIndex));
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
            tableAudio.stop();
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
        tableAudio.play(vpin.getAudioURL(currentTableIndex));
    } else if (windowName === "bg") {
        updateBGWindow();
    } else if (windowName === "dmd") {
        updateDMDWindow();
    }
}

// ---- Table Window (main screen) ----
function updateTableWindow() {
    const container = document.getElementById('rootContainer');
    container.innerHTML = '';

    if (!vpin.tableData || vpin.tableData.length === 0) {
        container.innerHTML = '<div class="empty-state">No tables found</div>';
        return;
    }

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
    const shell = document.createElement('div');
    shell.className = 'table-shell';

    const wheelColumn = document.createElement('section');
    wheelColumn.className = 'wheel-column';
    wheelColumn.appendChild(buildWheelCarousel());

    const heroColumn = document.createElement('section');
    heroColumn.className = 'hero-column';

    const titleBlock = document.createElement('div');
    titleBlock.className = 'title-header';
    const wheelUrl = vpin.getImageURL(currentTableIndex, 'cab');
    titleBlock.innerHTML = `
        <div class="title-copy">
            <div class="title-main">
                <div class="title-wheel"></div>
                <div class="title-text">
                    <div class="eyebrow">${[manufacturer, year ? String(year) : '', tableType].filter(Boolean).map(escapeHtml).join(' / ')}</div>
                    <h1 class="table-title">${escapeHtml(title)}</h1>
                </div>
            </div>
        </div>
    `;
    const titleWheel = titleBlock.querySelector('.title-wheel');
    const titleText = titleBlock.querySelector('.title-text');
    if (hasUsableMedia(wheelUrl)) {
        const wheelImg = document.createElement('img');
        wheelImg.src = wheelUrl;
        wheelImg.alt = title;
        wheelImg.onerror = () => {
            const fallback = document.createElement('div');
            fallback.className = 'wheel-fallback';
            fallback.textContent = title;
            titleWheel.replaceChildren(fallback);
        };
        titleWheel.appendChild(wheelImg);
    } else {
        const fallback = document.createElement('div');
        fallback.className = 'wheel-fallback';
        fallback.textContent = title;
        titleWheel.appendChild(fallback);
    }
    const metaLine = document.createElement('div');
    metaLine.className = 'meta-line';
    [authors].filter(Boolean).forEach(value => {
        const pill = document.createElement('div');
        pill.className = 'meta-pill';
        pill.textContent = value;
        metaLine.appendChild(pill);
    });
    titleText.appendChild(metaLine);
    heroColumn.appendChild(titleBlock);

    heroColumn.appendChild(buildHeroMedia(title));

    const featureSections = document.createElement('div');
    featureSections.className = 'feature-sections';
    featureSections.appendChild(buildFeaturePanel('Features', featureFlags, vpx));
    featureSections.appendChild(buildFeaturePanel('Add-ons', addonFlags, vpx));
    heroColumn.appendChild(featureSections);

    shell.appendChild(wheelColumn);
    shell.appendChild(heroColumn);
    container.appendChild(shell);
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
    requestAnimationFrame(() => {
        track.classList.remove('reel-next', 'reel-prev');
    });
    return carousel;
}

function buildHeroMedia(title) {
    const wrapper = document.createElement('div');
    wrapper.className = 'hero-media';
    const imageUrl = vpin.getImageURL(currentTableIndex, 'table');
    const bgUrl = vpin.getImageURL(currentTableIndex, 'bg');

    if (lastHeroImageUrl && lastHeroImageUrl !== imageUrl) {
        const previousLayer = document.createElement('div');
        previousLayer.className = 'hero-media-frame hero-media-layer is-active';

        if (isTablePortrait && lastHeroBgUrl) {
            const previousBg = document.createElement('img');
            previousBg.className = 'hero-media-bg';
            previousBg.src = lastHeroBgUrl;
            previousBg.alt = '';
            previousBg.setAttribute('aria-hidden', 'true');
            previousLayer.appendChild(previousBg);

            const previousBgOverlay = document.createElement('div');
            previousBgOverlay.className = 'hero-media-bg-overlay';
            previousLayer.appendChild(previousBgOverlay);
        }

        const previousImage = document.createElement('img');
        previousImage.src = lastHeroImageUrl;
        previousImage.alt = '';
        previousImage.className = 'hero-media-asset';
        applyMediaRotation(previousImage);
        previousLayer.appendChild(previousImage);
        wrapper.appendChild(previousLayer);

        requestAnimationFrame(() => {
            previousLayer.classList.add('is-exiting');
            setTimeout(() => previousLayer.remove(), 240);
        });
    }

    const frame = document.createElement('div');
    frame.className = 'hero-media-frame hero-media-layer is-entering';

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
        image.addEventListener('load', activateLayer, { once: true });
        frame.appendChild(image);
        applyMediaRotation(image);
    }

    wrapper.appendChild(frame);

    lastHeroImageUrl = imageUrl;
    lastHeroBgUrl = bgUrl;
    setTimeout(activateLayer, 60);

    return wrapper;
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
