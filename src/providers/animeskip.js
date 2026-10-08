// Anime Skip (anime-skip.com): optional skip source behind a client id
// (X-Client-ID, the API client UUID from the account page).

import { InvalidApiKeyError, MissingApiKeyError } from "../core/errors.js";

const GQL = "https://api.anime-skip.com/graphql";

function categorize(typeName) {
  const t = String(typeName || "").toLowerCase();
  if (/recap|previously/.test(t)) return "recap";
  if (/preview|next episode/.test(t)) return "preview";
  if (/intro|opening/.test(t)) return "op";
  if (/outro|ending|credits/.test(t)) return "ed";
  return "other";
}

export function normalizeSkipTimes(points, extra = {}) {
  if (!points.length) return null;
  const sorted = points.slice().sort((a, b) => a.at - b.at);
  const byCat = { op: [], ed: [], recap: [], preview: [], other: [] };
  for (const p of sorted) byCat[categorize(p.type)].push(p);

  const out = {
    points: sorted.map((p) => ({ type: p.type, at: p.at })),
    other: byCat.other.map((p) => ({ type: p.type, at: p.at })),
    source: "anime-skip",
  };
  if (byCat.recap.length) out.recap = { start: 0, end: byCat.recap[0].at };
  if (byCat.op.length) out.op = { start: 0, end: byCat.op[0].at };
  if (byCat.ed.length) {
    const ed = byCat.ed[0];
    const after = sorted.find((p) => p.at > ed.at);
    out.ed = { start: ed.at, end: after ? after.at : null };
  }
  if (byCat.preview.length) out.preview = { start: byCat.preview[0].at, end: null };
  return Object.assign(out, extra);
}

function matchEpisode(episodes, opts) {
  const wantAbs = opts.absoluteNumber != null ? String(opts.absoluteNumber) : null;
  const wantNumber = opts.number != null ? String(opts.number) : null;
  const wantSeason = opts.season != null && opts.season !== 1 ? String(opts.season) : null;
  let best = null;
  let bestScore = -1;
  for (const ep of episodes) {
    let score = 0;
    if (wantAbs && ep.absoluteNumber && String(ep.absoluteNumber) === wantAbs) score += 4;
    if (wantNumber && ep.number && String(ep.number) === wantNumber) score += 2;
    if (wantSeason && ep.season && String(ep.season) === wantSeason) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = ep;
    }
  }
  return bestScore > 0 ? best : null;
}

export default {
  id: "anime-skip",
  requiresKey: true,
  capabilities: {
    metadata: false, search: true, episodes: true, cast: false, relations: false,
    recommendations: false, schedule: false, images: false, screenshots: false,
    skips: true, mapping: false, slug: false,
  },
  defaults: { baseUrl: GQL, rate: { perMin: 30 } },

  async gql(ctx, query, variables, opts = {}) {
    const res = await ctx.http.postJson(
      "anime-skip",
      ctx.baseUrl || GQL,
      { query, variables: variables || {} },
      { signal: opts.signal, headers: { "X-Client-ID": ctx.key } }
    );
    const body = res.data;
    if (body && body.errors && body.errors.length) {
      const message = body.errors[0].message || "GraphQL error";
      if (/x-client-id/i.test(message) && /must be passed/i.test(message)) {
        throw new MissingApiKeyError("anime-skip");
      }
      if (/x-client-id/i.test(message)) {
        throw new InvalidApiKeyError("anime-skip", message);
      }
      throw new Error("Anime Skip: " + message);
    }
    return body && body.data;
  },

  async findShowByAniListId(ctx, aniListId, opts = {}) {
    const query =
      "query ($serviceId: String!) { findShowsByExternalId(service: ANILIST, serviceId: $serviceId) { id name image } }";
    const data = await this.gql(ctx, query, { serviceId: String(aniListId) }, opts);
    const shows = (data && data.findShowsByExternalId) || [];
    return shows.length ? shows[0] : null;
  },

  async searchShows(ctx, search, opts = {}) {
    const query = "query ($search: String) { searchShows(search: $search, limit: 10) { id name image } }";
    const data = await this.gql(ctx, query, { search }, opts);
    return (data && data.searchShows) || [];
  },

  async episodesForShow(ctx, showId, opts = {}) {
    const query =
      "query ($showId: ID!) { findEpisodesByShowId(showId: $showId) { id name season number absoluteNumber baseDuration } }";
    const data = await this.gql(ctx, query, { showId }, opts);
    return (data && data.findEpisodesByShowId) || [];
  },

  async timestampsForEpisode(ctx, episodeId, opts = {}) {
    const query =
      "query ($episodeId: ID!) { findTimestampsByEpisodeId(episodeId: $episodeId) { at type { id name } } }";
    const data = await this.gql(ctx, query, { episodeId }, opts);
    return (data && data.findTimestampsByEpisodeId) || [];
  },

  async episodeUrls(ctx, episodeId, opts = {}) {
    const query = "query ($episodeId: ID!) { findEpisodeUrlsByEpisodeId(episodeId: $episodeId) { url duration timestampsOffset } }";
    const data = await this.gql(ctx, query, { episodeId }, opts);
    return (data && data.findEpisodeUrlsByEpisodeId) || [];
  },

  // Skip times for one episode, mapped from an AniList id.
  async skipTimes(ctx, ref, opts = {}) {
    const show = await this.findShowByAniListId(ctx, ref.aniListId, opts);
    if (!show) return null;
    const episodes = await this.episodesForShow(ctx, show.id, opts);
    const episode = matchEpisode(episodes, opts);
    if (!episode) return null;
    const raw = await this.timestampsForEpisode(ctx, episode.id, opts);
    let points = raw
      .filter((t) => t && t.at != null)
      .map((t) => ({ at: Number(t.at), type: (t.type && t.type.name) || "Unknown" }));

    let offsetsApplied = null;
    if (opts.serviceUrl) {
      const urls = await this.episodeUrls(ctx, episode.id, opts);
      const host = String(opts.serviceUrl).replace(/^https?:\/\//, "").split("/")[0];
      const match = urls.find((u) => String(u.url).indexOf(host) >= 0);
      if (match && match.timestampsOffset != null) {
        const offset = Number(match.timestampsOffset);
        points = points.map((p) => ({ type: p.type, at: Math.max(0, p.at + offset) }));
        offsetsApplied = { serviceUrl: opts.serviceUrl, offsetSec: offset };
      }
    }

    const skip = normalizeSkipTimes(points, {
      showId: show.id,
      showName: show.name,
      episodeId: episode.id,
      audio: opts.audio || null,
    });
    if (skip && offsetsApplied) skip.offsetsApplied = offsetsApplied;
    return skip;
  },
};
