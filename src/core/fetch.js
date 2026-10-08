// The single HTTP path: injected fetch, cache + ETag revalidation, request
// coalescing, retries, circuit breaker and hooks.

import {
  ShogoError,
  ProviderError,
  NotFoundError,
  RateLimitError,
  ParseError,
  abortError,
  isAbortError,
  isRetryable,
  toShogoError,
  redactUrl,
} from "./errors.js";
import { TTL } from "./cache.js";
import { withQuery } from "./url.js";

export function resolveFetch(custom) {
  if (typeof custom === "function") return custom;
  if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }
  throw new ShogoError(
    "No fetch implementation is available on this runtime. Pass one explicitly: " +
      "new Shogo({ fetch: myFetch }). See README (QuickJS-ng section).",
    { code: "NO_FETCH" }
  );
}

function headersOf(res) {
  return res && res.headers && typeof res.headers.get === "function" ? res.headers : null;
}

function etagOf(res) {
  const headers = headersOf(res);
  return headers ? headers.get("etag") : null;
}

function parseRetryAfter(res, nowMs) {
  const headers = headersOf(res);
  if (!headers) return null;
  const raw = headers.get("retry-after");
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return null;
}

async function parseBody(res, url, providerId) {
  try {
    return await res.json();
  } catch (jsonErr) {
    try {
      if (typeof res.text === "function") return { text: await res.text() };
    } catch (textErr) {
      /* fall through */
    }
    throw new ParseError(providerId + " returned a non-JSON response", { provider: providerId, url, cause: jsonErr });
  }
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs, signal, clock, secrets) {
  let ctl = null;
  let timer = null;
  let externalAbort = null;

  if (typeof AbortController === "function") {
    ctl = new AbortController();
    if (signal) {
      if (signal.aborted) throw abortError();
      if (typeof signal.addEventListener === "function") {
        externalAbort = () => ctl.abort();
        signal.addEventListener("abort", externalAbort);
      }
    }
    if (timeoutMs > 0 && typeof setTimeout === "function") {
      timer = setTimeout(() => ctl.abort(), timeoutMs);
    }
    init = Object.assign({}, init, { signal: ctl.signal });
  }

  try {
    return await fetchFn(url, init);
  } catch (err) {
    if (isAbortError(err)) {
      if (signal && signal.aborted) throw abortError();
      throw new ProviderError("Request to " + redactUrl(url) + " timed out after " + timeoutMs + "ms", {
        provider: init && init.providerId,
        url,
        code: "TIMEOUT",
        cause: err,
      });
    }
    throw err;
  } finally {
    if (timer != null && typeof clearTimeout === "function") clearTimeout(timer);
    if (externalAbort && signal && typeof signal.removeEventListener === "function") {
      signal.removeEventListener("abort", externalAbort);
    }
  }
}

function sleepAbortable(ms, signal, clock) {
  if (!clock.hasSleep) return new Promise((resolve) => resolve()); // no timers: skip the wait
  if (!signal) return clock.sleep(ms);
  if (signal.aborted) return Promise.reject(abortError());
  if (typeof signal.addEventListener === "function") {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (typeof signal.removeEventListener === "function") signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort);
      clock.sleep(ms).then(
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        }
      );
    });
  }
  return clock.sleep(ms).then(() => {
    if (signal && signal.aborted) throw abortError();
  });
}

