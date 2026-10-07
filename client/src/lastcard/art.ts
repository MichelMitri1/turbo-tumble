import { COLOR_INFO, COLORS, type Card, type Color } from './cards';

/**
 * Card faces as inline SVG (100 × 140): the classic look — a white frame, a solid
 * colour field, a tilted white oval with the big symbol, and corner indices.
 */
const FONT = "'Lilita One', 'Arial Black', sans-serif";
const INK = '#14112a';

function symbolText(c: Pick<Card, 'kind' | 'n'>): string {
  if (c.kind === 'num') return String(c.n);
  if (c.kind === 'draw2') return '+2';
  if (c.kind === 'wild4') return '+4';
  return '';
}

/** Skip: circle with a slash. */
function skipIcon(x: number, y: number, r: number, fill: string, stroke: string, sw: number): string {
  return `<g transform="translate(${x} ${y})"><circle r="${r}" fill="none" stroke="${stroke}" stroke-width="${r * 0.42 + sw}"/><line x1="${-r * 0.7}" y1="${r * 0.7}" x2="${r * 0.7}" y2="${-r * 0.7}" stroke="${stroke}" stroke-width="${r * 0.42 + sw}" stroke-linecap="round"/>
    <circle r="${r}" fill="none" stroke="${fill}" stroke-width="${r * 0.42}"/><line x1="${-r * 0.7}" y1="${r * 0.7}" x2="${r * 0.7}" y2="${-r * 0.7}" stroke="${fill}" stroke-width="${r * 0.42}" stroke-linecap="round"/></g>`;
}

/** Reverse: two bent arrows. */
function reverseIcon(x: number, y: number, s: number, fill: string, stroke: string, sw: number): string {
  const arrow = `M -0.55 0.15 L -0.55 -0.35 Q -0.55 -0.55 -0.35 -0.55 L 0.15 -0.55 L 0.15 -0.85 L 0.65 -0.4 L 0.15 0.05 L 0.15 -0.25 L -0.25 -0.25 L -0.25 0.15 Z`;
  const one = (rot: number) => `<path d="${arrow}" transform="rotate(${rot})" fill="${fill}" stroke="${stroke}" stroke-width="${sw / s}" stroke-linejoin="round"/>`;
  return `<g transform="translate(${x} ${y}) scale(${s}) rotate(-45)">${one(0)}${one(180)}</g>`;
}

/** Two (or four) little cards for the Draw cards. */
function miniCards(x: number, y: number, colors: string[], s: number): string {
  const n = colors.length;
  return `<g transform="translate(${x} ${y}) scale(${s})">${colors
    .map((col, i) => {
      const dx = (i - (n - 1) / 2) * (n > 2 ? 9 : 12);
      const dy = (i - (n - 1) / 2) * (n > 2 ? -5 : -7);
      return `<rect x="${dx - 9}" y="${dy - 13}" width="18" height="26" rx="3" fill="${col}" stroke="#fff" stroke-width="2.5"/><rect x="${dx - 9}" y="${dy - 13}" width="18" height="26" rx="3" fill="none" stroke="${INK}" stroke-width="0.8"/>`;
    })
    .join('')}</g>`;
}

function fourColorOval(): string {
  // The oval split into four colour quadrants.
  const q = (col: Color, a0: number) => {
    const a1 = a0 + 90;
    const p = (a: number) => `${50 + 30 * Math.cos((a * Math.PI) / 180)} ${70 + 46 * Math.sin((a * Math.PI) / 180)}`;
    return `<path d="M 50 70 L ${p(a0)} A 30 46 0 0 1 ${p(a1)} Z" fill="${COLOR_INFO[col].hex}"/>`;
  };
  return `<g transform="rotate(28 50 70)"><ellipse cx="50" cy="70" rx="33" ry="49" fill="#fff"/>${q('r', 180)}${q('b', 270)}${q('y', 0)}${q('g', 90)}</g>`;
}

