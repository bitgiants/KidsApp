// options.js — Full settings management with PIN lock, categories,
// whitelist/blacklist, and import/export.

// ─── DOM references ──────────────────────────────────────────────────

// PIN lock
const pinLock = document.getElementById("pin-lock");
const pinEntry = document.getElementById("pinEntry");
const pinError = document.getElementById("pinError");

// Settings panel
const settingsPanel = document.getElementById("settings-panel");

// PIN management
const newPinInput = document.getElementById("newPin");
const confirmPinInput = document.getElementById("confirmPin");
const setPinBtn = document.getElementById("setPinBtn");
const clearPinBtn = document.getElementById("clearPinBtn");
const pinStatus = document.getElementById("pinStatus");

// Provider
const providerSelect = document.getElementById("providerSelect");
const modelSelect = document.getElementById("modelSelect");
const modelCustom = document.getElementById("modelCustom");
const refreshModelsBtn = document.getElementById("refreshModelsBtn");
const modelHint = document.getElementById("modelHint");
const fallbackSelects = [
  { select: document.getElementById("fallback1Select"), custom: document.getElementById("fallback1Custom") },
  { select: document.getElementById("fallback2Select"), custom: document.getElementById("fallback2Custom") },
];
const saveProviderBtn = document.getElementById("saveProviderBtn");
const providerStatus = document.getElementById("providerStatus");

const keyInputs = {
  gemini: document.getElementById("geminiKey"),
  openai: document.getElementById("openaiKey"),
  anthropic: document.getElementById("anthropicKey"),
  openrouter: document.getElementById("openrouterKey"),
};
const storageKeys = {
  gemini: "geminiApiKey",
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  openrouter: "openrouterApiKey",
};

// Categories
const categoryGrid = document.getElementById("categoryGrid");
const saveCategoriesBtn = document.getElementById("saveCategoriesBtn");
const selectAllCats = document.getElementById("selectAllCats");
const deselectAllCats = document.getElementById("deselectAllCats");
const categoryStatus = document.getElementById("categoryStatus");

// AI Prompt
const customPromptEl = document.getElementById("customPrompt");
const savePromptBtn = document.getElementById("savePromptBtn");
const resetPromptBtn = document.getElementById("resetPromptBtn");
const promptStatus = document.getElementById("promptStatus");

// Analysis options
const useTranscriptCb = document.getElementById("useTranscript");
const ageRangeInput = document.getElementById("ageRange");
const saveAnalysisBtn = document.getElementById("saveAnalysisBtn");
const analysisStatus = document.getElementById("analysisStatus");
const clearCacheBtn = document.getElementById("clearCacheBtn");

// Whitelist
const whitelistInput = document.getElementById("whitelistInput");
const addWhitelistBtn = document.getElementById("addWhitelistBtn");
const whitelistItems = document.getElementById("whitelistItems");

// Diagnostics
const refreshDiagBtn = document.getElementById("refreshDiagBtn");
const copyDiagBtn = document.getElementById("copyDiagBtn");
const clearDiagBtn = document.getElementById("clearDiagBtn");
const diagOut = document.getElementById("diagOut");
const diagStatus = document.getElementById("diagStatus");

// Recommended alternatives
const recInput = document.getElementById("recInput");
const recLabel = document.getElementById("recLabel");
const addRecBtn = document.getElementById("addRecBtn");
const recItems = document.getElementById("recItems");
const recStatus = document.getElementById("recStatus");

// Blacklist
const blacklistInput = document.getElementById("blacklistInput");
const addBlacklistBtn = document.getElementById("addBlacklistBtn");
const blacklistItems = document.getElementById("blacklistItems");

// Import / Export
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFile = document.getElementById("importFile");
const ieStatus = document.getElementById("ieStatus");

// ─── Helpers ─────────────────────────────────────────────────────────

function showStatus(el, msg, type = "info") {
  el.textContent = msg;
  el.className = `status status--${type}`;
}

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

// In-memory copies of lists (loaded from storage).
let whitelist = [];
let blacklist = [];
let recommendations = [];

// ─── PIN lock ────────────────────────────────────────────────────────

