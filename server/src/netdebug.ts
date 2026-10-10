import type { Client } from '@colyseus/core';

/**
 * NETDEBUG=1: every 5 s each room logs its tick timing (interval between updates, time spent
 * in an update), the input queue depth of its players, bytes sent, and the websocket send
 * backlog (bufferedAmount) — the numbers that tell lag on a fast network apart.
 */
export const NETDEBUG = /^(1|true|yes)$/i.test(process.env.NETDEBUG ?? '');

export class NetProbe {
  private last = 0;
  private gaps: number[] = [];
  private work: number[] = [];
  private queues: number[] = [];
  private bytes = 0;
  private t0 = Date.now();
  private start = 0;
  constructor(private name: string) {}
  begin(): void {
    if (!NETDEBUG) return;
    const now = performance.now();
    if (this.last) this.gaps.push(now - this.last);
    this.last = now;
    this.start = now;
  }
  end(clients: Client[]): void {
    if (!NETDEBUG) return;
    this.work.push(performance.now() - this.start);
    if (Date.now() - this.t0 < 5000) return;
    const s = (a: number[]) => (a.length ? `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} max ${Math.max(...a).toFixed(1)}` : '-');
    const buffered = clients.map((c) => ((c as unknown as { ref?: { bufferedAmount?: number } }).ref?.bufferedAmount ?? -1));
    console.log(`[net ${this.name}] tick gap ${s(this.gaps)} ms · work ${s(this.work)} ms · input queue ${s(this.queues)} · sent ${(this.bytes / 5 / 1024).toFixed(1)} KB/s · ws backlog ${buffered.join(',')} B`);
    this.gaps = [];
    this.work = [];
    this.queues = [];
    this.bytes = 0;
    this.t0 = Date.now();
  }
  queue(n: number): void {
    if (NETDEBUG) this.queues.push(n);
  }
  sent(payload: unknown): void {
    if (NETDEBUG) this.bytes += JSON.stringify(payload).length;
  }
}
