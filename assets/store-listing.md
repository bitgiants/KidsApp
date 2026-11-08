# Chrome Web Store listing — Kids Guard for YouTube

Everything to paste into the Developer Dashboard, field by field. Keep this file in sync with
`manifest.json` (name / version / summary) when the listing changes.

---

## 1. Package

- Upload `dist/kids-guard-for-youtube.zip` (`npm run package`). The dashboard reads **name**, **version**
  and **summary** from the manifest.
- Every new upload needs a higher version number.

## 2. Store listing tab

**Title** (from manifest): `Kids Guard for YouTube`

**Summary** (from manifest, 125/132 chars):

> AI parental filter for YouTube. Blocks unsafe videos and Shorts using your own AI key. PIN-locked settings and channel lists.

**Detailed description** (plain text; the dashboard does not render Markdown):

```
Kids Guard for YouTube turns regular YouTube into a safer place for children — and you stay in control.

HOW IT WORKS
Every video is paused the moment it opens. Its title, channel, description and (when available) subtitles are checked by an AI model you choose — Google Gemini, OpenAI, Anthropic Claude, or any model on OpenRouter — using your own API key. Only videos that pass will play. Blocked videos show a clear, kid-friendly screen explaining why, plus a green panel of parent-approved alternatives ("Try one of these instead"). YouTube Shorts are blocked entirely, and the Shorts shelf and menu entry are hidden.

While a video is being checked, children see a friendly "One moment, please!" screen — never a half-loaded video.

BROWSE SAFELY TOO
Thumbnails on the Home page, search results and sidebar get a ✓ or ✗ badge, and hover-to-preview is disabled until a video is approved, so nothing autoplays behind your back.

MADE FOR PARENTS
• Choose the child's age range and which categories to block: pranks & challenges, reaction and unboxing videos, non-educational gaming, vlogs, memes, horror, drama, toy consumerism, news & politics, and more.
• Approved channels are never sent to the AI; mark the ones you trust completely as "Trusted — play instantly".
• Always-block channels.
• Recommended videos and channels that appear on every block screen.
• Edit the AI's instructions if you want to fine-tune the filter.
• Everything — including the on/off switch — is locked behind a 4-digit parent PIN.
• Import/export your settings to set up another computer in seconds.

RELIABLE
Decisions are cached so the same video is not re-checked. If your AI provider is busy, the extension waits and retries, can fall back to a second or third model you choose, and tells you plainly — with a Try again button — in the rare case a check cannot be completed. A Diagnostics panel in Settings shows exactly what happened.

YOUR DATA STAYS YOURS
The extension has no servers. It talks directly to the AI provider you configured, with your own key, and sends only public information about the video being checked. It collects nothing about you or your child, and contains no analytics or advertising. Full policy: see the privacy policy link on this page.

WHAT YOU NEED
An API key from one of the supported providers (Google Gemini offers a free tier). Enter it once in Settings — the model list loads automatically.

Not affiliated with or endorsed by YouTube or Google. YouTube is a trademark of Google LLC.
```

**Category:** Household (parental controls). If the dashboard's list differs, pick the closest of
Household / Privacy & Security / Education.

**Language:** English

**Official URL:** leave blank (the repository is private), or a website you control.

