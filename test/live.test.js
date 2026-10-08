/**
 * Live tests (opt-in): ISEKAI_LIVE=1 npm test
 * These hit real APIs; the default `npm test` is fixture-only.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Isekai } from "../src/index.js";

const live = process.env.ISEKAI_LIVE === "1";
const maybe = live ? test : test.skip;

maybe("live: findById merges AniList + Kitsu + animap for mal:21", async () => {
  // Jikan is excluded: api.jikan.moe was unreachable from the dev machine.
  const isekai = new Isekai({ providers: ["anilist", "kitsu", "animap"] });
  const anime = await isekai.findById("mal:21");
  assert.equal(anime.ids.mal, 21);
  assert.equal(anime.ids.kitsu, 12);
  assert.equal(anime.ids.anilist, 21);
  assert.equal(anime.ids.isekai, "12000000210000002117");
  assert.ok(anime.titles.romaji);
  assert.ok(anime.sources.indexOf("kitsu") >= 0, "kitsu contributed: " + anime.sources.join(","));
});

maybe("live: bare isekai id decodes and resolves", async () => {
  const isekai = new Isekai({ providers: ["anilist", "animap"] });
  const anime = await isekai.findById(2105);
  assert.equal(anime.ids.mal, 21);
});

maybe("live: kitsu native slug lookup", async () => {
  const isekai = new Isekai({ providers: ["kitsu"] });
  const match = await isekai.findBySlug("bocchi-the-rock");
  assert.equal(match.best.ids.kitsu, 44196);
  assert.equal(match.best.ids.mal, 47917);
  assert.equal(match.best.confidence, 1);
});

maybe("live: identify across the keyless providers", async () => {
  const isekai = new Isekai({ providers: ["kitsu", "anilist"] });
  const guess = await isekai.identify("bocchi the rock", { providers: ["kitsu", "anilist"] });
  assert.ok(guess.best);
  assert.equal(guess.best.ids.mal, 47917);
  // Legit sequels/recaps in the candidate pool dilute the probability on
  // purpose ("Bocchi the Rock! Re:" etc.), so the bar is 0.7 here.
  assert.ok(guess.best.confidence >= 0.7, "confidence " + guess.best.confidence);
  const sequelSlugs = guess.candidates.filter((c) => c.confidence > 0).map((c) => c.slug);
  assert.ok(sequelSlugs.length >= 3, "sequels are candidates, not lost: " + sequelSlugs.join(", "));
});
