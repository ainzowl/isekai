// TMDB: keyed adapter for posters/backdrops/stills and the IMDb/TVDB/Wikidata
// bridge. Accepts a v3 key (api_key) or a v4 bearer token (auto-detected).

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

function isBearer(key) {
  return typeof key === "string" && key.indexOf("eyJ") === 0;
}

function auth(ctx, url) {
  if (isBearer(ctx.key)) return { url, headers: { Authorization: "Bearer " + ctx.key } };
  return { url: url + (url.indexOf("?") >= 0 ? "&" : "?") + "api_key=" + encodeURIComponent(ctx.key), headers: {} };
}

async function tmdbGet(ctx, path, params, opts = {}) {
  const query = params
    ? Object.keys(params)
        .filter((k) => params[k] != null && params[k] !== "")
        .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
        .join("&")
    : "";
  const raw = ctx.baseUrl + path + (query ? "?" + query : "");
  const signed = auth(ctx, raw);
  const res = await ctx.http.get("tmdb", signed.url, {
    ttl: opts.ttl,
    signal: opts.signal,
    headers: signed.headers,
  });
  return res.data;
}

function imageUrl(path, size) {
  if (!path) return null;
  return IMG + "/" + (size || "original") + path;
}

function normalizeStatus(status) {
  if (!status) return null;
  const s = String(status).toLowerCase();
  if (s.indexOf("returning") >= 0) return "RELEASING";
  if (s === "ended") return "FINISHED";
  if (s.indexOf("cancel") >= 0) return "CANCELLED";
  if (s.indexOf("production") >= 0 || s.indexOf("planned") >= 0 || s.indexOf("pilot") >= 0) return "NOT_YET_RELEASED";
  return "UNKNOWN";
}

export function normalizeDetail(d, mediaType) {
  if (!d || d.id == null) return null;
  const type = mediaType || (d.media_type === "movie" || d.title ? "movie" : "tv");
  const title = type === "movie" ? d.title : d.name;
  const original = type === "movie" ? d.original_title : d.original_name;
  const isJapanese = d.original_language === "ja";
  const date = type === "movie" ? d.release_date : d.first_air_date;

  const ids = { tmdb: { [type]: Number(d.id) } };
  const external = d.external_ids || {};
  if (external.imdb_id) ids.imdb = external.imdb_id;
  if (external.tvdb_id) ids.tvdb = Number(external.tvdb_id);
  if (external.wikidata_id) ids.wikidata = Number(String(external.wikidata_id).replace(/^Q/, ""));

  const images = d.images || {};
  const toList = (list, size, thumbSize, kind) =>
    (list || []).map((img) => ({
      kind,
      url: imageUrl(img.file_path, size),
      thumbUrl: imageUrl(img.file_path, thumbSize),
      width: img.width || undefined,
      height: img.height || undefined,
      language: img.iso_639_1 || undefined,
      source: "tmdb",
    }));

  const seasons = [];
  for (const s of d.seasons || []) {
    seasons.push({
      number: Number(s.season_number),
      name: s.name || null,
      episodeCount: s.episode_count != null ? Number(s.episode_count) : null,
      year: s.air_date ? Number(String(s.air_date).slice(0, 4)) : null,
      poster: s.poster_path ? imageUrl(s.poster_path, "w500") : null,
      kind: "group",
      sources: ["tmdb"],
    });
  }

  const runtimes = d.episode_run_time || [];
  const runtime = type === "movie" ? d.runtime : runtimes[0];

  return {
    ids,
    titles: {
      english: title || undefined,
      native: isJapanese && original ? original : undefined,
    },
    titlesLocalized: isJapanese && original ? { ja: original } : d.original_language ? { [d.original_language]: original } : {},
    type: type === "movie" ? "MOVIE" : "TV",
    status: normalizeStatus(d.status),
    episodes: d.number_of_episodes != null ? Number(d.number_of_episodes) : null,
    durationSec: runtime != null ? Number(runtime) * 60 : null,
    aired: date ? { from: date + "T00:00:00.000Z", to: d.last_air_date ? d.last_air_date + "T00:00:00.000Z" : null } : null,
    synopsis: d.overview || null,
    isAdult: d.adult != null ? !!d.adult : null,
    genres: (d.genres || []).map((g) => g.name),
    studios: (d.production_companies || []).map((c) => c.name).filter(Boolean),
    ratings: {
      tmdb: {
        score: d.vote_average != null ? Number(d.vote_average) : null,
        scale: 10,
        votes: d.vote_count != null ? Number(d.vote_count) : null,
        popularity: d.popularity != null ? Number(d.popularity) : null,
      },
    },
    links: { official: d.homepage || null, streaming: [], external: [] },
    images: {
      posters: toList(images.posters, "w500", "w92", "poster"),
      banners: toList(images.backdrops, "original", "w780", "banner"),
      logos: toList(images.logos, "original", "w300", "logo"),
      thumbnails: [],
      stills: [],
    },
    seasons,
  };
}

