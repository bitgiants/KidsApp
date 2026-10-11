// Verifies the cache survives service-worker restarts via chrome.storage.local.
// A minimal chrome.storage mock is installed BEFORE background.js is required.

const store = {};
global.chrome = {
  storage: {
    local: {
      get: jest.fn(async (key) => ({ [key]: store[key] })),
      set: jest.fn(async (obj) => { Object.assign(store, obj); }),
    },
  },
};

const {
  cache,
  cacheSet,
  cacheGet,
  hydrateCache,
  CACHE_STORAGE_KEY,
  CACHE_TTL_MS,
  CACHE_PERSIST_DEBOUNCE_MS,
} = require("../background");

describe("cache persistence", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.useFakeTimers();
    cache.clear();
    for (const k of Object.keys(store)) delete store[k];
    chrome.storage.local.set.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("cacheSet persists to storage after a single debounced write", async () => {
    cacheSet("a", { blocked: true, reason: "r1" });
    cacheSet("b", { blocked: false, reason: "r2" });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(CACHE_PERSIST_DEBOUNCE_MS + 1);

    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    const stored = store[CACHE_STORAGE_KEY];
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.map(([k]) => k)).toEqual(["a", "b"]);
    expect(stored[0][1].value).toEqual({ blocked: true, reason: "r1" });
  });

  test("hydrateCache restores unexpired entries and drops expired or malformed ones", async () => {
    const now = Date.now();
    store[CACHE_STORAGE_KEY] = [
      ["fresh", { value: { blocked: true, reason: "keep" }, timestamp: now - 1000 }],
      ["stale", { value: { blocked: false, reason: "drop" }, timestamp: now - CACHE_TTL_MS - 1 }],
      ["bad", { nope: true }],
      "garbage",
    ];

    await hydrateCache();

    expect(cacheGet("fresh")).toEqual({ blocked: true, reason: "keep" });
    expect(cacheGet("stale")).toBeUndefined();
    expect(cacheGet("bad")).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  test("hydrateCache runs the storage read only once", async () => {
    chrome.storage.local.get.mockClear();
    await hydrateCache();
    await hydrateCache();
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(0); // already hydrated above
  });
});
