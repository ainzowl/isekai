# shogo examples

Runnable scripts. Everything imports the library from `../src/index.js`, so you
can run them straight from a clone:

```sh
node examples/01-quickstart.mjs
```

## Index

| Example | Shows | Needs |
|---|---|---|
| [`01-quickstart.mjs`](./01-quickstart.mjs) | one merged lookup, the packed shogo id, bare-id rules | network |
| [`02-ids.mjs`](./02-ids.mjs) | shogo id math: mint/decode/merge/equivalence, parse rules, slugify | nothing |
| [`03-search-and-identify.mjs`](./03-search-and-identify.mjs) | fan-out search + dedupe, `searchAll()` streaming, `identify()` scoring | network |
| [`04-episode-context.mjs`](./04-episode-context.mjs) | `seasons()` → `episodes()` → `episode()` (anime + season + episode + skip + stills) | network; `ANIME_SKIP_CLIENT_ID` for skip times |
| [`05-images.mjs`](./05-images.mjs) | merged posters/banners; TMDB backdrops/logos and episode stills | network; `TMDB_API_KEY` for the TMDB half |
| [`06-mapping.mjs`](./06-mapping.mjs) | `resolve()`/`map()`/`findByExternalId()`, conflict debugging, `raw.*` | network |
| [`07-catalog-snapshot.mjs`](./07-catalog-snapshot.mjs) | titles ↔ shogo ids from a snapshot, `bySlug`/`byShogoId`/`search`, offline `resolve()` | nothing (inline snapshot) |
| [`08-observability.mjs`](./08-observability.mjs) | hooks, `dryRun` plans, `stats()`, field selectors, custom cache, coalescing | network |
| [`09-offline-mock-fetch.mjs`](./09-offline-mock-fetch.mjs) | the same client with a mocked `fetch` — the pattern for your own tests | nothing |

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `TMDB_API_KEY` | 05, 06, 08 | https://www.themoviedb.org/settings/api (v3 key or v4 bearer) |
| `ANIME_SKIP_CLIENT_ID` | 04 | anime-skip.com → account → API clients |
| `SHOGO_PROVIDERS` | all network examples | comma list, e.g. `anilist,kitsu,animap` |

`SHOGO_PROVIDERS` is handy when a provider is blocked on your network — for
example if `api.jikan.moe` is unreachable:

```sh
SHOGO_PROVIDERS=anilist,kitsu,animap node examples/01-quickstart.mjs
```

Or run with keys:

```sh
TMDB_API_KEY=... ANIME_SKIP_CLIENT_ID=... node examples/05-images.mjs
```

## Run everything

```sh
for f in examples/[0-9]*.mjs; do node "$f" || break; done
```
