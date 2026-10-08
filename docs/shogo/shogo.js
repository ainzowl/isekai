/**
 * The shogo app: browse anime on top of the package.
 * Every action shows the exact code it used — copy and paste it anywhere.
 */
import { Shogo } from "../../src/index.js";

// ---------------------------------------------------------------- settings
const ALL_PROVIDERS = ["jikan", "kitsu", "anilist", "animap", "tmdb", "anime-skip"];
const stored = {
  providers: JSON.parse(localStorage.getItem("shogo.providers") || "null"),
  tmdb: localStorage.getItem("shogo.tmdb") || "",
  skip: localStorage.getItem("shogo.skip") || "",
  mode: localStorage.getItem("shogo.mode") === "backend" ? "backend" : "frontend",
  source: localStorage.getItem("shogo.source") || "kitsu",
  skipSources: JSON.parse(localStorage.getItem("shogo.skipSources") || "null") || ["aniskip", "anime-skip"],
};
const selected = new Set(stored.providers || ["jikan", "kitsu", "anilist", "animap"]);

function buildClient() {
  const keys = {};
  if (stored.tmdb) keys.tmdb = stored.tmdb;
  if (stored.skip) keys["anime-skip"] = stored.skip;
  const options = {
    keys,
    providers: [...selected],
    defaultSource: stored.source,
    timeoutMs: 8000,
    retries: 1,
    breaker: { threshold: 3, cooldownMs: 60000 },
  };
  if (stored.mode === "backend") options.proxy = "/api/proxy"; // route through this docs server
  return new Shogo(options);
}

function setupSnippet() {
  return stored.mode === "backend" ? 'const shogo = new Shogo({ proxy: "/api/proxy" });' : "const shogo = new Shogo();";
}

function transportLabel() {
  return stored.mode === "backend" ? "via backend proxy" : "via browser";
}
let client = buildClient();

// ---------------------------------------------------------------- tiny ui kit
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const CODE = new Map();
let codeSeq = 0;

function codeBlock(code, label) {
  const id = "code-" + ++codeSeq;
  CODE.set(id, code);
  return (
    '<div class="relative overflow-hidden rounded-xl border border-ink-700 bg-ink-950/70">' +
    '<div class="flex items-center justify-between border-b border-ink-700 px-3 py-1.5">' +
    '<span class="flex items-center gap-1.5 text-[11px] text-slate-500"><i data-lucide="code-2" class="h-3.5 w-3.5"></i>' +
    esc(label || "the code for this") +
    "</span>" +
    '<button data-copy="' + id + '" class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-slate-400 hover:bg-ink-800 hover:text-white">' +
    '<i data-lucide="copy" class="h-3 w-3"></i> copy</button></div>' +
    '<pre class="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-slate-200"><code>' +
    esc(code) +
    "</code></pre></div>"
  );
}

function toast(message, kind, action) {
  const tone = kind === "error" ? "border-red-500/30 bg-red-500/10 text-red-200" : "border-brand/30 bg-brand/10 text-sky-100";
  const node = document.createElement("div");
  node.className = "flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm shadow-xl " + tone;
  const text = document.createElement("span");
  text.className = "min-w-0 flex-1";
  text.textContent = message;
  node.appendChild(text);
  if (action) {
    const button = document.createElement("button");
    button.className = "shrink-0 rounded-lg bg-ink-950/60 px-2.5 py-1 text-xs font-medium hover:bg-ink-950";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      node.remove();
      action.onClick();
    });
    node.appendChild(button);
  } else {
    setTimeout(() => node.remove(), 5200);
  }
  $("toasts").appendChild(node);
}

// A provider that fails repeatedly gets an offer to switch it off.
const failureCounts = new Map();
function noteFailures(errors) {
  const seen = new Set();
  for (const entry of errors || []) {
    if (!entry || !entry.provider || seen.has(entry.provider)) continue;
    if (entry.code === "MISSING_KEY" || entry.code === "INVALID_KEY" || entry.code === "INVALID_ID") continue; // not an outage
    seen.add(entry.provider);
    const count = (failureCounts.get(entry.provider) || 0) + 1;
    failureCounts.set(entry.provider, count);
    if (count === 2 && selected.has(entry.provider)) {
      toast('"' + entry.provider + '" keeps failing — ' + entry.message, "error", {
        label: "disable " + entry.provider,
        onClick: () => {
          selected.delete(entry.provider);
          persist();
          toast(entry.provider + " disabled for this browser", "info");
          if (lastDetailRef) openDetail(lastDetailRef);
          else if (lastSearch) doSearch(lastSearch);
        },
      });
    }
  }
}

function icons() {
  if (window.lucide) window.lucide.createIcons();
}

function fmtTime(sec) {
  if (sec == null) return "?";
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ":" + String(s).padStart(2, "0");
}

// Episode provider tags: which providers the app asks for episode lists.
// The default source leads (AniList has no episode list -> Kitsu).
function episodeProviderTags() {
  const mapped = stored.source === "jikan" ? "jikan" : stored.source === "tmdb" ? "tmdb" : "kitsu";
  const order = [mapped].concat(["kitsu", "jikan", "tmdb"].filter((id) => id !== mapped));
  const tags = order.filter((id) => selected.has(id));
  if (selected.has("anime-skip") && stored.skip) tags.push("anime-skip");
  return tags.length ? tags : ["kitsu"];
}

