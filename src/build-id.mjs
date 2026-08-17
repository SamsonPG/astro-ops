/**
 * Content-hashed build id.
 *
 * WHAT IT IS
 * ----------
 * One constant, written to a file you commit, derived from a hash of everything you
 * deploy. Your edge worker or middleware puts it in the cache key. A deploy that changes
 * nothing keeps the same id (and its warm cache); a deploy that changes anything gets a
 * new id, so every cached page becomes unreachable at once and the stale entries expire
 * unread.
 *
 * WHY IT IS NOT A TIMESTAMP OR A RANDOM STRING
 * --------------------------------------------
 * This is the part that costs people a production incident, so it is worth the paragraph.
 *
 * Most projects grow a second way to deploy — a CI pipeline plus a manual command, or a
 * host's git integration plus a CLI. That is a good thing: either can ship when the other
 * is unavailable. But it means the SAME commit can be deployed by two different pipelines,
 * and a non-deterministic id cannot survive that:
 *
 *   - A git-integration build usually has no build step. It uploads the repo as-is, so it
 *     ships whatever value is COMMITTED in your build-id file.
 *   - A local deploy command rotates that file on disk, and unless you commit the result,
 *     the repo still holds the old value.
 *
 * Push a content change while the rotated id sits uncommitted and you ship new HTML under
 * the PREVIOUS id. The cache key never changed, so every colo keeps serving the old page.
 * The origin is correct. The deploy "succeeded". Nothing in a normal test suite can see
 * it, because only the cache is wrong.
 *
 * (This is not hypothetical. It is the failure this module was written in response to: the
 * origin served the new content while the public URL kept returning the pre-change copy,
 * from every colo, until someone thought to look at the cache key.)
 *
 * Hashing the deployed content fixes it at the root:
 *   - Both pipelines compute the SAME id for the same commit, so the committed value is
 *     always the correct one.
 *   - Any real change produces a new id, so the cache still busts exactly when it should.
 *   - It is idempotent. Running it twice is a no-op, so your working tree stops drifting
 *     and the file stops showing up in unrelated diffs.
 *
 * A random id also silently throws away your cache on every deploy, which is why a long
 * TTL never seems to pay off. Content hashing keeps the warm cache across deploys that
 * did not change anything.
 *
 * THE CHECK IS THE POINT
 * ----------------------
 * Emitting the id is half of it. `check` recomputes and fails when the committed file is
 * stale, which turns "someone forgot to regenerate" from a silent stale-cache bug into a
 * failed build. Run it in CI. See ./build-id.check.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * Walks `dir` and returns every file path under it, relative to `root`, sorted.
 *
 * Sorted because readdir order is filesystem-dependent: the same tree can enumerate
 * differently on Linux CI and a developer's macOS or Windows machine. An unsorted walk
 * produces a different hash per platform for identical content, which would make the two
 * pipelines disagree — the exact failure this module exists to prevent.
 *
 * @param {string} dir - Absolute directory to walk.
 * @param {string} root - Absolute path that results are made relative to.
 * @param {(relPath: string, isDir: boolean) => boolean} skip - Return true to exclude.
 * @returns {string[]} Relative POSIX-style paths, sorted.
 */
function walk(dir, root, skip) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // Unreadable directory contributes nothing rather than crashing the build.
  }
  // Sort entry names, not full paths, so ordering is stable regardless of depth.
  for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const abs = join(dir, entry.name);
    // Always compare using POSIX separators so a Windows walk hashes like a Linux one.
    const rel = relative(root, abs).split(sep).join('/');
    const isDir = entry.isDirectory();
    if (skip(rel, isDir)) continue;
    if (isDir) out.push(...walk(abs, root, skip));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Computes the build id from the contents of `include` directories.
 *
 * The hash covers each file's PATH as well as its bytes. Without the path, renaming a
 * file — or swapping two files' contents — would leave the id unchanged, and the edge
 * would keep serving the old routing.
 *
 * @param {object} options
 * @param {string} options.root - Project root (absolute).
 * @param {string[]} options.include - Root-relative dirs/files to hash.
 * @param {string[]} [options.skipDirs] - Directory names excluded anywhere in the tree.
 * @param {string[]} [options.skipFiles] - Root-relative file paths to exclude.
 * @param {number} [options.length] - Hex characters to keep.
 * @returns {{ id: string, fileCount: number }}
 */
