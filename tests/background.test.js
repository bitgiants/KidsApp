const {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_AGE_RANGE,
  CATEGORIES,
  buildUserPrompt,
  buildSystemPrompt,
  sanitizeField,
  parseAIResponse,
  normalizeChannel,
  isChannelInList,
  isValidVideoId,
  supportsEffort,
  cacheGet,
  cacheSet,
  cache,
  CACHE_TTL_MS,
  CACHE_MAX_SIZE,
  withConcurrencyLimit,
  MAX_CONCURRENT_EVALUATIONS,
  fetchWithRetry,
  filterOpenAIModels,
  getAnthropicFallbackModels,
} = require("../background");

// ─── buildUserPrompt ─────────────────────────────────────────────────

describe("buildUserPrompt", () => {
  test("includes title and description inside the metadata block", () => {
    const result = buildUserPrompt({
      title: "Learn Fractions",
      description: "A math tutorial for kids",
    });
    expect(result.startsWith("<video_metadata>\n")).toBe(true);
    expect(result.endsWith("\n</video_metadata>")).toBe(true);
    expect(result).toContain("Title: Learn Fractions");
    expect(result).toContain("Description: A math tutorial for kids");
  });

  test("omits empty fields and returns fallback", () => {
    expect(buildUserPrompt({ title: "", description: "" })).toBe("No metadata available.");
  });

  test("returns fallback when no fields provided", () => {
    expect(buildUserPrompt({})).toBe("No metadata available.");
    expect(buildUserPrompt()).toBe("No metadata available.");
  });

  test("works with title only", () => {
    expect(buildUserPrompt({ title: "Science Experiment" })).toBe(
      "<video_metadata>\nTitle: Science Experiment\n</video_metadata>"
    );
  });

  test("includes transcript when present", () => {
    const result = buildUserPrompt({ title: "T", transcript: "hello world" });
    expect(result).toContain("Transcript (first ~2 min): hello world");
  });

  test("caps an over-long description", () => {
    const result = buildUserPrompt({ title: "T", description: "x".repeat(5000) });
    expect(result.length).toBeLessThan(2200);
    expect(result).toContain("…");
  });

  test("ignores non-string fields", () => {
    expect(buildUserPrompt({ title: 42, channel: null, description: {} })).toBe(
      "No metadata available."
    );
  });
});

// ─── sanitizeField ───────────────────────────────────────────────────

describe("sanitizeField", () => {
  test("strips control characters and collapses whitespace", () => {
    expect(sanitizeField("a\u0000b\n\n  c\t d", 100)).toBe("ab c d");
  });

  test("truncates with an ellipsis", () => {
    expect(sanitizeField("abcdef", 3)).toBe("abc…");
  });

  test("returns empty string for non-strings", () => {
    expect(sanitizeField(undefined, 10)).toBe("");
    expect(sanitizeField(123, 10)).toBe("");
  });
});

// ─── buildSystemPrompt ───────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  const blocked = CATEGORIES.filter((c) => c.id === "pranks" || c.id === "horror");

  test("substitutes blocked categories and the default age range", () => {
    const out = buildSystemPrompt(blocked, "");
    expect(out).toContain("* Pranks & Challenges\n* Horror & Creepy Content");
    expect(out).toContain(`children aged ${DEFAULT_AGE_RANGE}`);
    expect(out).not.toContain("{{BLOCKED_CATEGORIES}}");
    expect(out).not.toContain("{{AGE_RANGE}}");
  });

  test("substitutes every occurrence of the age range placeholder", () => {
    const occurrences = DEFAULT_SYSTEM_PROMPT.split("{{AGE_RANGE}}").length - 1;
    expect(occurrences).toBeGreaterThan(1);
    const out = buildSystemPrompt(blocked, "", "5–7");
    expect(out.split("5–7").length - 1).toBe(occurrences);
  });

  test("uses a custom template verbatim apart from placeholders", () => {
    const out = buildSystemPrompt(blocked, "Kids aged {{AGE_RANGE}}. Block: {{BLOCKED_CATEGORIES}}", "6-9");
    expect(out).toBe("Kids aged 6-9. Block: * Pranks & Challenges\n* Horror & Creepy Content");
  });

  test("default prompt declares metadata untrusted and REJECT precedence", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/UNTRUSTED DATA/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/REJECT list takes priority/);
  });
});

// ─── parseAIResponse ─────────────────────────────────────────────

