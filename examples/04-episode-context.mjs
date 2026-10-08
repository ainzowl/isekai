// node examples/04-episode-context.mjs
//
// seasons -> episodes -> the "everything about this episode" call.
// Skip times need an Anime Skip client id:
//   ANIME_SKIP_CLIENT_ID=your-id node examples/04-episode-context.mjs
// (the example shows the actionable error you get without one)

import { makeShogo, keys, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

section("seasons('mal:21')");
const seasons = await shogo.seasons("mal:21");
for (const s of seasons.slice(0, 6)) {
  line(
    "season " + s.number,
    [s.name, "kind=" + s.kind, s.episodeCount != null ? s.episodeCount + " eps" : null, JSON.stringify(s.ids)]
      .filter(Boolean)
      .join("  ")
  );
}
note("sources: " + seasons.sources.join(", "));
note('kind="entry" = its own MAL/AniList/Kitsu record (cour); kind="group" = a TMDB season');

section("episodes('mal:21', { season: 1 })");
const eps = await shogo.episodes("mal:21", { season: 1 });
for (const e of eps.slice(0, 3)) {
  line("ep " + e.number, (e.title || "(untitled)") + (e.images.length ? "   [" + e.images.length + " image]" : ""));
}
note("merged from: " + eps.sources.join(", "));

section("episode('mal:21', { season: 1, number: 1 }) — anime + season + episode + skip + stills");
const ctx = await shogo.episode("mal:21", { season: 1, number: 1 });
line("anime", ctx.anime.titles.romaji + "  (" + ctx.anime.ids.shogo + ")");
line("episode", "#" + ctx.episode.number + "  " + (ctx.episode.title || ""));
line("season", "kind=" + ctx.season.kind + "  number=" + ctx.season.number);
line("images", ctx.images.length ? ctx.images.length + "  first: " + ctx.images[0].url : "0");
if (ctx.skip) {
  line("skip.op", JSON.stringify(ctx.skip.op));
  line("skip.ed", JSON.stringify(ctx.skip.ed));
} else if (!keys["anime-skip"]) {
  note("skip is null: no Anime Skip key configured. With a key you'd also get:");
  note('  skipTimes("mal:21", { number: 1, serviceUrl: "https://www.crunchyroll.com/..." })');
  try {
    await shogo.skipTimes("mal:21", { number: 1 });
  } catch (err) {
    line("requesting it", err.message.slice(0, 110) + "...");
  }
}
