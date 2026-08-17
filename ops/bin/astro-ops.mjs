#!/usr/bin/env node
/**
 * astro-ops CLI.
 *
 * Every command follows the same contract, because these run unattended in CI and the
 * output is the only thing a human sees when one fails at 2am:
 *
 *   - exit 0 = pass, exit 1 = fail, exit 2 = the tool itself is misconfigured.
 *     A config error must not look like a content failure; you fix them in different places.
 *   - A failure message names WHAT is wrong, WHERE, and the command that fixes it.
 *     A gate that only says "no" wastes the reader's time at the worst moment.
 *   - Consequence over rule. "The edge will serve stale HTML" beats "hash mismatch" —
 *     the reader needs to know whether to care before they know what to type.
 */
import { argv, cwd, exit } from 'node:process';
import { loadConfig } from '../src/config.mjs';
import { emitBuildId, checkBuildId } from '../src/build-id.mjs';

const USAGE = `astro-ops — production gates for Astro sites

Usage:
  astro-ops build-id            Write the content-hashed build id file
  astro-ops check:build-id      Fail if the committed build id is stale
  astro-ops check               Run every check (CI entry point)

Options:
  --root <dir>   Project root (default: current directory)
  --quiet        Print only failures
  -h, --help     Show this help
`;

/** Parses argv into a command plus flags. Kept tiny on purpose — no dependency for this. */
function parseArgs(args) {
  const flags = { root: cwd(), quiet: false, help: false };
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--root') { flags.root = args[i + 1]; i += 1; }
    else if (a === '--quiet') flags.quiet = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else rest.push(a);
  }
  return { command: rest[0], flags };
}

const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => console.error(`  ✗ ${msg}`);

/** `astro-ops build-id` — emit. Reports no-op vs rotated so a CI log shows what happened. */
function cmdBuildId(config, root, quiet) {
  const r = emitBuildId(config.buildId, root);
  if (r.fileCount === 0) {
    bad(
      `nothing to hash — no files found under ${config.buildId.include.join(', ')}\n` +
        `    The build id would be identical for every deploy, so the edge cache would never bust.\n` +
        `    Run your build first, or set buildId.include in astro-ops.config.mjs.`,
    );
    return 1;
  }
  if (!quiet) {
    ok(
      r.changed
        ? `build-id ${r.id} written to ${r.path} (${r.fileCount} files hashed) — COMMIT THIS FILE`
        : `build-id ${r.id} already current in ${r.path} (${r.fileCount} files hashed)`,
    );
  }
  return 0;
}

/** `astro-ops check:build-id` — the gate that turns a silent stale cache into a red build. */
function cmdCheckBuildId(config, root, quiet) {
  const r = checkBuildId(config.buildId, root);
  if (r.ok) {
    if (!quiet) ok(`build-id ${r.expected} matches deployed content`);
    return 0;
  }

  const fix = `    Fix: run \`astro-ops build-id\` and commit ${r.path} with your change.`;
  const why =
    `    Why it matters: your deploy pipeline ships the COMMITTED id. A stale one means the\n` +
    `    edge cache is never invalidated — the new HTML deploys but visitors keep getting the\n` +
    `    old page from every colo. Nothing else in CI can see this, because the origin is fine.`;

  if (r.reason === 'missing') bad(`${r.path} does not exist.\n${fix}\n${why}`);
  else if (r.reason === 'malformed') {
    bad(`${r.path} has no \`${config.buildId.constName}\` export.\n${fix}`);
  } else bad(`${r.path} is STALE — committed ${r.found}, content hashes to ${r.expected}.\n${fix}\n${why}`);
  return 1;
}

/**
 * `astro-ops check` — every gate, in one run.
 *
 * Runs all checks even after one fails, rather than stopping at the first. A CI run that
 * reports one problem per push turns a five-minute fix into five pushes.
 */
function cmdCheckAll(config, root, quiet) {
  const results = [cmdCheckBuildId(config, root, quiet)];
  const failed = results.filter((c) => c !== 0).length;
  if (failed > 0) {
    console.error(`\nastro-ops check FAILED — ${failed} of ${results.length} gate(s)`);
    return 1;
  }
  if (!quiet) console.log(`\nastro-ops check OK — ${results.length} gate(s) passed`);
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(argv.slice(2));

  if (flags.help || !command) {
    console.log(USAGE);
    exit(command ? 0 : 1);
  }

  const { config, path, problems } = await loadConfig(flags.root);
  if (problems.length > 0) {
    console.error(`astro-ops: invalid config${path ? ` in ${path}` : ''}`);
    for (const p of problems) bad(p);
    exit(2); // Distinct from 1: the tool is misconfigured, the site is not necessarily broken.
  }

  const commands = {
    'build-id': () => cmdBuildId(config, flags.root, flags.quiet),
    'check:build-id': () => cmdCheckBuildId(config, flags.root, flags.quiet),
    check: () => cmdCheckAll(config, flags.root, flags.quiet),
  };

  const run = commands[command];
  if (!run) {
    console.error(`astro-ops: unknown command "${command}"\n`);
    console.log(USAGE);
    exit(2);
  }

  exit(run());
}

main().catch((err) => {
  console.error(`astro-ops: ${err?.stack ?? err}`);
  exit(2);
});
