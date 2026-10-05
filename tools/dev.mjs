/**
 * `npm run dev`: the Vite client and the game server side by side, with
 * prefixed output. Ctrl+C stops both. (Cross-platform; no extra deps.)
 */
import { spawn } from 'node:child_process';

const procs = [
  { name: 'client', color: 36, args: ['run', 'dev', '-w', 'client'] },
  { name: 'server', color: 35, args: ['run', 'dev', '-w', 'server'] },
].map(({ name, color, args }) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(tag + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited (${code ?? 'signal'})\n`);
    for (const p of procs) if (p !== child && p.exitCode === null) p.kill();
    process.exitCode = code ?? 0;
  });
  return child;
});

const stop = () => procs.forEach((p) => p.exitCode === null && p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
