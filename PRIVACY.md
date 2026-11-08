# Privacy Policy — Kids Guard for YouTube

**Effective date:** 8 November 2026

Kids Guard for YouTube ("the extension") is a browser extension that helps parents filter YouTube videos for their children. This policy explains what information the extension processes, where it goes, and what it never does.

## The short version

- The extension has **no servers of its own**. Nothing you do is sent to the developer.
- To decide whether a video is suitable, the extension sends **public information about the video** (its title, channel name, description and, if available, an excerpt of its captions) to the **AI provider that you, the parent, chose and configured** with your own API key (Google Gemini, OpenAI, Anthropic, or OpenRouter).
- All settings — including your API keys and your parent PIN — are stored **only on your device**, in the browser's extension storage.
- The extension collects **no personal information** about you or your child, and contains no analytics, advertising, or tracking.

## What the extension processes

| Information | Where it comes from | Where it goes | Why |
|---|---|---|---|
| Video title, channel name, description, caption excerpt | The public YouTube page of the video being checked | The AI provider you selected | To classify the video as suitable or not |
| The video's public ID | The YouTube page URL | Kept on your device (decision cache) | To avoid re-checking the same video |
| Your AI provider API key(s) | Entered by you in Settings | Only to the provider that issued the key, as part of each request | Required by the provider to accept requests |
| Parent PIN | Entered by you in Settings | Never leaves your device; stored as a SHA-256 hash | To lock Settings and the on/off switch |
| Settings (categories, age range, custom prompt, approved / blocked channels, recommended videos) | Entered by you | Your device only | To apply your choices |
| Decision cache (video ID → allow/block + reason) | Produced by the extension | Your device only, expires after 24 hours | Speed and lower API cost |
| Diagnostics (recent failed checks: time, provider, error message) | Produced by the extension | Your device only (last 25 entries) | To help you troubleshoot; can be cleared in Settings |

## What the extension does not do

- It does **not** collect, store, or transmit any personal information about the child: no names, ages, accounts, viewing history, or behaviour. The "age range" setting is a number range chosen by the parent and is sent to the AI provider only as part of the filtering instructions.
- It does **not** send your YouTube account details, cookies, or watch history anywhere.
- It does **not** contain analytics, telemetry, advertising, or crash reporting.
- It does **not** sell, share, or transfer data to anyone, for any purpose.

## Third-party AI providers

The extension only contacts the provider you configure. Each request contains the public video information described above and your API key. Those providers process that data under their own terms and privacy policies:

- Google Gemini API — https://ai.google.dev/gemini-api/terms
- OpenAI — https://openai.com/policies/privacy-policy
- Anthropic — https://www.anthropic.com/privacy
- OpenRouter — https://openrouter.ai/privacy

The extension never contacts a provider you have not configured.

## Children's privacy

The extension is a tool operated by a parent or guardian. It is configured by an adult and does not ask the child for any information. The developer does not knowingly collect personal information from children under 13 (or the applicable age in your region), and because the extension has no servers, it has no means to do so.

## Data retention and your controls

- Everything the extension stores lives in your browser's extension storage and is removed when you uninstall the extension.
- **Clear decision cache** (Settings → Analysis Options) deletes all cached allow/block decisions.
- **Clear** (Settings → Diagnostics) deletes the failure log.
- Removing an API key or channel entry in Settings deletes it immediately.
- The decision cache expires automatically after 24 hours and is also cleared whenever the extension updates.

## Security

Browser extension storage is sandboxed per extension. The parent PIN is stored as a one-way hash, never as the PIN itself, and PIN entry is rate-limited. API keys are stored as provided, because the provider requires the original key with each request; keep your keys private and revoke them from your provider's dashboard if you believe they have been exposed.

## Changes to this policy

If this policy changes, the new version will be published at the same address with a new effective date. Material changes will also be noted in the extension's store listing.

## Contact

Questions about this policy or the extension: open an issue at https://github.com/bitgiants/KidsApp or use the support contact shown on the Chrome Web Store listing.
