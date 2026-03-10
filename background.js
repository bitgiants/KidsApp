// background.js — Manifest V3 service worker.
// Listens for CHECK_VIDEO messages from content.js, queries the Google Gemini
// API (gemini-1.5-flash) with a parental-control system prompt, and returns
// the parsed { blocked, reason } decision to the content script.

// ─── Configuration ─────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-1.5-flash";

const SYSTEM_PROMPT =
  "You are a strict parental control filter for children aged 8 and under. " +
  "You will receive a YouTube video's title and description. " +
  "ONLY allow content that is clearly educational — for example: science, " +
  "math, reading, history, nature, geography, coding, art tutorials, or " +
  "similar learning-focused material. " +
  "BLOCK everything else, including entertainment, gaming, music videos, " +
  "vlogs, pranks, challenges, toy unboxings, and any content with violence, " +
  "strong language, or adult themes. " +
  "When in doubt, BLOCK. " +
  'Reply ONLY in valid JSON: {"decision": "ALLOW" or "BLOCK", "reason": "One sentence reason."}';

// ─── Per-video cache ───────────────────────────────────────────────────
// Keeps results with a TTL so stale decisions are eventually re-evaluated,
// and a max-size cap to prevent unbounded memory growth.

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 200;

const cache = new Map();

/**
 * Retrieve a cached result if it exists and has not expired.
 */
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Store a result in the cache.  If the cache exceeds its size limit the
 * oldest entry is evicted (FIFO via Map insertion order).
 */
function cacheSet(key, value) {
  // Evict oldest entries when at capacity.
  while (cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { value, timestamp: Date.now() });
}

// ─── API key ───────────────────────────────────────────────────────────

/**
 * Retrieve the Gemini API key stored in chrome.storage.local.
 *
 * Set it once from the extension's service-worker DevTools console:
 *   chrome.storage.local.set({ geminiApiKey: "YOUR_KEY" });
 */
async function getApiKey() {
  const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
  if (!geminiApiKey) {
    throw new Error(
      "Gemini API key not configured. " +
      'Run: chrome.storage.local.set({ geminiApiKey: "YOUR_KEY" })'
    );
  }
  return geminiApiKey;
}

// ─── Prompt construction ───────────────────────────────────────────────

/**
 * Build the user-content part of the prompt from the video metadata
 * supplied by the content script.
 */
function buildUserPrompt({ title, description }) {
  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (description) parts.push(`Description: ${description}`);
  return parts.join("\n") || "No metadata available.";
}

// ─── Gemini API call ───────────────────────────────────────────────────

/**
 * Send the system prompt + user content to the Gemini REST API and return
 * the model's text response parsed as JSON.
 *
 * Uses the systemInstruction field so the model treats SYSTEM_PROMPT as a
 * system-level instruction, separate from the user turn.
 */
async function queryGemini(apiKey, userPrompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body = {
    // System-level instruction — the parental-control persona.
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    // User turn — the video metadata to evaluate.
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  return parseGeminiResponse(rawText);
}

// ─── Response parsing ──────────────────────────────────────────────────

/**
 * Parse the raw text returned by Gemini into a { decision, reason } object.
 *
 * The model is instructed to reply with bare JSON, but it occasionally wraps
 * the payload in markdown fences — we strip those before parsing.
 */
function parseGeminiResponse(rawText) {
  // Strip optional markdown code fences: ```json ... ``` or ``` ... ```
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON — raw response: "${rawText}"`
    );
  }

  // Normalise the decision field to upper-case for reliable comparison.
  const decision = String(parsed.decision ?? "").toUpperCase();
  const reason = String(parsed.reason ?? "No reason provided.");

  if (decision !== "ALLOW" && decision !== "BLOCK") {
    throw new Error(
      `Unexpected decision value "${parsed.decision}" — raw: "${rawText}"`
    );
  }

  return { decision, reason };
}

// ─── Main evaluation logic ─────────────────────────────────────────────

/**
 * Evaluate a video and return { blocked: bool, reason: string } to the
 * content script.  Results are cached by videoId.
 */
async function evaluateVideo(payload) {
  const { videoId } = payload;

  // Return the cached result if we already checked this video.
  const cached = cacheGet(videoId);
  if (cached) return cached;

  const apiKey = await getApiKey();
  const userPrompt = buildUserPrompt(payload);
  const { decision, reason } = await queryGemini(apiKey, userPrompt);

  // Map the Gemini decision to the boolean flag content.js expects.
  const result = {
    blocked: decision === "BLOCK",
    reason,
  };

  cacheSet(videoId, result);
  return result;
}

// ─── Message listener ──────────────────────────────────────────────────
// Only register when running inside a Chrome extension context.

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Only handle CHECK_VIDEO messages from the content script.
    if (message.type !== "CHECK_VIDEO") return false;

    evaluateVideo(message.payload)
      .then((result) => {
        console.log("[YT Kids Guard]", result.blocked ? "BLOCK" : "ALLOW",
          "—", result.reason);
        sendResponse(result);
      })
      .catch((err) => {
        console.error("[YT Kids Guard] evaluation failed:", err);
        // Fail closed — block the video when the safety check cannot
        // complete.  For a kids' app it is safer to over-block than to
        // accidentally allow inappropriate content.
        sendResponse({
          blocked: true,
          reason: "Safety check unavailable — video blocked as a precaution.",
        });
      });

    // Return true so Chrome keeps the message channel open for our async
    // sendResponse call above.
    return true;
  });
}

// ─── Exports for testing ──────────────────────────────────────────────
// In the extension context `module` is undefined; in Node/Jest it exists.

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildUserPrompt,
    parseGeminiResponse,
    cacheGet,
    cacheSet,
    cache,
    CACHE_TTL_MS,
    CACHE_MAX_SIZE,
  };
}
