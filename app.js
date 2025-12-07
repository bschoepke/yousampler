// Copyright (c) 2025 Ben Schoepke  
// All rights reserved.

/**
 * yousampler
 * Core Application Logic
 */

// ==========================================
// 1. CONSTANTS & STATE
// ==========================================
const PAD_COUNT = 16;
const LOOP_EPSILON = 0.05; // seconds before endpoint to re-seek for tighter loops
const pads = [];
let activePadIndex = null;
let padToLoadIndex = null; // For modal loading
let activePadStack = []; // Stack to track z-order of playing pads

class PadState {
    constructor(id) {
        this.id = id;
        this.videoId = null;
        this.player = null;
        this.startTime = 0;
        this.endTime = 0;
        this.duration = 0;
        this.mode = 'gate'; // 'gate', 'oneshot', 'loop'
        this.isPlaying = false;
        this.title = '';
        this.volume = 100;
        this.playbackRate = 1;
        this.retrigger = true;
    }
}

// Initialize Pad States
for (let i = 0; i < PAD_COUNT; i++) {
    pads.push(new PadState(i));
}

// ==========================================
// 2. DOM ELEMENTS
// ==========================================
const padGrid = document.getElementById('pad-grid');
// DOM elements removed in new design: lcdScreen, videoTitleContainer
const videoTitle = document.getElementById('video-title');
const startTimeDisplay = document.getElementById('start-time-display');
const endTimeDisplay = document.getElementById('end-time-display');
const trashZone = document.getElementById('trash-zone');
const btnShare = document.getElementById('btn-share');
const btnPlayPause = document.getElementById('btn-play-pause');
const playPauseIcon = document.getElementById('play-pause-icon');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnExitFullscreen = document.getElementById('btn-exit-fullscreen');

// Knob Elements
const knobVolume = document.getElementById('knob-volume');
const knobPitch = document.getElementById('knob-pitch');
const valBarVol = document.getElementById('vol-path');
const valBarPitch = document.getElementById('pitch-path');
const pitchText = document.getElementById('pitch-text');

// Mode Control
const modeControlLcd = document.getElementById('mode-control-lcd');
const modeIcon = document.getElementById('mode-icon');
const controlRetrigger = document.getElementById('control-retrigger');

// Modal Elements
const loaderModal = document.getElementById('loader-modal');
const videoUrlInput = document.getElementById('video-url-input');
const btnCancelLoad = document.getElementById('btn-cancel-load');
const suggestedVideosGrid = document.getElementById('suggested-videos-grid');
const btnConfirmLoad = document.getElementById('btn-confirm-load');

// Timeline Elements
const timelineContainer = document.getElementById('timeline-container');
const playhead = document.getElementById('playhead');
const trimStart = document.getElementById('trim-start');
const trimEnd = document.getElementById('trim-end');
const trimOverlayLeft = document.getElementById('trim-overlay-left');
const trimOverlayRight = document.getElementById('trim-overlay-right');

const playIconMarkup = '<path d="M8 5v14l11-7z" />';
const pauseIconMarkup = '<path d="M6 5h4v14H6zm8 0h4v14h-4z" />';

let apiReady = false;
let pendingUrlState = null;
let stateApplied = false;
let apiReadyPoll = null;
let suggestedVideos = [];
let midiEnabled = false;
let midiAccess = null;

// ==========================================
// 3. INITIALIZATION
// ==========================================
function init() {
    renderPads();
    setupKnobs();
    setupModeControl();
    setupRetriggerControl();
    setupTimelineEvents();
    setupKeyboardEvents();
    setupModalEvents();
    setupTrashEvents();
    setupClipboardEvents();
    setupShareEvents();
    setupPlayPauseButton();
    setupFullScreenEvents();
    startPlaybackLoop();
    captureUrlState();
    startApiReadyPolling();
    loadSuggestedVideos();
    setupMidiControl();
    detectMobile();

    updateFooterVisibility(); // Initial visibility check

    // Check for shared state in URL - MOVED to onYouTubeIframeAPIReady
    // initFromUrl();
}


function detectMobile() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    // 1. Standard User Agent Check
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    // 2. CSS Interaction Media Query (Primary pointer is coarse/touch)
    // This is the most reliable modern check for smartphones/tablets
    const isCoarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    if (isMobileUA || isCoarsePointer) {
        document.body.classList.add('is-mobile');
    }
}

const keyMap = {
    '1': 0, '2': 1, '3': 2, '4': 3,
    'q': 4, 'w': 5, 'e': 6, 'r': 7,
    'a': 8, 's': 9, 'd': 10, 'f': 11,
    'z': 12, 'x': 13, 'c': 14, 'v': 15
};

function renderPads() {
    padGrid.innerHTML = '';

    // Reverse keyMap for display
    const indexToKey = {};
    for (const [key, idx] of Object.entries(keyMap)) {
        indexToKey[idx] = key.toUpperCase();
    }

    pads.forEach((pad, index) => {
        const padEl = document.createElement('div');
        padEl.classList.add('pad');
        padEl.dataset.index = index;
        padEl.id = `pad-${index}`;

        // Key Overlay
        const keyOverlay = document.createElement('div');
        keyOverlay.classList.add('pad-key-overlay');

        // Keycap SVG structure
        keyOverlay.innerHTML = `
            <svg class="keycap-icon" viewBox="0 0 24 24">
                <!-- Base/Side (skirt) -->
                <rect x="2" y="4" width="20" height="18" rx="3" class="keycap-side" />
                <!-- Top Face (smaller, centered) -->
                <rect x="4.5" y="2" width="15" height="15" rx="2" class="keycap-top" />
            </svg>
            <span class="key-label">${indexToKey[index] || ''}</span>
        `;
        padEl.appendChild(keyOverlay);

        // Mouse Events
        padEl.addEventListener('mousedown', (e) => handlePadTrigger(index, e));
        padEl.addEventListener('mouseup', (e) => handlePadRelease(index, e));
        padEl.addEventListener('mouseleave', (e) => handlePadRelease(index, e));

        // Touch Events
        padEl.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handlePadTrigger(index, e);
        });
        padEl.addEventListener('touchend', (e) => {
            e.preventDefault();
            handlePadRelease(index, e);
        });

        // Drag and Drop
        padEl.addEventListener('dragover', (e) => e.preventDefault());
        padEl.addEventListener('drop', (e) => handlePadDrop(index, e));
        padEl.setAttribute('draggable', true);
        padEl.addEventListener('dragstart', (e) => handlePadDragStart(index, e));

        padGrid.appendChild(padEl);
    });
}

