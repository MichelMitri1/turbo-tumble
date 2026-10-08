/**
 * Match sound: a real stadium crowd bed (CC0 recordings, see tools/football-sfx.py) that
 * swells with the danger, goal roars, "ooh"s for near misses, referee whistles, ball
 * strikes, a synthesized post clang — and a two-voice TV commentary via speechSynthesis.
 */

const FILES = ['crowd', 'goal', 'cheer', 'ooh', 'whistle', 'kick1', 'kick2'] as const;
type Sfx = (typeof FILES)[number];

export class MatchAudio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<Sfx, AudioBuffer>();
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private crowdLevel = 0.35;
  volume = 0.8;
  commentary = true;
  private voices: SpeechSynthesisVoice[] = [];
  private lastLine = 0;
  private speaking = 0;

  async init(): Promise<void> {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    await Promise.all(
      FILES.map(async (f) => {
        try {
          const res = await fetch(`/assets/football/sfx/${f}.m4a`);
          this.buffers.set(f, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* missing sound: stay quiet */
        }
      }),
    );
    const pick = () => {
      this.voices = speechSynthesis?.getVoices?.().filter((v) => v.lang.startsWith('en')) ?? [];
    };
    pick();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = pick;
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  startCrowd(): void {
    const ctx = this.ctx;
    const buf = this.buffers.get('crowd');
    if (!ctx || !buf || this.crowdSrc) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.master!);
    src.start();
    this.crowdSrc = src;
    this.crowdGain = g;
  }

  stopCrowd(): void {
    try {
      this.crowdSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.crowdSrc = null;
    this.crowdGain = null;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }

  /** 0 (quiet midfield) … 1 (attack in the box). */
  setExcitement(x: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.crowdGain) return;
    this.crowdLevel = 0.32 + x * 0.5;
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel, ctx.currentTime, 0.6);
    this.crowdSrc!.playbackRate.setTargetAtTime(0.97 + x * 0.06, ctx.currentTime, 0.8);
  }

  private play(name: Sfx, gain = 1, rate = 1, delay = 0): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start(ctx.currentTime + delay);
  }

  kick(power: number, distance = 20): void {
    const near = Math.max(0.15, 1 - distance / 90);
    this.play(Math.random() < 0.5 ? 'kick1' : 'kick2', (0.25 + power * 0.75) * near, 0.9 + Math.random() * 0.2 + (1 - power) * 0.15);
  }
  whistle(long = false): void {
    this.play('whistle', 0.7, 1);
    if (long) this.play('whistle', 0.7, 0.97, 0.42);
  }
  fullTime(): void {
    this.play('whistle', 0.7, 1);
    this.play('whistle', 0.7, 1, 0.5);
    this.play('whistle', 0.75, 0.96, 1.0);
    this.play('whistle', 0.75, 0.96, 1.3);
  }
  goal(home: boolean): void {
    this.play('goal', home ? 1 : 0.55);
  }
  cheer(): void {
    this.play('cheer', 0.5);
  }
  ooh(): void {
    this.play('ooh', 0.75);
  }

  /** Metallic clang off the woodwork. */
  post(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, a] of [
      [523, 0.3],
      [1180, 0.18],
      [2240, 0.08],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 1);
    }
    this.ooh();
  }

  /** A commentary line (dropped if one is still being spoken, unless it's important). */
  say(text: string, important = false, voice = 0): void {
    if (!this.commentary || typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (!important && (speechSynthesis.speaking || now - this.lastLine < 2500)) return;
    if (important) speechSynthesis.cancel();
    this.lastLine = now;
    const u = new SpeechSynthesisUtterance(text);
    const pool = this.voices.filter((v) => /en-GB/i.test(v.lang));
    const vs = pool.length ? pool : this.voices;
    if (vs.length) u.voice = vs[(voice + (vs.length > 1 ? 0 : 0)) % vs.length]!;
    u.rate = important ? 1.12 : 1.05;
    u.pitch = voice ? 0.9 : 1.02;
    u.volume = Math.min(1, this.volume + 0.1);
    this.speaking++;
    u.onend = () => this.speaking--;
    speechSynthesis.speak(u);
  }
}

// ---------------------------------------------------------------- commentary lines

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;

export const LINES = {
  kickoff: (home: string, away: string, stadium: string) => pick([`Welcome to ${stadium}. ${home} against ${away}, and we are under way.`, `Good evening from ${stadium}. ${home} take on ${away}. Here we go.`, `It's ${home} versus ${away}, and the referee gets us started.`]),
  secondHalf: () => pick(['And we are back under way for the second half.', 'The second half is under way.', 'Forty-five minutes left to play. Here we go again.']),
  goal: (scorer: string, team: string) => pick([`${scorer}! What a goal! ${team} score!`, `It's in! ${scorer} finds the net!`, `Goal! ${scorer} for ${team}!`, `${scorer}... scores! The crowd goes wild!`, `Oh, that is magnificent from ${scorer}!`]),
  ownGoal: (p: string) => pick([`Oh no, it's gone in off ${p}! An own goal!`, `Disaster for ${p}, that's an own goal.`]),
  save: (gk: string) => pick([`Great save by ${gk}!`, `${gk} gets down well to keep that out.`, `Superb stop from ${gk}!`, `Denied by ${gk}!`]),
  catch: (gk: string) => pick([`Comfortable for ${gk}.`, `${gk} gathers that one.`, `Straight at the keeper.`]),
  miss: () => pick(['Oh, just wide!', 'Off target.', 'That one is well over the bar.', 'So close!', 'He should have done better there.']),
  post: () => pick(['Off the woodwork!', 'It hits the post!', 'Unlucky! Rattles the frame of the goal!']),
  foul: (p: string) => pick([`Free kick. ${p} went through the back of him there.`, `The referee blows for a foul by ${p}.`, `That's a foul.`]),
  yellow: (p: string) => pick([`And ${p} goes into the book.`, `Yellow card for ${p}.`, `The referee reaches for his pocket. A booking for ${p}.`]),
  red: (p: string) => pick([`That's a second yellow, and ${p} is off!`, `Red card! ${p} has been sent off!`]),
  penalty: () => pick(['Penalty! The referee points to the spot!', "It's a penalty!", 'He has given a penalty!']),
  offside: () => pick(['The flag is up. Offside.', 'Offside, the linesman has his flag up.', 'He went too early. Offside.']),
  corner: () => pick(['Corner kick.', 'They will have a corner.', "It's out for a corner."]),
  half: (h: string, a: string, sh: number, sa: number) => `That's half time. ${h} ${sh}, ${a} ${sa}.`,
  full: (h: string, a: string, sh: number, sa: number) => (sh === sa ? `Full time, and it ends all square. ${h} ${sh}, ${a} ${sa}.` : `There's the final whistle! ${sh > sa ? h : a} win it, ${Math.max(sh, sa)} ${Math.min(sh, sa)}.`),
  tackle: (p: string) => pick([`Great tackle by ${p}.`, `Well won by ${p}.`, `${p} with a crunching challenge.`]),
  through: (p: string) => pick([`${p} is through!`, `Lovely ball in behind for ${p}.`]),
};
