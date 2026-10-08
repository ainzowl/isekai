// Kitsu: keyless metadata, episodes with thumbnails, streaming flags, id
// mappings and native slugs (filter[slug]).

const BASE = "https://kitsu.io/api/edge";

const SITE_IDS = {
  "myanimelist/anime": "mal",
  "anilist/anime": "anilist",
  anidb: "anidb",
  thetvdb: "tvdb",
  "thetvdb/series": "tvdb",
  trakt: "trakt",
  imdb: "imdb",
};

function normalizeType(subtype) {
  if (!subtype) return null;
  const t = String(subtype).toLowerCase();
  if (t === "tv") return "TV";
  if (t === "movie") return "MOVIE";
  if (t === "ova") return "OVA";
  if (t === "ona") return "ONA";
  if (t === "special") return "SPECIAL";
  if (t === "music") return "MUSIC";
  return "UNKNOWN";
}

function normalizeStatus(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s === "current") return "RELEASING";
  if (s === "finished") return "FINISHED";
  if (s === "tba") return "NOT_YET_RELEASED";
  if (s === "upcoming" || s === "unreleased") return "NOT_YET_RELEASED";
  return "UNKNOWN";
}

function imageSet(poster, cover) {
  const posters = [];
  if (poster) {
    posters.push({
      url: poster.original || poster.large || poster.medium,
      thumbUrl: poster.small || poster.tiny || poster.medium,
      width: poster.meta && poster.meta.dimensions ? poster.meta.dimensions.width : undefined,
      height: poster.meta && poster.meta.dimensions ? poster.meta.dimensions.height : undefined,
      source: "kitsu",
    });
  }
  const banners = [];
  if (cover) {
    banners.push({
      url: cover.original || cover.large,
      thumbUrl: cover.small || cover.large,
      source: "kitsu",
    });
  }
  return { posters, banners, logos: [], thumbnails: [], stills: [] };
}

function hostService(url) {
  try {
    const host = String(url).replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length > 1 ? parts[parts.length - 2] : host;
  } catch (err) {
    return "unknown";
  }
}

function indexIncluded(included) {
  const map = {};
  for (const item of included || []) {
    map[item.type + ":" + item.id] = item;
  }
  return map;
}

export function mappingIdsFrom(mappings) {
  const ids = {};
  for (const m of mappings || []) {
    const key = SITE_IDS[m.externalSite];
    if (!key || m.externalId == null) continue;
    if (key === "imdb") ids.imdb = "tt" + String(m.externalId).replace(/^tt/, "");
    else ids[key] = Number(m.externalId);
  }
  return ids;
}

export function normalizeAnime(d, included) {
  if (!d || !d.attributes) return null;
  const a = d.attributes;
  const includedMap = indexIncluded(included);
  const mappings = [d, ...(included || [])]
    .filter((x) => x.type === "mappings")
    .map((x) => x.attributes)
    .filter(Boolean);
  const ids = Object.assign({ kitsu: Number(d.id) }, mappingIdsFrom(mappings));

  const streaming = [];
  for (const item of included || []) {
    if (item.type !== "streamingLinks" || !item.attributes) continue;
    streaming.push({
      service: hostService(item.attributes.url),
      url: item.attributes.url,
      dub: item.attributes.dubs != null ? !!item.attributes.dubs : null,
      subs: item.attributes.subs != null ? !!item.attributes.subs : null,
      region: item.attributes.language ? [String(item.attributes.language).toUpperCase()] : null,
      source: "kitsu",
    });
  }

  const tags = [];
  for (const item of Object.keys(includedMap)) {
    if (item.indexOf("categories:") === 0 && includedMap[item].attributes) {
      tags.push(includedMap[item].attributes.title);
    }
  }

  const titles = {
    romaji: a.titles && a.titles.en_jp ? a.titles.en_jp : a.canonicalTitle || undefined,
    english: a.titles && a.titles.en ? a.titles.en : undefined,
    native: a.titles && a.titles.ja_jp ? a.titles.ja_jp : undefined,
  };

  return {
    ids,
    titles,
    synonymTitles: Array.isArray(a.synonyms) ? a.synonyms : [],
    slug: a.slug || null,
    slugs: a.slug ? { kitsu: a.slug } : {},
    type: normalizeType(a.subtype),
    status: normalizeStatus(a.status),
    episodes: a.episodeCount != null ? Number(a.episodeCount) : null,
    durationSec: a.episodeLength != null ? Number(a.episodeLength) * 60 : null,
    aired:
      a.startDate || a.endDate
        ? { from: a.startDate ? a.startDate + "T00:00:00.000Z" : null, to: a.endDate ? a.endDate + "T00:00:00.000Z" : null }
        : null,
    synopsis: a.synopsis || null,
    isAdult: a.ageRating ? a.ageRating === "R18" || a.ageRating === "R" : null,
    contentRating: a.ageRating || null,
    tags,
    ratings: {
      kitsu: {
        score: a.averageRating != null ? Number(a.averageRating) : null,
        scale: 100,
        rank: a.ratingRank != null ? Number(a.ratingRank) : null,
        popularity: a.popularityRank != null ? Number(a.popularityRank) : null,
        members: a.userCount != null ? Number(a.userCount) : null,
        favorites: a.favoritesCount != null ? Number(a.favoritesCount) : null,
      },
    },
    links: { official: null, streaming, external: [] },
    images: imageSet(a.posterImage, a.coverImage),
  };
}

