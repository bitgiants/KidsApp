// options.js — Multi-provider settings management.

const providerSelect = document.getElementById("providerSelect");
const modelOverride = document.getElementById("modelOverride");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

// Map provider IDs to their key input elements.
const keyInputs = {
  gemini: document.getElementById("geminiKey"),
  openai: document.getElementById("openaiKey"),
  anthropic: document.getElementById("anthropicKey"),
  openrouter: document.getElementById("openrouterKey"),
};

// Map provider IDs to storage keys (must match background.js PROVIDERS).
const storageKeys = {
  gemini: "geminiApiKey",
  openai: "openaiApiKey",
  anthropic: "anthropicApiKey",
  openrouter: "openrouterApiKey",
};

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status status--${type}`;
}

// ─── Visual: highlight the active provider card ──────────────────────

function updateProviderCards() {
  const active = providerSelect.value;
  document.querySelectorAll(".provider-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.provider === active);
  });
}

providerSelect.addEventListener("change", updateProviderCards);

// ─── Load saved settings ─────────────────────────────────────────────

chrome.storage.local.get(
  ["aiProvider", "aiModel", ...Object.values(storageKeys)],
  (data) => {
    // Restore provider selection.
    if (data.aiProvider && providerSelect.querySelector(`option[value="${data.aiProvider}"]`)) {
      providerSelect.value = data.aiProvider;
    }

    // Restore model override.
    if (data.aiModel) {
      modelOverride.value = data.aiModel;
    }

    // Show masked placeholders for stored keys.
    for (const [provider, storageKey] of Object.entries(storageKeys)) {
      if (data[storageKey]) {
        keyInputs[provider].placeholder = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    }

    updateProviderCards();

    const activeKey = data[storageKeys[providerSelect.value]];
    if (activeKey) {
      showStatus(`${providerSelect.value} is configured and active.`, "success");
    } else {
      showStatus("Enter an API key for your chosen provider.", "info");
    }
  }
);

// ─── Save ────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const provider = providerSelect.value;
  const toSave = { aiProvider: provider };

  // Save model override (or clear it).
  const model = modelOverride.value.trim();
  if (model) {
    toSave.aiModel = model;
  } else {
    // Clear so background.js falls back to the provider default.
    toSave.aiModel = "";
  }

  // Save any keys that the user typed (non-empty inputs).
  let keysSaved = 0;
  for (const [prov, storageKey] of Object.entries(storageKeys)) {
    const val = keyInputs[prov].value.trim();
    if (val) {
      toSave[storageKey] = val;
      keysSaved++;
    }
  }

  chrome.storage.local.set(toSave, () => {
    // Clear inputs and show masked placeholders.
    for (const [prov, storageKey] of Object.entries(storageKeys)) {
      if (toSave[storageKey]) {
        keyInputs[prov].value = "";
        keyInputs[prov].placeholder = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";
      }
    }
    showStatus(
      `Settings saved. Active provider: ${provider}` +
        (keysSaved > 0 ? ` (${keysSaved} key${keysSaved > 1 ? "s" : ""} updated).` : "."),
      "success"
    );
  });
});

// ─── Clear all ───────────────────────────────────────────────────────

clearBtn.addEventListener("click", () => {
  const allKeys = ["aiProvider", "aiModel", ...Object.values(storageKeys)];
  chrome.storage.local.remove(allKeys, () => {
    for (const input of Object.values(keyInputs)) {
      input.value = "";
      input.placeholder = input.dataset?.defaultPlaceholder || "Enter API key";
    }
    modelOverride.value = "";
    providerSelect.value = "gemini";
    updateProviderCards();
    showStatus("All keys and settings cleared.", "info");
  });
});
