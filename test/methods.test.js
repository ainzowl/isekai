import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Shogo } from "../src/index.js";
import { InvalidIdError } from "../src/core/errors.js";
import { mockFetch } from "../src/testing.js";

const read = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));

const jikanAnime = read("jikan-anime-21.json");
const jikanEpisodes = read("jikan-episodes-21.json");
const kitsuAnime12 = read("kitsu-anime-12.json");
const kitsuSlugOnePiece = read("kitsu-slug-one-piece.json");
const animapRecord = read("animap-mal21.json");

const kitsuEpisodes = {
  data: [
    {
      id: "e1",
      type: "episodes",
      attributes: {
        number: 1,
        canonicalTitle: "Romance Dawn (kitsu)",
        airdate: "1999-10-20",
        length: 24,
        thumbnail: {
          original: "https://media.kitsu.io/ep/original.jpg",
          small: "https://media.kitsu.io/ep/small.jpg",
        },
      },
    },
  ],
};

const anilistMedia21 = {
  data: {
    Media: {
      id: 21,
      idMal: 21,
      format: "TV",
      status: "RELEASING",
      season: "FALL",
      seasonYear: 1999,
      episodes: 1184,
      duration: 24,
      description: "anilist synopsis",
      genres: ["Action", "Adventure", "Fantasy"],
      synonyms: ["OP"],
      source: "MANGA",
      isAdult: false,
      averageScore: 87,
      meanScore: 86,
      popularity: 400000,
      favourites: 120000,
      title: { romaji: "One Piece", english: "One Piece", native: "ワンピース" },
      coverImage: { extraLarge: "https://s4.anilist.co/cover.png", large: "https://s4.anilist.co/cover-l.png" },
      bannerImage: "https://s4.anilist.co/banner.png",
      trailer: null,
      startDate: { year: 1999, month: 10, day: 20 },
      endDate: null,
      nextAiringEpisode: null,
      externalLinks: [{ site: "Crunchyroll", url: "https://crunchyroll.com/one-piece", type: "STREAMING" }],
      streamingEpisodes: [],
      relations: {
        edges: [
          {
            relationType: "SEQUEL",
            node: {
              id: 167404,
              idMal: 56055,
              format: "TV",
              status: "RELEASING",
              title: { romaji: "ONE PIECE (remake)", english: null },
              coverImage: { large: null },
            },
          },
        ],
      },
      tags: [{ name: "Pirates", rank: 90, category: "Theme" }],
      studios: { edges: [{ isMain: true, node: { name: "Toei Animation" } }] },
    },
  },
};

const bocchiJikanSearch = {
  data: [
    {
      mal_id: 47917,
      title: "Bocchi the Rock!",
      title_english: "Bocchi the Rock!",
      title_japanese: "ぼっち・ざ・ろっく！",
      type: "TV",
      status: "Finished Airing",
      episodes: 12,
      duration: "23 min per ep",
      score: 8.76,
      images: {
        jpg: {
          image_url: "https://cdn.myanimelist.net/bocchi.jpg",
          small_image_url: "https://cdn.myanimelist.net/bocchi-t.jpg",
          large_image_url: "https://cdn.myanimelist.net/bocchi-l.jpg",
        },
      },
      season: "fall",
      year: 2022,
      genres: [{ name: "Comedy" }],
      themes: [{ name: "Music" }],
    },
    jikanAnime.data,
  ],
};

const bocchiKitsuSearch = {
  data: [
    {
      id: "44196",
      type: "anime",
      attributes: {
        slug: "bocchi-the-rock",
        canonicalTitle: "Bocchi the Rock!",
        titles: { en: "Bocchi the Rock!", en_jp: "Bocchi the Rock!", ja_jp: "ぼっち・ざ・ろっく！" },
        synonyms: [],
        subtype: "TV",
        status: "finished",
        episodeCount: 12,
        episodeLength: 24,
        startDate: "2022-10-09",
        endDate: "2022-12-25",
        averageRating: "86.3",
        posterImage: { original: "https://media.kitsu.io/bocchi.jpg", small: "https://media.kitsu.io/bocchi-s.jpg" },
        coverImage: null,
      },
    },
  ],
};

