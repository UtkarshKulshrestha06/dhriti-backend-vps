const Cache = new Map();

const CACHE_TTL = {
  STREAMS: 5 * 60 * 1000,
  BATCHES: 5 * 60 * 1000,
  SITE_CONTENT: 10 * 60 * 1000,
  AUTH_ROLE: 2 * 60 * 1000,
};

const cache = {
  get: (key) => {
    const item = Cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      Cache.delete(key);
      return null;
    }
    return item.value;
  },
  set: (key, value, ttl = 300000) => {
    Cache.set(key, {
      value,
      expiry: Date.now() + ttl,
    });
  },
  invalidate: (key) => {
    Cache.delete(key);
  },
  invalidatePrefix: (prefix) => {
    for (const key of Cache.keys()) {
      if (key.startsWith(prefix)) {
        Cache.delete(key);
      }
    }
  },
  /** @deprecated Use invalidatePrefix instead */
  invalidatePattern: (prefix) => {
    for (const key of Cache.keys()) {
      if (key.startsWith(prefix)) {
        Cache.delete(key);
      }
    }
  }
};

module.exports = { cache, CACHE_TTL };