// YouTube API Callback
function onYouTubeIframeAPIReady() {
    // Now that API is ready, we can load state from URL if present
    apiReady = true;
    if (apiReadyPoll) {
        clearInterval(apiReadyPoll);
        apiReadyPoll = null;
    }
    tryApplyUrlState();
}

// ==========================================
// 4. CORE LOGIC (LOAD, PLAY, STOP)
// ==========================================

// Helper: Extract Video ID
function extractVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// Destroy Player Helper
function destroyPlayer(pad) {
    if (pad.player && typeof pad.player.destroy === 'function') {
        pad.player.destroy();
    }
    pad.player = null;
}

// Load Video
function loadVideoToPad(index, videoId, isCopy = false, savedState = null) {
    // If the user is manually loading a clip (not applying saved/share state),
    // cancel any pending URL state so it can't later overwrite this pad.
    if (!isCopy && !savedState) {
        pendingUrlState = null;
        stateApplied = true;
        if (apiReadyPoll) {
            clearInterval(apiReadyPoll);
            apiReadyPoll = null;
        }
    }

    const pad = pads[index];

    // Cleanup existing player before creating a new one
    destroyPlayer(pad);

    pad.videoId = videoId;

    if (!isCopy && !savedState) {
        // Reset defaults on new load
        pad.volume = 100;
        pad.playbackRate = 1;
        pad.startTime = 0;
        pad.endTime = 0; // Will be set on ready
        pad.mode = 'gate';
        pad.retrigger = true;
    } else if (savedState) {
        // Restore saved state
        pad.volume = savedState.volume;
        pad.playbackRate = savedState.playbackRate;
        pad.startTime = savedState.startTime;
        pad.endTime = savedState.endTime;
        pad.mode = savedState.mode;
        pad.retrigger = (savedState.retrigger !== undefined) ? savedState.retrigger : true;
    }

    const padEl = document.getElementById(`pad-${index}`);
    padEl.classList.add('has-video');

    // Create container, preserving overlay
    const overlay = padEl.querySelector('.pad-key-overlay');
    padEl.innerHTML = `<div id="player-${index}"></div>`;
    if (overlay) padEl.appendChild(overlay);

    // Initialize YT Player
    pad.player = new YT.Player(`player-${index}`, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'iv_load_policy': 3,
            'modestbranding': 1,
            'rel': 0,
            'origin': window.location.origin
        },
        events: {
            'onReady': (event) => onPlayerReady(index, event, isCopy, savedState),
            'onStateChange': (event) => onPlayerStateChange(index, event)
        }
    });
}

function onPlayerReady(index, event, isCopy, savedState) {
    const pad = pads[index];
    pad.duration = pad.player.getDuration();

    if (!isCopy && !savedState) {
        pad.endTime = pad.duration; // Set end time to full duration on new load
    }

    pad.title = pad.player.getVideoData().title;

    // Apply current state (volume, playback rate) to the new player
    pad.player.setVolume(pad.volume);
    pad.player.setPlaybackRate(pad.playbackRate);

    // Only select if it's the first one loaded or explicitly requested?
    // Let's select if it's a manual load. For bulk load, maybe not.
    if (!savedState) {
        selectPad(index);
        updateUrlState(); // Update URL on new load
    }

}

function onPlayerStateChange(index, event) {
    const padEl = document.getElementById(`pad-${index}`);
    if (event.data === YT.PlayerState.PLAYING) {
        padEl.classList.add('playing');
        pads[index].isPlaying = true;
    } else if (event.data === YT.PlayerState.ENDED && pads[index].mode === 'loop') {
        // If we hit the natural video end while in loop mode, immediately restart
        const pad = pads[index];
        pad.player.seekTo(pad.startTime, true);
        pad.player.playVideo();
        padEl.classList.add('playing');
        pad.isPlaying = true;
    } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
        padEl.classList.remove('playing');
        pads[index].isPlaying = false;

        // Remove from stack when stopped
        activePadStack = activePadStack.filter(i => i !== index);
        updateZIndices();
    }
    updateTransportIcon();
}

function updateZIndices() {
    const isFullScreen = document.body.classList.contains('full-screen-mode');

    // Reset styles for all pads first
    pads.forEach((_, i) => {
        const el = document.getElementById(`pad-${i}`);
        if (el) {
            el.style.zIndex = '';
            el.style.opacity = '';
            el.style.pointerEvents = '';
        }
    });

    // Apply z-indices based on stack position
    activePadStack.forEach((padIndex, stackIndex) => {
        const el = document.getElementById(`pad-${padIndex}`);
        if (el) {
            // Apply Z-Index Stacking (Critical for visibility order)
            el.style.zIndex = 3000 + stackIndex;

            if (isFullScreen) {
                const isTop = stackIndex === activePadStack.length - 1;

                // Hack: Top pad is 0.999 to force composition with layers below.
                // Background pads are 1 (fully rendering) but z-indexed behind.
                // This forces the browser to render background videos, preventing auto-pause.
                el.style.opacity = isTop ? '0.999' : '1';

                // Only top pad should receive pointer events
                el.style.pointerEvents = isTop ? 'auto' : 'none';
            } else {
                // Grid mode: Opacity is handled by CSS (always 1 for playing)
                // We don't need to force it, but let's clear it just in case
                el.style.opacity = '';
                el.style.pointerEvents = '';
            }
        }
    });
}