describe("parseAIResponse", () => {
  test("parses a bare JSON ALLOW response", () => {
    const raw = '{"decision": "ALLOW", "reason": "Suitable for children."}';
    expect(parseAIResponse(raw)).toEqual({ decision: "ALLOW", reason: "Suitable for children." });
  });

  test("parses a bare JSON BLOCK response", () => {
    const raw = '{"decision": "BLOCK", "reason": "Contains violence."}';
    expect(parseAIResponse(raw)).toEqual({ decision: "BLOCK", reason: "Contains violence." });
  });

  test("strips markdown json fences", () => {
    const raw = '```json\n{"decision": "ALLOW", "reason": "Safe."}\n```';
    expect(parseAIResponse(raw)).toEqual({ decision: "ALLOW", reason: "Safe." });
  });

  test("strips plain markdown fences", () => {
    const raw = '```\n{"decision": "BLOCK", "reason": "Bad."}\n```';
    expect(parseAIResponse(raw)).toEqual({ decision: "BLOCK", reason: "Bad." });
  });

  test("recovers JSON wrapped in prose", () => {
    const raw = 'Sure! Here is my verdict:\n{"decision": "BLOCK", "reason": "Prank content."}\nLet me know.';
    expect(parseAIResponse(raw)).toEqual({ decision: "BLOCK", reason: "Prank content." });
  });

  test("normalises lowercase decision to uppercase", () => {
    expect(parseAIResponse('{"decision": "allow", "reason": "Fine."}')).toEqual({
      decision: "ALLOW",
      reason: "Fine.",
    });
  });

  test("provides default reason when missing", () => {
    expect(parseAIResponse('{"decision": "BLOCK"}').reason).toBe("No reason provided.");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseAIResponse("not json")).toThrow("Failed to parse");
    expect(() => parseAIResponse("{not json}")).toThrow("Failed to parse");
  });

  test("throws on non-object JSON", () => {
    expect(() => parseAIResponse("[1,2]")).toThrow("Unexpected decision");
  });

  test("throws on unexpected decision value", () => {
    expect(() => parseAIResponse('{"decision": "MAYBE", "reason": "Unsure."}')).toThrow("Unexpected decision");
  });

  test("throws when decision is missing entirely", () => {
    expect(() => parseAIResponse('{"reason": "No decision field."}')).toThrow("Unexpected decision");
  });
});

// ─── Channel list matching ───────────────────────────────────────────

describe("isChannelInList", () => {
  const list = [{ channel: "@NationalGeographic" }, "Kurzgesagt", { channel: " mark rober " }];

  test("matches case-insensitively with or without @", () => {
    expect(isChannelInList("nationalgeographic", list)).toBe(true);
    expect(isChannelInList("@NATIONALGEOGRAPHIC", list)).toBe(true);
    expect(isChannelInList("Kurzgesagt", list)).toBe(true);
    expect(isChannelInList("Mark Rober", list)).toBe(true);
  });

  test("does not match unrelated or empty names", () => {
    expect(isChannelInList("MrBeast", list)).toBe(false);
    expect(isChannelInList("", list)).toBe(false);
    expect(isChannelInList(undefined, list)).toBe(false);
  });

  test("normalizeChannel tolerates non-string input", () => {
    expect(normalizeChannel(123)).toBe("123");
    expect(normalizeChannel(null)).toBe("");
  });
});

// ─── Video ID validation ─────────────────────────────────────────────

describe("isValidVideoId", () => {
  test("accepts standard YouTube IDs", () => {
    expect(isValidVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isValidVideoId("a-b_c123")).toBe(true);
  });

  test("rejects blob URLs, injection attempts, and non-strings", () => {
    expect(isValidVideoId("blob:https://www.youtube.com/abc")).toBe(false);
    expect(isValidVideoId("abc&list=1")).toBe(false);
    expect(isValidVideoId("")).toBe(false);
    expect(isValidVideoId(null)).toBe(false);
    expect(isValidVideoId("x".repeat(65))).toBe(false);
  });
});

// ─── Anthropic helpers ───────────────────────────────────────────────

describe("supportsEffort", () => {
  test("true for Claude 4.6+ and the 5.x family", () => {
    expect(supportsEffort("claude-haiku-5-5")).toBe(true);
    expect(supportsEffort("claude-sonnet-5-5")).toBe(true);
    expect(supportsEffort("claude-opus-5-5")).toBe(true);
    expect(supportsEffort("claude-opus-4-6")).toBe(true);
    expect(supportsEffort("claude-sonnet-4-6")).toBe(true);
  });

  test("false for older or non-Claude models", () => {
    expect(supportsEffort("claude-haiku-4-5-20251001")).toBe(false);
    expect(supportsEffort("claude-sonnet-4-5-20250514")).toBe(false);
    expect(supportsEffort("claude-3-5-haiku-20241022")).toBe(false);
    expect(supportsEffort("gpt-4o-mini")).toBe(false);
    expect(supportsEffort(undefined)).toBe(false);
  });
});

