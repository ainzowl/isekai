import test from "node:test";
import assert from "node:assert/strict";

import { createHttp } from "../src/core/fetch.js";
import { createMemoryCache } from "../src/core/cache.js";
import { createBreaker } from "../src/core/breaker.js";
import { mockFetch } from "../src/testing.js";

function makeHttp(overrides = {}) {
  const clock =
    overrides.clock ||
    { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), hasSleep: true };
  return {
    clock,
    http: createHttp({
      fetch: overrides.fetch,
      clock,
      cache: overrides.cache === undefined ? createMemoryCache(clock.now) : overrides.cache,
      hooks: overrides.hooks || {},
      userAgent: "isekai-test",
      timeoutMs: 1000,
      retries: overrides.retries != null ? overrides.retries : 1,
      breakers: overrides.breakers || {},
      limiters: overrides.limiters || {},
    }),
  };
}

test("caches responses with ttl", async () => {
  const fetchImpl = mockFetch([{ url: "https://x.test/a", reply: { body: { ok: 1 } } }]);
  const { http } = makeHttp({ fetch: fetchImpl });
  const first = await http.get("p", "https://x.test/a", { ttl: 10000 });
  const second = await http.get("p", "https://x.test/a", { ttl: 10000 });
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.deepEqual(second.data, { ok: 1 });
  assert.equal(fetchImpl.calls.length, 1);
});

test("coalesces identical in-flight requests", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fetchImpl = mockFetch([
    { url: "https://x.test/slow", reply: () => gate.then(() => ({ body: { slow: true } })) },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl });
  const p1 = http.get("p", "https://x.test/slow");
  const p2 = http.get("p", "https://x.test/slow");
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.deepEqual(r1.data, { slow: true });
  assert.deepEqual(r2.data, { slow: true });
  assert.equal(http.stats.coalesced, 1);
  assert.equal(fetchImpl.calls.length, 1);
});

test("retries 429 and honors Retry-After", async () => {
  let calls = 0;
  const fetchImpl = mockFetch([
    {
      url: "https://x.test/rl",
      reply: () => (++calls === 1 ? { status: 429, headers: { "retry-after": "0" }, body: { err: 1 } } : { body: { ok: true } }),
    },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 2 });
  const res = await http.get("p", "https://x.test/rl");
  assert.equal(res.data.ok, true);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(http.stats.retries, 1);
});

test("retries 429 with an HTTP-date Retry-After", async () => {
  let calls = 0;
  const fetchImpl = mockFetch([
    {
      url: "https://x.test/date",
      reply: () =>
        ++calls === 1
          ? { status: 429, headers: { "retry-after": new Date(Date.now() - 1000).toUTCString() }, body: {} }
          : { body: { ok: true } },
    },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 2 });
  const res = await http.get("p", "https://x.test/date");
  assert.equal(res.data.ok, true);
});

test("a dead provider is put on a cooldown after one failure", async () => {
  const fetchImpl = mockFetch([{ url: "https://x.test/boom", reply: { status: 500, body: {} } }]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 0 });
  await assert.rejects(http.get("p", "https://x.test/boom"));
  assert.equal(fetchImpl.calls.length, 1);
  await assert.rejects(http.get("p", "https://x.test/boom"), (err) => {
    assert.ok(err.message.indexOf("recent failure") >= 0, err.message);
    return true;
  });
  assert.equal(fetchImpl.calls.length, 1, "no re-probe during the cooldown");
  await assert.rejects(http.get("p", "https://x.test/boom", { cache: "bypass" }));
  assert.equal(fetchImpl.calls.length, 2, "cache: bypass re-probes");
  assert.equal(http.stats.errors, 2);
});

test("failure cooldown clears after the provider answers again", async () => {
  let calls = 0;
  const fetchImpl = mockFetch([
    { url: "https://x.test/flaky", reply: () => (++calls === 1 ? { status: 500, body: {} } : { body: { ok: true } }) },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 0 });
  await assert.rejects(http.get("p", "https://x.test/flaky"));
  const recovered = await http.get("p", "https://x.test/flaky", { cache: "bypass" });
  assert.equal(recovered.data.ok, true);
  const again = await http.get("p", "https://x.test/flaky");
  assert.equal(again.data.ok, true, "marker was cleared by the success");
  assert.equal(calls, 3);
});

