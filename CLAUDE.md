# CLAUDE.md — KidsApp (KindTube)

## Project Overview

**KindTube** is a Manifest V3 Chrome extension (org: **bitgiants**) that acts as an
AI-powered parental content filter for youtube.com. It pauses every video, sends the title /
channel / description / transcript to the parent's chosen LLM provider, and only lets the
video play on an `ALLOW` verdict. Thumbnails on browse pages get the same treatment
(badge + hover/click shield). Settings are PIN-locked.

Supported providers (each with its own API key): **Google Gemini**, **OpenAI**, **Anthropic**,
**OpenRouter**. The model list is fetched live from each provider's API.

## Repository Structure

```
KidsApp/
├── manifest.json          # MV3 manifest (permissions, host_permissions, entry points)
├── background.js          # Service worker: provider calls, cache, PIN, whitelist/blacklist
├── content.js             # Runs on youtube.com: pause/overlay player, scan thumbnails, SPA nav
├── options.html / .js     # Settings page (PIN-locked): providers/keys, model, categories,
│                          #   prompt, age range, transcript toggle, lists, import/export
├── popup.html / .js       # Toolbar popup: on/off toggle (PIN required to turn off)
├── icons/                 # Extension icons (16/48/128 PNG, rendered from assets/icon.svg)
├── assets/                # Icon source SVG, store art (promo tile, marquee) and store-listing.md —
│                          #   the Chrome Web Store copy, permission justifications and checklist
├── PRIVACY.md             # Privacy policy; published as a public gist and linked from the store listing
├── scripts/
│   ├── validate-setup.js  # `npm run setup` sanity checks
│   └── package.js         # `npm run package` → dist/kindtube.zip (no deps)
├── tests/                 # Jest unit tests (background.js pure logic)
└── CLAUDE.md
```

## Common Commands

| Task | Command |
|------|---------|
| Install dependencies | `npm install` |
| Validate setup | `npm run setup` |
| Run tests | `npm test` (Jest, `tests/**/*.test.js`) |
| Lint / format | not configured yet — keep to the existing style (2-space, double quotes, semicolons) |
| Package for Chrome | `npm run package` → `dist/kindtube.zip` |
| Load in Chrome | `chrome://extensions` → Developer mode → Load unpacked → repo root |

Node ≥ 16 (Node 22 in CI/cloud sessions). There is no build step; the extension files are
loaded as-is.

## Architecture Notes

- **Message bus**: `content.js` / `options.js` / `popup.js` talk to `background.js` via
  `chrome.runtime.sendMessage`. Message types: `CHECK_VIDEO`, `CHECK_CHANNEL`, `VERIFY_PIN`,
  `SET_PIN`, `CLEAR_PIN`, `RESET_PIN_WITH_RECOVERY`, `FETCH_MODELS`, `GET_CATEGORIES`,
  `GET_DEFAULT_PROMPT`, `CLEAR_CACHE`, `GET_DIAGNOSTICS`, `CLEAR_DIAGNOSTICS`, `ADD_LIST_ENTRY`,
  `RESOLVE_CHANNEL`, `GET_RECENT_BLOCKS`, `CLEAR_RECENT_BLOCKS`, `GET_STATUS`, `WATCH_TICK`,
  `EXTEND_LIMIT`.
- **Filtering modes**: `filterMode` is `ai` (default: every unlisted video goes to the model) or
  `allowlist` (only approved channels play; `content.js` decides thumbnails locally, the background
  confirms watch-page channels from the watch page, and the model is never called).
- **Ask a parent**: the block screen takes the PIN inline (`VERIFY_PIN`) and offers *play once* or
  *approve channel* (`ADD_LIST_ENTRY`). Watch-page verdicts are recorded (`recentBlocks`, `dailyStats`)
  for the Options review queue. Any change to lists / mode / categories / prompt / age range clears the
  decision cache (background `storage.onChanged`).
- **Screen time**: `dailyLimitMinutes` (0 = off) and `schedules` (`{label, days[0-6], start, end, enabled}`,
  windows that *block* YouTube, may cross midnight) live in storage. `content.js` samples real playback
  (1 s ticks while the main video plays and the tab is visible) and flushes `WATCH_TICK` every 10 s;
  the background adds it to `dailyStats[day].seconds` and answers with the status. `GET_STATUS` is
  checked on load, every navigation and every 60 s; a schedule hit or `limitReached` shows a full-page
  policy screen (`#ytkg-policy-block`) that enforces every `<video>` and short-circuits `handleVideoChange`.
  `EXTEND_LIMIT` is PIN-verified in the background and adds `extraMinutes` for today. Pure logic:
  `getActiveScheduleBlock`, `computeLimitStatus`, `parseHHMM` (unit-tested). The toolbar badge shows
  today's block count (`updateBadge`, set from `recordVerdict` and on worker start).
