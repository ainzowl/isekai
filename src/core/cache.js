// Cache entries: { value, etag?, expiresAt? }.
// Custom { get(k), set(k, v, ttl) } stores are detected and adapted.

import { ShogoError } from "./errors.js";

export const TTL = {
  idMap: 30 * 24 * 60 * 60 * 1000,
  anime: 24 * 60 * 60 * 1000,
  episodes: 24 * 60 * 60 * 1000,
  images: 7 * 24 * 60 * 60 * 1000,
  skips: 12 * 60 * 60 * 1000,
  search: 5 * 60 * 1000,
  negative: 10 * 60 * 1000,
  failure: 60 * 1000,
};

export function createMemoryCache(now) {
  const clock = typeof now === "function" ? now : () => Date.now();
  const map = new Map();
  const stats = { hits: 0, misses: 0, sets: 0 };
  return {
    stats,
    canExpire: true,
    get(key) {
      const entry = map.get(key);
      if (!entry) {
        stats.misses++;
        return null;
      }
      if (entry.expiresAt != null && entry.expiresAt <= clock()) {
        map.delete(key);
        stats.misses++;
        return null;
      }
      stats.hits++;
      return entry;
    },
    getStale(key) {
      return map.get(key) || null;
    },
    set(key, entry) {
      map.set(key, entry);
      stats.sets++;
    },
    delete(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

export function normalizeCache(option, now) {
  if (option === false) return null;
  if (option == null || option === "memory") return createMemoryCache(now);
  const custom = option;
  if (typeof custom.get !== "function" || typeof custom.set !== "function") {
    throw new ShogoError('cache must be false, "memory", or { get(key), set(key[, value, ttlMs]) }', {
      code: "BAD_OPTION",
    });
  }
  const valueCache = custom.set.length >= 3;
  return {
    canExpire: !valueCache, // value-caches manage their own TTL
    get(key) {
      const raw = custom.get(key);
      if (raw == null) return null;
      return valueCache ? { value: raw, expiresAt: null } : raw;
    },
    getStale(key) {
      const raw = custom.get(key);
      if (raw == null) return null;
      return valueCache ? { value: raw, expiresAt: null } : raw;
    },
    set(key, entry) {
      if (valueCache) custom.set(key, entry ? entry.value : undefined, undefined);
      else custom.set(key, entry);
    },
    delete(key) {
      if (typeof custom.delete === "function") custom.delete(key);
    },
  };
}
