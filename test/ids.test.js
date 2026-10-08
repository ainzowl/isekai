import test from "node:test";
import assert from "node:assert/strict";

import {
  toShogo,
  fromShogo,
  isShogoId,
  equivalent,
  mergeShogo,
  slugify,
  parseId,
  formatId,
  overlaps,
  idsKey,
  coerceIds,
} from "../src/core/ids.js";
import { InvalidIdError } from "../src/core/errors.js";

test("shogo id: frozen vectors", () => {
  // Frozen vectors verified before implementation.
  assert.equal(toShogo({ mal: 21 }), "2105");
  assert.equal(toShogo({ mal: 1 }), "103");
  assert.equal(toShogo({ mal: 31964 }), "3196455");
  assert.equal(toShogo({ mal: 21, anilist: 21, kitsu: 12 }), "12000000210000002117");
  assert.deepEqual(fromShogo("2105"), { mal: 21 });
  assert.deepEqual(fromShogo("12000000210000002117"), { mal: 21, anilist: 21, kitsu: 12 });
});

test("shogo id: round-trips for a deterministic sample", () => {
  for (let mal = 1; mal <= 500; mal++) {
    const id = toShogo({ mal });
    assert.deepEqual(fromShogo(id), { mal });
  }
  for (const sample of [[21, 21, 12], [31964, 31964, 44196], [16498, 16498, 11469], [11061, 11061, 6448]]) {
    const id = toShogo({ mal: sample[0], anilist: sample[1], kitsu: sample[2] });
    assert.deepEqual(fromShogo(id), { mal: sample[0], anilist: sample[1], kitsu: sample[2] });
  }
});

test("shogo id: corruption, non-canonical forms, invalid input", () => {
  assert.equal(fromShogo("2106"), null); // one digit changed -> checksum fails
  assert.equal(fromShogo("21"), null); // too short
  assert.equal(fromShogo("02105"), null); // non-canonical leading zero
  assert.equal(fromShogo("21050"), null); // extra digit
  assert.equal(fromShogo(""), null);
  assert.equal(fromShogo(null), null);
  assert.equal(isShogoId("2105"), true);
  assert.equal(isShogoId("21"), false);
  assert.throws(() => toShogo({}), InvalidIdError);
  assert.throws(() => toShogo({ mal: 123456789 }), InvalidIdError);
  assert.throws(() => toShogo({ mal: "abc" }), InvalidIdError);
});

test("shogo id: merge and equivalence", () => {
  const partial = toShogo({ mal: 21 });
  const full = toShogo({ mal: 21, anilist: 21, kitsu: 12 });
  assert.equal(equivalent(partial, full), true);
  assert.equal(equivalent(toShogo({ mal: 21 }), toShogo({ mal: 22 })), false);
  assert.equal(equivalent(toShogo({ mal: 21 }), toShogo({ anilist: 21 })), false); // disjoint, unknown

  const union = mergeShogo(partial, full);
  assert.deepEqual(union.ids, { mal: 21, anilist: 21, kitsu: 12 });
  assert.deepEqual(union.conflicts, []);

  const conflict = mergeShogo(toShogo({ mal: 21 }), toShogo({ mal: 22, anilist: 21 }));
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
  assert.deepEqual(parseId(2105), { kind: "shogo", shogo: "2105", ids: { mal: 21 } });
  assert.deepEqual(parseId("2105"), { kind: "shogo", shogo: "2105", ids: { mal: 21 } });
  assert.deepEqual(parseId({ mal: 21 }), { kind: "ids", ids: { mal: 21 } });
  assert.deepEqual(parseId("mal:21"), { kind: "ids", ids: { mal: 21 } });
  assert.deepEqual(parseId("tmdb:tv:37854"), { kind: "ids", ids: { tmdb: { tv: 37854 } } });
  assert.deepEqual(parseId("tt0388629"), { kind: "ids", ids: { imdb: "tt0388629" } });
  assert.deepEqual(parseId("slug:One Piece"), { kind: "slug", slug: "one-piece" });
  assert.deepEqual(parseId("one-piece"), { kind: "slug", slug: "one-piece" });
  assert.deepEqual(parseId("One Piece!"), { kind: "slug", slug: "one-piece" });
  assert.throws(() => parseId(21), InvalidIdError); // bare non-shogo number
  assert.throws(() => parseId("nope:1"), InvalidIdError);
  assert.throws(() => parseId(null), InvalidIdError);
});

test("formatId / overlaps / idsKey / coerceIds", () => {
  assert.equal(formatId({ anilist: 21, mal: 21 }), "mal:21");
  assert.equal(formatId({ tmdb: { movie: 129 } }), "tmdb:movie:129");
  assert.equal(overlaps({ mal: 21 }, { mal: 21, kitsu: 12 }), true);
  assert.equal(overlaps({ mal: 21 }, { anilist: 21 }), false);
  assert.equal(idsKey({ mal: 21, anilist: 21 }), idsKey({ anilist: 21, mal: 21 }));
  assert.deepEqual(coerceIds({ mal: "21", shogo: "2105" }), { mal: 21 });
  assert.deepEqual(coerceIds({ imdb: "TT0388629" }), { imdb: "tt0388629" });
  assert.throws(() => coerceIds({ imdb: "nope" }), InvalidIdError);
});
