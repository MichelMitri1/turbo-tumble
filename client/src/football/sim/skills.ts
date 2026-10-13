export type SkillFamily = 'touch' | 'stop' | 'feint' | 'roll' | 'step' | 'drag' | 'heel' | 'chop' | 'spin' | 'vdrag' | 'elastic' | 'flick' | 'rainbow' | 'juggle' | 'hocus' | 'rabona';
export interface SkillStep { at: number; forward: number; lateral: number; turn: number }
export interface SkillMove { id: number; name: string; stars: number; family: SkillFamily; duration: number; steps: SkillStep[]; lift: number; description: string }

// Twenty playable moves in each tier. Left/right exits and chained moves have
// their own trajectories, not just alternative labels on the same animation.
const SETS: Array<Array<[string, SkillFamily]>> = [
  [
    ['Knock-on', 'touch'], ['Drag back', 'drag'], ['Step-over', 'step'], ['Ball roll', 'roll'],
    ['Body feint left', 'feint'], ['Body feint right', 'feint'], ['Sole stop', 'stop'], ['Inside touch left', 'touch'], ['Inside touch right', 'touch'], ['Outside touch left', 'touch'],
    ['Outside touch right', 'touch'], ['Pull back left', 'drag'], ['Pull back right', 'drag'], ['Stop and go', 'stop'], ['Sole shuffle left', 'roll'], ['Sole shuffle right', 'roll'],
    ['Shoulder drop left', 'feint'], ['Shoulder drop right', 'feint'], ['Half-turn shield', 'spin'], ['Forward sole push', 'touch'],
  ],
  [
    ['Flick up', 'flick'], ['Double step-over', 'step'], ['Reverse step-over', 'step'], ['Heel-to-heel', 'heel'], ['Ball roll left exit', 'roll'], ['Ball roll right exit', 'roll'],
    ['Drag back half-turn', 'drag'], ['Fake shot left', 'chop'], ['Fake shot right', 'chop'], ['Cruyff turn left', 'chop'], ['Cruyff turn right', 'chop'], ['V-pull left', 'vdrag'],
    ['V-pull right', 'vdrag'], ['Inside-out touch left', 'elastic'], ['Inside-out touch right', 'elastic'], ['Lateral heel tap', 'heel'], ['Stop-turn burst', 'stop'],
    ['Toe lift left', 'flick'], ['Toe lift right', 'flick'], ['Sole drag spin', 'spin'],
  ],
  [
    ['Roulette', 'spin'], ['Reverse roulette', 'spin'], ['Three-touch roulette', 'spin'], ['Heel chop left', 'chop'], ['Heel chop right', 'chop'], ['Triple step-over', 'step'],
    ['Step-over inside exit', 'step'], ['Step-over outside exit', 'step'], ['Ball roll to heel flick', 'heel'], ['Double V-pull', 'vdrag'], ['Lateral drag to burst', 'drag'],
    ['Scoop turn left', 'chop'], ['Scoop turn right', 'chop'], ['Feint and diagonal exit', 'feint'], ['Heel-to-heel diagonal', 'heel'], ['Backheel pivot', 'heel'],
    ['Pop and sprint', 'flick'], ['Juggle and run', 'juggle'], ['Sole spin left', 'spin'], ['Sole spin right', 'spin'],
  ],
  [
    ['Rainbow flick', 'rainbow'], ['Elastico left', 'elastic'], ['Elastico right', 'elastic'], ['Reverse elastico left', 'elastic'], ['Reverse elastico right', 'elastic'],
    ['Hocus pocus', 'hocus'], ['Rabona fake left', 'rabona'], ['Rabona fake right', 'rabona'], ['Heel-to-ball roll', 'heel'], ['Ball roll scoop left', 'chop'],
    ['Ball roll scoop right', 'chop'], ['Spin and flick', 'flick'], ['Sombrero flick forward', 'rainbow'], ['Sombrero flick left', 'rainbow'], ['Sombrero flick right', 'rainbow'],
    ['Double touch spin', 'spin'], ['Drag-back fake exit', 'drag'], ['Step-over heel escape', 'heel'], ['L-turn left', 'vdrag'], ['L-turn right', 'vdrag'],
  ],
  [
    ['Advanced rainbow', 'rainbow'], ['Double elastico left', 'elastic'], ['Double elastico right', 'elastic'], ['Triple elastico', 'elastic'], ['Reverse hocus pocus', 'hocus'],
    ['Elastico to scoop', 'chop'], ['Rabona heel escape', 'rabona'], ['Heel flick turn', 'flick'], ['Around the world', 'juggle'], ['Reverse around the world', 'juggle'],
    ['Juggle rainbow exit', 'rainbow'], ['Sombrero half-turn', 'rainbow'], ['Ball roll to double step-over', 'step'], ['Roulette to heel chop', 'spin'], ['Heel spin left', 'heel'],
    ['Heel spin right', 'heel'], ['V-drag elastico', 'vdrag'], ['Hocus pocus burst', 'hocus'], ['Fake rabona spin', 'rabona'], ['Triple-touch diagonal escape', 'touch'],
  ],
];
const LEGACY: Record<string, number> = { 'Knock-on': 1, 'Drag back': 2, 'Step-over': 3, 'Flick up': 4, 'Rainbow flick': 5, Roulette: 6, 'Ball roll': 7 };
const DESCRIPTIONS: Record<SkillFamily, string> = {
  touch: 'Push the ball into a new lane and accelerate after it.', stop: 'Plant over the ball, pause, then change pace or direction.', feint: 'Show one direction with the body and leave in the other.',
  roll: 'Drag the ball across with the sole, then take the exit touch.', step: 'Circle the foot across the ball before a sharp change of lane.', drag: 'Pull the ball backwards under the sole and turn away.',
  heel: 'Use alternating heel touches to disguise the next direction.', chop: 'Cut the ball across the standing leg and turn sharply.', spin: 'Rotate around the ball while carrying it past the defender.',
  vdrag: 'Pull back, then push diagonally out in a V or L shape.', elastic: 'Show an outside touch then snap back inside.', flick: 'Lift the ball over a leg and run onto the dropping ball.',
  rainbow: 'Roll and lift the ball over your head into the exit lane.', juggle: 'Pop the ball up, circle around it, and chase the drop.', hocus: 'Wrap a heel touch around the standing leg and reverse the exit.', rabona: 'Cross the kicking leg behind, disguise the touch, then turn away.',
};

