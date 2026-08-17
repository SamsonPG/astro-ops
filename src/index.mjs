/**
 * Public API surface for @acsaven/astro-ops.
 *
 * Re-exported from one place so consumers import from the package root rather than
 * reaching into ./src/*, which would make every internal file rename a breaking change.
 */
export { computeBuildId, emitBuildId, checkBuildId } from './build-id.mjs';
export { scanExternalAssets, isRemoteUrl } from './external-assets.mjs';
export { scanClaims, dueDate, evaluateFreshness, fetchDrift } from './freshness.mjs';
export { auditDiscovery, auditPage, routeOf, metaContent } from './discovery.mjs';
export { runLighthouse, evaluateBudgets, scoresFromReport } from './budgets.mjs';
export {
  loadConfig,
  resolveConfig,
  validateConfig,
  DEFAULTS,
  BUILD_ID_DEFAULTS,
  EXTERNAL_DEFAULTS,
  FRESHNESS_DEFAULTS,
  DISCOVERY_DEFAULTS,
  BUDGETS_DEFAULTS,
} from './config.mjs';
