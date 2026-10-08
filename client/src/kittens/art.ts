import type { Card, CardType, CatKind } from './cards';

/**
 * Original vector art for every card: one parametric cartoon cat (fur, eyes,
 * mouth, ears) plus per-card props and backgrounds, drawn in a bold ink style.
 * Everything is inline SVG so it stays crisp at any size and needs no downloads.
 */

const INK = '#1b1446';
const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const THIN = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;

type Eyes = 'happy' | 'wide' | 'angry' | 'sly' | 'x' | 'swirl' | 'stars' | 'shades' | 'closed' | 'evil' | 'sad' | 'wink';
type Mouth = 'smile' | 'open' | 'grr' | 'o' | 'fang' | 'flat' | 'tongue' | 'grin' | 'frown';

interface CatSpec {
  fur: string;
  fur2?: string;
  pattern?: 'tabby' | 'patch' | 'spots' | 'none';
  eyes: Eyes;
  mouth: Mouth;
  innerEar?: string;
  blush?: boolean;
  /** Head transform (scale / offset) inside the 200×200 art box. */
  y?: number;
  scale?: number;
  ears?: 'normal' | 'tall' | 'round' | 'spiky';
}

function eyes(e: Eyes): string {
  const pair = (fn: (x: number) => string) => fn(76) + fn(124);
  switch (e) {
    case 'happy':
      return pair((x) => `<path d="M${x - 11} 102 Q${x} 88 ${x + 11} 102" fill="none" ${S}/>`);
    case 'closed':
      return pair((x) => `<path d="M${x - 11} 98 Q${x} 108 ${x + 11} 98" fill="none" ${S}/>`);
    case 'wide':
    case 'angry':
    case 'evil':
    case 'sad': {
      const brows =
        e === 'angry' || e === 'evil'
          ? `<path d="M62 80 L90 90" ${S}/><path d="M138 80 L110 90" ${S}/>`
          : e === 'sad'
            ? `<path d="M64 88 L88 80" ${S}/><path d="M136 88 L112 80" ${S}/>`
            : '';
      const iris = e === 'evil' ? '#ff3b3b' : INK;
      return (
        pair((x) => `<ellipse cx="${x}" cy="100" rx="13" ry="${e === 'angry' || e === 'evil' ? 11 : 14}" fill="#fff" ${S}/><circle cx="${x + 2}" cy="102" r="${e === 'evil' ? 5 : 6.5}" fill="${iris}"/><circle cx="${x + 5}" cy="97" r="2.6" fill="#fff"/>`) + brows
      );
    }
    case 'sly':
      return pair((x) => `<ellipse cx="${x}" cy="101" rx="13" ry="10" fill="#fff" ${S}/><circle cx="${x + 4}" cy="103" r="5.5" fill="${INK}"/><path d="M${x - 14} 97 L${x + 14} 95" ${S}/>`);
    case 'wink':
      return `<ellipse cx="76" cy="100" rx="13" ry="14" fill="#fff" ${S}/><circle cx="78" cy="102" r="6.5" fill="${INK}"/><circle cx="81" cy="97" r="2.6" fill="#fff"/><path d="M113 102 Q124 90 135 102" fill="none" ${S}/>`;
    case 'x':
      return pair((x) => `<path d="M${x - 9} 92 L${x + 9} 108 M${x + 9} 92 L${x - 9} 108" ${S}/>`);
    case 'swirl':
      return pair((x) => `<path d="M${x} 100 m-2 0 a2 2 0 1 1 4 0 a5 5 0 1 1 -9 -1 a8 8 0 1 1 14 2 a11 11 0 1 1 -19 -3" fill="none" ${THIN}/>`);
    case 'stars':
      return pair((x) => `<path d="${star(x, 100, 13, 6)}" fill="#ffd23f" ${THIN}/>`);
    case 'shades':
      return `<path d="M56 92 H96 Q96 112 78 112 Q58 112 56 92 Z M104 92 H144 Q142 112 122 112 Q104 112 104 92 Z" fill="${INK}" ${S}/><path d="M96 95 H104" ${S}/><path d="M64 96 L74 96" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M112 96 L122 96" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  }
}

function mouth(m: Mouth): string {
  const nose = `<path d="M93 113 L107 113 L100 121 Z" fill="#ff7aa8" ${THIN}/>`;
  switch (m) {
    case 'smile':
      return nose + `<path d="M100 121 Q92 131 83 125 M100 121 Q108 131 117 125" fill="none" ${THIN}/>`;
    case 'grin':
      return nose + `<path d="M80 124 Q100 146 120 124 Z" fill="#fff" ${THIN}/>`;
    case 'open':
      return nose + `<path d="M84 125 Q100 150 116 125 Q100 132 84 125 Z" fill="#b0123b" ${THIN}/><path d="M92 137 Q100 132 108 137 Q100 146 92 137 Z" fill="#ff7aa8"/>`;
    case 'tongue':
      return nose + `<path d="M100 121 Q92 131 83 125 M100 121 Q108 131 117 125" fill="none" ${THIN}/><path d="M95 128 Q100 142 106 128 Z" fill="#ff7aa8" ${THIN}/>`;
    case 'grr':
      return nose + `<path d="M80 128 H120 V138 H80 Z" fill="#fff" ${THIN}/><path d="M80 133 L86 128 L92 138 L98 128 L104 138 L110 128 L116 138 L120 133" fill="none" ${THIN}/>`;
    case 'fang':
      return nose + `<path d="M84 124 Q100 134 116 124" fill="none" ${THIN}/><path d="M90 127 L94 136 L97 128" fill="#fff" ${THIN}/><path d="M103 128 L106 136 L110 127" fill="#fff" ${THIN}/>`;
    case 'o':
      return nose + `<ellipse cx="100" cy="132" rx="6" ry="8" fill="#b0123b" ${THIN}/>`;
    case 'flat':
      return nose + `<path d="M88 128 H112" ${THIN}/>`;
    case 'frown':
      return nose + `<path d="M86 132 Q100 120 114 132" fill="none" ${THIN}/>`;
  }
}

function catHead(c: CatSpec): string {
  const fur = c.fur;
  const inner = c.innerEar ?? '#ff9ec4';
  const ears =
    c.ears === 'round'
      ? `<circle cx="52" cy="62" r="20" fill="${fur}" ${S}/><circle cx="148" cy="62" r="20" fill="${fur}" ${S}/>`
      : c.ears === 'spiky'
        ? `<path d="M40 86 L30 28 L58 52 L66 26 L84 60 Z" fill="${fur}" ${S}/><path d="M160 86 L170 28 L142 52 L134 26 L116 60 Z" fill="${fur}" ${S}/>`
        : c.ears === 'tall'
          ? `<path d="M46 84 L40 18 L86 58 Z" fill="${fur}" ${S}/><path d="M154 84 L160 18 L114 58 Z" fill="${fur}" ${S}/><path d="M52 72 L49 38 L74 58 Z" fill="${inner}"/><path d="M148 72 L151 38 L126 58 Z" fill="${inner}"/>`
          : `<path d="M46 84 L42 30 L84 58 Z" fill="${fur}" ${S}/><path d="M154 84 L158 30 L116 58 Z" fill="${fur}" ${S}/><path d="M53 72 L51 45 L73 59 Z" fill="${inner}"/><path d="M147 72 L149 45 L127 59 Z" fill="${inner}"/>`;
  let pattern = '';
  if (c.pattern === 'tabby' && c.fur2) pattern = `<path d="M88 52 L92 70 M100 50 V70 M112 52 L108 70 M40 104 H58 M42 116 H58 M142 104 H160 M142 116 H158" stroke="${c.fur2}" stroke-width="6" stroke-linecap="round"/>`;
  if (c.pattern === 'patch' && c.fur2) pattern = `<path d="M100 52 Q140 50 158 90 Q150 76 120 74 Q104 72 100 52 Z" fill="${c.fur2}"/>`;
  if (c.pattern === 'spots' && c.fur2) pattern = `<circle cx="64" cy="76" r="9" fill="${c.fur2}"/><circle cx="142" cy="128" r="8" fill="${c.fur2}"/><circle cx="128" cy="70" r="6" fill="${c.fur2}"/>`;
  const blush = c.blush ? `<ellipse cx="62" cy="122" rx="10" ry="6" fill="#ff7aa8" opacity="0.55"/><ellipse cx="138" cy="122" rx="10" ry="6" fill="#ff7aa8" opacity="0.55"/>` : '';
  const whiskers = `<path d="M60 120 L28 114 M60 128 L30 132 M140 120 L172 114 M140 128 L170 132" ${THIN} fill="none"/>`;
  const sc = c.scale ?? 1;
  return `<g transform="translate(${100 - 100 * sc} ${(c.y ?? 0) + 100 - 100 * sc}) scale(${sc})">${ears}<ellipse cx="100" cy="104" rx="64" ry="56" fill="${fur}" ${S}/><clipPath id="h"><ellipse cx="100" cy="104" rx="61" ry="53"/></clipPath><g clip-path="url(#h)">${pattern}</g>${blush}${whiskers}${eyes(c.eyes)}${mouth(c.mouth)}</g>`;
}

function star(cx: number, cy: number, r: number, r2: number, n = 5): string {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r2 : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `;
  }
  return d + 'Z';
}

