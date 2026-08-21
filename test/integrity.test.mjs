/**
 * Tests for the source-integrity gate.
 *
 * These use node:test — no test-framework dependency, because this package installs into
 * other people's build pipelines and every dependency it carries is one they inherit.
 *
 * The properties below are the ones that decide whether this gate is worth having. A
 * detector that misses damage is useless; a detector that invents damage gets switched off,
 * which is worse. Both directions are asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkIntegrity, describeIntegrity, freeBytes } from '../src/integrity.mjs';

/** Builds a throwaway project tree. `files` maps relative path -> contents. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'astro-ops-integrity-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

test('reports an emptied file as damage', () => {
  const root = fixture({ 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': '' });
  try {
    const r = checkIntegrity({ root, minFreeBytes: 0 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.empty, ['src/b.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('passes when every file has content', () => {
  const root = fixture({ 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': 'export const b = 2;\n' });
  try {
    const r = checkIntegrity({ root, minFreeBytes: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.empty.length, 0);
    assert.equal(r.scanned, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('does not flag files that are legitimately empty', () => {
  /*
    .gitkeep exists precisely to be empty. Reporting it would make the gate cry wolf on
    every repository that uses one, and a gate people learn to ignore protects nothing.
  */
  const root = fixture({ 'public/og/.gitkeep': '', 'src/a.mjs': 'export const a = 1;\n' });
  try {
    const r = checkIntegrity({ root, minFreeBytes: 0 });
    assert.equal(r.ok, true, 'a .gitkeep must not count as damage');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to build when free space is below the floor', () => {
  const root = fixture({ 'src/a.mjs': 'export const a = 1;\n' });
  try {
    // A floor no machine satisfies, so this asserts the comparison rather than the disk.
    const r = checkIntegrity({ root, minFreeBytes: Number.MAX_SAFE_INTEGER, scanEmpty: false });
    assert.equal(r.ok, false);
    assert.equal(r.lowDisk, true);
    assert.match(describeIntegrity(r)[0], /REFUSING to build/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a floor of zero disables the disk check without disabling the scan', () => {
  const root = fixture({ 'src/b.mjs': '' });
  try {
    const r = checkIntegrity({ root, minFreeBytes: 0 });
    assert.equal(r.lowDisk, false, 'zero floor must never trip');
    assert.equal(r.empty.length, 1, 'but damage must still be reported');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown free space is treated as unsafe, not as plenty', () => {
  /*
    The failure mode this guards against: freeBytes() cannot read the volume, returns null,
    a naive `free < floor` comparison is false because null coerces to 0... or worse, the
    check is skipped entirely and the gate goes green on exactly the machine it exists to
    stop. Unknown must fail closed.
  */
  const r = checkIntegrity({ root: '/definitely/not/a/real/path/xyz', minFreeBytes: 1, scanEmpty: false });
  if (r.free === null) {
    assert.equal(r.unknownDisk, true);
    assert.equal(r.ok, false);
    assert.match(describeIntegrity(r).join('\n'), /REFUSING to build/);
  }
});

test('freeBytes returns a positive number for a real directory', () => {
  const n = freeBytes(process.cwd());
  // null is an acceptable answer on a platform that cannot report; a wrong number is not.
  if (n !== null) assert.ok(n > 0, 'free space must be positive');
});
