/**
 * Runs a command with dist/ served on 127.0.0.1, then shuts the server down.
 *
 * Exists so `check:budgets` is one command in CI rather than a background process someone
 * has to remember to kill — a leaked server is how a CI job hangs until it times out.
 *
 * ⚠️ ASYNC `spawn`, NEVER `spawnSync`.
 *
 * spawnSync blocks the Node event loop for the whole life of the child. The HTTP server
 * lives in THIS process, so while spawnSync is blocking it cannot answer a single request:
 * the socket is open, the connection is accepted, and nothing is ever written back. The
 * child then hangs until something times out, and the failure looks like "the server is
 * not running" when it is running and gagged.
 *
 * Using spawn keeps the loop free, so the server responds while the child runs.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { startServer } from './serve-dist.mjs';

const PORT = Number(process.env.PORT || 4173);

if (!existsSync('dist')) {
  console.error('dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: node scripts/with-server.mjs <command> [args...]');
  process.exit(2);
}

const server = await startServer(PORT);

const status = await new Promise((resolve) => {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    // npx resolves to npx.cmd on Windows, which cannot be executed without a shell.
    shell: process.platform === 'win32',
    env: { ...process.env, ASTRO_OPS_BUDGET_URL: `http://127.0.0.1:${PORT}/` },
  });
  child.on('error', (err) => {
    console.error(`failed to start "${cmd}": ${err.message}`);
    resolve(2);
  });
  child.on('close', (code) => resolve(code ?? 1));
});

/*
 * closeAllConnections before close: a keep-alive socket keeps `close()` waiting forever,
 * and a CI job that hangs after its gates passed is worse than one that fails.
 */
server.closeAllConnections?.();
server.close();
process.exit(status);
