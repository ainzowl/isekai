// AniSkip (aniskip.com): keyless, MAL-based skip times with real ranges.
// GET /v2/skip-times/{malId}/{episode} requires types[] and episodeLength;
// "not found" is a 404.

const BASE = "https://api.aniskip.com";
const SKIP_TYPES = ["op", "mixed-op", "ed", "mixed-ed", "recap"];

function kindOf(skipType) {
  if (skipType === "op" || skipType === "mixed-op") return "op";
  if (skipType === "ed" || skipType === "mixed-ed") return "ed";
  if (skipType === "recap") return "recap";
  if (skipType === "preview") return "preview";
  return "other";
}

export function normalizeSkipResults(results, extra = {}) {
  const out = { other: [], source: "aniskip" };
  for (const result of results || []) {
    const interval = result && result.interval;
    if (!interval || interval.startTime == null || interval.endTime == null) continue;
    const kind = kindOf(result.skipType);
    const range = { start: Number(interval.startTime), end: Number(interval.endTime), type: result.skipType || "unknown" };
    if (kind === "other" || out[kind] != null) out.other.push(range);
    else out[kind] = range;
    if (result.episodeLength != null && out.episodeLength == null) out.episodeLength = Number(result.episodeLength);
  }
  if (!out.other.length) delete out.other;
  return Object.assign(out, extra);
}

export default {
  id: "aniskip",
  requiresKey: false,
  capabilities: {
    metadata: false, search: false, episodes: false, cast: false, relations: false,
    recommendations: false, schedule: false, images: false, screenshots: false,
    skips: true, mapping: false, slug: false,
  },
  defaults: { baseUrl: BASE, rate: { perSec: 5 } },

  // ref: { malId, episode, episodeLength? }
  async skipTimes(ctx, ref, opts = {}) {
    if (ref.malId == null || ref.episode == null) return null;
    const length = ref.episodeLength != null && Number(ref.episodeLength) > 0 ? Number(ref.episodeLength) : 0;
    const query = SKIP_TYPES.map((type) => "types[]=" + type).join("&") + "&episodeLength=" + length;
    const url = ctx.baseUrl + "/v2/skip-times/" + ref.malId + "/" + encodeURIComponent(ref.episode) + "?" + query;
    try {
      const res = await ctx.http.get("aniskip", url, { ttl: ctx.ttl.skips, signal: opts.signal });
      const body = res.data;
      if (!body || body.found === false || !Array.isArray(body.results) || !body.results.length) return null;
      return normalizeSkipResults(body.results);
    } catch (err) {
      if (err && (err.code === "NOT_FOUND" || err.status === 404)) return null; // AniSkip 404s when nothing is stored
      throw err;
    }
  },
};