function bg(a: string, b: string, kind: 'burst' | 'dots' | 'stripes' | 'rays' | 'plain' = 'burst'): string {
  let deco = '';
  if (kind === 'burst' || kind === 'rays') {
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      const a1 = a0 + Math.PI / 16;
      deco += `<path d="M100 100 L${100 + Math.cos(a0) * 200} ${100 + Math.sin(a0) * 200} L${100 + Math.cos(a1) * 200} ${100 + Math.sin(a1) * 200} Z" fill="${b}" opacity="${kind === 'rays' ? 0.35 : 0.5}"/>`;
    }
  } else if (kind === 'dots') {
    for (let y = 10; y < 200; y += 26) for (let x = (y / 26) % 2 ? 22 : 9; x < 200; x += 26) deco += `<circle cx="${x}" cy="${y}" r="5" fill="${b}" opacity="0.55"/>`;
  } else if (kind === 'stripes') {
    for (let i = -200; i < 200; i += 28) deco += `<path d="M${i} 0 L${i + 200} 200 L${i + 214} 200 L${i + 14} 0 Z" fill="${b}" opacity="0.45"/>`;
  }
  return `<rect width="200" height="200" fill="${a}"/>${deco}`;
}

function bomb(x: number, y: number, r = 30, lit = true): string {
  const sparks = lit
    ? `<path d="${star(x + r * 0.95, y - r * 1.35, 13, 5, 8)}" fill="#ffd23f" ${THIN}/><circle cx="${x + r * 0.95}" cy="${y - r * 1.35}" r="4" fill="#fff"/>`
    : '';
  return `<path d="M${x + r * 0.55} ${y - r * 0.8} Q${x + r * 0.7} ${y - r * 1.3} ${x + r * 0.95} ${y - r * 1.3}" fill="none" ${S}/><rect x="${x + r * 0.3}" y="${y - r * 0.98}" width="${r * 0.5}" height="${r * 0.35}" rx="3" transform="rotate(25 ${x + r * 0.55} ${y - r * 0.8})" fill="#6a6f80" ${THIN}/><circle cx="${x}" cy="${y}" r="${r}" fill="#2a2638" ${S}/><path d="M${x - r * 0.5} ${y - r * 0.35} Q${x - r * 0.3} ${y - r * 0.65} ${x} ${y - r * 0.68}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.7"/>${sparks}`;
}

