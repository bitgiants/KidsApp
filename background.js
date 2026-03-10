// background.js — Manifest V3 service worker.
// Routes CHECK_VIDEO messages from content.js to the user's chosen AI
// provider (Gemini, OpenAI, Anthropic, or OpenRouter) and returns the
// parsed { blocked, reason } decision to the content script.

// ─── Logging ─────────────────────────────────────────────────────────
const LOG_PREFIX = "[YT Kids Guard]";
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }
function error(...args) { console.error(LOG_PREFIX, ...args); }

// ─── System prompt (shared across all providers) ─────────────────────

const SYSTEM_PROMPT =
  "You are a strict, high-standard content curator for an 8-year-old's media diet. " +
  "Your goal is to filter out 'brainrot' and only allow enriching content.\n\n" +
  "REJECT (BLOCK):\n" +
  "* Pranks, challenges, or 'vlog' style content.\n" +
  "* Hyper-stimulating, loud, or over-exaggerated reaction videos.\n" +
  "* Nonsensical internet lore (e.g., Skibidi Toilet) or repetitive meme content.\n" +
  "* Mindless gaming streams with no educational or narrative value.\n\n" +
  "ACCEPT (ALLOW):\n" +
  "* Science, history, or nature documentaries.\n" +
  "* DIY, building, crafting, or art tutorials.\n" +
  "* Calm, narrative-driven storytelling.\n" +
  "* Structured, educational explanations of how things work.\n\n" +
  "Analyze the provided video title, description, and transcript. " +
  "Does it meet the ACCEPT criteria?\n" +
  'Reply ONLY in this exact JSON format: {"decision": "ALLOW" or "BLOCK", "reason": "One sentence reason."}';

// ─── Provider registry ───────────────────────────────────────────────
// Each provider defines a default model and a query function that takes
// (apiKey, model, userPrompt) and returns { decision, reason }.

const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    storageKey: "geminiApiKey",
    query: queryGemini,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    storageKey: "openaiApiKey",
    query: queryOpenAICompatible("https://api.openai.com/v1/chat/completions"),
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-haiku-4-5-20251001",
    storageKey: "anthropicApiKey",
    query: queryAnthropic,
  },
  openrouter: {
    label: "OpenRouter",
    defaultModel: "google/gemini-2.0-flash-001",
    storageKey: "openrouterApiKey",
    query: queryOpenAICompatible("https://openrouter.ai/api/v1/chat/completions"),
  },
};

// ─── Per-video cache ─────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 200;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value) {
  while (cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { value, timestamp: Date.now() });
}

// ─── Settings helpers ────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get([
    "aiProvider",
    "aiModel",
    "geminiApiKey",
    "openaiApiKey",
    "anthropicApiKey",
    "openrouterApiKey",
  ]);
  const provider = data.aiProvider || "gemini";
  const providerDef = PROVIDERS[provider];
  if (!providerDef) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = data[providerDef.storageKey];
  if (!apiKey) {
    throw new Error(
      `No API key configured for ${providerDef.label}. ` +
      "Open the extension options to set one."
    );
  }

  const model = data.aiModel || providerDef.defaultModel;
  return { provider, providerDef, apiKey, model };
}

// ─── Prompt construction ─────────────────────────────────────────────

function buildUserPrompt({ title, description }) {
  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (description) parts.push(`Description: ${description}`);
  return parts.join("\n") || "No metadata available.";
}

// ─── Response parsing (shared) ───────────────────────────────────────

function parseAIResponse(rawText) {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse AI JSON — raw response: "${rawText}"`
    );
  }

  const decision = String(parsed.decision ?? "").toUpperCase();
  const reason = String(parsed.reason ?? "No reason provided.");

  if (decision !== "ALLOW" && decision !== "BLOCK") {
    throw new Error(
      `Unexpected decision value "${parsed.decision}" — raw: "${rawText}"`
    );
  }

  return { decision, reason };
}

// ─── Provider: Google Gemini ─────────────────────────────────────────

async function queryGemini(apiKey, model, userPrompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${apiKey}`;

  log(`[Gemini/${model}] Sending prompt`);

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
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
  if (!rawText) throw new Error("Gemini returned an empty response.");

  log(`[Gemini/${model}] Response:`, rawText);
  return parseAIResponse(rawText);
}

// ─── Provider: OpenAI-compatible (OpenAI + OpenRouter) ───────────────
// Returns a query function bound to a specific endpoint URL.

function queryOpenAICompatible(endpoint) {
  return async function (apiKey, model, userPrompt) {
    log(`[${endpoint}/${model}] Sending prompt`);

    const body = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const rawText = data?.choices?.[0]?.message?.content;
    if (!rawText) throw new Error("API returned an empty response.");

    log(`[${model}] Response:`, rawText);
    return parseAIResponse(rawText);
  };
}

// ─── Provider: Anthropic ─────────────────────────────────────────────

async function queryAnthropic(apiKey, model, userPrompt) {
  log(`[Anthropic/${model}] Sending prompt`);

  const body = {
    model,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    temperature: 0.1,
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rawText = data?.content?.[0]?.text;
  if (!rawText) throw new Error("Anthropic returned an empty response.");

  log(`[Anthropic/${model}] Response:`, rawText);
  return parseAIResponse(rawText);
}

// ─── Main evaluation logic ───────────────────────────────────────────

async function evaluateVideo(payload) {
  const { videoId } = payload;

  const cached = cacheGet(videoId);
  if (cached) {
    log("Cache hit for", videoId, "→", cached.blocked ? "BLOCK" : "ALLOW");
    return cached;
  }

  const { providerDef, apiKey, model } = await getSettings();
  const userPrompt = buildUserPrompt(payload);
  const { decision, reason } = await providerDef.query(apiKey, model, userPrompt);

  const result = {
    blocked: decision === "BLOCK",
    reason,
  };

  cacheSet(videoId, result);
  return result;
}

// ─── Message listener ────────────────────────────────────────────────

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "CHECK_VIDEO") return false;

    log("CHECK_VIDEO received for:", message.payload.videoId);
    evaluateVideo(message.payload)
      .then((result) => {
        log(result.blocked ? "BLOCK" : "ALLOW", "—", result.reason);
        sendResponse(result);
      })
      .catch((err) => {
        error("Evaluation failed:", err.message, err.stack);
        sendResponse({
          blocked: true,
          reason: "Safety check unavailable — video blocked as a precaution.",
        });
      });

    return true;
  });
}

// ─── Exports for testing ─────────────────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PROVIDERS,
    buildUserPrompt,
    parseAIResponse,
    cacheGet,
    cacheSet,
    cache,
    CACHE_TTL_MS,
    CACHE_MAX_SIZE,
  };
}
