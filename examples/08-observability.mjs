// node examples/08-observability.mjs
//
// Production debugging: dryRun plans, hooks, stats, field selectors,
// and a custom cache plugged into the same client.

import { makeShogo, section, line, note } from "./_shared.mjs";

const events = [];
const shogo = makeShogo({
  hooks: {
    onRequest: (e) => events.push("req " + e.provider + " attempt=" + e.attempt),
    onResponse: (e) => events.push("res " + e.provider + " cache=" + e.cache),
    onError: (e) => events.push("err " + e.provider + " willRetry=" + e.willRetry),
  },
});

section("dryRun: which providers would be called? (no fetching)");
const plan = await shogo.findById("mal:21", { dryRun: true });
for (const step of plan.plan) {
  line(step.provider, JSON.stringify(step.native));
}
note("dryRun also does the id mapping needed to build the plan");

section("hook trail of one real lookup");
await shogo.findById("mal:21");
for (const e of events.slice(-8)) line("hook", e);

section("stats()");
const stats = shogo.stats();
line("http", JSON.stringify(stats.http));
line("cache", JSON.stringify(stats.cache));
line(
  "breakers",
  Object.keys(stats.breakers)
    .map((k) => k + ":" + stats.breakers[k].state)
    .join("  ")
);

section("field selectors trim the shape (and prune the provider plan)");
const trimmed = await shogo.findById("mal:21", {
  include: ["titles", "ids.shogo", "images.posters"],
});
line("keys", Object.keys(trimmed).join(", "));
line("posters", trimmed.images.posters.length + "  first: " + (trimmed.images.posters[0] || {}).url);
line("synopsis", String(trimmed.synopsis));
note("sources/errors/meta/ids are always kept");

section("custom cache: any { get(key), set(key, value, ttlMs) } store");
const store = new Map();
const cached = makeShogo({
  cache: {
    // Value-cache contract: get(key) returns the stored value, set(key, value, ttlMs) stores it.
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
  },
  hooks: {
    onResponse: (e) => {
      if (e.cache === "hit") line("cache hit", e.provider);
    },
  },
});
await cached.findById("mal:21");
await cached.findById("mal:21"); // second run: served from the custom store
line("store entries", store.size);

section("request coalescing: identical in-flight calls share one fetch");
const fresh = makeShogo(); // cold caches, so the in-flight window matters
const [a, b] = await Promise.all([fresh.map("mal:21"), fresh.map("mal:21")]);
line("coalesced", fresh.stats().http.coalesced);
line("same ids", String(JSON.stringify(a.ids) === JSON.stringify(b.ids)));
