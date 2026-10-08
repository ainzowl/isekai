// node examples/01-quickstart.mjs
//
// The core loop: one call, many providers, one merged shape.
// Keyless — no API keys needed (Jikan + AniList + Kitsu + animap.id).
//
// If api.jikan.moe is unreachable from your network:
//   SHOGO_PROVIDERS=anilist,kitsu,animap node examples/01-quickstart.mjs

import { makeShogo, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

section("findById('mal:21')");
const anime = await shogo.findById("mal:21");
line("title", anime.titles.romaji);
line("shogo id", anime.ids.shogo);
line("ids", JSON.stringify(anime.ids));
line("episodes", anime.episodes);
line("sources", anime.sources.join(", "));
line("streaming", anime.links.streaming.slice(0, 3).map((s) => s.service).join(", ") || "(none)");
line("synopsis", (anime.synopsis || "").slice(0, 90) + "...");
line("errors", anime.errors.length ? JSON.stringify(anime.errors) : "none");

section("the same record, reachable five more ways");
const byShogoId = await shogo.findById(anime.ids.shogo); // packed id (string!)
line("shogo id", byShogoId.titles.romaji);
const bySlug = await shogo.findById(anime.slug); // bare text is a slug
line("slug", bySlug.titles.romaji + "  (" + anime.slug + ")");
const byStructured = await shogo.findById({ anilist: anime.ids.anilist });
line("{ anilist }", byStructured.titles.romaji);

section("bare numbers that are not shogo ids fail loudly");
try {
  await shogo.findById(21);
} catch (err) {
  line(err.code, err.message);
}

note("store ids.shogo as a STRING: populated ids exceed Number.MAX_SAFE_INTEGER");
note("the whole shape is documented in README.md ('The one shape')");