chrome.storage.local.get("parentPin", ({ parentPin }) => {
  if (!parentPin) {
    // No PIN set — go straight to settings.
    unlockSettings();
    return;
  }
  // Show PIN entry screen.
  pinLock.style.display = "block";
  settingsPanel.style.display = "none";
});

pinEntry.addEventListener("input", () => {
  if (pinEntry.value.length === 4) {
    chrome.runtime.sendMessage(
      { type: "VERIFY_PIN", pin: pinEntry.value },
      (res) => {
        if (res?.ok) {
          unlockSettings();
        } else if (res?.locked) {
          const secs = Math.ceil((res.retryAfterMs || 60000) / 1000);
          pinError.textContent = `Too many attempts. Try again in ${secs}s.`;
          pinEntry.disabled = true;
          pinEntry.value = "";
          setTimeout(() => {
            pinEntry.disabled = false;
            pinError.textContent = "";
            pinEntry.focus();
          }, res.retryAfterMs || 60000);
        } else {
          const left = res.attemptsLeft != null ? ` (${res.attemptsLeft} left)` : "";
          pinError.textContent = `Incorrect PIN.${left} Try again.`;
          pinEntry.value = "";
          pinEntry.focus();
        }
      }
    );
  }
});

function unlockSettings() {
  pinLock.style.display = "none";
  settingsPanel.style.display = "block";
  loadAllSettings();
}

// ─── PIN management ──────────────────────────────────────────────────

setPinBtn.addEventListener("click", () => {
  const pin = newPinInput.value.trim();
  const confirm = confirmPinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) {
    showStatus(pinStatus, "PIN must be exactly 4 digits.", "error");
    return;
  }
  if (pin !== confirm) {
    showStatus(pinStatus, "PINs do not match.", "error");
    return;
  }
  chrome.runtime.sendMessage({ type: "SET_PIN", pin }, (res) => {
    if (res?.ok) {
      newPinInput.value = "";
      confirmPinInput.value = "";
      showStatus(pinStatus, "PIN set. Settings are now locked.", "success");
    } else {
      showStatus(pinStatus, res?.error || "Failed to set PIN.", "error");
    }
  });
});

clearPinBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_PIN" }, () => {
    showStatus(pinStatus, "PIN removed. Settings are unlocked.", "info");
  });
});

// ─── Load all settings ───────────────────────────────────────────────

function loadAllSettings() {
  chrome.storage.local.get(
    [
      "aiProvider", "aiModel", "fallbackModels",
      ...Object.values(storageKeys),
      "blockedCategories",
      "whitelist", "blacklist", "recommendations",
    ],
    (data) => {
      // Provider
      if (data.aiProvider) providerSelect.value = data.aiProvider;
      for (const [prov, sk] of Object.entries(storageKeys)) {
        if (data[sk]) keyInputs[prov].placeholder = MASKED;
      }
      updateProviderCards();

      // Model: store the saved model and show in select or custom input.
      savedModel = data.aiModel || "";
      const fb = Array.isArray(data.fallbackModels) ? data.fallbackModels : [];
      savedFallbacks = [fb[0] || "", fb[1] || ""];
      resetModelSelect(savedModel);

      // Categories
      loadCategories(data.blockedCategories);

      // AI Prompt
      loadPrompt();

      // Analysis options
      loadAnalysisOptions();
      loadDiagnostics();

      // Lists
      whitelist = data.whitelist || [];
      blacklist = data.blacklist || [];
      renderList(whitelistItems, whitelist, "whitelist");
      renderList(blacklistItems, blacklist, "blacklist");
      recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
      renderRecList();
    }
  );
}

// ─── Provider ────────────────────────────────────────────────────────

function updateProviderCards() {
  const active = providerSelect.value;
  document.querySelectorAll(".provider-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.provider === active);
  });
}
providerSelect.addEventListener("change", updateProviderCards);

// Typing a key into a provider's field makes that provider the active one —
// no separate dropdown step, and the ↻ button then uses the typed key.
for (const [prov, input] of Object.entries(keyInputs)) {
  input.addEventListener("input", () => {
    if (input.value.trim() && providerSelect.value !== prov) {
      providerSelect.value = prov;
      providerSelect.dispatchEvent(new Event("change"));
    }
  });
}

saveProviderBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const toSave = { aiProvider: provider };

  // Read model from select or custom input.
  toSave.aiModel = readModelSelect(modelSelect, modelCustom);

  // Fallbacks: non-empty, unique, never the primary.
  const seen = new Set([toSave.aiModel || PROVIDER_DEFAULTS[provider] || ""]);
  toSave.fallbackModels = fallbackSelects
    .map(({ select, custom }) => readModelSelect(select, custom))
    .filter((m) => m && !seen.has(m) && seen.add(m));

  let keysSaved = 0;
  for (const [prov, sk] of Object.entries(storageKeys)) {
    const val = keyInputs[prov].value.trim();
    if (val) { toSave[sk] = val; keysSaved++; }
  }

  chrome.storage.local.set(toSave, () => {
    for (const [prov, sk] of Object.entries(storageKeys)) {
      if (toSave[sk]) {
        keyInputs[prov].value = "";
        keyInputs[prov].placeholder = MASKED;
      }
    }
    savedModel = toSave.aiModel;
    savedFallbacks = [toSave.fallbackModels[0] || "", toSave.fallbackModels[1] || ""];
    showStatus(providerStatus,
      `Saved. Active: ${provider}` +
      (toSave.aiModel ? ` (model: ${toSave.aiModel})` : " (default model)") +
      (toSave.fallbackModels.length ? ` + ${toSave.fallbackModels.length} fallback(s)` : "") +
      (keysSaved ? ` — ${keysSaved} key${keysSaved > 1 ? "s" : ""} updated.` : "."),
      "success"
    );
  });
});

// ─── Model selection ─────────────────────────────────────────────────

// Provider default models (mirrors PROVIDERS in background.js).
const PROVIDER_DEFAULTS = {
  gemini: "gemini-2.0-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-5-5",
  openrouter: "google/gemini-2.0-flash-001",
};

let savedModel = "";
let savedFallbacks = ["", ""];
let loadedModels = null; // models from the last ↻ for the current provider

/** Fill a model <select>: first option, fetched models, the saved value if unlisted, then "Custom…". */
function fillModelSelect(selectEl, customEl, currentValue, firstLabel) {
  selectEl.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = firstLabel;
  selectEl.appendChild(first);

  const listed = new Set();
  for (const m of loadedModels || []) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name && m.name !== m.id ? `${m.name}  (${m.id})` : m.id;
    selectEl.appendChild(opt);
    listed.add(m.id);
  }
  if (currentValue && !listed.has(currentValue)) {
    const cur = document.createElement("option");
    cur.value = currentValue;
    cur.textContent = currentValue;
    selectEl.appendChild(cur);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "Custom model…";
  selectEl.appendChild(custom);

  selectEl.value = currentValue || "";
  customEl.style.display = "none";
}

function readModelSelect(selectEl, customEl) {
  return selectEl.value === "__custom__" ? customEl.value.trim() : (selectEl.value || "");
}

/** (Re)build the primary and fallback selects from the saved values + loaded list. */
function resetModelSelect(currentModel) {
  const provider = providerSelect.value;
  const defaultId = PROVIDER_DEFAULTS[provider] || "";
  fillModelSelect(modelSelect, modelCustom, currentModel, `Default (${defaultId})`);
  fallbackSelects.forEach(({ select, custom }, i) => {
    fillModelSelect(select, custom, savedFallbacks[i] || "", "(no fallback)");
  });
  modelHint.textContent = loadedModels
    ? `${loadedModels.length} models loaded.`
    : `Enter an API key above (no need to save first), then click ↻ to load available models.`;
}

// Show/hide custom inputs when "Custom model…" is selected.
modelSelect.addEventListener("change", () => {
  modelCustom.style.display = modelSelect.value === "__custom__" ? "block" : "none";
});
fallbackSelects.forEach(({ select, custom }) => {
  select.addEventListener("change", () => {
    custom.style.display = select.value === "__custom__" ? "block" : "none";
  });
});

