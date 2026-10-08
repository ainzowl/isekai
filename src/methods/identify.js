// identify(): name -> best match with a probability score; findBySlug().

import { slugify } from "../core/ids.js";
import { InvalidIdError } from "../core/errors.js";
import { search } from "./search.js";
import { metaOf, pickError } from "./common.js";

const STOPWORDS = ["the", "a", "an", "of", "and", "to", "in", "on", "wa", "ga", "no"];

export function tokensOf(text) {
  return slugify(text)
    .split("-")
    .filter((t) => t && STOPWORDS.indexOf(t) < 0);
}

function trigramSet(text) {
  const s = slugify(text).replace(/-/g, " ");
  if (!s) return new Set();
  if (s.length < 3) return new Set([s]);
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  return shared / (sa.size + sb.size - shared);
}

export function similarity(querySlug, queryTokens, title) {
  const titleSlug = slugify(title);
  if (!titleSlug) return { score: 0, reason: null };
  if (titleSlug === querySlug) return { score: 1, reason: "exact title" };
  const trigram = dice(trigramSet(querySlug), trigramSet(titleSlug));
  const token = jaccard(queryTokens, tokensOf(title));
  return { score: Math.min(0.99, 0.6 * trigram + 0.4 * token), reason: null };
}

export function scoreCandidate(querySlug, candidate, hint) {
  const queryTokens = tokensOf(querySlug);
  const titles = [];
  if (candidate.titles) {
    if (candidate.titles.romaji) titles.push(candidate.titles.romaji);
    if (candidate.titles.english) titles.push(candidate.titles.english);
    if (candidate.titles.native) titles.push(candidate.titles.native);
    if (candidate.titles.localized) {
      for (const lang of Object.keys(candidate.titles.localized)) titles.push(candidate.titles.localized[lang]);
    }
  }
  if (candidate.slug) titles.push(candidate.slug);
  for (const syn of candidate.synonyms || []) titles.push(syn);

  let best = { score: 0, reason: null };
  for (const title of titles) {
    const scored = similarity(querySlug, queryTokens, title);
    if (scored.score > best.score) best = scored;
  }

  const reasons = [];
  if (best.reason) reasons.push(best.reason);
  let score = best.score;

  if (hint) {
    if (hint.year != null && candidate.year != null && Math.abs(hint.year - candidate.year) <= 1) {
      score += 0.08;
      reasons.push("year match");
    }
    if (hint.type && candidate.type && String(hint.type).toUpperCase() === String(candidate.type).toUpperCase()) {
      score += 0.05;
      reasons.push("format match");
    }
    if (hint.episodes != null && candidate.episodes != null && Number(hint.episodes) === Number(candidate.episodes)) {
      score += 0.05;
      reasons.push("episode count match");
    }
  }

  if (!reasons.length && score > 0) reasons.push("fuzzy title similarity " + score.toFixed(2));
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

function softmax(scores, temperature) {
  if (!scores.length) return [];
  const t = temperature || 0.1;
  const exps = scores.map((s) => Math.exp(s / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function matchShape(result) {
  return {
    slug: result.slug || (result.titles && result.titles.romaji ? slugify(result.titles.romaji) : null),
    ids: result.ids,
    titles: result.titles,
    type: result.type || null,
    year: result.year || null,
    episodes: result.episodes != null ? result.episodes : null,
    sources: result.sources || (result.provider ? [result.provider] : []),
  };
}

export async function identify(client, name, opts = {}) {
  const started = client.clock.now();
  const threshold = opts.threshold != null ? opts.threshold : client.config.identifyThreshold;
  const querySlug = slugify(name);
  if (!querySlug) throw new InvalidIdError("Cannot identify an empty name");

  const found = await search(client, name, {
    limit: opts.limit || 10,
    providers: opts.providers,
    signal: opts.signal,
  });

  const scored = found.results.map((result) => {
    const { score, reasons } = scoreCandidate(querySlug, result, opts.hint);
    return Object.assign(matchShape(result), { score, confidence: score, reasons });
  });
  scored.sort((a, b) => b.score - a.score);

  const shares = softmax(scored.map((c) => c.score));
  for (let i = 0; i < scored.length; i++) {
    scored[i].share = shares[i];
    scored[i].confidence = Math.round(scored[i].score * shares[i] * 1000) / 1000;
  }

  let best = scored.length ? scored[0] : null;
  if (best && best.confidence < threshold) best = null;
  if (best && (opts.full || opts.withData)) {
    const { findById } = await import("./find.js");
    best.anime = await findById(client, best.ids, { include: opts.include, signal: opts.signal });
  }

  return {
    best,
    candidates: scored,
    errors: found.errors,
    meta: metaOf(client, started, { providersQueried: found.meta.providersQueried }),
  };
}

// Native Kitsu slug, then catalog index, then identify().
export async function findBySlug(client, slug, opts = {}) {
  const started = client.clock.now();
  const clean = slugify(slug);
  if (!clean) throw new InvalidIdError("Cannot slugify: " + JSON.stringify(slug));
  const errors = [];

  if (client.isConfigured("kitsu")) {
    try {
      const canvas = await client.registry.kitsu.bySlug(client.ctx("kitsu"), clean, opts);
      if (canvas) {
        const match = Object.assign(matchShape(canvas), {
          slug: canvas.slug || clean,
          confidence: 1,
          reasons: ["native kitsu slug"],
          sources: ["kitsu"],
        });
        if (opts.full || opts.withData) {
          const { findById } = await import("./find.js");
          match.anime = await findById(client, canvas.ids, { include: opts.include, signal: opts.signal });
        }
        return { best: match, candidates: [match], errors, meta: metaOf(client, started, { providersQueried: ["kitsu"] }) };
      }
    } catch (err) {
      errors.push(pickError(err, "kitsu"));
    }
  }

  if (client._catalog) {
    const entry = client._catalog.bySlug(clean);
    if (entry) {
      const match = {
        slug: entry.slug,
        ids: { mal: entry.mal, anilist: entry.anilist, kitsu: entry.kitsu, shogo: entry.shogoId },
        titles: entry.titles,
        confidence: 1,
        reasons: ["catalog slug"],
        sources: [client._catalog.source],
      };
      if (opts.full || opts.withData) {
        const { findById } = await import("./find.js");
        match.anime = await findById(client, match.ids, { include: opts.include, signal: opts.signal });
      }
      return { best: match, candidates: [match], errors, meta: metaOf(client, started, { providersQueried: [] }) };
    }
  }

  const deslugged = clean.replace(/-/g, " ");
  const guess = await identify(client, deslugged, Object.assign({}, opts, {
    threshold: opts.threshold != null ? opts.threshold : 0.75,
    limit: opts.limit || 10,
  }));
  return { best: guess.best, candidates: guess.candidates, errors: errors.concat(guess.errors), meta: guess.meta };
}
