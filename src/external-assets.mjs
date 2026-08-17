/**
 * External-asset tripwire.
 *
 * WHAT IT IS
 * ----------
 * Scans your BUILT output and fails when a page would fetch a script, stylesheet, font, or
 * media file from a host you did not authorise. It reads what you actually ship, not your
 * source, because that is what a visitor's browser executes.
 *
 * WHY A GATE AND NOT A CODE REVIEW
 * --------------------------------
 * "We don't use third-party CDNs" is a claim that decays silently. A dependency adds a
 * font import three minor versions later; someone pastes an embed snippet into a blog post;
 * an integration ships a beacon behind a feature flag that defaults on. None of it breaks a
 * test, none of it shows up in a diff you would notice, and the page still looks right.
 *
 * The cost of being wrong is not aesthetic. If your site claims to be private, or you have
 * a published privacy policy, or you operate under GDPR, then an unannounced third-party
 * request is a factual error in a legal document — and the only way to know it happened is
 * to look at the network tab of a page nobody thought to check.
 *
 * WHAT COUNTS AS A VIOLATION
 * --------------------------
 * Anything the browser fetches on its own: `<script src>`, `<link rel=stylesheet|preload>`
 * or `as=font|style|script`, media embeds (`img`/`iframe`/`video`/`audio`/`source`/`embed`/
 * `object`), CSS `@import` and `@font-face` urls, and inline JS that assigns `.src` to a
 * remote URL.
 *
 * A plain `<a href="https://example.com">` is NOT a violation. A link the reader chooses to
 * click is not a request your page made on their behalf, and treating it as one makes the
 * gate so noisy people delete it.
 *
 * TWO BEHAVIOURS THAT LOOK LIKE BUGS AND ARE NOT
 * ----------------------------------------------
 * 1. `<code>` blocks are stripped before the prose scan. A privacy page that NAMES a
 *    tracker so readers can verify its absence would otherwise flag itself. Documenting a
 *    beacon honestly must not be indistinguishable from loading one. A real beacon is a
 *    `<script src>` and is still caught by the tag scan, which does not strip anything.
 *
 * 2. `data:` and `blob:` URLs pass. They are bytes already in the document; there is no
 *    request and no third party.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

/**
 * Hosts that are load-bearing for tracking, ads, or font CDNs. Matching one is not
 * automatically a failure — it is a failure when it appears as a fetched asset, or in
 * prose outside a `<code>` block, which usually means a snippet was pasted in.
 */
const KNOWN_THIRD_PARTY = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'use.fontawesome.com',
  'use.typekit.net',
  'static.cloudflareinsights.com',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'pagead2.googlesyndication.com',
  'fundingchoicesmessages.google.com',
  'doubleclick.net',
];

