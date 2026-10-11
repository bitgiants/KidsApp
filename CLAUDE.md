# CLAUDE.md — KidsApp (YouTube Kids Guard)

## Project Overview

**YouTube Kids Guard** is a Manifest V3 Chrome extension (org: **bitgiants**) that acts as an
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
├── icons/                 # Extension icons
├── scripts/
│   ├── validate-setup.js  # `npm run setup` sanity checks
│   └── package.js         # `npm run package` → dist/youtube-kids-guard.zip (no deps)
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
| Package for Chrome | `npm run package` → `dist/youtube-kids-guard.zip` |
| Load in Chrome | `chrome://extensions` → Developer mode → Load unpacked → repo root |

Node ≥ 16 (Node 22 in CI/cloud sessions). There is no build step; the extension files are
loaded as-is.

## Architecture Notes

- **Message bus**: `content.js` / `options.js` / `popup.js` talk to `background.js` via
  `chrome.runtime.sendMessage`. Message types: `CHECK_VIDEO`, `CHECK_CHANNEL`, `VERIFY_PIN`,
  `SET_PIN`, `CLEAR_PIN`, `FETCH_MODELS`, `GET_CATEGORIES`, `GET_DEFAULT_PROMPT`.
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
- **PIN** is stored as a SHA-256 hash; verification is rate-limited in the service worker.
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
