// @ainzoal/isekai/testing: mock fetch for tests.

function headerBag(headers) {
  const map = {};
  for (const key of Object.keys(headers || {})) map[key.toLowerCase()] = headers[key];
  return {
    get(name) {
      const value = map[String(name).toLowerCase()];
      return value == null ? null : String(value);
    },
    has(name) {
      return map[String(name).toLowerCase()] != null;
    },
  };
}

function makeResponse(spec) {
  const status = spec && spec.status != null ? spec.status : 200;
  const body = spec ? spec.body : undefined;
  const headers = headerBag(spec && spec.headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    async json() {
      if (typeof body === "string") return JSON.parse(body);
      return body === undefined ? {} : body;
    },
    async text() {
      if (typeof body === "string") return body;
      return body === undefined ? "" : JSON.stringify(body);
    },
  };
}

// Create a fetch implementation from a route table; exposes .calls.
export function mockFetch(routes, options = {}) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ url: String(url), init });
    for (const route of routes || []) {
      const routeMethod = String(route.method || "GET").toUpperCase();
      if (routeMethod !== method) continue;
      const matcher = route.url;
      let matched = false;
      if (typeof matcher === "function") matched = matcher(String(url));
      else if (matcher instanceof RegExp) matched = matcher.test(String(url));
      else matched = String(url) === String(matcher);
      if (!matched) continue;
      const reply = typeof route.reply === "function" ? await route.reply(String(url), init) : route.reply;
      if (reply === undefined) continue;
      return makeResponse(reply);
    }
    if (typeof options.fallback === "function") {
      const reply = await options.fallback(String(url), init);
      if (reply !== undefined) return makeResponse(reply);
    }
    throw new Error("mockFetch: no route for " + method + " " + url);
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

export default mockFetch;
