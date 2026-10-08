/**
 * Clubs, players and formations (all fictional). Ratings work like the big football
 * game's cards: six face stats (PAC SHO PAS DRI DEF PHY) and an overall weighted by
 * position. Everything is generated from a seed so every client agrees.
 */

export type Role = 'GK' | 'CB' | 'LB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST';
export interface Stats {
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
  /** Goalkeeping (reflexes / diving / handling, rolled into one). */
  gk: number;
}
export interface PlayerDef {
  name: string;
  num: number;
  role: Role;
  stats: Stats;
  ovr: number;
  /** Cosmetics: skin tone and hair colour index. */
  skin: number;
  hair: number;
  /** Preferred foot. */
  left: boolean;
}
export interface Kit {
  shirt: string;
  /** Second shirt colour for stripes / sleeves. */
  trim: string;
  shorts: string;
  socks: string;
  pattern: 'plain' | 'stripes' | 'hoops' | 'sash' | 'halves';
}
export interface Club {
  id: string;
  name: string;
  short: string;
  city: string;
  stadium: string;
  home: Kit;
  away: Kit;
  gk: Kit;
  formation: FormationId;
  /** Strength band: base rating the squad is generated around. */
  base: number;
  /** Badge: shape + two colours. */
  badge: { shape: 'shield' | 'round' | 'diamond'; c1: string; c2: string; mark: string };
  names: string[];
  players: PlayerDef[];
}

export type FormationId = '4-3-3' | '4-4-2' | '4-2-3-1' | '3-5-2';
/** Slots in "attacking +x" space: x −1 (own goal line) … +1 (opponent's), z −1 … +1 (left … right as you attack). */
export const FORMATIONS: Record<FormationId, Array<{ role: Role; x: number; z: number }>> = {
  '4-3-3': [
    { role: 'GK', x: -0.97, z: 0 },
    { role: 'LB', x: -0.62, z: -0.7 },
    { role: 'CB', x: -0.7, z: -0.24 },
    { role: 'CB', x: -0.7, z: 0.24 },
    { role: 'RB', x: -0.62, z: 0.7 },
    { role: 'CM', x: -0.32, z: -0.36 },
    { role: 'CDM', x: -0.45, z: 0 },
    { role: 'CM', x: -0.32, z: 0.36 },
    { role: 'LW', x: -0.02, z: -0.68 },
    { role: 'ST', x: 0.05, z: 0 },
    { role: 'RW', x: -0.02, z: 0.68 },
  ],
  '4-4-2': [
    { role: 'GK', x: -0.97, z: 0 },
    { role: 'LB', x: -0.62, z: -0.7 },
    { role: 'CB', x: -0.7, z: -0.24 },
    { role: 'CB', x: -0.7, z: 0.24 },
    { role: 'RB', x: -0.62, z: 0.7 },
    { role: 'LM', x: -0.3, z: -0.7 },
    { role: 'CM', x: -0.38, z: -0.22 },
    { role: 'CM', x: -0.38, z: 0.22 },
    { role: 'RM', x: -0.3, z: 0.7 },
    { role: 'ST', x: 0.03, z: -0.18 },
    { role: 'ST', x: 0.03, z: 0.18 },
  ],
  '4-2-3-1': [
    { role: 'GK', x: -0.97, z: 0 },
    { role: 'LB', x: -0.62, z: -0.7 },
    { role: 'CB', x: -0.7, z: -0.24 },
    { role: 'CB', x: -0.7, z: 0.24 },
    { role: 'RB', x: -0.62, z: 0.7 },
    { role: 'CDM', x: -0.46, z: -0.2 },
    { role: 'CDM', x: -0.46, z: 0.2 },
    { role: 'LM', x: -0.15, z: -0.62 },
    { role: 'CAM', x: -0.18, z: 0 },
    { role: 'RM', x: -0.15, z: 0.62 },
    { role: 'ST', x: 0.06, z: 0 },
  ],
  '3-5-2': [
    { role: 'GK', x: -0.97, z: 0 },
    { role: 'CB', x: -0.7, z: -0.4 },
    { role: 'CB', x: -0.72, z: 0 },
    { role: 'CB', x: -0.7, z: 0.4 },
    { role: 'LM', x: -0.32, z: -0.78 },
    { role: 'CM', x: -0.4, z: -0.24 },
    { role: 'CDM', x: -0.5, z: 0 },
    { role: 'CM', x: -0.4, z: 0.24 },
    { role: 'RM', x: -0.32, z: 0.78 },
    { role: 'ST', x: 0.03, z: -0.18 },
    { role: 'ST', x: 0.03, z: 0.18 },
  ],
};

