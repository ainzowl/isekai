// seasons()/episodes()/episode(). Providers number episodes differently: flat
// (Jikan/Kitsu), season-based (TMDB), absolute-aware (Anime Skip). episodes()
// defaults to the default source and consolidates tagged providers; episode()
// returns anime + season + episode + skip times + stills in one call.

import { NotFoundError } from "../core/errors.js";
import { resolveIds } from "./map.js";
import { mapLimit, metaOf, pickError } from "./common.js";

const EPISODE_CAPABLE = ["kitsu", "jikan", "tmdb", "anime-skip"];
const MODES = { jikan: "flat", kitsu: "flat", tmdb: "season", "anime-skip": "absolute" };
// Default episode source per defaultSource (AniList serves no episode list).
const EPISODE_SOURCE_MAP = { jikan: "jikan", mal: "jikan", kitsu: "kitsu", anilist: "kitsu", tmdb: "tmdb", tvdb: "tmdb" };

async function idsForRef(client, parsed, opts) {
  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) return null;
    return match.best.ids;
  }
  return parsed.ids;
}

function canServe(providerId, ids) {
  switch (providerId) {
    case "jikan":
      return ids.mal != null;
    case "kitsu":
      return ids.kitsu != null;
    case "tmdb":
      return !!(ids.tmdb && ids.tmdb.tv != null);
    case "anime-skip":
      return ids.anilist != null;
    default:
      return false;
  }
}

// Which providers to ask for episode lists (default: the default source).
export function episodeProviders(client, ids, opts = {}) {
  const allow = client.config.metadataProviders || null;
  const wanted =
    opts.providers === "all"
      ? EPISODE_CAPABLE
      : opts.providers ||
        client.config.episodesProviders ||
        [EPISODE_SOURCE_MAP[client.config.defaultSource] || "kitsu"];
  const out = [];
  for (const id of wanted) {
    if (EPISODE_CAPABLE.indexOf(id) < 0) continue;
    if (allow && allow.indexOf(id) < 0) continue;
    if (!client.isConfigured(id)) continue;
    if (!canServe(id, ids)) continue;
    out.push(id);
  }
  // A ref that none of the wanted providers can serve (e.g. tmdb-only) still
  // gets episodes from whichever capable provider has ids for it.
  if (!out.length) {
    for (const id of EPISODE_CAPABLE) {
      if (allow && allow.indexOf(id) < 0) continue;
      if (client.isConfigured(id) && canServe(id, ids)) out.push(id);
    }
  }
  return out;
}

