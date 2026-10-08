// relations()/franchise()/recommendations()/schedule() and cast helpers.

import { NotFoundError } from "../core/errors.js";
import { resolveIds } from "./map.js";
import { applySelectors, keyOf, metaOf, pickError } from "./common.js";

const GROUPS = {
  SEQUEL: "sequel",
  PREQUEL: "prequel",
  SIDE_STORY: "sideStory",
  SPIN_OFF: "spinOff",
  ALTERNATIVE: "alternative",
  PARENT: "parent",
  SUMMARY: "summary",
  CHARACTER: "character",
  OTHER: "other",
};

async function idsForRef(client, parsed, opts) {
  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) return null;
    return match.best.ids;
  }
  return parsed.ids;
}

async function gatherRelations(client, ids, opts, errors, sources) {
  const tasks = [];
  if (ids.anilist != null && client.isConfigured("anilist")) {
    tasks.push(async () => ({
      provider: "anilist",
      list: ((await client.registry.anilist.byId(client.ctx("anilist"), ids.anilist, opts)) || {}).relations || [],
    }));
  }
  if (ids.mal != null && client.isConfigured("jikan")) {
    tasks.push(async () => ({
      provider: "jikan",
      list: await client.registry.jikan.relations(client.ctx("jikan"), ids.mal, opts),
    }));
  }

  const settled = await Promise.all(tasks.map((task) => task().then((value) => ({ value }), (error) => ({ error }))));
  const out = [];
  for (const item of settled) {
    if (item.error) {
      errors.push(pickError(item.error));
      continue;
    }
    sources.push(item.value.provider);
    for (const rel of item.value.list) out.push(rel);
  }
  const deduped = [];
  for (const rel of out) {
    const key = (rel.type || "") + "|" + keyOf(rel.ids || {}) + "|" + (rel.title || "");
    if (!deduped.some((x) => x.key === key)) deduped.push(Object.assign({ key }, rel));
  }
  return deduped;
}

export async function relations(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for relations(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = resolved.errors.slice();
  const sources = [];
  const list = await gatherRelations(client, ids, opts, errors, sources);

  const grouped = { sequel: [], prequel: [], sideStory: [], spinOff: [], alternative: [], parent: [], summary: [], character: [], other: [] };
  for (const rel of list) {
    const group = GROUPS[rel.type] || "other";
    grouped[group].push({ ids: rel.ids || {}, title: rel.title || null, format: rel.format || null, sources: rel.sources || [] });
  }
  grouped.all = list.map((rel) => ({ type: rel.type, ids: rel.ids || {}, title: rel.title || null, format: rel.format || null }));

  const result = Object.assign(grouped, {
    ids,
    sources,
    errors,
    skipped: resolved.skipped,
    meta: metaOf(client, started, { providersQueried: sources }),
  });
  return applySelectors(result, opts);
}

export async function franchise(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for franchise(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = resolved.errors.slice();
  const sources = [];
  const list = await gatherRelations(client, ids, opts, errors, sources);

  const chain = [{ ids, title: null, current: true }];
  for (const rel of list) {
    if (rel.type !== "SEQUEL" && rel.type !== "PREQUEL" && rel.type !== "PARENT") continue;
    chain.push({ ids: rel.ids || {}, title: rel.title || null, relation: rel.type, current: false });
  }
  const ordered = chain.slice().sort((a, b) => {
    const aId = (a.ids && (a.ids.mal || a.ids.anilist)) || 0;
    const bId = (b.ids && (b.ids.mal || b.ids.anilist)) || 0;
    return aId - bId;
  });
  ordered.forEach((entry, i) => {
    entry.order = i + 1;
  });
  ordered.sources = sources;
  ordered.errors = errors;
  ordered.meta = metaOf(client, started, { providersQueried: sources });
  return ordered;
}

export async function recommendations(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for recommendations(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = resolved.errors.slice();
  const skipped = resolved.skipped.slice();
  let list = null;
  const sources = [];

  if (ids.anilist != null && client.isConfigured("anilist")) {
    try {
      list = await client.registry.anilist.recommendations(client.ctx("anilist"), ids.anilist, opts);
      sources.push("anilist");
    } catch (err) {
      errors.push(pickError(err, "anilist"));
    }
  }
  if (list == null && ids.mal != null && client.isConfigured("jikan")) {
    try {
      list = await client.registry.jikan.recommendations(client.ctx("jikan"), ids.mal, opts);
      sources.push("jikan");
    } catch (err) {
      errors.push(pickError(err, "jikan"));
    }
  }
  const result = {
    results: list || [],
    ids,
    sources,
    errors,
    skipped,
    meta: metaOf(client, started, { providersQueried: sources }),
  };
  return applySelectors(result, opts);
}

export async function schedule(client, opts = {}) {
  const started = client.clock.now();
  const errors = [];
  const sources = [];
  let list = [];

  if (opts.ref != null) {
    const { findById } = await import("./find.js");
    const anime = await findById(client, opts.ref, opts);
    return {
      results: anime.nextEpisode ? [{ ids: anime.ids, titles: anime.titles, nextEpisode: anime.nextEpisode }] : [],
      ids: anime.ids,
      sources: anime.sources || [],
      errors: anime.errors || [],
      skipped: anime.skipped || [],
      meta: metaOf(client, started),
    };
  }

  if (client.isConfigured("anilist")) {
    try {
      list = await client.registry.anilist.schedule(client.ctx("anilist"), opts);
      sources.push("anilist");
    } catch (err) {
      errors.push(pickError(err, "anilist"));
    }
  }
  if (!list.length && client.isConfigured("jikan")) {
    try {
      list = await client.registry.jikan.schedule(client.ctx("jikan"), opts);
      sources.push("jikan");
    } catch (err) {
      errors.push(pickError(err, "jikan"));
    }
  }
  return { results: list, sources, errors, skipped: [], meta: metaOf(client, started, { providersQueried: sources }) };
}

// Shared implementation for characters() and staff().
export async function people(client, ref, kind, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for " + kind + "(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = resolved.errors.slice();
  const skipped = resolved.skipped.slice();
  const same = kind === "characters";

  const attempts = [];
  if (ids.mal != null && client.isConfigured("jikan")) {
    attempts.push({ provider: "jikan", run: () => client.registry.jikan[kind](client.ctx("jikan"), ids.mal, opts) });
  }
  if (ids.anilist != null && client.isConfigured("anilist")) {
    attempts.push({ provider: "anilist", run: () => client.registry.anilist[kind](client.ctx("anilist"), ids.anilist, opts) });
  }

  const settled = await Promise.all(
    attempts.map(async (attempt) => {
      try {
        return { provider: attempt.provider, list: (await attempt.run()) || [] };
      } catch (err) {
        return { provider: attempt.provider, error: err };
      }
    })
  );

  for (const item of settled) {
    if (item.error) {
      errors.push(pickError(item.error, item.provider));
      continue;
    }
    if (item.list.length) {
      const output = item.list;
      output.ids = ids;
      output.sources = [item.provider];
      output.errors = errors;
      output.skipped = skipped;
      output.meta = metaOf(client, started, { providersQueried: [item.provider] });
      return output;
    }
    skipped.push({ provider: item.provider, reason: "not-found" });
  }
  const empty = [];
  empty.ids = ids;
  empty.sources = [];
  empty.errors = errors;
  empty.skipped = skipped;
  empty.meta = metaOf(client, started);
  void same;
  return empty;
}
