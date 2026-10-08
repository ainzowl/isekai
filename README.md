# shogo

One clean interface over every anime service: metadata, IDs, images, seasons,
episodes and skip times from Jikan (MyAnimeList), Kitsu, AniList, animap.id,
TMDB, AniSkip and Anime Skip — merged into a single shape.

- Zero dependencies. Plain ESM. Node 18+, Bun, Deno, browsers, QuickJS-ng.
- Keyless by default: Kitsu leads metadata, AniSkip answers skip times, and
  animap.id resolves ids across services.
- Its own packed ID space, human-friendly slugs, cross-provider search and
  name estimation, one normalized result shape everywhere.

## Install

```sh
npm install shogo-anime
```

## Quick start

```js
import { Shogo } from "shogo-anime";

const shogo = new Shogo();

const anime = await shogo.findById("mal:21");
anime.titles.romaji;   // "ONE PIECE"
anime.ids.shogo;       // "12000000210000002117" (packed MAL + AniList + Kitsu id)
anime.score;           // { value: 8.55, scale: 10, breakdown: { mal, anilist, ... } }
anime.sources;         // ["kitsu", "anilist", "animap"]
anime.errors;          // partial failures, never thrown

const matches = await shogo.search("bocchi the rock");
const guess = await shogo.identify("bocchi the rock");     // best match + confidence
const ctx = await shogo.episode("mal:21", { number: 1 });  // anime + episode + skip + stills
```

`findById` accepts anything: `"mal:21"`, `{ mal: 21 }`, `"kitsu:12"`,
`"tmdb:tv:37854"`, `"tt0388629"`, a slug (`"one-piece"`), or a packed shogo id
(`2105` — bare pure digits are always shogo ids; use `mal:21` for MAL).

## Providers

| Provider | Key | Used for |
|---|---|---|
| Kitsu | none | metadata, episodes, streaming flags, id mappings, native slugs — **default source** |
| Jikan (MAL) | none | metadata, episodes, pictures, cast/staff, schedule |
| AniList | none | metadata, relations, cast/staff, recommendations, airing schedule |
| animap.id | none | cross-service id mapping, light metadata |
| IMDb | none | id namespace, resolved through TMDB |
| AniSkip | none | **default skip times** (MAL-based, real ranges) |
| TMDB | required | posters/backdrops/logos/episode stills, IMDb/TVDB/Wikidata bridge |
| Anime Skip | client id | optional second skip source (OP/ED timestamps via AniList ids) |

```js
const shogo = new Shogo({
  keys: { tmdb: process.env.TMDB_API_KEY, "anime-skip": process.env.ANIME_SKIP_ID },
  defaultSource: "kitsu", // or "jikan" / "anilist"
});
```

Keyed providers are contacted only when a method actually needs them. Missing or
rejected keys throw `MissingApiKeyError` / `InvalidApiKeyError` with the exact
fix (where to create the key, which header the API reads).

## IDs

Packed shogo ids hold the MAL, AniList and Kitsu ids plus a checksum. Decoding
is pure math — no cache, no database, no network:

```js
shogo.ids.toShogo({ mal: 21 });                        // "2105"
shogo.ids.toShogo({ mal: 21, anilist: 21, kitsu: 12 }); // "12000000210000002117"
shogo.ids.fromShogo("2105");                           // { mal: 21 }
shogo.ids.equivalent("2105", "12000000210000002117");  // true
shogo.ids.merge("2105", "12000000210000002117");       // { ids, conflicts }
```

Store populated ids as strings (they exceed `Number.MAX_SAFE_INTEGER`). Typos
fail the checksum and decode to `null`, never to the wrong anime. Equivalence is
id-set intersection, so partial, enriched and re-based ids match.

## Slugs

`slugify("Bocchi the Rock!")` → `bocchi-the-rock`. `findBySlug()` resolves via
the native Kitsu slug (one exact request), then a loaded catalog index, then
`identify()` at a higher threshold. Records expose `slug` and `slugs`.

## The result shape

Every method returns the canonical model and the same envelope:

