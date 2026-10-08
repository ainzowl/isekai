// Identifier model: packed isekai ids, parsing, formatting, slugs. Pure math.

import { InvalidIdError } from "./errors.js";

// Slot table (low -> high), widths in digits.
export const ISEKAI_SLOTS = [
  ["mal", 8],
  ["anilist", 8],
  ["kitsu", 8],
];

export const PROVIDERS = [
  "isekai", "slug", "mal", "anilist", "kitsu", "anidb", "ann", "animeplanet",
  "anisearch", "livechart", "animecountdown", "simkl", "trakt", "tvdb", "tmdb",
  "imdb", "wikidata", "animeskip",
];

const NUMERIC = ["mal", "anilist", "kitsu", "anidb", "ann", "anisearch",
  "livechart", "animecountdown", "simkl", "trakt", "tvdb", "wikidata"];
const STRINGY = ["imdb", "animeplanet", "animeskip"];

function checksum(body) {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body.charAt(i)) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return String(sum % 100).padStart(2, "0");
}

// Pack mal/anilist/kitsu into a canonical checksummed decimal string.
export function toIsekai(input) {
  const ids = input || {};
  let body = "";
  for (let i = ISEKAI_SLOTS.length - 1; i >= 0; i--) {
    const key = ISEKAI_SLOTS[i][0];
    const width = ISEKAI_SLOTS[i][1];
    const value = ids[key];
    if (value == null || value === 0) {
      body += "0".repeat(width);
      continue;
    }
    const s = String(value);
    if (!/^\d+$/.test(s)) {
      throw new InvalidIdError('isekai id field "' + key + '" must be an integer, got ' + JSON.stringify(value));
    }
    if (s.length > width) {
      throw new InvalidIdError('isekai id field "' + key + '" overflows ' + width + " digits: " + value);
    }
    body += s.padStart(width, "0");
  }
  body = body.replace(/^0+/, "");
  if (!body) throw new InvalidIdError("toIsekai() needs at least one of: " + ISEKAI_SLOTS.map((s) => s[0]).join(", "));
  return body + checksum(body);
}

export function fromIsekai(value) {
  const s = String(value == null ? "" : value);
  if (!/^\d+$/.test(s) || s.length < 3) return null;
  const body = s.slice(0, -2);
  const cc = s.slice(-2);
  if (body.charAt(0) === "0") return null; // non-canonical: leading zeros are trimmed
  if (checksum(body) !== cc) return null;
  const ids = {};
  let pos = body.length;
  for (let i = 0; i < ISEKAI_SLOTS.length && pos > 0; i++) {
    const key = ISEKAI_SLOTS[i][0];
    const width = ISEKAI_SLOTS[i][1];
    const start = Math.max(0, pos - width);
    const v = Number(body.slice(start, pos));
    if (v !== 0) ids[key] = v;
    pos = start;
  }
  if (pos > 0) return null;
  return Object.keys(ids).length ? ids : null;
}

export function isIsekaiId(value) {
  return fromIsekai(value) !== null;
}

export function baseProviderOf(ids) {
  for (const slot of ISEKAI_SLOTS) {
    if (ids && ids[slot[0]] != null) return slot[0];
  }
  return null;
}

// Union two ids; the higher-priority base keeps conflicting slots.
export function mergeIsekai(a, b) {
  const x = fromIsekai(a);
  const y = fromIsekai(b);
  if (!x || !y) return null;
  const rank = (ids) => {
    for (let i = 0; i < ISEKAI_SLOTS.length; i++) {
      if (ids[ISEKAI_SLOTS[i][0]] != null) return i;
    }
    return ISEKAI_SLOTS.length;
  };
  const keepX = rank(x) <= rank(y);
  const base = keepX ? x : y;
  const other = keepX ? y : x;
  const out = {};
  for (const k of Object.keys(base)) out[k] = base[k];
  const conflicts = [];
  for (const k of Object.keys(other)) {
    if (out[k] != null && out[k] !== other[k]) {
      conflicts.push({ slot: k, kept: out[k], dropped: other[k] });
    } else {
      out[k] = other[k];
    }
  }
  return { ids: out, conflicts };
}