describe("model lists", () => {
  test("filterOpenAIModels keeps chat models only", () => {
    const ids = filterOpenAIModels([
      { id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "o3-mini" },
      { id: "whisper-1" }, { id: "chatgpt-4o-latest" }, { id: "dall-e-3" },
    ]).map((m) => m.id);
    expect(ids).toEqual(["chatgpt-4o-latest", "gpt-4o-mini", "o3-mini"]);
  });

  test("Anthropic fallback list uses current model IDs", () => {
    const ids = getAnthropicFallbackModels().map((m) => m.id);
    expect(ids).toContain("claude-haiku-5-5");
    for (const id of ids) expect(id).not.toMatch(/\d{8}$/);
  });
});

// ─── Cache ───────────────────────────────────────────────────────────

describe("cache", () => {
  beforeEach(() => {
    cache.clear();
  });

  test("cacheSet and cacheGet round-trip", () => {
    cacheSet("v1", { blocked: false, reason: "OK" });
    expect(cacheGet("v1")).toEqual({ blocked: false, reason: "OK" });
  });

  test("returns undefined for missing keys", () => {
    expect(cacheGet("nonexistent")).toBeUndefined();
  });

  test("expires entries after TTL", () => {
    const realNow = Date.now;
    const baseTime = realNow();

    Date.now = () => baseTime;
    cacheSet("v1", { blocked: false, reason: "OK" });

    Date.now = () => baseTime + CACHE_TTL_MS - 1;
    expect(cacheGet("v1")).toEqual({ blocked: false, reason: "OK" });

    Date.now = () => baseTime + CACHE_TTL_MS + 1;
    expect(cacheGet("v1")).toBeUndefined();

    Date.now = realNow;
  });

  test("evicts oldest entry when cache exceeds max size", () => {
    for (let i = 0; i < CACHE_MAX_SIZE; i++) {
      cacheSet(`v${i}`, { blocked: false, reason: `r${i}` });
    }
    expect(cacheGet("v0")).toBeDefined();
    expect(cache.size).toBe(CACHE_MAX_SIZE);

    cacheSet("overflow", { blocked: true, reason: "new" });
    expect(cache.size).toBe(CACHE_MAX_SIZE);
    expect(cacheGet("v0")).toBeUndefined();
    expect(cacheGet("overflow")).toEqual({ blocked: true, reason: "new" });
  });
});

// ─── Concurrency limiter ─────────────────────────────────────────────

describe("withConcurrencyLimit", () => {
  test("never runs more than MAX_CONCURRENT_EVALUATIONS tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const release = [];
    const tasks = Array.from({ length: MAX_CONCURRENT_EVALUATIONS + 3 }, (_, i) =>
      withConcurrencyLimit(() => new Promise((resolve) => {
        active++;
        peak = Math.max(peak, active);
        release.push(() => { active--; resolve(i); });
      }))
    );

    // Let the queue pump.
    await Promise.resolve();
    expect(release.length).toBe(MAX_CONCURRENT_EVALUATIONS);
    expect(peak).toBe(MAX_CONCURRENT_EVALUATIONS);

    // Releasing one lets exactly one more start.
    release.shift()();
    await new Promise((r) => setImmediate(r));
    expect(release.length).toBe(MAX_CONCURRENT_EVALUATIONS);

    // Drain: queued tasks only start after a running one settles (on a
    // later microtask), so release in rounds until everything resolves.
    const all = Promise.all(tasks);
    let settled = false;
    all.then(() => { settled = true; });
    for (let round = 0; !settled && round < 50; round++) {
      while (release.length) release.shift()();
      await new Promise((r) => setImmediate(r));
    }
    expect(settled).toBe(true);
    expect(await all).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(MAX_CONCURRENT_EVALUATIONS);
  });

  test("propagates task errors and keeps the queue moving", async () => {
    await expect(withConcurrencyLimit(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(withConcurrencyLimit(async () => "after")).resolves.toBe("after");
  });
});

// ─── fetchWithRetry ──────────────────────────────────────────────────

describe("fetchWithRetry", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function response(status, retryAfter) {
    return {
      status,
      ok: status < 400,
      headers: { get: (name) => (name === "retry-after" ? retryAfter ?? null : null) },
    };
  }

  test("retries once on 429 then returns the successful response", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(429, "2"))
      .mockResolvedValueOnce(response(200));

    const pending = fetchWithRetry("https://example.test", {});
    await jest.advanceTimersByTimeAsync(2000);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("gives up after the retry budget and returns the last response", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(response(503));

    const pending = fetchWithRetry("https://example.test", {});
    await jest.advanceTimersByTimeAsync(5000);
    const res = await pending;

    expect(res.status).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("does not retry client errors like 401", async () => {
    global.fetch = jest.fn().mockResolvedValue(response(401));
    const res = await fetchWithRetry("https://example.test", {});
    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
