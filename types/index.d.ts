/**
 * isekai — hand-written public types. No codegen, no dependencies.
 * Minimum TypeScript `lib`: ES2020. DOM is NOT required (we ship FetchLike).
 */

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

export type IdRef =
  | string
  | number
  | { isekai?: string | number; slug?: string; mal?: number; anilist?: number; kitsu?: number }
  | {
      mal?: number;
      anilist?: number;
      kitsu?: number;
      anidb?: number;
      ann?: number;
      tvdb?: number;
      tmdb?: number | { tv?: number; movie?: number };
      imdb?: string;
      wikidata?: number;
      simkl?: number;
      trakt?: number;
      animeplanet?: string;
      animesearch?: number;
      animeskip?: string;
    };

export interface Ids {
  isekai?: string;
  mal?: number;
  anilist?: number;
  kitsu?: number;
  anidb?: number;
  ann?: number;
  tvdb?: number;
  tmdb?: { tv?: number; movie?: number } | number;
  imdb?: string;
  wikidata?: number;
  simkl?: number;
  trakt?: number;
  animeplanet?: string;
  animeskip?: string;
  [key: string]: unknown;
}

export type ParsedId =
  | { kind: "isekai"; isekai: string; ids: Ids }
  | { kind: "ids"; ids: Ids }
  | { kind: "slug"; slug: string };

export function toIsekai(ids: Ids): string;
export function fromIsekai(value: string | number): Ids | null;
export function isIsekaiId(value: unknown): boolean;
export function mergeIsekai(
  a: string | number,
  b: string | number
): { ids: Ids; conflicts: Array<{ slot: string; kept: number; dropped: number }> } | null;
export function equivalent(a: string | number, b: string | number): boolean;
export function baseProviderOf(ids: Ids): string | null;
export function slugify(input: unknown): string;
export function parseId(input: IdRef): ParsedId;
export function formatId(ids: Ids): string;
export function coerceIds(input: Ids): Ids;
export function overlaps(a: Ids, b: Ids): boolean;
export function idsKey(ids: Ids): string;

// ---------------------------------------------------------------------------
// model
// ---------------------------------------------------------------------------

export interface Image {
  kind?: string;
  url: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  language?: string;
  source?: string;
  attribution?: string;
}

export interface StreamingLink {
  service: string;
  url: string;
  dub: boolean | null;
  subs: boolean | null;
  region?: string[] | null;
  source?: string;
}

export interface Rating {
  score: number | null;
  scale?: number;
  votes?: number | null;
  rank?: number | null;
  popularity?: number | null;
  members?: number | null;
  favorites?: number | null;
}

export interface Titles {
  romaji?: string;
  english?: string;
  native?: string;
  synonyms?: string[];
  localized?: Record<string, string>;
}

export interface Relation {
  type: string;
  ids: Ids;
  title?: string | null;
  format?: string | null;
  status?: string | null;
  sources?: string[];
}

export interface EnvelopeError {
  provider?: string;
  code: string;
  message: string;
}

export interface EnvelopeSkipped {
  provider?: string;
  reason: string;
}

export interface Meta {
  durationMs: number;
  cacheHits: number;
  coalesced: number;
  providersQueried?: string[];
}

export interface Anime {
  ids: Ids;
  titles: Titles;
  slug: string | null;
  slugs?: Record<string, string>;
  type: string | null;
  status: string | null;
  episodes: number | null;
  durationSec: number | null;
  season: { season: string; year: number | null } | null;
  aired: { from?: string | null; to?: string | null } | null;
  synopsis: string | null;
  isAdult: boolean | null;
  contentRating: string | null;
  genres: string[];
  themes: string[];
  tags: string[];
  studios: string[];
  producers: string[];
  licensors: string[];
  sourceMaterial: { type: string; ids?: Ids } | null;
  nextEpisode: { number: number; airsAt: number; countdownSec: number } | null;
  ratings: Record<string, Rating>;
  score: { value: number; scale: number; providers: number; breakdown: Record<string, number> } | null;
  links: { official: string | null; streaming: StreamingLink[]; external: Array<{ service: string; url: string }> };
  images: { posters: Image[]; banners: Image[]; logos: Image[]; thumbnails: Image[]; stills: Image[] };
  relations: Relation[];
  characters?: Character[];
  staff?: Staff[];
  recommendations?: Match[];
  sources: string[];
  errors: EnvelopeError[];
  skipped: EnvelopeSkipped[];
  fieldSources?: Record<string, string | null>;
  meta: Meta;
}

