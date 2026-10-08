// Mapping engine: id resolution across providers, plus the public
// resolve()/map()/findByExternalId() surface. Priority: offline snapshot,
// animap.id, Kitsu mappings, AniList idMal, TMDB (IMDb/TVDB bridge).

import { TTL } from "../core/cache.js";
import { coerceIds, idsKey, formatId } from "../core/ids.js";
import { MappingError } from "../core/errors.js";
import { mergeIdsInto, metaOf, pickError } from "./common.js";

const ANIMAP_SERVICES = ["mal", "kitsu", "anilist", "anidb", "ann"];

// Which provider can answer for which native id namespace, and how.
export function nativeRefFor(providerId, ids) {
  if (!ids) return null;
  switch (providerId) {
    case "jikan":
      return ids.mal != null ? { kind: "mal", id: ids.mal } : null;
    case "kitsu":
      return ids.kitsu != null ? { kind: "kitsu", id: ids.kitsu } : null;
    case "anilist":
      if (ids.anilist != null) return { kind: "anilist", id: ids.anilist };
      if (ids.mal != null) return { kind: "mal", id: ids.mal, byIdMal: true };
      return null;
    case "animap":
      for (const service of ANIMAP_SERVICES) {
        if (ids[service] != null) return { kind: "animap", service, id: ids[service] };
      }
      return null;
    case "tmdb":
      if (ids.tmdb && ids.tmdb.tv != null) return { kind: "tmdb", id: ids.tmdb.tv, type: "tv" };
      if (ids.tmdb && ids.tmdb.movie != null) return { kind: "tmdb", id: ids.tmdb.movie, type: "movie" };
      if (typeof ids.tmdb === "number") return { kind: "tmdb", id: ids.tmdb, type: "tv" };
      return null;
    case "anime-skip":
      return ids.anilist != null ? { kind: "anilist", id: ids.anilist } : null;
    default:
      return null;
  }
}

// Resolve ids as far as the configured providers allow, with caching.
export async function resolveIds(client, input, opts = {}) {
  const started = client.clock.now();
  const seed = coerceIds(input);
  const targets = opts.to || null;
  const cacheKey = "map:" + idsKey(seed);
  const errors = [];
  const skipped = [];
  const sources = [];
  const conflicts = [];
  let merged = null;
  let cached = false;

  if (opts.cache !== "bypass" && !opts.fresh && client.cache) {
    const entry = client.cache.get(cacheKey);
    if (entry && entry.value && entry.value.ids) {
      merged = Object.assign({}, entry.value.ids);
      cached = true;
    }
  }

  if (!merged) {
    merged = Object.assign({}, seed);

    if (client.offline) {
      const found = client.offline.lookup(merged);
      if (found) {
        mergeIdsInto(merged, found.ids, conflicts);
        sources.push("offline");
      }
    }

    // Every mapping source whose inputs are already known runs in parallel.
    const tasks = [];
    if (client.isConfigured("animap")) {
      tasks.push({
        name: "animap",
        run: async () => {
          const canvas = await client.registry.animap.mapping(client.ctx("animap"), merged, opts);
          return canvas && canvas.ids;
        },
      });
    }
    if (merged.kitsu != null && client.isConfigured("kitsu")) {
      tasks.push({
        name: "kitsu",
        run: () => client.registry.kitsu.mappings(client.ctx("kitsu"), merged.kitsu, opts),
      });
    }
    if (merged.anilist != null && merged.mal == null && client.isConfigured("anilist")) {
      tasks.push({
        name: "anilist",
        run: async () => {
          const canvas = await client.registry.anilist.byId(client.ctx("anilist"), merged.anilist, opts);
          return canvas && canvas.ids;
        },
      });
    }
    if (client.isConfigured("tmdb") && (merged.imdb != null || merged.tvdb != null)) {
      tasks.push({
        name: "tmdb",
        run: async () => {
          const tmdb = client.registry.tmdb;
          const canvas =
            merged.imdb != null
              ? await tmdb.findByExternalId(client.ctx("tmdb"), merged.imdb, "imdb_id", opts)
              : await tmdb.findByExternalId(client.ctx("tmdb"), merged.tvdb, "tvdb_id", opts);
          return canvas && canvas.ids;
        },
      });
    }

    const settled = await Promise.all(
      tasks.map(async (task) => {
        try {
          return { name: task.name, ids: await task.run() };
        } catch (err) {
          return { name: task.name, error: err };
        }
      })
    );
    for (const result of settled) {
      if (result.error) {
        errors.push(pickError(result.error, result.name));
        continue;
      }
      if (result.ids) {
        mergeIdsInto(merged, result.ids, conflicts);
        sources.push(result.name);
      } else if (result.name === "animap") {
        skipped.push({ provider: result.name, reason: "not-found" });
      }
    }

    if (client.cache) {
      client.cache.set(cacheKey, { value: { ids: merged }, expiresAt: client.clock.now() + TTL.idMap });
    }
  }

  let ids = merged;
  let missing = [];
  if (targets) {
    ids = {};
    for (const target of targets) {
      if (merged[target] != null) ids[target] = merged[target];
    }
    missing = targets.filter((t) => merged[t] == null);
  }

  const result = {
    ids,
    all: merged,
    conflicts,
    sources,
    errors,
    skipped,
    missing,
    confidence: conflicts.length ? 0.5 : 1,
    cached,
    meta: metaOf(client, started),
  };
  if (opts.throwOnMissing && missing.length) {
    throw new MappingError(
      "Could not resolve " + missing.join(", ") + " from " + formatId(seed),
      undefined
    );
  }
  return result;
}

