import test from "node:test";
import assert from "node:assert/strict";

import { mergeAnime, mergeDefaults } from "../src/core/merge.js";

function partials() {
  return [
    {
      provider: "jikan",
      data: {
        ids: { mal: 21 },
        titles: { romaji: "One Piece", native: "ワンピース" },
        synonymTitles: ["OP"],
        episodes: null,
        durationSec: 1440,
        synopsis: "jikan synopsis",
        genres: ["Action", "Adventure"],
        images: { posters: [{ url: "p1" }], banners: [], logos: [], thumbnails: [] },
        links: {
          official: "https://one-piece.com/",
          streaming: [{ service: "crunchyroll", url: "u1", dub: null, subs: null }],
          external: [],
        },
      },
    },
    {
      provider: "anilist",
      data: {
        ids: { anilist: 21, mal: 21 },
        titles: { romaji: "One Piece", english: "One Piece" },
        episodes: 1184,
        status: "RELEASING",
        synopsis: "anilist synopsis",
        tags: ["Pirates"],
        genres: ["Adventure", "Fantasy"],
        images: { posters: [{ url: "p1" }, { url: "p2" }], banners: [{ url: "b1" }], logos: [], thumbnails: [] },
        relations: [{ type: "SEQUEL", ids: { mal: 44245 }, title: "One Piece Film: Red", sources: ["anilist"] }],
        ratings: { anilist: { score: 8.7 } },
      },
    },
    {
      provider: "kitsu",
      data: {
        ids: { kitsu: 12 },
        slug: "one-piece",
        ratings: { kitsu: { score: 82.4, scale: 100 } },
        links: { streaming: [{ service: "crunchyroll", url: "u1", dub: true, subs: true }], external: [] },
      },
    },
  ];
}

test("merge: scalars follow precedence with provenance", () => {
  const anime = mergeAnime(partials());
  assert.deepEqual(anime.ids, { mal: 21, anilist: 21, kitsu: 12 });
  assert.equal(anime.synopsis, "anilist synopsis");
  assert.equal(anime.fieldSources.synopsis, "anilist");
  assert.equal(anime.episodes, 1184); // jikan had null
  assert.equal(anime.durationSec, 1440);
  assert.equal(anime.status, "RELEASING");
  assert.deepEqual(anime.titles.synonyms, ["OP"]);
  assert.equal(anime.titles.native, "ワンピース");
  assert.equal(anime.slug, "one-piece");
  assert.deepEqual(anime.sources, ["jikan", "anilist", "kitsu"]);
});

test("merge: arrays union in provider order, images dedupe by url", () => {
  const anime = mergeAnime(partials());
  assert.deepEqual(anime.genres, ["Action", "Adventure", "Fantasy"]);
  assert.deepEqual(anime.tags, ["Pirates"]);
  assert.equal(anime.images.posters.length, 2);
  assert.deepEqual(anime.images.posters.map((p) => p.url), ["p1", "p2"]);
  assert.equal(anime.images.posters[0].source, "jikan");
  assert.equal(anime.images.banners.length, 1);
  assert.equal(anime.relations.length, 1);
  assert.equal(anime.ratings.anilist.score, 8.7);
  assert.equal(anime.ratings.kitsu.score, 82.4);
});

test("merge: streaming links merge flags across providers", () => {
  const anime = mergeAnime(partials());
  assert.equal(anime.links.streaming.length, 1);
  assert.equal(anime.links.streaming[0].dub, true);
  assert.equal(anime.links.streaming[0].subs, true);
  assert.equal(anime.links.official, "https://one-piece.com/");
});

test("merge: falls back to a derived slug when no native slug exists", () => {
  const anime = mergeAnime([{ provider: "jikan", data: { ids: { mal: 1 }, titles: { romaji: "Cowboy Bebop" } } }]);
  assert.equal(anime.slug, "cowboy-bebop");
});

test("merge: isekai score averages provider scores (normalized to 10)", () => {
  const anime = mergeAnime(partials());
  // anilist 8.7 (scale 10) and kitsu 82.4 (scale 100 -> 8.24)
  assert.equal(anime.score.providers, 2);
  assert.deepEqual(anime.score.breakdown, { anilist: 8.7, kitsu: 8.24 });
  assert.equal(anime.score.value, 8.47);
  assert.equal(anime.score.scale, 10);
});

test("merge: isekai score is null when nothing is scored", () => {
  const anime = mergeAnime([{ provider: "jikan", data: { ids: { mal: 1 }, titles: { romaji: "Cowboy Bebop" } } }]);
  assert.equal(anime.score, null);
});

test("mergeDefaults is exported and overridable", () => {
  assert.ok(Array.isArray(mergeDefaults.scalar.synopsis));
  const anime = mergeAnime([{ provider: "jikan", data: { ids: { mal: 1 }, synopsis: "from jikan" } }], {
    mergeDefaults: { synopsis: ["jikan"] },
  });
  assert.equal(anime.synopsis, "from jikan");
});
