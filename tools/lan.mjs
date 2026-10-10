/**
 * `npm run lan`: host a zero-lag race on your home Wi-Fi. Builds the client, then
 * runs the game server on this laptop in LAN mode (snapshots every tick). Every
 * laptop on the same Wi-Fi opens the address it prints; Ctrl+C stops it.
 *
 *   npm run lan            (PORT=2567 by default)
 *
 * Friends outside your house: forward TCP 2567 (the game) and UDP 2568 (the fast lane,
 * FASTLANE_PORT) on your router to this laptop, then share http://<your public IP>:2567/.
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
console.log('Friends outside your Wi-Fi: forward TCP 2567 + UDP 2568 to this laptop on your router, then share http://<your public IP>:2567/');
process.exitCode = await run(['run', 'server'], { LAN: '1' });
