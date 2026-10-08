// AniList: keyless GraphQL; idMal bridge, relations, cast, recommendations, schedule.

const GQL = "https://graphql.anilist.co";

const MEDIA_FIELDS = `
  id idMal format status season seasonYear episodes duration description(asHtml: false)
  genres synonyms source isAdult averageScore meanScore popularity favourites
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  trailer { id site thumbnail }
  startDate { year month day } endDate { year month day }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  externalLinks { site url type }
  streamingEpisodes { title thumbnail url site }
  relations { edges { relationType node { id idMal format status title { romaji english } coverImage { large } } } }
  tags { name rank category }
  studios { edges { isMain node { name } } }
`;

function normalizeFormat(format) {
  if (!format) return null;
  if (format === "TV_SHORT" || format === "TV") return "TV";
  if (format === "MOVIE") return "MOVIE";
  if (format === "OVA") return "OVA";
  if (format === "ONA") return "ONA";
  if (format === "SPECIAL") return "SPECIAL";
  if (format === "MUSIC") return "MUSIC";
  return "UNKNOWN";
}

function normalizeStatus(status) {
  if (!status) return null;
  return ["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"].indexOf(status) >= 0
    ? status
    : "UNKNOWN";
}

function dateToIso(parts) {
  if (!parts || !parts.year) return null;
  const month = String(parts.month || 1).padStart(2, "0");
  const day = String(parts.day || 1).padStart(2, "0");
  return parts.year + "-" + month + "-" + day + "T00:00:00.000Z";
}

function relationType(type) {
  const t = String(type || "").toUpperCase();
  return ["SEQUEL", "PREQUEL", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "PARENT", "SUMMARY", "CHARACTER", "OTHER"].indexOf(t) >= 0
    ? t
    : "OTHER";
}

function serviceName(url) {
  try {
    const host = String(url).replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length > 1 ? parts[parts.length - 2] : host;
  } catch (err) {
    return "unknown";
  }
}

export function normalizeMedia(m) {
  if (!m || m.id == null) return null;
  const ids = { anilist: Number(m.id) };
  if (m.idMal != null) ids.mal = Number(m.idMal);

  const streaming = [];
  const external = [];
  let official = null;
  for (const link of m.externalLinks || []) {
    if (!link || !link.url) continue;
    if (link.type === "STREAMING") {
      streaming.push({
        service: serviceName(link.url),
        url: link.url,
        dub: null,
        subs: null,
        region: null,
        source: "anilist",
      });
    } else if (link.site === "Official Site" && !official) {
      official = link.url;
    } else {
      external.push({ service: serviceName(link.url), url: link.url, source: "anilist" });
    }
  }

  const tags = (m.tags || [])
    .filter((t) => t && t.rank != null && t.rank >= 40)
    .map((t) => t.name)
    .filter(Boolean);

  const relations = [];
  for (const edge of (m.relations && m.relations.edges) || []) {
    const node = edge.node;
    if (!node) continue;
    relations.push({
      type: relationType(edge.relationType),
      ids: node.idMal != null ? { anilist: Number(node.id), mal: Number(node.idMal) } : { anilist: Number(node.id) },
      title: (node.title && (node.title.romaji || node.title.english)) || null,
      format: normalizeFormat(node.format),
      status: normalizeStatus(node.status),
      sources: ["anilist"],
    });
  }

  const studios = [];
  for (const edge of (m.studios && m.studios.edges) || []) {
    if (edge.isMain && edge.node && edge.node.name) studios.push(edge.node.name);
  }

  const cover = m.coverImage || {};
  const images = {
    posters: cover.extraLarge || cover.large ? [{ url: cover.extraLarge || cover.large, source: "anilist" }] : [],
    banners: m.bannerImage ? [{ url: m.bannerImage, source: "anilist" }] : [],
    logos: [],
    thumbnails: [],
    stills: [],
  };
  if (m.trailer && m.trailer.thumbnail) {
    images.thumbnails.push({ url: m.trailer.thumbnail, source: "anilist" });
  }
  for (const ep of m.streamingEpisodes || []) {
    if (ep && ep.thumbnail) images.thumbnails.push({ url: ep.thumbnail, source: "anilist" });
  }

  return {
    ids,
    titles: {
      romaji: (m.title && m.title.romaji) || undefined,
      english: (m.title && m.title.english) || undefined,
      native: (m.title && m.title.native) || undefined,
    },
    synonymTitles: m.synonyms || [],
    type: normalizeFormat(m.format),
    status: normalizeStatus(m.status),
    episodes: m.episodes != null ? Number(m.episodes) : null,
    durationSec: m.duration != null ? Number(m.duration) * 60 : null,
    season: m.season && m.seasonYear ? { season: m.season, year: m.seasonYear } : null,
    aired: { from: dateToIso(m.startDate), to: dateToIso(m.endDate) },
    synopsis: m.description || null,
    isAdult: m.isAdult != null ? !!m.isAdult : null,
    genres: m.genres || [],
    tags,
    studios,
    ratings: {
      anilist: {
        score: m.averageScore != null ? Number(m.averageScore) / 10 : null,
        meanScore: m.meanScore != null ? Number(m.meanScore) / 10 : null,
        popularity: m.popularity != null ? Number(m.popularity) : null,
        favorites: m.favourites != null ? Number(m.favourites) : null,
      },
    },
    sourceMaterial: m.source ? { type: m.source } : null,
    nextEpisode: m.nextAiringEpisode
      ? {
          number: m.nextAiringEpisode.episode,
          airsAt: m.nextAiringEpisode.airingAt,
          countdownSec: m.nextAiringEpisode.timeUntilAiring,
        }
      : null,
    links: { official, streaming, external },
    images,
    relations,
  };
}

