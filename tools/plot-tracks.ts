/**
 * Top-down map of every track (or the given ids) → smoke-out/maps/<id>.png + a sheet.
 * Road shaded by height; void red, gaps black, streams blue, shortcuts brown,
 * ramps orange, boost pads yellow, start line green. Needs python3 + Pillow.
 *
 *   npx tsx tools/plot-tracks.ts [trackId…]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { TRACKS } from '../shared/src/tracks/registry';
import { TrackPath } from '../shared/src/track/TrackPath';

const only = process.argv.slice(2);
mkdirSync('smoke-out/maps', { recursive: true });
const data = TRACKS.filter((t) => !only.length || only.includes(t.id)).map((def) => {
  const p = new TrackPath(def);
  const at = (d: number) => p.anchorToWorld({ distance: d }).position;
  return {
    id: def.id,
    name: `${def.name} · ${def.difficulty ?? ''} · ${p.length.toFixed(0)} m`,
    samples: p.samples.map((s) => [s.position.x, s.position.y, s.position.z, s.halfWidth, s.open ? 1 : 0, s.gap ? 1 : 0, s.kind === 'tunnel' ? 1 : s.kind === 'bridge' ? 2 : 0]),
    streams: (def.streams ?? []).map((st) => [at(st.distance), at(st.distance + st.length)].map((v) => [v.x, v.z])),
    shortcuts: def.shortcuts.map((sc) => p.shortcutPoints(sc).map((v) => [v.x, v.z])),
    jumps: def.jumps.map((j) => [at(j.distance + j.length).x, at(j.distance + j.length).z]),
    pads: def.boostPads.map((b) => [at(b.distance).x, at(b.distance).z]),
    start: [at(0).x, at(0).z],
  };
});
writeFileSync('smoke-out/maps/data.json', JSON.stringify(data));
execFileSync('python3', ['-c', `
import json
from PIL import Image, ImageDraw
data = json.load(open('smoke-out/maps/data.json'))
tiles = []
for t in data:
    S = t['samples']
    xs = [s[0] for s in S]; zs = [s[2] for s in S]; ys = [s[1] for s in S]
    minx, maxx, minz, maxz = min(xs)-30, max(xs)+30, min(zs)-30, max(zs)+30
    W = 520; sc = W / max(maxx-minx, maxz-minz)
    img = Image.new('RGB', (W, W+28), (34, 30, 60)); d = ImageDraw.Draw(img)
    P = lambda x, z: ((x-minx)*sc, (z-minz)*sc + 28)
    ylo, yhi = min(ys), max(ys)+0.01
    for i in range(len(S)):
        a, b = S[i], S[(i+1) % len(S)]
        k = (a[1]-ylo)/(yhi-ylo)
        col = (0,0,0) if a[5] else (230,60,60) if a[4] else (120,120,140) if a[6]==1 else (int(150+90*k), int(150+90*k), int(170+70*k))
        d.line([P(a[0],a[2]), P(b[0],b[2])], fill=col, width=max(2, int(a[3]*2*sc)))
    for sh in t['shortcuts']:
        d.line([P(x,z) for x,z in sh], fill=(170,120,60), width=max(2,int(8*sc)))
    for st in t['streams']:
        d.line([P(*st[0]), P(*st[1])], fill=(60,170,255), width=max(2,int(5*sc)))
    for x,z in t['pads']: d.ellipse([P(x,z)[0]-4, P(x,z)[1]-4, P(x,z)[0]+4, P(x,z)[1]+4], fill=(255,210,60))
    for x,z in t['jumps']: d.ellipse([P(x,z)[0]-6, P(x,z)[1]-6, P(x,z)[0]+6, P(x,z)[1]+6], fill=(255,140,30))
    sx, sz = P(*t['start']); d.ellipse([sx-7, sz-7, sx+7, sz+7], fill=(60,220,90))
    d.text((8, 8), t['name'], fill=(255,255,255))
    img.save('smoke-out/maps/%s.png' % t['id']); tiles.append(img)
cols = 4; rows = (len(tiles)+cols-1)//cols
sheet = Image.new('RGB', (cols*520, rows*548), (20,18,40))
for i, im in enumerate(tiles): sheet.paste(im, ((i%cols)*520, (i//cols)*548))
sheet.save('smoke-out/maps/sheet.png')
print(len(tiles), 'maps')
`]);