export function createHttp(options) {
  const clock = options.clock;
  const cache = options.cache || null;
  const doFetchBase = options.fetch;
  // Backend mode: every provider call goes through a proxy endpoint.
  const proxy = options.proxy || null;
  const doFetch = proxy ? (url, init) => doFetchBase(withQuery(proxy, { url: url }), init) : doFetchBase;
  const hooks = options.hooks || {};
  const secrets = options.secrets || [];
  const userAgent = options.userAgent;
  const timeoutMs = options.timeoutMs || 0;
  const retries = options.retries != null ? options.retries : 1;
  const breakers = options.breakers || {};
  const limiters = options.limiters || {};
  const stats = { requests: 0, cacheHits: 0, cacheMisses: 0, revalidated: 0, retries: 0, errors: 0, coalesced: 0 };
  const inflight = new Map();
  let seed = (options.jitterSeed != null ? options.jitterSeed : 42) >>> 0;

  function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function hook(name, payload) {
    const fn = hooks[name];
    if (typeof fn !== "function") return;
    try {
      fn(payload);
    } catch (err) {
      /* hooks must never break requests */
    }
  }

  function backoffMs(attempt, err, rnd) {
    if (err && err.retryAfterMs != null) return err.retryAfterMs;
    const base = Math.min(10000, 250 * Math.pow(2, attempt - 1));
    return Math.round(base * (0.75 + rnd * 0.5));
  }

  async function request(providerId, url, opts = {}) {
    const method = opts.method || "GET";
    const body = opts.body;
    const ttl = opts.ttl;
    const cacheKey = opts.cacheKey || method + " " + providerId + " " + url + (body ? " " + body : "");
    const safeUrl = redactUrl(url);
    let conditional = null;
    const failureKey = "failed:" + providerId;
    const canMarkFailures = !!(cache && cache.canExpire && opts.cache !== "bypass");

    if (canMarkFailures) {
      const marker = cache.get(failureKey);
      if (marker) {
        const waitS = Math.max(1, Math.ceil((marker.expiresAt - clock.now()) / 1000));
        throw new ProviderError(
          providerId + " is on a " + waitS + "s timeout after a recent failure: " + marker.value.message,
          { provider: providerId }
        );
      }
    }

    if (cache && ttl != null && opts.cache !== "bypass") {
      const entry = cache.getStale(cacheKey);
      if (entry) {
        const expired = entry.expiresAt != null && entry.expiresAt <= clock.now();
        if (!expired) {
          stats.cacheHits++;
          hook("onResponse", { provider: providerId, method, url: safeUrl, cache: "hit", status: entry.status });
          return { data: entry.value, cache: "hit", status: entry.status };
        }
        stats.cacheMisses++;
        if (method === "GET" && entry.etag) conditional = entry;
      }
    }

    if (inflight.has(cacheKey)) {
      stats.coalesced++;
      return inflight.get(cacheKey);
    }

    const task = (async () => {
      const breaker = breakers[providerId];
      if (breaker && !breaker.allow(clock.now())) {
        throw new ProviderError('provider "' + providerId + '" is cooling down after repeated failures', {
          provider: providerId,
        });
      }
      const limiter = limiters[providerId];
      let attempt = 0;
      let lastError = null;

      while (attempt <= retries) {
        attempt++;
        if (limiter) await limiter.acquire(opts.signal);
        const headers = Object.assign({}, opts.headers);
        if (userAgent && !headers["user-agent"] && !headers["User-Agent"]) headers["User-Agent"] = userAgent;
        if (conditional && attempt === 1) headers["If-None-Match"] = conditional.etag;
        hook("onRequest", { provider: providerId, method, url: safeUrl, attempt });

        const started = clock.now();
        try {
          const res = await fetchWithTimeout(
            doFetch,
            url,
            { method, headers, body, providerId },
            opts.timeoutMs != null ? opts.timeoutMs : timeoutMs,
            opts.signal,
            clock,
            secrets
          );
          const status = res && res.status != null ? res.status : 0;
          if (limiter && limiter.observe) limiter.observe(headersOf(res), clock.now());

          if (status === 304 && conditional) {
            if (breaker) breaker.success();
            stats.revalidated++;
            if (cache) {
              cache.set(cacheKey, { value: conditional.value, etag: conditional.etag, expiresAt: clock.now() + ttl });
            }
            hook("onResponse", { provider: providerId, method, url: safeUrl, status, cache: "revalidated", attempt, durationMs: clock.now() - started });
            return { data: conditional.value, cache: "revalidated", status };
          }
          if (status === 404) {
            throw new NotFoundError("Not found: " + method + " " + safeUrl, { provider: providerId, url, status });
          }
          if (status === 429) {
            throw new RateLimitError("Rate limited by " + providerId, {
              provider: providerId,
              url,
              status,
              retryAfterMs: parseRetryAfter(res, clock.now()),
            });
          }
          if (status >= 400) {
            throw new ProviderError(providerId + " responded with HTTP " + status, { provider: providerId, url, status });
          }

          const data = await parseBody(res, url, providerId);
          if (breaker) breaker.success();
          if (cache && cache.canExpire) cache.delete(failureKey); // any success clears the outage marker
          stats.requests++;
          if (cache && ttl != null) {
            cache.set(cacheKey, { value: data, etag: etagOf(res), expiresAt: clock.now() + ttl, status });
          }
          hook("onResponse", {
            provider: providerId,
            method,
            url: safeUrl,
            status,
            attempt,
            durationMs: clock.now() - started,
            cache: "miss",
          });
          return { data, cache: "miss", status };
        } catch (err) {
          if (isAbortError(err)) throw err;
          lastError = toShogoError(err, { provider: providerId, url });
          const willRetry = isRetryable(lastError) && attempt <= retries;
          hook("onError", { provider: providerId, method, url: safeUrl, error: lastError, attempt, willRetry });
          if (!willRetry) {
      stats.errors++;
      if (breaker) breaker.failure(clock.now());
      if (canMarkFailures && (lastError.code === "PROVIDER_ERROR" || lastError.code === "TIMEOUT" || lastError.code === "RATE_LIMITED")) {
              cache.set(failureKey, {
                value: { message: lastError.message, code: lastError.code },
                expiresAt: clock.now() + TTL.failure,
              });
            }
            throw lastError;
          }
          stats.retries++;
          await sleepAbortable(backoffMs(attempt, lastError, random()), opts.signal, clock);
        }
      }
      throw lastError || new ProviderError("Request failed: " + safeUrl, { provider: providerId, url });
    })();

    inflight.set(cacheKey, task);
    try {
      return await task;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  return {
    stats,
    request,
    get(providerId, url, opts) {
      return request(providerId, url, opts);
    },
    postJson(providerId, url, body, opts = {}) {
      return request(
        providerId,
        url,
        Object.assign({}, opts, {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, opts.headers),
          body: typeof body === "string" ? body : JSON.stringify(body),
        })
      );
    },
  };
}