```js
anime.ids;          // shogo, mal, anilist, kitsu, anidb, ann, tvdb, tmdb, imdb, ...
anime.titles;       // romaji, english, native, synonyms, localized
anime.score;        // average of provider scores, normalized to 10, with breakdown
anime.ratings;      // per provider: { score, votes, rank, ... }
anime.images;       // posters, banners, logos, thumbnails, stills (each with .source)
anime.links;        // official, streaming: [{ service, url, dub, subs }], external
anime.relations;    // [{ type, ids, title, format }]
anime.errors;       // [{ provider, code, message }]
anime.skipped;      // [{ provider, reason }]
anime.meta;         // { durationMs, cacheHits, coalesced, providersQueried }
anime.fieldSources; // { synopsis: "kitsu", "titles.romaji": "anilist", ... }
```

Array results (`episodes`, `seasons`, `characters`, `staff`, `franchise`) carry
the envelope on the array itself.

## Methods

| Method | Returns |
|---|---|
| `findById(ref)` / `findByIds(refs)` | merged `Anime` |
| `findBySlug(slug)` | `{ best, candidates }` |
| `search(query)` / `searchAll(query)` | deduped results / async iterable per provider |
| `identify(name, { hint, full })` | best match plus probability score and reasons |
| `seasons(ref)` | entry-based seasons or TMDB groups, labeled with titles |
| `episodes(ref, { season, providers, offset, maxPages })` | consolidated `EpisodeList` |
| `episode(ref, { season, number, providers, skipProviders })` | `{ anime, season, episode, skip, images }` |
| `images(ref)` / `screenshots(ref, { season, number })` | posters/banners/logos / episode stills |
| `skipTimes(ref, { number, episodeLength, skipProviders })` | `{ op, ed, recap }` or `null` |
| `characters(ref)` / `staff(ref)` | cast, voice actors, staff |
| `relations(ref)` / `franchise(ref)` / `recommendations(ref)` / `schedule()` | grouped relations, timeline, recs, airing |
| `resolve(ref, { to })` / `map(ref)` / `findByExternalId(p, id)` | `MappingResult` with `ids`, `conflicts`, `missing` |
| `catalog({ source })` | titles ↔ shogo ids: `list()`, `search()`, `bySlug()`, `byShogoId()` |
| `stats()`, `providers.*`, `mapping.conflicts()`, `raw.*` | introspection and escape hatches |

Common options: `{ providers, include, exclude, signal, timeoutMs, cache, dryRun,
hint }`. `include`/`exclude` are dotted field selectors that also prune the
provider plan; `dryRun` returns the call plan without fetching.

## Episodes

Every provider numbers episodes differently — flat (Kitsu/Jikan: 1..N in one
record), season-based (TMDB), absolute-aware (Anime Skip). `episodes()` defaults
to the default source and converts tagged providers (`providers: [...]` or
`"all"`) into one canonical list:

```js
const eps = await shogo.episodes("mal:21", { providers: ["kitsu", "tmdb"] });

eps[0].refs; // { kitsu: { number: 1 }, tmdb: { season: 1, number: 1 }, ... }
eps.consolidated;
// { providers: { kitsu: { mode: "flat", count: 60, total: 1410, truncated: true } },
//   total, matched, unmatched, truncated }

await shogo.episodes("mal:21", { offset: 60, maxPages: 3 }); // page through long shows
```

Flat lists and season 1 align on the episode number; deeper seasons align on
`(season, number)` or `absoluteNumber`; episodes that match nothing are surfaced
in `unmatched`, never dropped. Lists report `total`/`truncated` instead of being
silently cut. `season` filters keep flat episodes visible.

## Skip times

Skip times work keyless: AniSkip answers by default with real ranges.

```js
const skip = await shogo.skipTimes("mal:21", { number: 1 });
// { op: { start: 310.571, end: 400.571 }, ed: {...}, recap: {...}, source: "aniskip" }
```

`skipProviders: [...] | "all"` selects sources; AniSkip runs first, Anime Skip
joins as a fallback when a client id is configured — and if Anime Skip is
requested explicitly without a key it throws `MissingApiKeyError` (it asks for
it). The Anime Skip value must be an **API client id** (UUID) from
anime-skip.com → account → API clients; the API reads only `X-Client-ID` (an
API key or bearer token is ignored). Pass `{ episodeLength }` to pick the
matching AniSkip variant — `episode()` does that automatically. Missing pieces
are reported as `no-key`, `no-mal-id`, `no-anilist-id` or `not-found`.

## Mapping