function paw(x: number, y: number, fur: string, s = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="17" ry="14" fill="${fur}" ${S}/><path d="M-7 -6 V2 M0 -8 V2 M7 -6 V2" ${THIN}/></g>`;
}

const halo = (y = 26) => `<ellipse cx="100" cy="${y}" rx="38" ry="10" fill="none" stroke="#ffd23f" stroke-width="9"/><ellipse cx="100" cy="${y}" rx="38" ry="10" fill="none" stroke="${INK}" stroke-width="2.5"/>`;
const horns = () => `<path d="M58 62 Q44 30 64 12 Q64 40 80 52 Z" fill="#ffe0c0" ${S}/><path d="M142 62 Q156 30 136 12 Q136 40 120 52 Z" fill="#ffe0c0" ${S}/>`;

// ============================================================================ per-card art

const CAT_ART: Record<CatKind, () => string> = {
  pizza: () =>
    bg('#ffcf6a', '#ff8c1a', 'dots') +
    `<path d="M100 196 L24 40 Q100 4 176 40 Z" fill="#ffcf3f" ${S}/><path d="M28 48 Q100 14 172 48" fill="none" stroke="#c9741a" stroke-width="14" stroke-linecap="round"/>` +
    catHead({ fur: '#ffcf3f', eyes: 'happy', mouth: 'tongue', y: 6, scale: 0.78, blush: true }) +
    `<circle cx="70" cy="150" r="10" fill="#e23b3b" ${THIN}/><circle cx="128" cy="160" r="9" fill="#e23b3b" ${THIN}/><circle cx="100" cy="176" r="7" fill="#e23b3b" ${THIN}/>`,
  robo: () =>
    bg('#9fd8ff', '#3f8cff', 'stripes') +
    `<path d="M100 24 V8" ${S}/><circle cx="100" cy="8" r="7" fill="#ff4b5c" ${S}/>` +
    catHead({ fur: '#c8d4e0', fur2: '#8a95a8', pattern: 'spots', eyes: 'shades', mouth: 'flat', innerEar: '#8a95a8', ears: 'tall' }) +
    `<rect x="62" y="150" width="76" height="40" rx="10" fill="#8a95a8" ${S}/><circle cx="84" cy="170" r="7" fill="#3fd8ff" ${THIN}/><circle cx="116" cy="170" r="7" fill="#ffd23f" ${THIN}/>`,
  cactus: () =>
    bg('#ffe7a8', '#ffb84a', 'rays') +
    `<path d="M50 190 L58 156 H142 L150 190 Z" fill="#d06a3a" ${S}/>` +
    catHead({ fur: '#5fc95a', fur2: '#3d9a3a', pattern: 'tabby', eyes: 'sly', mouth: 'smile', innerEar: '#3d9a3a', y: -8 }) +
    `<path d="M36 70 L28 60 M164 70 L172 60 M70 48 L66 36 M130 48 L134 36 M100 44 V30" ${THIN}/><circle cx="100" cy="40" r="10" fill="#ff6ad5" ${THIN}/>`,
  disco: () =>
    bg('#5b2a9a', '#ff4fd8', 'burst') +
    `<circle cx="100" cy="44" r="44" fill="#3a2a1a" ${S}/><circle cx="64" cy="58" r="22" fill="#3a2a1a" ${S}/><circle cx="136" cy="58" r="22" fill="#3a2a1a" ${S}/>` +
    catHead({ fur: '#ff9a4a', eyes: 'shades', mouth: 'grin', y: 12 }) +
    `<circle cx="164" cy="168" r="22" fill="#c8d4e0" ${S}/><path d="M146 160 H182 M146 174 H182 M158 148 V188 M170 148 V188" stroke="#8a95a8" stroke-width="2"/>`,
  banana: () =>
    bg('#fff3a0', '#ffd23f', 'dots') +
    catHead({ fur: '#fff6d8', eyes: 'happy', mouth: 'smile', blush: true, y: -4 }) +
    `<path d="M24 196 Q20 132 60 120 L66 196 Z" fill="#ffd23f" ${S}/><path d="M176 196 Q180 132 140 120 L134 196 Z" fill="#ffd23f" ${S}/><path d="M66 196 Q100 150 134 196" fill="#ffe57a" ${S}/>`,
  mustache: () =>
    bg('#c8f0ff', '#7ab8ff', 'stripes') +
    catHead({ fur: '#c9a06a', fur2: '#8a6a3a', pattern: 'patch', eyes: 'wide', mouth: 'flat' }) +
    `<path d="M100 124 Q76 112 54 132 Q70 140 100 130 Q130 140 146 132 Q124 112 100 124 Z" fill="#3a2a1a" ${S}/><circle cx="124" cy="100" r="17" fill="none" ${S}/><path d="M141 100 Q150 130 146 160" fill="none" ${THIN}/><path d="M60 46 H140 L132 18 H68 Z" fill="${INK}"/><rect x="50" y="44" width="100" height="10" rx="4" fill="${INK}"/>`,
  sushi: () =>
    bg('#ffd7c8', '#ff8a7a', 'dots') +
    `<ellipse cx="100" cy="172" rx="80" ry="26" fill="#fffaf0" ${S}/>` +
    catHead({ fur: '#ff8a5a', fur2: '#fff', pattern: 'tabby', eyes: 'closed', mouth: 'smile', y: -2 }) +
    `<rect x="20" y="150" width="160" height="16" rx="6" fill="#2a3a2a" ${S}/>`,
  rainbow: () =>
    bg('#ffffff', '#ffd23f', 'rays') +
    `<path d="M10 190 Q100 30 190 190" fill="none" stroke="#ff4b5c" stroke-width="14"/><path d="M26 190 Q100 54 174 190" fill="none" stroke="#ffd23f" stroke-width="14"/><path d="M42 190 Q100 78 158 190" fill="none" stroke="#43c26b" stroke-width="14"/><path d="M58 190 Q100 102 142 190" fill="none" stroke="#3f8cff" stroke-width="14"/>` +
    catHead({ fur: '#ffb8e8', eyes: 'stars', mouth: 'open', scale: 0.85, y: -16 }),
  potato: () =>
    bg('#d8f5b0', '#8acc5a', 'dots') +
    catHead({ fur: '#c9955a', fur2: '#8a5a2a', pattern: 'spots', eyes: 'sad', mouth: 'frown', ears: 'round' }) +
    `<path d="M62 168 Q100 196 138 168" fill="none" ${THIN}/>`,
};

const ART: Record<Exclude<CardType, 'cat'>, () => string> = {
  kitten: () =>
    bg('#ff5a1a', '#ffd23f', 'burst') +
    catHead({ fur: '#3a3446', eyes: 'evil', mouth: 'fang', innerEar: '#ff3b5c', y: -14, scale: 0.92 }) +
    bomb(118, 160, 30) +
    paw(70, 166, '#3a3446'),
  defuse: () =>
    bg('#9ff0b0', '#43c26b', 'rays') +
    catHead({ fur: '#ff9a4a', fur2: '#d0651a', pattern: 'tabby', eyes: 'wink', mouth: 'grin', y: -18, scale: 0.9 }) +
    bomb(126, 162, 26, false) +
    `<path d="M40 150 L84 176 M40 182 L84 156" ${S}/><circle cx="36" cy="146" r="9" fill="#ff4b5c" ${S}/><circle cx="36" cy="186" r="9" fill="#ff4b5c" ${S}/><path d="M150 132 Q166 120 160 104" fill="none" stroke="#ff4b5c" stroke-width="4" stroke-dasharray="6 6"/>`,
  nope: () =>
    bg('#ffb0b8', '#e8334a', 'stripes') +
    catHead({ fur: '#fffaf0', eyes: 'angry', mouth: 'flat', y: -24, scale: 0.85 }) +
    `<rect x="34" y="128" width="132" height="58" rx="12" fill="#e8334a" ${S}/><text x="100" y="172" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="40" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke">NOPE</text>`,
  attack: () =>
    bg('#ffc78a', '#ff8c1a', 'burst') +
    catHead({ fur: '#8a95a8', fur2: '#5a6478', pattern: 'tabby', eyes: 'angry', mouth: 'grr', y: -8, scale: 0.9 }) +
    `<path d="M30 40 L60 80 M44 32 L74 72 M58 26 L86 64" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M30 40 L60 80 M44 32 L74 72 M58 26 L86 64" ${THIN}/>` +
    `<text x="160" y="190" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="44" fill="#ffd23f" stroke="${INK}" stroke-width="4" paint-order="stroke">2×</text>`,
  targeted: () =>
    bg('#ffb08a', '#ff5a1a', 'rays') +
    catHead({ fur: '#3a3446', eyes: 'sly', mouth: 'fang', innerEar: '#ff8a5a', y: -6, scale: 0.88 }) +
    `<circle cx="100" cy="104" r="80" fill="none" stroke="#e8334a" stroke-width="7"/><circle cx="100" cy="104" r="80" fill="none" ${THIN}/><path d="M100 14 V44 M100 164 V194 M10 104 H40 M160 104 H190" stroke="#e8334a" stroke-width="7"/>` +
    `<text x="164" y="192" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="36" fill="#ffd23f" stroke="${INK}" stroke-width="4" paint-order="stroke">2×</text>`,
  skip: () =>
    bg('#bfe0ff', '#3f8cff', 'stripes') +
    `<path d="M14 120 H50 M8 140 H44 M18 160 H52" stroke="#fff" stroke-width="7" stroke-linecap="round"/>` +
    catHead({ fur: '#ffcf3f', eyes: 'happy', mouth: 'tongue', y: -12, scale: 0.88 }) +
    `<path d="M120 168 Q150 160 172 176 Q170 192 120 190 Z" fill="#ff4b5c" ${S}/><path d="M124 190 H170" stroke="#fff" stroke-width="5"/>`,
  favor: () =>
    bg('#ffd0f0', '#ff6ad5', 'dots') +
    catHead({ fur: '#fffaf0', fur2: '#c9a06a', pattern: 'patch', eyes: 'wide', mouth: 'o', blush: true, y: -22, scale: 0.86 }) +
    `<rect x="58" y="128" width="84" height="64" rx="6" fill="#ff4fd8" ${S}/><rect x="52" y="120" width="96" height="20" rx="5" fill="#ff8ae6" ${S}/><path d="M100 120 V192" stroke="#ffd23f" stroke-width="10"/><path d="M100 120 Q78 96 72 116 Q84 124 100 120 Q122 96 128 116 Q116 124 100 120 Z" fill="#ffd23f" ${THIN}/>`,
  shuffle: () =>
    bg('#d8c0ff', '#9b4dff', 'burst') +
    `<rect x="18" y="34" width="44" height="60" rx="7" fill="#fff" transform="rotate(-24 40 64)" ${S}/><rect x="140" y="30" width="44" height="60" rx="7" fill="#ffd23f" transform="rotate(20 162 60)" ${S}/><rect x="146" y="128" width="44" height="60" rx="7" fill="#3fd8ff" transform="rotate(-12 168 158)" ${S}/>` +
    catHead({ fur: '#b48aff', fur2: '#7b4fd8', pattern: 'tabby', eyes: 'swirl', mouth: 'open', scale: 0.84, y: 6 }),
  future: () =>
    bg('#bfb0ff', '#5b3fd8', 'rays') +
    `<path d="M48 54 L100 -6 L152 54 Z" fill="#3f2fb0" ${S}/><path d="${star(100, 26, 9, 4)}" fill="#ffd23f"/>` +
    catHead({ fur: '#6a6f80', eyes: 'closed', mouth: 'smile', y: -6, scale: 0.86 }) +
    `<circle cx="100" cy="164" r="30" fill="#9fe8ff" ${S}/><circle cx="90" cy="154" r="8" fill="#fff" opacity="0.8"/><path d="M74 194 H126 L118 184 H82 Z" fill="#c9a14a" ${S}/>`,
  reveal: () =>
    bg('#bfb0ff', '#5b3fd8', 'rays') +
    catHead({ fur: '#ffcf6a', eyes: 'wide', mouth: 'open', y: -14, scale: 0.86 }) +
    `<path d="M44 150 L120 126 V196 L44 172 Z" fill="#ff4b5c" ${S}/><rect x="120" y="126" width="18" height="70" rx="4" fill="#ffd23f" ${S}/><path d="M150 140 L176 128 M152 162 H182 M150 184 L176 196" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`,
  heck: () =>
    bg('#ff9a8a', '#c2263a', 'burst') +
    catHead({ fur: '#e8334a', eyes: 'evil', mouth: 'grin', innerEar: '#ffb0b8', y: -16, scale: 0.86 }) +
    horns() +
    `<path d="M150 196 V96" ${S}/><path d="M132 100 Q150 84 168 100 M150 76 V100 M132 100 V84 M168 100 V84" fill="none" stroke="#ffd23f" stroke-width="7" stroke-linecap="round"/><path d="M132 100 Q150 84 168 100 M150 76 V100 M132 100 V84 M168 100 V84" fill="none" ${THIN}/><path d="M20 196 Q50 170 80 196 Z" fill="#7a4a2a" ${S}/>`,
  armageddon: () =>
    `<rect width="200" height="200" fill="#1b1446"/><rect width="100" height="200" fill="#ffe8a0"/><path d="${star(32, 30, 10, 4)}" fill="#fff"/><path d="${star(170, 34, 10, 4)}" fill="#ff4b5c"/>` +
    `<clipPath id="lh"><rect width="100" height="200"/></clipPath><clipPath id="rh"><rect x="100" width="100" height="200"/></clipPath>` +
    `<g clip-path="url(#lh)">${halo(34)}${catHead({ fur: '#fffaf0', eyes: 'happy', mouth: 'smile', blush: true, y: 8, scale: 0.92 })}</g>` +
    `<g clip-path="url(#rh)">${horns()}${catHead({ fur: '#c2263a', eyes: 'evil', mouth: 'fang', innerEar: '#ffb0b8', y: 8, scale: 0.92 })}</g>` +
    `<path d="M100 0 L92 60 L108 100 L94 150 L104 200" fill="none" stroke="#ffd23f" stroke-width="6"/><path d="M100 0 L92 60 L108 100 L94 150 L104 200" fill="none" ${THIN}/>`,
  godcat: () =>
    bg('#fff3b0', '#ffd23f', 'rays') +
    `<path d="M40 120 Q-6 90 10 50 Q30 80 56 86 Z" fill="#fff" ${S}/><path d="M160 120 Q206 90 190 50 Q170 80 144 86 Z" fill="#fff" ${S}/>` +
    halo(22) +
    catHead({ fur: '#ffe066', fur2: '#ffb000', pattern: 'tabby', eyes: 'happy', mouth: 'smile', blush: true, y: 8, scale: 0.9 }),
  devilcat: () =>
    bg('#5a0a1a', '#c2263a', 'burst') +
    `<path d="M150 190 Q196 170 178 120 L190 110 L172 108 L176 92" fill="none" ${S}/>` +
    horns() +
    catHead({ fur: '#c2263a', fur2: '#7a0a1a', pattern: 'tabby', eyes: 'evil', mouth: 'grin', innerEar: '#ffb0b8', y: 4, scale: 0.92 }),
  feral: () =>
    bg('#ffd0f8', '#ff4fd8', 'burst') +
    catHead({ fur: '#7be36b', fur2: '#ff4fd8', pattern: 'spots', eyes: 'swirl', mouth: 'grr', ears: 'spiky', innerEar: '#ffd23f' }),
  imploding: () =>
    bg('#22305a', '#5b3fd8', 'burst') +
    // A black-hole vortex swallowing the cat (and its bomb).
    `<g opacity="0.9"><ellipse cx="100" cy="104" rx="92" ry="34" fill="none" stroke="#3fd8ff" stroke-width="6" transform="rotate(-18 100 104)"/><ellipse cx="100" cy="104" rx="70" ry="24" fill="none" stroke="#ff4fd8" stroke-width="6" transform="rotate(-18 100 104)"/><ellipse cx="100" cy="104" rx="92" ry="34" fill="none" ${THIN} transform="rotate(-18 100 104)"/></g>` +
    catHead({ fur: '#4a3a7a', fur2: '#2a1f4d', pattern: 'tabby', eyes: 'swirl', mouth: 'o', innerEar: '#3fd8ff', y: -14, scale: 0.8 }) +
    `<circle cx="100" cy="168" r="20" fill="#0a0618" ${S}/><circle cx="100" cy="168" r="9" fill="#3fd8ff" opacity="0.5"/>` +
    `<g transform="rotate(-35 150 160)">${bomb(152, 166, 16)}</g><path d="M30 150 Q60 160 80 166 M24 178 Q56 176 82 172" fill="none" stroke="#3fd8ff" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 9"/>`,
  reverse: () =>
    bg('#b8f5ea', '#2ab5a0', 'stripes') +
    catHead({ fur: '#ffcf6a', fur2: '#d08a1a', pattern: 'tabby', eyes: 'wide', mouth: 'grin', y: -2, scale: 0.72 }) +
    // Two arrows chasing each other round the cat.
    `<path d="M36 70 A70 70 0 0 1 150 36" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/><path d="M36 70 A70 70 0 0 1 150 36" fill="none" ${THIN}/><path d="M138 18 L170 38 L136 54 Z" fill="#fff" ${THIN}/>` +
    `<path d="M164 136 A70 70 0 0 1 50 170" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/><path d="M164 136 A70 70 0 0 1 50 170" fill="none" ${THIN}/><path d="M62 188 L30 168 L64 152 Z" fill="#fff" ${THIN}/>`,
  bottom: () =>
    bg('#f0d8b0', '#b07a4a', 'dots') +
    catHead({ fur: '#8a95a8', fur2: '#5a6478', pattern: 'patch', eyes: 'sly', mouth: 'tongue', y: -30, scale: 0.78 }) +
    // A tall pile with a card being slid out from underneath.
    `<rect x="52" y="112" width="96" height="22" rx="5" fill="#2e2670" ${S}/><rect x="48" y="128" width="96" height="22" rx="5" fill="#3f3496" ${S}/><rect x="54" y="144" width="96" height="22" rx="5" fill="#2e2670" ${S}/>` +
    `<rect x="96" y="164" width="96" height="24" rx="5" fill="#ffd23f" ${S}/><path d="M60 176 H86 M66 186 H90" stroke="#fff" stroke-width="5" stroke-linecap="round"/>` +
    paw(176, 176, '#8a95a8', 0.9),
  alter: () =>
    bg('#d8c8ff', '#5b3fd8', 'rays') +
    `<path d="M48 54 L100 -6 L152 54 Z" fill="#3f2fb0" ${S}/><path d="${star(100, 26, 9, 4)}" fill="#ffd23f"/>` +
    catHead({ fur: '#ff9ec4', eyes: 'stars', mouth: 'smile', y: -10, scale: 0.8, blush: true }) +
    // Three cards trading places, and a wand doing it.
    `<rect x="22" y="146" width="36" height="48" rx="6" fill="#fff" ${S} transform="rotate(-10 40 170)"/><rect x="82" y="150" width="36" height="48" rx="6" fill="#ffd23f" ${S}/><rect x="142" y="146" width="36" height="48" rx="6" fill="#3fd8ff" ${S} transform="rotate(10 160 170)"/>` +
    `<path d="M44 140 Q100 110 156 140" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="7 6"/><path d="M148 130 L160 142 L144 146" fill="none" ${THIN}/>` +
    `<path d="M164 70 L186 112" ${S}/><path d="${star(162, 64, 12, 5)}" fill="#ffd23f" ${THIN}/>`,
};

