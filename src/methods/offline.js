// Offline mapping snapshots: serve ids from a user-provided animap dump.

import { parseSources } from "../providers/animap.js";

function recordIds(record) {
  return parseSources(record && record.sources);
}

// Build an id index from a parsed animap dump (object or JSON string).
export function loadOffline(json, options = {}) {
  let parsed = json;
  if (typeof json === "string") parsed = JSON.parse(json);
  const records = parsed && Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed) ? parsed : null;
  if (!records) throw new Error("offline.load() expects the animap dump ({ data: [...] }) or a bare records array");

  const index = new Map();
  for (const record of records) {
    const ids = recordIds(record);
    const keys = Object.keys(ids);
    if (!keys.length) continue;
    for (const key of keys) {
      const value = String(ids[key]).toLowerCase();
      const id = key + ":" + value;
      if (!index.has(id)) index.set(id, record);
    }
  }

  return {
    source: options.source || "animap",
    size: records.length,
    lookup(ids) {
      if (!ids) return null;
      for (const key of Object.keys(ids)) {
        const value = ids[key];
        if (value == null) continue;
        if (key === "tmdb" && typeof value === "object") {
          if (value.tv != null && index.has("tmdb:tv:" + value.tv)) {
            const record = index.get("tmdb:tv:" + value.tv);
            return { ids: recordIds(record), record };
          }
          if (value.movie != null && index.has("tmdb:movie:" + value.movie)) {
            const record = index.get("tmdb:movie:" + value.movie);
            return { ids: recordIds(record), record };
          }
          continue;
        }
        const hit = index.get(key + ":" + String(value).toLowerCase());
        if (hit) return { ids: recordIds(hit), record: hit };
      }
      return null;
    },
    records() {
      return records;
    },
  };
}