export interface Character {
  ids: Ids;
  name: string | null;
  image?: string | null;
  role: string | null;
  voiceActors: Array<{ name: string | null; language: string | null; image?: string | null }>;
  sources: string[];
}

export interface Staff {
  ids: Ids;
  name: string | null;
  image?: string | null;
  positions: string[];
  sources: string[];
}

export interface Season {
  number: number;
  name?: string | null;
  relation?: string | null; // "SELF" or the relation type for entry seasons (SEQUEL, PREQUEL, ...)
  year?: number | null;
  kind: "entry" | "group";
  ids: Ids;
  titles?: Titles;
  episodeCount?: number | null;
  poster?: string | null;
  sources: string[];
}

export interface SkipRange {
  start: number;
  end: number | null;
  type?: string; // the provider's own label (e.g. "op", "mixed-op")
}

export interface SkipTimes {
  op?: SkipRange;
  ed?: SkipRange;
  recap?: SkipRange;
  preview?: SkipRange;
  other?: Array<{ type: string; start?: number; end?: number; at?: number }>;
  points?: Array<{ type: string; at: number }>;
  audio?: "sub" | "dub" | null;
  episodeLength?: number; // AniSkip's stored episode length
  offsetsApplied?: { serviceUrl: string; offsetSec: number };
  source: "aniskip" | "anime-skip" | string;
  errors?: EnvelopeError[];
  skipped?: EnvelopeSkipped[];
  meta?: Meta;
}

export interface Episode {
  number: number | string;
  season?: number | string | null;
  absoluteNumber?: string | null;
  title?: string | null;
  synopsis?: string | null;
  airedAt?: string | null;
  durationSec?: number | null;
  isFiller?: boolean;
  isRecap?: boolean;
  images?: Image[];
  skip?: SkipTimes | null;
  sources: string[];
  refs: Record<string, { number: number | string | null; season: number | string | null; absoluteNumber: string | null }>;
}

export interface EpisodeProviderSummary {
  mode: "flat" | "season" | "absolute";
  season: number | null;
  seasons?: number[];
  count: number;
  total?: number; // known upstream total for this provider, when reported
  truncated?: boolean; // true when more episodes exist beyond the fetched window
}

export interface EpisodeConsolidation {
  providers: Record<string, EpisodeProviderSummary>;
  total: number;
  matched: number;
  unmatched: Record<string, Array<{ number: number | string | null; season: number | string | null }>>;
  truncated: boolean;
}

export type EpisodeList = Episode[] & {
  ids: Ids;
  sources: string[];
  consolidated: EpisodeConsolidation;
  errors: EnvelopeError[];
  skipped: EnvelopeSkipped[];
  meta: Meta;
};

export interface EpisodeContext {
  anime: Anime;
  season: Season;
  episode: Episode;
  skip: SkipTimes | null;
  images: Image[];
  consolidated: EpisodeConsolidation;
  sources: string[];
  errors: EnvelopeError[];
  skipped: EnvelopeSkipped[];
  meta: Meta;
}

export interface Match {
  isekaiId?: string | null;
  slug?: string | null;
  ids: Ids;
  titles: Titles;
  type?: string | null;
  year?: number | null;
  episodes?: number | null;
  confidence: number;
  score?: number;
  share?: number;
  reasons: string[];
  sources: string[];
  anime?: Anime;
}

export interface MappingResult {
  ids: Ids;
  all: Ids;
  conflicts: Array<{ slot: string; kept: number; dropped: number }>;
  sources: string[];
  errors: EnvelopeError[];
  skipped: EnvelopeSkipped[];
  missing: string[];
  confidence: number;
  meta?: Meta;
}

export interface CatalogEntry {
  isekaiId: string | null;
  slug: string | null;
  mal: number | null;
  anilist: number | null;
  kitsu: number | null;
  titles: Titles;
  synonyms: string[];
  type: string | null;
  year: number | null;
  episodes: number | null;
  sources: string[];
}