// Playback Trigger
function handlePadTrigger(index, e) {
    const pad = pads[index];

    // If empty, show modal to load video (only for pointer events, not keyboard)
    if (!pad.videoId) {
        // Only show modal for mouse/touch events, not keyboard events
        if (e && (e.type === 'mousedown' || e.type === 'touchstart')) {
            showLoaderModal(index);
        }
        return;
    }

    if (!pad.player) return; // Player might not be ready yet

    // Logic:
    // If !retrigger: "Operates as play/pause" (Toggle behavior).
    // If retrigger: Always restarts (Retrigger behavior).
    if (pad.isPlaying) {
        if (!pad.retrigger) {
            pad.player.pauseVideo();
            pad.isPlaying = false;
            document.getElementById(`pad-${index}`).classList.remove('playing'); // Sync update

            // Remove from stack
            activePadStack = activePadStack.filter(i => i !== index);
            updateZIndices();

            updateTransportIcon();
            return;
        }
    }

    selectPad(index); // Select the triggered pad
    startPadPlayback(index);
}

// Playback Release
function handlePadRelease(index, e) {
    const pad = pads[index];
    if (!pad.player || !pad.videoId) return;

    // Gate mode always stops on release (Gate behavior)
    // Resume behavior is handled by startPadPlayback not seeking to start
    if (pad.mode === 'gate') {
        pad.player.pauseVideo();
        pad.isPlaying = false;
        document.getElementById(`pad-${index}`).classList.remove('playing'); // Sync update

        // Remove from stack
        activePadStack = activePadStack.filter(i => i !== index);
        updateZIndices();

        updateTransportIcon();
    }
    // If oneshot or loop, it continues playing
}

// Copy Pad Logic
function copyPad(sourceIndex, targetIndex) {
    const sourcePad = pads[sourceIndex];
    if (!sourcePad.videoId) return; // Nothing to copy

    const targetPad = pads[targetIndex];

    // Copy all relevant state from source to target
    targetPad.videoId = sourcePad.videoId;
    targetPad.startTime = sourcePad.startTime;
    targetPad.endTime = sourcePad.endTime;
    targetPad.mode = sourcePad.mode;
    targetPad.volume = sourcePad.volume;
    targetPad.playbackRate = sourcePad.playbackRate;
    targetPad.retrigger = sourcePad.retrigger;
    targetPad.title = sourcePad.title; // Also copy title for immediate display

    // Reload target pad with isCopy=true to preserve copied settings
    loadVideoToPad(targetIndex, targetPad.videoId, true);
    updateUrlState(); // Update URL on copy
}

// Delete Pad Logic
function deletePad(index) {
    const pad = pads[index];
    destroyPlayer(pad); // Destroy the YouTube player instance

    // Reset pad state
    pad.videoId = null;
    pad.title = '';
    pad.startTime = 0;
    pad.endTime = 0;
    pad.duration = 0; // Reset duration as well
    pad.volume = 100;
    pad.playbackRate = 1;
    pad.isPlaying = false;

    const padEl = document.getElementById(`pad-${index}`);
    padEl.classList.remove('has-video');
    padEl.classList.remove('playing'); // Ensure playing class is removed

    // Remove from stack and clear z-index
    activePadStack = activePadStack.filter(i => i !== index);
    padEl.style.zIndex = '';
    updateZIndices();

    updateTransportIcon();

    // Restore overlay
    const overlay = padEl.querySelector('.pad-key-overlay');
    padEl.innerHTML = '';
    if (overlay) padEl.appendChild(overlay);

    if (activePadIndex === index) {
        // If the deleted pad was active, update UI to reflect no selection

        updateVideoTitle('Select a pad to load video');
        updateTimelineUI(index); // Will clear timeline UI since duration is 0
        updateKnobVisual(valBarVol, 100, 0, 100); // Reset knob visuals
        updateKnobVisual(valBarPitch, 1, 0.25, 2);
        if (pitchText) pitchText.textContent = '1x';
        updateRetriggerToggle(true);
        document.querySelectorAll('.mode-option').forEach(el => el.classList.remove('active'));

        // Reset active pad index and update visibility
        activePadIndex = null;
        updateFooterVisibility();
    }
    updateUrlState(); // Update URL on delete
}

// ==========================================
// 5. UI UPDATES & SELECTION
// ==========================================

function selectPad(index) {
    activePadIndex = index;
    const pad = pads[index];

    // Update active class on pads
    document.querySelectorAll('.pad').forEach(el => el.classList.remove('active'));
    const padEl = document.getElementById(`pad-${index}`);
    if (padEl) padEl.classList.add('active');

    // Update Header Display

    updateVideoTitle(pad.title || 'Loading...');

    renderModeIcon(pad.mode);

    // Update Timeline & Knobs based on selected pad's state
    updateTimelineUI(index);
    updateKnobVisual(valBarVol, pad.volume, 0, 100);
    updateKnobVisual(valBarPitch, pad.playbackRate, 0.25, 2);
    if (pitchText) pitchText.textContent = pad.playbackRate + 'x';
    updateRetriggerToggle(pad.retrigger);

    updateFooterVisibility();
}