// Same anime when the decoded sets share a slot and conflict on none.
export function equivalent(a, b) {
  const x = fromIsekai(a);
  const y = fromIsekai(b);
  if (!x || !y) return false;
  let shared = false;
  for (const k of Object.keys(x)) {
    if (y[k] == null) continue;
    if (x[k] !== y[k]) return false;
    shared = true;
  }
  return shared;
}

export function isekaiKey(isekaiId) {
  const ids = fromIsekai(isekaiId);
  if (!ids) return null;
  return Object.keys(ids).sort().map((k) => k + ":" + ids[k]).join("|");
}

// "Bocchi the Rock!" -> "bocchi-the-rock"
export function slugify(input) {
  let s = String(input == null ? "" : input).trim().toLowerCase();
  if (typeof s.normalize === "function") {
    try {
      s = s.normalize("NFKD");
    } catch (e) {
      /* older runtimes: keep going */
    }
  }
  s = s.replace(/[\u0300-\u036f]/g, ""); // strip combining marks
  s = s.replace(/['\u2018\u2019\u201c\u201d"]/g, ""); // drop quotes/apostrophes
  let re;
  try {
    re = new RegExp("[^\\p{L}\\p{N}]+", "gu");
  } catch (e) {
    re = /[^0-9a-z\u00c0-\uffff]+/g;
  }
  s = s.replace(re, "-");
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

function toPositiveInt(value, what) {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new InvalidIdError("Invalid " + what + " id: " + JSON.stringify(value));
  }
  return n;
}

// Validate a partial ids object; throws InvalidIdError on junk.
export function coerceIds(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (value == null || value === "") continue;
    if (key === "isekai") {
      const decoded = fromIsekai(value);
      if (!decoded) throw new InvalidIdError('Invalid isekai id: "' + value + '"');
      for (const k of Object.keys(decoded)) out[k] = decoded[k];
    } else if (key === "slug") {
      continue; // slugs are handled by parseId, not stored in ids
    } else if (key === "tmdb") {
      if (typeof value === "object") {
        const t = {};
        if (value.tv != null) t.tv = toPositiveInt(value.tv, "tmdb.tv");
        if (value.movie != null) t.movie = toPositiveInt(value.movie, "tmdb.movie");
        if (Object.keys(t).length) out.tmdb = t;
      } else {
        out.tmdb = toPositiveInt(value, "tmdb");
      }
    } else if (NUMERIC.indexOf(key) >= 0) {
      out[key] = toPositiveInt(value, key);
    } else if (STRINGY.indexOf(key) >= 0) {
      const s = String(value);
      if (key === "imdb" && !/^tt\d+$/i.test(s)) throw new InvalidIdError('Invalid imdb id: "' + s + '" (expected tt0000000)');
      out[key] = key === "imdb" ? s.toLowerCase() : s;
    } else {
      throw new InvalidIdError('Unknown id provider "' + key + '"');
    }
  }
  return out;
}

function parseBareDigits(raw) {
  const decoded = fromIsekai(raw);
  if (!decoded) {
    throw new InvalidIdError(
      'Bare numbers are isekai ids, and "' + raw + '" is not a valid one (checksum/shape). ' +
        'For MyAnimeList ids use "mal:' + raw + '" or { mal: ' + raw + " }."
    );
  }
  return { kind: "isekai", isekai: raw, ids: decoded };
}

// Any accepted id form -> { kind: "isekai" | "ids" | "slug", ... }
export function parseId(input) {
  if (input == null) throw new InvalidIdError("Missing id");
  if (typeof input === "object") {
    if (Array.isArray(input)) throw new InvalidIdError("Arrays are not ids; pass one id or use findByIds([...])");
    if (input.isekai != null) return parseId(input.isekai);
    if (input.slug != null) {
      const slug = slugify(input.slug);
      if (!slug) throw new InvalidIdError("Cannot slugify: " + JSON.stringify(input.slug));
      return { kind: "slug", slug };
    }
    const ids = coerceIds(input);
    if (!Object.keys(ids).length) throw new InvalidIdError("Empty id object");
    return { kind: "ids", ids };
  }
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input) || input <= 0) throw new InvalidIdError("Invalid numeric id: " + input);
    return parseBareDigits(String(input));
  }
  const raw = String(input).trim();
  if (!raw) throw new InvalidIdError("Empty id");
  if (/^tt\d+$/i.test(raw)) return { kind: "ids", ids: { imdb: raw.toLowerCase() } };
  if (/^\d+$/.test(raw)) return parseBareDigits(raw);
  const colon = raw.indexOf(":");
  if (colon > 0) {
    const ns = raw.slice(0, colon).toLowerCase();
    const rest = raw.slice(colon + 1);
    if (ns === "isekai") return parseBareDigits(rest);
    if (ns === "slug") {
      const slug = slugify(rest);
      if (!slug) throw new InvalidIdError("Cannot slugify: " + raw);
      return { kind: "slug", slug };
    }
    if (ns === "tmdb") {
      const parts = rest.split(":");
      if (parts.length === 2 && (parts[0] === "tv" || parts[0] === "movie")) {
        return { kind: "ids", ids: { tmdb: { [parts[0]]: toPositiveInt(parts[1], raw) } } };
      }
      return { kind: "ids", ids: { tmdb: toPositiveInt(rest, raw) } };
    }
    if (ns === "imdb") {
      if (!/^tt\d+$/i.test(rest)) throw new InvalidIdError('Invalid imdb id "' + raw + '" (expected imdb:tt0000000)');
      return { kind: "ids", ids: { imdb: rest.toLowerCase() } };
    }
    if (NUMERIC.indexOf(ns) >= 0) return { kind: "ids", ids: { [ns]: toPositiveInt(rest, ns) } };
    if (STRINGY.indexOf(ns) >= 0) return { kind: "ids", ids: { [ns]: rest } };
    throw new InvalidIdError('Unknown id namespace "' + ns + '" in "' + raw + '"');
  }
  const slug = slugify(raw);
  if (!slug) throw new InvalidIdError("Cannot slugify id: " + raw);
  return { kind: "slug", slug };
}

