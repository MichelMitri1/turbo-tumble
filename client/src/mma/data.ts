export type Style = 'Boxer' | 'Kickboxer' | 'Wrestler' | 'Jiu-Jitsu' | 'Muay Thai' | 'MMA';

export interface FighterDef {
  id: string;
  name: string;
  nick: string;
  country: string;
  style: Style;
  record: string;
  color: number;
  accent: number;
  skin: number;
  stats: { striking: number; grappling: number; power: number; cardio: number; chin: number };
}

export const FIGHTERS: FighterDef[] = [
  { id: 'vale', name: 'Dante Vale', nick: 'THE TEMPEST', country: 'BR', style: 'MMA', record: '18–2–0', color: 0xd91f31, accent: 0xffd36a, skin: 0xa96845, stats: { striking: 89, grappling: 86, power: 87, cardio: 90, chin: 86 } },
  { id: 'haddad', name: 'Karim Haddad', nick: 'CEDAR', country: 'LB', style: 'Kickboxer', record: '14–1–0', color: 0x14985a, accent: 0xffffff, skin: 0xb97952, stats: { striking: 93, grappling: 76, power: 89, cardio: 88, chin: 84 } },
  { id: 'volkov', name: 'Nika Volkov', nick: 'NORTH STAR', country: 'GE', style: 'Wrestler', record: '21–3–0', color: 0x2956bc, accent: 0xdce8ff, skin: 0xe0b28f, stats: { striking: 79, grappling: 94, power: 86, cardio: 91, chin: 90 } },
  { id: 'okoye', name: 'Amara Okoye', nick: 'THUNDER', country: 'NG', style: 'Boxer', record: '12–0–0', color: 0x6d22a8, accent: 0xf3c743, skin: 0x70412e, stats: { striking: 95, grappling: 72, power: 94, cardio: 85, chin: 88 } },
  { id: 'tanaka', name: 'Mei Tanaka', nick: 'ORCHID', country: 'JP', style: 'Jiu-Jitsu', record: '16–2–1', color: 0xf3f4f6, accent: 0xe0293f, skin: 0xd3a07d, stats: { striking: 80, grappling: 96, power: 77, cardio: 92, chin: 84 } },
  { id: 'reyes', name: 'Sofia Reyes', nick: 'LA FURIA', country: 'MX', style: 'Muay Thai', record: '17–4–0', color: 0x17191f, accent: 0x21d4a1, skin: 0xb36d48, stats: { striking: 92, grappling: 79, power: 88, cardio: 89, chin: 87 } },
];

export const overall = (f: FighterDef) => Math.round((f.stats.striking + f.stats.grappling + f.stats.power + f.stats.cardio + f.stats.chin) / 5);

export type Difficulty = 'rookie' | 'contender' | 'champion';
export const DIFFICULTIES: Array<{ id: Difficulty; label: string; detail: string }> = [
  { id: 'rookie', label: 'Rookie', detail: 'Slower reactions, forgiving defense' },
  { id: 'contender', label: 'Contender', detail: 'Smart pressure and counters' },
  { id: 'champion', label: 'Champion', detail: 'Reads habits, punishes mistakes' },
];
