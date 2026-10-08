// search()/searchAll(): fan out, normalize, dedupe by id overlap or slug.

import { overlaps, slugify } from "../core/ids.js";
import { SEARCH_PROVIDERS } from "../providers/index.js";
import { metaOf, pickError, planProviders } from "./common.js";

function resultFrom(canvas, provider) {
  return {
    ids: canvas.ids || {},
    titles: canvas.titles || {},
    synonyms: canvas.synonymTitles || [],
    type: canvas.type || null,
    year: canvas.season && canvas.season.year ? canvas.season.year : null,
    episodes: canvas.episodes != null ? canvas.episodes : null,
    synopsis: canvas.synopsis || null,
    image: canvas.images && canvas.images.posters && canvas.images.posters[0] ? canvas.images.posters[0].url : null,
    slug: canvas.slug || null,
    rating:
      canvas.ratings && canvas.ratings[provider] ? canvas.ratings[provider].score : null,
    provider,
  };
}

async function searchOne(client, providerId, query, opts) {
  const provider = client.registry[providerId];
  if (!provider || typeof provider.search !== "function") return { provider: providerId, results: [], skipped: true };
  const raw = await provider.search(client.ctx(providerId), query, opts);
  const list = Array.isArray(raw) ? raw : [];
  return { provider: providerId, results: list.map((c) => resultFrom(c, providerId)) };
}

// Dedupe results by id overlap or matching slug; unify sources.
export function dedupeResults(results) {
  const effectiveSlug = (item) =>
    item.slug
      ? slugify(item.slug)
      : item.titles && item.titles.romaji
        ? slugify(item.titles.romaji)
        : null;
  const merged = [];
  for (const item of results) {
    const itemSlug = effectiveSlug(item);
    let target = null;
    for (const existing of merged) {
      if (overlaps(existing.ids, item.ids)) {
        target = existing;
        break;
      }
      const existingSlug = effectiveSlug(existing);
      if (itemSlug && existingSlug && itemSlug === existingSlug) {
        target = existing;
        break;
      }
    }
    if (!target) {
      merged.push(Object.assign({}, item, { sources: [item.provider] }));
      continue;
    }
    for (const key of Object.keys(item.ids)) {
      if (target.ids[key] == null) target.ids[key] = item.ids[key];
    }
    if (!target.titles.romaji && item.titles.romaji) target.titles.romaji = item.titles.romaji;
    if (!target.titles.english && item.titles.english) target.titles.english = item.titles.english;
    if (!target.titles.native && item.titles.native) target.titles.native = item.titles.native;
    if (!target.year && item.year) target.year = item.year;
    if (!target.synopsis && item.synopsis) target.synopsis = item.synopsis;
    if (!target.image && item.image) target.image = item.image;
    if (!target.slug && item.slug) target.slug = item.slug;
    if (!target.rating && item.rating) target.rating = item.rating;
    if (target.sources.indexOf(item.provider) < 0) target.sources.push(item.provider);
    if (!target.slug && item.slug) target.slug = item.slug;
  }
  return merged;
}

export async function search(client, query, opts = {}) {
  const started = client.clock.now();
  const providers = planProviders(client, SEARCH_PROVIDERS, opts);
  const errors = [];
  const gather = [];

  // Fan out to every provider at once.
  const settled = await Promise.all(
    providers.map(async (providerId) => {
      try {
        return await searchOne(client, providerId, query, opts);
      } catch (err) {
        return { provider: providerId, results: [], error: pickError(err, providerId) };
      }
    })
  );
  for (const item of settled) {
    if (item.error) errors.push(item.error);
    for (const result of item.results) gather.push(result);
  }
  const merged = dedupeResults(gather);
  if (opts.resolve) {
    const { findById } = await import("./find.js");
    for (let i = 0; i < merged.length; i++) {
      try {
        merged[i].anime = await findById(client, merged[i].ids, { include: opts.include });
      } catch (err) {
        /* keep the search result without the full record */
      }
    }
  }
  return {
    results: merged.slice(0, opts.limit || 20),
    errors,
    meta: metaOf(client, started, { providersQueried: providers }),
  };
}

// Stream results provider-by-provider as they arrive.
export async function* searchAll(client, query, opts = {}) {
  const providers = planProviders(client, SEARCH_PROVIDERS, opts);
  const pending = new Set(
    providers.map(async (providerId) => {
      try {
        const res = await searchOne(client, providerId, query, opts);
        return { provider: providerId, results: dedupeResults(res.results), skipped: !!res.skipped };
      } catch (err) {
        return { provider: providerId, results: [], error: pickError(err, providerId) };
      }
    })
  );
  while (pending.size) {
    const settled = await Promise.race(
      Array.from(pending).map((p) => p.then((value) => ({ p, value })))
    );
    pending.delete(settled.p);
    yield settled.value;
  }
}
