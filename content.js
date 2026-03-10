// content.js — Runs on youtube.com pages.
// Uses a MutationObserver to detect:
//   1. A new <video> element being added to the DOM.
//   2. The `src` attribute changing on an existing <video> element.
// When either event fires, the script instantly pauses the video, shows an
// "Analyzing..." overlay on the player, and sends a CHECK_VIDEO message to the
// background service worker.  The overlay transitions to an ALLOW (removed) or
// BLOCK (red) state depending on the response.

(function () {
  "use strict";

  // ─── Logging ──────────────────────────────────────────────────────
  const LOG_PREFIX = "[YT Kids Guard]";
  function log(...args) { console.log(LOG_PREFIX, ...args); }
  function warn(...args) { console.warn(LOG_PREFIX, ...args); }
  function error(...args) { console.error(LOG_PREFIX, ...args); }

  // ─── Injected stylesheet ────────────────────────────────────────────
  // All overlay + spinner CSS lives here so it can be injected once and
  // referenced by class names throughout the script.

  const STYLE_ID = "ytkg-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* ── Overlay base: sits on top of the video player ── */
      .ytkg-overlay {
        position: absolute;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
        text-align: center;
        padding: 2rem;
        transition: background 0.4s ease;
        pointer-events: auto;
      }

      /* ── State: analysing (opaque black) ── */
      .ytkg-overlay--analyzing {
        background: rgba(0, 0, 0, 0.95);
        color: #e0e0e0;
      }

      /* ── State: blocked (red) ── */
      .ytkg-overlay--blocked {
        background: rgba(180, 30, 30, 0.95);
        color: #fff;
      }

      /* ── Spinner (CSS-only ring) ── */
      .ytkg-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid rgba(255, 255, 255, 0.15);
        border-top-color: #fff;
        border-radius: 50%;
        animation: ytkg-spin 0.8s linear infinite;
        margin-bottom: 1.25rem;
      }

      @keyframes ytkg-spin {
        to { transform: rotate(360deg); }
      }

      /* ── Typography ── */
      .ytkg-overlay__title {
        font-size: 1.15rem;
        font-weight: 500;
        margin: 0;
        line-height: 1.5;
      }

      .ytkg-overlay__reason {
        font-size: 0.95rem;
        font-weight: 400;
        max-width: 420px;
        line-height: 1.6;
        margin: 0.75rem 0 0;
        opacity: 0.9;
      }

      .ytkg-overlay__back-btn {
        margin-top: 1.5rem;
        padding: 0.6rem 1.75rem;
        font-size: 0.95rem;
        font-weight: 500;
        cursor: pointer;
        border: none;
        border-radius: 6px;
        background: #fff;
        color: #b41e1e;
        transition: opacity 0.2s;
      }

      .ytkg-overlay__back-btn:hover {
        opacity: 0.85;
      }

      /* ── Thumbnail: CSS-first hover/preview blocking ── */
      /* All ytd-thumbnail elements are shielded by default via a
         CSS ::after pseudo-element.  Only thumbnails that earn the
         .ytkg-approved class have the shield removed.  This survives
         YouTube's SPA DOM rebuilds because the rule is global CSS,
         not an injected DOM node. */

      ytd-thumbnail,
      yt-thumbnail-view-model {
        position: relative !important;
      }

      /* Transparent shield — blocks hover & click on unapproved thumbs */
      ytd-thumbnail:not(.ytkg-approved)::after,
      yt-thumbnail-view-model:not(.ytkg-approved)::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 999;
        pointer-events: auto;
        background: transparent;
        cursor: default;
      }

      /* Kill any inline preview <video> YouTube injects on hover.
         ytd-video-preview is a SINGLETON under ytd-app (not inside any
         card) that YouTube repositions over whichever thumbnail is
         hovered.  We hide it by default and let JS add .ytkg-preview-ok
         when the hovered video is approved. */
      ytd-thumbnail:not(.ytkg-approved) video,
      yt-thumbnail-view-model:not(.ytkg-approved) video {
        display: none !important;
      }

      /* Global preview player — hidden by default, shown only for
         approved videos via the .ytkg-preview-ok class added by JS. */
      ytd-video-preview:not(.ytkg-preview-ok) {
        display: none !important;
      }

      .ytkg-thumb-badge {
        position: absolute;
        top: 6px;
        left: 6px;
        z-index: 1000;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: bold;
        color: #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        pointer-events: none;
        transition: opacity 0.3s ease;
      }

      .ytkg-thumb-badge--pending {
        background: rgba(80, 80, 80, 0.85);
      }

      .ytkg-thumb-badge--pending::after {
        content: '';
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: ytkg-spin 0.8s linear infinite;
      }

      .ytkg-thumb-badge--allowed {
        background: rgba(30, 140, 50, 0.9);
      }

      .ytkg-thumb-badge--blocked {
        background: rgba(180, 30, 30, 0.9);
      }

      .ytkg-thumb-blocked-overlay {
        position: absolute;
        inset: 0;
        z-index: 998;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        border-radius: inherit;
      }

      .ytkg-thumb-blocked-overlay span {
        color: #ff6b6b;
        font-size: 11px;
        font-weight: 500;
        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
        text-align: center;
        padding: 4px 8px;
      }

      /* ── Full-page channel block overlay ── */
      .ytkg-channel-block {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(180, 30, 30, 0.97);
        color: #fff;
        font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
        text-align: center;
        padding: 2rem;
      }
      .ytkg-channel-block__title {
        font-size: 1.5rem;
        font-weight: 600;
        margin-bottom: 0.75rem;
      }
      .ytkg-channel-block__reason {
        font-size: 1rem;
        opacity: 0.9;
        margin-bottom: 1.5rem;
        max-width: 400px;
      }
    `;
    document.head.appendChild(style);
  }

  injectStyles();

  // ─── Channel page blocking ─────────────────────────────────────────
  // Detect channel URLs (/@handle, /c/Name, /channel/ID) and check
  // the blacklist/whitelist.  Blocked channels get a full-page overlay.

  const CHANNEL_BLOCK_ID = "ytkg-channel-block";

  /**
   * Extract the channel handle from a YouTube channel page URL.
   * Matches /@handle, /c/Name, /channel/UCxxxx patterns.
   * Returns null if not on a channel page.
   */
  function getChannelFromURL() {
    const path = window.location.pathname;
    // /@handle or /@handle/videos etc.
    const handleMatch = path.match(/^\/@([^/]+)/);
    if (handleMatch) return handleMatch[1];
    // /c/ChannelName
    const cMatch = path.match(/^\/c\/([^/]+)/);
    if (cMatch) return cMatch[1];
    // /channel/UCxxxx — less useful but still a channel page
    const idMatch = path.match(/^\/channel\/([^/]+)/);
    if (idMatch) return idMatch[1];
    return null;
  }

  function showChannelBlockOverlay(channelName, reason) {
    removeChannelBlockOverlay();
    const overlay = document.createElement("div");
    overlay.id = CHANNEL_BLOCK_ID;
    overlay.className = "ytkg-channel-block";
    overlay.innerHTML = `
      <p class="ytkg-channel-block__title">Channel Blocked</p>
      <p class="ytkg-channel-block__reason">${escapeHtml(reason || "This channel is not allowed.")}</p>
      <p class="ytkg-channel-block__reason">@${escapeHtml(channelName)}</p>
      <button class="ytkg-overlay__back-btn" id="ytkg-channel-back-btn">Go Back</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById("ytkg-channel-back-btn").addEventListener("click", () => {
      history.back();
    });
    // Also pause any playing video.
    const video = document.querySelector("video");
    if (video) video.pause();
  }

  function removeChannelBlockOverlay() {
    document.getElementById(CHANNEL_BLOCK_ID)?.remove();
  }

  function checkChannelPage() {
    const channelHandle = getChannelFromURL();
    if (!channelHandle) {
      removeChannelBlockOverlay();
      return;
    }

    chrome.runtime.sendMessage(
      { type: "CHECK_CHANNEL", channel: channelHandle },
      (response) => {
        if (chrome.runtime.lastError) {
          error("CHECK_CHANNEL error:", chrome.runtime.lastError.message);
          return;
        }
        if (response?.blocked) {
          log("Channel page BLOCKED:", channelHandle, response.reason);
          showChannelBlockOverlay(channelHandle, response.reason);
        } else {
          removeChannelBlockOverlay();
        }
      }
    );
  }

  // Check on initial load.
  checkChannelPage();

  // ─── State ───────────────────────────────────────────────────────────

  // Track the last video ID we analysed so we don't re-check the same video.
  let lastCheckedVideoId = null;

  // Keep a reference to the attribute observer attached to the current <video>
  // so we can disconnect it before attaching a new one.
  let videoAttrObserver = null;

  // ─── Metadata helpers ────────────────────────────────────────────────

  /**
   * Extract the video ID from the current page URL (?v= parameter).
   * Returns null when not on a watch page.
   */
  function getVideoId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("v");
  }

  /**
   * Gather visible metadata from the DOM for the current video.
   * YouTube updates these elements asynchronously, so some fields may be
   * empty if called too early — the background script can still use the URL.
   */
  function getVideoMetadata() {
    const title =
      document.querySelector(
        "yt-formatted-string.style-scope.ytd-watch-metadata"
      )?.textContent?.trim() ||
      document.querySelector("h1.ytd-watch-metadata")?.textContent?.trim() ||
      document.title;

    const channel =
      document.querySelector(
        "ytd-channel-name yt-formatted-string a"
      )?.textContent?.trim() || "";

    const description =
      document.querySelector(
        "ytd-text-inline-expander .ytd-text-inline-expander"
      )?.textContent?.trim() || "";

    return { title, channel, description };
  }

  // ─── Overlay management ──────────────────────────────────────────────

  const OVERLAY_ID = "ytkg-overlay";

  /**
   * Find the nearest positioned container around the <video> element.
   * YouTube's player container (#movie_player) is position: relative, so our
   * absolutely-positioned overlay will sit right on top of it.
   */
  function getPlayerContainer(videoEl) {
    // Prefer the well-known #movie_player wrapper.
    const moviePlayer = videoEl.closest("#movie_player");
    if (moviePlayer) return moviePlayer;
    // Fall back to the direct parent.
    return videoEl.parentElement;
  }

  /**
   * Show the "Analyzing..." overlay on top of the video player.
   * If an overlay already exists it is replaced so we always start fresh.
   */
  function showAnalyzingOverlay(videoEl) {
    removeOverlay();

    const container = getPlayerContainer(videoEl);
    if (!container) return;

    // Ensure the container is a positioning context for our absolute overlay.
    const pos = getComputedStyle(container).position;
    if (pos === "static") {
      container.style.position = "relative";
    }

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "ytkg-overlay ytkg-overlay--analyzing";
    overlay.innerHTML = `
      <div class="ytkg-spinner"></div>
      <p class="ytkg-overlay__title">Analyzing video for kid-friendly content&hellip;</p>
    `;

    container.appendChild(overlay);
  }

  /**
   * Transition the existing overlay to the "blocked" state.
   * Swaps the class, removes the spinner, and shows the reason + back button.
   */
  function showBlockedOverlay(reason) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;

    // Ensure the video stays paused.
    const video = document.querySelector("video");
    if (video) video.pause();

    overlay.className = "ytkg-overlay ytkg-overlay--blocked";
    overlay.innerHTML = `
      <p class="ytkg-overlay__title">Video Blocked</p>
      <p class="ytkg-overlay__reason">${escapeHtml(reason)}</p>
      <button class="ytkg-overlay__back-btn" id="ytkg-back-btn">Go Back</button>
    `;

    document.getElementById("ytkg-back-btn").addEventListener("click", () => {
      history.back();
    });
  }

  /**
   * Remove the overlay entirely (called on ALLOW or when a new check starts).
   */
  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ─── Video handling ──────────────────────────────────────────────────

  // ─── Metadata polling ─────────────────────────────────────────────────

  /**
   * Wait for YouTube to populate the video title in the DOM.
   * Polls every 200 ms up to a maximum number of attempts, then resolves
   * with whatever metadata is available (the URL alone is still useful).
   */
  function waitForMetadata(maxAttempts = 10, interval = 200) {
    return new Promise((resolve) => {
      let attempts = 0;
      function poll() {
        attempts++;
        const metadata = getVideoMetadata();
        // Consider metadata "ready" once we have a non-empty title that
        // isn't just the generic document.title fallback.
        const titleEl = document.querySelector(
          "yt-formatted-string.style-scope.ytd-watch-metadata"
        ) || document.querySelector("h1.ytd-watch-metadata");
        if (titleEl?.textContent?.trim() || attempts >= maxAttempts) {
          resolve(metadata);
        } else {
          setTimeout(poll, interval);
        }
      }
      poll();
    });
  }

  // ─── Video handling ──────────────────────────────────────────────────

  /**
   * Returns true if the current page is a YouTube Shorts URL.
   * Shorts URLs contain "/shorts/" in the path.
   */
  function isYouTubeShorts() {
    return window.location.pathname.includes("/shorts/");
  }

  /**
   * Immediately pause the <video>, show the analyzing overlay, collect
   * metadata, and ask the background script to evaluate the video via Gemini.
   */
  function handleVideoChange(videoEl) {
    const videoId = getVideoId();

    // ── Block YouTube Shorts entirely ──────────────────────────────────
    // Shorts auto-scroll between videos without changing the URL path,
    // so we block every time the video src changes on a /shorts/ page.
    // No dedup — always re-block to catch scrolling between Shorts.
    if (isYouTubeShorts()) {
      log("Shorts detected — blocking:", window.location.href);
      videoEl.pause();
      showAnalyzingOverlay(videoEl);
      showBlockedOverlay("YouTube Shorts are not allowed.");
      return;
    }

    // Avoid re-checking the same video (e.g. duplicate mutation events).
    // Use the ?v= video ID when available; fall back to the element src.
    const checkKey = videoId || videoEl.src || videoEl.currentSrc;
    if (!checkKey || checkKey === lastCheckedVideoId) return;
    lastCheckedVideoId = checkKey;

    log("Checking video:", checkKey);

    // Instantly pause the video so nothing plays until we get a verdict.
    videoEl.pause();

    // Show the analyzing overlay on top of the player.
    showAnalyzingOverlay(videoEl);

    // Poll for metadata instead of using a fixed timeout.
    waitForMetadata().then((metadata) => {
      log("Metadata collected:", { title: metadata.title, description: metadata.description?.substring(0, 100) });
      chrome.runtime.sendMessage(
        {
          type: "CHECK_VIDEO",
          payload: {
            videoId: checkKey,
            url: window.location.href,
            ...metadata,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            error("Messaging error:", chrome.runtime.lastError.message);
            showBlockedOverlay(
              "Safety check unavailable — video blocked as a precaution."
            );
            return;
          }

          if (response?.blocked) {
            log("BLOCKED:", response.reason);
            showBlockedOverlay(response.reason);
          } else {
            log("ALLOWED:", response?.reason);
            removeOverlay();
            videoEl.play();
          }
        }
      );
    });
  }

  // ─── Attribute observer (watches `src` changes on a single <video>) ──

  /**
   * Attach an attribute observer to a <video> element so we are notified
   * whenever its `src` attribute changes (user clicked a different video
   * inside the SPA).
   */
  function observeVideoAttributes(videoEl) {
    // Disconnect any previous attribute observer first.
    if (videoAttrObserver) {
      videoAttrObserver.disconnect();
      videoAttrObserver = null;
    }

    videoAttrObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "src"
        ) {
          // The src attribute changed — a new video is loading.
          handleVideoChange(videoEl);
        }
      }
    });

    videoAttrObserver.observe(videoEl, {
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  // ─── DOM observer (watches for <video> elements being added) ─────────

  /**
   * Called whenever a <video> element is found, either on first load or
   * when YouTube injects one into the DOM.
   */
  function onVideoFound(videoEl) {
    // Start watching its src attribute for future changes.
    observeVideoAttributes(videoEl);
    // Immediately evaluate the current video.
    handleVideoChange(videoEl);
  }

  /**
   * Recursively search a node tree for <video> elements.
   * YouTube may add the <video> nested inside several shadow-host or
   * wrapper elements, so we walk the subtree.
   */
  function findVideosInTree(root) {
    if (root.nodeName === "VIDEO") {
      return [root];
    }
    if (root.querySelectorAll) {
      return Array.from(root.querySelectorAll("video"));
    }
    return [];
  }

  // The main MutationObserver: watches the entire document for added nodes.
  // Inline thumbnail preview videos are now blocked by CSS (display:none
  // on ytd-thumbnail:not(.ytkg-approved) video), so we only need to handle
  // the main player <video> here.
  const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const videos = findVideosInTree(node);
        for (const videoEl of videos) {
          // Skip videos inside thumbnail cards — CSS handles those.
          if (videoEl.closest(THUMB_CARD_SELECTORS)) continue;
          // Skip videos inside the inline preview player — gated separately.
          if (videoEl.closest("ytd-video-preview")) continue;
          onVideoFound(videoEl);
        }
      }
    }
  });

  // Observe the entire document body for child additions at any depth.
  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Track which video IDs have already been sent for evaluation so we
  // don't spam the API on every scroll / mutation event.
  const thumbChecked = new Map(); // videoId → "pending" | "allowed" | "blocked"

  // ─── Inline preview player gating ───────────────────────────────────
  // ytd-video-preview is a singleton element under ytd-app that YouTube
  // positions over whichever thumbnail the user hovers.  CSS hides it by
  // default (display:none on :not(.ytkg-preview-ok)).  Here we watch for
  // attribute changes on it (YouTube sets `active`, `playing`, and updates
  // the internal link href) and toggle .ytkg-preview-ok only when the
  // previewed video has been approved.

  function gatePreviewPlayer() {
    const previewEl = document.querySelector("ytd-video-preview");
    if (!previewEl) return;

    function updatePreviewGate() {
      // Extract video ID from the preview's internal link.
      const link = previewEl.querySelector(
        "a#media-container-link, a.yt-simple-endpoint"
      );
      const href = link?.getAttribute("href") || "";
      let videoId = null;
      const watchMatch = href.match(/\/watch\?v=([^&]+)/);
      if (watchMatch) videoId = watchMatch[1];
      const shortsMatch = href.match(/\/shorts\/([^?&]+)/);
      if (shortsMatch) videoId = shortsMatch[1];

      if (videoId && thumbChecked.get(videoId) === "allowed") {
        previewEl.classList.add("ytkg-preview-ok");
      } else {
        previewEl.classList.remove("ytkg-preview-ok");
      }
    }

    // Observe attribute changes (active/hidden/style) and child additions
    // (YouTube lazily builds the preview DOM).
    const previewObserver = new MutationObserver(() => {
      updatePreviewGate();
    });
    previewObserver.observe(previewEl, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    // Also run on initial load in case it already exists.
    updatePreviewGate();
  }

  // ytd-video-preview may not exist yet; watch for it.
  const previewWatcher = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (
          node.tagName === "YTD-VIDEO-PREVIEW" ||
          node.querySelector?.("ytd-video-preview")
        ) {
          gatePreviewPlayer();
          previewWatcher.disconnect();
          return;
        }
      }
    }
  });
  previewWatcher.observe(document.body, { childList: true, subtree: true });
  // Also try immediately in case it already exists.
  gatePreviewPlayer();

  // ─── Handle a <video> that already exists on initial page load ───────

  const existingVideo = document.querySelector("video");
  if (existingVideo) {
    onVideoFound(existingVideo);
  }

  // ─── YouTube SPA navigation ──────────────────────────────────────────
  // YouTube fires `yt-navigate-finish` when the user clicks a video link
  // inside the SPA.  The <video> element is often reused without a src
  // attribute change, so we must re-check whenever navigation occurs.

  window.addEventListener("yt-navigate-finish", () => {
    // Check if we navigated to a blacklisted channel page.
    checkChannelPage();

    // Reset the dedup key so the same <video> element is re-evaluated
    // for the new page.
    lastCheckedVideoId = null;

    const video = document.querySelector("video");
    if (video) {
      onVideoFound(video);
    }

    // YouTube rebuilds cards on SPA navigation, wiping our DOM elements.
    // Clear the per-card markers so processThumbCard re-applies states
    // from the thumbChecked cache (no new API calls needed for known IDs).
    document.querySelectorAll("[data-ytkg-checked]").forEach((el) => {
      delete el.dataset.ytkgChecked;
    });

    // Re-scan thumbnails. YouTube renders cards asynchronously after
    // yt-navigate-finish, so scan multiple times to catch late arrivals.
    scanThumbnails();
    setTimeout(scanThumbnails, 500);
    setTimeout(scanThumbnails, 1500);
  });

  // ─── Thumbnail scanning ─────────────────────────────────────────────
  // On browse / search / home pages, find video thumbnail cards, extract
  // their title + video ID, send them to the background for evaluation,
  // and overlay a badge.  Hover-to-preview is blocked until the video
  // passes verification.

  // CSS selectors for YouTube's various video card types.
  const THUMB_CARD_SELECTORS = [
    "ytd-rich-item-renderer",              // homepage grid
    "ytd-video-renderer",                  // search results
    "ytd-compact-video-renderer",          // sidebar suggestions
    "ytd-grid-video-renderer",             // channel page grid
    "ytm-shorts-lockup-view-model-v2",     // shorts shelf (new)
    "ytd-reel-item-renderer",              // shorts shelf (legacy)
  ].join(", ");

  /**
   * Extract the video ID from a thumbnail card's link href.
   * Returns null if not found.
   */
  function getVideoIdFromCard(card) {
    // Regular video cards use a#thumbnail; shorts cards use a with /shorts/ href.
    const link =
      card.querySelector("a#thumbnail, a.ytd-thumbnail") ||
      card.querySelector("a.reel-item-endpoint") ||
      card.querySelector("a.shortsLockupViewModelHostEndpoint") ||
      card.querySelector("a[href*='/shorts/']");
    if (!link) return null;
    const href = link.getAttribute("href") || "";
    // Standard watch URL: /watch?v=XXXXXXXXXXX
    const match = href.match(/\/watch\?v=([^&]+)/);
    if (match) return match[1];
    // Shorts URL: /shorts/XXXXXXXXXXX
    const shortsMatch = href.match(/\/shorts\/([^?&]+)/);
    if (shortsMatch) return shortsMatch[1];
    return null;
  }

  /**
   * Extract the video title from a thumbnail card.
   */
  function getTitleFromCard(card) {
    const titleEl =
      card.querySelector("#video-title") ||
      card.querySelector("yt-formatted-string#video-title") ||
      card.querySelector("span#video-title") ||
      card.querySelector("a#video-title-link") ||
      // Shorts cards: title is in h3 > a > span or a[title]
      card.querySelector("h3 a[title]") ||
      card.querySelector(".shortsLockupViewModelHostMetadataTitle a");
    // Shorts cards may have the title in the `title` attribute.
    return titleEl?.getAttribute("title") ||
           titleEl?.textContent?.trim() || "";
  }

  /**
   * Extract the channel name from a thumbnail card.
   */
  function getChannelFromCard(card) {
    const channelEl =
      card.querySelector("ytd-channel-name yt-formatted-string a") ||
      card.querySelector("ytd-channel-name yt-formatted-string") ||
      card.querySelector(".ytd-channel-name a");
    return channelEl?.textContent?.trim() || "";
  }

  /**
   * Detect if this card links to a YouTube Short.
   */
  function isShortCard(card) {
    // Detect by tag name (shorts-specific elements).
    const tag = card.tagName.toLowerCase();
    if (tag === "ytm-shorts-lockup-view-model-v2" ||
        tag === "ytd-reel-item-renderer") {
      return true;
    }
    // Fall back to checking the link href.
    const link =
      card.querySelector("a#thumbnail, a.ytd-thumbnail") ||
      card.querySelector("a[href*='/shorts/']");
    const href = link?.getAttribute("href") || "";
    return href.includes("/shorts/");
  }

  /**
   * Find the ytd-thumbnail element inside a card.
   */
  function getThumbElement(card) {
    return card.querySelector("ytd-thumbnail") ||
           card.querySelector("yt-thumbnail-view-model") ||
           card.querySelector("#thumbnail");
  }

  /**
   * Apply the visual state (badge + optional overlay) to a thumbnail
   * card based on its evaluation status.
   *
   * The hover/preview blocking is handled by CSS: all ytd-thumbnail
   * elements without the .ytkg-approved class have a ::after shield
   * and hidden <video> elements.  This method manages the class and
   * the visual badge/overlay DOM.
   */
  function applyThumbState(card, videoId, state, reason) {
    const thumb = getThumbElement(card);
    if (!thumb) return;

    // Manage the .ytkg-approved class — this is the only thing that
    // controls whether hover preview is allowed (via CSS).
    if (state === "allowed") {
      thumb.classList.add("ytkg-approved");
    } else {
      thumb.classList.remove("ytkg-approved");
    }

    // Remove any existing badge / overlay from previous states.
    thumb.querySelectorAll(
      ".ytkg-thumb-badge, .ytkg-thumb-blocked-overlay"
    ).forEach((el) => el.remove());

    // Badge
    const badge = document.createElement("div");
    badge.className = "ytkg-thumb-badge";

    if (state === "pending") {
      badge.classList.add("ytkg-thumb-badge--pending");
    } else if (state === "allowed") {
      badge.classList.add("ytkg-thumb-badge--allowed");
      badge.textContent = "\u2713"; // ✓
    } else if (state === "blocked") {
      badge.classList.add("ytkg-thumb-badge--blocked");
      badge.textContent = "\u2717"; // ✗
      // Dark overlay on blocked thumbnails.
      const blockedOverlay = document.createElement("div");
      blockedOverlay.className = "ytkg-thumb-blocked-overlay";
      blockedOverlay.innerHTML = `<span>${escapeHtml(reason || "Blocked")}</span>`;
      thumb.appendChild(blockedOverlay);
    }

    thumb.appendChild(badge);
  }

  /**
   * Process a single thumbnail card: extract metadata, send to background
   * for evaluation, and manage the badge / hover-blocking lifecycle.
   */
  function processThumbCard(card) {
    const videoId = getVideoIdFromCard(card);
    if (!videoId) return;

    // Already processed this card instance.
    if (card.dataset.ytkgChecked === videoId) return;
    card.dataset.ytkgChecked = videoId;

    // If we already have a result for this video ID, apply it immediately.
    const cached = thumbChecked.get(videoId);
    if (cached && cached.state !== "pending") {
      applyThumbState(card, videoId, cached.state, cached.reason);
      return;
    }

    // Block Shorts thumbnails immediately.
    if (isShortCard(card)) {
      const reason = "YouTube Shorts are not allowed.";
      thumbChecked.set(videoId, { state: "blocked", reason });
      applyThumbState(card, videoId, "blocked", reason);
      return;
    }

    // Show pending badge + hover shield while we wait.
    if (!cached) {
      thumbChecked.set(videoId, { state: "pending", reason: "" });
    }
    applyThumbState(card, videoId, "pending", "");

    // If another card for the same videoId already triggered the API call,
    // just wait — the result will be applied when it comes back.
    if (cached) return;

    const title = getTitleFromCard(card);
    const channel = getChannelFromCard(card);

    log("Thumb check:", videoId, title ? `"${title}"` : "(no title)");

    chrome.runtime.sendMessage(
      {
        type: "CHECK_VIDEO",
        payload: {
          videoId,
          title,
          channel,
          description: "",
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          error("Thumb check messaging error:", chrome.runtime.lastError.message);
          // Fail closed.
          thumbChecked.set(videoId, {
            state: "blocked",
            reason: "Safety check unavailable.",
          });
          updateAllCardsForVideo(videoId);
          return;
        }

        const state = response?.blocked ? "blocked" : "allowed";
        const reason = response?.reason || "";
        thumbChecked.set(videoId, { state, reason });
        log("Thumb result:", videoId, state, reason);
        updateAllCardsForVideo(videoId);
      }
    );
  }

  /**
   * When a result arrives for a videoId, update every card on the page
   * that shows that video (there can be duplicates in search + sidebar).
   */
  function updateAllCardsForVideo(videoId) {
    const cached = thumbChecked.get(videoId);
    if (!cached) return;

    document.querySelectorAll(THUMB_CARD_SELECTORS).forEach((card) => {
      if (getVideoIdFromCard(card) === videoId) {
        applyThumbState(card, videoId, cached.state, cached.reason);
      }
    });
  }

  /**
   * Scan all visible thumbnail cards on the page.
   * Called on initial load, SPA navigation, and DOM mutations.
   */
  function scanThumbnails() {
    const cards = document.querySelectorAll(THUMB_CARD_SELECTORS);
    for (const card of cards) {
      processThumbCard(card);
    }
  }

  // Scan existing thumbnails on page load.
  scanThumbnails();

  // Extend the existing DOM observer to also pick up new thumbnail cards
  // as the user scrolls (infinite scroll loads new cards).
  const thumbObserver = new MutationObserver((mutations) => {
    let needsScan = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        // Check if the added node itself is a card, or contains cards.
        if (node.matches?.(THUMB_CARD_SELECTORS)) {
          processThumbCard(node);
        } else if (node.querySelectorAll) {
          const cards = node.querySelectorAll(THUMB_CARD_SELECTORS);
          if (cards.length > 0) needsScan = true;
        }
      }
    }
    if (needsScan) scanThumbnails();
  });

  thumbObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