/** Overall from face stats, weighted per position (close to how the cards do it). */
export function overall(role: Role, s: Stats): number {
  const w: Record<Role, [number, number, number, number, number, number]> = {
    GK: [0, 0, 0, 0, 0, 0],
    CB: [0.12, 0.02, 0.06, 0.06, 0.5, 0.24],
    LB: [0.24, 0.02, 0.16, 0.16, 0.3, 0.12],
    RB: [0.24, 0.02, 0.16, 0.16, 0.3, 0.12],
    CDM: [0.06, 0.04, 0.24, 0.14, 0.34, 0.18],
    CM: [0.08, 0.1, 0.34, 0.26, 0.12, 0.1],
    CAM: [0.1, 0.2, 0.32, 0.32, 0.02, 0.04],
    LM: [0.24, 0.14, 0.26, 0.28, 0.04, 0.04],
    RM: [0.24, 0.14, 0.26, 0.28, 0.04, 0.04],
    LW: [0.26, 0.2, 0.18, 0.32, 0.01, 0.03],
    RW: [0.26, 0.2, 0.18, 0.32, 0.01, 0.03],
    ST: [0.18, 0.42, 0.08, 0.2, 0.01, 0.11],
  };
  if (role === 'GK') return Math.round(s.gk);
  const k = w[role];
  return Math.round(k[0] * s.pac + k[1] * s.sho + k[2] * s.pas + k[3] * s.dri + k[4] * s.def + k[5] * s.phy);
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const hash = (str: string) => [...str].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);

/** Stat profile per role: which stats lead (added to the club's base). */
const PROFILE: Record<Role, Stats> = {
  GK: { pac: -30, sho: -45, pas: -18, dri: -30, def: -40, phy: -6, gk: 4 },
  CB: { pac: -10, sho: -32, pas: -12, dri: -16, def: 6, phy: 4, gk: -60 },
  LB: { pac: 4, sho: -24, pas: -6, dri: -6, def: 0, phy: -6, gk: -60 },
  RB: { pac: 4, sho: -24, pas: -6, dri: -6, def: 0, phy: -6, gk: -60 },
  CDM: { pac: -10, sho: -14, pas: 0, dri: -6, def: 2, phy: 2, gk: -60 },
  CM: { pac: -6, sho: -6, pas: 4, dri: 2, def: -12, phy: -4, gk: -60 },
  CAM: { pac: -2, sho: 0, pas: 4, dri: 5, def: -30, phy: -12, gk: -60 },
  LM: { pac: 5, sho: -6, pas: 0, dri: 3, def: -26, phy: -12, gk: -60 },
  RM: { pac: 5, sho: -6, pas: 0, dri: 3, def: -26, phy: -12, gk: -60 },
  LW: { pac: 7, sho: 0, pas: -2, dri: 5, def: -36, phy: -14, gk: -60 },
  RW: { pac: 7, sho: 0, pas: -2, dri: 5, def: -36, phy: -14, gk: -60 },
  ST: { pac: 3, sho: 6, pas: -8, dri: 1, def: -40, phy: 2, gk: -60 },
};

const SUBS: Role[] = ['GK', 'CB', 'RB', 'CM', 'CAM', 'LW', 'ST'];

