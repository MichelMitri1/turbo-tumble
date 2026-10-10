import type { Client, Room } from '@colyseus/core';
import ndc, { type DataChannel, type PeerConnection } from 'node-datachannel';

/**
 * The fast lane: a WebRTC data channel per player that is UNRELIABLE and UNORDERED — like
 * the UDP that real shooters / racers use. A lost packet is simply skipped, instead of
 * stalling everything behind it the way TCP (WebSocket) does on Wi-Fi.
 *
 * Only the high-rate stream rides it (snapshots down, inputs up, pings); lobby, events and
 * chat stay on the reliable WebSocket. Signalling goes over the room's WebSocket. Until the
 * channel opens — or if it can't (a host that only allows HTTP, a strict firewall) —
 * everything falls back to the WebSocket, so nothing breaks.
 *
 * Frame: [kind u8 (0 JSON, 1 bytes)][seq u32][type length u8][type utf8][payload]
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
export const FASTLANE_DISABLED = /^(1|true|yes)$/i.test(process.env.NO_FASTLANE ?? '');
/** Every player's lane shares this one UDP port (forward it on your router to host for friends outside). */
export const FASTLANE_PORT = Number(process.env.FASTLANE_PORT ?? 2568);

type Handler = (client: Client, payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
type MsgType = string | number;
const key = (t: MsgType) => (typeof t === 'number' ? `#${t}` : t);
const unkey = (k: string): MsgType => (k.startsWith('#') ? Number(k.slice(1)) : k);

interface Peer {
  pc: PeerConnection;
  dc: DataChannel | null;
  seqOut: Map<string, number>;
  seqIn: Map<string, number>;
  /** Lane messages received since the last report to the client. */
  rx: number;
  /** The client confirmed it is receiving our lane messages, until (ms). */
  healthyUntil: number;
}

/** Bigger messages go over the WebSocket (a lost fragment would lose the whole message). */
const MAX_LANE_BYTES = 8 * 1024;
const PROBE = '~p';

export function frame(kind: 0 | 1, seq: number, type: string, body: Uint8Array): Uint8Array {
  const t = enc.encode(type);
  const out = new Uint8Array(6 + t.length + body.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, seq >>> 0);
  out[5] = t.length;
  out.set(t, 6);
  out.set(body, 6 + t.length);
  return out;
}
export function unframe(buf: Uint8Array): { kind: number; seq: number; type: string; body: Uint8Array } | null {
  if (buf.length < 6) return null;
  const tl = buf[5]!;
  if (buf.length < 6 + tl) return null;
  return { kind: buf[0]!, seq: new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(1), type: dec.decode(buf.subarray(6, 6 + tl)), body: buf.subarray(6 + tl) };
}

export class FastLane {
  private peers = new Map<string, Peer>();
  private handlers = new Map<string, Handler>();
  /** Incoming types where only the newest matters (out-of-date ones are dropped). */
  private latestOnly = new Set<string>();

  private timer: ReturnType<typeof setInterval>;

  constructor(private room: Room) {
    // Health: each side reports (over the WebSocket) how many lane messages it got; the lane is
    // only used while the other side keeps confirming. A path that opens but drops everything
    // (some hosts / NATs) falls back to the WebSocket within a couple of seconds.
    room.onMessage('rtc:rx', (c, m: { n?: unknown }) => {
      const p = this.peers.get(c.sessionId);
      if (p && typeof m?.n === 'number' && m.n > 0) p.healthyUntil = Date.now() + 2500;
    });
    this.timer = setInterval(() => {
      for (const c of this.room.clients) {
        const p = this.peers.get(c.sessionId);
        if (!p?.dc?.isOpen()) continue;
        c.send('rtc:rx', { n: p.rx });
        p.rx = 0;
        this.raw(p, frame(1, 0, PROBE, new Uint8Array(0)));
      }
    }, 500);
    room.onMessage('rtc:offer', (c, m: { sdp?: unknown; type?: unknown }) => this.offer(c, m));
    room.onMessage('rtc:ice', (c, m: { c?: unknown; mid?: unknown }) => {
      const p = this.peers.get(c.sessionId);
      if (p && typeof m?.c === 'string' && typeof m.mid === 'string') {
        try {
          p.pc.addRemoteCandidate(m.c, m.mid);
        } catch {
          /* a bad candidate just doesn't connect */
        }
      }
    });
  }

  /** A message that may come by either path (WebSocket or the lane). */
  on(type: MsgType, handler: Handler, opts: { latestOnly?: boolean } = {}): void {
    this.room.onMessage(type, handler);
    this.handlers.set(key(type), handler);
    if (opts.latestOnly) this.latestOnly.add(key(type));
  }

  isOpen(client: Client): boolean {
    const p = this.peers.get(client.sessionId);
    return !!p && this.usable(p);
  }

  private usable(p: Peer): boolean {
    return !!p.dc?.isOpen() && Date.now() < p.healthyUntil && p.dc.bufferedAmount() < 64 * 1024;
  }

  private raw(p: Peer, buf: Uint8Array): boolean {
    try {
      return !!p.dc?.sendMessageBinary(buf);
    } catch {
      return false;
    }
  }

  private lane(client: Client, kind: 0 | 1, type: MsgType, body: Uint8Array): boolean {
    const p = this.peers.get(client.sessionId);
    if (!p || !this.usable(p) || body.length > MAX_LANE_BYTES) return false;
    const k = key(type);
    const seq = (p.seqOut.get(k) ?? 0) + 1;
    p.seqOut.set(k, seq);
    return this.raw(p, frame(kind, seq, k, body));
  }

  /** JSON payload: the lane if it's healthy (and the message small), else the WebSocket. */
  send(client: Client, type: MsgType, payload: unknown): void {
    if (!this.lane(client, 0, type, enc.encode(JSON.stringify(payload)))) client.send(type, payload);
  }

  sendBytes(client: Client, type: MsgType, bytes: Uint8Array): void {
    if (!this.lane(client, 1, type, bytes)) client.sendBytes(type, bytes);
  }

  broadcast(type: MsgType, payload: unknown, except?: Client): void {
    for (const c of this.room.clients) if (c !== except) this.send(c, type, payload);
  }

  private offer(c: Client, m: { sdp?: unknown; type?: unknown }): void {
    if (FASTLANE_DISABLED || typeof m?.sdp !== 'string' || m.type !== 'offer') return;
    this.drop(c.sessionId);
    let pc: PeerConnection;
    try {
      pc = new ndc.PeerConnection(`lane-${c.sessionId}`, { iceServers: ['stun:stun.l.google.com:19302'], enableIceUdpMux: true, portRangeBegin: FASTLANE_PORT, portRangeEnd: FASTLANE_PORT });
    } catch (e) {
      console.warn('[fastlane] unavailable:', e);
      return;
    }
    const peer: Peer = { pc, dc: null, seqOut: new Map(), seqIn: new Map(), rx: 0, healthyUntil: 0 };
    this.peers.set(c.sessionId, peer);
    pc.onLocalDescription((sdp, type) => c.send('rtc:answer', { sdp, type }));
    pc.onLocalCandidate((cand, mid) => c.send('rtc:ice', { c: cand, mid }));
    pc.onDataChannel((dc) => {
      peer.dc = dc;
      dc.onMessage((msg) => this.receive(c, peer, msg));
      dc.onClosed(() => {
        if (peer.dc === dc) peer.dc = null;
      });
    });
    pc.onStateChange((s) => {
      if (s === 'failed' || s === 'closed') peer.dc = null;
    });
    try {
      pc.setRemoteDescription(m.sdp, 'offer');
    } catch {
      this.drop(c.sessionId);
    }
  }

  private receive(c: Client, peer: Peer, msg: string | Buffer | ArrayBuffer): void {
    if (typeof msg === 'string') return;
    const buf = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength);
    const f = unframe(buf);
    if (!f) return;
    peer.rx++;
    const h = this.handlers.get(f.type);
    if (!h) return;
    if (this.latestOnly.has(f.type)) {
      if (f.seq <= (peer.seqIn.get(f.type) ?? 0)) return;
      peer.seqIn.set(f.type, f.seq);
    }
    // The client must still be in the room.
    if (!this.room.clients.some((x) => x === c)) return;
    try {
      h(c, f.kind === 0 ? JSON.parse(dec.decode(f.body)) : f.body);
    } catch (e) {
      console.warn('[fastlane] bad message', f.type, e);
    }
    void unkey;
  }

  drop(sessionId: string): void {
    const p = this.peers.get(sessionId);
    if (!p) return;
    this.peers.delete(sessionId);
    try {
      p.dc?.close();
      p.pc.close();
    } catch {
      /* already gone */
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
