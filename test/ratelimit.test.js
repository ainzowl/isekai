import test from "node:test";
import assert from "node:assert/strict";

import { createLimiter } from "../src/core/ratelimit.js";

function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms) =>
      new Promise((resolve) => {
        queueMicrotask(() => {
          now += ms;
          resolve();
        });
      }),
    hasSleep: true,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("limiter enforces minimum spacing", async () => {
  const clock = fakeClock();
  const limiter = createLimiter({ clock, perSec: 2 }); // 500ms spacing
  await limiter.acquire();
  await limiter.acquire();
  assert.equal(clock.now(), 1000);
  assert.equal(limiter.stats.waits, 2);
});

test("limiter enforces a per-minute budget", async () => {
  const clock = fakeClock();
  const limiter = createLimiter({ clock, perSec: 1000, perMin: 2 });
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  assert.ok(clock.now() >= 60000, "third acquire waited for the minute window: " + clock.now());
});

test("limiter abort while queued", async () => {
  const clock = fakeClock();
  const limiter = createLimiter({ clock, perSec: 1 });
  const controller = new AbortController();
  const first = limiter.acquire();
  const queued = limiter.acquire(controller.signal);
  controller.abort();
  await first;
  await assert.rejects(queued, (err) => err.name === "AbortError");
});

test("limiter observes rate-limit headers", async () => {
  const clock = fakeClock();
  const limiter = createLimiter({ clock, perSec: 1000 });
  const headers = {
    get(name) {
      if (name === "x-ratelimit-remaining") return "0";
      if (name === "x-ratelimit-reset") return String(Math.floor((clock.now() + 30000) / 1000));
      return null;
    },
  };
  limiter.observe(headers, clock.now());
  await limiter.acquire();
  assert.ok(clock.now() >= 29000, "paused until reset: " + clock.now());
});
