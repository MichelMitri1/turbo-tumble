/**
 * The game server's default port, on its own so the card/ball/FPS pages can
 * build the server URL without importing the racing protocol (which pulls in
 * every kart track at module load).
 */
export const DEFAULT_SERVER_PORT = 2567;