const bocchiAnilistSearch = {
  data: {
    Page: {
      media: [
        {
          id: 130003,
          idMal: 47917,
          format: "TV",
          status: "FINISHED",
          season: "FALL",
          seasonYear: 2022,
          episodes: 12,
          duration: 23,
          title: { romaji: "Bocchi the Rock!", english: "Bocchi the Rock!", native: "ぼっち・ざ・ろっく！" },
          coverImage: { extraLarge: "https://s4.anilist.co/bocchi.png" },
          bannerImage: null,
          genres: ["Comedy"],
          synonyms: [],
          externalLinks: [],
          streamingEpisodes: [],
          relations: { edges: [] },
          tags: [],
          studios: { edges: [] },
          averageScore: 88,
        },
      ],
    },
  },
};

const tmdbTv = {
  id: 37854,
  name: "One Piece",
  original_name: "One Piece",
  original_language: "ja",
  status: "Returning Series",
  number_of_episodes: 1100,
  seasons: [
    { season_number: 0, name: "Specials", episode_count: 10, air_date: null, poster_path: null },
    { season_number: 1, name: "Season 1", episode_count: 61, air_date: "1999-10-20", poster_path: "/s1.jpg" },
    { season_number: 2, name: "Season 2", episode_count: 1, air_date: "2001-01-01", poster_path: null },
  ],
  external_ids: { imdb_id: "tt0388629", tvdb_id: 81797, wikidata_id: "Q189188" },
  images: {
    posters: [{ file_path: "/poster.jpg", width: 1000, height: 1500, iso_639_1: "en" }],
    backdrops: [{ file_path: "/backdrop.jpg", width: 1920, height: 1080, iso_639_1: null }],
    logos: [],
  },
  vote_average: 8.7,
  vote_count: 4000,
  popularity: 100,
  genres: [{ name: "Animation" }],
  production_companies: [{ name: "Toei Animation" }],
  episode_run_time: [24],
  homepage: null,
  overview: "Gold Roger was known as the Pirate King.",
  first_air_date: "1999-10-20",
  last_air_date: "2026-01-01",
};

const tmdbSeason = {
  episodes: [
    {
      episode_number: 1,
      season_number: 1,
      name: "I'm Luffy!",
      overview: "The beginning.",
      air_date: "1999-10-20",
      still_path: "/still0.jpg",
      runtime: 24,
    },
  ],
};

const anilistReply = (url, init) => {
  const body = JSON.parse(init.body);
  const query = body.query || "";
  if (query.indexOf("media(search:") >= 0) return { body: bocchiAnilistSearch };
  if (query.indexOf("Media(") >= 0) return { body: anilistMedia21 };
  return { body: { data: {} } };
};

const animeskipReply = (url, init) => {
  const body = JSON.parse(init.body);
  const query = body.query || "";
  if (query.indexOf("findShowsByExternalId") >= 0) {
    return { body: { data: { findShowsByExternalId: [{ id: "show-1", name: "One Piece", image: null }] } } };
  }
  if (query.indexOf("findEpisodesByShowId") >= 0) {
    return {
      body: {
        data: {
          findEpisodesByShowId: [
            { id: "ep-1", name: "Romance Dawn", season: "1", number: "1", absoluteNumber: "1", baseDuration: 1440 },
          ],
        },
      },
    };
  }
  if (query.indexOf("findTimestampsByEpisodeId") >= 0) {
    return {
      body: {
        data: {
          findTimestampsByEpisodeId: [
            { at: 0.5, type: { id: "t0", name: "Recap" } },
            { at: 135, type: { id: "t1", name: "Intro" } },
            { at: 1250, type: { id: "t2", name: "Outro" } },
          ],
        },
      },
    };
  }
  if (query.indexOf("findEpisodeUrlsByEpisodeId") >= 0) {
    return {
      body: {
        data: {
          findEpisodeUrlsByEpisodeId: [
            { url: "https://www.crunchyroll.com/one-piece", duration: 1440, timestampsOffset: 5 },
          ],
        },
      },
    };
  }
  return { body: { data: {} } };
};

