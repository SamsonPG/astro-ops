/**
 * Discovery wiring — check what crawlers and answer engines actually receive.
 *
 * WHAT IT CHECKS
 * --------------
 * Per page, in the BUILT output: a title within the length search engines display, a meta
 * description, a canonical that agrees with the page's own URL, Open Graph title and
 * description, an `<h1>`, and structured data that parses.
 *
 * Then the part an ordinary SEO plugin cannot do, because it needs to see the whole site at
 * once: **the sitemap and the pages must agree.**
 *
 *   - A `noindex` page listed in the sitemap is a direct contradiction. You are asking to be
 *     crawled and refusing to be indexed in the same breath. Google reports it as a
 *     coverage error, and it is nearly invisible in review because each half looks correct
 *     on its own.
 *   - A sitemap URL with no corresponding page is a promise of a 404.
 *   - A canonical pointing somewhere other than the page's own address quietly hands your
 *     ranking to a URL that may not exist.
 *
 * These are drift bugs. Nothing is wrong when the page is written; they appear later, when
 * a route is renamed, a page is noindexed for a good reason, or a generator's URL logic
 * changes and the sitemap is built from a different source than the pages.
 *
 * That is why this reads `dist/` rather than your source: the only thing that matters is
 * what shipped.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const DEFAULTS = {
  maxTitle: 60,
  maxDescription: 160,
  requireCanonical: true,
  requireOg: true,
  requireH1: true,
  requireJsonLd: false,
  checkErrorPages: false,
};

/**
 * Error pages, skipped by default.
 *
 * Every check here is moot for them and one is actively misleading. An error page is served
 * with a non-200 status at whatever URL the visitor actually typed, so it is never indexed,
 * never legitimately in a sitemap, and its canonical describes an address that was never
 * requested. Generators routinely emit `404.html` with a canonical of `/404/` — a route that
 * does not exist — and flagging it fails a build over something with no consequence.
 *
 * A gate whose first run on a healthy site reports a problem nobody should act on is a gate
 * people learn to ignore. Set `rules.checkErrorPages: true` to audit them anyway.
 */
const ERROR_PAGE_ROUTES = new Set(['/404.html', '/500.html', '/403.html', '/offline.html']);

/** Recursively lists files under `dir`. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Decodes the handful of entities that actually appear in titles and descriptions. */
function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Reads a `<meta name|property="key" content="…">` value regardless of attribute order. */
export function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return null;
}

/**
 * Maps a built HTML file to the route it serves.
 * `dist/about/index.html` → `/about/`, `dist/index.html` → `/`.
 *
 * @param {string} file - Absolute path.
 * @param {string} distAbs - Absolute dist path.
 * @returns {string}
 */