// One-line consolidation report: "jikan 1184 · kitsu s1 24 · 1100 matched · 4 unmatched"
function episodeSummaryText(episodes) {
  const consolidated = episodes.consolidated;
  const bits = episodes.sources.map((id) => {
    const info = consolidated && consolidated.providers ? consolidated.providers[id] : null;
    if (!info) return id;
    const seasons = info.mode === "season" ? " " + (info.seasons ? "s" + info.seasons.join("/") : "s" + info.season) : "";
    const count = info.count + (info.total != null && info.total !== info.count ? " of " + info.total : "");
    return id + seasons + " " + count;
  });
  let unmatched = 0;
  if (consolidated && consolidated.unmatched) {
    for (const key of Object.keys(consolidated.unmatched)) unmatched += consolidated.unmatched[key].length;
  }
  return (
    (bits.join(" · ") || "?") +
    (consolidated ? " · " + consolidated.matched + " matched" : "") +
    (unmatched ? " · " + unmatched + " unmatched" : "")
  );
}

// Which providers supply skip times (AniSkip is keyless and answers first).
function skipProviderTags() {
  const tags = [];
  if (stored.skipSources.indexOf("aniskip") >= 0) tags.push("aniskip");
  if (stored.skipSources.indexOf("anime-skip") >= 0 && stored.skip) tags.push("anime-skip");
  return tags;
}

// Why are there no skip times?
function skipHint(ctx) {
  const error = (ctx.errors || []).find((entry) => entry.provider === "aniskip" || entry.provider === "anime-skip");
  if (error) return error.provider + " error: " + error.message;
  const skipped = ctx.skipped || [];
  const aniskip = skipped.find((entry) => entry.provider === "aniskip");
  if (aniskip && aniskip.reason === "no-mal-id") return "no MAL id resolved — AniSkip maps by MyAnimeList id";
  const animeSkip = skipped.find((entry) => entry.provider === "anime-skip");
  if (aniskip && aniskip.reason === "not-found" && !animeSkip) return "AniSkip has no timestamps for this episode yet";
  if (animeSkip && animeSkip.reason === "no-key") return "AniSkip has no timestamps for this episode (Anime Skip is optional — set a client id for a second source)";
  if (animeSkip && animeSkip.reason === "not-found") return "neither AniSkip nor Anime Skip has timestamps for this episode yet";
  if (animeSkip && animeSkip.reason === "no-anilist-id") return "AniSkip has no timestamps for this episode (Anime Skip needs an AniList id)";
  return "no skip times for this episode";
}

function refFor(ids, slug) {
  if (ids && ids.mal != null) return "mal:" + ids.mal;
  if (ids && ids.anilist != null) return "anilist:" + ids.anilist;
  if (ids && ids.kitsu != null) return "kitsu:" + ids.kitsu;
  if (ids && ids.shogo) return ids.shogo;
  if (slug) return slug;
  return null;
}

function skeletons(count) {
  let out = "";
  for (let i = 0; i < count; i++) {
    out +=
      '<div class="skeleton overflow-hidden rounded-2xl border border-ink-700 bg-ink-900">' +
      '<div class="aspect-[2/3] w-full bg-ink-800"></div>' +
      '<div class="space-y-2 p-3"><div class="h-3 w-3/4 rounded bg-ink-800"></div><div class="h-2.5 w-1/2 rounded bg-ink-800"></div></div></div>';
  }
  return out;
}

function showView(name) {
  for (const id of ["view-home", "view-results", "view-detail"]) {
    $(id).classList.toggle("hidden", id !== "view-" + name);
  }
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- header pills + settings
function renderPills() {
  const wrap = $("provider-pills");
  const aniskipOn = stored.skipSources.indexOf("aniskip") >= 0;
  const aniskipPill =
    '<span class="chip ' +
    (aniskipOn ? "border-emerald-400/30 text-emerald-200" : "opacity-40") +
    '" title="skip times — ' +
    (aniskipOn ? (stored.skip ? "aniskip + anime-skip" : "aniskip, keyless") : "disabled in settings") +
    '">aniskip</span>';
  wrap.innerHTML = aniskipPill + ALL_PROVIDERS.map((id) => {
    const on = selected.has(id) && client.isConfigured(id);
    const isKeyed = client.providers.requiresKey(id);
    const key = isKeyed && !stored[id === "tmdb" ? "tmdb" : "skip"] ? " (key?)" : "";
    return (
      '<span class="chip ' + (on ? "border-brand/40 text-sky-200" : "opacity-40") + '" title="' + esc(id) + '">' +
      esc(id) + key + "</span>"
    );
  }).join("");
}

function renderSettings() {
  const box = $("settings-providers");
  box.innerHTML = "";
  for (const id of ALL_PROVIDERS) {
    const label = document.createElement("label");
    label.className = "flex cursor-pointer items-center gap-2 text-slate-300 hover:text-white";
    label.innerHTML =
      '<input type="checkbox" class="accent-sky-400" ' + (selected.has(id) ? "checked" : "") + " /> " + esc(id);
    label.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) selected.add(id);
      else selected.delete(id);
      persist();
    });
    box.appendChild(label);
  }
  const skipBox = $("settings-skip-sources");
  if (skipBox) {
    skipBox.innerHTML = "";
    const skipSources = [
      { id: "aniskip", label: "aniskip (keyless)" },
      { id: "anime-skip", label: "anime-skip" + (stored.skip ? "" : " (needs key)") },
    ];
    for (const source of skipSources) {
      const label = document.createElement("label");
      label.className = "flex cursor-pointer items-center gap-1.5 text-slate-300 hover:text-white";
      const checked = stored.skipSources.indexOf(source.id) >= 0;
      label.innerHTML =
        '<input type="checkbox" class="accent-sky-400" ' + (checked ? "checked" : "") + " /> " + esc(source.label);
      label.querySelector("input").addEventListener("change", (event) => {
        if (event.target.checked) {
          if (stored.skipSources.indexOf(source.id) < 0) stored.skipSources.push(source.id);
        } else {
          stored.skipSources = stored.skipSources.filter((id) => id !== source.id);
        }
        persist();
        renderPills();
      });
      skipBox.appendChild(label);
    }
  }

  $("settings-tmdb").value = stored.tmdb;
  $("settings-skip").value = stored.skip;

    const modeBox = $("settings-mode");
  if (modeBox) {
    modeBox.innerHTML = "";
    const modes = [
      { id: "frontend", label: "browser", hint: "fetch directly from this browser (CORS, your IP)" },
      { id: "backend", label: "backend", hint: "route every call through /api/proxy on the docs server" },
    ];
    for (const mode of modes) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = mode.hint;
      button.className =
        "rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition " +
        (stored.mode === mode.id ? "bg-brand text-ink-950 ring-brand" : "bg-ink-950 text-slate-300 ring-ink-700 hover:text-white");
      button.textContent = mode.label;
      button.addEventListener("click", () => setMode(mode.id));
      modeBox.appendChild(button);
    }
  }

  const sourceBox = $("settings-source");
  if (sourceBox) {
    sourceBox.innerHTML = "";
    const sources = [
      { id: "kitsu", hint: "Kitsu leads the merge and supplies episode lists by default" },
      { id: "jikan", hint: "MyAnimeList/Jikan leads (only useful when api.jikan.moe is reachable)" },
      { id: "anilist", hint: "AniList leads metadata; episode lists fall back to Kitsu (AniList serves none)" },
    ];
    for (const source of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.title = source.hint;
      button.className =
        "rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize ring-1 transition " +
        (stored.source === source.id ? "bg-brand text-ink-950 ring-brand" : "bg-ink-950 text-slate-300 ring-ink-700 hover:text-white");
      button.textContent = source.id;
      button.addEventListener("click", () => setSource(source.id));
      sourceBox.appendChild(button);
    }
  }
}