function routes() {
  return [
    {
      url: (u) => u.indexOf("api.aniskip.com/v2/skip-times/21/1?") >= 0,
      reply: {
        body: {
          found: true,
          results: [
            { interval: { startTime: 310.571, endTime: 400.571 }, skipType: "op", episodeLength: 1443.984 },
            { interval: { startTime: 1396.006, endTime: 1434 }, skipType: "ed", episodeLength: 1434.985 },
            { interval: { startTime: 132.773, endTime: 201.296 }, skipType: "recap", episodeLength: 1444 },
          ],
          message: "Successfully found skip times",
          statusCode: 200,
        },
      },
    },
    { url: (u) => u.indexOf("api.jikan.moe/v4/anime/21/full") >= 0, reply: { body: jikanAnime } },
    { url: (u) => u.indexOf("api.jikan.moe/v4/anime/21/episodes") >= 0, reply: { body: jikanEpisodes } },
    { url: (u) => u.indexOf("api.jikan.moe/v4/anime?q=") >= 0, reply: { body: bocchiJikanSearch } },
    { url: (u) => u.indexOf("kitsu.io/api/edge/anime/12/episodes") >= 0, reply: { body: kitsuEpisodes } },
    { url: (u) => u.indexOf("kitsu.io/api/edge/anime/12/mappings") >= 0, reply: { body: { data: [] } } },
    { url: (u) => u.indexOf("kitsu.io/api/edge/anime?filter[slug]=one-piece") >= 0, reply: { body: kitsuSlugOnePiece } },
    { url: (u) => u.indexOf("kitsu.io/api/edge/anime?filter[text]=") >= 0, reply: { body: bocchiKitsuSearch } },
    { url: (u) => u.indexOf("kitsu.io/api/edge/anime/12") >= 0, reply: { body: kitsuAnime12 } },
    { url: (u) => u.indexOf("animap.id/api/v1/map/mal/21") >= 0, reply: { body: animapRecord } },
    { url: (u) => u.indexOf("animap.id/api/v1/map/kitsu/12") >= 0, reply: { body: animapRecord } },
    {
      url: (u) => u.indexOf("api.themoviedb.org/3/tv/37854/season/1/episode/1/images") >= 0,
      reply: { body: { stills: [{ file_path: "/still1.jpg", width: 1920, height: 1080, iso_639_1: null }] } },
    },
    {
      url: (u) => u.indexOf("api.themoviedb.org/3/tv/37854/season/2") >= 0,
      reply: {
        body: {
          episodes: [
            {
              episode_number: 5,
              season_number: 2,
              name: "Season 2, Episode 5",
              air_date: "2001-01-01",
              overview: "",
              still_path: null,
              runtime: 24,
            },
          ],
        },
      },
    },
    { url: (u) => u.indexOf("api.themoviedb.org/3/tv/37854/season/1") >= 0, reply: { body: tmdbSeason } },
    { url: (u) => u.indexOf("api.themoviedb.org/3/tv/37854") >= 0, reply: { body: tmdbTv } },
    { method: "POST", url: (u) => u.indexOf("graphql.anilist.co") >= 0, reply: anilistReply },
    { method: "POST", url: (u) => u.indexOf("api.anime-skip.com/graphql") >= 0, reply: animeskipReply },
  ];
}

const FAST_RATES = {
  jikan: { perSec: 1000, perMin: 0 },
  kitsu: { perSec: 1000, perMin: 0 },
  anilist: { perSec: 1000, perMin: 0 },
  animap: { perSec: 1000, perMin: 0 },
  tmdb: { perSec: 1000, perMin: 0 },
  "anime-skip": { perSec: 1000, perMin: 0 },
};

function makeClient(keys = {}, extra = {}) {
  const fetchImpl = mockFetch(routes());
  const client = new Shogo(Object.assign({ fetch: fetchImpl, keys, rateLimits: FAST_RATES }, extra));
  return { client, fetchImpl };
}