export function formatId(ids) {
  if (!ids) throw new InvalidIdError("No ids to format");
  const order = ["mal", "anilist", "kitsu", "anidb", "ann", "tvdb", "tmdb", "imdb", "wikidata", "simkl", "trakt", "animeplanet", "animeskip"];
  for (const key of order) {
    const value = ids[key];
    if (value == null) continue;
    if (key === "tmdb" && typeof value === "object") {
      if (value.tv != null) return "tmdb:tv:" + value.tv;
      if (value.movie != null) return "tmdb:movie:" + value.movie;
      continue;
    }
    return key + ":" + value;
  }
  throw new InvalidIdError("No ids to format");
}

// Share any equal non-null id? Used to dedupe search results.
export function overlaps(a, b) {
  if (!a || !b) return false;
  for (const key of Object.keys(a)) {
    const va = a[key];
    if (va == null) continue;
    const vb = b[key];
    if (vb == null) continue;
    if (key === "tmdb" && typeof va === "object" && typeof vb === "object") {
      if (va.tv != null && va.tv === vb.tv) return true;
      if (va.movie != null && va.movie === vb.movie) return true;
      continue;
    }
    if (String(va) === String(vb)) return true;
  }
  return false;
}

export function idsKey(ids) {
  const normalized = coerceIds(ids);
  const keys = Object.keys(normalized).sort();
  const parts = [];
  for (const k of keys) {
    const v = normalized[k];
    if (v == null) continue;
    if (k === "tmdb" && typeof v === "object") {
      if (v.tv != null) parts.push("tmdb.tv=" + v.tv);
      if (v.movie != null) parts.push("tmdb.movie=" + v.movie);
    } else {
      parts.push(k + "=" + v);
    }
  }
  return parts.join("&");
}
