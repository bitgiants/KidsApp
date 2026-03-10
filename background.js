// background.js — Manifest V3 service worker.
// Listens for CHECK_VIDEO messages from content.js, queries the Google Gemini
// API (gemini-1.5-flash) with a parental-control system prompt, and returns
// the parsed { blocked, reason } decision to the content script.

// ─── Configuration ─────────────────────────────────────────────────────

const GEMINI_MODEL = "gemini-1.5-flash";

const SYSTEM_PROMPT =
  "You are a strict parental control filter. Analyze this YouTube video " +
  "context. Determine if it contains violence, strong language, adult themes, " +
  'or inappropriate humor for an 8-year-old. Reply ONLY in valid JSON format: ' +
  '{"decision": "ALLOW" or "BLOCK", "reason": "One sentence reason."}';

// ─── Per-video cache ───────────────────────────────────────────────────
// Keeps results for the lifetime of the service worker so we never re-check
// the same video twice in one browser session.

const cache = new Map();

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
function buildUserPrompt({ title, channel, description, url }) {
  const parts = [`YouTube Video URL: ${url}`];
  if (title) parts.push(`Title: ${title}`);
  if (channel) parts.push(`Channel: ${channel}`);
  if (description) parts.push(`Description: ${description}`);
  return parts.join("\n");
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
  if (cache.has(videoId)) {
    return cache.get(videoId);
  }

  const apiKey = await getApiKey();
  const userPrompt = buildUserPrompt(payload);
  const { decision, reason } = await queryGemini(apiKey, userPrompt);

  // Map the Gemini decision to the boolean flag content.js expects.
  const result = {
    blocked: decision === "BLOCK",
    reason,
  };

  cache.set(videoId, result);
  return result;
}

// ─── Message listener ──────────────────────────────────────────────────

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
      // Fail open — allow the video if the API call errors out so we
      // don't permanently block the page on transient failures.
      sendResponse({ blocked: false, reason: err.message });
    });

  // Return true so Chrome keeps the message channel open for our async
  // sendResponse call above.
  return true;
});