`resolve()` walks id edges (animap.id, Kitsu mappings, AniList `idMal`, TMDB) and
returns `{ ids, conflicts, missing, sources }`. `map()` is the "give me
everything" shorthand.

There is no keyless MAL → TMDB bridge: TMDB joins a lookup when you pass a
`tmdb:` / `tt…` / `tvdb:` id, or when an entry was found through `search()` /
`identify()`. `screenshots("mal:21")` therefore needs a TMDB id first.

`shogo.offline.load(animapDump)` indexes a user-provided animap.id dump so
`resolve()` and `catalog()` answer with zero network.

## Fetch modes

Frontend mode (default) calls the providers from the runtime you are on — open
CORS (verified `*` on every provider shogo ships). Backend mode routes every
request through your server instead:

```js
const shogo = new Shogo({ proxy: "/api/proxy" }); // or proxy: true
shogo.transport; // "backend"
```

The repo ships a hardened `/api/proxy` in `docs/serve.mjs`: provider host
allow-list, method/body/whitelisted-header forwarding, `etag`/`retry-after`/
`x-ratelimit-*` passthrough, and optional server-side `TMDB_API_KEY` /
`ANIME_SKIP_CLIENT_ID` injection so keys stay off the client. Useful when a
provider is unreachable from the browser's network.

## Reliability

- Providers and mapping sources run in parallel; a lookup costs the slowest
  provider, not the sum.
- Per-provider rate limits (Jikan 3/s + 60/min, AniList 30/min, Kitsu 5/s, …)
  that self-tune from `X-RateLimit-*` headers.
- Retries on network/429/5xx with jitter and `Retry-After`; timeouts are never
  retried; a provider that fails is put on a 60s cooldown (`cache: "bypass"`
  re-probes).
- In-memory cache with per-kind TTLs, ETag revalidation, negative caching and
  request coalescing. `cache: false` disables; custom stores supported.
- `hooks: { onRequest, onResponse, onError }`, `result.meta`, `stats()` and
  `dryRun` for production debugging. Keys never appear in errors or logs.

## Runtime support

All network traffic goes through one replaceable function:

```js
import { Shogo } from "shogo-anime";
import { fetch } from "your-host-fetch-binding"; // QuickJS-ng, React Native, ...

const shogo = new Shogo({ fetch, clock: { now: () => Date.now(), sleep: hostSleep } });
```

No `node:` imports, no `URL`/`setTimeout` assumptions, ES2020-safe syntax
(enforced by `npm run lint`). Subpaths: `shogo-anime/ids` (pure, ~2 KB),
`shogo-anime/core`, `shogo-anime/testing` (`mockFetch` for your own tests). TypeScript
needs only `lib: ["ES2020"]`; the package ships its own fetch types.

```js
import { mockFetch } from "shogo-anime/testing";
const client = new Shogo({
  fetch: mockFetch([{ url: "https://api.jikan.moe/v4/anime/21/full", reply: { body: fixture } }]),
});
```

## Examples and docs

- `examples/` — runnable Node scripts (ids, search, episode context, mapping,
  catalog, observability, offline mock fetch).
- `docs/` — documentation site plus a live playground and an AniList-style
  browse app that runs the package in the browser:

```sh
npm run docs   # http://localhost:8787/ (docs, playground, app)
```

For GitHub Pages, publish from the repository root — the docs live under
`/docs/` and import the package from `/src/`.

## Attribution

shogo bundles no data; everything is fetched at runtime and stays subject to
upstream terms.

- MyAnimeList/Jikan — unofficial API; self-hosting supported via `baseUrls.jikan`.
- Kitsu, AniList, AniSkip — public APIs; respect their rate limits.
- TMDB — “This product uses the TMDB API but is not endorsed or certified by TMDB.”
- animap.id — “anidump map data”; attribution rules on their site.
- AniDB — data can arrive indirectly via Kitsu/animap; CC BY-NC-SA 4.0,
  non-commercial.
- Anime Skip — API client id required (optional fallback).

## Development

```sh
npm test        # fixture-backed, no network
npm run lint    # ES2020 / portability rules for src
npm run docs    # serve the docs site (has a --check self-test)
```

Live tests are opt-in: `SHOGO_LIVE=1 npm test`. Fixtures live in
`test/fixtures/`.

## License

MIT
