import puppeteer from 'puppeteer-core';
const SP = process.argv[2];
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu'], defaultViewport: { width: 1600, height: 900 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5199/zero-hour/?zombies', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__zh?.match && document.querySelector('#loading')?.classList.contains('hidden'), { timeout: 120000 });
await p.evaluate(() => { const m = window.__zh.match; m.zr.debugHitboxes = true; const g = m.session.game; g.soldiers[0].hp = 1e9; g.horde.meta.doors.forEach((_, i) => g.horde.openDoor(i, '')); });
// Let zombies get in and chase; then frame the nearest one.
await new Promise((r) => setTimeout(r, 26000));
for (const n of ['zh-1', 'zh-2', 'zh-3']) {
  await p.evaluate(() => {
    document.querySelector('#pause')?.classList.add('hidden');
    const m = window.__zh.match; const g = m.session.game; const s = g.soldiers[0];
    const z = g.horde.zombies.filter((q) => q.state !== 'dead').sort((a, c) => Math.hypot(a.x - s.m.x, a.z - s.m.z) - Math.hypot(c.x - s.m.x, c.z - s.m.z))[0];
    if (!z) return;
    const v = m.views[0];
    // Stand 3.5 m in front of it, side-on-ish, look at its head height.
    const fx = -Math.sin(z.yaw), fz = -Math.cos(z.yaw);
    s.m.x = z.x + fx * 3 + fz * 1.5; s.m.z = z.z + fz * 3 - fx * 1.5;
    const dx = z.x - s.m.x, dz = z.z - s.m.z;
    v.yaw = Math.atan2(-dx, -dz); v.pitch = Math.atan2(1.2 - 1.62, Math.hypot(dx, dz));
  });
  await new Promise((r) => setTimeout(r, 250));
  await p.screenshot({ path: `${SP}/${n}.png` });
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('errors', errs);
await b.close();