function setSource(id) {
  if (stored.source === id) return;
  stored.source = id;
  localStorage.setItem("shogo.source", id);
  client = buildClient();
  renderSettings();
  toast("default source: " + id, "info");
  if (lastDetailRef) openDetail(lastDetailRef);
  else if (lastSearch) doSearch(lastSearch);
}

function setMode(id) {
  if (stored.mode === id) return;
  stored.mode = id;
  localStorage.setItem("shogo.mode", id);
  client = buildClient();
  renderSettings();
  toast(
    id === "backend"
      ? "backend mode: every provider call goes through /api/proxy on this server"
      : "frontend mode: calling the providers directly from this browser",
    "info"
  );
  if (lastDetailRef) openDetail(lastDetailRef);
  else if (lastSearch) doSearch(lastSearch);
}

function persist() {
  localStorage.setItem("shogo.providers", JSON.stringify([...selected]));
  localStorage.setItem("shogo.tmdb", $("settings-tmdb").value.trim());
  localStorage.setItem("shogo.skip", $("settings-skip").value.trim());
  localStorage.setItem("shogo.skipSources", JSON.stringify(stored.skipSources));
  stored.tmdb = $("settings-tmdb").value.trim();
  stored.skip = $("settings-skip").value.trim();
  client = buildClient();
  renderPills();
}

$("settings-toggle").addEventListener("click", () => $("settings").classList.toggle("hidden"));
$("settings-close").addEventListener("click", () => $("settings").classList.add("hidden"));
$("settings-tmdb").addEventListener("change", persist);
$("settings-skip").addEventListener("change", () => {
  persist();
  validateSkipKey();
});

// Validate the Anime Skip client id the moment it is pasted, so a rejected id
// is caught here instead of silently producing "no skip times later".
let skipCheckToken = 0;
async function validateSkipKey() {
  const status = $("settings-skip-status");
  if (!status) return;
  const value = $("settings-skip").value.trim();
  if (!value) {
    status.className = "mt-1 text-[11px] text-slate-500";
    status.textContent = stored.mode === "backend" ? "empty — the backend will use ANIME_SKIP_CLIENT_ID if set" : "";
    return;
  }
  status.className = "mt-1 text-[11px] text-slate-500";
  status.textContent = "checking the client id\u2026";
  const token = ++skipCheckToken;
  try {
    const probe = new Shogo({ keys: { "anime-skip": value }, providers: [] });
    await probe.raw.animeSkip("query { __typename }");
    if (token !== skipCheckToken) return;
    status.className = "mt-1 text-[11px] text-emerald-400";
    status.textContent = "client id accepted";
  } catch (err) {
    if (token !== skipCheckToken) return;
    status.className = "mt-1 text-[11px] text-red-300";
    status.textContent = (err && err.message) || "the client id was rejected";
  }
}

// ---------------------------------------------------------------- copy buttons
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  const code = CODE.get(button.getAttribute("data-copy"));
  if (code == null) return;
  try {
    await navigator.clipboard.writeText(code);
    button.innerHTML = '<i data-lucide="check" class="h-3 w-3 text-emerald-400"></i> copied';
  } catch (err) {
    button.textContent = "copy failed";
  }
  icons();
  setTimeout(() => {
    button.innerHTML = '<i data-lucide="copy" class="h-3 w-3"></i> copy';
    icons();
  }, 1400);
});