test("defaultSource reorders merge precedence (kitsu default; jikan/anilist selectable)", async () => {
  const kitsuDefault = makeClient();
  const a = await kitsuDefault.client.findById("mal:21");
  assert.equal(a.fieldSources.synopsis, "kitsu");

  const jikanDefault = makeClient({}, { defaultSource: "jikan" });
  const b = await jikanDefault.client.findById("mal:21");
  assert.equal(b.fieldSources.synopsis, "jikan");
  assert.ok(b.synopsis.indexOf("Barely surviving") === 0, b.synopsis);

  const anilistDefault = makeClient({}, { defaultSource: "anilist" });
  const c = await anilistDefault.client.findById("mal:21");
  assert.equal(c.fieldSources.synopsis, "anilist");
});

test("episode defaults follow defaultSource (anilist maps to kitsu)", async () => {
  const kitsuDefault = makeClient();
  assert.deepEqual((await kitsuDefault.client.episodes("mal:21")).sources, ["kitsu"]);

  const jikanDefault = makeClient({}, { defaultSource: "jikan" });
  assert.deepEqual((await jikanDefault.client.episodes("mal:21")).sources, ["jikan"]);

  const anilistDefault = makeClient({}, { defaultSource: "anilist" });
  assert.deepEqual((await anilistDefault.client.episodes("mal:21")).sources, ["kitsu"]);
});

test("episode() explains why skip times are missing", async () => {
  // 1) AniSkip has nothing stored for this episode; Anime Skip has no key
  const noSkips = routes().map((route) =>
    route.url("https://api.aniskip.com/v2/skip-times/21/1?") === true
      ? {
          url: (u) => u.indexOf("api.aniskip.com/v2/skip-times/21/1?") >= 0,
          reply: { status: 404, body: { found: false, results: [], message: "No skip times found", statusCode: 404 } },
        }
      : route
  );
  const nothing = new Shogo({ fetch: mockFetch(noSkips), rateLimits: FAST_RATES });
  const first = await nothing.episode("mal:21", { number: 1, providers: ["kitsu"] });
  assert.equal(first.skip, null);
  assert.ok(first.skipped.some((entry) => entry.provider === "aniskip" && entry.reason === "not-found"));
  assert.ok(first.skipped.some((entry) => entry.provider === "anime-skip" && entry.reason === "no-key"));

  // 2) a rejected Anime Skip client id surfaces INVALID_KEY
  const rejected = noSkips.map((route) =>
    route.method === "POST" && route.url("https://api.anime-skip.com/graphql") === true
      ? {
          method: "POST",
          url: (u) => u.indexOf("api.anime-skip.com/graphql") >= 0,
          reply: () => ({ body: { errors: [{ message: "Invalid X-Client-ID header, API client not found" }] } }),
        }
      : route
  );
  const rejectedClient = new Shogo({ fetch: mockFetch(rejected), keys: { "anime-skip": "bogus" }, rateLimits: FAST_RATES });
  const second = await rejectedClient.episode("mal:21", { number: 1, providers: ["kitsu"] });
  assert.equal(second.skip, null);
  assert.ok(second.errors.some((entry) => entry.provider === "anime-skip" && entry.code === "INVALID_KEY"));

  // 3) Anime Skip without an AniList id to map the show with
  const kitsuOnly = new Shogo({
    fetch: mockFetch(noSkips),
    keys: { "anime-skip": "cid" },
    providers: ["kitsu"],
    rateLimits: FAST_RATES,
  });
  const third = await kitsuOnly.episode("mal:21", { number: 1, providers: ["kitsu"], skipProviders: ["anime-skip"] });
  assert.equal(third.skip, null);
  assert.ok(third.skipped.some((entry) => entry.provider === "anime-skip" && entry.reason === "no-anilist-id"));

  // 4) backend mode may hold the key server-side: no MISSING_KEY throw
  const backend = new Shogo({ fetch: mockFetch(routes()), proxy: "/api/proxy", rateLimits: FAST_RATES });
  const fourth = await backend.skipTimes("mal:21", { number: 1, skipProviders: ["anime-skip"] });
  assert.equal(fourth, null); // the proxied attempt is captured, not thrown as MISSING_KEY
});

