// catalog(): titles <-> isekai ids from an offline animap snapshot or live Jikan.

import { slugify, toIsekai, fromIsekai } from "../core/ids.js";
import { parseSources } from "../providers/animap.js";
import { metaOf } from "./common.js";
import { scoreCandidate } from "./identify.js";

function entryFromRecord(record) {
  const ids = parseSources(record && record.sources);
  const title = record && record.title;
  let isekaiId = null;
  try {
    if (ids.mal != null || ids.anilist != null || ids.kitsu != null) {
      isekaiId = toIsekai({ mal: ids.mal, anilist: ids.anilist, kitsu: ids.kitsu });
    }
  } catch (err) {
    isekaiId = null;
  }
  return {
    isekaiId,
    slug: title ? slugify(title) : null,
    mal: ids.mal != null ? ids.mal : null,
    anilist: ids.anilist != null ? ids.anilist : null,
    kitsu: ids.kitsu != null ? ids.kitsu : null,
    titles: { romaji: title || undefined },
    synonyms: record && Array.isArray(record.synonyms) ? record.synonyms : [],
    type: record ? record.type || null : null,
    year: record && record.animeSeason && record.animeSeason.year != null ? record.animeSeason.year : null,
    episodes: record && record.episodes != null ? record.episodes : null,
    sources: ["animap"],
  };
}

async function entryFromJikan(d) {
  return {
    isekaiId: d.mal_id != null ? toIsekai({ mal: Number(d.mal_id) }) : null,
    slug: slugify(d.title || ""),
    mal: d.mal_id != null ? Number(d.mal_id) : null,
    anilist: null,
    kitsu: null,
    titles: { romaji: d.title || undefined, english: d.title_english || undefined },
    synonyms: d.title_synonyms || [],
    type: d.type || null,
    year: d.year != null ? Number(d.year) : null,
    episodes: d.episodes != null ? Number(d.episodes) : null,
    sources: ["jikan"],
  };
}

function buildIndex(entries, source) {
  const bySlug = new Map();
  const byId = new Map();
  for (const entry of entries) {
    if (entry.slug && !bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
    if (entry.isekaiId) byId.set(String(entry.isekaiId), entry);
    for (const key of ["mal", "anilist", "kitsu"]) {
      if (entry[key] != null) byId.set(key + ":" + entry[key], entry);
    }
  }

  return {
    source,
    size: entries.length,
    entries,
    async *list() {
      for (const entry of entries) yield entry;
    },
    search(name, opts = {}) {
      const querySlug = slugify(name);
      const scored = [];
      for (const entry of entries) {
        const titles = [entry.titles.romaji, entry.titles.english].concat(entry.synonyms || []);
        let best = { score: 0 };
        let bestTitle = null;
        for (const title of titles) {
          if (!title) continue;
          const candidate = { titles: { romaji: title }, slug: entry.slug };
          const result = scoreCandidate(querySlug, candidate, opts.hint);
          if (result.score > best.score) {
            best = result;
            bestTitle = title;
          }
        }
        if (best.score > 0.3) scored.push(Object.assign({}, entry, { confidence: best.score, reasons: best.reasons, matchedTitle: bestTitle }));
      }
      scored.sort((a, b) => b.confidence - a.confidence);
      return scored.slice(0, opts.limit || 20);
    },
    bySlug(slug) {
      const clean = slugify(slug);
      return bySlug.get(clean) || null;
    },
    byIsekaiId(value) {
      const direct = byId.get(String(value));
      if (direct) return direct;
      const ids = fromIsekai(value);
      if (!ids) return null;
      for (const key of ["mal", "anilist", "kitsu"]) {
        if (ids[key] != null) {
          const hit = byId.get(key + ":" + ids[key]);
          if (hit) return hit;
        }
      }
      return null;
    },
  };
}

export async function catalog(client, opts = {}) {
  const started = client.clock.now();
  const source = opts.source || (client.offline.loaded ? "snapshot" : "live");
  const errors = [];
  let entries = [];

  if (source === "snapshot") {
    if (!client.offline.loaded) throw new Error("No offline snapshot loaded; call isekai.offline.load(json) first (or use { source: 'live' })");
    for (const record of client.offline.records()) {
      const entry = entryFromRecord(record);
      if (entry.slug) entries.push(entry);
    }
  } else {
    if (!client.isConfigured("jikan")) throw new Error("Live catalog needs Jikan (it is keyless and enabled by default)");
    const ctx = client.ctx("jikan");
    const maxPages = opts.maxPages != null ? opts.maxPages : 5;
    const limit = opts.limit || 25;
    for (let page = 1; page <= maxPages; page++) {
      const res = await client.http.get(
        "jikan",
        ctx.baseUrl + "/anime?order_by=mal_id&sort=asc&limit=" + limit + "&page=" + page,
        { ttl: client.ttl.search, signal: opts.signal }
      );
      const data = res.data || {};
      for (const d of data.data || []) entries.push(await entryFromJikan(d));
      const pagination = data.pagination;
      if (!pagination || !pagination.has_next_page) break;
    }
  }

  const built = buildIndex(entries, source === "snapshot" ? client.offline.source : "jikan-live");
  client._catalog = built;
  return Object.assign(built, { errors, meta: metaOf(client, started) });
}
