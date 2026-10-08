// Minimum spacing + optional per-minute budget, with abort support and
// self-tuning from X-RateLimit-* headers.

import { abortError } from "./errors.js";

const WINDOW_MS = 60000;

export function createLimiter(options) {
  const clock = options.clock;
  const minInterval = options.perSec ? 1000 / options.perSec : 0;
  const perMin = options.perMin || 0;
  let tail = Promise.resolve();
  let lastAt = 0;
  let stamps = [];
  let pausedUntil = 0;
  const stats = { waits: 0, totalWaitMs: 0, paused: 0 };

  function waitTime(now) {
    let wait = 0;
    if (pausedUntil > now) wait = pausedUntil - now;
    const earliest = lastAt + minInterval;
    if (now + wait < earliest) wait = earliest - now;
    if (perMin) {
      while (stamps.length && now - stamps[0] >= WINDOW_MS) stamps.shift();
      if (stamps.length >= perMin) {
        const windowWait = stamps[0] + WINDOW_MS - now;
        if (windowWait > wait) wait = windowWait;
      }
    }
    return wait;
  }

  async function reserve(signal) {
    if (signal && signal.aborted) throw abortError();
    const wait = waitTime(clock.now());
    if (wait > 0) {
      stats.waits++;
      stats.totalWaitMs += wait;
      await sleepAbortable(wait, signal, clock);
    }
    const at = clock.now();
    lastAt = at;
    stamps.push(at);
  }

  function acquire(signal) {
    const p = tail.then(() => reserve(signal));
    tail = p.then(
      () => {},
      () => {}
    );
    return p;
  }

  // Self-tune from X-RateLimit-* headers.
  function observe(headers, now) {
    if (!headers || typeof headers.get !== "function") return;
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    if (remaining != null && Number(remaining) <= 0 && reset != null) {
      const resetSec = Number(reset);
      if (Number.isFinite(resetSec) && resetSec > 0) {
        pausedUntil = resetSec * 1000;
        stats.paused++;
      }
    }
  }

  return { acquire, observe, waitTime, stats };
}

function sleepAbortable(ms, signal, clock) {
  if (!clock.hasSleep) {
    throw new Error("clock.sleep is required for rate limiting; pass one via new Shogo({ clock })");
  }
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