// ---------------------------------------------------------------- search
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("search-input").value.trim();
  if (query) doSearch(query);
});

document.querySelectorAll("[data-suggest]").forEach((button) => {
  button.addEventListener("click", () => {
    const query = button.getAttribute("data-suggest");
    $("search-input").value = query;
    doSearch(query);
  });
});

// Skip-times demo buttons: open the episode panel straight from the home page.
document.querySelectorAll("[data-skip-ref]").forEach((button) => {
  button.addEventListener("click", () => {
    const ref = button.getAttribute("data-skip-ref");
    if (!ref) return;
    const season = Number(button.getAttribute("data-skip-season") || 1);
    const number = Number(button.getAttribute("data-skip-number") || 1);
    openEpisode(ref, season, number);
  });
});

let lastSearch = null;
let lastDetailRef = null;
let episodeMaxPages = 3; // growing window for long-running shows

async function doSearch(query) {
  lastSearch = query;
  showView("results");
  $("results-title").textContent = 'Results for \u201c' + query + '\u201d';
  $("results-sub").textContent = "searching " + [...selected].join(", ") + "…";
  $("results-errors").classList.add("hidden");
  $("grid").innerHTML = skeletons(12);
  $("results-code").innerHTML = "";
  const started = performance.now();

  const code =
    'import { Shogo } from "shogo-anime";\n\n' +
    setupSnippet() + "\n" +
    "const results = await shogo.search(" + JSON.stringify(query) + ");\n" +
    "// results[i].ids, .titles, .sources, .rating, .year, .type";
  $("results-code").innerHTML = codeBlock(code, "search()");
  icons();

  try {
    const found = await client.search(query, { limit: 24 });
    if (!found.results.length) {
      $("grid").innerHTML =
        '<p class="col-span-full rounded-xl border border-ink-700 bg-ink-900 p-6 text-center text-sm text-slate-400">No results. Try another title, or enable more providers in settings.</p>';
    } else {
      renderCards(found.results);
    }
    const ms = Math.round(performance.now() - started);
    $("results-sub").textContent =
      found.results.length + " result(s) · " + ms + "ms · " + transportLabel() + " · sources: " + [...selected].join(", ");
    if (found.errors.length) {
      $("results-errors").classList.remove("hidden");
      $("results-errors").innerHTML =
        '<i data-lucide="triangle-alert" class="mr-1 inline h-3.5 w-3.5"></i>' +
        found.errors.map((e) => esc(e.provider + ": " + e.message)).join(" · ");
    }
    noteFailures(found.errors);
  } catch (err) {
    $("grid").innerHTML = "";
    toast("search failed: " + (err && err.message), "error");
    $("results-sub").textContent = "failed";
  }
  icons();
}

function renderCards(results) {
  $("grid").innerHTML = results
    .map((result) => {
      const ref = refFor(result.ids, result.slug);
      const title = result.titles.romaji || result.titles.english || result.titles.native || "(untitled)";
      const sub = [result.type, result.year, result.episodes ? result.episodes + " eps" : null]
        .filter(Boolean)
        .join(" · ");
      const score = typeof result.rating === "number" ? result.rating : null;
      const img = result.image
        ? '<img src="' + esc(result.image) + '" alt="" loading="lazy" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />'
        : '<div class="grid h-full w-full place-items-center bg-ink-800 text-slate-600"><i data-lucide="image-off" class="h-8 w-8"></i></div>';
      return (
        '<button data-ref="' + esc(ref || "") + '" class="group relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 text-left transition hover:border-brand/50 hover:shadow-xl hover:shadow-brand/5">' +
        '<div class="relative aspect-[2/3] overflow-hidden">' + img +
        '<div class="cover-shine pointer-events-none absolute inset-0"></div>' +
        (score != null
          ? '<span class="absolute right-2 top-2 rounded-lg bg-score/90 px-2 py-0.5 text-xs font-bold text-ink-950">' + score.toFixed(1) + "</span>"
          : "") +
        "</div>" +
        '<div class="p-3"><p class="truncate text-sm font-semibold text-white" title="' + esc(title) + '">' + esc(title) + "</p>" +
        '<p class="mt-0.5 truncate text-xs text-slate-500">' + esc(sub) + "</p>" +
        '<p class="mt-1 truncate text-[10px] uppercase tracking-wide text-slate-600">' + esc(result.sources.join(" + ")) + "</p></div></button>"
      );
    })
    .join("");
  $("grid").querySelectorAll("[data-ref]").forEach((card) => {
    card.addEventListener("click", () => {
      const ref = card.getAttribute("data-ref");
      if (ref) openDetail(ref);
    });
  });
  icons();
}

// ---------------------------------------------------------------- detail
async function openDetail(ref) {
  showView("detail");
  const view = $("view-detail");
  view.innerHTML = '<div class="rounded-2xl border border-ink-700 bg-ink-900 p-6"><div class="skeleton h-64 w-full rounded-xl bg-ink-800"></div></div>';

  const code =
    'import { Shogo } from "shogo-anime";\n\n' +
    setupSnippet() + "\n" +
    "const anime = await shogo.findById(" + JSON.stringify(ref) + ");\n" +
    "// anime.ids, .titles, .synopsis, .ratings, .images, .links, .relations, .sources";
  try {
    const anime = await client.findById(ref);
    lastDetailRef = ref;
    noteFailures(anime.errors);
    renderDetail(view, anime, ref, code);
  } catch (err) {
    view.innerHTML =
      '<div class="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-200">' +
      '<p class="font-semibold">could not load ' + esc(ref) + "</p><p class=\"mt-1 opacity-80\">" + esc(err && err.message) + "</p></div>" +
      '<button id="detail-back" class="mt-4 rounded-lg bg-ink-800 px-4 py-2 text-sm text-white hover:bg-ink-700">back</button>';
    $("detail-back").addEventListener("click", () => (lastSearch ? doSearch(lastSearch) : showView("home")));
  }
  icons();
}