async function fetchEpisodeList(client, providerId, ids, opts) {
  const ctx = client.ctx(providerId);
  switch (providerId) {
    case "jikan": {
      const episodes = await client.registry.jikan.episodes(ctx, ids.mal, opts);
      return {
        provider: "jikan",
        mode: "flat",
        season: null,
        episodes,
        total: episodes.total != null ? episodes.total : null,
        truncated: !!episodes.truncated,
      };
    }
    case "kitsu": {
      const episodes = await client.registry.kitsu.episodes(ctx, ids.kitsu, opts);
      return {
        provider: "kitsu",
        mode: "flat",
        season: null,
        episodes,
        total: episodes.total != null ? episodes.total : null,
        truncated: !!episodes.truncated,
      };
    }
    case "tmdb": {
      const tv = { id: ids.tmdb.tv, type: "tv" };
      if (opts.season != null) {
        const season = Number(opts.season);
        const episodes = await client.registry.tmdb.episodes(ctx, tv, Object.assign({}, opts, { season }));
        return { provider: "tmdb", mode: "season", season, episodes };
      }
      // No season given: fetch every numbered season (specials skipped) so
      // consolidation can align the whole show against flat provider lists.
      const seasonList = await client.registry.tmdb.seasons(ctx, tv, opts);
      const numbers = seasonList
        .filter((season) => season.number > 0)
        .map((season) => season.number)
        .slice(0, opts.maxSeasons || 40);
      const lists = await mapLimit(numbers, 3, (season) =>
        client.registry.tmdb.episodes(ctx, tv, Object.assign({}, opts, { season }))
      );
      const episodes = [];
      for (const list of lists) for (const episode of list) episodes.push(episode);
      return { provider: "tmdb", mode: "season", season: null, seasons: numbers, episodes };
    }
    case "anime-skip": {
      const provider = client.registry["anime-skip"];
      const show = await provider.findShowByAniListId(ctx, ids.anilist, opts);
      if (!show) return null;
      const raw = await provider.episodesForShow(ctx, show.id, opts);
      return {
        provider: "anime-skip",
        mode: "absolute",
        season: null,
        showId: show.id,
        episodes: raw.map((ep) => ({
          number: ep.number != null ? String(ep.number) : null,
          season: ep.season != null ? String(ep.season) : null,
          absoluteNumber: ep.absoluteNumber != null ? String(ep.absoluteNumber) : null,
          title: ep.name || null,
          durationSec: ep.baseDuration != null ? Number(ep.baseDuration) : null,
          sources: ["anime-skip"],
        })),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------- consolidation

function normNum(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return String(Number(s));
  return s;
}

function numeric(value) {
  const n = normNum(value);
  return n != null && /^\d+(\.\d+)?$/.test(n) ? Number(n) : null;
}

function keysFor(list, episode) {
  const keys = [];
  const abs = normNum(episode.absoluteNumber);
  const num = normNum(episode.number);
  const season = normNum(episode.season != null ? episode.season : list.season);
  if (abs != null) keys.push("abs:" + abs);
  if (num != null) {
    if (season != null && season !== "1") keys.push("sn:" + season + ":" + num);
    // Flat lists, season-1 lists and season-less episodes align on the number.
    if (list.mode !== "season" || season == null || season === "1") keys.push("flat:" + num);
  }
  return keys;
}

function mergeGroup(members, providerOrder) {
  const ordered = members.slice().sort((a, b) => providerOrder.indexOf(a.list.provider) - providerOrder.indexOf(b.list.provider));
  const canonical = {
    number: null,
    season: null,
    absoluteNumber: null,
    title: null,
    synopsis: null,
    airedAt: null,
    durationSec: null,
    isFiller: undefined,
    isRecap: undefined,
    images: [],
    refs: {},
    sources: [],
  };

  for (const member of ordered) {
    const episode = member.episode;
    if (canonical.number == null && episode.number != null) canonical.number = episode.number;
    if (canonical.title == null && episode.title != null) canonical.title = episode.title;
    if (canonical.synopsis == null && episode.synopsis != null) canonical.synopsis = episode.synopsis;
    if (canonical.airedAt == null && episode.airedAt != null) canonical.airedAt = episode.airedAt;
    if (canonical.durationSec == null && episode.durationSec != null) canonical.durationSec = episode.durationSec;
    if (canonical.absoluteNumber == null && episode.absoluteNumber != null) canonical.absoluteNumber = episode.absoluteNumber;
    if (canonical.season == null && (episode.season != null || member.list.season != null)) {
      canonical.season = episode.season != null ? episode.season : member.list.season;
    }
    if (episode.isFiller != null) canonical.isFiller = canonical.isFiller || episode.isFiller;
    if (episode.isRecap != null) canonical.isRecap = canonical.isRecap || episode.isRecap;
    for (const image of episode.images || []) {
      if (image && image.url && !canonical.images.some((x) => x.url === image.url)) canonical.images.push(image);
    }
    canonical.refs[member.list.provider] = {
      number: episode.number != null ? episode.number : null,
      season: episode.season != null ? episode.season : member.list.season != null ? member.list.season : null,
      absoluteNumber: episode.absoluteNumber != null ? episode.absoluteNumber : null,
    };
    if (canonical.sources.indexOf(member.list.provider) < 0) canonical.sources.push(member.list.provider);
  }

  if (!canonical.images.length) delete canonical.images;
  if (canonical.isFiller === undefined) delete canonical.isFiller;
  if (canonical.isRecap === undefined) delete canonical.isRecap;
  return canonical;
}

function sortKeyOf(episode) {
  const number = numeric(episode.number);
  const season = numeric(episode.season);
  const abs = numeric(episode.absoluteNumber);
  if (number != null) return [0, season != null && season > 1 ? 1 : 0, number, abs != null ? abs : number];
  if (abs != null) return [0, 0, abs, abs];
  return [1, 0, 0, 0]; // non-numeric names ("OVA 1") keep insertion order at the end
}

// Consolidate provider lists; unmatched episodes are surfaced, never dropped.
export function consolidateEpisodes(lists, providerOrder) {
  const items = [];
  const parent = [];
  const keyOwner = new Map();

  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (const list of lists) {
    for (const episode of list.episodes) {
      if (episode == null || episode.number == null) continue;
      const index = items.length;
      parent[index] = index;
      items.push({ list, episode });
      for (const key of keysFor(list, episode)) {
        if (keyOwner.has(key)) union(index, keyOwner.get(key));
        else keyOwner.set(key, index);
      }
    }
  }

  const groups = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  });

  const episodes = [];
  const unmatched = {};
  let matched = 0;
  const primary = providerOrder[0];

  for (const members of groups.values()) {
    const episode = mergeGroup(members, providerOrder);
    if (members.length > 1) matched++;
    episodes.push(episode);
    for (const member of members) {
      const fromPrimary = member.list.provider === primary;
      if (members.length === 1 && !fromPrimary) {
        if (!unmatched[member.list.provider]) unmatched[member.list.provider] = [];
        unmatched[member.list.provider].push({
          number: member.episode.number != null ? member.episode.number : null,
          season: member.episode.season != null ? member.episode.season : member.list.season != null ? member.list.season : null,
        });
      }
    }
  }

  episodes.sort((a, b) => {
    const ka = sortKeyOf(a);
    const kb = sortKeyOf(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });

  const providers = {};
  let truncated = false;
  for (const list of lists) {
    providers[list.provider] = {
      mode: list.mode,
      season: list.season != null ? list.season : null,
      count: list.episodes.filter((episode) => episode && episode.number != null).length,
    };
    if (list.seasons) providers[list.provider].seasons = list.seasons;
    if (list.total != null) providers[list.provider].total = list.total;
    if (list.truncated) {
      providers[list.provider].truncated = true;
      truncated = true;
    }
  }

  return { episodes, consolidated: { providers, total: episodes.length, matched, unmatched, truncated } };
}

function attach(array, extras) {
  for (const key of Object.keys(extras)) {
    try {
      array[key] = extras[key];
    } catch (err) {
      /* ignore */
    }
  }
  return array;
}

// ---------------------------------------------------------------- public methods

async function collect(client, ref, opts) {
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for episodes(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const providers = episodeProviders(client, ids, opts);
  const errors = resolved.errors.slice();
  const skipped = resolved.skipped.slice();
  const sources = [];

  const settled = await Promise.all(
    providers.map(async (providerId) => {
      try {
        const list = await fetchEpisodeList(client, providerId, ids, opts);
        if (!list) return { provider: providerId, skipped: { provider: providerId, reason: "not-found" } };
        return { provider: providerId, list };
      } catch (err) {
        if (err && err.code === "NOT_FOUND") return { provider: providerId, skipped: { provider: providerId, reason: "not-found" } };
        return { provider: providerId, error: err };
      }
    })
  );

  const lists = [];
  for (const item of settled) {
    if (item.error) {
      errors.push(pickError(item.error, item.provider));
      continue;
    }
    if (item.skipped) {
      skipped.push(item.skipped);
      continue;
    }
    lists.push(item.list);
    sources.push(item.provider);
  }

  return { ids, resolved, providers, lists, sources, errors, skipped };
}

export async function episodes(client, ref, opts = {}) {
  const started = client.clock.now();
  const { ids, lists, sources, errors, skipped } = await collect(client, ref, opts);

  const { episodes: list, consolidated } = consolidateEpisodes(lists, sources);
  let out = list;
  if (opts.season != null) {
    const seasonNumber = Number(opts.season);
    // Keep episodes that belong to that season, plus flat episodes (season
    // unknown) so a flat provider's list is never emptied by a season filter.
    out = list.filter(
      (episode) =>
        episode.season == null ||
        Number(episode.season) === seasonNumber ||
        (episode.season === 1 && seasonNumber === 1)
    );
  }

  return attach(out, {
    ids,
    sources,
    consolidated,
    errors,
    skipped,
    meta: metaOf(client, started, { providersQueried: sources }),
  });
}

const CHAIN_TYPES = ["SEQUEL", "PREQUEL", "PARENT"];

export async function seasons(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  const seed = await idsForRef(client, parsed, opts);
  if (!seed) throw new NotFoundError("No ids resolved for seasons(): " + JSON.stringify(ref));
  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  const errors = resolved.errors.slice();
  const out = [];
  const sources = [];

  if (ids.tmdb != null && client.isConfigured("tmdb") && ids.tmdb.tv != null) {
    try {
      const list = await client.registry.tmdb.seasons(client.ctx("tmdb"), { id: ids.tmdb.tv, type: "tv" }, opts);
      for (const season of list) out.push(Object.assign({ kind: "group" }, season));
      sources.push("tmdb");
    } catch (err) {
      errors.push(pickError(err, "tmdb"));
    }
  }

  if (!out.length) {
    let relations = [];
    try {
      if (ids.anilist != null && client.isConfigured("anilist")) {
        const canvas = await client.registry.anilist.byId(client.ctx("anilist"), ids.anilist, opts);
        relations = (canvas && canvas.relations) || [];
        sources.push("anilist");
      } else if (ids.mal != null && client.isConfigured("jikan")) {
        relations = await client.registry.jikan.relations(client.ctx("jikan"), ids.mal, opts);
        sources.push("jikan");
      }
    } catch (err) {
      errors.push(pickError(err, "relations"));
    }

    const entries = [{ ids, titles: {}, name: null, relation: "SELF", self: true }];
    for (const rel of relations) {
      if (CHAIN_TYPES.indexOf(rel.type) < 0) continue;
      const relIds = rel.ids || {};
      if (relIds.mal == null && relIds.anilist == null && relIds.kitsu == null) continue; // nothing to jump to
      entries.push({ ids: relIds, titles: { romaji: rel.title || undefined }, name: rel.title || null, relation: rel.type, self: false });
    }
    const sorted = entries.slice().sort((a, b) => {
      const aId = a.ids.mal || a.ids.anilist || 0;
      const bId = b.ids.mal || b.ids.anilist || 0;
      return aId - bId;
    });
    for (let i = 0; i < sorted.length; i++) {
      out.push({
        number: i + 1,
        name: sorted[i].name || null,
        relation: sorted[i].relation || null,
        year: null,
        kind: "entry",
        ids: sorted[i].ids,
        titles: sorted[i].titles,
        episodeCount: null,
        sources: sources.slice(),
      });
    }
  }

  return attach(out, { ids, sources, errors, skipped: resolved.skipped, meta: metaOf(client, started, { providersQueried: sources }) });
}

export async function episode(client, ref, opts = {}) {
  const started = client.clock.now();
  const { findById } = await import("./find.js");

  // Round 1: the anime record and the episode lists have no dependency on each other.
  // Provider tags select *episode* sources; the anime merge still uses the full
  // metadata provider set (so ids like AniList survive for skip times).
  const metaOpts = Object.assign({}, opts);
  delete metaOpts.providers;
  const [anime, collected] = await Promise.all([findById(client, ref, metaOpts), collect(client, ref, opts)]);
  const errors = (anime.errors || []).slice();
  const skipped = (anime.skipped || []).slice();
  for (const entry of collected.errors) if (!errors.some((e) => e.provider === entry.provider && e.message === entry.message)) errors.push(entry);
  for (const entry of collected.skipped) skipped.push(entry);

  const { episodes: list, consolidated } = consolidateEpisodes(collected.lists, collected.sources);

  let match = null;
  if (opts.absoluteNumber != null) {
    const wanted = normNum(opts.absoluteNumber);
    match =
      list.find((episode) => normNum(episode.absoluteNumber) === wanted) ||
      list.find((episode) => Object.keys(episode.refs).some((p) => normNum(episode.refs[p].absoluteNumber) === wanted)) ||
      null;
  }
  if (!match && opts.number != null) {
    const wantedNumber = normNum(opts.number);
    if (opts.season != null) {
      const wantedSeason = normNum(opts.season);
      match =
        list.find((episode) => normNum(episode.number) === wantedNumber && (episode.season == null || normNum(episode.season) === wantedSeason)) || null;
    }
    if (!match) match = list.find((episode) => normNum(episode.number) === wantedNumber) || null;
  }
  if (!match) {
    throw new NotFoundError(
      "Episode " + JSON.stringify(opts.number != null ? opts.number : opts.absoluteNumber) + " was not found in " + (collected.sources.join(", ") || "any provider")
    );
  }

  // Round 2: season data, skip times and stills are independent of each other.
  const wantedSeason = match.season != null ? match.season : opts.season != null ? opts.season : 1;
  const stillsAvailable = client.isConfigured("tmdb") && anime.ids.tmdb != null && anime.ids.tmdb.tv != null;

  const [seasonOutcome, skipOutcome, stillsOutcome] = await Promise.all([
    seasons(client, anime.ids, opts).then(
      (value) => ({ value: value }),
      () => ({ value: null })
    ),
    (async () => {
      try {
        const mod = await import("./skips.js");
        return await mod.resolveSkip(client, anime.ids, match, opts);
      } catch (err) {
        return { skip: null, provider: null, errors: [pickError(err)], skipped: [] };
      }
    })(),
    stillsAvailable
      ? client.registry.tmdb
          .screenshots(
            client.ctx("tmdb"),
            { id: anime.ids.tmdb.tv, type: "tv" },
            { season: wantedSeason, number: match.refs.tmdb ? match.refs.tmdb.number : match.number, signal: opts.signal }
          )
          .then((value) => ({ value: value }))
          .catch((error) => ({ error: error }))
      : Promise.resolve(null),
  ]);

  let season = null;
  if (seasonOutcome.value) {
    season = seasonOutcome.value.find((s) => Number(s.number) === Number(wantedSeason)) || null;
  }
  if (!season) {
    season = { number: wantedSeason, kind: "group", ids: {}, titles: {}, episodeCount: null, sources: [] };
  }

  let skip = match.skip || null;
  if (skipOutcome) {
    if (skipOutcome.skip) skip = skipOutcome.skip;
    for (const entry of skipOutcome.errors) {
      if (!errors.some((existing) => existing.provider === entry.provider && existing.message === entry.message)) errors.push(entry);
    }
    for (const entry of skipOutcome.skipped) skipped.push(entry);
  }

  let images = match.images || [];
  if (stillsOutcome && stillsOutcome.error) {
    errors.push(pickError(stillsOutcome.error, "tmdb"));
  } else if (stillsOutcome && stillsOutcome.value && stillsOutcome.value.length) {
    images = stillsOutcome.value.concat(images.filter((i) => i.kind !== "still"));
  }

  if (skip) match.skip = skip;
  return {
    anime,
    season,
    episode: match,
    skip,
    images,
    consolidated,
    sources: (anime.sources || []).slice(),
    errors,
    skipped,
    meta: metaOf(client, started, { providersQueried: anime.meta ? anime.meta.providersQueried : [] }),
  };
}