const TAG_RE = /<(?:script|link|img|source|iframe|video|audio|embed|object)\b[^>]*>/gi;
const SRC_RE = /\b(?:src|href)=["']([^"']+)["']/i;
const REL_RE = /\brel=["']([^"']+)["']/i;
const AS_RE = /\bas=["']([^"']+)["']/i;
const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/gi;
const FONT_FACE_RE = /@font-face\s*\{[^}]*url\(\s*["']?([^"')]+)["']?/gi;
const INLINE_SRC_RE = /\.src\s*=\s*["'](https?:\/\/[^"']+|\/\/[^"']+)["']/gi;
const MEDIA_TAGS = new Set(['img', 'source', 'iframe', 'video', 'audio', 'embed', 'object']);

/**
 * True when a URL points at another origin.
 *
 * Protocol-relative (`//host/x`) counts: it inherits the page's scheme but not its host,
 * and is a classic way an external script slips past a naive `https?://` check.
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isRemoteUrl(raw) {
  const u = String(raw ?? '').trim();
  if (!u) return false;
  if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#')) return false;
  if (u.startsWith('//')) return true;
  return /^https?:\/\//i.test(u);
}

/** Hostname of a possibly protocol-relative URL, or '' when unparseable. */
function hostOf(raw) {
  try {
    return new URL(String(raw).startsWith('//') ? `https:${raw}` : raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Builds the allow predicate.
 *
 * Host matching is exact or a dot-suffix ("example.com" allows "cdn.example.com" but NOT
 * "notexample.com"). Naive `includes()` on a hostname is how an allowlist for
 * "mysite.com" ends up permitting "mysite.com.evil.tld".
 *
 * @param {string[]} allowHosts
 * @param {string[]} allowUrlPrefixes
 */
function makeAllow(allowHosts, allowUrlPrefixes) {
  const hosts = allowHosts.map((h) => h.toLowerCase().replace(/^\./, ''));
  return (url) => {
    if (allowUrlPrefixes.some((p) => String(url).startsWith(p))) return true;
    const host = hostOf(url);
    if (!host) return false;
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  };
}

/** Recursively lists files under `dir`. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * Scans built output for third-party asset loads.
 *
 * @param {object} options
 * @param {string} options.root - Project root (absolute).
 * @param {string} [options.dist] - Build output dir, relative to root.
 * @param {string[]} [options.allowHosts] - Hosts permitted to serve assets.
 * @param {string[]} [options.allowUrlPrefixes] - Exact URL prefixes permitted.
 * @returns {{ issues: Array<{file:string,detail:string,kind:string}>, htmlCount:number, cssCount:number, missingDist:boolean }}
 */
export function scanExternalAssets({
  root,
  dist = 'dist',
  allowHosts = [],
  allowUrlPrefixes = [],
} = {}) {
  const distAbs = join(root, dist);
  if (!existsSync(distAbs)) {
    return { issues: [], htmlCount: 0, cssCount: 0, missingDist: true };
  }

  const isAllowed = makeAllow(allowHosts, allowUrlPrefixes);
  const files = walk(distAbs);
  const htmlFiles = files.filter((f) => extname(f) === '.html');
  const cssFiles = files.filter((f) => extname(f) === '.css');
  const issues = [];
  const rel = (f) => relative(root, f).split(sep).join('/');

  const add = (file, kind, detail) => issues.push({ file: rel(file), kind, detail });

  for (const file of cssFiles) {
    const css = readFileSync(file, 'utf8');
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(css))) {
      if (isRemoteUrl(m[1]) && !isAllowed(m[1])) add(file, 'css-import', `@import ${m[1]}`);
    }
    FONT_FACE_RE.lastIndex = 0;
    while ((m = FONT_FACE_RE.exec(css))) {
      if (isRemoteUrl(m[1]) && !isAllowed(m[1])) add(file, 'css-font', `@font-face url(${m[1]})`);
    }
  }

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');

    let tag;
    TAG_RE.lastIndex = 0;
    while ((tag = TAG_RE.exec(html))) {
      const el = tag[0];
      const name = el.slice(1, el.search(/[\s>]/)).toLowerCase();
      const url = el.match(SRC_RE)?.[1];
      if (!url || !isRemoteUrl(url) || isAllowed(url)) continue;

      if (name === 'script') {
        add(file, 'script', `<script src="${url}">`);
      } else if (name === 'link') {
        const relAttr = (el.match(REL_RE)?.[1] || '').toLowerCase();
        const asAttr = (el.match(AS_RE)?.[1] || '').toLowerCase();
        // Only rels the browser FETCHES. dns-prefetch/preconnect are hints that make no
        // asset request; flagging them would be wrong, though they are a good smell that
        // something else is about to.
        const fetches =
          /\bstylesheet\b/.test(relAttr) ||
          /\bpreload\b/.test(relAttr) ||
          /\bmodulepreload\b/.test(relAttr) ||
          ['style', 'font', 'script'].includes(asAttr);
        if (fetches) add(file, 'link', `<link rel="${relAttr || asAttr}" href="${url}">`);
      } else if (MEDIA_TAGS.has(name)) {
        add(file, 'media', `<${name} src="${url}">`);
      }
    }

    INLINE_SRC_RE.lastIndex = 0;
    let m;
    while ((m = INLINE_SRC_RE.exec(html))) {
      if (!isAllowed(m[1])) add(file, 'inline-script', `inline JS assigns .src = "${m[1]}"`);
    }

    // Prose scan, with <code> removed — see the header note. This catches a pasted snippet
    // whose attribute order defeats the tag regex, without punishing a page that documents
    // a tracker in order to say it is absent.
    const prose = html.replace(/<code[\s\S]*?<\/code>/gi, '').replace(/<pre[\s\S]*?<\/pre>/gi, '');
    for (const host of KNOWN_THIRD_PARTY) {
      if (prose.includes(host) && !isAllowed(`https://${host}/`)) {
        add(file, 'known-third-party', `references ${host} outside a <code> block`);
      }
    }
  }

  return { issues, htmlCount: htmlFiles.length, cssCount: cssFiles.length, missingDist: false };
}
