// The Shogo client: configuration, wiring, delegation and introspection.

import { VERSION } from "./version.js";
import { resolveClock } from "./core/time.js";
import { resolveFetch, createHttp } from "./core/fetch.js";
import { normalizeCache, TTL } from "./core/cache.js";
import { createLimiter } from "./core/ratelimit.js";
import { createBreaker } from "./core/breaker.js";
import { MissingApiKeyError } from "./core/errors.js";
import { mergeDefaults } from "./core/merge.js";
import * as idTools from "./core/ids.js";
import { joinUrl, withQuery } from "./core/url.js";
import { providers } from "./providers/index.js";
import { loadOffline } from "./methods/offline.js";
import { findById, findByIds } from "./methods/find.js";
import { search, searchAll } from "./methods/search.js";
import { identify, findBySlug } from "./methods/identify.js";
import { resolve, map, findByExternalId, mappingConflicts } from "./methods/map.js";
import { seasons, episodes, episode } from "./methods/episodes.js";
import { images, screenshots } from "./methods/images.js";
import { skipTimes } from "./methods/skips.js";
import { relations, franchise, recommendations, schedule, people } from "./methods/relations.js";
import { catalog } from "./methods/catalog.js";

export class Shogo {
  constructor(options = {}) {
    this.version = VERSION;
    const keys = options.keys || {};
    this.config = {
      keys,
      defaultSource: options.defaultSource || "kitsu",
      metadataProviders: options.providers || null,
      episodesProviders: (options.episodes && options.episodes.providers) || options.episodesProviders || null,
      skipProviders: options.skipProviders || null,
      mergeProviders: options.mergeProviders || null,
      mergeDefaults: options.mergeDefaults || null,
      identifyThreshold: options.identify && options.identify.threshold != null ? options.identify.threshold : 0.6,
      userAgent: options.userAgent || "shogo/" + VERSION + " (+https://github.com/shogo)",
      timeoutMs: options.timeoutMs != null ? options.timeoutMs : 10000,
      retries: options.retries,
      breaker: options.breaker || null,
      proxy: options.proxy === true ? "/api/proxy" : options.proxy || null,
      restrictLicenses: options.restrictLicenses || [],
      concurrency: options.concurrency != null ? options.concurrency : 4,
    };

    this.clock = resolveClock(options.clock);
    this.fetch = resolveFetch(options.fetch);
    this.cache = normalizeCache(options.cache, this.clock.now);
    this.hooks = options.hooks || {};
    this.logger = options.logger || null;
    this.registry = providers;
    this.ttl = TTL;

    this._limiters = {};
    this._breakers = {};
    this._baseUrls = {};
    for (const id of Object.keys(providers)) {
      const provider = providers[id];
      const defaults = provider.defaults || {};
      const override = (options.rateLimits || {})[id] || {};
      const rate = Object.assign({}, defaults.rate, override);
      this._limiters[id] = createLimiter({ clock: this.clock, perSec: rate.perSec, perMin: rate.perMin });
      this._breakers[id] = createBreaker(Object.assign({}, options.breaker));
      this._baseUrls[id] = (options.baseUrls && options.baseUrls[id]) || defaults.baseUrl;
    }

    this.http = createHttp({
      fetch: this.fetch,
      clock: this.clock,
      cache: this.cache,
      hooks: this.hooks,
      secrets: Object.keys(keys).map((k) => keys[k]),
      userAgent: this.config.userAgent,
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
      breakers: this._breakers,
      limiters: this._limiters,
      proxy: this.config.proxy,
    });

    this._offline = null;
    this._catalog = null;

    this.parseId = idTools.parseId;
    this.ids = {
      toShogo: idTools.toShogo,
      fromShogo: idTools.fromShogo,
      isShogoId: idTools.isShogoId,
      slugify: idTools.slugify,
      merge: idTools.mergeShogo,
      equivalent: idTools.equivalent,
      parseId: idTools.parseId,
      formatId: idTools.formatId,
      normalize: idTools.coerceIds,
      isImdb: (value) => /^tt\d+$/i.test(String(value)),
    };
    this.mergeDefaults = mergeDefaults;

    this.offline = {
      load: (json, opts) => {
        this._offline = loadOffline(json, opts);
        return this._offline;
      },
      lookup: (ids) => (this._offline ? this._offline.lookup(ids) : null),
      records: () => (this._offline ? this._offline.records() : []),
    };
    Object.defineProperty(this.offline, "loaded", { get: () => !!this._offline });
    Object.defineProperty(this.offline, "source", { get: () => (this._offline ? this._offline.source : null) });
    Object.defineProperty(this.offline, "size", { get: () => (this._offline ? this._offline.size : 0) });

    this.providers = {
      list: () => Object.keys(providers),
      capabilities: (id) => (providers[id] ? providers[id].capabilities : null),
      configured: () => Object.keys(providers).filter((id) => this.isConfigured(id)),
      requiresKey: (id) => !!(providers[id] && providers[id].requiresKey),
      baseUrl: (id) => this._baseUrls[id],
    };

    const self = this;
    this.mapping = {
      conflicts: (ref, opts) => mappingConflicts(self, ref, opts),
    };

    this.raw = {
      jikan: async (path, params) =>
        (await self.http.get("jikan", withQuery(joinUrl(self._baseUrls.jikan, path), params), { cache: "bypass" })).data,
      kitsu: async (path, params) =>
        (await self.http.get("kitsu", withQuery(joinUrl(self._baseUrls.kitsu, path), params), { cache: "bypass" })).data,
      animap: async (path) => (await self.http.get("animap", joinUrl(self._baseUrls.animap, path), { cache: "bypass" })).data,
      anilist: (query, variables) => providers.anilist.gql(self.ctx("anilist"), query, variables),
      animeSkip: (query, variables) => providers["anime-skip"].gql(self.ctx("anime-skip"), query, variables),
      tmdb: async (path, params) => {
        const key = self.config.keys.tmdb;
        if (!key) throw new MissingApiKeyError("tmdb");
        const headers = {};
        const query = Object.assign({}, params);
        if (String(key).indexOf("eyJ") === 0) headers.Authorization = "Bearer " + key;
        else query.api_key = key;
        const url = withQuery(joinUrl(self._baseUrls.tmdb, path), query);
        return (await self.http.get("tmdb", url, { headers, cache: "bypass" })).data;
      },
      any: async (url, opts) => (await self.http.request("raw", url, opts || {})).data,
    };
  }

