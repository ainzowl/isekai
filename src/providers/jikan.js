// Jikan (MyAnimeList): keyless MAL metadata, episodes, pictures, cast, schedule.

const BASE = "https://api.jikan.moe/v4";

function normalizeType(type) {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t.indexOf("tv special") >= 0 || t === "special") return "SPECIAL";
  if (t === "tv") return "TV";
  if (t === "movie") return "MOVIE";
  if (t === "ova") return "OVA";
  if (t === "ona") return "ONA";
  if (t === "music") return "MUSIC";
  return "UNKNOWN";
}

function normalizeStatus(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s.indexOf("finished") >= 0) return "FINISHED";
  if (s.indexOf("airing") >= 0) return "RELEASING";
  if (s.indexOf("not yet") >= 0) return "NOT_YET_RELEASED";
  return "UNKNOWN";
}

export function parseDuration(text) {
  if (!text || typeof text !== "string") return null;
  let total = 0;
  let found = false;
  const hr = /(\d+)\s*hr/i.exec(text);
  const min = /(\d+)\s*min/i.exec(text);
  const sec = /(\d+)\s*sec/i.exec(text);
  if (hr) {
    total += Number(hr[1]) * 3600;
    found = true;
  }
  if (min) {
    total += Number(min[1]) * 60;
    found = true;
  }
  if (sec) {
    total += Number(sec[1]);
    found = true;
  }
  return found ? total : null;
}

function imageOf(images) {
  if (!images) return null;
  const source = images.webp || images.jpg;
  if (!source) return null;
  return {
    url: source.large_image_url || source.image_url,
    thumbUrl: source.small_image_url || source.image_url,
    width: source.width || undefined,
    height: source.height || undefined,
  };
}