function renderModeIcon(mode) {
    // Update active state on options
    document.querySelectorAll('.mode-option').forEach(el => {
        if (el.dataset.mode === mode) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function updateTimelineUI(index, isDraggingArg = false) {
    const isDragging = isDraggingArg || timelineContainer.classList.contains('is-dragging');
    const pad = pads[index];
    if (!pad.duration) {
        // Reset UI elements if no video is loaded or duration is zero
        trimStart.style.left = '0%';
        trimEnd.style.left = '100%';
        trimOverlayLeft.style.width = '0%';
        trimOverlayRight.style.left = '100%';
        trimOverlayRight.style.width = '0%';
        playhead.style.left = '0%'; // Reset playhead position
        startTimeDisplay.textContent = '00:00';
        endTimeDisplay.textContent = '00:00';
        return;
    }

    const startPercent = (pad.startTime / pad.duration) * 100;
    const endPercent = (pad.endTime / pad.duration) * 100;

    trimStart.style.left = `${startPercent}%`;
    trimEnd.style.left = `${endPercent}%`;

    trimOverlayLeft.style.width = `${startPercent}%`;
    trimOverlayRight.style.left = `${endPercent}%`;
    trimOverlayRight.style.width = `${100 - endPercent}%`;

    // Helper to format time for display
    const formatTime = (t) => {
        const m = Math.floor(t / 60).toString().padStart(2, '0');
        const s = Math.floor(t % 60).toString().padStart(2, '0');
        if (isDragging) {
            const ms = Math.floor((t % 1) * 1000).toString().padStart(3, '0');
            return `${m}:${s}.${ms}`;
        }
        return `${m}:${s}`;
    };
    startTimeDisplay.textContent = formatTime(pad.startTime);
    endTimeDisplay.textContent = formatTime(pad.endTime);
}

function updateKnobVisual(pathElement, value, min, max) {
    if (!pathElement) return;
    // Semi-circle arc length is approx 50 (Pi * 18px radius)
    const maxLength = 56.5;
    const percent = Math.max(0, Math.min(1, (value - min) / (max - min)));
    // Offset calculation: 0 is full, maxLength is empty
    const offset = maxLength * (1 - percent);
    pathElement.style.strokeDashoffset = offset;
}

function updateTransportIcon() {
    const anyPlaying = pads.some(p => p.isPlaying);
    playPauseIcon.innerHTML = anyPlaying ? pauseIconMarkup : playIconMarkup;
}

// Single-player playback; loop by seek for lowest possible gap
function startPadPlayback(index) {
    const pad = pads[index];
    if (!pad.videoId) return;

    pad.player.setVolume(pad.volume);
    pad.player.setPlaybackRate(pad.playbackRate);

    // Seek Logic:
    // If Retrigger is ON: Always seek to Start Time.
    // If Retrigger is OFF (Resume Mode):
    //    - If at/past End Time: Seek to Start Time.
    //    - If not yet started (currentTime < startTime): Seek to Start Time.
    //    - Else: Do not seek (Resume).

    let shouldSeek = true;
    if (!pad.retrigger) {
        // If player has officially ended, we must seek to start
        if (pad.player.getPlayerState && pad.player.getPlayerState() === 0) { // 0 is ENDED
            shouldSeek = true;
        } else {
            const currentTime = pad.player.getCurrentTime();
            // Check if we are "in bounds" to resume
            // We use a larger buffer (0.2s) here than the loop epsilon to avoid 
            // resuming right at the end just to stop 1 frame later.
            const resumeThreshold = 0.2;

            if (currentTime >= pad.startTime && currentTime < pad.endTime - resumeThreshold) {
                shouldSeek = false;
            }
        }
    }

    if (shouldSeek) {
        pad.player.seekTo(pad.startTime, true);
    }
    pad.player.playVideo();

    // Immediately mark the pad as playing so it stays visible in full-screen mode
    // (YouTube can auto-pause if the iframe is hidden while we wait for the PLAYING event)
    const padEl = document.getElementById(`pad-${index}`);
    if (padEl) padEl.classList.add('playing');

    pad.isPlaying = true;

    // Add to top of stack (remove if exists first to move to top)
    activePadStack = activePadStack.filter(i => i !== index);
    activePadStack.push(index);
    updateZIndices();

    updateTransportIcon();
}

function updateFooterVisibility() {
    const hasActivePad = activePadIndex !== null;
    const footerControls = document.querySelector('.footer-controls');
    const footerTrash = document.querySelector('.footer-trash');
    const footerRow2 = document.querySelector('.footer-row-2');
    const videoTitle = document.getElementById('video-title');

    if (hasActivePad) {
        footerControls.classList.remove('hidden-control');
        footerTrash.classList.remove('hidden-control');
        footerRow2.classList.remove('hidden-control');
    } else {
        footerControls.classList.add('hidden-control');
        footerTrash.classList.add('hidden-control');
        footerRow2.classList.add('hidden-control');
        if (videoTitle) videoTitle.textContent = 'Select a pad to load video';
    }
}

// ==========================================
// 6. EVENT LISTENERS & INTERACTION
// ==========================================

// Mode Control
function setupModeControl() {
    modeControlLcd.addEventListener('click', (e) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];

        // Check if a specific mode option was clicked
        const option = e.target.closest('.mode-option');
        if (option) {
            pad.mode = option.dataset.mode;
        } else {
            // Cycle if click was on the container but not a specific option
            if (pad.mode === 'gate') pad.mode = 'oneshot';
            else if (pad.mode === 'oneshot') pad.mode = 'loop';
            else pad.mode = 'gate';
        }

        renderModeIcon(pad.mode);
        updateUrlState(); // Update URL on mode change
    });
}

// Retrigger Control
function setupRetriggerControl() {
    controlRetrigger.addEventListener('click', () => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        pad.retrigger = !pad.retrigger;
        updateRetriggerToggle(pad.retrigger);
        updateUrlState();
    });
}

function updateRetriggerToggle(active) {
    if (active) {
        controlRetrigger.classList.add('active');
    } else {
        controlRetrigger.classList.remove('active');
    }
}

