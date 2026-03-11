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
const modelOverride = document.getElementById("modelOverride");
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

// Whitelist
const whitelistInput = document.getElementById("whitelistInput");
const addWhitelistBtn = document.getElementById("addWhitelistBtn");
const whitelistItems = document.getElementById("whitelistItems");

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
        } else {
          pinError.textContent = "Incorrect PIN. Try again.";
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
  chrome.storage.local.set({ parentPin: pin }, () => {
    newPinInput.value = "";
    confirmPinInput.value = "";
    showStatus(pinStatus, "PIN set. Settings are now locked.", "success");
  });
});

clearPinBtn.addEventListener("click", () => {
  chrome.storage.local.remove("parentPin", () => {
    showStatus(pinStatus, "PIN removed. Settings are unlocked.", "info");
  });
});

// ─── Load all settings ───────────────────────────────────────────────

function loadAllSettings() {
  chrome.storage.local.get(
    [
      "aiProvider", "aiModel",
      ...Object.values(storageKeys),
      "blockedCategories",
      "whitelist", "blacklist",
    ],
    (data) => {
      // Provider
      if (data.aiProvider) providerSelect.value = data.aiProvider;
      if (data.aiModel) modelOverride.value = data.aiModel;
      for (const [prov, sk] of Object.entries(storageKeys)) {
        if (data[sk]) keyInputs[prov].placeholder = MASKED;
      }
      updateProviderCards();

      // Categories
      loadCategories(data.blockedCategories);

      // AI Prompt
      loadPrompt();

      // Lists
      whitelist = data.whitelist || [];
      blacklist = data.blacklist || [];
      renderList(whitelistItems, whitelist, "whitelist");
      renderList(blacklistItems, blacklist, "blacklist");
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

saveProviderBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const toSave = { aiProvider: provider };
  const model = modelOverride.value.trim();
  toSave.aiModel = model || "";

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
    showStatus(providerStatus,
      `Saved. Active: ${provider}` +
      (keysSaved ? ` (${keysSaved} key${keysSaved > 1 ? "s" : ""} updated).` : "."),
      "success"
    );
  });
});

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
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <span>${escapeHtml(name)}</span>
      <button class="remove-btn" data-index="${i}" title="Remove">&times;</button>
    `;
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

// ─── Import / Export ─────────────────────────────────────────────────

exportBtn.addEventListener("click", () => {
  chrome.storage.local.get(
    ["blockedCategories", "whitelist", "blacklist", "customPrompt"],
    (data) => {
      const payload = {
        _format: "ytkg-settings-v1",
        exportedAt: new Date().toISOString(),
        blockedCategories: data.blockedCategories || [],
        whitelist: data.whitelist || [],
        blacklist: data.blacklist || [],
      };
      if (data.customPrompt) payload.customPrompt = data.customPrompt;
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

      chrome.storage.local.set(toSave, () => {
        renderList(whitelistItems, whitelist, "whitelist");
        renderList(blacklistItems, blacklist, "blacklist");
        loadCategories(toSave.blockedCategories);
        loadPrompt();
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
