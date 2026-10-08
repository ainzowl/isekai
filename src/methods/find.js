// findById/findByIds: resolve any id (inline, packed, slug), fan out to the
// planned providers, merge into one canonical Anime.

import { formatId, idsKey, toIsekai } from "../core/ids.js";
import { mergeAnime } from "../core/merge.js";
import { NotFoundError } from "../core/errors.js";
import { TTL } from "../core/cache.js";
import { METADATA_PROVIDERS } from "../providers/index.js";
import { nativeRefFor, resolveIds } from "./map.js";
import { applySelectors, mapLimit, metaOf, pickError, planProviders } from "./common.js";

function isekaiOf(ids) {
  try {
    if (ids.mal == null && ids.anilist == null && ids.kitsu == null) return null;
    return toIsekai({ mal: ids.mal, anilist: ids.anilist, kitsu: ids.kitsu });
  } catch (err) {
    return null;
  }
}

async function callProvider(client, providerId, nativeRef, opts) {
  const provider = client.registry[providerId];
  const ctx = client.ctx(providerId);
  switch (providerId) {
    case "jikan":
    case "kitsu":
      return provider.byId(ctx, nativeRef.id, opts);
    case "anilist":
      return provider.byId(ctx, nativeRef.id, Object.assign({}, opts, { byIdMal: !!nativeRef.byIdMal }));
    case "animap":
      return provider.byId(ctx, { service: nativeRef.service, id: nativeRef.id }, opts);
    case "tmdb":
      return provider.byId(ctx, { id: nativeRef.id, type: nativeRef.type }, opts);
    default:
      return null;
  }
}

const NAMESPACE_FOR = {
  jikan: ["mal"],
  kitsu: ["kitsu"],
  anilist: ["anilist"],
  animap: ["mal", "kitsu", "anilist", "anidb", "ann"],
  tmdb: ["tmdb"],
};

function describeIds(ids) {
  try {
    return formatId(ids);
  } catch (err) {
    return "unknown ids";
  }
}

export async function findById(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);

  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) throw new NotFoundError('No anime found for slug "' + parsed.slug + '"');
    return findById(client, match.best.ids, opts);
  }

  let ids = parsed.ids;
  const wanted = client.config.metadataProviders || METADATA_PROVIDERS;
  let planned = planProviders(client, wanted, opts).filter((id) => id !== "tmdb" || ids.tmdb != null);

  const errors = [];
  const skipped = [];
  let mapping = null;

  const needed = planned.filter((id) => !nativeRefFor(id, ids));
  if (needed.length) {
    const targets = [];
    for (const id of needed) {
      for (const ns of NAMESPACE_FOR[id] || []) {
        if (targets.indexOf(ns) < 0) targets.push(ns);
      }
    }
    mapping = await resolveIds(client, ids, Object.assign({}, opts, { to: targets }));
    ids = mapping.all;
    for (const e of mapping.errors) errors.push(e);
    for (const s of mapping.skipped) skipped.push(s);
    planned = planned.filter((id) => id !== "tmdb" || ids.tmdb != null);
  }

  if (opts.dryRun) {
    return {
      plan: planned.map((id) => ({ provider: id, native: nativeRefFor(id, ids), reason: "metadata merge" })),
      ids,
      meta: metaOf(client, started),
    };
  }

  const nfKey = "nf:" + idsKey(ids);
  if (client.cache && opts.cache !== "bypass") {
    const negative = client.cache.get(nfKey);
    if (negative) throw new NotFoundError("No anime found for " + formatId(ids) + " (negative cache)");
  }

  const results = await mapLimit(planned, client.config.concurrency, async (providerId) => {
    const nativeRef = nativeRefFor(providerId, ids);
    if (!nativeRef) return { providerId, skipped: { provider: providerId, reason: "unsupported" } };
    try {
      const canvas = await callProvider(client, providerId, nativeRef, opts);
      if (!canvas) return { providerId, skipped: { provider: providerId, reason: "not-found" } };
      return { providerId, canvas };
    } catch (err) {
      if (err && err.code === "NOT_FOUND") return { providerId, skipped: { provider: providerId, reason: "not-found" } };
      return { providerId, error: pickError(err, providerId) };
    }
  });

  const partials = [];
  for (const r of results) {
    if (r.canvas) partials.push({ provider: r.providerId, data: r.canvas });
    if (r.error) errors.push(r.error);
    if (r.skipped) skipped.push(r.skipped);
  }

  if (!partials.length) {
    if (client.cache) client.cache.set(nfKey, { value: true, expiresAt: client.clock.now() + TTL.negative });
    throw new NotFoundError("No provider could resolve " + describeIds(ids) + (errors.length ? " (" + errors[0].message + ")" : ""));
  }

  const merged = mergeAnime(partials, {
    mergeDefaults: client.config.mergeDefaults,
    providers: client.config.mergeProviders,
    defaultSource: client.config.defaultSource,
  });
  const isekai = isekaiOf(merged.ids);
  if (isekai) merged.ids.isekai = isekai;

  const result = Object.assign(merged, {
    errors,
    skipped,
    meta: metaOf(client, started, { providersQueried: partials.map((p) => p.provider) }),
  });
  return applySelectors(result, opts);
}

export async function findByIds(client, refs, opts = {}) {
  const started = client.clock.now();
  const results = await mapLimit(refs, opts.concurrency || client.config.concurrency, async (ref) => {
    try {
      return await findById(client, ref, opts);
    } catch (err) {
      return null;
    }
  });
  return { results, meta: metaOf(client, started) };
}
