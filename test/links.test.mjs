/**
 * Tests for internal link integrity.
 *
 * The classification tests matter most. This gate walks every href on every page, so a
 * predicate that is slightly too eager reports hundreds of false failures and gets
 * switched off — which is worse than not having it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkLinks, isInternalPath, missingTrailingSlash, targetFor } from '../src/links.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-ops-links-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test('isInternalPath accepts root-relative paths and nothing else', () => {
  assert.equal(isInternalPath('/about/'), true);
  // Protocol-relative points at ANOTHER origin — a classic thing to misclassify as local.
  assert.equal(isInternalPath('//evil.example/x'), false);
  assert.equal(isInternalPath('https://example.com/x'), false);
  assert.equal(isInternalPath('mailto:a@b.c'), false);
  assert.equal(isInternalPath('tel:+441234'), false);
  assert.equal(isInternalPath('#section'), false);
  assert.equal(isInternalPath('?q=1'), false);
  assert.equal(isInternalPath('relative/path'), false, 'only root-relative is resolvable here');
});

test('targetFor maps directory routes to index.html and files to themselves', () => {
  assert.match(targetFor('/d', '/about/'), /about[\\/]index\.html$/);
  assert.match(targetFor('/d', '/feed.xml'), /feed\.xml$/);
  // A fragment or query must not become part of the filename.
  assert.match(targetFor('/d', '/about/#team'), /about[\\/]index\.html$/);
  assert.match(targetFor('/d', '/about/?x=1'), /about[\\/]index\.html$/);
});

test('missingTrailingSlash flags directory routes only, never files or the root', () => {
  assert.equal(missingTrailingSlash('/about'), true);
  assert.equal(missingTrailingSlash('/about/'), false);
  assert.equal(missingTrailingSlash('/'), false, 'the root is already a directory');
  assert.equal(missingTrailingSlash('/rss.xml'), false, 'a file must not be given a slash');
  assert.equal(missingTrailingSlash('/about#team'), true, 'fragment does not excuse it');
});

test('catches a link to a page that was never built', () => {
  const root = fixture({
    'dist/index.html': '<a href="/about/">About</a><a href="/ghost/">Ghost</a>',
    'dist/about/index.html': '<p>about</p>',
  });
  try {
    const r = checkLinks({ root });
    assert.deepEqual(r.broken.map((b) => b.href), ['/ghost/']);
    assert.equal(r.linkCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reports each broken link ONCE even across many pages', () => {
  // A bad link in a site-wide header would otherwise produce one line per page and bury
  // every other finding under it.
  const pages = {};
  for (let i = 0; i < 25; i += 1) pages[`dist/p${i}/index.html`] = '<a href="/ghost/">x</a>';
  const root = fixture({ 'dist/index.html': '<a href="/ghost/">x</a>', ...pages });
  try {
    const r = checkLinks({ root });
    assert.equal(r.broken.length, 1, 'one distinct problem, not 26 lines');
    assert.equal(r.linkCount, 26, 'but every occurrence is still counted');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('external, mailto and anchor links are never reported', () => {
  const root = fixture({
    'dist/index.html':
      '<a href="https://example.com/nope">x</a><a href="mailto:a@b.c">y</a>' +
      '<a href="#top">z</a><a href="//cdn.example/q">w</a>',
  });
  try {
    const r = checkLinks({ root });
    assert.equal(r.broken.length, 0);
    assert.equal(r.linkCount, 0, 'none of these are internal paths');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('flags a missing trailing slash, and can be turned off', () => {
  const root = fixture({
    'dist/index.html': '<a href="/about">About</a>',
    'dist/about/index.html': '<p>about</p>',
  });
  try {
    // The target resolves either way, so this is purely the slash rule.
    const on = checkLinks({ root });
    assert.deepEqual(on.slashes.map((s) => s.href), ['/about']);

    const off = checkLinks({ root, requireTrailingSlash: false });
    assert.equal(off.slashes.length, 0, 'hosts configured the other way must not be punished');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ignore list suppresses a known-external-looking path', () => {
  const root = fixture({ 'dist/index.html': '<a href="/api/webhook">x</a>' });
  try {
    assert.equal(checkLinks({ root }).broken.length, 1);
    assert.equal(checkLinks({ root, ignore: ['/api/webhook'] }).broken.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing dist is reported rather than passing with zero links', () => {
  const root = fixture({ 'src/x.astro': 'not built' });
  try {
    assert.equal(checkLinks({ root }).missingDist, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
