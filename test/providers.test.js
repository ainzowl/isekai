import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeAnime as normalizeJikan } from "../src/providers/jikan.js";
import { normalizeAnime as normalizeKitsu, mappingIdsFrom } from "../src/providers/kitsu.js";
import { normalizeMedia } from "../src/providers/anilist.js";
import { parseSources, normalizeRecord } from "../src/providers/animap.js";
import animeskipProvider, { normalizeSkipTimes } from "../src/providers/animeskip.js";
import aniskipProvider, { normalizeSkipResults } from "../src/providers/aniskip.js";
import { InvalidApiKeyError, MissingApiKeyError } from "../src/core/errors.js";

const read = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));

test("jikan: normalizeAnime", () => {
  const canvas = normalizeJikan(read("jikan-anime-21.json").data);
  assert.deepEqual(canvas.ids, { mal: 21 });
  assert.equal(canvas.titles.romaji, "One Piece");
  assert.equal(canvas.titles.native, "ワンピース");
  assert.equal(canvas.type, "TV");
  assert.equal(canvas.status, "RELEASING");
  assert.equal(canvas.durationSec, 1440);
  assert.deepEqual(canvas.season, { season: "FALL", year: 1999 });
  assert.equal(canvas.ratings.mal.score, 8.73);
  assert.equal(canvas.images.posters.length, 1);
  assert.ok(canvas.images.posters[0].url.indexOf("73245l") >= 0);
  assert.equal(canvas.links.streaming[0].service, "crunchyroll");
  assert.equal(canvas.links.external[0].service, "official-site");
  assert.equal(canvas.relations[0].type, "SEQUEL");
  assert.equal(canvas.relations[0].ids.mal, 44245);
});

test("kitsu: mapping ids from a live captured mappings response", () => {
  const mappings = read("kitsu-anime12-mappings.json").data.map((m) => m.attributes);
  const ids = mappingIdsFrom(mappings);
  assert.equal(ids.mal, 21);
  assert.equal(ids.anidb, 69);
  assert.equal(ids.tvdb, 81797);
  assert.equal(ids.anilist, 21);
  assert.equal(ids.trakt, 37696);
});

test("kitsu: normalizeAnime with includes (slug, mappings, streaming flags, categories)", () => {
  const fixture = read("kitsu-anime-12.json");
  const canvas = normalizeKitsu(fixture.data, fixture.included);
  assert.equal(canvas.ids.kitsu, 12);
  assert.equal(canvas.ids.mal, 21);
  assert.equal(canvas.slug, "one-piece");
  assert.equal(canvas.titles.native, "ワンピース");
  assert.equal(canvas.durationSec, 1440);
  assert.equal(canvas.status, "RELEASING");
  assert.equal(canvas.links.streaming[0].service, "crunchyroll");
  assert.equal(canvas.links.streaming[0].dub, true);
  assert.equal(canvas.links.streaming[0].subs, true);
  assert.deepEqual(canvas.tags, ["Pirates"]);
});

test("anilist: normalizeMedia from the captured GraphQL sample", () => {
  const data = read("anilist-mini.json").data;
  const onePiece = normalizeMedia(data.onePiece);
  assert.deepEqual(onePiece.ids, { anilist: 21, mal: 21 });
  assert.equal(onePiece.type, null); // the research query did not request `format`
  assert.equal(onePiece.links.streaming.length > 0, true);
  assert.equal(onePiece.links.streaming[0].service, "crunchyroll");
  assert.equal(onePiece.links.external.some((e) => e.url.indexOf("one-piece.com") >= 0), true);
  // AniList external links do NOT contain IMDb/TMDB (that's why TMDB is the bridge).
  assert.equal(onePiece.links.external.some((e) => e.url.indexOf("imdb.com") >= 0), false);

  const eva = normalizeMedia(data.eva);
  assert.deepEqual(eva.ids, { anilist: 30, mal: 30 });
  assert.equal(eva.images.banners.length, 1);
});

test("animap: parseSources + normalizeRecord from the captured record", () => {
  const record = read("animap-mal21.json");
  const ids = parseSources(record.sources);
  assert.equal(ids.mal, 21);
  assert.equal(ids.kitsu, 12);
  assert.equal(ids.anilist, 21);
  assert.equal(ids.anidb, 69);
  assert.equal(ids.ann, 836);
  assert.equal(ids.animeplanet, "one-piece");
  assert.equal(ids.simkl, 38636);

  const canvas = normalizeRecord(record);
  assert.equal(canvas.titles.romaji, "One Piece");
  assert.equal(canvas.episodes, 1184);
  assert.equal(canvas.status, "RELEASING");
  assert.deepEqual(canvas.season, { season: "FALL", year: 1999 });
  assert.equal(canvas.durationSec, 1440);
  assert.equal(canvas.synonymTitles.length > 0, true);
});

test("aniskip: normalizeSkipResults maps real ranges from the captured response", () => {
  const fixture = read("aniskip-mal21-ep1.json");
  const skip = normalizeSkipResults(fixture.results);
  assert.equal(skip.source, "aniskip");
  assert.deepEqual(skip.op, { start: 310.571, end: 400.571, type: "op" });
  assert.deepEqual(skip.ed, { start: 1396.006, end: 1434, type: "ed" });
  assert.deepEqual(skip.recap, { start: 132.773, end: 201.296, type: "recap" });
  assert.equal(skip.episodeLength, 1443.984);
  assert.equal(skip.other, undefined);

  // mixed-* variants fold into op/ed but keep their original type
  const mixed = normalizeSkipResults([
    { interval: { startTime: 90, endTime: 120 }, skipType: "mixed-op" },
    { interval: { startTime: 1400, endTime: 1430 }, skipType: "mixed-ed" },
  ]);
  assert.equal(mixed.op.type, "mixed-op");
  assert.equal(mixed.ed.type, "mixed-ed");
});

test("anime-skip: API auth errors map to actionable errors", async () => {
  const ctxFor = (message) => ({
    baseUrl: "https://api.anime-skip.com/graphql",
    key: "whatever",
    http: { postJson: async () => ({ data: { errors: [{ message }] } }) },
  });
  await assert.rejects(animeskipProvider.gql(ctxFor("The X-Client-ID header must be passed"), "q"), MissingApiKeyError);
  await assert.rejects(animeskipProvider.gql(ctxFor("Invalid X-Client-ID header, API client not found"), "q"), (err) => {
    assert.ok(err instanceof InvalidApiKeyError, "expected InvalidApiKeyError, got " + err.name);
    assert.equal(err.code, "INVALID_KEY");
    assert.ok(err.message.indexOf("API clients") >= 0, err.message);
    return true;
  });
});

test("anime-skip: normalizeSkipTimes derives ranges from points", () => {
  const skip = normalizeSkipTimes([
    { at: 0.5, type: "Recap" },
    { at: 135, type: "Intro" },
    { at: 1250, type: "Outro" },
    { at: 1430, type: "Preview" },
  ]);
  assert.deepEqual(skip.recap, { start: 0, end: 0.5 });
  assert.deepEqual(skip.op, { start: 0, end: 135 });
  assert.deepEqual(skip.ed, { start: 1250, end: 1430 });
  assert.deepEqual(skip.preview, { start: 1430, end: null });
  assert.equal(skip.points.length, 4);
  assert.equal(skip.source, "anime-skip");
});