// When provider changes, the loaded list belongs to another provider.
providerSelect.addEventListener("change", () => {
  loadedModels = null;
  savedFallbacks = ["", ""];
  resetModelSelect("");
});

// Fetch models from the active provider's API.
refreshModelsBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const sk = storageKeys[provider];

  // Get the API key: prefer unsaved input, fall back to stored key.
  const inputKey = keyInputs[provider].value.trim();
  if (inputKey) {
    doFetchModels(provider, inputKey);
  } else {
    chrome.storage.local.get(sk, (data) => {
      const storedKey = data[sk];
      if (!storedKey) {
        modelHint.textContent = "Enter an API key for this provider first.";
        return;
      }
      doFetchModels(provider, storedKey);
    });
  }
});

function doFetchModels(provider, apiKey) {
  modelHint.textContent = "Fetching models…";
  refreshModelsBtn.disabled = true;

  chrome.runtime.sendMessage(
    { type: "FETCH_MODELS", provider, apiKey },
    (res) => {
      refreshModelsBtn.disabled = false;
      if (!res?.models?.length) {
        modelHint.textContent = res?.error
          ? `Failed: ${res.error}`
          : "No models returned. Check your API key.";
        return;
      }
      loadedModels = res.models;
      // Keep whatever is currently chosen in each select while refilling.
      const current = readModelSelect(modelSelect, modelCustom) || savedModel;
      savedFallbacks = fallbackSelects.map(({ select, custom }, i) => readModelSelect(select, custom) || savedFallbacks[i] || "");
      resetModelSelect(current);
    }
  );
}

// ─── Categories ──────────────────────────────────────────────────────

// Default category definitions — fetched from background.
let allCategories = [];

function loadCategories(savedBlockedIds) {
  chrome.runtime.sendMessage({ type: "GET_CATEGORIES" }, (res) => {
    if (!res?.categories) return;
    allCategories = res.categories;
    renderCategories(savedBlockedIds);
  });
}

function renderCategories(savedBlockedIds) {
  categoryGrid.innerHTML = "";
  for (const cat of allCategories) {
    const checked = savedBlockedIds
      ? savedBlockedIds.includes(cat.id)
      : cat.on;

    const item = document.createElement("label");
    item.className = "category-item" + (checked ? " checked" : "");
    item.innerHTML = `
      <input type="checkbox" value="${cat.id}" ${checked ? "checked" : ""}>
      ${cat.label}
    `;
    const cb = item.querySelector("input");
    cb.addEventListener("change", () => {
      item.classList.toggle("checked", cb.checked);
    });
    categoryGrid.appendChild(item);
  }
}

saveCategoriesBtn.addEventListener("click", () => {
  const checked = Array.from(categoryGrid.querySelectorAll("input:checked"))
    .map((cb) => cb.value);
  chrome.storage.local.set({ blockedCategories: checked }, () => {
    showStatus(categoryStatus, `${checked.length} categories will be blocked.`, "success");
  });
});

selectAllCats.addEventListener("click", () => {
  categoryGrid.querySelectorAll("input").forEach((cb) => {
    cb.checked = true;
    cb.closest(".category-item").classList.add("checked");
  });
});

deselectAllCats.addEventListener("click", () => {
  categoryGrid.querySelectorAll("input").forEach((cb) => {
    cb.checked = false;
    cb.closest(".category-item").classList.remove("checked");
  });
});

// ─── AI Prompt ──────────────────────────────────────────────────────

let defaultPrompt = "";

function loadPrompt() {
  // Fetch the default prompt from background so we always stay in sync.
  chrome.runtime.sendMessage({ type: "GET_DEFAULT_PROMPT" }, (res) => {
    if (res?.prompt) defaultPrompt = res.prompt;
    // Load any custom prompt from storage.
    chrome.storage.local.get("customPrompt", (data) => {
      customPromptEl.value = data.customPrompt || defaultPrompt;
    });
  });
}

savePromptBtn.addEventListener("click", () => {
  const val = customPromptEl.value.trim();
  if (!val) {
    showStatus(promptStatus, "Prompt cannot be empty.", "error");
    return;
  }
  chrome.storage.local.set({ customPrompt: val }, () => {
    showStatus(promptStatus, "Custom prompt saved.", "success");
  });
});

