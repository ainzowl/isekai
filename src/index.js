// shogo — one clean interface over every anime service.

export { Shogo, createShogo } from "./client.js";
export {
  ShogoError,
  MissingApiKeyError,
  InvalidApiKeyError,
  InvalidIdError,
  NotFoundError,
  RateLimitError,
  ProviderError,
  ParseError,
  MappingError,
  KEY_SOURCES,
  KEY_HINTS,
  redactUrl,
} from "./core/errors.js";
export * as ids from "./core/ids.js";
export { mergeDefaults } from "./core/merge.js";
export { createMemoryCache, TTL } from "./core/cache.js";
export { VERSION as version } from "./version.js";
export { providers, METADATA_PROVIDERS, SEARCH_PROVIDERS } from "./providers/index.js";
