// options.js — Manages the Gemini API key via chrome.storage.local.

const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status status--${type}`;
}

// ─── Load existing key on page open ──────────────────────────────────

chrome.storage.local.get("geminiApiKey", ({ geminiApiKey }) => {
  if (geminiApiKey) {
    // Show a masked placeholder so the user knows a key is stored.
    apiKeyInput.placeholder = "••••••••••••••••";
    showStatus("API key is configured.", "success");
  } else {
    showStatus("No API key configured yet.", "info");
  }
});

// ─── Save ────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus("Please enter an API key.", "error");
    return;
  }

  chrome.storage.local.set({ geminiApiKey: key }, () => {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "••••••••••••••••";
    showStatus("API key saved.", "success");
  });
});

// ─── Clear ───────────────────────────────────────────────────────────

clearBtn.addEventListener("click", () => {
  chrome.storage.local.remove("geminiApiKey", () => {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "Enter your API key";
    showStatus("API key removed.", "info");
  });
});
