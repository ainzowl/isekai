// Injectable clock: rate limits, retries and cache TTLs all read time through it.

export function defaultClock() {
  const clock = { now: () => Date.now() };
  if (typeof setTimeout === "function") {
    clock.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }
  return clock;
}

export function resolveClock(custom) {
  const base = defaultClock();
  const c = custom || {};
  const now = typeof c.now === "function" ? c.now : base.now;
  const sleep = typeof c.sleep === "function" ? c.sleep : base.sleep;
  return { now, sleep, hasSleep: typeof sleep === "function" };
}
