// node examples/07-catalog-snapshot.mjs
//
// Titles <-> shogo ids with zero network at query time.
// This builds a tiny stand-in snapshot inline; in production you'd load the
// animap.id bulk dump once:
//
//   shogo.offline.load(fs.readFileSync("animap-dump.json", "utf8"));
//   const cat = await shogo.catalog();  // ~38,500 entries

import { makeShogo, section, line, note } from "./_shared.mjs";

const shogo = makeShogo();

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
shogo.offline.load(snapshot, { source: "demo-snapshot" });
line("offline entries", shogo.offline.size);
const cat = await shogo.catalog();
line("catalog", cat.size + " entries from " + cat.source);

section("lookups");
const bySlug = cat.bySlug("bocchi-the-rock");
line("bySlug", bySlug.titles.romaji + "  mal:" + bySlug.mal + "  shogo:" + bySlug.shogoId);
const byShogo = cat.byShogoId("2105"); // the partial id for mal:21
line("byShogoId('2105')", byShogo.titles.romaji + "  mal:" + byShogo.mal);
line("byShogoId('3196455')", cat.byShogoId("3196455").titles.romaji);

section("catalog.search('boku no hero academia')");
for (const entry of cat.search("boku no hero academia", { limit: 3 })) {
  line(entry.slug, "mal:" + entry.mal + "  confidence=" + entry.confidence);
}

section("list() is an async iterable");
let count = 0;
for await (const entry of cat.list()) {
  if (count < 3) line("entry " + (count + 1), entry.slug + "  (" + entry.shogoId + ")");
  count++;
}
line("iterated", count + " entries");

section("resolve() from the snapshot — the answer comes from memory");
const resolved = await shogo.resolve("kitsu:12", { to: ["mal", "anilist"] });
line("ids", JSON.stringify(resolved.ids));
note("(live providers are still consulted for gaps; the snapshot answers first)");

note("a real deployment loads the animap dump once and ships the index");
note("or publish a distilled catalog artifact as a separate package");
