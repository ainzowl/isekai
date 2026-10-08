# shogo docs

- `documentation/` — usage guide.
- `examples/` — live playground: runs real shogo code in the browser.
- `shogo/` — AniList-style browse app (`shogo.html` + `shogo.js`).

```sh
npm run docs                  # http://localhost:8787
node docs/serve.mjs --check   # self-test: pages + proxy, exit 0/1
```

The server's web root is the repository root, so the pages import the package
from `/src/index.js` as ES modules (no build step). Tailwind and Lucide load
from CDNs.

Keys pasted into the app stay in `localStorage`. To keep keys off the client,
start the server with `TMDB_API_KEY` and/or `ANIME_SKIP_CLIENT_ID` and switch
the app to backend mode, which routes every provider call through `/api/proxy`.

GitHub Pages: publish from the repository root — `/docs/` pages import `/src/`.
