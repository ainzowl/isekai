// Merge provider partials into one canonical record; mergeDefaults is public.

import { slugify } from "./ids.js";

export const mergeDefaults = Object.freeze({
  scalar: Object.freeze({
    type: Object.freeze(["anilist", "jikan", "kitsu", "tmdb", "animap"]),
    status: Object.freeze(["anilist", "jikan", "kitsu", "tmdb", "animap"]),
    episodes: Object.freeze(["jikan", "anilist", "kitsu", "tmdb", "animap"]),
    durationSec: Object.freeze(["jikan", "anilist", "kitsu", "tmdb", "animap"]),
    synopsis: Object.freeze(["anilist", "jikan", "kitsu", "tmdb"]),
    isAdult: Object.freeze(["anilist", "jikan", "kitsu"]),
    contentRating: Object.freeze(["jikan", "anilist"]),
    sourceMaterial: Object.freeze(["anilist", "jikan"]),
    nextEpisode: Object.freeze(["anilist", "jikan"]),
  }),
  titles: Object.freeze({
    romaji: Object.freeze(["jikan", "anilist", "kitsu", "tmdb", "animap"]),
    english: Object.freeze(["jikan", "anilist", "kitsu", "tmdb"]),
    native: Object.freeze(["jikan", "anilist", "kitsu", "tmdb"]),
  }),
  primaryTitle: Object.freeze(["romaji", "english", "native"]),
  providers: Object.freeze(["jikan", "anilist", "kitsu", "tmdb", "animap"]),
});

function priorityIndex(provider, list) {
  const i = list.indexOf(provider);
  return i === -1 ? list.length : i;
}

function withPreferred(list, preferred) {
  if (!preferred || list.indexOf(preferred) < 0) return list;
  return [preferred].concat(list.filter((entry) => entry !== preferred));
}

function orderedParts(parts, list) {
  return parts.slice().sort((a, b) => priorityIndex(a.provider, list) - priorityIndex(b.provider, list));
}

function pickScalar(parts, field, order) {
  const candidates = order
    ? order.map((provider) => parts.find((p) => p.provider === provider)).filter(Boolean)
    : parts;
  for (const part of candidates) {
    if (part.data[field] != null) return { value: part.data[field], provider: part.provider };
  }
  return { value: null, provider: null };
}

function pickNested(parts, section, field, order) {
  const candidates = order
    ? order.map((provider) => parts.find((p) => p.provider === provider)).filter(Boolean)
    : parts;
  for (const part of candidates) {
    const holder = part.data[section];
    if (holder && holder[field] != null) return { value: holder[field], provider: part.provider };
  }
  return { value: null, provider: null };
}

function pickObject(ordered, field) {
  const out = {};
  let provider = null;
  for (const part of ordered) {
    const obj = part.data[field];
    if (!obj || typeof obj !== "object") continue;
    for (const key of Object.keys(obj)) {
      if (out[key] == null && obj[key] != null) {
        out[key] = obj[key];
        if (!provider) provider = part.provider;
      }
    }
  }
  return { value: Object.keys(out).length ? out : null, provider };
}

function unionArrays(ordered, field) {
  const seen = new Set();
  const out = [];
  const sources = [];
  for (const part of ordered) {
    const arr = part.data[field];
    if (!Array.isArray(arr)) continue;
    let used = false;
    for (const item of arr) {
      const key = typeof item === "string" ? item.toLowerCase() : JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      used = true;
    }
    if (used) sources.push(part.provider);
  }
  return { value: out, sources };
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeIds(ordered) {
  const ids = {};
  for (const part of ordered) {
    const source = part.data.ids;
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const value = source[key];
      if (value == null) continue;
      if (key === "tmdb" && typeof value === "object") {
        const tmdb = ids.tmdb || (ids.tmdb = {});
        if (value.tv != null && tmdb.tv == null) tmdb.tv = value.tv;
        if (value.movie != null && tmdb.movie == null) tmdb.movie = value.movie;
      } else if (ids[key] == null) {
        ids[key] = value;
      }
    }
  }
  return ids;
}

function mergeImages(ordered) {
  const kinds = { posters: [], banners: [], logos: [], thumbnails: [], stills: [] };
  for (const part of ordered) {
    const images = part.data.images;
    if (!images) continue;
    for (const kind of Object.keys(kinds)) {
      const list = images[kind];
      if (!Array.isArray(list)) continue;
      for (const image of list) {
        if (!image || !image.url) continue;
        kinds[kind].push(Object.assign({ kind: kind.replace(/s$/, "") }, image, { source: image.source || part.provider }));
      }
    }
  }
  for (const kind of Object.keys(kinds)) {
    kinds[kind] = dedupeBy(kinds[kind], (i) => i.url);
  }
  return kinds;
}

function mergeLinks(ordered) {
  let official = null;
  const streaming = [];
  const external = [];
  for (const part of ordered) {
    const links = part.data.links;
    if (!links) continue;
    if (official == null && links.official) official = links.official;
    for (const s of links.streaming || []) {
      const existing = streaming.find((x) => x.service === s.service && x.url === s.url);
      if (!existing) streaming.push(Object.assign({ source: part.provider }, s));
      else {
        if (existing.dub == null && s.dub != null) existing.dub = s.dub;
        if (existing.subs == null && s.subs != null) existing.subs = s.subs;
        if (!existing.region && s.region) existing.region = s.region;
      }
    }
    for (const e of links.external || []) {
      if (!external.some((x) => x.url === e.url)) external.push(e);
    }
  }
  return { official, streaming, external };
}