function trajectory(family: SkillFamily, side: number, width: number, burst: number, reverse: boolean, double: boolean): SkillStep[] {
  const point = (at: number, forward: number, lateral: number, turn = 0): SkillStep => ({ at, forward, lateral: lateral * side, turn: turn * side });
  const w = width, b = burst, r = reverse ? -1 : 1;
  const paths: Record<SkillFamily, SkillStep[]> = {
    touch: [point(0, 0, 0), point(0.3, 0.35, -w * 0.1), point(1, b, w * 0.5)],
    stop: [point(0, 0, 0), point(0.5, -0.12, 0), point(1, reverse ? -b * 0.5 : b, w * 0.35, reverse ? Math.PI : 0.2)],
    feint: [point(0, 0, 0), point(0.4, 0.15, -w * 0.4, -0.25), point(1, b, w, 0.35)],
    roll: [point(0, 0, 0), point(0.65, 0.05, w, 0.12), point(1, b * 0.5, w * 1.2, 0.2)],
    step: [point(0, 0, 0), point(0.25, 0.25, -w * 0.25, -0.3), point(0.55, 0.45, double ? w * 0.2 : -w * 0.1, 0.2), point(1, b, w, 0.4)],
    drag: [point(0, 0, 0), point(0.55, -w * 0.7, 0, 0.3), point(1, -b * 0.45, w, reverse ? Math.PI : Math.PI * 0.7)],
    heel: [point(0, 0, 0), point(0.3, -0.25, -w * 0.2, -0.1), point(0.6, 0.3, w * 0.4, 0.2), point(1, b, w * 0.65, reverse ? Math.PI : 0.25)],
    chop: [point(0, 0, 0), point(0.4, 0.6, -w * 0.1, -0.2), point(0.65, 0.45, w, Math.PI * 0.45), point(1, reverse ? -b * 0.5 : b * 0.3, w * 1.4, reverse ? Math.PI : Math.PI * 0.55)],
    spin: [point(0, 0, 0), point(0.3, 0.4, -w * 0.25, Math.PI * 0.6 * r), point(0.65, 0.7, w * 0.5, Math.PI * 1.4 * r), point(1, b * 0.7, w, Math.PI * 2 * r)],
    vdrag: [point(0, 0, 0), point(0.4, -w * 0.65, 0, -0.2), point(0.7, -0.1, w * 0.6, 0.4), point(1, b * 0.6, w * 1.2, 0.65)],
    elastic: [point(0, 0, 0), point(0.3, 0.15, -w * r * 0.7, -0.4 * r), point(0.65, 0.45, w * r * 0.5, 0.35 * r), point(1, b * 0.7, w * r, 0.5 * r)],
    flick: [point(0, 0, 0), point(0.4, 0.2, -w * 0.1), point(1, b * 0.8, w * 0.6, reverse ? Math.PI * 0.7 : 0.2)],
    rainbow: [point(0, 0, 0), point(0.35, -0.2, 0, -0.2), point(1, b, w * 0.5, reverse ? Math.PI : 0.2)],
    juggle: [point(0, 0, 0), point(0.3, 0.1, -w * 0.25, 0.5 * r), point(0.65, 0.3, w * 0.4, Math.PI * r), point(1, b * 0.65, w * 0.75, Math.PI * 2 * r)],
    hocus: [point(0, 0, 0), point(0.25, -0.25, -w * 0.6, -0.3), point(0.55, -0.05, w * 0.2, 0.3), point(0.75, 0.2, -w * 0.15, -0.1), point(1, b * 0.7, w * r, 0.6 * r)],
    rabona: [point(0, 0, 0), point(0.4, 0.2, -w * 0.3, -0.45), point(0.7, -0.1, w * 0.35, Math.PI * 0.5), point(1, -b * 0.25, w, reverse ? Math.PI * 1.5 : Math.PI * 0.85)],
  };
  const path = paths[family];
  if (double && family === 'elastic') path.splice(2, 0, point(0.48, 0.3, w * r * 0.5), point(0.6, 0.4, -w * r * 0.5));
  return path;
}
let next = 8;
export const SKILL_SETS = SETS.map((rows, tier) => ({ stars: tier + 1, moves: rows.map(([name, family], index): SkillMove => {
  const id = LEGACY[name] ?? next++;
  const side = /left/i.test(name) ? -1 : 1;
  const width = 0.6 + tier * 0.15 + (index % 5) * 0.14;
  const burst = 1.1 + tier * 0.2 + Math.floor(index / 5) * 0.18;
  return { id, name, stars: tier + 1, family, duration: 0.4 + tier * 0.075 + (index % 4) * 0.045, steps: trajectory(family, side, width, burst, /reverse|half-turn|cruyff/i.test(name), /double|triple/i.test(name)), lift: family === 'rainbow' ? 6.2 : family === 'juggle' ? 4.8 : family === 'flick' ? 4.0 : 0, description: DESCRIPTIONS[family] };
}) }));
export const SKILLS = SKILL_SETS.flatMap((s) => s.moves);
export const SKILL_BY_ID = new Map(SKILLS.map((s) => [s.id, s]));
export const SKILL_NAMES = Array.from({ length: 101 }, (_, i) => SKILL_BY_ID.get(i)?.name ?? '');

export function skillPosition(move: SkillMove, progress: number): SkillStep {
  const t = Math.max(0, Math.min(1, progress));
  let a = move.steps[0]!, b = move.steps.at(-1)!;
  for (let i = 1; i < move.steps.length; i++) if (move.steps[i]!.at >= t) { a = move.steps[i - 1]!; b = move.steps[i]!; break; }
  const u = Math.max(0, Math.min(1, (t - a.at) / Math.max(0.001, b.at - a.at)));
  const k = u * u * (3 - 2 * u);
  return { at: t, forward: a.forward + (b.forward - a.forward) * k, lateral: a.lateral + (b.lateral - a.lateral) * k, turn: a.turn + (b.turn - a.turn) * k };
}