const cache = new Map<string, string>();

export function cardArt(c: Pick<Card, 'type' | 'cat'>): string {
  const key = c.type === 'cat' ? `cat:${c.cat}` : c.type;
  let svg = cache.get(key);
  if (!svg) {
    const body = c.type === 'cat' ? CAT_ART[c.cat ?? 'pizza']() : ART[c.type as Exclude<CardType, 'cat'>]();
    // (Sliced, so short art boxes — cards in hand — crop to the middle instead of letterboxing.)
    svg = `<svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
    cache.set(key, svg);
  }
  return svg;
}

/** Card back: the paw-bomb logo (the Angel Cat has a golden back). */
export function cardBack(gold = false): string {
  const a = gold ? '#ffd23f' : '#2e2670';
  const b = gold ? '#fff3b0' : '#3f3496';
  return `<svg viewBox="0 0 140 196" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="140" height="196" rx="14" fill="${a}"/><rect x="8" y="8" width="124" height="180" rx="10" fill="none" stroke="${b}" stroke-width="4" stroke-dasharray="10 6"/>${bomb(70, 104, 26)}<g transform="translate(70 104) scale(0.55)"><ellipse cx="0" cy="8" rx="20" ry="16" fill="${gold ? '#fff' : '#ff4fd8'}"/><circle cx="-18" cy="-14" r="8" fill="${gold ? '#fff' : '#ff4fd8'}"/><circle cx="-6" cy="-22" r="8" fill="${gold ? '#fff' : '#ff4fd8'}"/><circle cx="8" cy="-22" r="8" fill="${gold ? '#fff' : '#ff4fd8'}"/><circle cx="19" cy="-13" r="8" fill="${gold ? '#fff' : '#ff4fd8'}"/></g></svg>`;
}

const AVATARS: CatSpec[] = [
  { fur: '#ff9a4a', fur2: '#d0651a', pattern: 'tabby', eyes: 'wide', mouth: 'smile' },
  { fur: '#3a3446', eyes: 'sly', mouth: 'fang', innerEar: '#ff8a5a' },
  { fur: '#fffaf0', fur2: '#c9a06a', pattern: 'patch', eyes: 'happy', mouth: 'tongue', blush: true },
  { fur: '#8a95a8', fur2: '#5a6478', pattern: 'tabby', eyes: 'angry', mouth: 'grr' },
  { fur: '#ffe066', eyes: 'wink', mouth: 'grin', blush: true },
  { fur: '#b48aff', fur2: '#7b4fd8', pattern: 'spots', eyes: 'shades', mouth: 'smile' },
  { fur: '#7be36b', eyes: 'stars', mouth: 'open', ears: 'spiky' },
  { fur: '#ff8ab8', eyes: 'closed', mouth: 'smile', ears: 'round', blush: true },
];

export function avatar(i: number, mood: 'normal' | 'dead' | 'scared' = 'normal'): string {
  const spec = { ...AVATARS[((i % AVATARS.length) + AVATARS.length) % AVATARS.length]! };
  if (mood === 'dead') Object.assign(spec, { eyes: 'x', mouth: 'o' });
  if (mood === 'scared') Object.assign(spec, { eyes: 'wide', mouth: 'o' });
  return `<svg viewBox="0 6 200 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${catHead(spec)}</svg>`;
}

export const AVATAR_COUNT = AVATARS.length;
