import assert from 'node:assert/strict';
import { Match, ROOMS, CENTER, SCALE, point, pathTo, visible, walkable } from '../client/src/starfall/sim';
const tests: string[] = [];
{
 const m=new Match('crew',()=>.5,{count:8,humanCount:2});
 assert.deepEqual(new Set(m.tasks.map(t=>t.kind)).size,6);m.localId=1;assert.equal(m.player.id,1);assert.equal(m.people[1]!.bot,false);
 tests.push('Six distinct task systems and per-client player ownership');
}
{
 const m=new Match('crew',()=>.25);m.phase='meeting';m.reporter=1;m.meetingBody=3;m.bodies.push({id:3,...point(13,3),reported:true});m.people[2]!.evidence[4]=1;m.people[2]!.sightings[5]={room:'Cargo',time:0};
 const reporter=m.chatReplies('who reported this?');assert.equal(reporter[0]?.id,1);assert.match(reporter[0]?.text??'',/reported/i);
 const evidence=m.chatReplies('what did you see?');assert.match(evidence[0]?.text??'',/(saw|evidence)/i);
 const direct=m.chatReplies('Atlas where were you?');assert.equal(direct[0]?.id,2);assert.match(direct[0]?.text??'',/I was in/);
 const color=m.chatReplies('why is blue suspicious?');assert.match(color[0]?.text??'',/(Why me|Nobody|saw|Because|suspicion)/i);
 const hello=m.chatReplies('hello');assert.match(hello[0]?.text??'',/listen|hear|figure/i);assert(!/task|evidence/i.test(hello[0]?.text??''));
 assert.match(m.chatReplies('how do vents work?')[0]?.text??'',/Only impostors/i);assert.match(m.chatReplies('what are the controls?')[0]?.text??'',/WASD/i);
 tests.push('Context-aware bot chat handles casual talk, game knowledge, reporter, evidence and location questions');
}
{
 const m=new Match('impostor',()=>.2);m.phase='meeting';m.reporter=0;m.meetingBody=null;m.elapsed=1;for(const bot of m.people.slice(1))bot.sightings[0]={room:'Commons',time:1};const lines=m.discussion(),speakers=lines.map(line=>line.split(':')[0]);
 assert(lines.length<=3);assert(speakers.length>=2);assert.notEqual(speakers[0],speakers[1]);assert(!lines.some(line=>/1 seconds before/.test(line)));
 tests.push('Emergency openings use distinct speakers and suppress trivial spawn-room repetition');
}
for (const room of ROOMS) { const goal=point(room.x+1,room.z+1), path=pathTo(CENTER,goal); assert(path.length>0); for(const p of path)assert(walkable(p.x,p.z)); assert(Math.hypot(path.at(-1)!.x-goal.x,path.at(-1)!.z-goal.z)<.01); } tests.push('All seven rooms reachable, collision-safe routes');
assert(!walkable(0,0));assert(!visible(point(3,3),point(3,18)));tests.push('Walls block movement and witness visibility');
{
 const m=new Match('impostor',()=>.5);const victim=m.people[1]!,witness=m.people[2]!;Object.assign(m.player,point(12,11));Object.assign(victim,point(12,11));victim.x+=1;Object.assign(witness,point(13,11));for(const p of m.people.slice(3))Object.assign(p,point(3,3));m.cooldown=0;
 assert(m.kill(m.player,victim));assert(!victim.alive);assert.equal(m.bodies.length,1);assert.equal(witness.evidence[0],1);assert.equal(m.people[3]!.evidence[0],undefined);assert(!m.kill(m.player,witness));for(const p of m.people.slice(2,6)){p.evidence[0]=1;p.suspicion[0]=1;}assert(m.callMeeting(witness,m.bodies[0]));const vote=m.vote(-1);assert.equal(vote.ejected?.id,0);assert.equal(m.winner,'CREW');tests.push('Kills, cooldown, eyewitness-only evidence, independent witness voting and crew victory');
}
{
 const m=new Match('crew',()=>.4,{count:8,humanCount:1,impostorIds:[7]});m.elapsed=50;m.phase='meeting';for(const bot of m.people.slice(1)){bot.sightings[0]={room:'Cargo',time:45};}
 m.learnFromChat('I was in Bridge and Atlas is suspicious',m.player);const atlas=m.people[2]!,beliefs=m.people.slice(1).map(p=>p.suspicion[atlas.id]??0);assert(beliefs.some(v=>v>0));assert(beliefs.some(v=>v===0));assert(m.people.slice(1).every(p=>(p.suspicion[0]??0)>0));
 m.phase='play';const tracker=m.people[3]!;tracker.suspicion[atlas.id]=.9;tracker.path=[];m.step(.5);assert.equal(tracker.followTarget,atlas.id);assert(tracker.followUntil>m.elapsed);
 tests.push('Bots learn from claims and contradictions without herd consensus, then selectively tail suspects');
}
{
 const m=new Match('crew',()=>.5);m.botTaskTotal=18;for(let i=0;i<6;i++)m.complete(i);assert.equal(m.winner,'CREW');assert.equal(m.progress,1);tests.push('Task victory');
}
{
 const m=new Match('impostor',()=>.5);for(const p of m.people.slice(2))p.alive=false;m.checkWin();assert.equal(m.winner,'IMPOSTOR');tests.push('Parity victory');
}
{
 const m=new Match('crew',()=>.5);m.sabotageCooldown=0;assert(m.triggerSabotage('reactor'));m.sabotageTime=.01;m.step(.02);assert.equal(m.winner,'IMPOSTOR');tests.push('Reactor expiry victory');
}
{
 const m=new Match('crew',()=>.5);Object.assign(m.player,CENTER);assert(m.callMeeting(m.player));const outcome=m.vote(-1);assert.equal(outcome.ejected,undefined);assert.equal(m.phase,'play');assert(!m.callMeeting(m.player));tests.push('Skip votes and one emergency per player');
}
for(let seed=1;seed<=12;seed++){
 let state=seed;const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};const m=new Match(seed%2?'crew':'impostor',random);
 for(let i=0;i<3600&&m.phase!=='result';i++){if(m.phase==='meeting')m.vote(-1);m.step(.1);for(const p of m.people)assert(walkable(p.x,p.z),`${p.name} outside map at ${p.x/SCALE},${p.z/SCALE}`);}
}tests.push('12 seeded six-minute simulations without invalid positions or crashes');
console.log(tests.map(t=>'PASS '+t).join('\n'));