test("kitsu page limit is capped at its upstream maximum (20)", async () => {
  const { client, fetchImpl } = makeClient();
  await client.search("one piece", { limit: 24 });
  const kitsuCall = fetchImpl.calls.map((c) => c.url).find((u) => u.indexOf("kitsu.io/api/edge/anime?filter[text]=") >= 0);
  assert.ok(kitsuCall, "kitsu search was called");
  assert.ok(kitsuCall.indexOf("page[limit]=20") >= 0, "capped limit in: " + kitsuCall);
});

test("episode lists report totals and truncation; offset pages through them", async () => {
  const fullPage = (offset) => {
    const items = [];
    for (let i = 1; i <= 20; i++) {
      items.push({
        id: "e" + (offset + i),
        type: "episodes",
        attributes: { number: offset + i, canonicalTitle: "Ep " + (offset + i), airdate: null, length: 24, thumbnail: null },
      });
    }
    return items;
  };
  const paged = routes().map((route) =>
    route.url("https://kitsu.io/api/edge/anime/12/episodes") === true
      ? {
          url: (u) => u.indexOf("kitsu.io/api/edge/anime/12/episodes") >= 0,
          reply: (u) => {
            const match = /page\[offset\]=(\d+)/.exec(u);
            const offset = match ? Number(match[1]) : 0;
            return { body: { data: fullPage(offset), meta: { count: 1184 } } };
          },
        }
      : route
  );
  const client = new Shogo({ fetch: mockFetch(paged), rateLimits: FAST_RATES });

  const first = await client.episodes("mal:21", { providers: ["kitsu"] });
  assert.equal(first.length, 60); // 3 pages x 20
  assert.deepEqual(first.consolidated.providers.kitsu, {
    mode: "flat",
    season: null,
    count: 60,
    total: 1184,
    truncated: true,
  });
  assert.equal(first.consolidated.truncated, true);

  const second = await client.episodes("mal:21", { providers: ["kitsu"], offset: 20 });
  assert.equal(second[0].number, 21);
  assert.equal(second.consolidated.providers.kitsu.total, 1184);
});

test("entry seasons are labeled with their relation title, not just a number", async () => {
  const { client } = makeClient();
  const list = await client.seasons("mal:21");
  assert.equal(list.length, 2);
  assert.equal(list[1].kind, "entry");
  assert.equal(list[1].name, "ONE PIECE (remake)");
  assert.equal(list[1].relation, "SEQUEL");
  assert.equal(list[1].ids.mal, 56055);
});

test("findById merges jikan + anilist + kitsu + animap into one shape", async () => {
  const { client, fetchImpl } = makeClient();
  const anime = await client.findById("mal:21");
  assert.equal(anime.ids.mal, 21);
  assert.equal(anime.ids.anilist, 21);
  assert.equal(anime.ids.kitsu, 12);
  assert.equal(anime.ids.shogo, "12000000210000002117");
  assert.equal(anime.titles.romaji, "One Piece");
  assert.equal(anime.titles.native, "ワンピース");
  assert.equal(anime.synopsis, "Gold Roger was known as the Pirate King."); // kitsu is the default source
  assert.equal(anime.fieldSources.synopsis, "kitsu");
  assert.equal(anime.episodes, 1184);
  assert.equal(anime.durationSec, 1440);
  assert.equal(anime.slug, "one-piece");
  assert.deepEqual(anime.sources.slice().sort(), ["anilist", "animap", "jikan", "kitsu"]);
  assert.equal(anime.meta.providersQueried.length, 4);
  assert.ok(anime.errors.length === 0);
  assert.ok(fetchImpl.calls.length >= 4);

  // A second call is served from cache + the negative/short TTLs still hold.
  const again = await client.findById("mal:21");
  assert.equal(again.ids.shogo, "12000000210000002117");
});