function makeSquad(c: Omit<Club, 'players'>): PlayerDef[] {
  const r = rng(hash(c.id));
  const pool = [...c.names];
  const used = new Set<number>();
  const roles = [...FORMATIONS[c.formation].map((s) => s.role), ...SUBS];
  return roles.map((role, i) => {
    const star = i < 11 && r() < 0.18 ? 6 : 0;
    const clamp = (v: number) => Math.max(25, Math.min(97, Math.round(v)));
    const p = PROFILE[role];
    const stats: Stats = {
      pac: clamp(c.base + p.pac + star + (r() - 0.5) * 12),
      sho: clamp(c.base + p.sho + star + (r() - 0.5) * 12),
      pas: clamp(c.base + p.pas + star + (r() - 0.5) * 10),
      dri: clamp(c.base + p.dri + star + (r() - 0.5) * 10),
      def: clamp(c.base + p.def + star + (r() - 0.5) * 10),
      phy: clamp(c.base + p.phy + (r() - 0.5) * 14),
      gk: clamp(c.base + p.gk + star + (r() - 0.5) * 8),
    };
    if (i >= 11) for (const k of Object.keys(stats) as Array<keyof Stats>) stats[k] = clamp(stats[k] - 4);
    let num = role === 'GK' ? (i < 11 ? 1 : 13) : [0, 2, 4, 5, 3, 8, 6, 10, 11, 9, 7][i] ?? 12 + i;
    if (i >= 11 || used.has(num)) num = 14 + Math.floor(r() * 20);
    while (used.has(num)) num++;
    used.add(num);
    const name = pool.splice(Math.floor(r() * pool.length), 1)[0] ?? `Player ${i}`;
    return { name, num, role, stats, ovr: overall(role, stats), skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), left: r() < 0.24 || role === 'LB' || role === 'LW' };
  });
}

const N = {
  es: ['Álvarez', 'Navarro', 'Romero', 'Ortega', 'Delgado', 'Castillo', 'Herrera', 'Molina', 'Serrano', 'Vidal', 'Moreno', 'Iglesias', 'Pardo', 'Cabrera', 'Ruiz', 'Marín', 'Fuentes', 'Bravo', 'Cano', 'Soler'],
  en: ['Whitmore', 'Ashby', 'Kendall', 'Harrow', 'Pryce', 'Calloway', 'Benfield', 'Rowntree', 'Ellison', 'Stratton', 'Holloway', 'Garside', 'Penrose', 'Wilde', 'Fairley', 'Marsh', 'Cotter', 'Dawes', 'Fenwick', 'Lyle'],
  it: ['Rinaldi', 'Ferrante', 'Bellucci', 'Martello', 'Santoro', 'Galli', 'Moretti', 'Cattaneo', 'Lombardo', 'Esposito', 'Bianchi', 'Vitale', 'Pellegrini', 'Marchetti', 'Fabbri', 'Caruso', 'Gentile', 'Orlando', 'Testa', 'Valli'],
  de: ['Kessler', 'Brandt', 'Hoffner', 'Lindemann', 'Wagner', 'Reuter', 'Albrecht', 'Vogt', 'Seidel', 'Kraus', 'Engel', 'Hahn', 'Lorenz', 'Brenner', 'Fiedler', 'Haas', 'Kühn', 'Roth', 'Stein', 'Ziegler'],
  pt: ['Carvalho', 'Moutinho', 'Teixeira', 'Pinheiro', 'Barbosa', 'Rocha', 'Sequeira', 'Fontes', 'Amaral', 'Peixoto', 'Correia', 'Valente', 'Brito', 'Leal', 'Matos', 'Quaresma', 'Neves', 'Guerra', 'Simões', 'Freitas'],
  fr: ['Laurent', 'Moreau', 'Girard', 'Faure', 'Rousseau', 'Mercier', 'Blanchard', 'Lefèvre', 'Chevalier', 'Dumont', 'Perrin', 'Roussel', 'Garnier', 'Marchand', 'Brun', 'Leclerc', 'Fournier', 'Vasseur', 'Lacroix', 'Bonnet'],
  nl: ['de Vries', 'van Dijkstra', 'Bakker', 'Visser', 'Smit', 'Mulder', 'de Boer', 'Bos', 'Vos', 'Hendriks', 'Dekker', 'van Leeuwen', 'Kok', 'Jansen', 'Peeters', 'Verbeek', 'Kuipers', 'Postma', 'Veenstra', 'Hoekstra'],
  br: ['Santos', 'Oliveira', 'Lima', 'Ferreira', 'Souza', 'Rodrigues', 'Gomes', 'Ribeiro', 'Araújo', 'Nascimento', 'Cardoso', 'Pereira', 'Moraes', 'Batista', 'Medeiros', 'Andrade', 'Tavares', 'Vieira', 'Dias', 'Monteiro'],
};