// Resolve a ref into a MappingResult.
export async function resolve(client, ref, opts = {}) {
  const parsed = client.parseId(ref);
  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) {
      return Object.assign(
        {
          ids: {},
          candidates: match.candidates,
          confidence: 0,
          sources: [],
          errors: match.errors || [],
          skipped: [{ provider: "slug", reason: "not-found" }],
          missing: opts.to || [],
        },
        { meta: match.meta }
      );
    }
    const resolved = await resolveIds(client, match.best.ids, opts);
    return Object.assign(resolved, { candidates: match.candidates, confidence: Math.min(resolved.confidence, match.best.confidence) });
  }
  return resolveIds(client, parsed.ids || parsed, opts);
}

// "Give me everything" shorthand.
export async function map(client, ref, targets, opts = {}) {
  const result = await resolve(client, ref, Object.assign({}, opts, targets ? { to: targets } : {}));
  return result;
}

// Lookup through a known external id (TMDB find / animap map routes).
export async function findByExternalId(client, provider, id, opts = {}) {
  if (provider === "tmdb") {
    const tmdb = client.registry.tmdb;
    if (client.isConfigured("tmdb") && (opts.type === "tv" || opts.type === "movie")) {
      const canvas = await tmdb.byId(client.ctx("tmdb"), { id, type: opts.type }, opts);
      return { ids: (canvas && canvas.ids) || {}, candidates: [], confidence: canvas ? 1 : 0, sources: ["tmdb"], errors: [] };
    }
    throw new (await import("../core/errors.js")).MappingError('findByExternalId("tmdb", ...) needs { type: "tv" | "movie" }');
  }
  const ids = { [provider]: id };
  return resolveIds(client, ids, opts);
}

// Debug why a resolution split into candidates/conflicts.
export async function mappingConflicts(client, ref, opts = {}) {
  const parsed = client.parseId(ref);
  if (parsed.kind === "slug") {
    return { conflicts: [], sources: [], note: "slug lookups do not produce mapping conflicts" };
  }
  const result = await resolveIds(client, parsed.ids || parsed, Object.assign({}, opts, { fresh: true }));
  return { conflicts: result.conflicts, candidates: result.conflicts.map((c) => c.dropped), sources: result.sources, all: result.all };
}
