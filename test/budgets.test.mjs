/**
 * Tests for performance budgets.
 *
 * `runLighthouse` shells out to a real browser and is not unit-tested here — a test that
 * launches Chrome is a test nobody runs. The logic that DECIDES pass or fail is pure and
 * is tested exhaustively, because that is the part that either blocks a merge or does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoresFromReport, evaluateBudgets, BUDGET_DEFAULTS } from '../src/budgets.mjs';

test('scoresFromReport converts 0-1 scores to 0-100 integers', () => {
  const scores = scoresFromReport({
    categories: { performance: { score: 0.923 }, accessibility: { score: 1 } },
  });
  assert.deepEqual(scores, { performance: 92, accessibility: 100 });
});

test('a null score is omitted, never treated as zero', () => {
  // Recording "not measured" as 0 would fail a build over a measurement that never
  // happened, which is how people learn to ignore a gate.
  const scores = scoresFromReport({
    categories: { performance: { score: null }, seo: { score: 0.9 } },
  });
  assert.deepEqual(scores, { seo: 90 });
});

test('blocking categories fail, advisory ones only warn', () => {
  const r = evaluateBudgets(
    { accessibility: 82, performance: 61 },
    {
      accessibility: { min: 90, blocking: true },
      performance: { min: 80, blocking: false },
    },
  );
  assert.deepEqual(r.failures.map((f) => f.id), ['accessibility']);
  assert.deepEqual(r.warnings.map((w) => w.id), ['performance']);
});

test('a category the run did not measure is reported, not failed', () => {
  const r = evaluateBudgets({ performance: 95 }, BUDGET_DEFAULTS.categories);
  assert.ok(r.notMeasured.includes('accessibility'));
  assert.equal(r.failures.length, 0);
});

test('a score exactly on the threshold passes', () => {
  // Off-by-one here would fail builds that met the budget precisely.
  const r = evaluateBudgets({ accessibility: 90 }, { accessibility: { min: 90, blocking: true } });
  assert.equal(r.failures.length, 0);
  assert.deepEqual(r.passed.map((p) => p.id), ['accessibility']);
});

test('defaults make accessibility blocking and performance advisory', () => {
  // Lighthouse performance moves several points run to run on identical code. Blocking on
  // it produces a coin-flip gate, and a gate understood as a coin flip protects nothing.
  assert.equal(BUDGET_DEFAULTS.categories.accessibility.blocking, true);
  assert.equal(BUDGET_DEFAULTS.categories.performance.blocking, false);
});
