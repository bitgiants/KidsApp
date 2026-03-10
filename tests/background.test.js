const {
  buildUserPrompt,
  parseGeminiResponse,
  cacheGet,
  cacheSet,
  cache,
  CACHE_TTL_MS,
  CACHE_MAX_SIZE,
} = require("../background");

// ─── buildUserPrompt ─────────────────────────────────────────────────

describe("buildUserPrompt", () => {
  test("includes title and description", () => {
    const result = buildUserPrompt({
      title: "Learn Fractions",
      description: "A math tutorial for kids",
    });
    expect(result).toContain("Title: Learn Fractions");
    expect(result).toContain("Description: A math tutorial for kids");
  });

  test("omits empty fields and returns fallback", () => {
    const result = buildUserPrompt({
      title: "",
      description: "",
    });
    expect(result).toBe("No metadata available.");
  });

  test("returns fallback when no fields provided", () => {
    const result = buildUserPrompt({});
    expect(result).toBe("No metadata available.");
  });

  test("works with title only", () => {
    const result = buildUserPrompt({ title: "Science Experiment" });
    expect(result).toBe("Title: Science Experiment");
  });

  test("works with description only", () => {
    const result = buildUserPrompt({ description: "How volcanoes work" });
    expect(result).toBe("Description: How volcanoes work");
  });
});

// ─── parseGeminiResponse ─────────────────────────────────────────────

describe("parseGeminiResponse", () => {
  test("parses a bare JSON ALLOW response", () => {
    const raw = '{"decision": "ALLOW", "reason": "Suitable for children."}';
    expect(parseGeminiResponse(raw)).toEqual({
      decision: "ALLOW",
      reason: "Suitable for children.",
    });
  });

  test("parses a bare JSON BLOCK response", () => {
    const raw = '{"decision": "BLOCK", "reason": "Contains violence."}';
    expect(parseGeminiResponse(raw)).toEqual({
      decision: "BLOCK",
      reason: "Contains violence.",
    });
  });

  test("strips markdown json fences", () => {
    const raw = '```json\n{"decision": "ALLOW", "reason": "Safe."}\n```';
    expect(parseGeminiResponse(raw)).toEqual({
      decision: "ALLOW",
      reason: "Safe.",
    });
  });

  test("strips plain markdown fences", () => {
    const raw = '```\n{"decision": "BLOCK", "reason": "Bad."}\n```';
    expect(parseGeminiResponse(raw)).toEqual({
      decision: "BLOCK",
      reason: "Bad.",
    });
  });

  test("normalises lowercase decision to uppercase", () => {
    const raw = '{"decision": "allow", "reason": "Fine."}';
    expect(parseGeminiResponse(raw)).toEqual({
      decision: "ALLOW",
      reason: "Fine.",
    });
  });

  test("provides default reason when missing", () => {
    const raw = '{"decision": "BLOCK"}';
    expect(parseGeminiResponse(raw).reason).toBe("No reason provided.");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseGeminiResponse("not json")).toThrow("Failed to parse");
  });

  test("throws on unexpected decision value", () => {
    const raw = '{"decision": "MAYBE", "reason": "Unsure."}';
    expect(() => parseGeminiResponse(raw)).toThrow("Unexpected decision");
  });

  test("throws when decision is missing entirely", () => {
    const raw = '{"reason": "No decision field."}';
    expect(() => parseGeminiResponse(raw)).toThrow("Unexpected decision");
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

    // Insert at baseTime
    Date.now = () => baseTime;
    cacheSet("v1", { blocked: false, reason: "OK" });

    // Read just before TTL expires — should still be there
    Date.now = () => baseTime + CACHE_TTL_MS - 1;
    expect(cacheGet("v1")).toEqual({ blocked: false, reason: "OK" });

    // Read after TTL expires — should be gone
    Date.now = () => baseTime + CACHE_TTL_MS + 1;
    expect(cacheGet("v1")).toBeUndefined();

    Date.now = realNow;
  });

  test("evicts oldest entry when cache exceeds max size", () => {
    for (let i = 0; i < CACHE_MAX_SIZE; i++) {
      cacheSet(`v${i}`, { blocked: false, reason: `r${i}` });
    }

    // All entries should be present.
    expect(cacheGet("v0")).toBeDefined();
    expect(cache.size).toBe(CACHE_MAX_SIZE);

    // Adding one more should evict the oldest (v0).
    cacheSet("overflow", { blocked: true, reason: "new" });
    expect(cache.size).toBe(CACHE_MAX_SIZE);
    expect(cacheGet("v0")).toBeUndefined();
    expect(cacheGet("overflow")).toEqual({ blocked: true, reason: "new" });
  });
});
