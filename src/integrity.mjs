/**
 * Source integrity — catches a build that is about to corrupt your repository.
 *
 * WHY THIS EXISTS: a machine that runs out of disk mid-write does not fail loudly. The write
 * returns, the file is left empty, and everything downstream looks like a normal edit. In one
 * project this silently emptied 39 tracked files across three repositories, segfaulted a
 * build, and later truncated a test file and an icon script in a published extension — where
 * it would have shipped, because nobody thinks to check whether their source is still there.
 *
 * Two gates, in the order that matters:
 *
 *   1. BEFORE: refuse to build when free disk is below a floor. A build that cannot finish
 *      is a nuisance; a build that half-finishes and empties your files is a data-loss event.
 *   2. AFTER: report tracked files that are empty. Damage that already happened is invisible
 *      to type checkers, linters and tests — an emptied module simply exports nothing, and a
 *      test file that was deleted reports zero failures.
 *
 * This is not a disk-usage monitor. It answers one question: is it safe to write here, and is
 * what is already here intact.
 */
import * as fs from 'node:fs';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

/** Files that are legitimately empty and must never be reported as damage. */
const ALLOWED_EMPTY = new Set(['.gitkeep', '.gitignore', '.npmignore', '.nojekyll', 'py.typed']);

/**
 * Free bytes on the volume containing `dir`.
 *
 * Uses `statfs` where the Node build provides it and falls back to the platform shell
 * otherwise. Returns null when neither works — an unknown figure must read as "cannot tell",
 * never as "plenty", or the gate would wave through the exact machine it exists to stop.
 *
 * @param {string} dir - Any path on the volume to measure.
 * @returns {number|null} Free bytes, or null when it cannot be determined.
 */
export function freeBytes(dir) {
  try {
    // Node 18.15+/20+. Read off the namespace rather than a named import, because a named
    // import of a missing builtin export is a SyntaxError at load time — which would break
    // every command in this CLI on older Node, not just this gate.
    if (typeof fs.statfsSync === 'function') {
      const s = fs.statfsSync(dir);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {
    /* fall through to the shell */
  }

  try {
    if (process.platform === 'win32') {
      const drive = dir.slice(0, 2);
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `(Get-PSDrive ${drive[0]}).Free`],
        { encoding: 'utf8', timeout: 10_000 },
      ).trim();
      const n = Number(out);
      return Number.isFinite(n) ? n : null;
    }
    const out = execFileSync('df', ['-kP', dir], { encoding: 'utf8', timeout: 10_000 });
    const line = out.trim().split('\n').pop() ?? '';
    const avail = Number(line.split(/\s+/)[3]);
    return Number.isFinite(avail) ? avail * 1024 : null;
  } catch {
    return null;
  }
}

/** Human-readable GB, for messages a person reads under pressure. */
function gb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Lists tracked files, preferring git so that ignored build output is never scanned.
 *
 * @param {string} root - Project root.
 * @returns {string[]} Repo-relative paths.
 */
function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files'], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    // Not a git repo, or git unavailable. Walk the source directories instead, skipping the
    // places that are SUPPOSED to contain generated or vendored files.
    const skip = new Set(['node_modules', '.git', 'dist', '.astro', '.cache', 'coverage']);
    const acc = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else acc.push(relative(root, full).split(sep).join('/'));
      }
    };
    walk(root);
    return acc;
  }
}

/**
 * Checks that there is room to build and that nothing on disk is already truncated.
 *
 * @param {object} options
 * @param {string} options.root - Project root.
 * @param {number} [options.minFreeBytes] - Refuse to build below this. Default 2 GB.
 * @param {boolean} [options.scanEmpty] - Also report empty tracked files. Default true.
 * @returns {{ ok: boolean, free: number|null, minFree: number, lowDisk: boolean,
 *   unknownDisk: boolean, empty: string[], scanned: number }}
 */
export function checkIntegrity({ root, minFreeBytes = 2 * 1024 ** 3, scanEmpty = true }) {
  const free = freeBytes(root);
  const unknownDisk = free === null;
  const lowDisk = !unknownDisk && free < minFreeBytes;

  const empty = [];
  let scanned = 0;
  if (scanEmpty) {
    for (const rel of trackedFiles(root)) {
      const abs = join(root, rel);
      if (!existsSync(abs)) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      scanned += 1;
      const base = rel.split('/').pop() ?? rel;
      if (st.size === 0 && !ALLOWED_EMPTY.has(base)) empty.push(rel);
    }
  }

  return {
    ok: !lowDisk && !unknownDisk && empty.length === 0,
    free,
    minFree: minFreeBytes,
    lowDisk,
    unknownDisk,
    empty,
    scanned,
  };
}

/**
 * Formats the failure a human sees, leading with the consequence rather than the rule.
 *
 * @param {ReturnType<typeof checkIntegrity>} r
 * @returns {string[]} Lines to print.
 */
export function describeIntegrity(r) {
  const lines = [];

  if (r.lowDisk) {
    lines.push(
      `Only ${gb(r.free)} free — below the ${gb(r.minFree)} floor. REFUSING to build.`,
      `    Why it matters: a write that runs out of space does not throw. It leaves the file`,
      `    EMPTY, and nothing downstream notices — an emptied module just exports nothing and`,
      `    a deleted test reports zero failures. Building now risks silently destroying source`,
      `    that only git can get back.`,
      `    Fix: free space, then rebuild. Start with caches (\`npm cache clean --force\`),`,
      `    build output (dist/, .astro/, .next/), and downloads.`,
    );
  }

  if (r.unknownDisk) {
    lines.push(
      `Could not determine free disk space. REFUSING to build.`,
      `    An unknown figure is treated as unsafe on purpose: reading it as "plenty" would`,
      `    wave through the exact machine this gate exists to stop.`,
      `    Fix: pass integrity.minFreeBytes = 0 to skip this check if your platform cannot report it.`,
    );
  }

  if (r.empty.length > 0) {
    lines.push(
      `${r.empty.length} tracked file(s) are EMPTY — this is disk-exhaustion damage, not an edit:`,
      ...r.empty.slice(0, 20).map((f) => `      ${f}`),
      ...(r.empty.length > 20 ? [`      … and ${r.empty.length - 20} more`] : []),
      `    Fix: confirm each is genuinely empty, then \`git checkout -- <file>\` to restore.`,
      `    Check the diff first — a file you legitimately emptied looks identical here.`,
    );
  }

  return lines;
}
