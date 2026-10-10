import type { Room } from '@colyseus/sdk';

/**
 * Client side of the fast lane (see server/src/fastlane.ts): an unreliable, unordered
 * WebRTC data channel next to the room's WebSocket. High-rate messages (snapshots, inputs,
 * pings) use it when it's open; otherwise — or if WebRTC can't connect — they go over the
 * WebSocket as before. Snapshot types are "latest only": a late, out-of-date one is dropped.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
type MsgType = string | number;
const key = (t: MsgType) => (typeof t === 'number' ? `#${t}` : t);
type Handler = (payload: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

function frame(kind: 0 | 1, seq: number, type: string, body: Uint8Array): Uint8Array {
  const t = enc.encode(type);
  const out = new Uint8Array(6 + t.length + body.length);
  out[0] = kind;
  new DataView(out.buffer).setUint32(1, seq >>> 0);
  out[5] = t.length;
  out.set(t, 6);
  out.set(body, 6 + t.length);
  return out;
}

/** Off with ?tcp (for comparing). */
const DISABLED = typeof location !== 'undefined' && new URLSearchParams(location.search).has('tcp');

export class FastLane {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private handlers = new Map<string, Handler>();
  private latest = new Map<string, number>();
  private latestOnly = new Set<string>();
  private seqOut = new Map<string, number>();
  private closed = false;

  constructor(private room: Room) {
    room.onMessage('rtc:answer', (m: { sdp: string; type: RTCSdpType }) => void this.pc?.setRemoteDescription({ sdp: m.sdp, type: m.type }).catch(() => undefined));
    room.onMessage('rtc:ice', (m: { c: string; mid: string }) => void this.pc?.addIceCandidate({ candidate: m.c, sdpMid: m.mid }).catch(() => undefined));
    if (!DISABLED && typeof RTCPeerConnection !== 'undefined') void this.connect();
  }

  /** Is the fast path up? */
  get open(): boolean {
    return this.dc?.readyState === 'open';
  }

  private async connect(): Promise<void> {
    try {
      const pc = (this.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }));
      const dc = (this.dc = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => this.receive(e.data as ArrayBuffer);
      pc.onicecandidate = (e) => {
        if (e.candidate && !this.closed) this.room.send('rtc:ice', { c: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.room.send('rtc:offer', { sdp: offer.sdp, type: 'offer' });
    } catch {
      this.pc = null;
      this.dc = null;
    }
  }

  /** Listen for a message on both paths. `latestOnly`: drop ones older than the newest seen. */
  on(type: MsgType, cb: Handler, opts: { latestOnly?: boolean } = {}): () => void {
    const k = key(type);
    this.handlers.set(k, cb);
    if (opts.latestOnly) this.latestOnly.add(k);
    const off = this.room.onMessage(type, cb);
    return () => {
      if (this.handlers.get(k) === cb) this.handlers.delete(k);
      off();
    };
  }

  private receive(data: ArrayBuffer): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength < 6) return;
    const buf = new Uint8Array(data);
    const seq = new DataView(data).getUint32(1);
    const tl = buf[5]!;
    const type = dec.decode(buf.subarray(6, 6 + tl));
    const h = this.handlers.get(type);
    if (!h) return;
    if (this.latestOnly.has(type)) {
      if (seq <= (this.latest.get(type) ?? 0)) return;
      this.latest.set(type, seq);
    }
    const body = buf.subarray(6 + tl);
    h(buf[0] === 0 ? JSON.parse(dec.decode(body)) : body);
  }

  send(type: MsgType, payload: unknown): void {
    if (this.open && this.dc!.bufferedAmount < 64 * 1024) {
      const k = key(type);
      const seq = (this.seqOut.get(k) ?? 0) + 1;
      this.seqOut.set(k, seq);
      this.dc!.send(frame(0, seq, k, enc.encode(JSON.stringify(payload))) as Uint8Array<ArrayBuffer>);
      return;
    }
    this.room.send(type, payload);
  }

  sendBytes(type: MsgType, bytes: Uint8Array): void {
    if (this.open && this.dc!.bufferedAmount < 64 * 1024) {
      const k = key(type);
      const seq = (this.seqOut.get(k) ?? 0) + 1;
      this.seqOut.set(k, seq);
      this.dc!.send(frame(1, seq, k, bytes) as Uint8Array<ArrayBuffer>);
      return;
    }
    this.room.sendBytes(type, bytes);
  }

  close(): void {
    this.closed = true;
    try {
      this.dc?.close();
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.dc = null;
    this.pc = null;
  }
}
