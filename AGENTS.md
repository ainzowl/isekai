# AGENTS.md

Instructions for AI agents using or working on **shogo**, a zero-dependency
package that merges anime data from Jikan (MyAnimeList), Kitsu, AniList,
animap.id, TMDB, AniSkip and Anime Skip into one shape.

## Golden path

```js
import { Shogo } from "shogo-anime";

const shogo = new Shogo(); // keyless: Kitsu metadata + AniSkip skip times

const anime = await shogo.findById("mal:21"); // merged Anime, never throws on partial failure
const results = await shogo.search("one piece");
const guess = await shogo.identify("bocchi the rock"); // { best: { ids, confidence }, candidates }
const episodes = await shogo.episodes("mal:21");
const ctx = await shogo.episode("mal:21", { number: 1 }); // { anime, season, episode, skip, images }
const skip = await shogo.skipTimes("mal:21", { number: 1 });
```

`findById` accepts: `"mal:21"`, `{ mal: 21 }`, `"kitsu:12"`, `"tmdb:tv:37854"`,
`"tt0388629"`, `"one-piece"` (slug), or a packed shogo id (`2105`).

**Bare pure-digit arguments are shogo ids, not MAL ids.** `findById(21)` throws
`InvalidIdError`; use `"mal:21"`.

## Defaults to know

| Thing | Default | Override |
|---|---|---|
| metadata source | Kitsu | `new Shogo({ defaultSource: "jikan" \| "anilist" })` |
| episode source | default source (kitsu) | `episodes(ref, { providers: ["kitsu", "tmdb"] \| "all" })` |
| skip source | AniSkip (keyless) | `skipTimes(ref, { skipProviders: ["aniskip", "anime-skip"] })` |
| keys | none | `new Shogo({ keys: { tmdb, "anime-skip" } })` |

Providers whose data you do not want can be removed with a hard allow-list:
`new Shogo({ providers: ["kitsu", "anilist", "animap"] })` (applies to
metadata and search).

## Result shape

Every result carries the same envelope: `sources`, `errors`, `skipped`,
`meta`, plus `fieldSources` on `Anime` (which provider supplied each field).
Partial failures land in `errors` — check it instead of try/catch for provider
trouble. Array results (`episodes`, `seasons`, `characters`, `staff`) carry the
same fields on the array.

Useful fields: `anime.ids` (shogo/mal/anilist/kitsu/tmdb/imdb/...),
`anime.score` (average of provider scores, 0–10, with `breakdown`),
`anime.slug` / `anime.slugs`, `anime.images.*` (each image has `.source`).

## IDs

```js
shogo.ids.toShogo({ mal: 21 });                       // "2105"
shogo.ids.fromShogo("12000000210000002117");          // { mal, anilist, kitsu }
shogo.ids.equivalent("2105", fullId);                 // true
```

Populated shogo ids exceed `Number.MAX_SAFE_INTEGER`: **store and pass them as
strings**. Typos fail a checksum (decode → `null`).

## Episodes: numbering differs per provider

`episodes()` consolidates providers automatically and tells you what happened:

```js
const eps = await shogo.episodes("mal:21", { providers: ["kitsu", "tmdb"] });
eps.consolidated.providers.kitsu; // { mode: "flat", count: 60, total: 1410, truncated: true }
eps[0].refs;                      // each provider's own numbering for that episode
eps.consolidated.unmatched;       // episodes no other provider matched
```

- Lists are paged: when `truncated` is true, fetch more with
  `{ offset, maxPages }` (cache makes repeat calls cheap).
- TMDB tagged without `{ season }` fetches every numbered season; seasons are
  reported per provider (`seasons: [1, 2]`).
- `seasons()` returns `kind: "entry"` records (cours as separate entries, with
  `name`/`relation`) or `kind: "group"` (TMDB seasons of one record).

## Skip times

AniSkip needs a MAL id and episode number; it is keyless and enabled by
default. Anime Skip needs a client id (`options.keys["anime-skip"]`, a UUID
from anime-skip.com → account → API clients; the API reads only the
`X-Client-ID` header). Requesting `skipProviders: ["anime-skip"]` without a key
throws `MissingApiKeyError`. When skip times are missing, inspect `skipped`
reasons: `no-key`, `no-mal-id`, `no-anilist-id`, `not-found`.

Pass `{ episodeLength }` (seconds) so AniSkip returns the variant matching the
release; `episode()` does this automatically.

## Errors

- `MissingApiKeyError` (`MISSING_KEY`) — keyed provider used without a key.
- `InvalidApiKeyError` (`INVALID_KEY`) — provider rejected the key; the message
  names the fix.
- `InvalidIdError`, `NotFoundError`, `RateLimitError`, `ProviderError`,
  `ParseError`, `MappingError`. All extend `ShogoError` with `code`, `provider`,
  `url`, `status`; `toJSON()` is safe to log (keys are redacted).

## Options cheat sheet

```js
new Shogo({
  keys: { tmdb, "anime-skip" },
  defaultSource: "kitsu",
  providers: ["kitsu", "anilist", "animap"], // hard allow-list
  skipProviders: ["aniskip", "anime-skip"],
  proxy: "/api/proxy",        // backend mode: fetch through a server
  cache: "memory" | false | { get, set },
  timeoutMs: 10000,
  retries: 1,                 // timeouts are never retried
  hooks: { onRequest, onResponse, onError },
  fetch: myFetch,             // bring-your-own fetch (QuickJS-ng, React Native)
  clock: { now, sleep },
});
```

Per call: `{ providers, skipProviders, include, exclude, signal, timeoutMs,
cache: "bypass", dryRun, hint }`. `include`/`exclude` are dotted paths and
prune provider calls. `dryRun` returns the planned calls without fetching.

## Testing consumer code

```js
import { Shogo } from "shogo-anime";
import { mockFetch } from "shogo-anime/testing";

const fetchImpl = mockFetch([
  { url: (u) => u.includes("/anime/21/full"), reply: { body: fixture } },
]);
const shogo = new Shogo({ fetch: fetchImpl });
```

## Pitfalls

- Do not fetch providers yourself: everything goes through the package, and
  the docs app simply calls `shogo.*`. Use `shogo.raw.*` only as an escape hatch.
- `api.jikan.moe` is unreachable on some networks; the default source is Kitsu
  for that reason. Prefer passing `providers` allow-lists in constrained
  environments.
- There is no keyless MAL → TMDB bridge: TMDB joins when you pass a `tmdb:` /
  `tt…` / `tvdb:` id.
- Entries without a MAL id have no shogo id (`no-shogo-id` in `skipped`).
- The client is read-only and idempotent; there is nothing to rate-limit on
  your side beyond the built-in limiters.

## Working on this repository

- Zero dependencies, plain ESM. Never import `node:` builtins from `src/`.
- ES2020-safe syntax only; `npm run lint` enforces it (no `.at()`, `??=`,
  top-level await, `structuredClone`).
- Tests are fixture-backed: `npm test` (no network). Live tests:
  `SHOGO_LIVE=1 npm test`. Add fixtures under `test/fixtures/`.
- Docs site and the browser app live in `docs/` (`npm run docs`), including
  `docs/serve.mjs --check` which self-tests pages and the `/api/proxy`.
- Keep provider quirks as short comments next to the code that handles them.
