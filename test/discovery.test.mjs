/**
 * Tests for discovery checks.
 *
 * The sitemap/noindex agreement cases matter most: each half looks correct in isolation,
 * which is why the contradiction survives code review and only shows up months later in a
 * Search Console coverage report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auditDiscovery, auditPage, routeOf, metaContent } from '../src/discovery.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-ops-disc-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const page = (over = {}) => {
  const o = {
    title: 'A perfectly reasonable title',
    desc: 'A description that comfortably fits inside the limit search engines display.',
    canonical: 'https://example.com/about/',
    ...over,
  };
  return `<html><head>
    <title>${o.title}</title>
    <meta name="description" content="${o.desc}">
    ${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
    <meta property="og:title" content="${o.title}">
    <meta property="og:description" content="${o.desc}">
    ${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
  </head><body><h1>Hi</h1></body></html>`;
};

const RULES = {
  maxTitle: 60,
  maxDescription: 160,
  requireCanonical: true,
  requireOg: true,
  requireH1: true,
  requireJsonLd: false,
};

test('metaContent reads a tag regardless of attribute order', () => {
  assert.equal(metaContent('<meta name="description" content="A">', 'description'), 'A');
  assert.equal(metaContent('<meta content="B" property="og:title">', 'og:title'), 'B');
  assert.equal(metaContent('<meta name="x" content="&amp;">', 'x'), '&', 'entities decoded');
});

test('routeOf maps built files to the URLs they serve', () => {
  assert.equal(routeOf('/d/index.html', '/d'), '/');
  assert.equal(routeOf('/d/about/index.html', '/d'), '/about/');
  assert.equal(routeOf('/d/feed.html', '/d'), '/feed.html');
});

test('a well-formed page produces no issues', () => {
  assert.deepEqual(auditPage(page(), '/about/', RULES).issues, []);
});

test('flags an over-long title and a canonical pointing elsewhere', () => {
  const r = auditPage(
    page({ title: 'x'.repeat(80), canonical: 'https://example.com/elsewhere/' }),
    '/about/',
    RULES,
  );
  assert.equal(r.issues.length, 2);
  assert.ok(r.issues.some((i) => i.includes('80 chars')));
  assert.ok(r.issues.some((i) => i.includes('/elsewhere/')));
});

test('a noindex page is exempt from title/OG rules but still parsed', () => {
  // It is deliberately not competing in search, so holding it to display rules is noise.
  const html = page({
    robots: 'noindex, follow',
    title: '',
    canonical: 'https://example.com/private/',
  });
  const r = auditPage(html, '/private/', RULES);
  assert.equal(r.noindex, true);
  assert.deepEqual(r.issues, []);
});

test('a noindex page is still held to its canonical', () => {
  // Exemption covers display rules, not correctness. A canonical pointing at another page
  // misdirects whatever equity the page has, and noindex does not make that harmless.
  const html = page({ robots: 'noindex', canonical: 'https://example.com/elsewhere/' });
  const r = auditPage(html, '/private/', RULES);
  assert.equal(r.issues.length, 1);
  assert.match(r.issues[0], /canonical points to \/elsewhere\//);
});

test('canonical comparison ignores trailing-slash differences', () => {
  const r = auditPage(page({ canonical: 'https://example.com/about' }), '/about/', RULES);
  assert.deepEqual(r.issues, [], '/about and /about/ are the same page');
});

test('CATCHES a noindex page listed in the sitemap', () => {
  const root = fixture({
    'dist/index.html': page({ canonical: 'https://example.com/' }),
    'dist/secret/index.html': page({ robots: 'noindex', canonical: 'https://example.com/secret/' }),
    'dist/sitemap.xml':
      '<urlset><url><loc>https://example.com/</loc></url>' +
      '<url><loc>https://example.com/secret/</loc></url></urlset>',
  });
  try {
    const r = auditDiscovery({ root });
    const conflict = r.problems.find((p) => p.detail.includes('noindex'));
    assert.ok(conflict, 'asking to be crawled and refusing to be indexed must fail');
    assert.equal(conflict.route, '/secret/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CATCHES a sitemap URL with no built page', () => {
  const root = fixture({
    'dist/index.html': page({ canonical: 'https://example.com/' }),
    'dist/sitemap.xml':
      '<urlset><url><loc>https://example.com/</loc></url>' +
      '<url><loc>https://example.com/ghost/</loc></url></urlset>',
  });
  try {
    const r = auditDiscovery({ root });
    assert.ok(r.problems.some((p) => p.route === '/ghost/' && p.detail.includes('404')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a consistent site passes cleanly', () => {
  const root = fixture({
    'dist/index.html': page({ canonical: 'https://example.com/' }),
    'dist/about/index.html': page({ canonical: 'https://example.com/about/' }),
    'dist/sitemap.xml':
      '<urlset><url><loc>https://example.com/</loc></url>' +
      '<url><loc>https://example.com/about/</loc></url></urlset>',
  });
  try {
    const r = auditDiscovery({ root });
    assert.deepEqual(r.problems, []);
    assert.equal(r.pageCount, 2);
    assert.equal(r.sitemapCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid JSON-LD is caught when required', () => {
  const html = page().replace('</head>', '<script type="application/ld+json">{bad json}</script></head>');
  const r = auditPage(html, '/about/', { ...RULES, requireJsonLd: true });
  assert.ok(r.issues.some((i) => i.includes('not valid JSON')));
});

test('missing dist is reported rather than passing with zero pages', () => {
  const root = fixture({ 'src/x.astro': 'not built' });
  try {
    assert.equal(auditDiscovery({ root }).missingDist, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