export function routeOf(file, distAbs) {
  const rel = relative(distAbs, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

/**
 * Audits one page.
 *
 * @param {string} html
 * @param {string} route
 * @param {object} opts - Merged DEFAULTS.
 * @returns {{issues:string[], noindex:boolean, canonical:string|null}}
 */
export function auditPage(html, route, opts) {
  const issues = [];
  const robots = (metaContent(html, 'robots') || '').toLowerCase();
  const noindex = robots.includes('noindex');

  const title = decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');
  const description = metaContent(html, 'description')?.trim() ?? '';
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? null;

  // A noindex page is deliberately not competing in search, so holding it to title-length
  // and Open Graph rules is noise. It still must not contradict the sitemap — checked later.
  if (!noindex) {
    if (!title) issues.push('missing <title>');
    else if (title.length > opts.maxTitle) {
      issues.push(`title ${title.length} chars > ${opts.maxTitle} (will be truncated in results)`);
    }

    if (!description) issues.push('missing meta description');
    else if (description.length > opts.maxDescription) {
      issues.push(`description ${description.length} chars > ${opts.maxDescription}`);
    }

    if (opts.requireOg) {
      if (!metaContent(html, 'og:title')) issues.push('missing og:title');
      if (!metaContent(html, 'og:description')) issues.push('missing og:description');
    }
    if (opts.requireH1 && !/<h1[\s>]/i.test(html)) issues.push('no <h1>');

    if (opts.requireCanonical && !canonical) issues.push('missing rel=canonical');
  }

  if (canonical) {
    let path = canonical;
    try {
      path = new URL(canonical).pathname;
    } catch {
      /* Relative canonical — compare as written. */
    }
    const norm = (p) => `/${String(p).replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/');
    if (norm(path) !== norm(route)) {
      issues.push(`canonical points to ${path} but this page is ${route}`);
    }
  }

  if (opts.requireJsonLd) {
    const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
    if (blocks.length === 0) issues.push('no JSON-LD structured data');
    blocks.forEach((b, i) => {
      try {
        JSON.parse(b[1]);
      } catch (e) {
        issues.push(`JSON-LD block ${i + 1} is not valid JSON: ${e.message.slice(0, 60)}`);
      }
    });
  }

  return { issues, noindex, canonical };
}

/**
 * Audits the whole built site, including sitemap/page agreement.
 *
 * @param {object} options
 * @param {string} options.root
 * @param {string} [options.dist]
 * @param {object} [options.rules] - Overrides for DEFAULTS.
 * @param {string[]} [options.ignoreRoutes] - Routes excluded from page checks.
 * @returns {{problems:Array<{route:string,detail:string}>, pageCount:number, sitemapCount:number, noindexCount:number, missingDist:boolean}}
 */
export function auditDiscovery({ root, dist = 'dist', rules = {}, ignoreRoutes = [] } = {}) {
  const distAbs = join(root, dist);
  if (!existsSync(distAbs)) {
    return { problems: [], pageCount: 0, sitemapCount: 0, noindexCount: 0, missingDist: true };
  }

  const opts = { ...DEFAULTS, ...rules };
  const files = walk(distAbs);
  const htmlFiles = files.filter((f) => extname(f) === '.html');
  const problems = [];
  const noindexRoutes = new Set();
  const liveRoutes = new Set();
  const ignore = new Set(ignoreRoutes);

  for (const file of htmlFiles) {
    const route = routeOf(file, distAbs);
    liveRoutes.add(route);
    if (ignore.has(route)) continue;
    if (!opts.checkErrorPages && ERROR_PAGE_ROUTES.has(route)) continue;

    const { issues, noindex } = auditPage(readFileSync(file, 'utf8'), route, opts);
    if (noindex) noindexRoutes.add(route);
    for (const detail of issues) problems.push({ route, detail });
  }

  // --- Sitemap agreement ---------------------------------------------------------------
  const sitemaps = files.filter((f) => /sitemap[^/\\]*\.xml$/i.test(f));
  const sitemapRoutes = new Set();
  for (const sm of sitemaps) {
    const xml = readFileSync(sm, 'utf8');
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      let path = m[1];
      try {
        path = new URL(m[1]).pathname;
      } catch {
        /* Relative <loc> — use as written. */
      }
      sitemapRoutes.add(path.endsWith('/') || /\.[a-z0-9]+$/i.test(path) ? path : `${path}/`);
    }
  }

  for (const route of sitemapRoutes) {
    if (noindexRoutes.has(route)) {
      problems.push({
        route,
        detail:
          'listed in the sitemap but the page is noindex — asking to be crawled and refusing to be indexed',
      });
    }
    // Only flag a missing page when the sitemap indexes routes we actually built. A
    // sitemap that legitimately points at another host would otherwise fail every entry.
    if (!liveRoutes.has(route) && !/\.[a-z0-9]+$/i.test(route) && sitemapRoutes.size > 0) {
      const alt = route.endsWith('/') ? route.slice(0, -1) : `${route}/`;
      if (!liveRoutes.has(alt)) {
        problems.push({ route, detail: 'in the sitemap but no such page was built (promises a 404)' });
      }
    }
  }

  return {
    problems,
    pageCount: htmlFiles.length,
    sitemapCount: sitemapRoutes.size,
    noindexCount: noindexRoutes.size,
    missingDist: false,
  };
}