function mergeRelations(ordered) {
  const all = [];
  for (const part of ordered) {
    for (const rel of part.data.relations || []) {
      all.push(Object.assign({ source: part.provider }, rel));
    }
  }
  return dedupeBy(all, (r) => {
    const ids = r.ids ? JSON.stringify(r.ids) : "";
    return (r.type || "") + "|" + ids + "|" + (r.title || "");
  });
}

function firstArray(ordered, field) {
  for (const part of ordered) {
    if (Array.isArray(part.data[field]) && part.data[field].length) return part.data[field];
  }
  return null;
}

export function mergeAnime(parts, opts = {}) {
  const defaultSource = opts.defaultSource || null;
  const providerOrder = withPreferred(opts.providers || mergeDefaults.providers, defaultSource);
  const baseTable = Object.assign({}, mergeDefaults.scalar, opts.mergeDefaults || {});
  const scalarTable = {};
  for (const field of Object.keys(baseTable)) scalarTable[field] = withPreferred(baseTable[field], defaultSource);
  const ordered = orderedParts(parts.filter((p) => p && p.data), providerOrder);

  const ids = mergeIds(ordered);
  const fieldSources = {};

  const titles = { synonyms: [], localized: {} };
  for (const key of Object.keys(mergeDefaults.titles)) {
    const picked = pickNested(ordered, "titles", key, withPreferred(mergeDefaults.titles[key], defaultSource));
    if (picked.value != null) titles[key] = picked.value;
    fieldSources["titles." + key] = picked.provider;
  }
  const synonyms = unionArrays(ordered, "synonymTitles");
  if (synonyms.value.length) titles.synonyms = synonyms.value;
  for (const part of ordered) {
    const localized = part.data.titles && part.data.titles.localized;
    if (!localized) continue;
    for (const lang of Object.keys(localized)) {
      if (titles.localized[lang] == null && localized[lang] != null) titles.localized[lang] = localized[lang];
    }
  }

  const anime = { ids, titles };

  const slugPick = pickScalar(ordered, "slug");
  let slug = slugPick.value;
  if (!slug) {
    for (const key of mergeDefaults.primaryTitle) {
      if (titles[key]) {
        slug = slugify(titles[key]);
        if (slug) break;
      }
    }
  }
  anime.slug = slug || null;
  const nativeSlugs = {};
  for (const part of ordered) {
    const map = part.data.slugs;
    if (!map) continue;
    for (const key of Object.keys(map)) {
      if (nativeSlugs[key] == null && map[key] != null) nativeSlugs[key] = map[key];
    }
  }
  if (slugPick.provider === "kitsu") nativeSlugs.kitsu = slugPick.value;
  anime.slugs = nativeSlugs;

  for (const field of Object.keys(scalarTable)) {
    const picked = pickScalar(ordered, field, scalarTable[field]);
    anime[field] = picked.value;
    fieldSources[field] = picked.provider;
  }
  const aired = pickObject(ordered, "aired");
  anime.aired = aired.value;
  fieldSources.aired = aired.provider;
  const season = pickObject(ordered, "season");
  anime.season = season.value;
  fieldSources.season = season.provider;

  for (const field of ["genres", "themes", "tags", "studios", "producers", "licensors"]) {
    anime[field] = unionArrays(ordered, field).value;
  }

  const ratings = {};
  for (const part of ordered) {
    if (part.data.ratings) ratings[part.provider] = part.data.ratings[part.provider] || part.data.ratings;
  }
  anime.ratings = ratings;

  // shogo score: the average of every provider score, normalized to 0-10.
  const scored = [];
  for (const provider of Object.keys(ratings)) {
    const rating = ratings[provider];
    if (!rating || rating.score == null) continue;
    const scale = rating.scale || 10;
    if (!(scale > 0)) continue;
    const normalized = (rating.score / scale) * 10;
    if (normalized >= 0 && normalized <= 10) scored.push({ provider: provider, normalized: normalized });
  }
  if (scored.length) {
    let sum = 0;
    const breakdown = {};
    for (const entry of scored) {
      sum += entry.normalized;
      breakdown[entry.provider] = Math.round(entry.normalized * 100) / 100;
    }
    anime.score = {
      value: Math.round((sum / scored.length) * 100) / 100,
      scale: 10,
      providers: scored.length,
      breakdown: breakdown,
    };
  } else {
    anime.score = null;
  }

  anime.links = mergeLinks(ordered);
  anime.images = mergeImages(ordered);
  anime.relations = mergeRelations(ordered);
  anime.sources = ordered.map((p) => p.provider);

  const characters = firstArray(ordered, "characters");
  if (characters) anime.characters = characters;
  const staff = firstArray(ordered, "staff");
  if (staff) anime.staff = staff;
  const recommendations = firstArray(ordered, "recommendations");
  if (recommendations) anime.recommendations = recommendations;
  const episodes = firstArray(ordered, "episodes");
  if (episodes) anime.episodesList = episodes;

  anime.fieldSources = fieldSources;
  return anime;
}
