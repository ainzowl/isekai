// Provider registry. Every provider implements the same shape:
// { id, requiresKey, capabilities, defaults, ...methods }.

import jikan from "./jikan.js";
import kitsu from "./kitsu.js";
import anilist from "./anilist.js";
import animap from "./animap.js";
import tmdb from "./tmdb.js";
import aniskip from "./aniskip.js";
import animeskip from "./animeskip.js";
import imdb from "./imdb.js";

export const providers = { jikan, kitsu, anilist, animap, tmdb, aniskip, "anime-skip": animeskip, imdb };

// Providers consulted for skip times, in preference order.
export const SKIP_PROVIDERS = ["aniskip", "anime-skip"];

// Providers consulted for merged metadata lookups, in source priority order.
export const METADATA_PROVIDERS = ["jikan", "anilist", "kitsu", "animap", "tmdb"];

// Providers consulted for search, in source priority order.
export const SEARCH_PROVIDERS = ["jikan", "anilist", "kitsu", "tmdb"];

export default providers;