resetPromptBtn.addEventListener("click", () => {
  customPromptEl.value = defaultPrompt;
  chrome.storage.local.remove("customPrompt", () => {
    showStatus(promptStatus, "Prompt reset to default.", "info");
  });
});

// ─── Analysis options ───────────────────────────────────────────────

const AGE_RANGE_MAX_LEN = 20;

function loadAnalysisOptions() {
  chrome.storage.local.get(["useTranscript", "ageRange"], (data) => {
    useTranscriptCb.checked = data.useTranscript !== false; // default ON
    ageRangeInput.value = data.ageRange || "";
  });
}

// ─── Diagnostics ────────────────────────────────────────────────────

let lastDiagnostics = null;

function formatDiagnostics(d) {
  const lines = [
    `Kids Guard v${d.version} — provider: ${d.provider || "(none yet)"} / model: ${d.model || "(default)"}` +
      (d.fallbackModels && d.fallbackModels.length ? ` / fallbacks: ${d.fallbackModels.join(", ")}` : ""),
    `cache: ${d.cacheSize} decisions · in flight: ${d.inFlight} · queued: ${d.queued}`,
    "",
  ];
  if (!d.recentFailures.length) {
    lines.push("No failed checks recorded.");
  } else {
    lines.push(`Last ${d.recentFailures.length} failed check(s), newest first:`);
    for (const f of [...d.recentFailures].reverse()) {
      lines.push(
        `${new Date(f.t).toLocaleString()}  [${f.kind}]  ${f.provider || "?"} / ${f.model || "?"}  ` +
        `video ${f.videoId || "?"} (${f.source || "?"})\n    ${f.message || ""}`
      );
    }
  }
  return lines.join("\n");
}

function loadDiagnostics() {
  chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" }, (d) => {
    if (chrome.runtime.lastError || !d || d.error) {
      diagOut.textContent = "Background not reachable: " + (chrome.runtime.lastError?.message || d?.error || "unknown");
      return;
    }
    lastDiagnostics = d;
    diagOut.textContent = formatDiagnostics(d);
  });
}

refreshDiagBtn.addEventListener("click", loadDiagnostics);

copyDiagBtn.addEventListener("click", () => {
  if (!lastDiagnostics) { loadDiagnostics(); return; }
  const text = JSON.stringify({ exportedAt: new Date().toISOString(), ...lastDiagnostics }, null, 2);
  navigator.clipboard.writeText(text).then(
    () => showStatus(diagStatus, "Diagnostics copied to the clipboard — paste them into your report.", "success"),
    () => showStatus(diagStatus, "Could not copy automatically; select the text above and copy it.", "error")
  );
});

clearDiagBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR_DIAGNOSTICS" }, () => {
    showStatus(diagStatus, "Diagnostics cleared.", "info");
    loadDiagnostics();
  });
});

clearCacheBtn.addEventListener("click", () => {
  clearCacheBtn.disabled = true;
  chrome.runtime.sendMessage({ type: "CLEAR_CACHE" }, (res) => {
    clearCacheBtn.disabled = false;
    if (res?.ok) {
      showStatus(analysisStatus, "Decision cache cleared — every video will be checked again.", "success");
    } else {
      showStatus(analysisStatus, "Could not clear the cache: " + (res?.error || "unknown error"), "error");
    }
  });
});

saveAnalysisBtn.addEventListener("click", () => {
  const ageRange = ageRangeInput.value.trim().slice(0, AGE_RANGE_MAX_LEN);
  if (ageRange && !/^[0-9][0-9\s–-]*[0-9]$/.test(ageRange)) {
    showStatus(analysisStatus, "Age range should look like \"8–14\" or \"6-9\".", "error");
    return;
  }
  chrome.storage.local.set(
    { useTranscript: useTranscriptCb.checked, ageRange },
    () => {
      showStatus(analysisStatus,
        (useTranscriptCb.checked
          ? "Transcript analysis enabled."
          : "Transcript analysis disabled — using title/channel/description only.") +
        (ageRange ? ` Age range: ${ageRange}.` : " Age range: default (8–14)."),
        "success"
      );
    }
  );
});

