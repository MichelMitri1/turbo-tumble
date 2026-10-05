import { DEFAULT_SERVER_PORT } from '@shared/net/Protocol';

/**
 * Where the game server lives: ?server=host:port, else the page's host on :2567
 * in development, else this same origin (the server also serves the built game).
 * Kept apart from NetClient so the menu can show it without loading the SDK.
 */
export function defaultServerUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.includes('://') ? q : `ws://${q}`;
  const secure = location.protocol === 'https:';
  if (import.meta.env.DEV) return `${secure ? 'wss' : 'ws'}://${location.hostname}:${DEFAULT_SERVER_PORT}`;
  return `${secure ? 'wss' : 'ws'}://${location.host}`;
}
