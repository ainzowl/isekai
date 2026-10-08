#!/usr/bin/env node
// Docs + API proxy server. Zero dependencies.
// The repo root is the web root so docs pages can import the package from /src.
//
//   node docs/serve.mjs            -> http://localhost:8787/
//   node docs/serve.mjs 4000       -> custom port
//   node docs/serve.mjs --check    -> self-test (pages + proxy round-trip), exit 0/1
//
// Backend mode: `new Isekai({ proxy: "/api/proxy" })` routes every provider call
// through /api/proxy?url=... so the *server* talks to the APIs. Only known
// provider hosts are proxied; TMDB/Anime Skip keys can live in the server env
// (TMDB_API_KEY, ANIME_SKIP_CLIENT_ID) instead of the browser.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const DEFAULT_PROXY_HOSTS = [
  "api.jikan.moe",
  "kitsu.io",
  "graphql.anilist.co",
  "animap.id",
  "api.themoviedb.org",
  "api.anime-skip.com",
  "api.aniskip.com",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

/**
 * Create the docs server (static files + /api/proxy).
 * @param {{root?: string, allowedHosts?: string[], env?: object}} [options]
 */
export function createDocsServer(options = {}) {
  const root = normalize(options.root || join(here, ".."));
  const env = options.env || process.env;
  const allowedHosts = new Set(options.allowedHosts || DEFAULT_PROXY_HOSTS);
  for (const extra of String(env.ISEKAI_PROXY_HOSTS || "").split(",")) {
    if (extra.trim()) allowedHosts.add(extra.trim());
  }
  const upstreamFetch = options.fetch || ((...args) => fetch(...args));

  async function handleProxy(req, res, url) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-client-id",
      });
      res.end();
      return;
    }
    let target = null;
    try {
      target = new URL(url.searchParams.get("url") || "");
    } catch (err) {
      sendJson(res, 400, { error: "missing or invalid url parameter" });
      return;
    }
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      sendJson(res, 400, { error: "bad protocol: " + target.protocol });
      return;
    }
    if (!allowedHosts.has(target.hostname)) {
      sendJson(res, 403, { error: "host not allowed through the proxy: " + target.hostname });
      return;
    }

    const body = await readBody(req);
    const headers = {};
    for (const name of ["accept", "content-type", "authorization", "x-client-id"]) {
      const value = req.headers[name];
      if (value) headers[name] = value;
    }
    // Server-side keys win when the browser didn't provide one.
    if (target.hostname === "api.themoviedb.org" && env.TMDB_API_KEY && !headers.authorization && !target.searchParams.has("api_key")) {
      target.searchParams.set("api_key", env.TMDB_API_KEY);
    }
    if (target.hostname === "api.anime-skip.com" && env.ANIME_SKIP_CLIENT_ID && !headers["x-client-id"]) {
      headers["x-client-id"] = env.ANIME_SKIP_CLIENT_ID;
    }

    try {
      const upstream = await upstreamFetch(target.toString(), { method: req.method, headers, body });
      const outHeaders = {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      };
      for (const name of ["etag", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
        const value = upstream.headers.get(name);
        if (value) outHeaders[name] = value;
      }
      const text = await upstream.text();
      res.writeHead(upstream.status, outHeaders);
      res.end(text);
    } catch (err) {
      sendJson(res, 502, { error: "proxy upstream failed: " + (err && err.message ? err.message : String(err)) });
    }
  }

  async function handleStatic(res, pathname) {
    if (pathname === "/") {
      res.writeHead(302, { Location: "/docs/" });
      res.end();
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = normalize(join(root, pathname));
    if (!target.startsWith(root)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(
        '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0b1622;color:#cbd5e1;padding:3rem">' +
          '<h1 style="color:#3db4f2">404</h1><p>Not found: ' + pathname + "</p>" +
          '<p><a style="color:#3db4f2" href="/docs/">back to docs</a></p></body>'
      );
      return;
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === "/api/proxy") {
        await handleProxy(req, res, url);
        return;
      }
      await handleStatic(res, pathname);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("server error: " + err.message);
    }
  });
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const arg = process.argv[2] || process.env.PORT || "8787";
  if (arg === "--check") {
    runChecks().then(
      (failures) => process.exit(failures ? 1 : 0),
      (err) => {
        console.error("check failed:", err);
        process.exit(1);
      }
    );
  } else {
    const port = Number(arg);
    createDocsServer().listen(port, () => {
      console.log("isekai docs server");
      console.log("  landing      http://localhost:" + port + "/docs/");
      console.log("  docs         http://localhost:" + port + "/docs/documentation/");
      console.log("  playground   http://localhost:" + port + "/docs/examples/");
      console.log("  isekai app    http://localhost:" + port + "/docs/isekai/isekai.html");
      console.log("  api proxy    http://localhost:" + port + "/api/proxy?url=<encoded>");
    });
  }
}

async function runChecks() {
  // allow 127.0.0.1 so the proxy can round-trip against this very server
  const server = createDocsServer({ allowedHosts: DEFAULT_PROXY_HOSTS.concat(["127.0.0.1"]) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  let failures = 0;

  const pages = [
    ["/", 302],
    ["/docs/", 200],
    ["/docs/documentation/", 200],
    ["/docs/examples/", 200],
    ["/docs/isekai/isekai.html", 200],
    ["/docs/isekai/isekai.js", 200],
    ["/src/index.js", 200],
    ["/src/core/ids.js", 200],
  ];
  for (const [path, expected] of pages) {
    const res = await fetch(base + path, { redirect: "manual" });
    const ok = res.status === expected;
    if (!ok) failures++;
    console.log((ok ? "ok   " : "FAIL ") + res.status + "  " + path);
  }

  // proxy round-trip against ourselves (static file through the proxy)
  try {
    const target = encodeURIComponent(base + "/docs/README.md");
    const res = await fetch(base + "/api/proxy?url=" + target);
    const text = await res.text();
    const ok = res.status === 200 && text.indexOf("# isekai docs") >= 0;
    if (!ok) failures++;
    console.log((ok ? "ok   " : "FAIL ") + res.status + "  /api/proxy (static round-trip)");
  } catch (err) {
    failures++;
    console.log("FAIL  /api/proxy (static round-trip): " + err.message);
  }

  // proxy refuses hosts outside the allow-list
  try {
    const res = await fetch(base + "/api/proxy?url=" + encodeURIComponent("https://example.com/"));
    const ok = res.status === 403;
    if (!ok) failures++;
    console.log((ok ? "ok   " : "FAIL ") + res.status + "  /api/proxy (host allow-list)");
  } catch (err) {
    failures++;
    console.log("FAIL  /api/proxy (host allow-list): " + err.message);
  }

  await new Promise((resolve) => server.close(resolve));
  console.log(failures ? "\n" + failures + " failure(s)" : "\nall good on " + base);
  return failures;
}