**Support:** enter the support email you want shown publicly (the dashboard's "Support URL /
email" field). The same address must be verified on your developer account.

## 3. Graphic assets

| Asset | Required | File |
|---|---|---|
| Store icon 128×128 | yes | `icons/icon128.png` (also inside the manifest) |
| Screenshots 1280×800 (or 640×400), 1–5 | **yes, at least one** | take on a real YouTube page — see shot list |
| Small promo tile 440×280 | optional, recommended | `assets/promo-tile-440x280.png` |
| Marquee promo tile 1400×560 | optional | `assets/marquee-1400x560.png` |

Screenshots must show the real extension in use (no mock-ups). Set the Chrome window to 1280×800
(DevTools → device toolbar → "Responsive" 1280×800 makes this exact) and capture:

1. A blocked video: red "Video Blocked" screen with the reason and the green "Try one of these instead" panel.
2. The wait screen: "One moment, please!"
3. The YouTube Home page with ✓ / ✗ badges on thumbnails.
4. Settings → AI Provider card: provider, model, fallback models.
5. Settings → Whitelisted Channels (with a "Trusted — play instantly" tick) and Recommended Videos & Channels.

Crop or blur anything personal (account avatar, email) before uploading.

## 4. Privacy practices tab

**Single purpose description:**

> Kids Guard for YouTube filters YouTube for children: it pauses each video, has the AI provider chosen by the parent classify it as suitable or not, blocks unsuitable videos and all YouTube Shorts, and lets parents manage approved / blocked channels and recommended alternatives behind a PIN.

**Permission justifications** — the dashboard has ONE box for `storage` and ONE box for all host
permissions together (1,000 characters each):

`storage justification`:

```
Stores the parent's settings on the user's device only: the chosen AI provider and the parent's own API keys, the parent PIN (stored as a SHA-256 hash, never in clear text), blocked-category toggles, the child's age range, optional custom filtering instructions, approved and blocked channel lists, recommended videos and channels, a 24-hour cache of allow/block decisions so the same video is not re-checked, and a short log of failed checks for troubleshooting. Nothing in storage is synced or sent to the developer.
```

`Host permission justification`:

```
The extension's single purpose is to check each YouTube video for a child before it plays and block unsuitable ones.

https://www.youtube.com/* — the content script runs on YouTube pages to pause the player, read the public title, channel and description of the video on screen, show the block/allow screens and thumbnail badges, and fetch the public watch page and captions of the video being checked.

https://generativelanguage.googleapis.com/*, https://api.openai.com/*, https://api.anthropic.com/*, https://openrouter.ai/* — the parent chooses ONE AI provider in Settings and enters their own API key. The extension calls that provider's API to classify the video and to list its available models. Only the provider the parent configured is ever contacted, and only public information about the video is sent. No other hosts are accessed and no user or child data is collected.
```

**Are you using remote code?** Select **No, I am not using remote code** (the "Justification" box
underneath is only for "Yes"). All JavaScript ships inside the package; the extension only exchanges
JSON data with the AI provider APIs, which Chrome does not count as remote code. The yellow
"in-depth review" notice about host permissions is informational — expected for any extension that
runs on youtube.com.

**Data usage — what the extension collects** (tick these):

- **Website content** — the public title, channel name, description and a captions excerpt of the YouTube video being checked, sent to the AI provider the parent configured.
- **Authentication information** — the parent's own AI-provider API key, sent only to the provider that issued it as part of each request; the parent PIN is stored locally as a hash and never transmitted.

Leave unticked: personally identifiable information, health, financial and payment, personal communications, location, web history, user activity.

**Certifications** (tick all three — all true):

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** required. The repository is private, so publish `PRIVACY.md` as a **public GitHub gist**
(gist.github.com → paste the file → "Create public gist") and enter the gist URL here. Update the gist
whenever `PRIVACY.md` changes.

## 5. Distribution tab

- **Visibility:** start with **Unlisted** (installable via link for your family; still reviewed), switch to
  **Public** once you are happy.
- **Regions:** all regions.
- **Trader status (EU):** answer according to your situation; a hobby/non-commercial project is usually "non-trader".

## 6. Before you press Submit

- [ ] Developer account: contact email verified, 2-step verification on.
- [ ] Zip uploaded; version higher than the last upload.
- [ ] At least one real screenshot.
- [ ] Privacy policy gist URL entered.
- [ ] Permission justifications and data-usage disclosures filled (section 4).
- [ ] Description pasted; category and language set.

Review usually takes 1–3 days; items with host permissions can take longer.
