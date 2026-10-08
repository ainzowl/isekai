# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0

### Added

- Zero-dependency ESM client merging Jikan (MyAnimeList), Kitsu, AniList,
  animap.id, TMDB, AniSkip and Anime Skip into one shape. Node 18+, Bun, Deno,
  browsers and QuickJS-ng via a replaceable `fetch`.
- Packed shogo ids: MAL + AniList + Kitsu slots with a checksum, bare-id
  parsing, merge and equivalence rules.
- Slugs: `slugify`, `findBySlug` (native Kitsu slug → catalog index →
  `identify`), bare text treated as a slug.
- One normalized result shape with provenance (`sources`, `errors`, `skipped`,
  `meta`, `fieldSources`) and `anime.score` (average of provider scores).
- Methods: `findById(s)`, `findBySlug`, `search(all)`, `identify`, `seasons`,
  `episodes`, `episode`, `images`, `screenshots`, `skipTimes`, `characters`,
  `staff`, `relations`, `franchise`, `recommendations`, `schedule`, `resolve`,
  `map`, `findByExternalId`, `catalog`, `raw.*`.
- Episode consolidation: per-call provider tags, per-episode `refs`,
  matched/unmatched reporting, totals/truncation and `{ offset, maxPages }`
  paging; entry-based seasons carry names and relation types.
- Skip times: AniSkip (keyless, real ranges) by default, Anime Skip as an
  optional fallback behind a client id with actionable `MISSING_KEY` /
  `INVALID_KEY` errors.
- Mapping engine over animap.id, Kitsu mappings, AniList `idMal` and TMDB
  (`/find`, `external_ids`), with conflict reporting and an opt-in offline
  snapshot loader.
- Reliability: parallel provider and mapping fetches, per-provider rate limits,
  retries with `Retry-After`, a 60s failure cooldown, circuit breaker, cache
  with ETag revalidation and request coalescing, hooks, `stats()`, `dryRun`
  and dotted-path field selectors.
- Backend mode: `proxy` option routes every provider call through a server;
  `docs/serve.mjs` ships a hardened `/api/proxy` with a host allow-list and
  optional server-side keys.
- Docs site (`docs/`) with a live playground and an AniList-style browse app,
  runnable examples (`examples/`), fixture-backed tests and a portability lint.
