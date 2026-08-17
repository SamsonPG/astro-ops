/**
 * Tests for the external-asset tripwire.
 *
 * The interesting cases are all about FALSE POSITIVES and FALSE NEGATIVES, because a gate
 * that cries wolf gets deleted and a gate that misses gets trusted. Each test below pins
 * one side of that line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanExternalAssets, isRemoteUrl } from '../src/external-assets.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-ops-ext-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const run = (root, opts = {}) => scanExternalAssets({ root, ...opts });
const kinds = (r) => r.issues.map((i) => i.kind).sort();

test('isRemoteUrl treats protocol-relative as remote and inline data as local', () => {
  // //host/x inherits the scheme but not the host — a classic way past a naive https? check.
  assert.equal(isRemoteUrl('//evil.example/x.js'), true);
  assert.equal(isRemoteUrl('https://cdn.example/x.js'), true);
  assert.equal(isRemoteUrl('/local/x.js'), false);
  assert.equal(isRemoteUrl('./x.js'), false);
  assert.equal(isRemoteUrl('data:image/svg+xml;base64,AAA'), false);
  assert.equal(isRemoteUrl('blob:https://x/y'), false);
  assert.equal(isRemoteUrl('#anchor'), false);
});

test('catches remote script, stylesheet, font preload and media', () => {
  const root = fixture({
    'dist/index.html': `
      <script src="https://cdn.example/a.js"></script>
      <link rel="stylesheet" href="https://cdn.example/a.css">
      <link rel="preload" as="font" href="https://cdn.example/a.woff2">
      <iframe src="https://player.example/embed"></iframe>`,
  });
  try {
    assert.deepEqual(kinds(run(root)), ['link', 'link', 'media', 'script']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a plain outbound <a> link is NOT a violation', () => {
  // The reader chooses to click it. Treating it as a request the page made would make the
  // gate so noisy that people delete it.
  const root = fixture({
    'dist/index.html': '<a href="https://example.com/somewhere">read more</a>',
  });
  try {
    assert.equal(run(root).issues.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('preconnect and dns-prefetch are not flagged — they fetch nothing', () => {
  const root = fixture({
    'dist/index.html': `
      <link rel="preconnect" href="https://cdn.example">
      <link rel="dns-prefetch" href="https://cdn.example">`,
  });
  try {
    assert.equal(run(root).issues.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allowHosts permits a host and its subdomains, but not a lookalike', () => {
  const root = fixture({
    'dist/ok.html': '<script src="https://cdn.mysite.com/a.js"></script>',
    'dist/evil.html': '<script src="https://mysite.com.evil.tld/a.js"></script>',
  });
  try {
    const r = run(root, { allowHosts: ['mysite.com'] });
    // Substring matching on a hostname is how an allowlist for "mysite.com" ends up
    // permitting "mysite.com.evil.tld". Exactly one issue must survive.
    assert.equal(r.issues.length, 1);
    assert.match(r.issues[0].detail, /evil\.tld/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a tracker NAMED inside <code> is not a violation, but loading it is', () => {
  const documented = fixture({
    'dist/privacy.html':
      '<p>We do not load <code>https://www.google-analytics.com/analytics.js</code>.</p>',
  });
  const loaded = fixture({
    'dist/index.html': '<script src="https://www.google-analytics.com/analytics.js"></script>',
  });
  try {
    assert.equal(run(documented).issues.length, 0, 'documenting a tracker must not flag');
    assert.ok(run(loaded).issues.length >= 1, 'loading one must flag');
  } finally {
    rmSync(documented, { recursive: true, force: true });
    rmSync(loaded, { recursive: true, force: true });
  }
});

test('catches CSS @import and @font-face, and inline .src assignment', () => {
  const root = fixture({
    'dist/a.css': "@import url('https://fonts.example/x.css');\n" +
      "@font-face { font-family: X; src: url('https://fonts.example/x.woff2'); }",
    'dist/index.html': '<script>var s=document.createElement("script");s.src="https://cdn.example/late.js";</script>',
  });
  try {
    assert.deepEqual(kinds(run(root)), ['css-font', 'css-import', 'inline-script']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing dist is reported rather than silently passing', () => {
  const root = fixture({ 'src/index.html': 'not built' });
  try {
    // A scan of nothing returning "0 violations" is the most dangerous possible output.
    assert.equal(run(root).missingDist, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
