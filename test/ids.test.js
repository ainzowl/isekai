import test from "node:test";
import assert from "node:assert/strict";

import {
  toIsekai,
  fromIsekai,
  isIsekaiId,
  equivalent,
  mergeIsekai,
  slugify,
  parseId,
  formatId,
  overlaps,
  idsKey,
  coerceIds,
} from "../src/core/ids.js";
import { InvalidIdError } from "../src/core/errors.js";

test("isekai id: frozen vectors", () => {
  // Frozen vectors verified before implementation.
  assert.equal(toIsekai({ mal: 21 }), "2105");
  assert.equal(toIsekai({ mal: 1 }), "103");
  assert.equal(toIsekai({ mal: 31964 }), "3196455");
  assert.equal(toIsekai({ mal: 21, anilist: 21, kitsu: 12 }), "12000000210000002117");
  assert.deepEqual(fromIsekai("2105"), { mal: 21 });
  assert.deepEqual(fromIsekai("12000000210000002117"), { mal: 21, anilist: 21, kitsu: 12 });
});

test("isekai id: round-trips for a deterministic sample", () => {
  for (let mal = 1; mal <= 500; mal++) {
    const id = toIsekai({ mal });
    assert.deepEqual(fromIsekai(id), { mal });
  }
  for (const sample of [[21, 21, 12], [31964, 31964, 44196], [16498, 16498, 11469], [11061, 11061, 6448]]) {
    const id = toIsekai({ mal: sample[0], anilist: sample[1], kitsu: sample[2] });
    assert.deepEqual(fromIsekai(id), { mal: sample[0], anilist: sample[1], kitsu: sample[2] });
  }
});

test("isekai id: corruption, non-canonical forms, invalid input", () => {
  assert.equal(fromIsekai("2106"), null); // one digit changed -> checksum fails
  assert.equal(fromIsekai("21"), null); // too short
  assert.equal(fromIsekai("02105"), null); // non-canonical leading zero
  assert.equal(fromIsekai("21050"), null); // extra digit
  assert.equal(fromIsekai(""), null);
  assert.equal(fromIsekai(null), null);
  assert.equal(isIsekaiId("2105"), true);
  assert.equal(isIsekaiId("21"), false);
  assert.throws(() => toIsekai({}), InvalidIdError);
  assert.throws(() => toIsekai({ mal: 123456789 }), InvalidIdError);
  assert.throws(() => toIsekai({ mal: "abc" }), InvalidIdError);
});

test("isekai id: merge and equivalence", () => {
  const partial = toIsekai({ mal: 21 });
  const full = toIsekai({ mal: 21, anilist: 21, kitsu: 12 });
  assert.equal(equivalent(partial, full), true);
  assert.equal(equivalent(toIsekai({ mal: 21 }), toIsekai({ mal: 22 })), false);
  assert.equal(equivalent(toIsekai({ mal: 21 }), toIsekai({ anilist: 21 })), false); // disjoint, unknown

  const union = mergeIsekai(partial, full);
  assert.deepEqual(union.ids, { mal: 21, anilist: 21, kitsu: 12 });
  assert.deepEqual(union.conflicts, []);

  const conflict = mergeIsekai(toIsekai({ mal: 21 }), toIsekai({ mal: 22, anilist: 21 }));
  assert.deepEqual(conflict.conflicts, [{ slot: "mal", kept: 21, dropped: 22 }]);
  assert.equal(conflict.ids.mal, 21);
  assert.equal(conflict.ids.anilist, 21);
});

test("slugify", () => {
  assert.equal(slugify("Bocchi the Rock!"), "bocchi-the-rock");
  assert.equal(slugify("Steins;Gate"), "steins-gate");
  assert.equal(slugify("Kimi no Na wa."), "kimi-no-na-wa");
  assert.equal(slugify("Étoile"), "etoile");
  assert.equal(slugify("  Multiple   Spaces  "), "multiple-spaces");
  assert.equal(slugify("L'Attaque des Titans"), "lattaque-des-titans");
  assert.equal(slugify("Re:ZERO -Starting Life in Another World-"), "re-zero-starting-life-in-another-world");
});

test("parseId: every accepted form", () => {
  assert.deepEqual(parseId(2105), { kind: "isekai", isekai: "2105", ids: { mal: 21 } });
  assert.deepEqual(parseId("2105"), { kind: "isekai", isekai: "2105", ids: { mal: 21 } });
  assert.deepEqual(parseId({ mal: 21 }), { kind: "ids", ids: { mal: 21 } });
  assert.deepEqual(parseId("mal:21"), { kind: "ids", ids: { mal: 21 } });
  assert.deepEqual(parseId("tmdb:tv:37854"), { kind: "ids", ids: { tmdb: { tv: 37854 } } });
  assert.deepEqual(parseId("tt0388629"), { kind: "ids", ids: { imdb: "tt0388629" } });
  assert.deepEqual(parseId("slug:One Piece"), { kind: "slug", slug: "one-piece" });
  assert.deepEqual(parseId("one-piece"), { kind: "slug", slug: "one-piece" });
  assert.deepEqual(parseId("One Piece!"), { kind: "slug", slug: "one-piece" });
  assert.throws(() => parseId(21), InvalidIdError); // bare non-isekai number
  assert.throws(() => parseId("nope:1"), InvalidIdError);
  assert.throws(() => parseId(null), InvalidIdError);
});

test("formatId / overlaps / idsKey / coerceIds", () => {
  assert.equal(formatId({ anilist: 21, mal: 21 }), "mal:21");
  assert.equal(formatId({ tmdb: { movie: 129 } }), "tmdb:movie:129");
  assert.equal(overlaps({ mal: 21 }, { mal: 21, kitsu: 12 }), true);
  assert.equal(overlaps({ mal: 21 }, { anilist: 21 }), false);
  assert.equal(idsKey({ mal: 21, anilist: 21 }), idsKey({ anilist: 21, mal: 21 }));
  assert.deepEqual(coerceIds({ mal: "21", isekai: "2105" }), { mal: 21 });
  assert.deepEqual(coerceIds({ imdb: "TT0388629" }), { imdb: "tt0388629" });
  assert.throws(() => coerceIds({ imdb: "nope" }), InvalidIdError);
});
