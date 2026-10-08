// Per-provider circuit breaker: N consecutive failures pause the provider,
// then one half-open probe decides whether it recovers.

export function createBreaker(options = {}) {
  const threshold = options.threshold != null ? options.threshold : 5;
  const cooldownMs = options.cooldownMs != null ? options.cooldownMs : 60000;
  let failures = 0;
  let openedAt = null;

  return {
    state(now) {
      if (openedAt == null) return "closed";
      return now - openedAt >= cooldownMs ? "half-open" : "open";
    },
    allow(now) {
      return this.state(now) !== "open";
    },
    success() {
      failures = 0;
      openedAt = null;
    },
    failure(now) {
      failures++;
      if (failures >= threshold) openedAt = now;
    },
    failures() {
      return failures;
    },
    openedAt() {
      return openedAt;
    },
  };
}