export interface Catalog {
  source: string;
  size: number;
  entries: CatalogEntry[];
  list(): AsyncIterable<CatalogEntry>;
  search(name: string, opts?: { limit?: number; hint?: { year?: number; type?: string } }): Array<
    CatalogEntry & { confidence: number; reasons: string[]; matchedTitle: string | null }
  >;
  bySlug(slug: string): CatalogEntry | null;
  byIsekaiId(value: string | number): CatalogEntry | null;
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export class IsekaiError extends Error {
  code: string;
  provider?: string;
  url?: string;
  status?: number;
  retryAfterMs?: number;
  toJSON(): { name: string; code: string; message: string; provider?: string; url?: string; status?: number };
}
export class MissingApiKeyError extends IsekaiError {}
export class InvalidApiKeyError extends IsekaiError {}
export class InvalidIdError extends IsekaiError {}
export class NotFoundError extends IsekaiError {}
export class RateLimitError extends IsekaiError {}
export class ProviderError extends IsekaiError {}
export class ParseError extends IsekaiError {}
export class MappingError extends IsekaiError {}

// ---------------------------------------------------------------------------
// runtime plumbing
// ---------------------------------------------------------------------------

export interface HeadersLike {
  get(name: string): string | null;
}
export interface ResponseLike {
  ok: boolean;
  status: number;
  headers?: HeadersLike;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown }): Promise<ResponseLike>;
}
export interface Clock {
  now(): number;
  sleep?(ms: number): Promise<void>;
}
export interface CacheEntry {
  value: unknown;
  etag?: string | null;
  expiresAt?: number | null;
  status?: number;
}
export interface CacheLike {
  get(key: string): CacheEntry | null;
  getStale?(key: string): CacheEntry | null;
  set(key: string, entry: CacheEntry): void;
  delete?(key: string): void;
}

export function createMemoryCache(now?: () => number): CacheLike & { stats: { hits: number; misses: number; sets: number } };
export const TTL: {
  idMap: number;
  anime: number;
  episodes: number;
  images: number;
  skips: number;
  search: number;
  negative: number;
  failure: number;
};
export const version: string;
export const mergeDefaults: {
  scalar: Record<string, readonly string[]>;
  titles: Record<string, readonly string[]>;
  primaryTitle: readonly string[];
  providers: readonly string[];
};

export interface IsekaiOptions {
  fetch?: FetchLike;
  clock?: Clock;
  keys?: { tmdb?: string; "anime-skip"?: string; [key: string]: string | undefined };
  cache?: "memory" | false | CacheLike;
  baseUrls?: Record<string, string>;
  rateLimits?: Record<string, { perSec?: number; perMin?: number }>;
  providers?: string[];
  episodesProviders?: string[] | "all";
  episodes?: { providers?: string[] | "all" };
  skipProviders?: string[] | "all";
  mergeProviders?: string[];
  mergeDefaults?: Record<string, string[]>;
  identify?: { threshold?: number };
  userAgent?: string;
  proxy?: boolean | string;
  timeoutMs?: number;
  retries?: number;
  concurrency?: number;
  restrictLicenses?: string[];
  hooks?: {
    onRequest?: (info: { provider: string; method: string; url: string; attempt: number }) => void;
    onResponse?: (info: {
      provider: string;
      method: string;
      url: string;
      status?: number;
      cache?: string;
      attempt?: number;
      durationMs?: number;
    }) => void;
    onError?: (info: { provider: string; method: string; url: string; error: Error; attempt: number; willRetry: boolean }) => void;
  };
}

export interface CallOptions {
  providers?: string[] | "all";
  include?: string[];
  exclude?: string[];
  signal?: unknown;
  timeoutMs?: number;
  cache?: "bypass" | "stale-while-revalidate";
  dryRun?: boolean;
  hint?: { year?: number; type?: string; episodes?: number };
  threshold?: number;
  full?: boolean;
  withData?: boolean;
  limit?: number;
  season?: number;
  number?: number | string;
  absoluteNumber?: number | string;
  offset?: number; // page through long episode lists
  maxPages?: number;
  audio?: "sub" | "dub";
  serviceUrl?: string;
  skipProviders?: string[] | "all";
}

// ---------------------------------------------------------------------------
// client
// ---------------------------------------------------------------------------

export class Isekai {
  constructor(options?: IsekaiOptions);

  readonly version: string;
  readonly transport: "backend" | "frontend";
  readonly config: Record<string, unknown>;
  readonly mergeDefaults: typeof mergeDefaults;

  readonly ids: {
    toIsekai: typeof toIsekai;
    fromIsekai: typeof fromIsekai;
    isIsekaiId: typeof isIsekaiId;
    slugify: typeof slugify;
    merge: typeof mergeIsekai;
    equivalent: typeof equivalent;
    parseId: typeof parseId;
    formatId: typeof formatId;
    normalize: typeof coerceIds;
    isImdb(value: unknown): boolean;
  };

  parseId(input: IdRef): ParsedId;
  isConfigured(providerId: string): boolean;

  readonly providers: {
    list(): string[];
    capabilities(id: string): Record<string, boolean> | null;
    configured(): string[];
    requiresKey(id: string): boolean;
    baseUrl(id: string): string | undefined;
  };