test("bare ids are shogo ids; invalid ones throw with a hint", async () => {
  const { client } = makeClient();
  const anime = await client.findById(2105);
  assert.equal(anime.ids.mal, 21);
  await assert.rejects(client.findById(21), (err) => {
    assert.ok(err instanceof InvalidIdError);
    assert.ok(err.message.indexOf("mal:21") >= 0, "hint present: " + err.message);
    return true;
  });
});

test("findBySlug uses the native Kitsu slug; bare text resolves as a slug", async () => {
  const { client } = makeClient();
  const match = await client.findBySlug("one-piece");
  assert.equal(match.best.confidence, 1);
  assert.equal(match.best.ids.kitsu, 12);
  assert.deepEqual(match.best.reasons, ["native kitsu slug"]);

  const viaFind = await client.findById("one-piece");
  assert.equal(viaFind.ids.mal, 21);
  assert.equal(viaFind.ids.kitsu, 12);
});

test("identify estimates the best anime with a probability score", async () => {
  const { client } = makeClient();
  const guess = await client.identify("bocchi the rock");
  assert.ok(guess.best, "has a best match");
  assert.equal(guess.best.ids.mal, 47917);
  assert.equal(guess.best.ids.kitsu, 44196);
  assert.ok(guess.best.confidence >= 0.8, "confidence: " + guess.best.confidence);
  assert.ok(guess.candidates.length >= 1);
  assert.ok(guess.best.reasons.length >= 1);
});

test("episodes default to the default source (kitsu) and can be tagged per provider", async () => {
  const { client, fetchImpl } = makeClient();
  const eps = await client.episodes("mal:21");
  assert.deepEqual(eps.sources, ["kitsu"]);
  assert.equal(eps.length, 1);
  assert.equal(eps.consolidated.providers.kitsu.mode, "flat");
  const kitsuCalls = () => fetchImpl.calls.filter((c) => c.url.indexOf("kitsu.io/api/edge/anime/12/episodes") >= 0).length;
  assert.equal(kitsuCalls(), 1);
  assert.ok(!fetchImpl.calls.some((c) => c.url.indexOf("jikan.moe/v4/anime/21/episodes") >= 0));

  const jikanOnly = await client.episodes("mal:21", { providers: ["jikan"] });
  assert.deepEqual(jikanOnly.sources, ["jikan"]);
  assert.equal(jikanOnly.length, 2);
  assert.equal(kitsuCalls(), 1, "kitsu was not asked again for a jikan-only request");

  const all = await client.episodes("mal:21", { providers: "all" });
  assert.ok(all.sources.indexOf("jikan") >= 0);
});

test("episodes merge and episode() returns the full context", async () => {
  const { client } = makeClient({ "anime-skip": "test-client-id" });
  const eps = await client.episodes("mal:21", { providers: ["jikan", "kitsu"] });
  assert.equal(eps.length, 2);
  assert.equal(eps[0].title, "I'm Luffy! The Man Who Will Become the Pirate King!"); // jikan wins
  assert.equal(eps[0].images.length, 1); // kitsu thumbnail merged in
  assert.deepEqual(eps[0].sources.slice().sort(), ["jikan", "kitsu"]);
  assert.ok(Array.isArray(eps.errors));
  // consolidation report: kitsu's one episode aligned with jikan's #1
  assert.equal(eps.consolidated.providers.kitsu.count, 1);
  assert.equal(eps.consolidated.matched, 1);
  assert.deepEqual(eps.consolidated.unmatched, {});
  assert.deepEqual(eps[0].refs.kitsu, { number: 1, season: null, absoluteNumber: null });

  const ctx = await client.episode("mal:21", { season: 1, number: 1, providers: ["jikan", "kitsu"] });
  assert.equal(ctx.anime.ids.mal, 21);
  assert.equal(ctx.episode.number, 1);
  assert.equal(ctx.episode.absoluteNumber == null, true);
  assert.equal(ctx.skip.source, "aniskip"); // keyless default
  assert.equal(ctx.skip.op.start, 310.571);
  assert.equal(ctx.skip.ed.end, 1434);
  assert.equal(ctx.skip.recap.start, 132.773);
  assert.ok(ctx.images.length >= 1);
  assert.equal(ctx.season.number, 1);
});

