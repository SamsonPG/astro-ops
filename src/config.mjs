/**
 * Config loading and defaults.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * The toolkit was extracted from four production sites that had been running copies of
 * the same ~20 scripts. Measured before extraction: 7 of 12 core scripts were still
 * byte-identical across three repos, and the 5 that had drifted differed by 1-4 lines —
 * a site name, a path, a threshold. In other words the LOGIC never diverged, only the
 * CONFIG did, and the copies were drifting anyway because a fix landed in whichever repo
 * hit the bug first.
 *
 * So: one implementation, one config file per site. If you find yourself editing a script
 * in this package to make it fit your project, that is a missing config option and worth
 * reporting — patching the script locally puts you straight back in the copy-drift trap
 * this exists to end.
 *
 * DEFAULTS ARE OPINIONATED ON PURPOSE
 * -----------------------------------
 * Every default here is the value that was actually running in production, not a neutral
 * guess. You should be able to add an empty config and get a working setup.
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** Config filenames tried in order. `.mjs` first — this package is ESM-only. */
export const CONFIG_FILENAMES = ['astro-ops.config.mjs', 'astro-ops.config.js'];

/**
 * Defaults for the build-id module.
 *
 * `include` deliberately points at build OUTPUT ("dist"), not source. The id must
 * describe what you actually deploy: two different sources can produce identical output
 * (a comment change, a formatting pass), and rotating the cache for those throws away a
 * warm edge for no reader-visible reason. It also means the id is correct even when
 * something outside src — a dependency bump, an Astro upgrade — changes the output.
 *
 * `skipDirs` excludes VCS and tooling state that can appear inside an output directory
 * without being served.
 */
export const BUILD_ID_DEFAULTS = {
  include: ['dist'],
  out: 'build-id.js',
  constName: 'BUILD_ID',
  skipDirs: ['.git', 'node_modules', '.wrangler', '.vercel', '.netlify', '.DS_Store'],
  skipFiles: [],
  length: 16,
};

/** Every module's defaults, keyed by config section. */
export const DEFAULTS = {
  buildId: BUILD_ID_DEFAULTS,
};

/**
 * Merges user config over defaults, one level deep per section.
 *
 * Shallow per section is intentional: array options like `skipDirs` REPLACE rather than
 * concatenate. Silent concatenation is worse — you cannot remove a default you disagree
 * with, and the effective value stops being visible in your config file.
 *
 * @param {object} userConfig - Raw config object (possibly empty).
 * @returns {object} Resolved config with every known section populated.
 */
export function resolveConfig(userConfig = {}) {
  const resolved = {};
  for (const [section, defaults] of Object.entries(DEFAULTS)) {
    resolved[section] = { ...defaults, ...(userConfig[section] ?? {}) };
  }
  // Preserve unknown sections so a newer config against an older toolkit is not silently
  // truncated — validate() reports them rather than this dropping them on the floor.
  for (const key of Object.keys(userConfig)) {
    if (!(key in resolved)) resolved[key] = userConfig[key];
  }
  return resolved;
}

/**
 * Validates a resolved config and returns human-readable problems.
 *
 * Returns messages instead of throwing on the first error so one run reports everything
 * wrong with the file. Fixing config one exception at a time is miserable.
 *
 * @param {object} config - Resolved config.
 * @returns {string[]} Problems, empty when valid.
 */
export function validateConfig(config) {
  const problems = [];
  const known = new Set(Object.keys(DEFAULTS));
  for (const key of Object.keys(config)) {
    if (!known.has(key)) {
      problems.push(`unknown section "${key}" — known sections: ${[...known].join(', ')}`);
    }
  }

  const b = config.buildId;
  if (b) {
    if (!Array.isArray(b.include) || b.include.length === 0) {
      problems.push('buildId.include must be a non-empty array of paths to hash');
    }
    if (typeof b.out !== 'string' || !b.out) {
      problems.push('buildId.out must be a file path');
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(b.constName ?? '')) {
      problems.push(`buildId.constName must be a valid JS identifier (got ${JSON.stringify(b.constName)})`);
    }
    // 8 hex chars is 4 billion values; below that, collisions stop being theoretical for
    // a project with a long history, and a collision means the cache is never busted.
    if (!Number.isInteger(b.length) || b.length < 8 || b.length > 64) {
      problems.push(`buildId.length must be an integer between 8 and 64 (got ${b.length})`);
    }
  }

  return problems;
}

/**
 * Loads config from disk, applies defaults, and validates.
 *
 * A MISSING config file is fine and returns defaults — the toolkit should work on a fresh
 * project with no setup. A PRESENT but broken one is fatal, because silently ignoring a
 * config someone wrote is how a site ends up not running the gate it thinks it runs.
 *
 * @param {string} root - Project root (absolute).
 * @returns {Promise<{ config: object, path: string|null, problems: string[] }>}
 */
export async function loadConfig(root) {
  const found = CONFIG_FILENAMES.map((name) => join(root, name)).find((p) => existsSync(p)) ?? null;

  let userConfig = {};
  if (found) {
    // pathToFileURL: a bare Windows path ("G:\\...") is not a valid import specifier.
    const mod = await import(pathToFileURL(found).href);
    userConfig = mod.default ?? mod.config ?? {};
    if (typeof userConfig !== 'object' || userConfig === null || Array.isArray(userConfig)) {
      return {
        config: resolveConfig({}),
        path: found,
        problems: ['config file must default-export an object'],
      };
    }
  }

  const config = resolveConfig(userConfig);
  return { config, path: found, problems: validateConfig(config) };
}