  readonly offline: {
    load(json: object | string, options?: { source?: string }): { source: string; size: number };
    lookup(ids: Ids): { ids: Ids; record: unknown } | null;
    records(): unknown[];
    readonly loaded: boolean;
    readonly source: string | null;
    readonly size: number;
  };

  readonly mapping: {
    conflicts(ref: IdRef, opts?: CallOptions): Promise<{ conflicts: unknown[]; sources: string[]; all?: Ids }>;
  };

  readonly raw: {
    jikan(path: string, params?: Record<string, unknown>): Promise<unknown>;
    kitsu(path: string, params?: Record<string, unknown>): Promise<unknown>;
    animap(path: string): Promise<unknown>;
    anilist(query: string, variables?: Record<string, unknown>): Promise<unknown>;
    animeSkip(query: string, variables?: Record<string, unknown>): Promise<unknown>;
    tmdb(path: string, params?: Record<string, unknown>): Promise<unknown>;
    any(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  };

  stats(): Record<string, unknown>;

  findById(ref: IdRef, opts?: CallOptions): Promise<Anime>;
  findByIds(refs: IdRef[], opts?: CallOptions): Promise<{ results: Array<Anime | null>; meta: Meta }>;
  findBySlug(slug: string, opts?: CallOptions): Promise<{ best: Match | null; candidates: Match[]; errors: EnvelopeError[]; meta: Meta }>;
  search(query: string, opts?: CallOptions): Promise<{ results: Match[]; errors: EnvelopeError[]; meta: Meta }>;
  searchAll(query: string, opts?: CallOptions): AsyncIterable<{ provider: string; results: Match[]; error?: EnvelopeError }>;
  identify(name: string, opts?: CallOptions): Promise<{ best: Match | null; candidates: Match[]; errors: EnvelopeError[]; meta: Meta }>;
  seasons(ref: IdRef, opts?: CallOptions): Promise<Season[] & { ids: Ids; sources: string[]; errors: EnvelopeError[] }>;
  episodes?: EpisodeList;
  episode(ref: IdRef, opts?: CallOptions): Promise<EpisodeContext>;
  images(ref: IdRef, opts?: CallOptions): Promise<{ posters: Image[]; banners: Image[]; logos: Image[]; thumbnails: Image[]; stills: Image[] }>;
  screenshots(ref: IdRef, opts?: CallOptions): Promise<{ images: Image[]; sources: string[]; errors: EnvelopeError[] }>;
  skipTimes(ref: IdRef, opts?: CallOptions): Promise<SkipTimes | null>;
  characters(ref: IdRef, opts?: CallOptions): Promise<Character[]>;
  staff(ref: IdRef, opts?: CallOptions): Promise<Staff[]>;
  relations(ref: IdRef, opts?: CallOptions): Promise<Record<string, unknown[]>>;
  franchise(ref: IdRef, opts?: CallOptions): Promise<Array<{ order: number; ids: Ids; title: string | null; current: boolean }>>;
  recommendations(ref: IdRef, opts?: CallOptions): Promise<{ results: Match[] }>;
  schedule(opts?: CallOptions): Promise<{ results: unknown[] }>;
  resolve(ref: IdRef, opts?: CallOptions): Promise<MappingResult>;
  map(ref: IdRef, targets?: string[], opts?: CallOptions): Promise<MappingResult>;
  findByExternalId(provider: string, id: string | number, opts?: CallOptions): Promise<MappingResult>;
  catalog(opts?: CallOptions & { source?: "snapshot" | "live"; maxPages?: number }): Promise<Catalog>;
}

export function createIsekai(options?: IsekaiOptions): Isekai;

// ---------------------------------------------------------------------------
// testing subpath (@ainzoal/isekai/testing)
// ---------------------------------------------------------------------------

export interface MockRoute {
  method?: string;
  url: string | RegExp | ((url: string) => boolean);
  reply: object | ((url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => object | Promise<object> | undefined);
}

export function mockFetch(
  routes: MockRoute[],
  options?: { fallback?: (url: string, init: object) => object | Promise<object | undefined> | undefined }
): FetchLike & { calls: Array<{ url: string; init: object }> };

// ---------------------------------------------------------------------------
// ids subpath (@ainzoal/isekai/ids)
// ---------------------------------------------------------------------------

export const PROVIDERS: readonly string[];
export const ISEKAI_SLOTS: ReadonlyArray<readonly [string, number]>;
export function isekaiKey(isekaiId: string | number): string | null;