test("consolidation aligns flat + season + absolute lists and surfaces unmatched", async () => {
  const { client } = makeClient({ tmdb: "test-key", "anime-skip": "test-client-id" });
  const eps = await client.episodes(
    { mal: 21, anilist: 21, tmdb: { tv: 37854 } },
    { providers: ["jikan", "kitsu", "tmdb", "anime-skip"] }
  );
  const first = eps.find((e) => String(e.number) === "1" && (e.season == null || Number(e.season) === 1));
  assert.deepEqual(Object.keys(first.refs).sort(), ["anime-skip", "jikan", "kitsu", "tmdb"]);
  assert.equal(first.refs.tmdb.season, 1);
  assert.equal(first.refs["anime-skip"].number, "1");
  assert.equal(first.absoluteNumber, "1");
  assert.deepEqual(eps.consolidated.providers.jikan, { mode: "flat", season: null, count: 2 });
  assert.deepEqual(eps.consolidated.providers.tmdb, { mode: "season", season: null, seasons: [1, 2], count: 2 });
  assert.ok(eps.consolidated.matched >= 1);
  // TMDB season 2 episode 5 matches nothing -> surfaced, not dropped
  const seasonTwo = eps.find((e) => Number(e.season) === 2);
  assert.ok(seasonTwo, "season 2 episode is present");
  assert.equal(String(seasonTwo.number), "5");
  assert.deepEqual(seasonTwo.sources, ["tmdb"]);
  assert.deepEqual(eps.consolidated.unmatched.tmdb, [{ number: 5, season: 2 }]);
});

test("episode() finds an episode by absoluteNumber via tagged providers", async () => {
  const { client } = makeClient({ "anime-skip": "test-client-id" });
  const ctx = await client.episode(
    { mal: 21, anilist: 21 },
    { absoluteNumber: 1, providers: ["jikan", "anime-skip"] }
  );
  assert.equal(String(ctx.episode.number), "1");
  assert.equal(ctx.episode.absoluteNumber, "1");
  assert.ok(ctx.episode.refs["anime-skip"], "anime-skip numbering is attached");
  assert.ok(ctx.episode.refs.jikan);
});

test("screenshots come from TMDB episode images when a key is present", async () => {
  const { client } = makeClient({ tmdb: "test-key" });
  const shots = await client.screenshots("tmdb:tv:37854", { season: 1, number: 1 });
  assert.equal(shots.images.length, 1);
  assert.ok(shots.images[0].url.indexOf("still1.jpg") >= 0);
  assert.deepEqual(shots.sources, ["tmdb"]);
});

test("skipTimes defaults to AniSkip (keyless, real ranges)", async () => {
  const { client } = makeClient();
  const skip = await client.skipTimes("mal:21", { number: 1 });
  assert.equal(skip.source, "aniskip");
  assert.deepEqual(skip.op, { start: 310.571, end: 400.571, type: "op" });
  assert.equal(skip.ed.start, 1396.006);
  assert.equal(skip.recap.end, 201.296);
  assert.ok(skip.meta !== undefined);
});

test("Anime Skip is used only when asked for, and then demands its client id", async () => {
  const { client } = makeClient();
  await assert.rejects(client.skipTimes("mal:21", { number: 1, skipProviders: ["anime-skip"] }), (err) => {
    assert.equal(err.code, "MISSING_KEY");
    assert.ok(err.message.indexOf("anime-skip") >= 0);
    return true;
  });

  const keyed = makeClient({ "anime-skip": "test-client-id" });
  const skip = await keyed.client.skipTimes("mal:21", { number: 1, skipProviders: ["anime-skip"] });
  assert.equal(skip.source, "anime-skip");
  assert.equal(skip.op.end, 135);
});

