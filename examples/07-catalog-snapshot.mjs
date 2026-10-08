// node examples/07-catalog-snapshot.mjs
//
// Titles <-> isekai ids with zero network at query time.
// This builds a tiny stand-in snapshot inline; in production you'd load the
// animap.id bulk dump once:
//
//   isekai.offline.load(fs.readFileSync("animap-dump.json", "utf8"));
//   const cat = await isekai.catalog();  // ~38,500 entries

import { makeIsekai, section, line, note } from "./_shared.mjs";

const isekai = makeIsekai();

const snapshot = {
  data: [
    {
      sources: ["https://myanimelist.net/anime/21", "https://anilist.co/anime/21", "https://kitsu.app/anime/12"],
      title: "One Piece",
      synonyms: ["OP"],
      type: "TV",
      episodes: 1184,
      status: "ONGOING",
      animeSeason: { season: "FALL", year: 1999 },
    },
    {
      sources: ["https://myanimelist.net/anime/31964", "https://anilist.co/anime/31964"],
      title: "Boku no Hero Academia",
      type: "TV",
      episodes: 13,
      status: "FINISHED",
      animeSeason: { season: "SPRING", year: 2016 },
    },
    {
      sources: ["https://myanimelist.net/anime/47917", "https://kitsu.app/anime/44196"],
      title: "Bocchi the Rock!",
      type: "TV",
      episodes: 12,
      status: "FINISHED",
      animeSeason: { season: "FALL", year: 2022 },
    },
  ],
};

section("load a snapshot and build the catalog");
isekai.offline.load(snapshot, { source: "demo-snapshot" });
line("offline entries", isekai.offline.size);
const cat = await isekai.catalog();
line("catalog", cat.size + " entries from " + cat.source);

section("lookups");
const bySlug = cat.bySlug("bocchi-the-rock");
line("bySlug", bySlug.titles.romaji + "  mal:" + bySlug.mal + "  isekai:" + bySlug.isekaiId);
const byIsekai = cat.byIsekaiId("2105"); // the partial id for mal:21
line("byIsekaiId('2105')", byIsekai.titles.romaji + "  mal:" + byIsekai.mal);
line("byIsekaiId('3196455')", cat.byIsekaiId("3196455").titles.romaji);

section("catalog.search('boku no hero academia')");
for (const entry of cat.search("boku no hero academia", { limit: 3 })) {
  line(entry.slug, "mal:" + entry.mal + "  confidence=" + entry.confidence);
}

section("list() is an async iterable");
let count = 0;
for await (const entry of cat.list()) {
  if (count < 3) line("entry " + (count + 1), entry.slug + "  (" + entry.isekaiId + ")");
  count++;
}
line("iterated", count + " entries");

section("resolve() from the snapshot — the answer comes from memory");
const resolved = await isekai.resolve("kitsu:12", { to: ["mal", "anilist"] });
line("ids", JSON.stringify(resolved.ids));
note("(live providers are still consulted for gaps; the snapshot answers first)");

note("a real deployment loads the animap dump once and ships the index");
note("or publish a distilled catalog artifact as a separate package");
