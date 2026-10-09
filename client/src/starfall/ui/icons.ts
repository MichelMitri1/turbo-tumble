/** Inline SVG icons for the HUD buttons (chunky, outlined, currentColor fill). */
const svg = (body: string) => `<svg viewBox="0 0 48 48" fill="none" stroke="#0b0b14" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICON = {
  use: svg('<path d="M18 26V10a3 3 0 0 1 6 0v12m0-4a3 3 0 0 1 6 0v4m0-2a3 3 0 0 1 6 0v4m0 0a3 3 0 0 1 6 0v8c0 7-5 12-12 12h-2c-5 0-8-2-11-6l-6-9a3 3 0 0 1 5-3l4 4" fill="#fff"/>'),
  report: svg('<path d="M8 20h8l18-10v28L16 28H8z" fill="#fff"/><path d="M14 28l3 10h6l-3-10" fill="#fff"/><path d="M39 18c2 2 2 8 0 10" />'),
  kill: svg('<path d="M10 38l18-18 4 4-18 18-6 2z" fill="#d9e2ec"/><path d="M28 20l8-8c2-2 6 0 4 4l-8 8z" fill="#7a4a25"/><path d="M26 22l4 4"/>'),
  vent: svg('<rect x="6" y="12" width="36" height="24" rx="4" fill="#9aa6b2"/><path d="M12 18h24M12 24h24M12 30h24"/>'),
  sabotage: svg('<path d="M24 6l20 36H4z" fill="#ffd23f"/><path d="M24 18v12M24 35v1"/>'),
  map: svg('<path d="M6 12l12-4 12 4 12-4v28l-12 4-12-4-12 4z" fill="#fff"/><path d="M18 8v28M30 12v28"/>'),
  admin: svg('<rect x="6" y="10" width="36" height="24" rx="4" fill="#4cf1ff"/><path d="M14 18h8v8h-8zM28 16h6v12h-6z" fill="#fff"/><path d="M18 34l-4 6h20l-4-6"/>'),
  cams: svg('<rect x="6" y="14" width="26" height="20" rx="4" fill="#fff"/><path d="M32 20l10-6v20l-10-6z" fill="#fff"/><circle cx="14" cy="24" r="3" fill="#e8262f"/>'),
  vitals: svg('<path d="M24 40S6 29 6 17a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 12-18 23-18 23z" fill="#ff6b8a"/><path d="M10 24h8l3-6 4 12 3-6h10" stroke="#fff"/>'),
  emergency: svg('<ellipse cx="24" cy="30" rx="16" ry="8" fill="#5f6b77"/><ellipse cx="24" cy="26" rx="10" ry="6" fill="#e0242c"/>'),
  chat: svg('<path d="M8 10h32a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H22l-10 8v-8H8a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2z" fill="#fff"/><path d="M14 20h20M14 26h12"/>'),
  gear: svg('<circle cx="24" cy="24" r="7" fill="#fff"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M10 38l5-5M33 15l5-5"/>'),
  reactor: svg('<circle cx="24" cy="24" r="16" fill="#5fd6ff"/><circle cx="24" cy="24" r="5" fill="#fff"/><path d="M24 8v8M24 32v8M8 24h8M32 24h8"/>'),
  o2: svg('<circle cx="24" cy="26" r="14" fill="#9fe6ff"/><text x="24" y="31" font-size="14" text-anchor="middle" fill="#0b0b14" stroke="none" font-family="Arial Black">O2</text>'),
  lights: svg('<path d="M24 6a12 12 0 0 0-7 22v6h14v-6a12 12 0 0 0-7-22z" fill="#ffe680"/><path d="M18 40h12"/>'),
  comms: svg('<path d="M24 22v20M16 42h16" /><circle cx="24" cy="18" r="4" fill="#fff"/><path d="M14 10a14 14 0 0 0 0 16M34 10a14 14 0 0 1 0 16M9 6a20 20 0 0 0 0 24M39 6a20 20 0 0 1 0 24"/>'),
  seismic: svg('<path d="M4 26h8l4-12 6 22 6-18 4 8h12" stroke-width="4"/>'),
  door: svg('<rect x="12" y="6" width="24" height="36" rx="2" fill="#d9e2ec"/><circle cx="30" cy="25" r="2" fill="#0b0b14"/>'),
};
