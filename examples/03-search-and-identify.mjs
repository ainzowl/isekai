// node examples/03-search-and-identify.mjs
//
// Fan-out search across providers, deduped; streaming searchAll; then
// identify(): "which anime is this name?" with a probability score.

import { makeShogo, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

section("search('one piece') — fan-out + dedupe by id overlap/slug");
const found = await shogo.search("one piece", { limit: 5 });
found.results.forEach((r, i) => {
  line("#" + (i + 1), [r.titles.romaji, r.ids.mal ? "mal:" + r.ids.mal : null, "sources: " + r.sources.join("+")]
    .filter(Boolean)
    .join("  |  "));
});
line("errors", found.errors.length ? JSON.stringify(found.errors) : "none");

section("searchAll('bocchi the rock') — providers stream in as they answer");
for await (const chunk of shogo.searchAll("bocchi the rock")) {
  line(chunk.provider, chunk.error ? "error: " + chunk.error.message : chunk.results.length + " result(s)");
}

section("identify('bocchi the rock', hint) — probability score");
const guess = await shogo.identify("bocchi the rock", { hint: { year: 2022, type: "TV" } });
if (guess.best) {
  line("best", guess.best.titles.romaji);
  line("confidence", guess.best.confidence);
  line("ids", JSON.stringify(guess.best.ids));
  line("why", guess.best.reasons.join("; "));
  note(
    "next candidates: " +
      guess.candidates
        .slice(1, 4)
        .map((c) => (c.titles.romaji || "?") + " (" + c.confidence + ")")
        .join(", ")
  );
} else {
  note("nothing above the threshold; retry with { threshold: 0.4 } to see the ranked list");
}

section("identify with `full: true` also fetches the merged record");
const withData = await shogo.identify("one piece", { threshold: 0.2, full: true });
if (withData.best && withData.best.anime) {
  line("anime", withData.best.anime.titles.romaji + "  (" + withData.best.anime.ids.shogo + ")");
  line("episodes", withData.best.anime.episodes);
}
