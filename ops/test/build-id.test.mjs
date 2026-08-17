/**
 * Tests for the content-hashed build id.
 *
 * These use node:test — no test-framework dependency, because this package installs into
 * other people's build pipelines and every dependency it carries is one they inherit.
 *
 * The properties below are not incidental; each one is load-bearing for the guarantee
 * "both deploy pipelines compute the same id for the same commit". If any single one
 * breaks, the module goes back to being a random string with extra steps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeBuildId, emitBuildId, checkBuildId } from '../src/build-id.mjs';
import { resolveConfig, validateConfig, BUILD_ID_DEFAULTS } from '../src/config.mjs';

/** Builds a throwaway project tree. `files` maps relative path -> contents. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-ops-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const cfg = (over = {}) => ({ ...BUILD_ID_DEFAULTS, ...over });

test('identical content produces an identical id', () => {
  const a = fixture({ 'dist/index.html': '<h1>hi</h1>', 'dist/a/b.css': 'body{}' });
  const b = fixture({ 'dist/index.html': '<h1>hi</h1>', 'dist/a/b.css': 'body{}' });
  try {
    // The whole guarantee: two pipelines, two machines, same commit, same id.
    assert.equal(computeBuildId({ ...cfg(), root: a }).id, computeBuildId({ ...cfg(), root: b }).id);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('changed content produces a different id', () => {
  const root = fixture({ 'dist/index.html': '<h1>hi</h1>' });
  try {
    const before = computeBuildId({ ...cfg(), root }).id;
    writeFileSync(join(root, 'dist/index.html'), '<h1>hello</h1>');
    assert.notEqual(computeBuildId({ ...cfg(), root }).id, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('renaming a file changes the id even when bytes are unchanged', () => {
  // The path is hashed alongside the bytes. Without that, a rename leaves the id alone
  // and the edge keeps serving the old routing under the same key.
  const a = fixture({ 'dist/one.html': 'same' });
  const b = fixture({ 'dist/two.html': 'same' });
  try {
    assert.notEqual(computeBuildId({ ...cfg(), root: a }).id, computeBuildId({ ...cfg(), root: b }).id);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('swapping two files’ contents changes the id', () => {
  // Guards the \0 delimiters: without them the concatenation is ambiguous and a swap
  // hashes to the same value.
  const a = fixture({ 'dist/x.html': 'AAA', 'dist/y.html': 'BBB' });
  const b = fixture({ 'dist/x.html': 'BBB', 'dist/y.html': 'AAA' });
  try {
    assert.notEqual(computeBuildId({ ...cfg(), root: a }).id, computeBuildId({ ...cfg(), root: b }).id);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('id is stable across repeated runs (idempotent)', () => {
  const root = fixture({ 'dist/index.html': 'x' });
  try {
    const ids = new Set([1, 2, 3].map(() => computeBuildId({ ...cfg(), root }).id));
    assert.equal(ids.size, 1, 'repeated computation must not drift');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('skipDirs excludes tooling state at any depth', () => {
  const withState = fixture({ 'dist/index.html': 'x', 'dist/.wrangler/tmp/junk': 'noise' });
  const without = fixture({ 'dist/index.html': 'x' });
  try {
    assert.equal(
      computeBuildId({ ...cfg(), root: withState }).id,
      computeBuildId({ ...cfg(), root: without }).id,
      'unserved tooling state must not affect the id',
    );
  } finally {
    rmSync(withState, { recursive: true, force: true });
    rmSync(without, { recursive: true, force: true });
  }
});

test('emit writes the file, and is a no-op when already current', () => {
  const root = fixture({ 'dist/index.html': 'x' });
  try {
    const first = emitBuildId(cfg(), root);
    assert.equal(first.changed, true);

    const written = readFileSync(join(root, 'build-id.js'), 'utf8');
    assert.match(written, /export const BUILD_ID = '[0-9a-f]{16}';/);

    // Rewriting an unchanged file bumps mtime, busts build caches, and makes the file
    // appear in unrelated diffs — which is how a wrong id gets committed by habit.
    const second = emitBuildId(cfg(), root);
    assert.equal(second.changed, false);
    assert.equal(second.id, first.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check passes on a fresh emit and fails once content moves on', () => {
  const root = fixture({ 'dist/index.html': 'x' });
  try {
    emitBuildId(cfg(), root);
    assert.equal(checkBuildId(cfg(), root).ok, true);

    // Simulates the real incident: content changed, build-id file left as committed.
    writeFileSync(join(root, 'dist/index.html'), 'CHANGED');
    const stale = checkBuildId(cfg(), root);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'stale');
    assert.notEqual(stale.found, stale.expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check reports missing and malformed distinctly from stale', () => {
  const root = fixture({ 'dist/index.html': 'x' });
  try {
    assert.equal(checkBuildId(cfg(), root).reason, 'missing');

    writeFileSync(join(root, 'build-id.js'), 'export const SOMETHING_ELSE = 1;\n');
    assert.equal(checkBuildId(cfg(), root).reason, 'malformed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty include reports zero files rather than hashing nothing silently', () => {
  // A "successful" run over an empty dist yields a constant id for every deploy — the
  // cache would never bust again, and it would look like it was working.
  const root = fixture({ 'src/index.html': 'not in dist' });
  try {
    assert.equal(computeBuildId({ ...cfg(), root }).fileCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('config validation catches the settings that silently break the guarantee', () => {
  assert.deepEqual(validateConfig(resolveConfig({})), [], 'defaults must be valid');

  const short = validateConfig(resolveConfig({ buildId: { length: 4 } }));
  assert.equal(short.length, 1, 'a too-short id risks collisions, i.e. a cache that never busts');

  const badName = validateConfig(resolveConfig({ buildId: { constName: '2bad' } }));
  assert.equal(badName.length, 1, 'invalid identifier would emit a file that cannot be imported');

  const noInclude = validateConfig(resolveConfig({ buildId: { include: [] } }));
  assert.equal(noInclude.length, 1, 'nothing to hash means a constant id forever');

  const unknown = validateConfig(resolveConfig({ typo: {} }));
  assert.equal(unknown.length, 1, 'a mistyped section must not be silently ignored');
});

test('user config overrides defaults without merging arrays', () => {
  // Arrays REPLACE. Concatenation would make it impossible to drop a default you
  // disagree with, and hide the effective value from your own config file.
  const resolved = resolveConfig({ buildId: { skipDirs: ['only-this'] } });
  assert.deepEqual(resolved.buildId.skipDirs, ['only-this']);
  assert.equal(resolved.buildId.constName, 'BUILD_ID', 'unspecified keys keep their default');
});
