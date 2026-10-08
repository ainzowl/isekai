// animap.id: keyless id mapping + light metadata from one record.

const BASE = "https://animap.id";

const SERVICE_KEYS = ["mal", "kitsu", "anilist", "anidb", "ann"];

const SOURCE_PATTERNS = [
  ["anidb", /anidb\.net\/anime\/(\d+)/],
  ["anilist", /anilist\.co\/anime\/(\d+)/],
  ["mal", /myanimelist\.net\/anime\/(\d+)/],
  ["kitsu", /kitsu\.app\/anime\/(\d+)/],
  ["simkl", /simkl\.com\/anime\/(\d+)/],
  ["ann", /animenewsnetwork\.com\/encyclopedia\/anime\.php\?id=(\d+)/],
  ["anisearch", /anisearch\.com\/anime\/(\d+)/],
  ["livechart", /livechart\.me\/anime\/(\d+)/],
  ["animecountdown", /animecountdown\.com\/(\d+)/],
];

export function parseSources(sources) {
  const ids = {};
  for (const url of sources || []) {
    for (const pair of SOURCE_PATTERNS) {
      const match = pair[1].exec(String(url));
      if (match) {
        ids[pair[0]] = Number(match[1]);
        break;
      }
    }
    const planet = /anime-planet\.com\/anime\/([a-z0-9-]+)/i.exec(String(url));
    if (planet) ids.animeplanet = planet[1];
  }
  return ids;
}

function normalizeStatus(status) {
  if (!status) return null;
  const s = String(status).toUpperCase();
  if (s === "ONGOING" || s === "CURRENT") return "RELEASING";
  if (s === "FINISHED") return "FINISHED";
  if (s === "UPCOMING" || s === "TBA") return "NOT_YET_RELEASED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  return "UNKNOWN";
}

function normalizeType(type) {
  if (!type) return null;
  const t = String(type).toUpperCase();
  return ["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"].indexOf(t) >= 0 ? t : "UNKNOWN";
}

function durationSec(duration) {
  if (!duration || duration.value == null) return null;
  const unit = String(duration.unit || "SECONDS").toUpperCase();
  if (unit === "SECONDS") return Number(duration.value);
  if (unit === "MINUTES") return Number(duration.value) * 60;
  return null;
}

export function normalizeRecord(record) {
  if (!record || record.error) return null;
  const season = record.animeSeason
    ? { season: String(record.animeSeason.season || "").toUpperCase(), year: record.animeSeason.year != null ? Number(record.animeSeason.year) : null }
    : null;
  const relations = [];
  for (const rel of record.relatedAnime || []) {
    relations.push({
      type: rel.relationType ? String(rel.relationType).toUpperCase().replace(/\s+/g, "_") : "OTHER",
      ids: parseSources(rel.sources),
      title: rel.title || null,
      sources: ["animap"],
    });
  }
  return {
    ids: parseSources(record.sources),
    titles: { romaji: record.title || undefined },
    synonymTitles: Array.isArray(record.synonyms) ? record.synonyms : [],
    type: normalizeType(record.type),
    status: normalizeStatus(record.status),
    episodes: record.episodes != null ? Number(record.episodes) : null,
    durationSec: durationSec(record.duration),
    season,
    studios: record.studios || [],
    producers: record.producers || [],
    tags: record.tags || [],
    images: {
      posters: record.picture ? [{ url: record.picture, thumbUrl: record.thumbnail || record.picture, source: "animap" }] : [],
      banners: [],
      logos: [],
      thumbnails: [],
      stills: [],
    },
    relations,
  };
}

export default {
  id: "animap",
  requiresKey: false,
  capabilities: {
    metadata: true, search: false, episodes: false, cast: false, relations: false,
    recommendations: false, schedule: false, images: true, screenshots: false,
    skips: false, mapping: true, slug: false,
  },
  defaults: { baseUrl: BASE, rate: { perSec: 2 } },

  // ref: { service, id }
  async byId(ctx, ref, opts = {}) {
    if (SERVICE_KEYS.indexOf(ref.service) < 0) return null;
    const res = await ctx.http.get(
      "animap",
      ctx.baseUrl + "/api/v1/map/" + ref.service + "/" + encodeURIComponent(ref.id),
      { ttl: ctx.ttl.idMap, signal: opts.signal }
    );
    const data = res.data;
    if (!data || data.error) return null;
    return normalizeRecord(data);
  },

  // Resolve whatever id we have against animap's services, in order.
  async mapping(ctx, ids, opts = {}) {
    if (!ids) return null;
    for (const service of SERVICE_KEYS) {
      const value = ids[service];
      if (value == null) continue;
      try {
        const canvas = await this.byId(ctx, { service, id: value }, opts);
        if (canvas) return canvas;
      } catch (err) {
        if (err && (err.code === "NOT_FOUND" || err.status === 404)) continue;
        throw err;
      }
    }
    return null;
  },
};
