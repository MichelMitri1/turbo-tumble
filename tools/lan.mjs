/**
 * `npm run lan`: host a zero-lag race on your home Wi-Fi. Builds the client, then
 * runs the game server on this laptop in LAN mode (snapshots every tick). Every
 * laptop on the same Wi-Fi opens the address it prints; Ctrl+C stops it.
 *
 *   npm run lan            (PORT=2567 by default)
 */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(npm, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
    process.on('SIGINT', () => child.kill('SIGINT'));
    child.on('exit', (code) => resolve(code ?? 0));
  });

console.log('Building the game…');
const built = await run(['run', 'build']);
if (built !== 0) process.exit(built);
process.exitCode = await run(['run', 'server'], { LAN: '1' });
