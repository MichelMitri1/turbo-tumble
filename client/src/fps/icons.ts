/** Flat line icons for perks, killstreaks and modes (24×24 SVG, currentColor). */
const P: Record<string, string> = {
  // Perks.
  lightweight: '<path d="M4 20c6-1 11-6 15-15-7 2-12 6-14 12"/><path d="M8 15h5M10 11h6"/>',
  scavenger: '<rect x="4" y="9" width="16" height="10" rx="1"/><path d="M4 13h16M8 9V6h8v3"/><path d="M9 16h2M13 16h2"/>',
  ghost: '<path d="M6 20V10a6 6 0 0 1 12 0v10l-2-2-2 2-2-2-2 2-2-2z"/><circle cx="10" cy="11" r="1"/><circle cx="14" cy="11" r="1"/>',
  hardline: '<path d="M5 18l7-5 7 5M5 13l7-5 7 5M5 8l7-5 7 5"/>',
  steady: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  quickfix: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M12 10v5M9.5 12.5h5"/>',
  // Killstreaks.
  uav: '<path d="M3 12h18M12 9v6"/><path d="M7 12l-2 4M17 12l2 4"/><circle cx="12" cy="12" r="2"/><path d="M8 7a6 6 0 0 1 8 0M6 5a9 9 0 0 1 12 0"/>',
  airstrike: '<path d="M12 2l2 7 7 4v2l-7-2-1 5 3 2v2l-4-1-4 1v-2l3-2-1-5-7 2v-2l7-4z"/>',
  heli: '<path d="M3 6h18M12 6v3"/><path d="M6 12c0-2 2-3 5-3h3c3 0 4 2 4 4s-1 3-4 3h-6c-1 0-2-2-2-4z"/><path d="M18 13h3l1-2M9 16l-1 3h8l-1-3"/>',
  rcxd: '<rect x="4" y="9" width="16" height="6" rx="2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M14 9V4M14 4l3 1"/>',
  cuav: '<path d="M12 21V11M8 21h8"/><path d="M8 7a6 6 0 0 1 8 0M5 4a10 10 0 0 1 14 0"/><path d="M4 4l16 16"/>',
  drone: '<rect x="9" y="10" width="6" height="4" rx="1"/><path d="M9 11L5 7M15 11l4-4M9 13l-4 4M15 13l4 4"/><path d="M2 7h6M16 7h6M2 17h6M16 17h6"/>',
  sentry: '<rect x="7" y="7" width="9" height="6" rx="1"/><path d="M16 9h6M16 11h5M11 13v3M11 16l-5 5M11 16l5 5M11 16v5"/>',
  dogs: '<ellipse cx="12" cy="16" rx="4" ry="3.5"/><ellipse cx="6" cy="10" rx="1.8" ry="2.4"/><ellipse cx="18" cy="10" rx="1.8" ry="2.4"/><ellipse cx="9.5" cy="6" rx="1.6" ry="2.2"/><ellipse cx="14.5" cy="6" rx="1.6" ry="2.2"/>',
  gunner: '<path d="M3 5h18M12 5v2"/><path d="M6 10c0-2 2-3 5-3h3c3 0 4 2 4 4s-1 3-4 3h-6c-1 0-2-2-2-4z"/><circle cx="12" cy="19" r="3"/><path d="M12 15v2M12 21v2M8 19h2M14 19h2"/>',
  // Equipment.
  frag: '<circle cx="12" cy="14" r="6"/><path d="M10 8V6h4v2M14 6l3-2M12 11v6M9 14h6"/>',
  semtex: '<rect x="6" y="8" width="12" height="10" rx="2"/><path d="M9 8V6h6v2"/><circle cx="12" cy="13" r="2"/><path d="M4 20l2-2M20 20l-2-2"/>',
  molotov: '<path d="M10 9h4v3l2 3v6H8v-6l2-3z"/><path d="M12 9V6M12 6c-2-1-1-3 0-4 1 1 2 3 0 4z"/>',
  tknife: '<path d="M4 20l9-9M13 11l7-7-1 5-4 4z"/><path d="M4 20l2-4 2 2z"/>',
  flash: '<rect x="9" y="7" width="6" height="12" rx="2"/><path d="M12 4V2M5 6L3 4M19 6l2-2M4 12H2M22 12h-2"/>',
  stun: '<circle cx="12" cy="12" r="2"/><path d="M12 6a6 6 0 1 1-6 6M12 2a10 10 0 1 1-10 10"/>',
  smoke: '<path d="M6 18a4 4 0 0 1 0-8 5 5 0 0 1 9-2 4 4 0 0 1 3 7 3 3 0 0 1-3 3z"/><path d="M8 22h8"/>',
  // Modes.
  tdm: '<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M7 15l-3 3 2 2 3-3M17 15l3 3-2 2-3-3"/>',
  ffa: '<path d="M6 10a6 6 0 0 1 12 0c0 3-2 4-2 6H8c0-2-2-3-2-6z"/><path d="M9 19h6M10 11h.01M14 11h.01"/>',
  dom: '<path d="M6 21V3M6 4h11l-3 4 3 4H6"/>',
  kc: '<rect x="7" y="4" width="10" height="15" rx="3"/><circle cx="12" cy="7.5" r="1"/><path d="M10 12h4M10 15h4"/>',
  // Weapon classes (kill feed): side profiles, muzzle to the right.
  ar: '<path d="M2 10h15l3-1h2v3h-5l-1 2h-3l-1 4H9l1-4H6l-2 3H2z"/><path d="M12 14l-1 3"/>',
  smg: '<path d="M4 9h12l2-1h3v3h-5v2h-3l-1 5H9l1-5H6v-2H4z"/>',
  lmg: '<path d="M2 9h16l4-1v3h-6l-1 1h-4v2H8l-1 3H5l1-3H2z"/><rect x="9" y="12" width="4" height="4"/><path d="M15 12l2 4M19 12l-1 4"/>',
  shotgun: '<path d="M2 10h20v2H11l-1 1H7l-2 4H3l1-4H2z"/><path d="M12 12h6v2h-6z"/>',
  sniper: '<path d="M1 11h21v2H10l-2 2H5l-2 3H1l1-4z"/><rect x="8" y="7" width="7" height="3" rx="1"/><path d="M10 10v1M13 10v1"/>',
  marksman: '<path d="M1 11h20v2H11l-1 3H8l1-3H5l-2 3H1l1-4z"/><rect x="8" y="8" width="5" height="2" rx="1"/>',
  pistol: '<path d="M5 8h14v3h-8l-1 2H8l-1 5H4l1-5z"/>',
  knife: '<path d="M3 15l12-8c3-2 5-2 6-1-2 4-6 7-11 9z"/><path d="M3 15l-1 2 3 1 1-2"/>',
  grenade: '<circle cx="12" cy="14" r="6"/><path d="M10 8V6h4v2M14 6l3-2M12 11v6M9 14h6"/>',
  barrel: '<path d="M12 3l2 5 5-2-2 5 5 2-5 2 2 5-5-2-2 5-2-5-5 2 2-5-5-2 5-2-2-5 5 2z"/>',
  headshot: '<path d="M6 13a6 6 0 1 1 12 0v3h-2v3H8v-3H6z"/><circle cx="9.5" cy="12" r="1.5"/><circle cx="14.5" cy="12" r="1.5"/><path d="M11 19v-2M13 19v-2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
};

export function icon(name: string, cls = 'zh-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`;
}