// Knobs
function setupKnobs() {
    // Generic knob setup function
    function setupKnob(element, param, min, max, step, onChange, onReset, onClick) {
        let isDragging = false;
        let hasDragged = false; // Track if actual dragging (mouse movement) occurred
        let startY = 0;
        let startValue = 0;

        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            hasDragged = false; // Reset drag flag on new mousedown
            startY = e.clientY;
            if (activePadIndex === null) return;
            startValue = pads[activePadIndex][param]; // Get current value from active pad
            document.body.style.cursor = 'ns-resize'; // Change cursor for dragging
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            if (activePadIndex === null) return;

            const deltaY = startY - e.clientY; // Up is positive

            // Only consider it a drag if moved more than 3 pixels
            if (Math.abs(deltaY) > 3) {
                hasDragged = true;
            }

            const sensitivity = (max - min) / 200; // 200px drag for full range
            let newValue = startValue + (deltaY * sensitivity);
            newValue = Math.max(min, Math.min(max, newValue)); // Clamp value

            onChange(newValue); // Call specific change handler
        });

        window.addEventListener('mouseup', () => {
            if (isDragging) {
                // Call onClick handler if provided and no dragging occurred
                if (onClick && !hasDragged) {
                    onClick(hasDragged);
                } else if (hasDragged) {
                    updateUrlState(); // Update URL on drag end (only if dragged)
                }
                isDragging = false;
                hasDragged = false;
                document.body.style.cursor = 'default'; // Reset cursor
            }
        });

        // Double click to reset knob value
        element.addEventListener('dblclick', () => {
            if (activePadIndex === null) return;
            onReset();
            updateUrlState(); // Update URL on reset
        });
    }


    // Volume Knob specific setup
    let volumeBeforeMute = 100; // Store volume before muting for unmute restore
    setupKnob(knobVolume, 'volume', 0, 100, null, (val) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        pad.volume = Math.round(val); // Volume is integer
        updateKnobVisual(valBarVol, pad.volume, 0, 100);
        if (pad.player && pad.player.setVolume) pad.player.setVolume(pad.volume);
    }, () => {
        // Reset Volume
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        pad.volume = 100;
        updateKnobVisual(valBarVol, pad.volume, 0, 100);
        if (pad.player && pad.player.setVolume) pad.player.setVolume(100);
    }, (hasDragged) => {
        // Click handler (only called if no drag occurred)
        if (hasDragged) return;
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];

        // Toggle mute/unmute
        if (pad.volume > 0) {
            // Mute: store current volume and set to 0
            volumeBeforeMute = pad.volume;
            pad.volume = 0;
        } else {
            // Unmute: restore previous volume (default to 100 if was 0)
            pad.volume = volumeBeforeMute > 0 ? volumeBeforeMute : 100;
        }

        updateKnobVisual(valBarVol, pad.volume, 0, 100);
        if (pad.player && pad.player.setVolume) pad.player.setVolume(pad.volume);
        updateUrlState();
    });

    // Pitch Knob specific setup
    const availableRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; // YouTube supported rates
    setupKnob(knobPitch, 'playbackRate', 0.25, 2, null, (val) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        // Snap to nearest available rate for YouTube player
        const nearest = availableRates.reduce((prev, curr) => {
            return (Math.abs(curr - val) < Math.abs(prev - val) ? curr : prev);
        });
        pad.playbackRate = nearest;
        updateKnobVisual(valBarPitch, pad.playbackRate, 0.25, 2);
        if (pitchText) pitchText.textContent = pad.playbackRate + 'x';
        if (pad.player && pad.player.setPlaybackRate) pad.player.setPlaybackRate(pad.playbackRate);
    }, () => {
        // Reset Pitch
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        pad.playbackRate = 1;
        updateKnobVisual(valBarPitch, pad.playbackRate, 0.25, 2);
        if (pitchText) pitchText.textContent = '1x';
        if (pad.player && pad.player.setPlaybackRate) pad.player.setPlaybackRate(1);
    });
}

