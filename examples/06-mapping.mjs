// node examples/06-mapping.mjs
//
// The mapping engine as a public API: resolve(), map(), findByExternalId(),
// conflict debugging, and the raw.* escape hatches.

import { makeShogo, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

section("resolve('mal:21', { to: [...] }) — ask for specific targets");
const resolved = await shogo.resolve("mal:21", { to: ["anilist", "kitsu", "anidb", "imdb", "tmdb"] });
line("ids", JSON.stringify(resolved.ids));
line("missing", JSON.stringify(resolved.missing));
line("via", resolved.sources.join(", "));
line("conflicts", JSON.stringify(resolved.conflicts));
note("imdb/tmdb need TMDB_API_KEY (there is no keyless MAL<->TMDB bridge)");

section("map('kitsu:12') — the give-me-everything shorthand");
const all = await shogo.map("kitsu:12");
line("ids", JSON.stringify(all.ids));

section("mapping.conflicts('mal:21') — why did a resolution split?");
const debug = await shogo.mapping.conflicts("mal:21");
line("conflicts", JSON.stringify(debug.conflicts));
note("conflicts are surfaced per slot ({ slot, kept, dropped }), never silently merged");

section("raw.* escape hatches — full provider power, one client");
const raw = await shogo.raw.anilist("query { Media(idMal: 21) { id idMal title { romaji } episodes } }");
line("raw.anilist", raw.Media.title.romaji + "  (anilist:" + raw.Media.id + ")");
const kitsu = await shogo.raw.kitsu("/anime/12", { "fields[anime]": "slug,canonicalTitle" });
line("raw.kitsu", kitsu.data.attributes.canonicalTitle);
if (shogo.isConfigured("tmdb")) {
  const tv = await shogo.raw.tmdb("/tv/37854");
  line("raw.tmdb", tv.name + "  (" + tv.first_air_date + ")");
} else {
  note("raw.tmdb needs TMDB_API_KEY");
}

section("offline mappings: shogo.offline.load(animapDumpJson)");
note("the animap.id bulk dump (~50 MB, user-provided) makes resolve() network-free");
note("see examples/07-catalog-snapshot.mjs for the full walk-through");
