// background.js — Manifest V3 service worker.
// Routes CHECK_VIDEO messages from content.js to the user's chosen AI
// provider (Gemini, OpenAI, Anthropic, or OpenRouter) and returns the
// parsed { blocked, reason } decision to the content script.
// Also checks channel whitelist/blacklist and blocked categories
// BEFORE making any AI call.

// ─── Logging ─────────────────────────────────────────────────────────
const LOG_PREFIX = "[YT Kids Guard]";
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }
function error(...args) { console.error(LOG_PREFIX, ...args); }

// ─── Category definitions ────────────────────────────────────────────
// Parents can toggle these on/off in the options page.
// Each category has an ID, label, and keywords the AI should watch for.

const CATEGORIES = [
  { id: "pranks",       label: "Pranks & Challenges",          on: true },
  { id: "reactions",    label: "Reaction & Unboxing Videos",   on: true },
  { id: "gaming",       label: "Gaming (non-educational)",     on: true },
  { id: "vlogs",        label: "Vlogs & Daily Life",           on: true },
  { id: "memes",        label: "Memes & Internet Lore",        on: true },
  { id: "asmr",         label: "ASMR & Mukbang",               on: true },
  { id: "music",        label: "Music Videos & Lyrics",        on: false },
  { id: "news",         label: "News & Politics",              on: true },
  { id: "horror",       label: "Horror & Creepy Content",      on: true },
  { id: "drama",        label: "Drama & Gossip",               on: true },
  { id: "toy_unboxing", label: "Toy Unboxing & Consumerism",   on: true },
  { id: "shorts",       label: "YouTube Shorts",               on: true },
];

// ─── System prompt builder ───────────────────────────────────────────

// The default prompt template.  {{BLOCKED_CATEGORIES}} is replaced at
// runtime with the user's blocked-category bullet list.
const DEFAULT_SYSTEM_PROMPT =
  "You are a thoughtful content curator for children aged 8–14. " +
  "Your goal is to filter out 'brainrot' — mindless, overstimulating, or harmful content — " +
  "while ALLOWING genuinely educational and enriching material, even on technical topics.\n\n" +
  "REJECT (BLOCK) any content in these categories:\n" +
  "{{BLOCKED_CATEGORIES}}\n" +
  "* Any content with violence, strong language, adult themes, or sexual content.\n" +
  "* Hyper-stimulating, loud, or over-exaggerated content designed to addict.\n" +
  "* Nonsensical or repetitive content with no educational value.\n\n" +
  "ACCEPT (ALLOW):\n" +
  "* Science, history, nature, geography, or space documentaries and explainers.\n" +
  "* Technology, programming, computer science, and IT tutorials or explainers.\n" +
  "* Math, engineering, robotics, electronics, and maker content.\n" +
  "* DIY, building, crafting, or art tutorials.\n" +
  "* Calm, narrative-driven storytelling and book discussions.\n" +
  "* Structured, educational explanations of how things work.\n" +
  "* Age-appropriate entertainment that is calm, creative, or enriching.\n" +
  "* Language learning and educational content in any language.\n\n" +
  "IMPORTANT: Technical and computer-related educational content (hardware reviews " +
  "for learning, coding tutorials, tech explainers, science experiments) should be " +
  "ALLOWED even if the topic seems advanced. Children aged 8–14 benefit from exposure " +
  "to STEM subjects. Only block tech content if it is purely consumerist hype with " +
  "no learning value.\n\n" +
  "Analyze the provided video title, description, and channel name. " +
  "Does it meet the ACCEPT criteria?\n" +
  'Reply ONLY in this exact JSON format: {"decision": "ALLOW" or "BLOCK", "reason": "One sentence reason."}';

function buildSystemPrompt(blockedCategories, customPromptTemplate) {
  const categoryList = blockedCategories
    .map((c) => `* ${c.label}`)
    .join("\n");

  const template = customPromptTemplate || DEFAULT_SYSTEM_PROMPT;
  return template.replace("{{BLOCKED_CATEGORIES}}", categoryList);
}

// ─── Provider registry ───────────────────────────────────────────────

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

const CACHE_TTL_MS = 30 * 60 * 1000;
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
    "blockedCategories",
    "whitelist",
    "blacklist",
    "customPrompt",
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

  // Blocked categories: merge defaults with user overrides.
  let blockedCategories;
  if (data.blockedCategories) {
    blockedCategories = CATEGORIES.filter(
      (c) => data.blockedCategories.includes(c.id)
    );
  } else {
    blockedCategories = CATEGORIES.filter((c) => c.on);
  }

  const whitelist = data.whitelist || [];
  const blacklist = data.blacklist || [];
  const customPrompt = data.customPrompt || "";

  return { provider, providerDef, apiKey, model, blockedCategories, whitelist, blacklist, customPrompt };
}