function scoreBadges(anime) {
  const parts = [];
  if (anime.score && anime.score.value != null) {
    parts.push(
      '<span class="inline-flex items-center gap-1.5 rounded-lg bg-brand/15 px-2 py-1 text-xs ring-1 ring-brand/30" title="shogo score — average of ' +
        anime.score.providers +
        " provider score(s): " +
        esc(JSON.stringify(anime.score.breakdown)) +
        '">' +
        '<span class="font-bold text-brand">' +
        anime.score.value.toFixed(2) +
        '</span><span class="text-sky-200/70">shogo</span></span>'
    );
  }
  const ratings = anime.ratings || {};
  for (const provider of Object.keys(ratings)) {
    const rating = ratings[provider];
    if (!rating || rating.score == null) continue;
    const scale = rating.scale || 10;
    const normalized = Math.round((rating.score / scale) * 100) / 10;
    parts.push(
      '<span class="inline-flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1 text-xs ring-1 ring-ink-700">' +
        '<span class="text-slate-500">' + esc(provider) + "</span>" +
        '<span class="font-bold text-score">' + normalized.toFixed(1) + "</span></span>"
    );
  }
  return parts.join("");
}

function renderDetail(view, anime, ref, code) {
  const title = anime.titles.romaji || anime.titles.english || "(untitled)";
  const cover = (anime.images.posters[0] || {}).url;
  const banner = (anime.images.banners[0] || {}).url || cover;
  const chips = [
    anime.type,
    anime.episodes ? anime.episodes + " episodes" : null,
    anime.status,
    anime.season ? anime.season.season + " " + anime.season.year : null,
    anime.durationSec ? Math.round(anime.durationSec / 60) + " min/ep" : null,
  ].filter(Boolean);

  const idRows = Object.keys(anime.ids)
    .map((key) => {
      const value = anime.ids[key];
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return (
        "<tr><td class=\"py-1 pr-3 text-xs text-slate-500\">" + esc(key) + '</td><td class="py-1 font-mono text-xs text-sky-300">' + esc(text) +
        (key === "shogo" ? ' <span class="chip ml-1 border-brand/40 text-sky-200">packed</span>' : "") +
        "</td></tr>"
      );
    })
    .join("");

  const streaming = anime.links.streaming
    .slice(0, 8)
    .map(
      (link) =>
        '<a href="' + esc(link.url) + '" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs text-slate-300 ring-1 ring-ink-700 hover:text-white">' +
        esc(link.service) + (link.dub ? ' <span class="text-[9px] text-score">dub</span>' : "") +
        '<i data-lucide="external-link" class="h-3 w-3"></i></a>'
    )
    .join(" ");

  const relations = anime.relations
    .slice(0, 6)
    .map((rel) => {
      const relRef = refFor(rel.ids, null);
      return (
        '<button ' + (relRef ? 'data-rel="' + esc(relRef) + '"' : "disabled") + ' class="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs ' +
        (relRef ? "hover:bg-ink-800" : "opacity-50") + '">' +
        '<span class="truncate text-slate-300">' + esc(rel.title || "(untitled)") + "</span>" +
        '<span class="chip shrink-0">' + esc(String(rel.type || "").toLowerCase().replace(/_/g, " ")) + "</span></button>"
      );
    })
    .join("");

  view.innerHTML =
    '<div class="relative overflow-hidden rounded-3xl border border-ink-700 bg-ink-900">' +
    (banner ? '<div class="absolute inset-x-0 top-0 h-64 bg-cover bg-center opacity-25 blur-[2px]" style="background-image:url(' + esc(banner) + ')"></div>' : "") +
    '<div class="relative flex flex-col gap-6 p-6 md:flex-row">' +
    (cover
      ? '<img src="' + esc(cover) + '" alt="" class="h-80 w-56 shrink-0 self-center rounded-xl object-cover shadow-2xl ring-1 ring-ink-700 md:self-start" />'
      : '<div class="grid h-80 w-56 shrink-0 place-items-center self-center rounded-xl bg-ink-800 text-slate-600 md:self-start"><i data-lucide="image-off" class="h-10 w-10"></i></div>') +
    '<div class="min-w-0 flex-1">' +
    '<div class="flex flex-wrap items-start justify-between gap-3">' +
    "<div>" +
    '<h1 class="font-display text-2xl font-extrabold text-white md:text-3xl">' + esc(title) + "</h1>" +
    (anime.titles.english && anime.titles.english !== title ? '<p class="mt-0.5 text-sm text-slate-400">' + esc(anime.titles.english) + "</p>" : "") +
    (anime.slug ? '<p class="mt-1 font-mono text-xs text-slate-500">' + esc(anime.slug) + "</p>" : "") +
    "</div>" +
    '<div class="flex flex-wrap gap-1.5">' + scoreBadges(anime) + "</div>" +
    "</div>" +
    '<div class="mt-3 flex flex-wrap gap-1.5">' + chips.map((chip) => '<span class="chip">' + esc(chip) + "</span>").join("") + "</div>" +
    '<div class="mt-3 flex flex-wrap gap-1.5">' + anime.genres.map((genre) => '<span class="chip border-brand/30 text-sky-200">' + esc(genre) + "</span>").join("") + "</div>" +
    (anime.synopsis
      ? '<p class="mt-4 text-sm leading-relaxed text-slate-400 clamp-lines" id="synopsis">' + esc(anime.synopsis) + "</p>" +
        '<button id="synopsis-toggle" class="mt-1 text-xs text-brand hover:underline">read more</button>'
      : "") +
    (streaming ? '<div class="mt-4 flex flex-wrap gap-1.5">' + streaming + "</div>" : "") +
    '<div class="mt-5 flex flex-wrap items-center gap-2">' +
    '<button id="detail-episodes" class="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-brand-dark"><i data-lucide="list-video" class="h-4 w-4"></i> Episodes</button>' +
    '<button id="detail-back2" class="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-4 py-2 text-sm text-white ring-1 ring-ink-700 hover:bg-ink-700"><i data-lucide="arrow-left" class="h-4 w-4"></i> Back</button>' +
    '<span class="text-xs text-slate-500">merged from <span class="text-slate-300">' + esc(anime.sources.join(", ")) + "</span>" + (anime.errors.length ? " · " + anime.errors.length + " provider error(s)" : "") + "</span>" +
    "</div></div></div></div>" +
    '<div class="mt-6 grid gap-6 lg:grid-cols-3">' +
    '<div class="lg:col-span-2"><div id="episodes-slot"></div></div>' +
    '<aside class="space-y-6">' +
    codeBlock(code, "findById()") +
    '<div class="rounded-2xl border border-ink-700 bg-ink-900 p-4"><p class="mb-2 font-display text-sm font-bold text-white">ids</p><table class="w-full">' + idRows + "</table>" +
    '<p class="mt-2 text-[11px] text-slate-500">store <code class="text-sky-300">ids.shogo</code> as a string — pure math, no lookups</p></div>' +
    (relations ? '<div class="rounded-2xl border border-ink-700 bg-ink-900 p-4"><p class="mb-2 font-display text-sm font-bold text-white">relations</p>' + relations + "</div>" : "") +
    "</aside></div>";

  const synopsisToggle = $("synopsis-toggle");
  if (synopsisToggle) {
    synopsisToggle.addEventListener("click", () => {
      const paragraph = $("synopsis");
      paragraph.classList.toggle("clamp-lines");
      synopsisToggle.textContent = paragraph.classList.contains("clamp-lines") ? "read more" : "show less";
    });
  }
  $("detail-back2").addEventListener("click", () => (lastSearch ? doSearch(lastSearch) : showView("home")));
  $("detail-episodes").addEventListener("click", () => renderEpisodesArea(ref));
  view.querySelectorAll("[data-rel]").forEach((button) => {
    button.addEventListener("click", () => openDetail(button.getAttribute("data-rel")));
  });
  icons();
}

