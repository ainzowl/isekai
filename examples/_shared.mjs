// Shared helpers for the examples. Not an example itself.
import { Shogo } from "../src/index.js";

// Optional escape hatch for networks that cannot reach api.jikan.moe:
//   SHOGO_PROVIDERS=anilist,kitsu,animap node examples/01-quickstart.mjs
export const envProviders = process.env.SHOGO_PROVIDERS
  ? process.env.SHOGO_PROVIDERS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

export const keys = {};
if (process.env.TMDB_API_KEY) keys.tmdb = process.env.TMDB_API_KEY;
if (process.env.ANIME_SKIP_CLIENT_ID) keys["anime-skip"] = process.env.ANIME_SKIP_CLIENT_ID;

export function makeShogo(options = {}) {
  return new Shogo(
    Object.assign(
      { keys, timeoutMs: 8000 },
      envProviders ? { providers: envProviders } : {},
      options
    )
  );
}

export function section(title) {
  const tail = "\u2500".repeat(Math.max(2, 60 - title.length));
  console.log("\n\u2500\u2500 " + title + " " + tail);
}

export function line(label, value) {
  const text = String(label);
  console.log("  " + (text.length >= 16 ? text + "  " : text.padEnd(18)) + String(value));
}

export function note(text) {
  console.log("  # " + text);
}