- **Model chain**: `aiModel` plus up to two `fallbackModels` (same provider) are tried in order
  by `queryModelChain`; a rate-limited non-last model hands off after one short wait, auth
  errors stop the chain, and a fallback answering is recorded in Diagnostics (`kind: fallback`).
- **Evaluation pipeline** (`evaluateVideo` in background.js): validate videoId → guard-enabled
  check → persistent cache → in-flight dedup → whitelist/blacklist → concurrency-limited
  transcript fetch + provider call → cache. Any error **fails closed** (video blocked).
- **Cache** is an in-memory Map hydrated from / persisted to `chrome.storage.local`
  (`evalCache`), because MV3 service workers are killed after ~30s idle.
- **Prompt**: `DEFAULT_SYSTEM_PROMPT` with `{{BLOCKED_CATEGORIES}}` and `{{AGE_RANGE}}`
  placeholders; parents can edit it in options. Video metadata is wrapped in
  `<video_metadata>` and declared untrusted — never paste uploader text into the system prompt.
- **Anthropic specifics**: current Claude models reject `temperature`, return a `thinking`
  block before the `text` block, and may return `stop_reason: "refusal"` (treated as BLOCK).
  Keep `queryAnthropic` in sync with the API when changing models.
- **Shorts** are blocked at the URL level: any `/shorts/` page gets a full-screen block, every
  `<video>` is paused + muted, and the tab is sent to the home page (`blockShortsPage`). Shorts
  shelves and the Shorts nav entry are hidden by CSS. Per-player overlays proved unreliable.
- **Block screens** offer up to four parent-configured alternatives (`recommendations` in
  storage, managed in Options), falling back to whitelisted `@handles`. Only youtube.com
  destinations are ever rendered; entries are validated on save *and* on render.
- **Metadata**: the background fetches the watch page and uses its `videoDetails` (keyed by
  video ID) as the authoritative title/author/description; the content script only forwards
  scraped text once `<ytd-watch-flexy video-id>` matches the URL. Transcripts are sampled from
  the opening *and* the middle of the caption track.
- **Whitelist tiers**: a whitelisted channel skips the AI but the content script still waits for
  the page's video-id marker before letting it play; `{ channel, trusted: true }` entries
  ("Trusted — play instantly") are decided locally in `content.js` with no background round-trip.
- **Resilience**: `sendCheckVideo` retries a dropped reply (service-worker recycle) with backoff
  and finally offers "Try again"; the background keeps the worker alive while evaluations are
  in flight, gives watch-page checks a priority lane ahead of thumbnails, retries provider
  calls, and treats provider safety-filter responses as BLOCK rather than as an outage.
- **PIN** is 4–12 characters, stored as a SHA-256 hash; the attempt counter is persisted in storage
  (`pinLockout`); a one-time recovery code (hashed, `recoveryCodeHash`) can remove a forgotten PIN.
- **content.js** must survive YouTube's SPA navigation (`yt-navigate-finish`) and must not
  read stale watch-page metadata for a new video — see `waitForMetadata`.

## Development Workflow

1. Create a feature branch from `master` (the default branch on GitHub should be `master`)
2. Make changes and ensure `npm test` and `npm run setup` pass before committing
3. Write clear, descriptive commit messages
4. Push and open a pull request; prefer **Squash and merge** to keep history clean

## Code Conventions

- **Safety first** — This is a kids' application. Fail closed: if a check cannot complete,
  block. Treat all YouTube-sourced text (titles, descriptions, transcripts, channel names) as
  untrusted input — sanitise, length-cap, and escape before rendering (`escapeHtml`) or
  prompting.
- **Accessibility** — Follow WCAG guidelines; overlays must be readable and keyboard-operable.
- **Privacy** — Comply with COPPA. The extension sends only public video metadata to the
  configured AI provider and stores settings locally; never collect or transmit data about
  the child.
- **Keep it simple** — Plain JS, no bundler, no runtime dependencies. Do not add npm
  dependencies without a strong reason.
- **Test thoroughly** — Pure logic lives in `background.js` and is unit-tested; keep DOM
  code in `content.js` thin so logic can be extracted and tested.

## AI Assistant Guidelines

When working in this repository:

- Read existing code before proposing changes
- Follow established patterns and conventions already present in the codebase
- Do not introduce unnecessary dependencies
- Prioritize security — never introduce XSS, injection, or other OWASP top-10 vulnerabilities
- Keep child safety as a top concern in all code and content decisions
- Run tests and linters before considering work complete
- Do not create documentation files beyond what is requested
