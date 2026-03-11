// popup.js — Quick On/Off toggle with PIN protection.

const enableToggle = document.getElementById("enableToggle");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const pinOverlay = document.getElementById("pinOverlay");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const settingsLink = document.getElementById("settingsLink");

// ─── Load current state ───────────────────────────────────────────────

chrome.storage.local.get("guardEnabled", ({ guardEnabled }) => {
  // Default to enabled if never set.
  const enabled = guardEnabled !== false;
  applyUI(enabled);
});

function applyUI(enabled) {
  enableToggle.checked = enabled;
  statusDot.className = "status-dot " + (enabled ? "on" : "off");
  statusText.textContent = enabled ? "Protection ON" : "Protection OFF";
  // Hide PIN overlay whenever we refresh UI.
  pinOverlay.classList.remove("visible");
  pinInput.value = "";
  pinError.textContent = "";
}

// ─── Toggle handler ──────────────────────────────────────────────────

enableToggle.addEventListener("change", () => {
  if (enableToggle.checked) {
    // Turning ON — no PIN needed (making things safer).
    setEnabled(true);
  } else {
    // Turning OFF — check if a PIN is set.
    chrome.storage.local.get("parentPin", ({ parentPin }) => {
      if (!parentPin) {
        // No PIN configured — allow immediately.
        setEnabled(false);
      } else {
        // Revert the toggle visually until PIN is entered.
        enableToggle.checked = true;
        pinOverlay.classList.add("visible");
        pinInput.focus();
      }
    });
  }
});

// ─── PIN verification ───────────────────────────────────────────────

pinInput.addEventListener("input", () => {
  pinError.textContent = "";
  if (pinInput.value.length === 4) {
    chrome.runtime.sendMessage(
      { type: "VERIFY_PIN", pin: pinInput.value },
      (res) => {
        if (res?.ok) {
          setEnabled(false);
        } else {
          pinError.textContent = "Incorrect PIN.";
          pinInput.value = "";
          pinInput.focus();
        }
      }
    );
  }
});

// Allow pressing Escape to cancel.
pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pinOverlay.classList.remove("visible");
    pinInput.value = "";
    pinError.textContent = "";
  }
});

// ─── Persist & update UI ─────────────────────────────────────────────

function setEnabled(enabled) {
  chrome.storage.local.set({ guardEnabled: enabled }, () => {
    applyUI(enabled);
  });
}

// ─── Settings link ──────────────────────────────────────────────────

settingsLink.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
