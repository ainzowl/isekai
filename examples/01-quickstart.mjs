// node examples/01-quickstart.mjs
//
// The core loop: one call, many providers, one merged shape.
// Keyless — no API keys needed (Jikan + AniList + Kitsu + animap.id).
//
// If api.jikan.moe is unreachable from your network:
//   ISEKAI_PROVIDERS=anilist,kitsu,animap node examples/01-quickstart.mjs

import { makeIsekai, section, line, note } from "./_shared.mjs";

const isekai = makeIsekai();

section("findById('mal:21')");
const anime = await isekai.findById("mal:21");
line("title", anime.titles.romaji);
line("isekai id", anime.ids.isekai);
line("ids", JSON.stringify(anime.ids));
line("episodes", anime.episodes);
line("sources", anime.sources.join(", "));
line("streaming", anime.links.streaming.slice(0, 3).map((s) => s.service).join(", ") || "(none)");
line("synopsis", (anime.synopsis || "").slice(0, 90) + "...");
line("errors", anime.errors.length ? JSON.stringify(anime.errors) : "none");

section("the same record, reachable five more ways");
const byIsekaiId = await isekai.findById(anime.ids.isekai); // packed id (string!)
line("isekai id", byIsekaiId.titles.romaji);
const bySlug = await isekai.findById(anime.slug); // bare text is a slug
line("slug", bySlug.titles.romaji + "  (" + anime.slug + ")");
const byStructured = await isekai.findById({ anilist: anime.ids.anilist });
line("{ anilist }", byStructured.titles.romaji);

section("bare numbers that are not isekai ids fail loudly");
try {
  await isekai.findById(21);
} catch (err) {
  line(err.code, err.message);
}

note("store ids.isekai as a STRING: populated ids exceed Number.MAX_SAFE_INTEGER");
note("the whole shape is documented in README.md ('The one shape')");