// ─── List matching helpers ───────────────────────────────────────────

function normalizeChannel(name) {
  return (name || "").toLowerCase().replace(/^@/, "").trim();
}

function isChannelInList(channel, list) {
  const norm = normalizeChannel(channel);
  if (!norm) return false;
  return list.some((entry) => {
    const entryNorm = normalizeChannel(entry.channel || entry);
    return entryNorm === norm;
  });
}

function isVideoInList(videoId, list) {
  if (!videoId) return false;
  return list.some((entry) => entry.videoId === videoId);
}

// ─── Prompt construction ─────────────────────────────────────────────

function buildUserPrompt({ title, description, channel }) {
  const parts = [];
  if (title) parts.push(`Title: ${title}`);
  if (channel) parts.push(`Channel: ${channel}`);
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

async function queryGemini(apiKey, model, userPrompt, systemPrompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model}:generateContent?key=${apiKey}`;

  log(`[Gemini/${model}] Sending prompt`);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
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

function queryOpenAICompatible(endpoint) {
  return async function (apiKey, model, userPrompt, systemPrompt) {
    log(`[${endpoint}/${model}] Sending prompt`);

    const body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
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

async function queryAnthropic(apiKey, model, userPrompt, systemPrompt) {
  log(`[Anthropic/${model}] Sending prompt`);

  const body = {
    model,
    max_tokens: 256,
    system: systemPrompt,
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
  const { videoId, channel, channelHandle } = payload;

  const cached = cacheGet(videoId);
  if (cached) {
    log("Cache hit for", videoId, "->", cached.blocked ? "BLOCK" : "ALLOW");
    return cached;
  }

  const settings = await getSettings();

  // 1. Whitelist check — skip AI entirely.
  //    Match on display name, @handle, or video ID.
  if (isChannelInList(channel, settings.whitelist) ||
      isChannelInList(channelHandle, settings.whitelist) ||
      isVideoInList(videoId, settings.whitelist)) {
    log("WHITELIST match for", channelHandle || channel || videoId);
    const result = { blocked: false, reason: "Whitelisted channel." };
    cacheSet(videoId, result);
    return result;
  }

  // 2. Blacklist check — skip AI entirely.
  if (isChannelInList(channel, settings.blacklist) ||
      isChannelInList(channelHandle, settings.blacklist) ||
      isVideoInList(videoId, settings.blacklist)) {
    log("BLACKLIST match for", channelHandle || channel || videoId);
    const result = { blocked: true, reason: "Blacklisted channel." };
    cacheSet(videoId, result);
    return result;
  }

  // 3. AI evaluation with dynamic system prompt.
  const systemPrompt = buildSystemPrompt(settings.blockedCategories, settings.customPrompt);
  const userPrompt = buildUserPrompt(payload);
  const { decision, reason } = await settings.providerDef.query(
    settings.apiKey, settings.model, userPrompt, systemPrompt
  );

  const result = {
    blocked: decision === "BLOCK",
    reason,
  };

  cacheSet(videoId, result);
  return result;
}

// ─── PIN verification for settings access ────────────────────────────

// SHA-256 hash so the raw PIN is never stored in chrome.storage.
async function hashPin(pin) {
  const data = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Rate-limiting: lock out after too many failed attempts.
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 60 * 1000; // 1 minute
const pinAttempts = { count: 0, lockedUntil: 0 };

async function verifyPin(pin) {
  const { parentPin } = await chrome.storage.local.get("parentPin");
  if (!parentPin) return { ok: true };

  // Check lockout.
  if (Date.now() < pinAttempts.lockedUntil) {
    const retryMs = pinAttempts.lockedUntil - Date.now();
    return { ok: false, locked: true, retryAfterMs: retryMs };
  }

  const hashed = await hashPin(pin);

  // Migration: legacy unhashed 4-digit PINs get auto-upgraded on match.
  const isLegacy = parentPin.length === 4 && /^\d{4}$/.test(parentPin);
  const match = isLegacy ? parentPin === pin : parentPin === hashed;

  if (match) {
    pinAttempts.count = 0;
    // Upgrade legacy plaintext PIN to hash.
    if (isLegacy) {
      await chrome.storage.local.set({ parentPin: hashed });
      log("Migrated plaintext PIN to SHA-256 hash.");
    }
    return { ok: true };
  }

  // Failed attempt.
  pinAttempts.count++;
  if (pinAttempts.count >= MAX_PIN_ATTEMPTS) {
    pinAttempts.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    pinAttempts.count = 0;
    warn(`PIN locked for ${PIN_LOCKOUT_MS / 1000}s after ${MAX_PIN_ATTEMPTS} failed attempts.`);
    return { ok: false, locked: true, retryAfterMs: PIN_LOCKOUT_MS };
  }
  return { ok: false, locked: false, attemptsLeft: MAX_PIN_ATTEMPTS - pinAttempts.count };
}

async function setPin(pin) {
  if (!/^\d{4}$/.test(pin)) {
    return { ok: false, error: "PIN must be exactly 4 digits." };
  }
  const hashed = await hashPin(pin);
  await chrome.storage.local.set({ parentPin: hashed });
  return { ok: true };
}

async function clearPin() {
  await chrome.storage.local.remove("parentPin");
  return { ok: true };
}

// ─── Dynamic model fetching ─────────────────────────────────────────

async function fetchModels(provider, apiKey) {
  try {
    switch (provider) {
      case "gemini":
        return await fetchGeminiModels(apiKey);
      case "openai":
        return await fetchOpenAICompatibleModels(
          "https://api.openai.com/v1/models", apiKey, filterOpenAIModels
        );
      case "anthropic":
        return getAnthropicModels();
      case "openrouter":
        return await fetchOpenAICompatibleModels(
          "https://openrouter.ai/api/v1/models", apiKey, filterOpenRouterModels
        );
      default:
        return [];
    }
  } catch (err) {
    error("fetchModels failed:", err.message);
    return [];
  }
}

async function fetchGeminiModels(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gemini models API ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName || m.name,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOpenAICompatibleModels(endpoint, apiKey, filterFn) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(endpoint, { headers });
  if (!res.ok) throw new Error(`Models API ${res.status}`);
  const data = await res.json();
  return filterFn(data.data || []);
}

function filterOpenAIModels(models) {
  return models
    .filter((m) => /^(gpt-|o[134]-|chatgpt-)/.test(m.id))
    .map((m) => ({ id: m.id, name: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function filterOpenRouterModels(models) {
  // OpenRouter returns thousands; keep models likely useful for content moderation.
  return models
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getAnthropicModels() {
  // Anthropic has no public model-listing API; return known models.
  return [
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (fastest, cheapest)" },
    { id: "claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (most capable)" },
  ];
}

// ─── Message listener ────────────────────────────────────────────────

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "CHECK_VIDEO") {
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
    }

    if (message.type === "CHECK_CHANNEL") {
      const { channel } = message;
      log("CHECK_CHANNEL received for:", channel);
      getSettings()
        .then((settings) => {
          if (isChannelInList(channel, settings.whitelist)) {
            sendResponse({ blocked: false, reason: "Whitelisted channel." });
          } else if (isChannelInList(channel, settings.blacklist)) {
            sendResponse({ blocked: true, reason: "Blacklisted channel." });
          } else {
            sendResponse({ blocked: false, reason: "Channel not in any list." });
          }
        })
        .catch((err) => {
          error("CHECK_CHANNEL failed:", err.message);
          sendResponse({ blocked: false, reason: "" });
        });
      return true;
    }

    if (message.type === "VERIFY_PIN") {
      verifyPin(message.pin).then((result) => sendResponse(result));
      return true;
    }

    if (message.type === "SET_PIN") {
      setPin(message.pin).then((result) => sendResponse(result));
      return true;
    }

    if (message.type === "CLEAR_PIN") {
      clearPin().then((result) => sendResponse(result));
      return true;
    }

    if (message.type === "FETCH_MODELS") {
      const { provider, apiKey } = message;
      fetchModels(provider, apiKey)
        .then((models) => sendResponse({ models }))
        .catch((err) => {
          error("FETCH_MODELS failed:", err.message);
          sendResponse({ models: [], error: err.message });
        });
      return true;
    }

    if (message.type === "GET_CATEGORIES") {
      sendResponse({ categories: CATEGORIES });
      return false;
    }

    if (message.type === "GET_DEFAULT_PROMPT") {
      sendResponse({ prompt: DEFAULT_SYSTEM_PROMPT });
      return false;
    }

    return false;
  });
}

// ─── Exports for testing ─────────────────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PROVIDERS,
    CATEGORIES,
    DEFAULT_SYSTEM_PROMPT,
    buildUserPrompt,
    buildSystemPrompt,
    parseAIResponse,
    normalizeChannel,
    isChannelInList,
    isVideoInList,
    cacheGet,
    cacheSet,
    cache,
    CACHE_TTL_MS,
    CACHE_MAX_SIZE,
    filterOpenAIModels,
    filterOpenRouterModels,
    getAnthropicModels,
  };
}