// ---------------------------------------------------------------- episodes
async function renderEpisodesArea(ref) {
  const slot = $("episodes-slot");
  if (!slot) return;
  episodeMaxPages = 3;
  slot.innerHTML =
    '<div class="rounded-2xl border border-ink-700 bg-ink-900 p-4">' +
    '<div id="seasons-bar" class="mb-3"></div><div id="episodes-list"></div></div>';

  let seasons = [];
  try {
    seasons = await client.seasons(ref);
  } catch (err) {
    seasons = [];
  }
  const bar = $("seasons-bar");
  const groups = seasons.filter((season) => season.kind === "group" && season.number > 0);

  if (groups.length > 1) {
    // TMDB-style: one record with numbered seasons -> a picker drives episodes().
    bar.innerHTML =
      '<div class="flex items-center gap-2 text-xs text-slate-500"><span class="uppercase tracking-wider">season</span>' +
      '<select id="season-select" class="rounded-lg border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-white outline-none focus:border-brand">' +
      groups.map((season) => '<option value="' + season.number + '">' + esc(season.name || "Season " + season.number) + "</option>").join("") +
      '</select><span class="text-slate-600">grouped seasons (tmdb ids)' + (client.isConfigured("tmdb") ? "" : " — add a TMDB key") + "</span></div>";
    $("season-select").addEventListener("change", (event) => loadEpisodes(ref, Number(event.target.value)));
    loadEpisodes(ref, groups[0].number);
  } else if (seasons.length > 1) {
    // MAL/AniList/Kitsu style: each cour is its own entry -> jump between records.
    bar.innerHTML =
      '<div class="flex flex-wrap items-center gap-1.5 text-xs text-slate-500"><span class="mr-1 uppercase tracking-wider">seasons</span>' +
      seasons
        .map((season) => {
          const seasonRef = refFor(season.ids);
          const current = seasonRef === ref || (season.ids && season.ids.mal != null && ref === "mal:" + season.ids.mal);
          const label = season.name || (season.titles && season.titles.romaji) || "S" + season.number;
          const short = String(label).slice(0, 30);
          return (
            "<button " + (seasonRef ? 'data-season-ref="' + esc(seasonRef) + '"' : "disabled") +
            ' class="chip ' + (current ? "border-brand/50 text-sky-200" : "hover:border-brand/40 hover:text-white") + '"' +
            ' title="' + esc(label + " (" + (seasonRef || "no id") + ")") + '">' + esc(short) + (current ? " · here" : "") + "</button>"
          );
        })
        .join("") +
      '<span class="ml-1 text-slate-600">related entries — click to jump</span></div>';
    bar.querySelectorAll("[data-season-ref]").forEach((button) => {
      button.addEventListener("click", () => openDetail(button.getAttribute("data-season-ref")));
    });
    loadEpisodes(ref, 1);
  } else {
    bar.innerHTML = "";
    loadEpisodes(ref, 1);
  }
  icons();
}

