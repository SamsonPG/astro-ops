/**
 * Cloudflare Worker: serves the built site and caches page HTML at the edge, keyed on
 * BUILD_ID.
 *
 * WHY THE ID IS IN THE CACHE KEY
 * ------------------------------
 * A long edge TTL is only safe if a deploy can invalidate everything at once, and
 * `wrangler deploy` does not purge the edge cache. Putting the build id in the key means a
 * new build simply reads from a fresh keyspace — the previous build's HTML becomes
 * unreachable the instant the id changes, and the orphans expire unread.
 *
 * That is why the id MUST be content-derived. A random or timestamped one throws the whole
 * cache away on every deploy, so the long TTL never pays off, and two deploy pipelines
 * compute different ids for the same commit. `astro-ops check:build-id` fails the build if
 * the committed id no longer matches what is in dist.
 *
 * There is deliberately no purge step anywhere in this repo. Assets are content-hashed by
 * filename and immutable; pages are keyed on the build id. Nothing is left for a purge to
 * fix, and `purge_everything` would only throw away the asset cache every release.
 */
import { BUILD_ID } from './build-id.js';

/** What the browser and CDN are told. Independent of the edge cache below. */
const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, must-revalidate';

/** Safe at a year precisely because BUILD_ID is part of every key. */
const EDGE_TTL = 31536000;

/** Only real pages — hashed assets are already immutable and cached by the CDN. */
function looksLikePage(pathname) {
  return pathname.endsWith('/') || pathname.endsWith('.html');
}

/**
 * Cache key for one page of one build.
 *
 * The query string is dropped on purpose: page HTML does not vary by ?utm_source, and
 * keying on the raw URL gives every tagged inbound link its own miss.
 */
function pageCacheKey(url) {
  if (!looksLikePage(url.pathname)) return null;
  const key = new URL(`${url.origin}${url.pathname}`);
  key.searchParams.set('__build', BUILD_ID);
  return new Request(key.toString(), { method: 'GET' });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET') return env.ASSETS.fetch(request);

    const key = pageCacheKey(url);
    if (!key) return env.ASSETS.fetch(request);

    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('Cache-Control', PAGE_CACHE_CONTROL);
      res.headers.set('X-Edge-Cache', 'HIT');
      return res;
    }

    const origin = await env.ASSETS.fetch(request);

    // Only 200 HTML is stored. Caching a 404 for a year under a build key would outlive
    // the mistake that caused it.
    if (origin.status === 200 && (origin.headers.get('content-type') || '').includes('text/html')) {
      const stored = new Response(origin.clone().body, origin);
      stored.headers.set('Cache-Control', `public, max-age=${EDGE_TTL}`);
      ctx.waitUntil(cache.put(key, stored));
    }

    const res = new Response(origin.body, origin);
    res.headers.set('Cache-Control', PAGE_CACHE_CONTROL);
    res.headers.set('X-Edge-Cache', 'MISS');
    return res;
  },
};
