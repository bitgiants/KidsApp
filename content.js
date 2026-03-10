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

      /* ── Thumbnail badge & hover-block overlay ── */
      .ytkg-thumb-wrap {
        position: relative;
      }

      .ytkg-thumb-shield {
        position: absolute;
        inset: 0;
        z-index: 999;
        pointer-events: auto;
        background: transparent;
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
    `;
    document.head.appendChild(style);
  }

  injectStyles();

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

  /**
   * Check if a <video> element lives inside a thumbnail card (inline
   * hover preview) rather than in the main player.
   */
  function isInlineThumbnailVideo(videoEl) {
    return !!videoEl.closest(THUMB_CARD_SELECTORS);
  }

  /**
   * Handle an inline preview <video> that YouTube injects into a
   * thumbnail on hover.  If the video hasn't been approved, immediately
   * pause and hide it so the user never sees unapproved content.
   */
  function handleInlinePreviewVideo(videoEl) {
    const card = videoEl.closest(THUMB_CARD_SELECTORS);
    if (!card) return;
    const videoId = getVideoIdFromCard(card);
    if (!videoId) return;

    const cached = thumbChecked.get(videoId);
    if (cached && cached.state === "allowed") {
      // This video passed — let the preview play.
      return;
    }

    // Not yet approved (pending or blocked or unknown) — kill the preview.
    videoEl.pause();
    videoEl.removeAttribute("src");
    videoEl.load(); // reset to stop buffering
    videoEl.style.display = "none";
    log("Inline preview killed for", videoId, "— state:", cached?.state || "unknown");
  }

  // The main MutationObserver: watches the entire document for added nodes.
  const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check every node that was added to the DOM.
      for (const node of mutation.addedNodes) {
        // Only examine element nodes (nodeType 1).
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const videos = findVideosInTree(node);
        for (const videoEl of videos) {
          // Distinguish inline thumbnail previews from the main player.
          if (isInlineThumbnailVideo(videoEl)) {
            handleInlinePreviewVideo(videoEl);
          } else {
            onVideoFound(videoEl);
          }
        }
      }
    }
  });

  // Observe the entire document body for child additions at any depth.
  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

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

  // Track which video IDs have already been sent for evaluation so we
  // don't spam the API on every scroll / mutation event.
  const thumbChecked = new Map(); // videoId → "pending" | "allowed" | "blocked"

  // CSS selectors for YouTube's various video card types.
  const THUMB_CARD_SELECTORS = [
    "ytd-rich-item-renderer",       // homepage grid
    "ytd-video-renderer",           // search results
    "ytd-compact-video-renderer",   // sidebar suggestions
    "ytd-grid-video-renderer",      // channel page grid
  ].join(", ");

  /**
   * Extract the video ID from a thumbnail card's link href.
   * Returns null if not found.
   */
  function getVideoIdFromCard(card) {
    const link = card.querySelector("a#thumbnail, a.ytd-thumbnail");
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
      card.querySelector("a#video-title-link");
    return titleEl?.textContent?.trim() || "";
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
    const link = card.querySelector("a#thumbnail, a.ytd-thumbnail");
    const href = link?.getAttribute("href") || "";
    return href.includes("/shorts/");
  }

  /**
   * Get or create the wrapper element around a card's thumbnail that
   * we use as a positioning context for badges and the hover shield.
   */
  function ensureThumbWrap(card) {
    const existing = card.querySelector(".ytkg-thumb-wrap");
    if (existing) return existing;

    // Find the actual thumbnail container.
    const thumbContainer =
      card.querySelector("ytd-thumbnail") ||
      card.querySelector("#thumbnail");
    if (!thumbContainer) return null;

    // Ensure it is a positioning context.
    const pos = getComputedStyle(thumbContainer).position;
    if (pos === "static") {
      thumbContainer.style.position = "relative";
    }
    thumbContainer.classList.add("ytkg-thumb-wrap");
    return thumbContainer;
  }

  /**
   * Apply the visual state (badge + optional shield/overlay) to a
   * thumbnail card based on its evaluation status.
   */
  function applyThumbState(card, videoId, state, reason) {
    const wrap = ensureThumbWrap(card);
    if (!wrap) return;

    // Remove any existing badge / shield / overlay from previous states.
    wrap.querySelectorAll(
      ".ytkg-thumb-badge, .ytkg-thumb-shield, .ytkg-thumb-blocked-overlay"
    ).forEach((el) => el.remove());

    // Badge
    const badge = document.createElement("div");
    badge.className = "ytkg-thumb-badge";

    if (state === "pending") {
      badge.classList.add("ytkg-thumb-badge--pending");
      // Hover shield — blocks the inline preview from starting.
      const shield = document.createElement("div");
      shield.className = "ytkg-thumb-shield";
      shield.title = "Checking if this video is kid-friendly…";
      wrap.appendChild(shield);
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
      wrap.appendChild(blockedOverlay);
      // Shield stays to prevent hover preview and clicks.
      const shield = document.createElement("div");
      shield.className = "ytkg-thumb-shield";
      shield.title = reason || "This video is blocked.";
      shield.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      wrap.appendChild(shield);
    }

    wrap.appendChild(badge);
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