  get transport() {
    return this.config.proxy ? "backend" : "frontend";
  }

  ctx(providerId) {
    return {
      providerId,
      http: this.http,
      ttl: TTL,
      baseUrl: this._baseUrls[providerId],
      key: this.config.keys[providerId],
      clock: this.clock,
      config: this.config,
      client: this,
      provider: providers[providerId],
    };
  }

  isConfigured(providerId) {
    const provider = providers[providerId];
    if (!provider) return false;
    if (!provider.requiresKey) return true;
    return !!(this.config.keys[providerId] && String(this.config.keys[providerId]).length);
  }

  stats() {
    const out = {
      http: Object.assign({}, this.http.stats),
      cache: this.cache && this.cache.stats ? Object.assign({}, this.cache.stats) : null,
      limiters: {},
      breakers: {},
      providers: {},
    };
    for (const id of Object.keys(providers)) {
      out.limiters[id] = Object.assign({}, this._limiters[id].stats);
      out.breakers[id] = {
        state: this._breakers[id].state(this.clock.now()),
        failures: this._breakers[id].failures(),
      };
      out.providers[id] = { configured: this.isConfigured(id), requiresKey: !!providers[id].requiresKey };
    }
    return out;
  }

  // ---- methods ----
  findById(ref, opts) {
    return findById(this, ref, opts);
  }
  findByIds(refs, opts) {
    return findByIds(this, refs, opts);
  }
  findBySlug(slug, opts) {
    return findBySlug(this, slug, opts);
  }
  search(query, opts) {
    return search(this, query, opts);
  }
  searchAll(query, opts) {
    return searchAll(this, query, opts);
  }
  identify(name, opts) {
    return identify(this, name, opts);
  }
  seasons(ref, opts) {
    return seasons(this, ref, opts);
  }
  episodes(ref, opts) {
    return episodes(this, ref, opts);
  }
  episode(ref, opts) {
    return episode(this, ref, opts);
  }
  images(ref, opts) {
    return images(this, ref, opts);
  }
  screenshots(ref, opts) {
    return screenshots(this, ref, opts);
  }
  skipTimes(ref, opts) {
    return skipTimes(this, ref, opts);
  }
  characters(ref, opts) {
    return people(this, ref, "characters", opts);
  }
  staff(ref, opts) {
    return people(this, ref, "staff", opts);
  }
  relations(ref, opts) {
    return relations(this, ref, opts);
  }
  franchise(ref, opts) {
    return franchise(this, ref, opts);
  }
  recommendations(ref, opts) {
    return recommendations(this, ref, opts);
  }
  schedule(opts) {
    return schedule(this, opts);
  }
  resolve(ref, opts) {
    return resolve(this, ref, opts);
  }
  map(ref, targets, opts) {
    return map(this, ref, targets, opts);
  }
  findByExternalId(provider, id, opts) {
    return findByExternalId(this, provider, id, opts);
  }
  catalog(opts) {
    return catalog(this, opts);
  }
}

export function createShogo(options) {
  return new Shogo(options);
}

export default Shogo;
