// node examples/05-images.mjs
//
// Posters/banners from the keyless providers; TMDB unlocks backdrops, logos
// and per-episode stills (screenshots):
//   TMDB_API_KEY=your-key node examples/05-images.mjs

import { makeShogo, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

section("images('mal:21') — merged keyless posters/banners");
const images = await shogo.images("mal:21");
line("posters", images.posters.length);
line("banners", images.banners.length);
line("sources", images.sources.join(", "));
if (images.posters[0]) {
  line("first poster", images.posters[0].url);
  note("every image carries its `source` so you can attribute correctly");
}

section("TMDB adds backdrops/logos + episode stills");
if (shogo.isConfigured("tmdb")) {
  const tmdbImages = await shogo.images("tmdb:tv:37854");
  line("posters", tmdbImages.posters.length);
  line("backdrops", tmdbImages.banners.length);
  line("logos", tmdbImages.logos.length);

  const shots = await shogo.screenshots("tmdb:tv:37854", { season: 1, number: 1 });
  line("screenshots", shots.images.length + " still(s) from " + shots.sources.join(", "));
  if (shots.images[0]) note("first still: " + shots.images[0].url);
} else {
  note("TMDB_API_KEY is not set — the TMDB branch is skipped (fail-soft).");
  note("Methods that strictly *need* a key throw an actionable error instead:");
  try {
    await shogo.raw.tmdb("/tv/37854");
  } catch (err) {
    line("raw.tmdb", err.code + " — " + err.message.slice(0, 90) + "...");
  }
}

note("mal refs cannot reach TMDB directly (no keyless MAL<->TMDB bridge);");
note("pass a tmdb:/tt.../tvdb: id — or find the tmdb id via search/identify first");
