// IMDb has no official public API: the value is a canonical id namespace,
// resolved through TMDB (/find, external_ids).

export default {
  id: "imdb",
  requiresKey: false,
  network: false,
  capabilities: {
    metadata: false, search: false, episodes: false, cast: false, relations: false,
    recommendations: false, schedule: false, images: false, screenshots: false,
    skips: false, mapping: true, slug: false,
  },
  defaults: { baseUrl: null, rate: {} },

  normalize(value) {
    const s = String(value == null ? "" : value).trim().toLowerCase();
    if (!/^tt\d+$/.test(s)) return null;
    return { imdb: s };
  },
};