export function cardSvg(c: Pick<Card, 'kind' | 'color' | 'n'>): string {
  const wild = c.kind === 'wild' || c.kind === 'wild4';
  const col = wild ? INK : COLOR_INFO[c.color!].hex;
  const dark = wild ? '#000' : COLOR_INFO[c.color!].dark;
  const sym = symbolText(c);
  const under = c.kind === 'num' && (c.n === 6 || c.n === 9);
  const corner = (x: number, y: number, rot: number) => {
    let inner = '';
    if (sym) inner = `<text x="0" y="0" font-family="${FONT}" font-size="${sym.length > 1 ? 15 : 19}" text-anchor="middle" dominant-baseline="central" fill="#fff" stroke="${INK}" stroke-width="2.2" paint-order="stroke" font-style="italic">${sym}</text>${under ? `<rect x="-5" y="9" width="10" height="2" fill="#fff" stroke="${INK}" stroke-width="0.6"/>` : ''}`;
    else if (c.kind === 'skip') inner = skipIcon(0, 0, 6, '#fff', INK, 1.6);
    else if (c.kind === 'rev') inner = reverseIcon(0, 0, 9, '#fff', INK, 1.6);
    else if (c.kind === 'wild') inner = `<g transform="scale(0.24) translate(-50 -70)">${fourColorOval()}</g>`;
    return `<g transform="translate(${x} ${y}) rotate(${rot})">${inner}</g>`;
  };
  let center = '';
  if (wild) {
    center = fourColorOval();
    if (c.kind === 'wild4') center += miniCards(50, 70, [COLOR_INFO.g.hex, COLOR_INFO.b.hex, COLOR_INFO.r.hex, COLOR_INFO.y.hex], 1.15);
  } else {
    center = `<ellipse cx="50" cy="70" rx="33" ry="49" fill="#fff" transform="rotate(28 50 70)"/>`;
    if (c.kind === 'num')
      center += `<text x="50" y="72" font-family="${FONT}" font-size="58" text-anchor="middle" dominant-baseline="central" fill="${col}" stroke="${INK}" stroke-width="4" paint-order="stroke" font-style="italic">${c.n}</text>${under ? `<rect x="36" y="97" width="28" height="5" rx="2" fill="${col}" stroke="${INK}" stroke-width="1.6"/>` : ''}`;
    else if (c.kind === 'skip') center += skipIcon(50, 70, 20, col, INK, 4);
    else if (c.kind === 'rev') center += reverseIcon(50, 70, 30, col, INK, 4);
    else if (c.kind === 'draw2') center += miniCards(50, 70, [col, col], 1.5);
  }
  const gid = `lc-sheen-${c.color ?? 'w'}`;
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="98" height="138" rx="10" fill="#fff"/>
    <rect x="6" y="6" width="88" height="128" rx="7" fill="${col}"/>
    <rect x="6" y="6" width="88" height="128" rx="7" fill="url(#${gid})" opacity="0.5"/>
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="${dark}" stop-opacity="0.5"/></linearGradient></defs>
    ${center}
    ${corner(17, 19, 0)}${corner(83, 121, 180)}
  </svg>`;
}

export function backSvg(): string {
  return `<svg viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="98" height="138" rx="10" fill="#fff"/>
    <rect x="6" y="6" width="88" height="128" rx="7" fill="${INK}"/>
    <ellipse cx="50" cy="70" rx="33" ry="49" fill="${COLOR_INFO.r.hex}" transform="rotate(28 50 70)"/>
    <g transform="rotate(-24 50 70)" font-family="${FONT}" font-style="italic" text-anchor="middle" fill="${COLOR_INFO.y.hex}" stroke="${INK}" stroke-width="3" paint-order="stroke">
      <text x="50" y="66" font-size="25">LAST</text><text x="50" y="90" font-size="25">CARD</text>
    </g>
  </svg>`;
}

/** Player avatars: animal faces on coloured discs. */
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🐯', '🐨', '🦄', '🐧', '🐶', '🐱'];
const AV_BG = ['#ff8a3d', '#8fd3ff', '#7ee08a', '#ffd23f', '#ff7aa8', '#c9a27a', '#ffb347', '#b8c4d6', '#d8a6ff', '#9fd8e8', '#e8c39e', '#ffc4d6'];
export const AVATAR_COUNT = AVATARS.length;
export function avatar(i: number): string {
  const k = ((i % AVATARS.length) + AVATARS.length) % AVATARS.length;
  return `<span class="lc-avatar" style="--bg:${AV_BG[k]}">${AVATARS[k]}</span>`;
}

export const COLOR_ORDER = COLORS;
