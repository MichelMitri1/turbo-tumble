/** Pure simulation: bots only learn about kills they can actually see. */
import { answerKnowledge } from './knowledge';
export const SCALE = 2.4;
export const ROOMS = [
  { name: 'Bridge', x: 2, z: 2, w: 7, h: 5, color: 0x63cfff },
  { name: 'Medbay', x: 12, z: 2, w: 5, h: 5, color: 0x73efd0 },
  { name: 'Reactor', x: 20, z: 2, w: 7, h: 5, color: 0xffac61 },
  { name: 'Commons', x: 11, z: 9, w: 7, h: 5, color: 0x92a8ff },
  { name: 'Cargo', x: 2, z: 16, w: 7, h: 5, color: 0xeec878 },
  { name: 'Electrical', x: 12, z: 16, w: 5, h: 5, color: 0xe7a5ff },
  { name: 'Navigation', x: 20, z: 16, w: 7, h: 5, color: 0x63cfff },
];
export const WIDTH = 29, HEIGHT = 23;
export const GRID = Array.from({ length: HEIGHT }, () => Array<number>(WIDTH).fill(0));
function carve(x: number, z: number, w: number, h: number): void { for (let j = z; j < z + h; j++) for (let i = x; i < x + w; i++) GRID[j]![i] = 1; }
ROOMS.forEach(r => carve(r.x, r.z, r.w, r.h));
carve(5, 4, 19, 1); carve(5, 18, 19, 1); carve(5, 4, 1, 15); carve(23, 4, 1, 15); carve(14, 4, 1, 15); carve(5, 11, 19, 1);
export const at = (x: number, z: number) => GRID[Math.floor(z / SCALE)]?.[Math.floor(x / SCALE)] === 1;
export const point = (x: number, z: number) => ({ x: (x + .5) * SCALE, z: (z + .5) * SCALE });
export const CENTER = point(14, 11);
const spawn = (id: number): Pos => ({ x: CENTER.x + Math.sin(id * Math.PI / 4) * 2.7, z: CENTER.z + Math.cos(id * Math.PI / 4) * 2.7 });
export function walkable(x: number, z: number): boolean { return [-.28, .28].every(dx => [-.28, .28].every(dz => at(x + dx, z + dz))); }
export function visible(a: Pos, b: Pos): boolean { const n = Math.ceil(distance(a, b) / .25); for (let i = 1; i <= n; i++) if (!at(a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false; return true; }
export interface Pos { x: number; z: number }
export type MemoryKind='sighting'|'task'|'body'|'report'|'claim'|'contradiction';
export interface Memory { kind:MemoryKind; time:number; room:string; subject?:number; detail:string }
export const distance = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.z - b.z);
export function location(p: Pos): string { return ROOMS.find(r => p.x / SCALE >= r.x && p.x / SCALE < r.x + r.w && p.z / SCALE >= r.z && p.z / SCALE < r.z + r.h)?.name ?? 'Transit corridor'; }
export type TaskKind = 'sequence' | 'scan' | 'power' | 'swipe' | 'wires' | 'tune';
export interface Station extends Pos { name: string; room: string; kind: TaskKind; done: boolean }
export function stations(): Station[] {
  const names = ['Transmit flight log', 'Run biometric scan', 'Stabilize core', 'Authorize cargo manifest', 'Route electrical wiring', 'Align navigation beacon'];
  const kinds: TaskKind[] = ['sequence', 'scan', 'power', 'swipe', 'wires', 'tune'];
  return ROOMS.filter(r => r.name !== 'Commons').map((r, i) => ({ ...point(r.x + 1, r.z + 1), name: names[i]!, room: r.name, kind: kinds[i]!, done: false }));
}
export const VENTS = [point(7, 5), point(25, 5), point(25, 19), point(7, 19)];
export const REACTOR = point(24, 4), ELECTRICAL = point(14, 19);
const NAMES = ['You', 'Ember', 'Atlas', 'Moss', 'Violet', 'Sunny', 'Pearl', 'Coral', 'Nova', 'Slate', 'Lime', 'Rose'];
export const COLORS = [0x52d8ef, 0xf35c5c, 0x608bff, 0x58d099, 0xb18bff, 0xf2c64e, 0xe5eafa, 0xff9a7d, 0x2e4e9d, 0x68717b, 0x95df53, 0xe958a0];
export const COLOR_NAMES=['cyan','red','blue','green','purple','yellow','white','orange','navy','gray','lime','pink'];
export interface Person extends Pos { id: number; name: string; color: number; alive: boolean; impostor: boolean; bot: boolean; path: Pos[]; wait: number; target: number; yaw: number; evidence: Record<number, number>; sightings: Record<number, {room:string; time:number}>; suspicion:Record<number,number>; trust:Record<number,number>; memories:Memory[]; roomTrail:Array<{room:string;time:number}>; lastRoom:string; followTarget:number|null; followUntil:number; personality:number; tasks: number; emergency: boolean }
export interface Body extends Pos { id: number; reported: boolean }
export interface BotReply { id:number; text:string }
export type Phase = 'play' | 'meeting' | 'result';
export type Event = { type: 'meeting' | 'death' | 'sabotage' | 'result'; text: string };
export interface MatchOptions { count?:number; impostors?:number; humanCount?:number; names?:string[]; impostorIds?:number[] }
export function pathTo(a: Pos, b: Pos): Pos[] {
  const start = Math.floor(a.z / SCALE) * WIDTH + Math.floor(a.x / SCALE), goal = Math.floor(b.z / SCALE) * WIDTH + Math.floor(b.x / SCALE);
  const queue = [start], prev = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length; i++) { const cur = queue[i]!; if (cur === goal) break; const x = cur % WIDTH, z = Math.floor(cur / WIDTH); for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx!, nz = z + dz!, next = nz * WIDTH + nx; if (GRID[nz]?.[nx] !== 1 || prev.has(next)) continue; prev.set(next, cur); queue.push(next); } }
  if (!prev.has(goal)) return []; const route: Pos[] = []; let cur = goal; while (cur !== start) { route.push(point(cur % WIDTH, Math.floor(cur / WIDTH))); cur = prev.get(cur)!; } return route.reverse();
}
export class Match {
  people: Person[]; tasks = stations(); bodies: Body[] = []; phase: Phase = 'play'; elapsed = 0; cooldown = 18; sabotageCooldown = 25; sabotage: 'lights' | 'reactor' | null = null; sabotageTime = 0; meetingTime = 0; meetingReason = ''; reporter = 0; meetingBody:number|null=null; winner = ''; result = ''; events: Event[] = []; botTaskTotal = 0; localId=0; killCooldown=24; private aiClock = 0; private reportDelay = 0; private completed = new Set<string>(); private taskGoal:number;private conversationSubject:number|null=null;private lastBotSpeaker=-1;
  constructor(role: 'crew' | 'impostor', private random = Math.random, options:MatchOptions={}) {
    const count=Math.max(4,Math.min(12,options.count??8)),impCount=Math.max(1,Math.min(2,options.impostors??1));
    const chosen=options.impostorIds ? new Set(options.impostorIds) : new Set<number>();
    if(!chosen.size){if(role==='impostor')chosen.add(0);while(chosen.size<impCount){const id=role==='crew'?1+Math.floor(random()*(count-1)):Math.floor(random()*count);chosen.add(id);}}
    this.people=Array.from({length:count},(_,id)=>({...spawn(id),id,name:options.names?.[id]??NAMES[id]??`Crew ${id+1}`,color:COLORS[id%COLORS.length]!,alive:true,impostor:chosen.has(id),bot:id>=(options.humanCount??1),path:[],wait:2+random()*5,target:id%6,yaw:0,evidence:{},sightings:{},suspicion:{},trust:{},memories:[],roomTrail:[{room:'Commons',time:0}],lastRoom:'Commons',followTarget:null,followUntil:0,personality:(id*37%100)/100,tasks:0,emergency:false}));
    this.taskGoal=this.people.filter(p=>!p.impostor).length*3;
  }
  get player(): Person { return this.people[this.localId]!; }
  get progress(): number { return Math.min(1,(this.completed.size+this.botTaskTotal)/this.taskGoal); }
  move(p: Person, dx: number, dz: number): void { if (walkable(p.x + dx, p.z)) p.x += dx; if (walkable(p.x, p.z + dz)) p.z += dz; }
  kill(killer: Person, victim: Person): boolean {
    if (this.phase !== 'play' || !killer.alive || !victim.alive || !killer.impostor || victim.impostor || this.cooldown > 0 || distance(killer, victim) > 2.25 || !visible(killer, victim)) return false;
    victim.alive = false; this.bodies.push({ id: victim.id, x: victim.x, z: victim.z, reported: false }); this.cooldown = this.killCooldown; this.reportDelay = 2;
    for (const witness of this.people) if (witness.alive && witness.id !== killer.id && distance(witness, victim) < (this.sabotage === 'lights' ? 4 : 13) && visible(witness, victim) && visible(witness, killer)){witness.evidence[killer.id]=1;witness.suspicion[killer.id]=1;this.remember(witness,{kind:'sighting',time:this.elapsed,room:location(victim),subject:killer.id,detail:`saw ${killer.name} eliminate ${victim.name}`});}
    if (victim.id === 0) this.events.push({ type: 'death', text: 'You were eliminated. Finish your tasks as a ghost; your crew can still win.' }); this.checkWin(); return true;
  }
  callMeeting(reporter: Person, body?: Body): boolean {
    if (this.phase !== 'play' || !reporter.alive) return false;
    if (body ? body.reported || distance(reporter, body) > 3 || !visible(reporter, body) : reporter.emergency || distance(reporter, CENTER) > 3 || !!this.sabotage) return false;
    if (!body) reporter.emergency = true;
    this.reporter = reporter.id; this.meetingBody=body?.id??null; this.meetingReason = body ? `${reporter.name} reported ${this.people[body.id]!.name} in ${location(body)}.` : `${reporter.name} called an emergency meeting.`;
    this.remember(reporter,{kind:'report',time:this.elapsed,room:body?location(body):'Commons',subject:body?.id,detail:body?`reported ${this.people[body.id]!.name}'s body`:'called an emergency meeting'});
    this.bodies.forEach(b => b.reported = true); this.phase = 'meeting'; this.meetingTime = 60; this.events.push({ type: 'meeting', text: this.meetingReason }); return true;
  }
  discussion(): string[] {
    const bots=this.people.filter(p=>p.alive&&p.bot),reporter=this.people[this.reporter],lines:string[]=[];if(!bots.length)return lines;
    const questioner=bots.find(p=>p.id!==this.reporter)??bots[0]!;
    if(reporter?.bot){
      lines.push(`${reporter.name}: ${this.reportStatement(reporter)}`);
      if(questioner.id!==reporter.id)lines.push(`${questioner.name}: ${this.meetingBody===null?'Why did you call us? Do you have a suspect?':'Where exactly was the body? Did you see anyone leaving?'}`);
      lines.push(`${reporter.name}: ${this.reportDetail(reporter)}`);
    }else{
      lines.push(`${questioner.name}: ${reporter?.name==='You'?'The reporter called this meeting.':`${reporter?.name??'Reporter'}, you called this meeting.`} ${this.meetingBody===null?'What happened?':'Where was the body and who did you see?'}`);
      const patient=bots.find(p=>p.id!==questioner.id);if(patient)lines.push(`${patient.name}: Let the reporter answer before anyone votes.`);
    }
    const used=new Set([this.reporter,questioner.id]);const informed=bots.filter(p=>!used.has(p.id)).sort((a,b)=>this.topBelief(b)[1]-this.topBelief(a)[1]);
    const witness=informed.find(p=>Object.values(p.evidence).some(v=>v>=.9)||this.informativeSightings(p).length);if(witness)lines.push(`${witness.name}: ${this.knowledgeStatement(witness)}`);
    return lines;
  }
  private remember(p:Person,memory:Memory):void{const duplicate=p.memories.at(-1);if(duplicate&&duplicate.kind===memory.kind&&duplicate.subject===memory.subject&&duplicate.room===memory.room&&memory.time-duplicate.time<3)return;p.memories.push(memory);if(p.memories.length>30)p.memories.shift();}
  private mentionedPeople(q:string):Person[]{return this.people.filter(p=>((p.name!=='You'&&q.includes(p.name.toLowerCase()))||new RegExp(`\\b${COLOR_NAMES[p.id%COLOR_NAMES.length]}\\b`).test(q)));}
  private adjustSuspicion(p:Person,target:number,amount:number):void{if(target===p.id||!this.people[target]?.alive)return;p.suspicion[target]=Math.max(0,Math.min(1,(p.suspicion[target]??0)+amount));}
  private topBelief(p:Person):[number,number]{let best:[number,number]=[-1,0];for(const other of this.people)if(other.alive&&other.id!==p.id){const score=Math.max(p.evidence[other.id]??0,p.suspicion[other.id]??0);if(score>best[1])best=[other.id,score];}return best;}
  private recentSightings(p:Person):Array<[number,{room:string;time:number}]>{return Object.entries(p.sightings).map(([id,s])=>[Number(id),s] as [number,{room:string;time:number}]).filter(([id,s])=>this.people[id]?.alive&&this.elapsed-s.time<55).sort((a,b)=>b[1].time-a[1].time);}
  private informativeSightings(p:Person):Array<[number,{room:string;time:number}]>{return this.recentSightings(p).filter(([,s])=>s.room!=='Commons'||this.elapsed-s.time>4);}
  private reportStatement(p:Person):string{if(this.meetingBody!==null){const body=this.bodies.find(b=>b.id===this.meetingBody),victim=this.people[this.meetingBody];return `I reported ${victim?.name??'the body'} in ${body?location(body):'the ship'}. ${this.knowledgeStatement(p)}`;}return `I called the meeting from Commons. ${this.knowledgeStatement(p)}`;}
  private reportDetail(p:Person):string{const seen=this.informativeSightings(p).filter(([id])=>id!==this.meetingBody).slice(0,2),body=this.meetingBody===null?null:this.bodies.find(b=>b.id===this.meetingBody);return `${body?`The body was in ${location(body)}.`:'I used the Commons emergency console.'} ${seen.length?`Around then I saw ${seen.map(([id,s])=>`${this.people[id]!.name} in ${s.room}`).join(' and ')}.`:'I did not see anyone close enough to place.'}`;}
  private taskStatement(p:Person):string{const task=this.tasks[p.target%this.tasks.length]!,trail=p.roomTrail.slice(-2).map(r=>r.room).filter((r,i,a)=>i===0||r!==a[i-1]);return `I was ${p.tasks?`done with ${p.tasks} task${p.tasks===1?'':'s'} and `:''}heading to ${task.room} to ${task.name.toLowerCase()}${trail.length?` after passing through ${trail.join(' then ')}`:''}.`;}
  private knowledgeStatement(p:Person):string{
    const known=Object.entries(p.evidence).find(([id,value])=>value>=.9&&this.people[Number(id)]?.alive);
    if(known)return `I saw ${this.people[Number(known[0])]!.name} eliminate someone. That is direct evidence.`;
    const [suspect,score]=this.topBelief(p);if(suspect>=0&&score>.38)return `I’m watching ${this.people[suspect]!.name}. My suspicion is based on ${p.memories.filter(m=>m.subject===suspect).at(-1)?.detail??'their movement near the incident'}, but it is not proof.`;
    const seen=this.informativeSightings(p)[0];
    if(seen){const other=this.people[seen[0]]!;return `I last saw ${other.name} in ${seen[1].room} ${Math.max(1,Math.round(this.elapsed-seen[1].time))} seconds before the meeting. I did not see a kill.`;}
    return `${this.taskStatement(p)} I have no direct evidence.`;
  }
  learnFromChat(message:string,speaker:Person=this.player):void{
    const q=message.toLowerCase(),mentioned=this.mentionedPeople(q).filter(p=>p.id!==speaker.id),claimedRoom=ROOMS.find(r=>q.includes(r.name.toLowerCase()));
    for(const bot of this.people.filter(p=>p.alive&&p.bot)){
      if(claimedRoom){const sight=bot.sightings[speaker.id],agrees=sight&&this.elapsed-sight.time<70&&sight.room===claimedRoom.name;const contradicts=sight&&this.elapsed-sight.time<70&&sight.room!==claimedRoom.name;this.adjustSuspicion(bot,speaker.id,agrees ? -.06 : contradicts ? .14 : 0);this.remember(bot,{kind:contradicts?'contradiction':'claim',time:this.elapsed,room:claimedRoom.name,subject:speaker.id,detail:contradicts?`${speaker.name}'s room claim conflicted with my sighting`:`${speaker.name} claimed ${claimedRoom.name}`});}
      if(/sus|suspicious|impostor|killed|vent|vote|follow|watch/.test(q))for(const target of mentioned){const listens=(bot.id+speaker.id+target.id)%3!==0,trust=bot.trust[speaker.id]??.5;if(listens)this.adjustSuspicion(bot,target.id,.04+trust*.1);this.remember(bot,{kind:'claim',time:this.elapsed,room:location(bot),subject:target.id,detail:`${speaker.name} accused ${target.name}`});if(listens&&(bot.suspicion[target.id]??0)>.25&&bot.personality>.3){bot.followTarget=target.id;bot.followUntil=this.elapsed+10+bot.personality*16;}}
      bot.trust[speaker.id]=Math.max(.1,Math.min(.9,(bot.trust[speaker.id]??.5)+(claimedRoom?-.01:.005)));
    }
  }
  chatReplies(message:string,speaker:Person=this.player):BotReply[]{
    if(this.phase!=='meeting')return[];const q=message.toLowerCase(),bots=this.people.filter(p=>p.alive&&p.bot);if(!bots.length)return[];this.learnFromChat(message,speaker);
    const mentioned=this.mentionedPeople(q)[0];if(mentioned)this.conversationSubject=mentioned.id;
    const addressed=mentioned?.bot&&mentioned.alive?mentioned:null;
    const choose=(pool:Person[])=>{const fresh=pool.filter(p=>p.id!==this.lastBotSpeaker),options=fresh.length?fresh:pool,p=options[Math.floor(this.random()*options.length)]!;this.lastBotSpeaker=p.id;return p;};
    if(/^(hi|hey|hello|yo|sup)\b|good (morning|evening)|can you hear me/.test(q)){const p=addressed??choose(bots),greetings=['Hey. I’m listening.','Yeah, I’m here. What do you want to know?','I hear you. Go ahead.','Hey. Let’s figure this out before the vote.'];return[{id:p.id,text:greetings[Math.floor(p.personality*greetings.length)]!}];}
    if(/thank|thanks|appreciate/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:p.personality>.5?'No problem. Just make the vote count.':'You’re welcome. Keep asking if something does not add up.'}];}
    if(/sorry|my bad/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:'It’s fine. We need facts more than apologies right now.'}];}
    if(/^(ok|okay|alright|fine|got it|understood)[.! ]*$/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:'Good. I’m still listening.'}];}
    if(/who are you|your name|what color are you/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:`I’m ${p.name}, the ${COLOR_NAMES[p.id%COLOR_NAMES.length]} crewmate. ${this.taskStatement(p)}`}];}
    if(/what can i ask|what do you know|help me|how can you help/.test(q)){const p=choose(bots);return[{id:p.id,text:'Ask about any player, color, room, task, sighting, body, vote, role, control, sabotage or rule. I can also compare a room claim with what I remember.'}];}
    if(/who\s+(reported|called)|reporter/.test(q)){const r=this.people[this.reporter];return r?.bot&&r.alive?[{id:r.id,text:this.reportStatement(r)}]:[{id:choose(bots).id,text:`${r?.name??'The reporter'} started this meeting. ${this.meetingReason}`}];}
    if(/where.*body|body.*where|found.*where/.test(q)){const r=this.people[this.reporter],p=r?.bot?r:choose(bots);return[{id:p.id,text:this.reportDetail(p)}];}
    if(speaker.id===this.reporter&&mentioned&&mentioned.id!==speaker.id&&/saw|think|sus|vent|killed|follow|because/.test(q)){
      const target=mentioned,defender=target.bot?target:null,witness=bots.find(p=>p.id!==target.id&&p.evidence[target.id]>=.9),skeptic=bots.find(p=>p.id!==target.id&&p.id!==witness?.id);
      const replies:BotReply[]=[];if(witness)replies.push({id:witness.id,text:`I can confirm that. I directly saw ${target.name} eliminate someone.`});else if(skeptic)replies.push({id:skeptic.id,text:`What evidence puts ${target.name} there? A name alone is not enough for my vote.`});
      if(defender)replies.push({id:defender.id,text:`I disagree. ${this.taskStatement(defender)} Check the sightings before voting me.`});return replies.slice(0,2);
    }
    if(speaker.id===this.reporter&&/because|called|meeting|reason|noticed/.test(q)){const p=choose(bots),other=bots.find(b=>b.id!==p.id);return[{id:p.id,text:'Understood. Did you see a specific person, vent, body, or movement that supports that?'},...(other?[{id:other.id,text:this.knowledgeStatement(other)}]:[])].slice(0,2);}
    const guide=answerKnowledge(q);if(guide){const p=addressed??choose(bots);return[{id:p.id,text:guide.answer}];}
    if(/^(why|how do you know|prove it|what makes you think)/.test(q)&&this.conversationSubject!==null){const target=this.people[this.conversationSubject]!,informed=bots.filter(p=>p.evidence[target.id]>=.9||p.memories.some(m=>m.subject===target.id));const p=choose(informed.length?informed:bots),memory=p.memories.filter(m=>m.subject===target.id).at(-1);return[{id:p.id,text:p.evidence[target.id]>=.9?`Because I directly witnessed ${target.name} eliminate someone.`:memory?`Because ${memory.detail}. That raises suspicion, but it is not proof.`:`I do not have enough evidence against ${target.name} to justify a vote.`}];}
    if(/who.*with|anyone.*with|vouch|alibi/.test(q)){const p=addressed??choose(bots),seen=this.informativeSightings(p).slice(0,3);return[{id:p.id,text:seen.length?`I can place ${seen.map(([id,s])=>`${this.people[id]!.name} in ${s.room}`).join(', ')}. That is all I can vouch for.`:'Nobody can confirm my route, and I will not invent an alibi.'}];}
    if(/where|location|which room/.test(q)){const p=addressed??choose(bots);const seen=this.informativeSightings(p)[0];return[{id:p.id,text:`I was in ${location(p)}. ${this.taskStatement(p)}${seen?` I saw ${this.people[seen[0]]!.name} in ${seen[1].room}.`:' I only saw the group gathering in Commons, which proves nothing.'}`}];}
    if(/task|doing|did you do|what were/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:this.taskStatement(p)}];}
    if(/who.*vote|voting|your vote/.test(q)){const p=addressed??choose(bots),vote=this.botVote(p);return[{id:p.id,text:vote<0?'I am leaning skip unless stronger evidence appears.':`Right now I lean toward ${this.people[vote]!.name}, but I can change my mind if the evidence changes.`}];}
    if(/trust|believe|lying|lie|honest/.test(q)){const p=addressed??choose(bots),[suspect,score]=this.topBelief(p);return[{id:p.id,text:suspect>=0&&score>.25?`I trust ${this.people[suspect]!.name} less than the others because ${p.memories.filter(m=>m.subject===suspect).at(-1)?.detail??'their story does not line up yet'}.`:'I do not have enough information to call anyone a liar.'}];}
    if(/saw|see|evidence|who did|what happened|sus|suspicious/.test(q)){const informed=bots.filter(p=>Object.values(p.evidence).some(v=>v>=.9)||this.recentSightings(p).length);const p=addressed??choose(informed.length?informed:bots);return[{id:p.id,text:this.knowledgeStatement(p)}];}
    if(mentioned&&mentioned.alive){
      if(mentioned.bot){const witness=bots.find(p=>p.id!==mentioned.id&&p.evidence[mentioned.id]>=.9);if(witness)return[{id:witness.id,text:`I saw ${mentioned.name} do it. I am certain.`},{id:mentioned.id,text:'That accusation is false. I was working on ship systems.'}];return[{id:mentioned.id,text:`Why me? ${this.taskStatement(mentioned)} Nobody has shown evidence against me.`}];}
      const witness=bots.find(p=>p.evidence[mentioned.id]>=.9);return[{id:(witness??choose(bots)).id,text:witness?`I saw ${mentioned.name} eliminate someone. Vote ${mentioned.name}.`:`I only saw ${mentioned.name} moving through the ship. That is not enough to vote.`}];
    }
    if(/anyone|talk|reply/.test(q)){const p=choose(bots);return[{id:p.id,text:'I’m listening. Ask me something specific and I’ll tell you what I actually know.'}];}
    if(/how are you|you good|afraid|scared/.test(q)){const p=addressed??choose(bots);return[{id:p.id,text:p.personality>.6?'A little tense, honestly. I do not want us ejecting crew without proof.':'I’m okay. Focused on the meeting.'}];}
    if(/follow|watch|tail/.test(q)){const target=mentioned??speaker,p=choose(bots);return[{id:p.id,text:(p.followTarget===target.id||this.topBelief(p)[0]===target.id)?`I have been watching ${target.name}, but I will not treat that as proof.`:`I can keep an eye on ${target.name}, but I still need to finish tasks.`}];}
    const p=choose(bots),second=bots.find(b=>b.id!==p.id&&this.informativeSightings(b).length);
    return[{id:p.id,text:`I’m not sure what you mean. Ask me about a player, room, task, body, sighting, vote, sabotage or rule.`},...(second&&p.personality>.78?[{id:second.id,text:'Try using a name or suit color so we know who you mean.'}]:[])].slice(0,2);
  }
  botVote(bot:Person):number{if(!bot.alive)return-1;const [suspect,score]=this.topBelief(bot);if(bot.impostor){const crew=this.people.filter(p=>p.alive&&!p.impostor&&p.id!==bot.id).sort((a,b)=>(bot.suspicion[b.id]??0)-(bot.suspicion[a.id]??0));return score>.28&&suspect>=0&&suspect!==bot.id?suspect:(crew[0]?.id??-1);}return suspect>=0&&score>(.4+bot.personality*.22)?suspect:-1;}
  vote(choice: number): { ejected: Person | undefined; tally: Record<number, number> } {
    const tally: Record<number, number> = {}; const alive = this.people.filter(p => p.alive);
    if (this.player.alive) tally[choice] = 1;
    for (const bot of alive.filter(p => p.bot)) { let vote=this.botVote(bot);if(vote<0&&choice>=0&&choice!==bot.id&&this.random()<.18+bot.personality*.18)vote=choice;tally[vote]=(tally[vote]??0)+1; }
    const entries = Object.entries(tally).sort((a,b) => b[1] - a[1]); const best = entries[0]; const ejected = best && Number(best[0]) >= 0 && best[1] > (entries[1]?.[1] ?? 0) ? this.people[Number(best[0])] : undefined;
    if (ejected) ejected.alive = false;
    this.phase = 'play'; this.sabotage = null; this.cooldown = 20;
    this.people.forEach((p, i) => { Object.assign(p, spawn(i)); p.path = []; p.wait = 2 + this.random() * 4; });
    this.checkWin(); return { ejected, tally };
  }
  triggerSabotage(kind: 'lights' | 'reactor'): boolean { if (this.phase !== 'play' || this.sabotage || this.sabotageCooldown > 0) return false; this.sabotage = kind; this.sabotageTime = kind === 'reactor' ? 65 : 38; this.sabotageCooldown = 50; this.events.push({ type: 'sabotage', text: kind === 'reactor' ? 'Reactor critical. Reach Reactor and restore containment.' : 'Lights offline. Restore the breaker in Electrical.' }); return true; }
  fix(): void { this.sabotage = null; this.sabotageTime = 0; }
  complete(index: number): void { this.completeFor(this.player,index); }
  completeFor(who:Person,index:number):void { if(!this.tasks[index]||who.impostor)return;const key=`${who.id}:${index}`;if(this.completed.has(key))return;this.completed.add(key);who.tasks++;this.remember(who,{kind:'task',time:this.elapsed,room:this.tasks[index]!.room,detail:`completed ${this.tasks[index]!.name}`});for(const observer of this.people)if(observer.id!==who.id&&observer.alive&&distance(observer,who)<7&&visible(observer,who)){observer.trust[who.id]=Math.min(1,(observer.trust[who.id]??.5)+.08);this.adjustSuspicion(observer,who.id,-.08);}if(who.id===this.localId)this.tasks[index]!.done=true;this.checkWin(); }
  taskDone(who:Person,index:number):boolean{return this.completed.has(`${who.id}:${index}`);}
  private end(winner: string, reason: string): void { if (this.phase === 'result') return; this.phase = 'result'; this.winner = winner; this.result = reason; this.events.push({ type: 'result', text: reason }); }
  checkWin(): void { const crew = this.people.filter(p => p.alive && !p.impostor).length, imp = this.people.filter(p => p.alive && p.impostor).length; if (imp === 0) this.end('CREW', 'The impostor was ejected. The ship is safe.'); else if (crew <= imp) this.end('IMPOSTOR', 'The impostor has taken control of the ship.'); else if (this.progress >= 1) this.end('CREW', 'All ship systems restored. Mission complete.'); }
  step(dt: number): void {
    if (this.phase !== 'play') return; this.elapsed += dt; this.cooldown = Math.max(0, this.cooldown - dt); this.sabotageCooldown = Math.max(0, this.sabotageCooldown - dt); this.reportDelay -= dt;
    if (this.sabotage) { this.sabotageTime -= dt; if (this.sabotageTime <= 0) { if (this.sabotage === 'reactor') { this.end('IMPOSTOR', 'Reactor containment failed.'); return; } this.fix(); } }
    for(const p of this.people){const room=location(p);if(room!==p.lastRoom){p.lastRoom=room;p.roomTrail.push({room,time:this.elapsed});if(p.roomTrail.length>8)p.roomTrail.shift();}}
    for (const bot of this.people.filter(p=>p.bot)) {
      if (!bot.alive && bot.impostor) continue;
      const followed=bot.followTarget===null?null:this.people[bot.followTarget];if(bot.followUntil<=this.elapsed||!followed?.alive){bot.followTarget=null;bot.followUntil=0;}else if(followed&&distance(bot,followed)>2.8&&(!bot.path.length||distance(bot.path.at(-1)!,followed)>2.5))bot.path=pathTo(bot,followed);
      const next = bot.path[0]; if (next) { const d = distance(bot, next); const s = Math.min(d, dt * 2.4); if (d < .08) bot.path.shift(); else { bot.yaw = Math.atan2(next.x - bot.x, next.z - bot.z); this.move(bot, (next.x - bot.x) / d * s, (next.z - bot.z) / d * s); } }
      else if(bot.followTarget===null){ bot.wait -= dt; if (bot.wait <= 0) { if (!bot.impostor && distance(bot, this.tasks[bot.target]!) < 2.5 && bot.tasks < 3) { this.completeFor(bot,bot.target); } bot.target = (bot.target + 1 + Math.floor(this.random() * (this.tasks.length-1))) % this.tasks.length; bot.path = pathTo(bot, this.tasks[bot.target]!); bot.wait = 9 + this.random() * 9; } }
      if (bot.alive && !bot.impostor && this.sabotage && this.sabotageTime < (this.sabotage === 'reactor' ? 42 : 22)) { const target = this.sabotage === 'reactor' ? REACTOR : ELECTRICAL; if (distance(bot, target) < 2) this.fix(); else if (!bot.path.length || distance(bot.path[bot.path.length - 1]!, target) > 1) bot.path = pathTo(bot, target); }
    }
    this.aiClock -= dt; if (this.aiClock > 0 || this.phase !== 'play') return; this.aiClock = .45;
    // Only unobstructed, nearby observations become meeting testimony.
    for (const observer of this.people.filter(p=>p.alive)) for (const other of this.people) {
      if (other.id!==observer.id && other.alive && distance(observer,other)<(this.sabotage==='lights'?4:11) && visible(observer,other)){const room=location(other);observer.sightings[other.id]={room,time:this.elapsed};this.remember(observer,{kind:'sighting',time:this.elapsed,room,subject:other.id,detail:`saw ${other.name} in ${room}`});}
    }
    for(const observer of this.people.filter(p=>p.alive&&p.bot))for(const body of this.bodies.filter(b=>!b.reported&&distance(observer,b)<10&&visible(observer,b))){if(observer.memories.some(m=>m.kind==='body'&&m.subject===body.id))continue;this.remember(observer,{kind:'body',time:this.elapsed,room:location(body),subject:body.id,detail:`found ${this.people[body.id]?.name??'a crew member'} down in ${location(body)}`});for(const [id,s] of this.recentSightings(observer))if(id!==body.id&&s.room===location(body)&&this.elapsed-s.time<18)this.adjustSuspicion(observer,id,.18);}
    for(const bot of this.people.filter(p=>p.alive&&p.bot&&!p.impostor&&p.followTarget===null)){const [suspect,score]=this.topBelief(bot);if(suspect>=0&&score>.3+bot.personality*.25&&(bot.id+suspect)%3!==0){bot.followTarget=suspect;bot.followUntil=this.elapsed+9+bot.personality*15;bot.path=pathTo(bot,this.people[suspect]!);}else if(score<.2&&bot.personality>.82){const seen=this.recentSightings(bot)[0];if(seen&&seen[0]!==bot.id){bot.followTarget=seen[0];bot.followUntil=this.elapsed+6;}}}
    const imp = this.people.find(p => p.impostor && p.alive && p.bot);
    if (imp) {
      if (this.elapsed > 35 && this.sabotageCooldown === 0 && this.random() < .12) this.triggerSabotage(this.random() < .65 ? 'lights' : 'reactor');
      const victim = this.people.filter(p => p.alive && !p.impostor && visible(imp, p)).sort((a,b) => distance(imp,a) - distance(imp,b))[0];
      if (victim && this.cooldown <= 0) { const witnesses = this.people.filter(p => p.alive && !p.impostor && p.id !== victim.id && distance(p, victim) < 11 && visible(p, victim)); if (!witnesses.length || this.random() < .08) { if (!this.kill(imp, victim)) imp.path = pathTo(imp, victim); } }
    }
    if (this.reportDelay <= 0) for (const bot of this.people.slice(1).filter(p => p.alive && !p.impostor)) { const body = this.bodies.find(b => !b.reported && distance(bot, b) < 3 && visible(bot,b)); if (body) { this.callMeeting(bot,body); break; } const spotted = this.bodies.find(b => !b.reported && distance(bot,b) < 10 && visible(bot,b)); if (spotted) bot.path = pathTo(bot,spotted); }
  }
}
