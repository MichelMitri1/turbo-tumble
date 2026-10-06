import type { Card, CardType, DeckId } from './cards';
import type { Effect, GameEvent, KittensEngine, Prompt } from './engine';

/** What one player is allowed to see. Bots and the UI both work from this. */
export interface View {
  you: string;
  deck: DeckId;
  phase: KittensEngine['phase'];
  current: string;
  turns: number;
  players: Array<{ id: string; name: string; bot: boolean; avatar: number; alive: boolean; count: number; godcat: boolean; connected: boolean }>;
  hand: Card[];
  drawCount: number;
  kittens: number;
  discardTop: Card | null;
  discardCount: number;
  godcatOnMat: boolean;
  pending: { by: string; cards: Card[]; effect: Effect; as?: CardType; nopes: number; left: number; passed: boolean } | null;
  /** Your prompt in full; someone else's as { k, player } only. */
  prompt: (Prompt & { mine: true; fanGod?: number; fanCount?: number }) | { mine: false; k: Prompt['k']; player: string; left: number } | null;
  promptLeft: number;
  /** Draw-pile cards you know: index 0 = top. */
  known: Array<{ index: number; card: Card }>;
  winner: string | null;
  turnLeft: number;
  time: number;
}

export function viewFor(e: KittensEngine, you: string): View {
  const me = e.players.find((p) => p.id === you);
  const known: View['known'] = [];
  if (me) e.draw.forEach((c, index) => me.knows.has(c.id) && known.push({ index, card: c }));
  const pr = e.prompt;
  let prompt: View['prompt'] = null;
  const left = (d: number) => (d ? Math.max(0, d - e.time) : 0);
  if (pr) {
    if (pr.player === you) {
      const extra = pr.k === 'fan' ? { fanCount: pr.order.length, fanGod: pr.order.findIndex((id) => e.player(pr.from).hand.find((c) => c.id === id)?.type === 'godcat') } : {};
      // Fan prompts show only card backs: strip the ids.
      prompt = pr.k === 'fan' ? ({ ...pr, order: pr.order.map(() => 0), mine: true, ...extra } as View['prompt']) : ({ ...pr, mine: true } as View['prompt']);
    } else prompt = { mine: false, k: pr.k, player: pr.player, left: left(pr.deadline) };
  }
  return {
    you,
    deck: e.deckId,
    phase: e.phase,
    current: e.currentPlayer.id,
    turns: e.turns,
    players: e.players.map((p) => ({ id: p.id, name: p.name, bot: p.bot, avatar: p.avatar, alive: p.alive, count: p.hand.length, godcat: p.hand.some((c) => c.type === 'godcat'), connected: p.connected })),
    hand: me ? [...me.hand] : [],
    drawCount: e.draw.length,
    kittens: e.kittensInPile(),
    discardTop: e.discard[e.discard.length - 1] ?? null,
    discardCount: e.discard.length,
    godcatOnMat: Boolean(e.mat.godcat),
    pending: e.pending ? { by: e.pending.by, cards: e.pending.cards, effect: e.pending.effect, as: e.pending.as, nopes: e.pending.nopes, left: left(e.pending.deadline), passed: e.pending.passed.includes(you) } : null,
    prompt,
    promptLeft: pr ? left(pr.deadline) : 0,
    known,
    winner: e.winner,
    turnLeft: left(e.turnDeadline),
    time: e.time,
  };
}

/** Hide the private parts of an event from players who shouldn't see them. */
export function redact(ev: GameEvent, you: string): GameEvent {
  if (!ev.vis || ev.vis.includes(you)) return ev;
  const o = { ...ev } as Record<string, unknown>;
  delete o.card;
  if (ev.k === 'future') delete o.cards;
  if (ev.k === 'insert') delete o.index;
  return o as GameEvent;
}