function serviceName(name) {
  if (!name) return "unknown";
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function relationType(relation) {
  const r = String(relation || "").toLowerCase();
  if (r === "sequel") return "SEQUEL";
  if (r === "prequel") return "PREQUEL";
  if (r === "side story") return "SIDE_STORY";
  if (r === "spin-off" || r === "spinoff") return "SPIN_OFF";
  if (r === "alternative") return "ALTERNATIVE";
  if (r === "parent story") return "PARENT";
  if (r === "summary") return "SUMMARY";
  if (r === "character") return "CHARACTER";
  return "OTHER";
}

export function normalizeAnime(d) {
  if (!d || d.mal_id == null) return null;
  const titles = {
    romaji: d.title || undefined,
    english: d.title_english || undefined,
    native: d.title_japanese || undefined,
  };
  const aired = d.aired && (d.aired.from || d.aired.to) ? { from: d.aired.from || null, to: d.aired.to || null } : null;
  const season =
    d.season && d.year ? { season: String(d.season).toUpperCase(), year: Number(d.year) } : null;
  const poster = imageOf(d.images);
  const score = d.score != null ? Number(d.score) : null;
  return {
    ids: { mal: Number(d.mal_id) },
    titles,
    synonymTitles: Array.isArray(d.title_synonyms) ? d.title_synonyms : [],
    type: normalizeType(d.type),
    status: normalizeStatus(d.status),
    episodes: d.episodes != null ? Number(d.episodes) : null,
    durationSec: parseDuration(d.duration),
    season,
    aired,
    synopsis: d.synopsis || null,
    isAdult: d.rating ? d.rating.indexOf("Rx") === 0 : null,
    contentRating: d.rating || null,
    genres: (d.genres || []).map((g) => g.name),
    themes: (d.themes || []).map((g) => g.name),
    studios: (d.studios || []).map((g) => g.name),
    producers: (d.producers || []).map((g) => g.name),
    licensors: (d.licensors || []).map((g) => g.name),
    ratings: {
      mal: {
        score,
        votes: d.scored_by != null ? Number(d.scored_by) : null,
        rank: d.rank != null ? Number(d.rank) : null,
        popularity: d.popularity != null ? Number(d.popularity) : null,
        members: d.members != null ? Number(d.members) : null,
        favorites: d.favorites != null ? Number(d.favorites) : null,
      },
    },
    links: {
      official: null,
      streaming: (d.streaming || []).map((s) => ({
        service: serviceName(s.name),
        url: s.url,
        dub: null,
        subs: null,
        region: null,
        source: "jikan",
      })),
      external: (d.external || []).map((e) => ({ service: serviceName(e.name), url: e.url, source: "jikan" })),
    },
    images: {
      posters: poster ? [poster] : [],
      banners: [],
      logos: [],
      thumbnails: [],
    },
    relations: (d.relations || []).reduce((acc, rel) => {
      for (const entry of rel.entry || []) {
        acc.push({
          type: relationType(rel.relation),
          ids: entry.mal_id != null ? { mal: Number(entry.mal_id) } : {},
          title: entry.name || null,
          format: normalizeType(entry.type),
        });
      }
      return acc;
    }, []),
  };
}

export default {
  id: "jikan",
  requiresKey: false,
  capabilities: {
    metadata: true, search: true, episodes: true, cast: true, relations: true,
    recommendations: true, schedule: true, images: true, screenshots: false,
    skips: false, mapping: false, slug: false,
  },
  defaults: { baseUrl: BASE, rate: { perSec: 3, perMin: 60 } },

  async byId(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/full", {
      ttl: ctx.ttl.anime,
      signal: opts.signal,
    });
    return normalizeAnime(res.data && res.data.data);
  },

  async search(ctx, query, opts = {}) {
    const limit = Math.min(opts.limit || 10, 25); // Jikan's max page size is 25
    const res = await ctx.http.get(
      "jikan",
      ctx.baseUrl + "/anime?q=" + encodeURIComponent(query) + "&limit=" + limit + "&sfw",
      { ttl: ctx.ttl.search, signal: opts.signal }
    );
    return (res.data && res.data.data ? res.data.data : []).map(normalizeAnime).filter(Boolean);
  },

  async episodes(ctx, malId, opts = {}) {
    const out = [];
    const maxPages = opts.maxPages != null ? opts.maxPages : 5;
    const offset = Math.max(0, Number(opts.offset) || 0);
    let page = 1;
    let total = null;
    for (; page <= 500; page++) {
      const res = await ctx.http.get(
        "jikan",
        ctx.baseUrl + "/anime/" + malId + "/episodes?page=" + page,
        { ttl: ctx.ttl.episodes, signal: opts.signal }
      );
      const data = res.data || {};
      const pagination = data.pagination || {};
      const items = pagination.items || {};
      if (items.total != null) total = Number(items.total);
      const perPage = items.per_page != null ? Number(items.per_page) : 100;
      const firstPage = 1 + Math.floor(offset / perPage);
      if (page >= firstPage) {
        for (const ep of data.data || []) {
          out.push({
            number: Number(ep.mal_id),
            title: ep.title || null,
            airedAt: ep.aired || null,
            isFiller: !!ep.filler,
            isRecap: !!ep.recap,
            sources: ["jikan"],
          });
        }
      }
      if (page - firstPage + 1 >= maxPages) break;
      if (!pagination.has_next_page) break;
    }
    if (total != null) {
      out.total = total;
      out.truncated = offset + out.length < total;
    }
    return out;
  },

  async characters(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/characters", {
      ttl: ctx.ttl.anime,
      signal: opts.signal,
    });
    return ((res.data && res.data.data) || []).map((entry) => ({
      ids: entry.character && entry.character.mal_id != null ? { mal: entry.character.mal_id } : {},
      name: (entry.character && entry.character.name) || null,
      image: imageUrl(entry.character && entry.character.images),
      role: String(entry.role || "").toUpperCase() || null,
      voiceActors: (entry.voice_actors || []).map((va) => ({
        name: va.person && va.person.name,
        language: va.language || null,
        image: imageUrl(va.person && va.person.images),
      })),
      sources: ["jikan"],
    }));
  },

  async staff(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/staff", {
      ttl: ctx.ttl.anime,
      signal: opts.signal,
    });
    return ((res.data && res.data.data) || []).map((entry) => ({
      ids: entry.person && entry.person.mal_id != null ? { mal: entry.person.mal_id } : {},
      name: (entry.person && entry.person.name) || null,
      image: imageUrl(entry.person && entry.person.images),
      positions: entry.positions || [],
      sources: ["jikan"],
    }));
  },

  async relations(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/relations", {
      ttl: ctx.ttl.anime,
      signal: opts.signal,
    });
    const out = [];
    for (const rel of (res.data && res.data.data) || []) {
      for (const entry of rel.entry || []) {
        out.push({
          type: relationType(rel.relation),
          ids: entry.mal_id != null ? { mal: Number(entry.mal_id) } : {},
          title: entry.name || null,
          format: normalizeType(entry.type),
          sources: ["jikan"],
        });
      }
    }
    return out;
  },

  async recommendations(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/recommendations", {
      ttl: ctx.ttl.anime,
      signal: opts.signal,
    });
    return ((res.data && res.data.data) || []).map((entry) => ({
      ids: entry.entry && entry.entry.mal_id != null ? { mal: Number(entry.entry.mal_id) } : {},
      titles: { romaji: (entry.entry && entry.entry.title) || undefined },
      image: imageUrl(entry.entry && entry.entry.images),
      votes: entry.votes != null ? Number(entry.votes) : null,
      sources: ["jikan"],
    }));
  },

  async schedule(ctx, opts = {}) {
    const query = opts.day ? "?filter=" + encodeURIComponent(String(opts.day).toLowerCase()) : "";
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/schedules" + query, {
      ttl: ctx.ttl.search,
      signal: opts.signal,
    });
    return ((res.data && res.data.data) || []).map((d) => ({
      ids: { mal: Number(d.mal_id) },
      titles: { romaji: d.title || undefined, english: d.title_english || undefined },
      type: normalizeType(d.type),
      episodes: d.episodes != null ? Number(d.episodes) : null,
      airingAt: d.aired && d.aired.from ? Date.parse(d.aired.from) / 1000 : null,
      sources: ["jikan"],
    }));
  },

  async images(ctx, malId, opts = {}) {
    const res = await ctx.http.get("jikan", ctx.baseUrl + "/anime/" + malId + "/pictures", {
      ttl: ctx.ttl.images,
      signal: opts.signal,
    });
    const posters = ((res.data && res.data.data) || []).map((p) => {
      const img = imageOf(p);
      return img ? Object.assign(img, { source: "jikan" }) : null;
    });
    return { posters: posters.filter(Boolean), banners: [], logos: [], thumbnails: [], stills: [] };
  },
};

function imageUrl(images) {
  if (!images) return null;
  const source = images.webp || images.jpg;
  if (!source) return null;
  return source.image_url || source.large_image_url || null;
}