async function gql(ctx, query, variables, opts) {
  const res = await ctx.http.postJson("anilist", ctx.baseUrl || GQL, { query, variables: variables || {} }, { signal: opts && opts.signal });
  const body = res.data;
  if (body && body.errors && body.errors.length) {
    const first = body.errors[0];
    const err = new Error("AniList: " + (first.message || "GraphQL error"));
    err.status = first.status || null;
    throw err;
  }
  return body && body.data;
}

export default {
  id: "anilist",
  requiresKey: false,
  capabilities: {
    metadata: true, search: true, episodes: true, cast: true, relations: true,
    recommendations: true, schedule: true, images: true, screenshots: true,
    skips: false, mapping: true, slug: false,
  },
  defaults: { baseUrl: GQL, rate: { perMin: 30 } },

  // Raw GraphQL passthrough for shogo.raw.anilist.
  gql(ctx, query, variables, opts) {
    return gql(ctx, query, variables, opts);
  },

  async byId(ctx, id, opts = {}) {
    const query =
      "query ($id: Int) { " +
      (opts.byIdMal ? "Media(idMal: $id)" : "Media(id: $id)") +
      " { " + MEDIA_FIELDS + " } }";
    const data = await gql(ctx, query, { id: Number(id) }, opts);
    return normalizeMedia(data && data.Media);
  },

  async search(ctx, query, opts = {}) {
    const q =
      "query ($q: String, $perPage: Int) { Page(perPage: $perPage) { media(search: $q, type: ANIME) { " +
      MEDIA_FIELDS +
      " } } }";
    const data = await gql(ctx, q, { q: query, perPage: opts.limit || 10 }, opts);
    const media = (data && data.Page && data.Page.media) || [];
    return media.map(normalizeMedia).filter(Boolean);
  },

  async characters(ctx, id, opts = {}) {
    const q =
      "query ($id: Int) { Media(id: $id) { characters(sort: [ROLE, RELEVANCE], perPage: 25) { edges { role " +
      "node { id name { full native } image { large } } voiceActors { name { full } image { large } } } } } }";
    const data = await gql(ctx, q, { id: Number(id) }, opts);
    const edges = (data && data.Media && data.Media.characters && data.Media.characters.edges) || [];
    return edges.map((edge) => ({
      ids: edge.node && edge.node.id != null ? { anilist: edge.node.id } : {},
      name: (edge.node && edge.node.name && (edge.node.name.full || edge.node.name.native)) || null,
      image: (edge.node && edge.node.image && edge.node.image.large) || null,
      role: edge.role || null,
      voiceActors: (edge.voiceActors || []).map((va) => ({
        name: (va.name && va.name.full) || null,
        language: null,
        image: (va.image && va.image.large) || null,
      })),
      sources: ["anilist"],
    }));
  },

  async staff(ctx, id, opts = {}) {
    const q =
      "query ($id: Int) { Media(id: $id) { staff(perPage: 25) { edges { role node { id name { full native } image { large } } } } } }";
    const data = await gql(ctx, q, { id: Number(id) }, opts);
    const edges = (data && data.Media && data.Media.staff && data.Media.staff.edges) || [];
    return edges.map((edge) => ({
      ids: edge.node && edge.node.id != null ? { anilist: edge.node.id } : {},
      name: (edge.node && edge.node.name && (edge.node.name.full || edge.node.name.native)) || null,
      image: (edge.node && edge.node.image && edge.node.image.large) || null,
      positions: edge.role ? [edge.role] : [],
      sources: ["anilist"],
    }));
  },

  async relations(ctx, id, opts = {}) {
    const canvas = await this.byId(ctx, id, opts);
    return (canvas && canvas.relations) || [];
  },

  async recommendations(ctx, id, opts = {}) {
    const q =
      "query ($id: Int) { Media(id: $id) { recommendations(perPage: " + (opts.limit || 10) + ", sort: RATING_DESC) { " +
      "nodes { rating mediaRecommendation { id idMal format title { romaji english } coverImage { large } } } } } }";
    const data = await gql(ctx, q, { id: Number(id) }, opts);
    const nodes = (data && data.Media && data.Media.recommendations && data.Media.recommendations.nodes) || [];
    return nodes
      .filter((n) => n.mediaRecommendation)
      .map((n) => {
        const m = n.mediaRecommendation;
        const ids = { anilist: Number(m.id) };
        if (m.idMal != null) ids.mal = Number(m.idMal);
        return {
          ids,
          titles: {
            romaji: (m.title && m.title.romaji) || undefined,
            english: (m.title && m.title.english) || undefined,
          },
          type: normalizeFormat(m.format),
          image: (m.coverImage && m.coverImage.large) || null,
          votes: n.rating != null ? Number(n.rating) : null,
          sources: ["anilist"],
        };
      });
  },

  async schedule(ctx, opts = {}) {
    const from = opts.from != null ? opts.from : Math.floor(Date.now() / 1000);
    const to = opts.to != null ? opts.to : from + 86400;
    const q =
      "query ($from: Int, $to: Int) { Page(perPage: 50) { airingSchedules(airingAt_greater: $from, airingAt_lesser: $to) " +
      "{ airingAt episode media { id idMal title { romaji english } } } } }";
    const data = await gql(ctx, q, { from, to }, opts);
    const list = (data && data.Page && data.Page.airingSchedules) || [];
    return list.map((entry) => ({
      ids: entry.media
        ? Object.assign({ anilist: Number(entry.media.id) }, entry.media.idMal != null ? { mal: Number(entry.media.idMal) } : {})
        : {},
      titles: {
        romaji: entry.media && entry.media.title ? entry.media.title.romaji : undefined,
        english: entry.media && entry.media.title ? entry.media.title.english : undefined,
      },
      episode: entry.episode,
      airingAt: entry.airingAt,
      sources: ["anilist"],
    }));
  },

  async images(ctx, id, opts = {}) {
    const canvas = await this.byId(ctx, id, opts);
    if (!canvas) return { posters: [], banners: [], logos: [], thumbnails: [], stills: [] };
    return canvas.images;
  },

  async screenshots(ctx, id, opts = {}) {
    const canvas = await this.byId(ctx, id, opts);
    return canvas ? canvas.images.thumbnails || [] : [];
  },
};