// ─── List management (whitelist + blacklist) ─────────────────────────

function renderList(container, list, listName) {
  container.innerHTML = "";
  if (list.length === 0) {
    container.innerHTML = `<p class="list-empty">No ${listName === "whitelist" ? "whitelisted" : "blacklisted"} channels yet.</p>`;
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const name = entry.channel || entry;
    const trusted = !!(entry && typeof entry === "object" && entry.trusted);
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <span style="display:flex;align-items:center;gap:0.75rem">
        ${listName === "whitelist" ? `
          <label class="trust-toggle" title="Skip the short verification pause too — videos from this channel start instantly. Use only for channels you trust completely.">
            <input type="checkbox" class="trust-cb" ${trusted ? "checked" : ""}> Trusted — play instantly
          </label>` : ""}
        <button class="remove-btn" data-index="${i}" title="Remove">&times;</button>
      </span>
    `;
    item.querySelector(".trust-cb")?.addEventListener("change", (e) => {
      list[i] = { channel: name, trusted: e.target.checked };
      chrome.storage.local.set({ [listName]: list });
    });
    item.querySelector(".remove-btn").addEventListener("click", () => {
      list.splice(i, 1);
      chrome.storage.local.set({ [listName]: list }, () => {
        renderList(container, list, listName);
      });
    });
    container.appendChild(item);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

addWhitelistBtn.addEventListener("click", () => {
  const val = whitelistInput.value.trim();
  if (!val) return;
  whitelist.push({ channel: val });
  chrome.storage.local.set({ whitelist }, () => {
    whitelistInput.value = "";
    renderList(whitelistItems, whitelist, "whitelist");
  });
});

whitelistInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addWhitelistBtn.click();
});

addBlacklistBtn.addEventListener("click", () => {
  const val = blacklistInput.value.trim();
  if (!val) return;
  blacklist.push({ channel: val });
  chrome.storage.local.set({ blacklist }, () => {
    blacklistInput.value = "";
    renderList(blacklistItems, blacklist, "blacklist");
  });
});

blacklistInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBlacklistBtn.click();
});

// ─── Recommended alternatives ───────────────────────────────────────

const YT_HOSTS = new Set(["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"]);

/**
 * Validate and canonicalise a recommendation.  Accepts a video URL,
 * youtu.be link, playlist URL, channel URL (/@handle, /channel/…, /c/…,
 * /user/…) or a bare @handle.  Returns { url, label } or null.  Shorts
 * are never accepted.
 */
function normalizeRecommendation(text, label) {
  const raw = String(text || "").trim();
  const lbl = String(label || "").trim().slice(0, 80);
  if (!raw) return null;
  if (/^@[A-Za-z0-9._-]{3,60}$/.test(raw)) {
    return { url: `https://www.youtube.com/${raw}`, label: lbl || raw };
  }
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (!YT_HOSTS.has(url.hostname)) return null;

  let videoId = null;
  if (url.hostname === "youtu.be") videoId = url.pathname.slice(1);
  else if (url.pathname === "/watch") videoId = url.searchParams.get("v");
  if (videoId) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return { url: `https://www.youtube.com/watch?v=${videoId}`, label: lbl || "Recommended video" };
  }
  if (url.pathname === "/playlist") {
    const list = url.searchParams.get("list") || "";
    if (!/^[A-Za-z0-9_-]{10,80}$/.test(list)) return null;
    return { url: `https://www.youtube.com/playlist?list=${list}`, label: lbl || "Recommended playlist" };
  }
  const m = /^\/(@[A-Za-z0-9._-]{3,60}|channel\/[A-Za-z0-9_-]{10,40}|c\/[A-Za-z0-9._-]{1,60}|user\/[A-Za-z0-9._-]{1,60})(?:\/[A-Za-z]*)?\/?$/.exec(url.pathname);
  if (m) {
    return { url: `https://www.youtube.com/${m[1]}`, label: lbl || m[1].replace(/^(channel|c|user)\//, "") };
  }
  return null;
}

function renderRecList() {
  recItems.innerHTML = "";
  if (recommendations.length === 0) {
    recItems.innerHTML = `<p class="list-empty">No recommendations yet — whitelisted @channels will be offered instead.</p>`;
    return;
  }
  recommendations.forEach((rec, i) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span><strong>${escapeHtml(rec.label || "")}</strong>
        <span style="color:#757575;font-size:0.8rem;margin-left:0.4rem">${escapeHtml(rec.url || "")}</span></span>
      <button class="remove-btn" title="Remove">&times;</button>
    `;
    item.querySelector(".remove-btn").addEventListener("click", () => {
      recommendations.splice(i, 1);
      chrome.storage.local.set({ recommendations }, renderRecList);
    });
    recItems.appendChild(item);
  });
}

addRecBtn.addEventListener("click", () => {
  const rec = normalizeRecommendation(recInput.value, recLabel.value);
  if (!rec) {
    showStatus(recStatus, "Enter a YouTube video, playlist or channel URL, or an @handle (Shorts are not accepted).", "error");
    return;
  }
  if (recommendations.some((r) => r.url === rec.url)) {
    showStatus(recStatus, "That one is already in the list.", "info");
    return;
  }
  recommendations.push(rec);
  chrome.storage.local.set({ recommendations }, () => {
    recInput.value = "";
    recLabel.value = "";
    renderRecList();
    showStatus(recStatus, `Added: ${rec.label}`, "success");
  });
});

recInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addRecBtn.click();
});
recLabel.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addRecBtn.click();
});

// ─── Import / Export ─────────────────────────────────────────────────

exportBtn.addEventListener("click", () => {
  chrome.storage.local.get(
    ["blockedCategories", "whitelist", "blacklist", "customPrompt", "useTranscript", "ageRange", "recommendations"],
    (data) => {
      const payload = {
        _format: "ytkg-settings-v1",
        exportedAt: new Date().toISOString(),
        blockedCategories: data.blockedCategories || [],
        whitelist: data.whitelist || [],
        blacklist: data.blacklist || [],
      };
      if (data.customPrompt) payload.customPrompt = data.customPrompt;
      if (data.useTranscript !== undefined) payload.useTranscript = data.useTranscript;
      if (data.ageRange) payload.ageRange = data.ageRange;
      if (Array.isArray(data.recommendations)) payload.recommendations = data.recommendations;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ytkg-settings-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus(ieStatus, "Settings exported.", "success");
    }
  );
});

importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data._format !== "ytkg-settings-v1") {
        showStatus(ieStatus, "Invalid settings file format.", "error");
        return;
      }

      const toSave = {};
      if (Array.isArray(data.blockedCategories)) {
        toSave.blockedCategories = data.blockedCategories;
      }
      if (Array.isArray(data.whitelist)) {
        toSave.whitelist = data.whitelist;
        whitelist = data.whitelist;
      }
      if (Array.isArray(data.blacklist)) {
        toSave.blacklist = data.blacklist;
        blacklist = data.blacklist;
      }
      if (data.customPrompt) {
        toSave.customPrompt = data.customPrompt;
      }
      if (data.useTranscript !== undefined) {
        toSave.useTranscript = Boolean(data.useTranscript);
      }
      if (typeof data.ageRange === "string") {
        toSave.ageRange = data.ageRange.trim().slice(0, AGE_RANGE_MAX_LEN);
      }
      if (Array.isArray(data.recommendations)) {
        // Re-validate every entry; never trust a file blindly.
        recommendations = data.recommendations
          .map((r) => normalizeRecommendation(r && r.url, r && r.label))
          .filter(Boolean);
        toSave.recommendations = recommendations;
      }

      chrome.storage.local.set(toSave, () => {
        renderList(whitelistItems, whitelist, "whitelist");
        renderList(blacklistItems, blacklist, "blacklist");
        renderRecList();
        loadCategories(toSave.blockedCategories);
        loadPrompt();
        loadAnalysisOptions();
        showStatus(ieStatus, "Settings imported successfully.", "success");
      });
    } catch (err) {
      showStatus(ieStatus, "Failed to parse file: " + err.message, "error");
    }
  };
  reader.readAsText(file);
  // Reset so the same file can be re-imported.
  importFile.value = "";
});
