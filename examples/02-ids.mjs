// node examples/02-ids.mjs
//
// Zero network. Just the id layer: packed isekai ids, parsing rules, slugs.
// Everything here is pure math and string work.

import { ids } from "../src/index.js";
import { section, line, note } from "./_shared.mjs";

const { toIsekai, fromIsekai, mergeIsekai, equivalent, slugify, parseId } = ids;

section("pack MAL + AniList + Kitsu into one number (no database)");
line("toIsekai({ mal: 21 })", toIsekai({ mal: 21 }));
line("toIsekai({ mal: 1 })", toIsekai({ mal: 1 }));
line("toIsekai({ mal: 21, anilist: 21, kitsu: 12 })", toIsekai({ mal: 21, anilist: 21, kitsu: 12 }));
line("fromIsekai('2105')", JSON.stringify(fromIsekai("2105")));
line("fromIsekai('12000000210000002117')", JSON.stringify(fromIsekai("12000000210000002117")));

section("typos fail the checksum -> null, never the wrong anime");
line("fromIsekai('2106')", String(fromIsekai("2106")));
line("fromIsekai('02105')", String(fromIsekai("02105")));

section("equivalence is id-set intersection, not string equality");
const partial = toIsekai({ mal: 21 });
const full = toIsekai({ mal: 21, anilist: 21, kitsu: 12 });
line("equivalent(partial, full)", String(equivalent(partial, full)));
line("equivalent(mal:21, mal:22)", String(equivalent(toIsekai({ mal: 21 }), toIsekai({ mal: 22 }))));
line("mergeIsekai(partial, full)", JSON.stringify(mergeIsekai(partial, full)));

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
