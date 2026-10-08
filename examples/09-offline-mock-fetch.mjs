// node examples/09-offline-mock-fetch.mjs
//
// Zero network, zero keys: the same client, a mocked fetch.
// This is also how you test *your* code that uses shogo — import
// `mockFetch` from `shogo-anime/testing` and hand it to the constructor.

import { Shogo } from "../src/index.js";
import { mockFetch } from "../src/testing.js";
import { section, line, note } from "./_shared.mjs";

const fetchImpl = mockFetch([
  {
    url: (u) => u.indexOf("api.jikan.moe/v4/anime/21/full") >= 0,
    reply: {
      body: {
        data: {
          mal_id: 21,
          title: "One Piece",
          type: "TV",
          status: "Currently Airing",
          synopsis: "from a fixture",
          genres: [{ name: "Action" }],
          images: {
            jpg: {
              large_image_url: "https://cdn.example/op.jpg",
              small_image_url: "https://cdn.example/op-t.jpg",
            },
          },
        },
      },
    },
  },
  {
    method: "POST",
    url: (u) => u.indexOf("graphql.anilist.co") >= 0,
    reply: {
      body: {
        data: {
          Media: {
            id: 21,
            idMal: 21,
            title: { romaji: "One Piece" },
            description: "anilist synopsis",
            genres: ["Action", "Adventure"],
          },
        },
      },
    },
  },
  {
    url: (u) => u.indexOf("animap.id/api/v1/map/mal/21") >= 0,
    reply: {
      body: {
        sources: [
          "https://myanimelist.net/anime/21",
          "https://kitsu.app/anime/12",
          "https://anilist.co/anime/21",
        ],
        title: "One Piece",
        type: "TV",
        episodes: 1184,
        status: "ONGOING",
      },
    },
  },
  {
    url: (u) => u.indexOf("kitsu.io/api/edge/anime/12/mappings") >= 0,
    reply: { body: { data: [] } },
  },
  {
    url: (u) => u.indexOf("kitsu.io/api/edge/anime/12") >= 0,
    reply: {
      body: {
        data: {
          id: "12",
          type: "anime",
          attributes: {
            slug: "one-piece",
            canonicalTitle: "One Piece",
            titles: { en_jp: "One Piece" },
            subtype: "TV",
            status: "current",
          },
        },
      },
    },
  },
]);

const shogo = new Shogo({ fetch: fetchImpl });

section("findById('mal:21') with a mocked network");
const anime = await shogo.findById("mal:21");
line("title", anime.titles.romaji);
line("shogo id", anime.ids.shogo);
line("ids", JSON.stringify(anime.ids));
line("episodes", anime.episodes);
line("sources", anime.sources.join(", "));
line("synopsis", anime.synopsis);
line("fieldSources", JSON.stringify(anime.fieldSources));

section("the mock records every call it served");
for (const call of fetchImpl.calls) {
  line("fetch", call.url.replace(/\?.*$/, "") + "  [" + (call.init.method || "GET") + "]");
}

note("same shapes, same merge rules, same errors — no network involved");
note("use this in your own test suite: import { mockFetch } from 'shogo-anime/testing'");