async function loadEpisodes(ref, season) {
  const list = $("episodes-list") || $("episodes-slot");
  if (!list) return;
  list.innerHTML = '<div class="skeleton h-40 w-full rounded-2xl bg-ink-800"></div>';

  const tags = episodeProviderTags();
  const code =
    "const seasons = await shogo.seasons(" + JSON.stringify(ref) + ");\n" +
    "const eps = await shogo.episodes(" + JSON.stringify(ref) + ", { season: " + season + ", providers: " + JSON.stringify(tags) +
    (episodeMaxPages !== 3 ? ", maxPages: " + episodeMaxPages : "") +
    " });\n" +
    "// eps.consolidated.providers.<id>.total / .truncated -> page with { offset, maxPages }";
  try {
    const episodes = await client.episodes(ref, { season: season, providers: tags, maxPages: episodeMaxPages });
    noteFailures(episodes.errors);
    const rows = episodes
      .map(
        (episode) =>
          '<button data-ep="' + esc(episode.number) + '" class="flex w-full items-center gap-3 rounded-xl border border-ink-700 bg-ink-900 p-2 text-left transition hover:border-brand/40">' +
          '<span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-800 text-xs font-bold text-slate-400">' + esc(episode.number) + "</span>" +
          (episode.images && episode.images[0]
            ? '<img src="' + esc(episode.images[0].thumbUrl || episode.images[0].url) + '" class="h-10 w-16 shrink-0 rounded-md object-cover" alt="" loading="lazy" />'
            : '<span class="grid h-10 w-16 shrink-0 place-items-center rounded-md bg-ink-800 text-slate-600"><i data-lucide="video-off" class="h-4 w-4"></i></span>') +
          '<span class="min-w-0 flex-1"><span class="block truncate text-sm text-slate-200">' + esc(episode.title || "(untitled)") + "</span>" +
          '<span class="block truncate text-[11px] text-slate-500">' + esc([episode.airedAt && episode.airedAt.slice(0, 10), episode.durationSec ? Math.round(episode.durationSec / 60) + " min" : null, episode.sources.join("+")].filter(Boolean).join(" · ")) + "</span></span>" +
          '<i data-lucide="chevron-right" class="h-4 w-4 shrink-0 text-slate-600"></i></button>'
      )
      .join("");
    const consolidated = episodes.consolidated || { providers: {} };
    let totalKnown = null;
    for (const id of Object.keys(consolidated.providers)) {
      const info = consolidated.providers[id];
      if (info && info.total != null && (totalKnown == null || info.total > totalKnown)) totalKnown = info.total;
    }
    const truncated = !!consolidated.truncated;
    const countLabel =
      episodes.length + (truncated && totalKnown != null ? " of " + totalKnown : "") + " episode(s)";
    list.innerHTML =
      '<div class="mb-3 flex flex-wrap items-center gap-2">' +
      '<p class="shrink-0 font-display text-sm font-bold text-white">Season ' + season + " · " + countLabel + "</p>" +
      (truncated
        ? '<button id="load-more-episodes" class="inline-flex items-center gap-1 rounded-lg bg-ink-800 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-ink-700 hover:bg-ink-700"><i data-lucide="plus" class="h-3 w-3"></i> load more</button>'
        : "") +
      '<span class="min-w-0 flex-1 truncate text-right text-[11px] text-slate-500" title="' + esc(episodeSummaryText(episodes)) + '">' + esc(episodeSummaryText(episodes)) + "</span></div>" +
      '<div class="space-y-1.5">' +
      (rows || '<p class="text-sm text-slate-500">No episodes found — this entry may be a movie/special, or its sources list none yet.</p>') +
      "</div>" +
      '<div class="mt-4">' + codeBlock(code, "seasons() + episodes()") + "</div>";
    list.querySelectorAll("[data-ep]").forEach((button) => {
      button.addEventListener("click", () => openEpisode(ref, season, Number(button.getAttribute("data-ep"))));
    });
    const more = $("load-more-episodes");
    if (more) {
      more.addEventListener("click", () => {
        episodeMaxPages += 3;
        loadEpisodes(ref, season);
      });
    }
  } catch (err) {
    list.innerHTML =
      '<div class="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-200">episodes failed: ' + esc(err && err.message) + "</div>";
  }
  icons();
}

