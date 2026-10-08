// skipTimes() + the shared skip resolver used by episode(). Default order:
// AniSkip (keyless, real ranges), then Anime Skip (client id) when configured.
// Explicitly tagging anime-skip without a key throws MissingApiKeyError.

import { MappingError, MissingApiKeyError } from "../core/errors.js";
import { formatId } from "../core/ids.js";
import { SKIP_PROVIDERS } from "../providers/index.js";
import { resolveIds } from "./map.js";
import { metaOf, pickError } from "./common.js";

export function skipProviderList(client, opts = {}) {
  const wanted = opts.skipProviders === "all" ? SKIP_PROVIDERS : opts.skipProviders || client.config.skipProviders || SKIP_PROVIDERS;
  return wanted.filter((id) => SKIP_PROVIDERS.indexOf(id) >= 0);
}

function explicitlyTagged(client, opts) {
  return Array.isArray(opts.skipProviders) || Array.isArray(client.config.skipProviders);
}

// MAL-flat numbering when available.
function episodeNumberFor(match) {
  const refs = match.refs || {};
  if (refs.jikan && refs.jikan.number != null) return refs.jikan.number;
  if (refs.kitsu && refs.kitsu.number != null) return refs.kitsu.number;
  if (match.absoluteNumber != null) return match.absoluteNumber;
  return match.number;
}

export async function resolveSkip(client, ids, match, opts = {}) {
  const providers = skipProviderList(client, opts);
  const errors = [];
  const skipped = [];
  const tagged = explicitlyTagged(client, opts);

  for (const providerId of providers) {
    if (providerId === "aniskip") {
      if (ids.mal == null) {
        skipped.push({ provider: providerId, reason: "no-mal-id" });
        continue;
      }
    } else if (providerId === "anime-skip") {
      if (ids.anilist == null) {
        skipped.push({ provider: providerId, reason: "no-anilist-id" });
        continue;
      }
      if (!client.isConfigured("anime-skip") && !client.config.proxy) {
        if (tagged) throw new MissingApiKeyError("anime-skip"); // explicitly requested -> ask for it
        skipped.push({ provider: providerId, reason: "no-key" });
        continue;
      }
    } else {
      continue;
    }

    try {
      let skip = null;
      if (providerId === "aniskip") {
        skip = await client.registry.aniskip.skipTimes(
          client.ctx("aniskip"),
          {
            malId: ids.mal,
            episode: episodeNumberFor(match),
            episodeLength: match.durationSec != null ? match.durationSec : opts.episodeLength,
          },
          opts
        );
      } else {
        skip = await client.registry["anime-skip"].skipTimes(
          client.ctx("anime-skip"),
          {
            aniListId: ids.anilist,
            season: match.season != null ? match.season : opts.season,
            number: match.number,
            absoluteNumber: match.absoluteNumber != null ? match.absoluteNumber : opts.absoluteNumber,
            audio: opts.audio,
            serviceUrl: opts.serviceUrl,
          },
          opts
        );
      }
      if (skip) return { skip, provider: providerId, errors, skipped };
      skipped.push({ provider: providerId, reason: "not-found" });
    } catch (err) {
      if (err && err.code === "MISSING_KEY") throw err;
      errors.push(pickError(err, providerId));
    }
  }
  return { skip: null, provider: null, errors, skipped };
}

export function attachSkipEnvelope(skip, client, started, errors, skipped) {
  if (!skip) return null;
  skip.errors = errors;
  skip.skipped = skipped;
  skip.meta = metaOf(client, started);
  return skip;
}

export async function skipTimes(client, ref, opts = {}) {
  const started = client.clock.now();
  const parsed = client.parseId(ref);
  let seed = parsed.ids;
  if (parsed.kind === "slug") {
    const mod = await import("./identify.js");
    const match = await mod.findBySlug(client, parsed.slug, opts);
    if (!match.best) throw new MappingError("Could not resolve slug to ids: " + parsed.slug);
    seed = match.best.ids;
  }

  const resolved = await resolveIds(client, seed, opts);
  const ids = resolved.all;
  if (ids.mal == null && ids.anilist == null) {
    throw new MappingError(
      "skipTimes() needs a MAL id (AniSkip) or an AniList id (Anime Skip); none could be resolved for " + formatId(ids)
    );
  }

  const match = {
    number: opts.number != null ? opts.number : opts.absoluteNumber != null ? opts.absoluteNumber : 1,
    season: opts.season != null ? opts.season : null,
    absoluteNumber: opts.absoluteNumber != null ? opts.absoluteNumber : null,
    durationSec: opts.episodeLength != null ? opts.episodeLength : null,
  };

  const outcome = await resolveSkip(client, ids, match, opts);
  return attachSkipEnvelope(
    outcome.skip,
    client,
    started,
    resolved.errors.concat(outcome.errors),
    resolved.skipped.concat(outcome.skipped)
  );
}