// Timeline Trimming Events
function setupTimelineEvents() {
    let mode = null; // 'start', 'end', 'range'
    let startX = 0;
    let startY = 0;
    let lastX = 0;

    const getSensitivity = (currentY) => {
        const verticalDist = Math.abs(currentY - startY);
        // If within 50px vertically, 1:1 sensitivity.
        // Beyond that, sensitivity decreases.
        // Formula: 1 / (1 + (dist - threshold) * factor)
        // Example: dist=150 (100 over threshold) -> 1 / (1 + 100/50) = 1/3 speed.
        if (verticalDist < 50) return 1;
        return 1 / (1 + (verticalDist - 50) / 50);
    };

    const handleStart = (e, m) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        if (!pad || !pad.duration) return;

        mode = m;
        // Support both mouse and touch
        const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

        startX = clientX;
        startY = clientY;
        lastX = clientX;

        timelineContainer.classList.add('is-dragging');

        // Add visual cues
        if (mode === 'start') trimStart.classList.add('dragging');
        if (mode === 'end') trimEnd.classList.add('dragging');
        if (mode === 'range') timelineContainer.style.cursor = 'grabbing';

        // Stop propagation if it's a handle, but for range we might need to be careful
        e.stopPropagation();
        e.preventDefault();
    };

    const handleMove = (e) => {
        if (!mode) return;
        const pad = pads[activePadIndex];
        if (!pad) return;

        const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);

        const rect = timelineContainer.getBoundingClientRect();
        const duration = pad.duration;
        const width = rect.width;
        if (width === 0) return;

        const sensitivity = getSensitivity(clientY);
        const deltaX = clientX - lastX;
        lastX = clientX; // Update for next frame

        // Calculate time delta logic
        // default: deltaX pixels maps to (deltaX / width) * duration
        const timeDelta = (deltaX / width) * duration * sensitivity;

        if (mode === 'start') {
            let newStart = pad.startTime + timeDelta;
            newStart = Math.max(0, Math.min(newStart, pad.endTime - LOOP_EPSILON));
            pad.startTime = newStart;
        } else if (mode === 'end') {
            let newEnd = pad.endTime + timeDelta;
            newEnd = Math.max(pad.startTime + LOOP_EPSILON, Math.min(newEnd, pad.duration));
            pad.endTime = newEnd;
        } else if (mode === 'range') {
            let newStart = pad.startTime + timeDelta;
            let newEnd = pad.endTime + timeDelta;

            // Clamp whole range
            if (newStart < 0) {
                const shift = 0 - newStart;
                newStart += shift;
                newEnd += shift;
            }
            if (newEnd > pad.duration) {
                const shift = newEnd - pad.duration;
                newStart -= shift;
                newEnd -= shift;
            }
            // Double check end constraint just in case duration is small/edge case
            if (newEnd > pad.duration) newEnd = pad.duration;

            pad.startTime = newStart;
            pad.endTime = newEnd;
        }

        updateTimelineUI(activePadIndex, true);
    };

    const handleEnd = () => {
        if (mode) {
            updateUrlState(); // Persist changes
            trimStart.classList.remove('dragging');
            trimEnd.classList.remove('dragging');
            timelineContainer.classList.remove('is-dragging');
            timelineContainer.style.cursor = '';
        }
        mode = null;
    };

    // --- Event Listeners ---

    // Handles
    trimStart.addEventListener('mousedown', (e) => handleStart(e, 'start'));
    trimEnd.addEventListener('mousedown', (e) => handleStart(e, 'end'));
    trimStart.addEventListener('touchstart', (e) => handleStart(e, 'start'));
    trimEnd.addEventListener('touchstart', (e) => handleStart(e, 'end'));

    // Range (Timeline Container)
    // We need to differentiate clicking on handles vs empty space vs range
    // Handles stop prop, so we only need to check if we are IN the range
    timelineContainer.addEventListener('mousedown', (e) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        if (!pad || !pad.duration) return;

        const rect = timelineContainer.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const clickTime = (offsetX / rect.width) * pad.duration;

        if (clickTime > pad.startTime && clickTime < pad.endTime) {
            handleStart(e, 'range');
        }
    });

    // Touch for Range (using touchstart on container)
    timelineContainer.addEventListener('touchstart', (e) => {
        if (activePadIndex === null) return;
        const pad = pads[activePadIndex];
        if (!pad || !pad.duration) return;

        const rect = timelineContainer.getBoundingClientRect();
        const clientX = e.touches[0].clientX;
        const offsetX = clientX - rect.left;
        const clickTime = (offsetX / rect.width) * pad.duration;

        if (clickTime > pad.startTime && clickTime < pad.endTime) {
            handleStart(e, 'range');
        }
    });


    // Global Movement
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);
}

// Modal (Load Video) Events
function setupModalEvents() {
    document.getElementById('btn-close-modal').addEventListener('click', hideLoaderModal);
    btnCancelLoad.addEventListener('click', hideLoaderModal);
    btnConfirmLoad.addEventListener('click', confirmLoad);

    videoUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmLoad();
    });

    // Close modal if clicking outside the content
    loaderModal.addEventListener('click', (e) => {
        if (e.target === loaderModal) hideLoaderModal();
    });
}

function showLoaderModal(index) {
    padToLoadIndex = index; // Store which pad to load to
    loaderModal.classList.add('visible');
    videoUrlInput.value = ''; // Clear previous input
    renderSuggestedVideos(); // Render suggested videos when modal opens
    setTimeout(() => videoUrlInput.focus(), 50); // Focus input for convenience
}

function hideLoaderModal() {
    loaderModal.classList.remove('visible');
    padToLoadIndex = null;
}

function confirmLoad() {
    const url = videoUrlInput.value;
    if (!url.trim()) {
        // If input is empty, open YouTube in a new tab
        window.open('https://www.youtube.com', '_blank');
        return;
    }

    const videoId = extractVideoId(url);
    if (videoId && padToLoadIndex !== null) {
        loadVideoToPad(padToLoadIndex, videoId);
        hideLoaderModal();
    } else {
        alert('Invalid YouTube URL');
    }
}

// ==========================================
// SUGGESTED VIDEOS
// ==========================================

async function loadSuggestedVideos() {
    try {
        const cacheBuster = 'v4';
        const response = await fetch(`suggested-videos.json?cb=${cacheBuster}`, { cache: 'no-store' });
        suggestedVideos = await response.json();
    } catch (error) {
        console.error('Failed to load suggested videos:', error);
        suggestedVideos = [];
    }
}

function renderSuggestedVideos() {
    if (suggestedVideos.length === 0) {
        suggestedVideosGrid.innerHTML = '<p style="color: #888; font-size: 11px; grid-column: 1 / -1;">Loading suggestions...</p>';
        return;
    }

    // Clear existing content
    suggestedVideosGrid.innerHTML = '';

    suggestedVideos.forEach((video, index) => {
        const videoId = extractVideoId(video.url);
        if (!videoId) return;

        // Create pad element
        const padEl = document.createElement('div');
        padEl.classList.add('suggested-video-pad');
        padEl.dataset.videoId = videoId;
        padEl.dataset.index = index;

        // Create thumbnail image
        // YouTube thumbnail URLs: https://img.youtube.com/vi/{VIDEO_ID}/mqdefault.jpg
        const thumbnail = document.createElement('img');
        thumbnail.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        thumbnail.alt = 'Video thumbnail';
        thumbnail.classList.add('suggested-video-thumbnail');
        padEl.appendChild(thumbnail);

        // Add click handler
        padEl.addEventListener('click', () => {
            if (padToLoadIndex !== null) {
                loadVideoToPad(padToLoadIndex, videoId);
                hideLoaderModal();
            }
        });

        suggestedVideosGrid.appendChild(padEl);
    });
}

// ==========================================
// TRASH & DRAG DROP EVENTS
// ==========================================