test("AniSkip not-found falls back to a configured Anime Skip", async () => {
  const notFound = routes().map((route) =>
    route.url("https://api.aniskip.com/v2/skip-times/21/1?") === true
      ? {
          url: (u) => u.indexOf("api.aniskip.com/v2/skip-times/21/1?") >= 0,
          reply: { status: 404, body: { found: false, results: [], message: "No skip times found", statusCode: 404 } },
        }
      : route
  );
  const client = new Shogo({ fetch: mockFetch(notFound), keys: { "anime-skip": "test-client-id" }, rateLimits: FAST_RATES });
  const skip = await client.skipTimes("mal:21", { number: 1 });
  assert.equal(skip.source, "anime-skip");
  assert.equal(skip.op.end, 135);
  assert.ok(skip.skipped.some((entry) => entry.provider === "aniskip" && entry.reason === "not-found"));
});

test("catalog works from an offline snapshot (titles <-> shogo ids, zero network)", async () => {
  const { client } = makeClient();
  client.offline.load({
    data: [
      {
        sources: ["https://myanimelist.net/anime/21", "https://anilist.co/anime/21", "https://kitsu.app/anime/12"],
        title: "One Piece",
        synonyms: ["OP"],
        type: "TV",
        episodes: 1184,
        status: "ONGOING",
        animeSeason: { season: "FALL", year: 1999 },
      },
      {
        sources: ["https://myanimelist.net/anime/31964", "https://anilist.co/anime/31964"],
        title: "Boku no Hero Academia",
        type: "TV",
        episodes: 13,
        status: "FINISHED",
        animeSeason: { season: "SPRING", year: 2016 },
      },
    ],
  });
  const cat = await client.catalog();
  assert.equal(cat.size, 2);
  assert.equal(cat.bySlug("one-piece").mal, 21);
  assert.equal(cat.byShogoId("12000000210000002117").mal, 21);
  const found = cat.search("boku no hero academia");
  assert.equal(found[0].mal, 31964);

  const resolved = await client.resolve("kitsu:12", { to: ["mal"] });
  assert.equal(resolved.ids.mal, 21);
});

test("resolve fills targets, reports missing; dryRun plans; selectors project", async () => {
  const { client } = makeClient();
  const result = await client.resolve("mal:21", { to: ["anilist", "kitsu", "imdb"] });
  assert.equal(result.ids.anilist, 21);
  assert.equal(result.ids.kitsu, 12);
  assert.deepEqual(result.missing, ["imdb"]);
  assert.deepEqual(result.conflicts, []);

  const plan = await client.findById("mal:21", { dryRun: true });
  assert.ok(Array.isArray(plan.plan));
  assert.ok(plan.plan.some((p) => p.provider === "jikan"));

  const projected = await client.findById("mal:21", { include: ["titles", "ids.shogo"] });
  assert.equal(projected.titles.romaji, "One Piece");
  assert.equal(projected.synopsis, undefined);
  assert.equal(projected.ids.mal, 21); // ids are always kept

  const without = await client.findById("mal:21", { exclude: ["synopsis", "relations"] });
  assert.equal(without.synopsis, undefined);
});

test("config.providers is a hard allow-list, including for search", async () => {
  const fetchImpl = mockFetch(routes());
  const client = new Shogo({
    fetch: fetchImpl,
    providers: ["anilist", "kitsu"],
    rateLimits: FAST_RATES,
  });
  const found = await client.search("bocchi the rock");
  const contributed = [];
  for (const result of found.results) for (const source of result.sources) if (contributed.indexOf(source) < 0) contributed.push(source);
  assert.deepEqual(contributed.sort(), ["anilist", "kitsu"]);
});

test("stats() and providers introspection", async () => {
  const { client } = makeClient({ tmdb: "test-key" });
  assert.deepEqual(client.providers.configured().sort(), ["anilist", "animap", "aniskip", "imdb", "jikan", "kitsu", "tmdb"]);
  assert.equal(client.providers.capabilities("anilist").mapping, true);
  assert.equal(client.providers.requiresKey("kitsu"), false);
  await client.findById("mal:21");
  const stats = client.stats();
  assert.ok(stats.http.requests > 0);
  assert.ok(stats.providers.jikan.configured);
});
