import { idsKey } from "../core/ids.js";

function warn(message) {
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    try {
      console.warn("isekai: " + message);
    } catch (err) {
      /* never throw from a warning */
    }
  }
}

export function metaOf(client, started, extra = {}) {
  const http = client.http.stats;
  return Object.assign(
    {
      durationMs: client.clock.now() - started,
      cacheHits: http.cacheHits,
      coalesced: http.coalesced,
    },
    extra
  );
}

// Run fn(item) over items with a concurrency cap, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let index = 0;
  const size = Math.max(1, Math.min(limit || 1, items.length || 1));
  const workers = [];
  for (let w = 0; w < size; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const i = index++;
          if (i >= items.length) return;
          out[i] = await fn(items[i], i);
        }
      })()
    );
  }
  await Promise.all(workers);
  return out;
}

// Provider list filtered by config and caller preferences.
export function planProviders(client, wanted, opts = {}) {
  const list = wanted || null;
  const allow = client.config.metadataProviders || null; // config.providers is a hard allow-list
  const out = [];
  for (const id of Object.keys(client.registry)) {
    if (allow && allow.indexOf(id) < 0) continue;
    if (list && list.indexOf(id) < 0) continue;
    if (opts.providers && opts.providers !== "all" && opts.providers.indexOf(id) < 0) continue;
    if (opts.skip && opts.skip.indexOf(id) >= 0) continue;
    if (!client.isConfigured(id)) continue;
    out.push(id);
  }
  return out;
}

const ALWAYS_KEPT = ["ids", "slug", "slugs", "sources", "errors", "skipped", "meta", "fieldSources"];

// Apply include/exclude dotted-path selectors to a result.
export function applySelectors(result, opts = {}) {
  if (!result || typeof result !== "object") return result;
  const include = opts.include;
  const exclude = opts.exclude;
  if (!include && !exclude) return result;

  if (exclude) {
    for (const path of exclude) {
      if (ALWAYS_KEPT.indexOf(path) < 0) stripPath(result, path);
    }
  }
  if (!include) return result;

  const kept = {};
  for (const key of Object.keys(result)) {
    if (ALWAYS_KEPT.indexOf(key) >= 0 || include.indexOf(key) >= 0) kept[key] = result[key];
  }
  for (const path of include) {
    if (ALWAYS_KEPT.indexOf(path) >= 0) continue;
    copyPath(result, kept, path);
  }
  return kept;
}

function stripPath(obj, path) {
  if (!obj || typeof obj !== "object") return;
  const dot = path.indexOf(".");
  if (dot < 0) {
    delete obj[path];
    return;
  }
  const head = path.slice(0, dot);
  stripPath(obj[head], path.slice(dot + 1));
}

function copyPath(source, target, path) {
  const dot = path.indexOf(".");
  const head = dot < 0 ? path : path.slice(0, dot);
  const rest = dot < 0 ? null : path.slice(dot + 1);
  const value = source == null ? undefined : source[head];
  if (value === undefined || value === null) {
    warn("unknown selector path: " + path);
    return;
  }
  if (rest == null) {
    target[head] = value;
    return;
  }
  if (Array.isArray(value) || typeof value !== "object") {
    warn("cannot drill into selector path: " + path);
    return;
  }
  if (!target[head] || typeof target[head] !== "object" || Array.isArray(target[head])) target[head] = {};
  copyPath(value, target[head], rest);
}

// Stable dedupe key for an ids object or a result carrying .ids.
export function keyOf(entry) {
  const ids = entry && entry.ids ? entry.ids : entry;
  return idsKey(ids);
}

// Convert a thrown error into the envelope's error entry.
export function pickError(err, provider) {
  if (!err) return { provider, code: "PROVIDER_ERROR", message: "Unknown error" };
  return {
    provider: err.provider || provider,
    code: err.code || "PROVIDER_ERROR",
    message: err.message || String(err),
  };
}

// Merge a resolved ids object into a target, recording conflicts.
export function mergeIdsInto(target, incoming, conflicts) {
  if (!incoming) return;
  for (const key of Object.keys(incoming)) {
    const value = incoming[key];
    if (value == null) continue;
    if (key === "tmdb" && typeof value === "object") {
      const tmdb = target.tmdb || (target.tmdb = {});
      for (const kind of Object.keys(value)) {
        if (value[kind] == null) continue;
        if (tmdb[kind] == null) tmdb[kind] = value[kind];
        else if (tmdb[kind] !== value[kind] && conflicts) conflicts.push({ slot: "tmdb." + kind, kept: tmdb[kind], dropped: value[kind] });
      }
    } else if (target[key] == null) {
      target[key] = value;
    } else if (target[key] !== value && conflicts) {
      conflicts.push({ slot: key, kept: target[key], dropped: value });
    }
  }
}
