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
  // Modes.
  tdm: '<path d="M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M7 15l-3 3 2 2 3-3M17 15l3 3-2 2-3-3"/>',
  ffa: '<path d="M6 10a6 6 0 0 1 12 0c0 3-2 4-2 6H8c0-2-2-3-2-6z"/><path d="M9 19h6M10 11h.01M14 11h.01"/>',
  dom: '<path d="M6 21V3M6 4h11l-3 4 3 4H6"/>',
  kc: '<rect x="7" y="4" width="10" height="15" rx="3"/><circle cx="12" cy="7.5" r="1"/><path d="M10 12h4M10 15h4"/>',
};

export function icon(name: string, cls = 'zh-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? ''}</svg>`;
}
