/**
 * Backend mode: every provider call is routed through a proxy endpoint, so the
 * browser only talks to your server and the server talks to the APIs.
 * Uses the docs server's /api/proxy against a local mock upstream.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createDocsServer } from "../docs/serve.mjs";
import { Shogo } from "../src/index.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("backend mode routes every provider call through the proxy", async () => {
  let postedBody = null;
  let upstreamRequests = 0;
  const upstream = createServer(async (req, res) => {
    upstreamRequests++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method === "POST") postedBody = Buffer.concat(chunks).toString("utf8");
    res.writeHead(200, { "content-type": "application/json", etag: '"mock-1"' });
    res.end(
      JSON.stringify({
        data: {
          id: "12",
          type: "anime",
          attributes: {
            slug: "one-piece",
            canonicalTitle: "One Piece",
            titles: { en_jp: "One Piece", ja_jp: "ワンピース" },
            subtype: "TV",
            status: "current",
          },
        },
      })
    );
  });
  const upstreamPort = await listen(upstream);

  const docs = createDocsServer({ allowedHosts: ["127.0.0.1"], env: {} });
  const docsPort = await listen(docs);
  const proxyUrl = "http://127.0.0.1:" + docsPort + "/api/proxy";

  const client = new Shogo({
    proxy: proxyUrl,
    providers: ["kitsu", "anilist"],
    baseUrls: { kitsu: "http://127.0.0.1:" + upstreamPort, anilist: "http://127.0.0.1:" + upstreamPort },
    timeoutMs: 5000,
  });
  assert.equal(client.transport, "backend");

  // GET through the proxy (kitsu-shaped payload)
  const anime = await client.findById("kitsu:12");
  assert.equal(anime.titles.romaji, "One Piece");
  assert.equal(anime.ids.kitsu, 12);
  assert.ok(upstreamRequests >= 2, "kitsu byId + mappings both went through the proxy");

  // POST with a JSON body through the proxy (anilist-shaped)
  await client.raw.anilist("query { ping }", { a: 1 });
  assert.ok(postedBody && postedBody.indexOf("query { ping }") >= 0, "graphql body forwarded: " + postedBody);

  // responses keep their validators so the client can revalidate
  const cached = await client.findById("kitsu:12");
  assert.equal(cached.titles.romaji, "One Piece");

  // the allow-list refuses anything else
  const blocked = await fetch(proxyUrl + "?url=" + encodeURIComponent("https://example.com/"));
  assert.equal(blocked.status, 403);

  await close(docs);
  await close(upstream);
});

test("frontend mode is the default transport", () => {
  const client = new Shogo({ fetch: () => Promise.reject(new Error("nope")) });
  assert.equal(client.transport, "frontend");
  assert.equal(client.config.proxy, null);
});
