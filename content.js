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
   * Immediately pause the <video>, show the analyzing overlay, collect
   * metadata, and ask the background script to evaluate the video via Gemini.
   */
  /**
   * Returns true if the current page is a YouTube Shorts URL.
   * Shorts URLs contain "/shorts/" in the path.
   */
  function isYouTubeShorts() {
    return window.location.pathname.startsWith("/shorts/");
  }

  function handleVideoChange(videoEl) {
    const videoId = getVideoId();

    // ── Block YouTube Shorts entirely ──────────────────────────────────
    // Shorts are short-form videos that bypass normal watch metadata and
    // are not suitable for the curated educational experience we want.
    if (isYouTubeShorts()) {
      const shortsKey = "shorts:" + window.location.pathname;
      if (shortsKey === lastCheckedVideoId) return;
      lastCheckedVideoId = shortsKey;

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

    // Instantly pause the video so nothing plays until we get a verdict.
    videoEl.pause();

    // Show the analyzing overlay on top of the player.
    showAnalyzingOverlay(videoEl);

    // Poll for metadata instead of using a fixed timeout.
    waitForMetadata().then((metadata) => {
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
            console.error(
              "[YT Kids Guard] messaging error:",
              chrome.runtime.lastError.message
            );
            // Fail closed — block the video when the safety check
            // cannot complete.
            showBlockedOverlay(
              "Safety check unavailable — video blocked as a precaution."
            );
            return;
          }

          if (response?.blocked) {
            // BLOCK — transition overlay to red with the reason.
            showBlockedOverlay(response.reason);
          } else {
            // ALLOW — remove overlay and resume playback.
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
  const domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check every node that was added to the DOM.
      for (const node of mutation.addedNodes) {
        // Only examine element nodes (nodeType 1).
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const videos = findVideosInTree(node);
        for (const videoEl of videos) {
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
  });
})();