// Trash & Drag Drop Events
function setupTrashEvents() {
    trashZone.addEventListener('dragover', (e) => {
        e.preventDefault(); // Allow drop
        trashZone.classList.add('drag-over'); // Visual feedback
    });
    trashZone.addEventListener('dragleave', () => trashZone.classList.remove('drag-over'));
    trashZone.addEventListener('drop', (e) => {
        e.preventDefault();
        trashZone.classList.remove('drag-over');
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.type === 'pad-move') {
                deletePad(data.index); // Delete the dragged pad
            }
        } catch (err) {
            // Not a pad move, ignore (e.g., URL drop)
        }
    });

    // Click to delete active pad
    trashZone.addEventListener('click', () => {
        if (activePadIndex !== null) {
            deletePad(activePadIndex);
        }
    });
}

function handlePadDragStart(index, e) {
    // Set data for drag operation (pad index)
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'pad-move', index }));
    trashZone.classList.add('drag-over'); // Show trash zone
}

function handlePadDrop(index, e) {
    e.preventDefault();
    e.stopPropagation(); // Prevent parent elements from handling drop

    try {
        const rawData = e.dataTransfer.getData('text/plain');
        const data = JSON.parse(rawData);
        if (data.type === 'pad-move') {
            // If it's a pad being moved/copied
            if (data.index !== index) { // Don't copy to self
                copyPad(data.index, index);
            }
            return;
        }
    } catch (err) {
        // Not a pad move, ignore (e.g., URL drop)
    }

    // If not a pad move, try to load as a URL
    const data = e.dataTransfer.getData('text');
    const videoId = extractVideoId(data);
    if (videoId) {
        loadVideoToPad(index, videoId);
    }
}

// ==========================================
// FULL SCREEN MODE
// ==========================================

function setupFullScreenEvents() {
    btnFullscreen.addEventListener('click', enterFullScreen);
    btnExitFullscreen.addEventListener('click', exitFullScreen);

    // Listen for Escape key to exit full screen
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('full-screen-mode')) {
            exitFullScreen();
        }
    });
}

function enterFullScreen() {
    if (activePadIndex === null) {
        // If no pad is active, maybe select the first one with a video?
        const firstWithVideo = pads.findIndex(p => p.videoId);
        if (firstWithVideo !== -1) {
            selectPad(firstWithVideo);
        } else {
            alert('Please load a video first.');
            return;
        }
    }
    document.body.classList.add('full-screen-mode');
    updateZIndices();
}

function exitFullScreen() {
    document.body.classList.remove('full-screen-mode');
    updateZIndices();
}

// ==========================================
// 8. MIDI SUPPORT
// ==========================================

function setupMidiControl() {
    const btnMidiToggle = document.getElementById('btn-midi-toggle');
    btnMidiToggle.addEventListener('click', toggleMidi);
}

async function toggleMidi() {
    const btnMidiToggle = document.getElementById('btn-midi-toggle');

    if (midiEnabled) {
        // Disable MIDI
        midiEnabled = false;
        btnMidiToggle.classList.remove('active');
        if (midiAccess) {
            // Remove event listeners from all inputs
            for (const input of midiAccess.inputs.values()) {
                input.onmidimessage = null;
            }
        }
        console.log('MIDI Disabled');
    } else {
        // Enable MIDI
        try {
            if (!midiAccess) {
                midiAccess = await navigator.requestMIDIAccess();
            }

            midiEnabled = true;
            btnMidiToggle.classList.add('active');

            // Attach listeners to all inputs
            for (const input of midiAccess.inputs.values()) {
                input.onmidimessage = onMidiMessage;
            }

            // Listen for connection changes
            midiAccess.onstatechange = (e) => {
                if (e.port.type === 'input' && e.port.state === 'connected') {
                    e.port.onmidimessage = onMidiMessage;
                }
            };

            console.log('MIDI Enabled');
        } catch (err) {
            console.error('MIDI Access Failed:', err);
            alert('Could not access MIDI devices. Please ensure you are using a supported browser (Chrome, Edge, Atlas) and have granted permission.');
        }
    }
}

function onMidiMessage(event) {
    if (!midiEnabled) return;

    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const note = data1;
    const velocity = data2;

    // Note On (144) or Note Off (128)
    // Some devices send Note On with velocity 0 for Note Off
    if (command === 144 && velocity > 0) {
        // Note On
        handleMidiNoteOn(note, velocity);
    } else if (command === 128 || (command === 144 && velocity === 0)) {
        // Note Off
        handleMidiNoteOff(note);
    }
}

const midiStartNote = 36;

function handleMidiNoteOn(note, velocity) {
    // Map notes 36-51 to pads 0-15
    const padIndex = note - midiStartNote;

    if (padIndex >= 0 && padIndex < PAD_COUNT) {
        // Simulate pad trigger
        // We pass a mock event object if needed, or modify handlePadTrigger to handle missing event
        handlePadTrigger(padIndex, { type: 'midi', velocity: velocity });
    }
}

function handleMidiNoteOff(note) {
    const padIndex = note - midiStartNote;

    if (padIndex >= 0 && padIndex < PAD_COUNT) {
        handlePadRelease(padIndex, { type: 'midi' });
    }
}


// Clipboard Paste Support
function setupClipboardEvents() {
    document.addEventListener('paste', (e) => {
        // Ignore paste if user is typing in an input
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedData = clipboardData.getData('Text');
        const videoId = extractVideoId(pastedData);

        if (videoId) {
            if (activePadIndex !== null) {
                // If a pad is active, load to that pad
                loadVideoToPad(activePadIndex, videoId);
            } else {
                // Otherwise, find the first empty pad
                const emptyIndex = pads.findIndex(p => !p.videoId);
                if (emptyIndex !== -1) {
                    loadVideoToPad(emptyIndex, videoId);
                } else {
                    alert('No empty pads available to paste video.');
                }
            }
        }
    });
}

