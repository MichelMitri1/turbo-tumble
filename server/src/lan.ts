import { networkInterfaces } from 'node:os';

/** `LAN=1`: a game server on the home network — snapshots every tick, LAN addresses advertised. */
export const LAN_MODE = /^(1|true|yes)$/i.test(process.env.LAN ?? '');

/** This machine's IPv4 addresses on the local network (Wi-Fi / Ethernet), best guess first. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // en0 is the Wi-Fi on a Mac; skip VPN / virtual-machine bridges where we can tell.
      if (/^(utun|vboxnet|vmnet|docker|br-|veth)/.test(name)) continue;
      out.push(a.address);
    }
  }
  const privateFirst = (ip: string) => (/^(192\.168|10\.)/.test(ip) ? 0 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 1 : 2);
  return out.sort((a, b) => privateFirst(a) - privateFirst(b));
}
