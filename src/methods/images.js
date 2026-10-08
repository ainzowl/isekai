// images()/screenshots(): merge image material from every provider that has it.

import { resolveIds } from "./map.js";
import { applySelectors, metaOf, pickError } from "./common.js";

const KINDS = ["posters", "banners", "logos", "thumbnails", "stills"];

function empty() {
  const out = {};
  for (const kind of KINDS) out[kind] = [];
  return out;
}

function mergeKinds(target, incoming) {
  if (!incoming) return;
  for (const kind of KINDS) {
    const list = incoming[kind];
    if (!Array.isArray(list)) continue;
    for (const image of list) {
      if (!image || !image.url) continue;
      if (!target[kind].some((x) => x.url === image.url)) target[kind].push(image);
    }
  }
}

async function idsForRef(client, parsed, opts) {
  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) return null;
    return match.best.ids;
  }
  return parsed.ids;
}

export async function images(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new Error("No ids resolved for " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = [];
  const sources = [];
  const out = empty();

  const tasks = [];
  if (ids.mal != null && client.isConfigured("jikan")) {
    tasks.push(async () => {
      const data = await client.registry.jikan.images(client.ctx("jikan"), ids.mal, opts);
      sources.push("jikan");
      return data;
    });
  }
  if (ids.anilist != null && client.isConfigured("anilist")) {
    tasks.push(async () => {
      const data = await client.registry.anilist.images(client.ctx("anilist"), ids.anilist, opts);
      sources.push("anilist");
      return data;
    });
  }
  if (ids.kitsu != null && client.isConfigured("kitsu")) {
    tasks.push(async () => {
      const canvas = await client.registry.kitsu.byId(client.ctx("kitsu"), ids.kitsu, opts);
      sources.push("kitsu");
      return (canvas && canvas.images) || empty();
    });
  }
  if (ids.tmdb != null && client.isConfigured("tmdb") && (ids.tmdb.tv != null || ids.tmdb.movie != null)) {
    tasks.push(async () => {
      const type = ids.tmdb.tv != null ? "tv" : "movie";
      const id = type === "tv" ? ids.tmdb.tv : ids.tmdb.movie;
      const data = await client.registry.tmdb.images(client.ctx("tmdb"), { id, type }, opts);
      sources.push("tmdb");
      return data;
    });
  }
  if (ids.animeplanet && ids.mal != null) {
    // animap supplies a poster for anime-planet-keyed records via its canvas
    tasks.push(async () => {
      const canvas = await client.registry.animap.byId(client.ctx("animap"), { service: "mal", id: ids.mal }, opts);
      sources.push("animap");
      return (canvas && canvas.images) || empty();
    });
  }

  const settled = await Promise.all(
    tasks.map((task) =>
      task().then(
        (data) => ({ data }),
        (err) => ({ error: err })
      )
    )
  );
  for (const item of settled) {
    if (item.error) errors.push(pickError(item.error));
    if (item.data) mergeKinds(out, item.data);
  }

  const result = Object.assign(out, { sources, errors, skipped: [], meta: metaOf(client, started) });
  return applySelectors(result, opts);
}

export async function screenshots(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new Error("No ids resolved for " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = [];
  const out = [];
  const sources = [];
  const season = opts.season != null ? opts.season : 1;

  if (ids.tmdb != null && client.isConfigured("tmdb") && ids.tmdb.tv != null && opts.number != null) {
    try {
      const stills = await client.registry.tmdb.screenshots(
        client.ctx("tmdb"),
        { id: ids.tmdb.tv, type: "tv" },
        { season, number: opts.number, signal: opts.signal }
      );
      for (const still of stills) out.push(still);
      sources.push("tmdb");
    } catch (err) {
      errors.push(pickError(err, "tmdb"));
    }
  }

  if (!out.length && ids.kitsu != null && client.isConfigured("kitsu")) {
    try {
      const list = await client.registry.kitsu.episodes(client.ctx("kitsu"), ids.kitsu, opts);
      const match = list.find((e) => opts.number != null && String(e.number) === String(opts.number));
      for (const image of (match && match.images) || []) out.push(image);
      if (out.length) sources.push("kitsu");
    } catch (err) {
      errors.push(pickError(err, "kitsu"));
    }
  }

  const result = { images: out, sources, errors, skipped: [], meta: metaOf(client, started) };
  return applySelectors(result, opts);
}