// Keyboard (Musical Typing) Events
function setupKeyboardEvents() {
    // keyMap is defined globally above

    document.addEventListener('keydown', (e) => {
        // Ignore keyboard input if an input field is active
        if (document.activeElement.tagName === 'INPUT') return;
        if (e.repeat) return; // Prevent multiple triggers on key hold

        // Spacebar to stop all playing pads
        if (e.code === 'Space') {
            e.preventDefault(); // Prevent scrolling
            pads.forEach((pad, index) => {
                if (pad.player && pad.player.pauseVideo) {
                    pad.player.pauseVideo();
                }
                pad.isPlaying = false;
                document.getElementById(`pad-${index}`).classList.remove('playing');
            });
            updateTransportIcon();
            return;
        }

        const key = e.key.toLowerCase();
        if (keyMap.hasOwnProperty(key)) {
            const index = keyMap[key];
            handlePadTrigger(index, e);
            document.getElementById(`pad-${index}`).classList.add('active'); // Visual feedback
        }
    });

    document.addEventListener('keyup', (e) => {
        if (document.activeElement.tagName === 'INPUT') return;

        const key = e.key.toLowerCase();
        if (keyMap.hasOwnProperty(key)) {
            const index = keyMap[key];
            handlePadRelease(index, e);
            document.getElementById(`pad-${index}`).classList.remove('active'); // Remove visual feedback
        }
    });
}

// Playback Loop (for checking end times and updating playhead)
function startPlaybackLoop() {
    setInterval(() => {
        pads.forEach((pad, index) => {
            if (pad.isPlaying && pad.player && pad.player.getCurrentTime) {
                const currentTime = pad.player.getCurrentTime();

                // Update playhead position for the active pad
                if (index === activePadIndex) {
                    const percent = (currentTime / pad.duration) * 100;
                    playhead.style.left = `${percent}%`;
                }

                // Check if current time is at/near the defined end time
                // Fix: Only apply EPSILON check if we are NOT at the natural end of the video.
                // If endTime is the full duration, let the player finish naturally (triggered by ON_STATE_CHANGE -> ENDED).
                // This prevents cutting off the last fraction of a second and ensures playhead reaches the end.
                const isFullDuration = Math.abs(pad.duration - pad.endTime) < 0.1;

                if (!isFullDuration && currentTime >= pad.endTime - LOOP_EPSILON) {
                    if (pad.mode === 'loop') {
                        // Loop mode: jump back with seek for tighter loop
                        pad.player.seekTo(pad.startTime, true);
                        pad.player.playVideo();
                    } else {
                        // Gate or One-Shot: Stop playback
                        pad.player.pauseVideo();
                        pad.player.seekTo(pad.startTime, true); // Reset to start time
                        pad.isPlaying = false;
                        document.getElementById(`pad-${index}`).classList.remove('playing');
                        updateTransportIcon();
                    }
                }
            }
        });
    }, 50); // Check every 50ms (20 times per second)
}

// ==========================================
// 7. STATE SHARING (URL)
// ==========================================

function serializeState() {
    const state = pads.map(p => {
        if (!p.videoId) return null;
        return {
            v: p.videoId,
            s: parseFloat(p.startTime.toFixed(2)),
            e: parseFloat(p.endTime.toFixed(2)),
            m: p.mode,
            vol: p.volume,
            r: p.playbackRate,
            rt: p.retrigger ? 1 : 0
        };
    });
    return btoa(JSON.stringify(state));
}

function deserializeState(encoded) {
    try {
        const json = atob(encoded.replace(/ /g, '+')); // Guard against spaces replacing plus signs
        return JSON.parse(json);
    } catch (e) {
        console.error('Failed to deserialize state', e);
        return null;
    }
}

function updateUrlState() {
    const encoded = serializeState();
    history.replaceState(null, null, `#${encoded}`);
}

function captureUrlState() {
    const hash = window.location.hash.substring(1);
    if (!hash) return;
    pendingUrlState = deserializeState(hash);
    tryApplyUrlState();
}

function tryApplyUrlState() {
    if (!apiReady || stateApplied || !pendingUrlState) return;

    pendingUrlState.forEach((padState, index) => {
        if (padState && padState.v) {
            // Map back to full property names
            const fullState = {
                videoId: padState.v,
                startTime: padState.s,
                endTime: padState.e,
                mode: padState.m,
                volume: padState.vol,
                playbackRate: padState.r,
                retrigger: (padState.rt !== undefined) ? !!padState.rt : true
            };
            loadVideoToPad(index, padState.v, false, fullState);
        }
    });

    stateApplied = true;
}

function startApiReadyPolling() {
    if (apiReadyPoll) return;
    apiReadyPoll = setInterval(() => {
        if (window.YT && window.YT.Player) {
            apiReady = true;
            tryApplyUrlState();
            clearInterval(apiReadyPoll);
            apiReadyPoll = null;
        }
    }, 150);
}

function setupShareEvents() {
    btnShare.addEventListener('click', () => {
        const url = window.location.href;
        const originalContent = btnShare.innerHTML;

        navigator.clipboard.writeText(url).then(() => {
            // Change to text
            btnShare.textContent = 'COPIED URL';
            btnShare.style.color = 'var(--accent-green)'; // Optional: success color

            // Revert after 2 seconds
            setTimeout(() => {
                btnShare.innerHTML = originalContent;
                btnShare.style.color = ''; // Reset color
            }, 5000);
        }).catch(err => {
            console.error('Failed to copy URL', err);
            alert('Failed to copy URL to clipboard');
        });
    });
}

// Play/Pause Button (same as spacebar)
function setupPlayPauseButton() {
    btnPlayPause.addEventListener('click', () => {
        // Same logic as spacebar: pause all playing pads
        pads.forEach((pad, index) => {
            if (pad.player && pad.player.pauseVideo) {
                pad.player.pauseVideo();
            }
            pad.isPlaying = false;
            document.getElementById(`pad-${index}`).classList.remove('playing');
        });
        updateTransportIcon();
    });
}

// Helper to update video title with marquee check
function updateVideoTitle(text) {
    videoTitle.textContent = text;
}

// Start the application
init();