export default {
  id: "kitsu",
  requiresKey: false,
  capabilities: {
    metadata: true, search: true, episodes: true, cast: false, relations: false,
    recommendations: false, schedule: false, images: true, screenshots: true,
    skips: false, mapping: true, slug: true,
  },
  defaults: { baseUrl: BASE, rate: { perSec: 5 } },

  async byId(ctx, kitsuId, opts = {}) {
    const res = await ctx.http.get(
      "kitsu",
      ctx.baseUrl + "/anime/" + kitsuId + "?include=mappings,streamingLinks,categories",
      { ttl: ctx.ttl.anime, signal: opts.signal }
    );
    const root = res.data && res.data.data;
    return normalizeAnime(root, (res.data && res.data.included) || []);
  },

  async bySlug(ctx, slug, opts = {}) {
    const res = await ctx.http.get(
      "kitsu",
      ctx.baseUrl + "/anime?filter[slug]=" + encodeURIComponent(slug) + "&page[limit]=1&include=mappings",
      { ttl: ctx.ttl.anime, signal: opts.signal }
    );
    const list = (res.data && res.data.data) || [];
    if (!list.length) return null;
    return normalizeAnime(list[0], (res.data && res.data.included) || []);
  },

  async search(ctx, query, opts = {}) {
    const limit = Math.min(opts.limit || 10, 20); // Kitsu rejects page[limit] > 20
    const res = await ctx.http.get(
      "kitsu",
      ctx.baseUrl + "/anime?filter[text]=" + encodeURIComponent(query) + "&page[limit]=" + limit,
      { ttl: ctx.ttl.search, signal: opts.signal }
    );
    return ((res.data && res.data.data) || []).map((d) => normalizeAnime(d)).filter(Boolean);
  },

  async mappings(ctx, kitsuId, opts = {}) {
    const res = await ctx.http.get("kitsu", ctx.baseUrl + "/anime/" + kitsuId + "/mappings?page[limit]=20", {
      ttl: ctx.ttl.idMap,
      signal: opts.signal,
    });
    return mappingIdsFrom(((res.data && res.data.data) || []).map((m) => m.attributes));
  },

  async episodes(ctx, kitsuId, opts = {}) {
    const out = [];
    const maxPages = opts.maxPages != null ? opts.maxPages : 3;
    const limit = Math.min(opts.limit || 20, 20); // Kitsu rejects page[limit] > 20
    const offset = Math.max(0, Number(opts.offset) || 0);
    const startPage = Math.floor(offset / limit);
    let total = null;
    for (let page = startPage; page < startPage + maxPages; page++) {
      const res = await ctx.http.get(
        "kitsu",
        ctx.baseUrl + "/anime/" + kitsuId + "/episodes?page[limit]=" + limit + "&page[offset]=" + page * limit,
        { ttl: ctx.ttl.episodes, signal: opts.signal }
      );
      const body = res.data || {};
      const data = body.data || [];
      const meta = body.meta || {};
      if (meta.count != null) total = Number(meta.count);
      for (const ep of data) {
        const a = ep.attributes || {};
        const thumb = a.thumbnail;
        out.push({
          number: a.number != null ? Number(a.number) : null,
          title: a.canonicalTitle || null,
          airedAt: a.airdate || null,
          durationSec: a.length != null ? Number(a.length) * 60 : null,
          synopsis: a.synopsis || null,
          images: thumb
            ? [
                {
                  kind: "thumbnail",
                  url: thumb.original || thumb.url,
                  thumbUrl: thumb.small || thumb.medium || thumb.url,
                  source: "kitsu",
                },
              ]
            : [],
          sources: ["kitsu"],
        });
      }
      if (data.length < limit) break;
    }
    if (total != null) {
      out.total = total;
      out.truncated = offset + out.length < total;
    }
    return out;
  },
};