const CLUBS_BASE: Array<Omit<Club, 'players'>> = [
  { id: 'nbu', name: 'Northbridge United', short: 'NBU', city: 'Northbridge', stadium: 'Ironworks Park', base: 83, formation: '4-3-3', home: { shirt: '#c8102e', trim: '#ffffff', shorts: '#ffffff', socks: '#c8102e', pattern: 'plain' }, away: { shirt: '#14213d', trim: '#c8102e', shorts: '#14213d', socks: '#14213d', pattern: 'plain' }, gk: { shirt: '#2ecc71', trim: '#111', shorts: '#111111', socks: '#2ecc71', pattern: 'plain' }, badge: { shape: 'shield', c1: '#c8102e', c2: '#ffd23f', mark: 'NB' }, names: N.en },
  { id: 'val', name: 'Real Valoria', short: 'VAL', city: 'Valoria', stadium: 'Estadio del Sol', base: 84, formation: '4-3-3', home: { shirt: '#f5f5f0', trim: '#d4af37', shorts: '#f5f5f0', socks: '#f5f5f0', pattern: 'plain' }, away: { shirt: '#4b2a7b', trim: '#f5f5f0', shorts: '#4b2a7b', socks: '#4b2a7b', pattern: 'plain' }, gk: { shirt: '#ff8c1a', trim: '#111', shorts: '#ff8c1a', socks: '#ff8c1a', pattern: 'plain' }, badge: { shape: 'round', c1: '#d4af37', c2: '#4b2a7b', mark: 'RV' }, names: N.es },
  { id: 'rhe', name: 'Rhein Athletic', short: 'RHE', city: 'Rheinstadt', stadium: 'Flussarena', base: 82, formation: '4-2-3-1', home: { shirt: '#d00027', trim: '#ffffff', shorts: '#ffffff', socks: '#d00027', pattern: 'halves' }, away: { shirt: '#ffffff', trim: '#d00027', shorts: '#ffffff', socks: '#ffffff', pattern: 'plain' }, gk: { shirt: '#ffd23f', trim: '#111', shorts: '#111111', socks: '#ffd23f', pattern: 'plain' }, badge: { shape: 'round', c1: '#d00027', c2: '#ffffff', mark: 'RA' }, names: N.de },
  { id: 'aur', name: 'Sporting Aurora', short: 'AUR', city: 'Lisboa Nova', stadium: 'Estádio da Aurora', base: 79, formation: '4-4-2', home: { shirt: '#0b8a4a', trim: '#ffffff', shorts: '#ffffff', socks: '#0b8a4a', pattern: 'hoops' }, away: { shirt: '#111111', trim: '#0b8a4a', shorts: '#111111', socks: '#111111', pattern: 'plain' }, gk: { shirt: '#5a2a8a', trim: '#fff', shorts: '#5a2a8a', socks: '#5a2a8a', pattern: 'plain' }, badge: { shape: 'shield', c1: '#0b8a4a', c2: '#ffffff', mark: 'SA' }, names: N.pt },
  { id: 'inm', name: 'Inter Milanova', short: 'INM', city: 'Milanova', stadium: 'Stadio delle Stelle', base: 82, formation: '3-5-2', home: { shirt: '#0a2f8a', trim: '#111111', shorts: '#111111', socks: '#111111', pattern: 'stripes' }, away: { shirt: '#f5f5f0', trim: '#0a2f8a', shorts: '#f5f5f0', socks: '#f5f5f0', pattern: 'sash' }, gk: { shirt: '#ffd23f', trim: '#111', shorts: '#ffd23f', socks: '#ffd23f', pattern: 'plain' }, badge: { shape: 'round', c1: '#0a2f8a', c2: '#111111', mark: 'IM' }, names: N.it },
  { id: 'olr', name: 'Olympique Rivage', short: 'OLR', city: 'Rivage', stadium: 'Parc du Rivage', base: 80, formation: '4-2-3-1', home: { shirt: '#1d4fa0', trim: '#c8102e', shorts: '#1d4fa0', socks: '#c8102e', pattern: 'plain' }, away: { shirt: '#f5f5f0', trim: '#1d4fa0', shorts: '#1d4fa0', socks: '#f5f5f0', pattern: 'plain' }, gk: { shirt: '#2ecc71', trim: '#111', shorts: '#2ecc71', socks: '#2ecc71', pattern: 'plain' }, badge: { shape: 'diamond', c1: '#1d4fa0', c2: '#c8102e', mark: 'OR' }, names: N.fr },
  { id: 'ajn', name: 'AFC Noordhaven', short: 'AFN', city: 'Noordhaven', stadium: 'Havenstadion', base: 78, formation: '4-3-3', home: { shirt: '#ffffff', trim: '#c8102e', shorts: '#ffffff', socks: '#ffffff', pattern: 'sash' }, away: { shirt: '#1a1a2e', trim: '#ffd23f', shorts: '#1a1a2e', socks: '#1a1a2e', pattern: 'plain' }, gk: { shirt: '#ff8c1a', trim: '#111', shorts: '#111111', socks: '#ff8c1a', pattern: 'plain' }, badge: { shape: 'shield', c1: '#c8102e', c2: '#ffffff', mark: 'AN' }, names: N.nl },
  { id: 'atp', name: 'Atlético Praia', short: 'ATP', city: 'Praia Dourada', stadium: 'Arena da Praia', base: 77, formation: '4-4-2', home: { shirt: '#ffd23f', trim: '#0b8a4a', shorts: '#0a2f8a', socks: '#ffffff', pattern: 'plain' }, away: { shirt: '#0a2f8a', trim: '#ffd23f', shorts: '#ffffff', socks: '#0a2f8a', pattern: 'plain' }, gk: { shirt: '#111111', trim: '#ffd23f', shorts: '#111111', socks: '#111111', pattern: 'plain' }, badge: { shape: 'round', c1: '#ffd23f', c2: '#0b8a4a', mark: 'AP' }, names: N.br },
];

export const CLUBS: Club[] = CLUBS_BASE.map((c) => ({ ...c, players: makeSquad(c) }));
export const CLUB = Object.fromEntries(CLUBS.map((c) => [c.id, c])) as Record<string, Club>;

/** Team ratings shown on the select screen. */
export function clubRatings(c: Club): { att: number; mid: number; def: number; ovr: number } {
  const xi = c.players.slice(0, 11);
  const avg = (rs: Role[]) => {
    const ps = xi.filter((p) => rs.includes(p.role));
    return Math.round(ps.reduce((a, p) => a + p.ovr, 0) / Math.max(1, ps.length));
  };
  const att = avg(['ST', 'LW', 'RW', 'CAM']);
  const mid = avg(['CM', 'CDM', 'LM', 'RM', 'CAM']);
  const def = avg(['CB', 'LB', 'RB', 'GK']);
  return { att, mid, def, ovr: Math.round((att + mid + def) / 3) };
}

/** Pick an away kit when the home kits clash. */
export function kitsFor(home: Club, away: Club): [Kit, Kit] {
  const dist = (a: string, b: string) => {
    const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
  };
  return [home.home, dist(home.home.shirt, away.home.shirt) < 90 ? away.away : away.home];
}
