// node examples/02-ids.mjs
//
// Zero network. Just the id layer: packed shogo ids, parsing rules, slugs.
// Everything here is pure math and string work.

import { ids } from "../src/index.js";
import { section, line, note } from "./_shared.mjs";

const { toShogo, fromShogo, mergeShogo, equivalent, slugify, parseId } = ids;

section("pack MAL + AniList + Kitsu into one number (no database)");
line("toShogo({ mal: 21 })", toShogo({ mal: 21 }));
line("toShogo({ mal: 1 })", toShogo({ mal: 1 }));
line("toShogo({ mal: 21, anilist: 21, kitsu: 12 })", toShogo({ mal: 21, anilist: 21, kitsu: 12 }));
line("fromShogo('2105')", JSON.stringify(fromShogo("2105")));
line("fromShogo('12000000210000002117')", JSON.stringify(fromShogo("12000000210000002117")));

section("typos fail the checksum -> null, never the wrong anime");
line("fromShogo('2106')", String(fromShogo("2106")));
line("fromShogo('02105')", String(fromShogo("02105")));

section("equivalence is id-set intersection, not string equality");
const partial = toShogo({ mal: 21 });
const full = toShogo({ mal: 21, anilist: 21, kitsu: 12 });
line("equivalent(partial, full)", String(equivalent(partial, full)));
line("equivalent(mal:21, mal:22)", String(equivalent(toShogo({ mal: 21 }), toShogo({ mal: 22 }))));
line("mergeShogo(partial, full)", JSON.stringify(mergeShogo(partial, full)));

section("input forms (parseId)");
for (const input of ["mal:21", "tmdb:tv:37854", "tt0388629", "One Piece!", 2105, 21]) {
  try {
    line(JSON.stringify(input), JSON.stringify(parseId(input)));
  } catch (err) {
    line(JSON.stringify(input), err.code + ": " + err.message.slice(0, 60) + "...");
  }
}

section("slugs");
line("slugify('Bocchi the Rock!')", slugify("Bocchi the Rock!"));
line("slugify('Steins;Gate')", slugify("Steins;Gate"));
line("slugify('Étoile de mer')", slugify("Étoile de mer"));

note("big ids must be strings: findById('" + full + "')");
note("numbers only work while they stay <= Number.MAX_SAFE_INTEGER");
