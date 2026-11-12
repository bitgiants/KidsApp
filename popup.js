// popup.js — Quick On/Off toggle with PIN protection.

const enableToggle = document.getElementById("enableToggle");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const pinOverlay = document.getElementById("pinOverlay");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");
const pinSubmit = document.getElementById("pinSubmit");
const settingsLink = document.getElementById("settingsLink");

// ─── Today's numbers ─────────────────────────────────────────────────

function loadStatus() {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (s) => {
    const today = document.getElementById("statToday");
    const time = document.getElementById("statTime");
    const sched = document.getElementById("statSchedule");
    if (chrome.runtime.lastError || !s || s.error) { today.textContent = "Today: —"; return; }
    today.textContent = `Today: ${s.todayBlocked} blocked · ${s.todayAllowed} allowed`;
    const used = Math.round((s.usedSeconds || 0) / 60);
    time.textContent = s.limitMinutes
      ? `Watch time: ${used} / ${s.limitMinutes + (s.extraMinutes || 0)} min${s.limitReached ? " — limit reached" : ""}`
      : `Watch time: ${used} min (no limit)`;
    if (s.schedule) {
      sched.style.display = "block";
      sched.textContent = `${s.schedule.label} — back at ${new Date(s.schedule.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    } else {
      sched.style.display = "none";
    }
  });
}
loadStatus();

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

function submitPopupPin() {
  const pin = pinInput.value;
  if (!pin) return;
  chrome.runtime.sendMessage({ type: "VERIFY_PIN", pin }, (res) => {
    if (res?.ok) {
      setEnabled(false);
    } else if (res?.locked) {
      pinError.textContent = `Too many tries — wait ${Math.ceil((res.retryAfterMs || 60000) / 1000)}s.`;
    } else {
      pinError.textContent = `Incorrect PIN${res?.attemptsLeft != null ? ` (${res.attemptsLeft} left)` : ""}.`;
      pinInput.value = "";
      pinInput.focus();
    }
  });
}
pinInput.addEventListener("input", () => { pinError.textContent = ""; });
pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitPopupPin(); });
pinSubmit.addEventListener("click", submitPopupPin);

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