export function computeBuildId({ root, include, skipDirs = [], skipFiles = [], length = 16 }) {
  const skipDirSet = new Set(skipDirs);
  const skipFileSet = new Set(skipFiles);
  const hash = createHash('sha256');
  let fileCount = 0;

  const skip = (rel, isDir) => {
    if (isDir) return skipDirSet.has(rel.split('/').pop());
    return skipFileSet.has(rel);
  };

  for (const entry of include) {
    const abs = join(root, entry);
    if (!existsSync(abs)) continue;
    const files = statSync(abs).isDirectory() ? walk(abs, root, skip) : [entry];
    for (const rel of files) {
      if (skipFileSet.has(rel)) continue;
      hash.update(rel);
      hash.update('\0'); // Delimiter: without it, "ab"+"c" and "a"+"bc" hash identically.
      hash.update(readFileSync(join(root, rel)));
      hash.update('\0');
      fileCount += 1;
    }
  }

  return { id: hash.digest('hex').slice(0, length), fileCount };
}

/**
 * Renders the output file. ESM `export const` because the consumer is a worker or
 * middleware module that imports it — not JSON, so it costs no parse step at runtime
 * and a bundler can inline it.
 *
 * @param {string} id
 * @param {string} constName
 * @returns {string}
 */
function render(id, constName) {
  return (
    `/** AUTO-GENERATED — do not edit by hand. Run \`astro-ops build-id\` to regenerate. */\n` +
    `export const ${constName} = '${id}';\n`
  );
}

/**
 * Writes the build id file, but only when the value actually changed.
 *
 * The no-op-on-unchanged behaviour is deliberate: rewriting an identical file still
 * updates its mtime, which busts build caches and makes the file surface in `git status`
 * during unrelated work. People then commit it out of habit, which is how a wrong id gets
 * normalised.
 *
 * @param {object} config - Resolved build-id config (see ./config.mjs).
 * @param {string} root - Project root (absolute).
 * @returns {{ id: string, changed: boolean, path: string, fileCount: number }}
 */
export function emitBuildId(config, root) {
  const { id, fileCount } = computeBuildId({ ...config, root });
  const outPath = join(root, config.out);
  const next = render(id, config.constName);
  const prev = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;

  if (prev === next) return { id, changed: false, path: config.out, fileCount };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, next, 'utf8');
  return { id, changed: true, path: config.out, fileCount };
}

/**
 * Recomputes the id and compares it to the committed file.
 *
 * Returns a result rather than throwing so the CLI owns exit codes and message format,
 * and so this stays callable from a test or another tool.
 *
 * @param {object} config - Resolved build-id config.
 * @param {string} root - Project root (absolute).
 * @returns {{ ok: boolean, reason?: 'missing'|'stale'|'malformed', expected: string, found: string|null, path: string }}
 */
export function checkBuildId(config, root) {
  const { id: expected } = computeBuildId({ ...config, root });
  const outPath = join(root, config.out);

  if (!existsSync(outPath)) {
    return { ok: false, reason: 'missing', expected, found: null, path: config.out };
  }

  const src = readFileSync(outPath, 'utf8');
  const found = (src.match(new RegExp(`${config.constName}\\s*=\\s*['"]([^'"]+)['"]`)) || [])[1] ?? null;

  if (!found) {
    return { ok: false, reason: 'malformed', expected, found: null, path: config.out };
  }
  if (found !== expected) {
    return { ok: false, reason: 'stale', expected, found, path: config.out };
  }
  return { ok: true, expected, found, path: config.out };
}