// ---------------------------------------------------------------- episode modal
async function openEpisode(ref, season, number) {
  const modal = $("episode-modal");
  const panel = $("episode-panel");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  panel.innerHTML = '<div class="skeleton h-64 w-full rounded-2xl bg-ink-800"></div>';

  const tags = episodeProviderTags();
  const skipTags = skipProviderTags();
  const code =
    "const ctx = await shogo.episode(" + JSON.stringify(ref) + ", { season: " + season + ", number: " + number + ",\n" +
    "  providers: " + JSON.stringify(tags) + ",   // episode lists\n" +
    "  skipProviders: " + JSON.stringify(skipTags) + " }); // skip times (AniSkip is keyless)\n" +
    "// ctx.episode.refs maps every provider's own numbering";

  try {
    const ctx = await client.episode(ref, { season: season, number: number, providers: tags, skipProviders: skipTags });
    noteFailures(ctx.errors);
    const skip = ctx.skip;
    const labelOf = (base, range) => (range && range.type && String(range.type).indexOf("mixed") === 0 ? base + " · mixed" : base);
    const skipChips = skip
      ? [
          skip.recap ? [labelOf("recap", skip.recap), skip.recap, "text-amber-300 border-amber-400/30"] : null,
          skip.op ? [labelOf("opening", skip.op), skip.op, "text-emerald-300 border-emerald-400/30"] : null,
          skip.ed ? [labelOf("ending", skip.ed), skip.ed, "text-rose-300 border-rose-400/30"] : null,
          skip.preview ? [labelOf("preview", skip.preview), skip.preview, "text-violet-300 border-violet-400/30"] : null,
        ]
          .filter(Boolean)
          .map(
            (entry) =>
              '<span class="rounded-lg border px-2.5 py-1 text-xs ' + entry[2] + '">' +
              entry[0] + " " + fmtTime(entry[1].start) + " → " + (entry[1].end != null ? fmtTime(entry[1].end) : "end") + "</span>"
          )
          .join(" ")
      : '<span class="text-xs text-slate-500">' + esc(skipHint(ctx)) + "</span>";

    const stills = ctx.images.slice(0, 6);
    const refsLine = Object.keys(ctx.episode.refs || {})
      .map((providerId) => {
        const ref = ctx.episode.refs[providerId];
        const bits = [ref.season != null && Number(ref.season) !== 1 ? "s" + ref.season : null, "e" + ref.number, ref.absoluteNumber != null && String(ref.absoluteNumber) !== String(ref.number) ? "abs " + ref.absoluteNumber : null]
          .filter(Boolean)
          .join(" ");
        return providerId + " " + bits;
      })
      .join(" · ");

    panel.innerHTML =
      '<div class="sticky top-0 z-10 flex items-center justify-between border-b border-ink-700 bg-ink-900/95 px-5 py-3 backdrop-blur">' +
      '<div class="min-w-0"><p class="truncate font-display text-sm font-bold text-white">' + esc(ctx.anime.titles.romaji) + "</p>" +
      '<p class="truncate text-xs text-slate-500">Episode ' + esc(ctx.episode.number) + (ctx.episode.title ? " — " + esc(ctx.episode.title) : "") + "</p></div>" +
      '<button id="episode-close" class="rounded-lg p-2 text-slate-400 hover:bg-ink-800 hover:text-white"><i data-lucide="x" class="h-4 w-4"></i></button></div>' +
      '<div class="space-y-4 p-5">' +
      '<div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">' +
      '<span class="chip">' + esc([ctx.episode.airedAt && ctx.episode.airedAt.slice(0, 10), ctx.episode.durationSec ? Math.round(ctx.episode.durationSec / 60) + " min" : null].filter(Boolean).join(" · ") || "?") + "</span>" +
      (refsLine ? '<span class="text-slate-500" title="each provider\'s own numbering">' + esc(refsLine) + "</span>" : "") +
      (ctx.errors.length ? '<span class="text-amber-300/80">' + ctx.errors.length + " provider error(s)</span>" : "") +
      "</div>" +
      '<div><p class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><span>skip times</span>' +
      (skip
        ? '<span class="chip border-emerald-400/30 normal-case tracking-normal text-emerald-200">' + esc(skip.source || "unknown") + "</span>" +
          (skip.episodeLength ? '<span class="text-[10px] normal-case tracking-normal text-slate-600">stored length ' + Math.round(skip.episodeLength) + "s</span>" : "")
        : "") +
      '</p><div class="flex flex-wrap gap-1.5">' + skipChips + "</div>" +
      (skip && skip.offsetsApplied ? '<p class="mt-1 text-[11px] text-slate-500">offset applied: ' + fmtTime(skip.offsetsApplied.offsetSec) + "s</p>" : "") + "</div>" +
      (stills.length
        ? '<div><p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">screenshots</p>' +
          '<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">' +
          stills
            .map(
              (image) =>
                '<a href="' + esc(image.url) + '" target="_blank" rel="noopener" class="overflow-hidden rounded-lg ring-1 ring-ink-700 hover:ring-brand/50">' +
                '<img src="' + esc(image.thumbUrl || image.url) + '" class="aspect-video w-full object-cover" loading="lazy" alt="" /></a>'
            )
            .join("") +
          "</div></div>"
        : '<p class="text-xs text-slate-500">no screenshots (add a TMDB key in settings for episode stills)</p>') +
      codeBlock(code, "episode()") +
      "</div>";

    $("episode-close").addEventListener("click", closeEpisode);
  } catch (err) {
    panel.innerHTML =
      '<div class="p-6"><p class="text-sm text-red-200">episode failed: ' + esc(err && err.message) + "</p>" +
      '<button id="episode-close" class="mt-4 rounded-lg bg-ink-800 px-4 py-2 text-sm text-white hover:bg-ink-700">close</button></div>';
    $("episode-close").addEventListener("click", closeEpisode);
  }
  icons();
}

function closeEpisode() {
  $("episode-modal").classList.add("hidden");
  $("episode-modal").classList.remove("flex");
  $("episode-panel").innerHTML = "";
}

$("episode-modal").addEventListener("click", (event) => {
  if (event.target === $("episode-modal")) closeEpisode();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeEpisode();
});

// ---------------------------------------------------------------- boot
$("brand").addEventListener("click", () => showView("home"));
renderPills();
renderSettings();
if (stored.skip) validateSkipKey();
icons();