export default {
  id: "tmdb",
  requiresKey: true,
  capabilities: {
    metadata: true, search: true, episodes: true, cast: false, relations: false,
    recommendations: true, schedule: false, images: true, screenshots: true,
    skips: false, mapping: true, slug: false,
  },
  defaults: { baseUrl: BASE, rate: { perSec: 10 } },

  async byId(ctx, ref, opts = {}) {
    const type = ref.type === "movie" ? "movie" : "tv";
    const data = await tmdbGet(
      ctx,
      "/" + type + "/" + ref.id,
      { append_to_response: "external_ids,images", include_image_language: "en,null,ja" },
      { ttl: ctx.ttl.anime, signal: opts.signal }
    );
    return normalizeDetail(data, type);
  },

  async findByExternalId(ctx, externalId, source, opts = {}) {
    const data = await tmdbGet(ctx, "/find/" + encodeURIComponent(externalId), { external_source: source }, { ttl: ctx.ttl.idMap, signal: opts.signal });
    if (!data) return null;
    const tv = (data.tv_results || [])[0];
    if (tv) return this.byId(ctx, { id: tv.id, type: "tv" }, opts);
    const movie = (data.movie_results || [])[0];
    if (movie) return this.byId(ctx, { id: movie.id, type: "movie" }, opts);
    return null;
  },

  async search(ctx, query, opts = {}) {
    const data = await tmdbGet(ctx, "/search/tv", { query, include_adult: false }, { ttl: ctx.ttl.search, signal: opts.signal });
    return ((data && data.results) || []).map((r) => ({
      ids: { tmdb: { tv: Number(r.id) } },
      titles: { english: r.name || undefined, native: r.original_language === "ja" ? r.original_name : undefined },
      type: "TV",
      year: r.first_air_date ? Number(String(r.first_air_date).slice(0, 4)) : null,
      synopsis: r.overview || null,
      image: r.poster_path ? imageUrl(r.poster_path, "w500") : null,
      sources: ["tmdb"],
    }));
  },

  async seasons(ctx, ref, opts = {}) {
    const canvas = await this.byId(ctx, { id: ref.id, type: ref.type || "tv" }, opts);
    return (canvas && canvas.seasons) || [];
  },

  async episodes(ctx, ref, opts = {}) {
    const season = opts.season != null ? opts.season : 1;
    const data = await tmdbGet(ctx, "/tv/" + ref.id + "/season/" + season, null, { ttl: ctx.ttl.episodes, signal: opts.signal });
    return ((data && data.episodes) || []).map((ep) => ({
      number: Number(ep.episode_number),
      season: Number(ep.season_number),
      title: ep.name || null,
      synopsis: ep.overview || null,
      airedAt: ep.air_date ? ep.air_date + "T00:00:00.000Z" : null,
      durationSec: ep.runtime != null ? Number(ep.runtime) * 60 : null,
      images: ep.still_path
        ? [{ kind: "still", url: imageUrl(ep.still_path, "original"), thumbUrl: imageUrl(ep.still_path, "w300"), source: "tmdb" }]
        : [],
      sources: ["tmdb"],
    }));
  },

  async images(ctx, ref, opts = {}) {
    const type = ref.type === "movie" ? "movie" : "tv";
    const data = await tmdbGet(ctx, "/" + type + "/" + ref.id + "/images", { include_image_language: "en,null,ja" }, { ttl: ctx.ttl.images, signal: opts.signal });
    const toList = (list, size, thumbSize, kind) =>
      (list || []).map((img) => ({
        kind,
        url: imageUrl(img.file_path, size),
        thumbUrl: imageUrl(img.file_path, thumbSize),
        width: img.width || undefined,
        height: img.height || undefined,
        language: img.iso_639_1 || undefined,
        source: "tmdb",
      }));
    return {
      posters: toList(data && data.posters, "w500", "w92", "poster"),
      banners: toList(data && data.backdrops, "original", "w780", "banner"),
      logos: toList(data && data.logos, "original", "w300", "logo"),
      thumbnails: [],
      stills: [],
    };
  },

  async screenshots(ctx, ref, opts = {}) {
    if (ref.id == null || opts.season == null || opts.number == null) return [];
    const data = await tmdbGet(
      ctx,
      "/tv/" + ref.id + "/season/" + opts.season + "/episode/" + opts.number + "/images",
      null,
      { ttl: ctx.ttl.images, signal: opts.signal }
    );
    return ((data && data.stills) || []).map((still) => ({
      kind: "still",
      url: imageUrl(still.file_path, "original"),
      thumbUrl: imageUrl(still.file_path, "w300"),
      width: still.width || undefined,
      height: still.height || undefined,
      language: still.iso_639_1 || undefined,
      source: "tmdb",
    }));
  },
};