test("circuit breaker stops calling a dead provider once it trips", async () => {
  const breaker = createBreaker({ threshold: 2, cooldownMs: 60000 });
  const fetchImpl = mockFetch([{ url: "https://x.test/boom2", reply: { status: 500, body: {} } }]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 0, breakers: { p: breaker }, cache: false });
  await assert.rejects(http.get("p", "https://x.test/boom2"));
  await assert.rejects(http.get("p", "https://x.test/boom2"));
  const before = fetchImpl.calls.length;
  await assert.rejects(http.get("p", "https://x.test/boom2"), (err) => err.code === "PROVIDER_ERROR");
  assert.equal(fetchImpl.calls.length, before, "breaker open: no third fetch");
  assert.equal(http.stats.errors, 2);
});

test("revalidates with ETag (304)", async () => {
  let now = 0;
  const clock = { now: () => now, sleep: (ms) => new Promise((r) => setTimeout(r, 0)), hasSleep: true };
  let calls = 0;
  const fetchImpl = mockFetch([
    {
      url: "https://x.test/etag",
      reply: (url, init) => {
        calls++;
        const headers = init.headers || {};
        if (headers["If-None-Match"] === '"v1"') return { status: 304, headers: { etag: '"v1"' }, body: {} };
        return { status: 200, headers: { etag: '"v1"' }, body: { v: 1 } };
      },
    },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl, clock });
  const first = await http.get("p", "https://x.test/etag", { ttl: 10 });
  assert.equal(first.cache, "miss");
  now += 50; // expire the entry
  const second = await http.get("p", "https://x.test/etag", { ttl: 10 });
  assert.equal(second.cache, "revalidated");
  assert.deepEqual(second.data, { v: 1 });
  assert.equal(calls, 2);
  assert.equal(http.stats.revalidated, 1);
});

test("timeouts are not retried (one shot, then out)", async () => {
  let calls = 0;
  const fetchImpl = mockFetch([
    {
      url: "https://x.test/slowpoke",
      reply: (url, init) => {
        calls++;
        return new Promise((resolve, reject) => {
          if (init.signal && typeof init.signal.addEventListener === "function") {
            init.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      },
    },
  ]);
  const { http } = makeHttp({ fetch: fetchImpl, retries: 2 });
  await assert.rejects(http.get("p", "https://x.test/slowpoke", { timeoutMs: 25 }), (err) => {
    assert.equal(err.code, "TIMEOUT");
    return true;
  });
  assert.equal(calls, 1, "timeout must not be retried");
});

test("hooks fire; secrets are redacted; abort propagates", async () => {
  const events = [];
  const fetchImpl = mockFetch([{ url: "https://x.test/h", reply: { body: { ok: true } } }]);
  const { http } = makeHttp({
    fetch: fetchImpl,
    hooks: {
      onRequest: (e) => events.push(["req", e.provider]),
      onResponse: (e) => events.push(["res", e.cache]),
    },
  });
  await http.get("p", "https://x.test/h");
  assert.deepEqual(events, [["req", "p"], ["res", "miss"]]);

  const failing = mockFetch([{ url: (u) => u.indexOf("api_key") >= 0, reply: { status: 500, body: {} } }]);
  const { http: http2 } = makeHttp({ fetch: failing, retries: 0 });
  await assert.rejects(
    http2.get("tmdb", "https://api.themoviedb.org/3/tv/1?api_key=SECRET123"),
    (err) => {
      assert.ok(err.message.indexOf("SECRET123") < 0, "message redacted");
      assert.ok(err.url.indexOf("SECRET123") < 0, "url redacted");
      return true;
    }
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(http.get("p", "https://x.test/h", { signal: controller.signal }), (err) => err.name === "AbortError");
});

test("negative cache is not stale-positive: cache:false disables", async () => {
  const fetchImpl = mockFetch([{ url: "https://x.test/n", reply: { body: { n: 1 } } }]);
  const { http } = makeHttp({ fetch: fetchImpl, cache: false });
  await http.get("p", "https://x.test/n", { ttl: 1000 });
  await http.get("p", "https://x.test/n", { ttl: 1000 });
  assert.equal(fetchImpl.calls.length, 2);
});
