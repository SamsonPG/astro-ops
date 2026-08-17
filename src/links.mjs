/**
 * Internal link integrity.
 *
 * WHAT IT CHECKS
 * --------------
 * Two things, in one pass over the same hrefs, because scanning your whole output twice to
 * answer two questions about the same links is wasteful:
 *
 *   1. **Broken internal links.** An `href` to a page you do not ship. The most common
 *      cause is a rename: the route moves, twelve pages still point at the old path, and
 *      nothing fails because a 404 is a perfectly valid HTTP response.
 *
 *   2. **Missing trailing slashes.** `/about` and `/about/` are two URLs to a crawler. If
 *      your host redirects one to the other, every internal link pointing the wrong way
 *      costs a redirect hop on the way to the page — and search engines see two addresses
 *      for one document.
 *
 * WHY THIS CANNOT BE A UNIT TEST
 * ------------------------------
 * A link is only broken relative to what was actually built. The component that renders it
 * is correct in isolation; the page it points at simply is not there any more. You have to
 * look at the finished output, which is why this reads `dist/` and not source.
 *
 * WHAT IS DELIBERATELY NOT A FAILURE
 * ----------------------------------
 * External URLs, `mailto:`, `tel:`, `#anchors`, `?queries`, `data:` and protocol-relative
 * links. Checking external links means making network requests from your build — slow,
 * flaky, and it fails when someone else's server has a bad afternoon. A build that goes red
 * because a third party is down teaches people to ignore it.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, normalize } from 'node:path';

const HREF_RE = /\bhref=["']([^"']+)["']/gi;

/** Recursively lists .html files under `dir`. */
function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkHtml(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

/**
 * True when an href is a same-origin path this gate should verify.
 *
 * @param {string} href
 * @returns {boolean}
 */
export function isInternalPath(href) {
  if (!href) return false;
  if (/^(https?:|mailto:|tel:|data:|javascript:|blob:)/i.test(href)) return false;
  if (href.startsWith('//')) return false; // protocol-relative = another origin
  if (href.startsWith('#') || href.startsWith('?')) return false;
  return href.startsWith('/');
}

/**
 * Maps a URL path to the file that would serve it.
 * `/about/` → `dist/about/index.html`; `/feed.xml` → `dist/feed.xml`.
 *
 * @param {string} distAbs
 * @param {string} href
 * @returns {string}
 */
export function targetFor(distAbs, href) {
  const path = href.split('#')[0].split('?')[0];
  const last = path.split('/').filter(Boolean).pop() ?? '';
  // A dot in the final segment means a real file; anything else is a directory route.
  if (last.includes('.')) return normalize(join(distAbs, path));
  return normalize(join(distAbs, path, 'index.html'));
}

/**
 * True when an extensionless internal path is missing its trailing slash.
 *
 * @param {string} href
 * @returns {boolean}
 */
export function missingTrailingSlash(href) {
  const bare = href.split('#')[0].split('?')[0];
  if (!bare || bare === '/') return false;
  const last = bare.split('/').filter(Boolean).pop() ?? '';
  if (last.includes('.')) return false; // a file, not a directory route
  return !bare.endsWith('/');
}

/**
 * Scans built output for broken links and trailing-slash inconsistencies.
 *
 * @param {object} options
 * @param {string} options.root - Project root (absolute).
 * @param {string} [options.dist]
 * @param {boolean} [options.requireTrailingSlash] - Off for hosts configured the other way.
 * @param {string[]} [options.ignore] - Paths to skip (exact match).
 * @returns {{broken:Array, slashes:Array, linkCount:number, fileCount:number, missingDist:boolean}}
 */
export function checkLinks({ root, dist = 'dist', requireTrailingSlash = true, ignore = [] } = {}) {
  const distAbs = join(root, dist);
  if (!existsSync(distAbs)) {
    return { broken: [], slashes: [], linkCount: 0, fileCount: 0, missingDist: true };
  }

  const skip = new Set(ignore);
  const files = walkHtml(distAbs);
  const broken = [];
  const slashes = [];
  // Each distinct problem is reported ONCE even when it appears on 300 pages. A site-wide
  // header with one bad link would otherwise produce 300 identical lines and bury
  // everything else.
  const seenBroken = new Set();
  const seenSlash = new Set();
  let linkCount = 0;

  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const where = relative(root, file).split(sep).join('/');

    HREF_RE.lastIndex = 0;
    for (const m of html.matchAll(HREF_RE)) {
      const href = m[1];
      if (!isInternalPath(href) || skip.has(href)) continue;
      linkCount += 1;

      if (!existsSync(targetFor(distAbs, href)) && !seenBroken.has(href)) {
        seenBroken.add(href);
        broken.push({ href, where });
      }

      if (requireTrailingSlash && missingTrailingSlash(href) && !seenSlash.has(href)) {
        seenSlash.add(href);
        slashes.push({ href, where });
      }
    }
  }

  return { broken, slashes, linkCount, fileCount: files.length, missingDist: false };
}
