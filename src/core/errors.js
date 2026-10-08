const SENSITIVE_QUERY = /([?&](?:api_?key|apikey|key|token|access_token|client[-_]?id)=)[^&\s]*/gi;

export function redactUrl(url) {
  if (typeof url !== "string") return url;
  return url.replace(SENSITIVE_QUERY, "$1[redacted]");
}

export function redact(text, secrets) {
  let out = redactUrl(String(text));
  for (const s of secrets || []) {
    if (s != null && s !== "") out = out.split(String(s)).join("[redacted]");
  }
  return out;
}

export class IsekaiError extends Error {
  constructor(message, info = {}) {
    super(redact(message, info.secrets));
    this.name = this.constructor.name;
    this.code = info.code || "ISEKAI_ERROR";
    if (info.provider) this.provider = info.provider;
    if (info.url) this.url = redactUrl(info.url);
    if (info.status != null) this.status = info.status;
    if (info.retryAfterMs != null) this.retryAfterMs = info.retryAfterMs;
    if (info.cause !== undefined && this.cause === undefined) this.cause = info.cause;
  }

  toJSON() {
    const out = { name: this.name, code: this.code, message: this.message };
    if (this.provider) out.provider = this.provider;
    if (this.url) out.url = this.url;
    if (this.status != null) out.status = this.status;
    if (this.retryAfterMs != null) out.retryAfterMs = this.retryAfterMs;
    return out;
  }
}

export const KEY_SOURCES = {
  tmdb: "https://www.themoviedb.org/settings/api",
  "anime-skip": "https://anime-skip.com (account -> API clients -> create client)",
};

export const KEY_HINTS = {
  "anime-skip":
    "create an API client at anime-skip.com (account -> API clients) and pass its Client ID \u2014 " +
    "a UUID. Anime Skip only reads the X-Client-ID header; X-API-Key and Bearer are ignored (verified)",
  tmdb: "check the key at https://www.themoviedb.org/settings/api (v3 key or v4 bearer)",
};

export class MissingApiKeyError extends IsekaiError {
  constructor(provider, extra) {
    super(
      '"' + provider + '" requires an API key for this request. Get one at ' +
        (KEY_SOURCES[provider] || "the provider's website") + " and pass it as: " +
        'new Isekai({ keys: { "' + provider + '": "<key>" } })' +
        (extra ? " (" + extra + ")" : ""),
      { code: "MISSING_KEY", provider }
    );
  }
}

export class InvalidApiKeyError extends IsekaiError {
  constructor(provider, detail) {
    super(
      '"' + provider + '" rejected the configured key' + (detail ? " (" + detail + ")" : "") +
        " \u2014 " + (KEY_HINTS[provider] || "check the value in the provider's dashboard"),
      { code: "INVALID_KEY", provider }
    );
  }
}

export class InvalidIdError extends IsekaiError {
  constructor(message) {
    super(message, { code: "INVALID_ID" });
  }
}

export class NotFoundError extends IsekaiError {
  constructor(message, info = {}) {
    super(message, Object.assign({ code: "NOT_FOUND" }, info));
  }
}

export class RateLimitError extends IsekaiError {
  constructor(message, info = {}) {
    super(message, Object.assign({ code: "RATE_LIMITED" }, info));
  }
}

export class ProviderError extends IsekaiError {
  constructor(message, info = {}) {
    super(message, Object.assign({ code: "PROVIDER_ERROR" }, info));
  }
}

export class ParseError extends IsekaiError {
  constructor(message, info = {}) {
    super(message, Object.assign({ code: "PARSE_ERROR" }, info));
  }
}

export class MappingError extends IsekaiError {
  constructor(message, info = {}) {
    super(message, Object.assign({ code: "MAPPING_FAILED" }, info));
  }
}

export function isAbortError(err) {
  return !!err && (err.name === "AbortError" || err.code === "ABORT_ERR");
}

export function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

// Timeouts are not retried.
export function isRetryable(err) {
  if (!err) return false;
  if (isAbortError(err)) return false;
  if (err.code === "TIMEOUT") return false;
  if (err.code === "RATE_LIMITED") return true;
  if (err.status != null && err.status >= 500) return true;
  if (err.status == null && err.code !== "NOT_FOUND" && err.code !== "PARSE_ERROR") return true;
  return false;
}

export function toIsekaiError(err, info = {}) {
  if (err instanceof IsekaiError) return err;
  if (isAbortError(err)) return err;
  return new ProviderError(err && err.message ? err.message : String(err), Object.assign({ cause: err }, info));
}
