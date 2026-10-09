import './styles.css';
import { Match, GRID, SCALE, CENTER, REACTOR, ELECTRICAL, VENTS, ROOMS, distance, visible, location, pathTo, type Station, type Pos } from './sim';
import { ShipView, type Quality } from './view';
import { ShipAudio } from './audio';
import { StarfallNet } from './net/online';
import type { SfBegin, SfConfig, SfEvent, SfLobby, SfSnap } from './net/protocol';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<canvas id="scene"></canvas><div id="hud"></div><div id="modal"></div><div id="toast" class="notice hidden"></div>';
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!, hud = document.querySelector<HTMLDivElement>('#hud')!, modal = document.querySelector<HTMLDivElement>('#modal')!, toast = document.querySelector<HTMLDivElement>('#toast')!;
let view: ShipView;
try { view = new ShipView(canvas); } catch { app.innerHTML = '<div class="overlay"><div class="panel"><h2>3D graphics unavailable</h2><p>Enable hardware acceleration in your browser, then reload.</p><a class="link" href="/">Back to arcade</a></div></div>'; throw new Error('WebGL unavailable'); }
let match: Match | null = null, yaw = 0, pitch = 0, mode: 'home' | 'play' | 'pause' | 'task' | 'meeting' | 'map' | 'result' | 'briefing' = 'home';
let sensitivity = .0022, volume = .25, fov = 76;
let quality:Quality = 'balanced';
try {
  const p = JSON.parse(localStorage.getItem('starfall:settings') ?? '{}') as { sensitivity?: number; volume?: number; fov?:number; quality?:Quality };
  if (typeof p.sensitivity === 'number' && Number.isFinite(p.sensitivity)) sensitivity = Math.max(.0007,Math.min(.005,p.sensitivity));
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) volume = Math.max(0,Math.min(.7,p.volume));
  if (typeof p.fov === 'number' && Number.isFinite(p.fov)) fov = Math.max(60,Math.min(100,p.fov));
  if (p.quality && ['high','balanced','low'].includes(p.quality)) quality=p.quality;
} catch { /* storage optional */ }
view.setQuality(quality);view.setFov(fov);
function save(): void { try { localStorage.setItem('starfall:settings',JSON.stringify({ sensitivity,volume,quality,fov })); } catch { /* storage optional */ } }
const audio = new ShipAudio();
function beep(freq = 540, length = .10): void { audio.volume=volume;audio.tone(freq,length); }
let trackedTask=0,route:Pos[]=[],routeRefresh=0,previousRoom='';
let net:StarfallNet|null=null,online=false,lastNetInput=0,meetingLines:string[]=[];
let meetingDialogueToken=0;
let playerName=localStorage.getItem('starfall:name')||'Captain';
let localConfig:SfConfig={players:8,impostors:1,bots:7,crewVision:9,impostorVision:13,killCooldown:24,confirmEjects:true};
let noticeUntil = 0;
function notify(text: string, seconds = 4): void { toast.textContent = text; toast.classList.remove('hidden'); noticeUntil = performance.now() + seconds*1000; }
const keys = new Set<string>();
function show(html: string, home = false): void { modal.innerHTML = `<div class="overlay ${home ? 'home' : ''}">${html}</div>`; focusIndex = 0; document.exitPointerLock?.(); keys.clear(); }
function buttons(): HTMLElement[] { return [...modal.querySelectorAll<HTMLElement>('button:not(:disabled),a,input')]; }
function bind(id: string, fn: () => void): void { document.getElementById(id)?.addEventListener('click',fn); }
function lock(): void { const result = canvas.requestPointerLock?.(); if (result instanceof Promise) void result.catch(() => notify('Mouse capture unavailable. Drag on the view to look, or use a controller.')); }
function resume(capture = true): void { mode = 'play'; modal.innerHTML = ''; keys.clear(); if (capture && !padConnected()) lock(); }
function home(): void {
  if(net){void net.leave();net=null;}online=false;match = null; mode = 'home'; hud.innerHTML = ''; view.setup(new Match('crew'));
  show(`<div class="home-shell"><section class="home-inner"><div class="eyebrow"><i></i> MITRIS’ ARCADE / DEEP SPACE DIVISION</div><h1>STAR<span>FALL</span></h1><p class="home-lead">A first-person social deception mission aboard the Aurora-09. Every crewmate remembers. Every story can be questioned.</p><div class="ship-readout"><div><b>04</b><span>DECKS ONLINE</span></div><div><b>12</b><span>MAX CREW</span></div><div><b>∞</b><span>POSSIBLE LIES</span></div></div><div class="mode-grid"><button id="online" class="mode-card featured"><small>01 / MULTIPLAYER</small><strong>Board with friends</strong><span>Private codes · public rooms · same-Wi-Fi LAN</span><em>ONLINE / LAN →</em></button><button id="bots" class="mode-card"><small>02 / CUSTOM</small><strong>Command a bot crew</strong><span>Set roles, vision, cooldowns and crew size</span><em>BUILD MISSION →</em></button></div><div class="practice-row"><button id="crew"><b>CREW DRILL</b><span>Tasks + investigation</span></button><button id="impostor"><b>IMPOSTOR DRILL</b><span>Eliminate + deceive</span></button></div><div class="home-links"><button id="help">How to play</button><button id="settings">Settings</button><a class="link" href="/">← Arcade deck</a></div><div id="pad"></div></section><aside class="intel-card"><div class="intel-scan"></div><div class="eyebrow">SOCIAL AI / ACTIVE</div><h3>THE CREW REMEMBERS</h3><p>Bots track routes, tasks, bodies, claims, contradictions and witnesses. Question them in meetings—or become the person they quietly follow.</p><ul><li><span></span>Context-aware meeting chat</li><li><span></span>Independent suspicion models</li><li><span></span>Evidence-based voting</li><li><span></span>Adaptive tailing behavior</li></ul><div class="signal"><i></i><b>AURORA NETWORK</b><span>READY</span></div></aside></div><div class="corner-brand">RESEARCH VESSEL // AURORA-09 · BUILD 09</div>`,true);
  bind('online',onlineMenu);bind('bots',botSetup);bind('crew',()=>start('crew')); bind('impostor',()=>start('impostor')); bind('help',help); bind('settings',()=>settings());
}
function botSetup():void{
  const draw=()=>{show(`<div class="panel"><div class="eyebrow">CUSTOM MISSION / SOLO WITH BOTS</div><h2>Game rules</h2><label class="settings-row">Total players <input id="players" type="range" min="4" max="12" value="${localConfig.players}"><b>${localConfig.players}</b></label><label class="settings-row">Impostors <select id="imps"><option value="1">1</option><option value="2" ${localConfig.impostors===2?'selected':''}>2</option></select></label><label class="settings-row">Crew view distance <input id="cv" type="range" min="3" max="18" value="${localConfig.crewVision}"><b>${localConfig.crewVision}m</b></label><label class="settings-row">Impostor view distance <input id="iv" type="range" min="4" max="24" value="${localConfig.impostorVision}"><b>${localConfig.impostorVision}m</b></label><label class="settings-row">Kill cooldown <input id="kc" type="range" min="10" max="60" value="${localConfig.killCooldown}"><b>${localConfig.killCooldown}s</b></label><label class="settings-row">Confirm ejected role <input id="ce" type="checkbox" ${localConfig.confirmEjects?'checked':''}></label><div class="actions"><button id="random-role" class="primary">Random role</button><button id="crew-role">Choose crew</button><button id="imp-role">Choose impostor</button><button id="back">Back</button></div></div>`);
    const range=(id:keyof SfConfig)=>{const input=document.getElementById(id==='players'?'players':id==='crewVision'?'cv':id==='impostorVision'?'iv':'kc')as HTMLInputElement;const suffix=id==='players'?'':'m';input.oninput=()=>{(localConfig as unknown as Record<string,number>)[id]=Number(input.value);const label=input.nextElementSibling;if(label)label.textContent=input.value+(id==='killCooldown'?'s':suffix);};};range('players');range('crewVision');range('impostorVision');range('killCooldown');
    (document.getElementById('imps')as HTMLSelectElement).onchange=e=>{localConfig.impostors=Number((e.target as HTMLSelectElement).value)as 1|2;};(document.getElementById('ce')as HTMLInputElement).onchange=e=>localConfig.confirmEjects=(e.target as HTMLInputElement).checked;
    bind('random-role',()=>start(Math.random()<localConfig.impostors/localConfig.players?'impostor':'crew'));bind('crew-role',()=>start('crew'));bind('imp-role',()=>start('impostor'));bind('back',home);
  };draw();
}
async function onlineMenu():Promise<void>{
  show(`<div class="panel"><div class="eyebrow">ONLINE / LAN</div><h2>Board with friends</h2><label class="settings-row">Callsign <input id="name" maxlength="16" value="${playerName}"></label><label class="settings-row">Invite code <input id="code" maxlength="6" placeholder="ABCDEF"></label><div class="actions"><button id="create" class="primary">Create private room</button><button id="join">Join code</button><button id="quick">Quick match</button><button id="back">Back</button></div><p id="net-status" class="hint">Checking ship relay…</p></div>`);
  const status=document.getElementById('net-status')!,n=document.getElementById('name')as HTMLInputElement,code=document.getElementById('code')as HTMLInputElement;
  const fresh=()=>{playerName=n.value.trim().slice(0,16)||'Captain';localStorage.setItem('starfall:name',playerName);net=new StarfallNet();net.onLobby=onlineLobby;net.onBegin=beginOnline;net.onSnap=applyOnlineSnap;net.onEvent=onlineEvent;net.onError=m=>notify(m);net.onClosed=()=>{if(online){online=false;notify('Connection to the ship relay was lost.');home();}};return net;};
  const busy=async(fn:()=>Promise<void>)=>{status.textContent='Connecting to ship relay…';try{await fn();}catch(e){status.textContent=e instanceof Error?e.message:'Could not connect.';}};
  bind('create',()=>void busy(()=>fresh().create(playerName,0)));bind('join',()=>void busy(()=>fresh().join(code.value,playerName,0)));bind('quick',()=>void busy(()=>fresh().quick(playerName,0)));bind('back',home);
  const probe=await new StarfallNet().probe();status.textContent=probe.ok?(probe.lan?.length?`LAN relay ready · ${probe.lan.join(' · ')}`:'Online relay ready'):'Relay is offline. Start the arcade server for online or LAN rooms.';
}
function onlineLobby(l:SfLobby):void{
  online=true;const host=net?.sessionId===l.hostId,c=l.config;
  show(`<div class="panel wide"><div class="eyebrow">PRIVATE ROOM / INVITE CODE</div><div class="lobby-code">${l.code}</div><p class="muted">Share this code with friends. Empty seats launch as bots.</p><div class="meeting-grid"><div><h3>Boarding manifest</h3><div class="roster">${l.players.map(p=>`<div><span class="dot" style="background:#${COLORS_HEX[p.color%12]}"></span><b>${p.name}</b>${p.id===l.hostId?' · HOST':''}</div>`).join('')} ${Array.from({length:c.bots},(_,i)=>`<div class="muted">BOT ${i+1} · READY</div>`).join('')}</div></div><div><h3>Mission rules</h3><label class="settings-row">Players <input data-cfg="players" type="range" min="4" max="12" value="${c.players}" ${host?'':'disabled'}><b>${c.players}</b></label><label class="settings-row">Impostors <select data-cfg="impostors" ${host?'':'disabled'}><option>1</option><option ${c.impostors===2?'selected':''}>2</option></select></label><label class="settings-row">Crew view <input data-cfg="crewVision" type="range" min="3" max="18" value="${c.crewVision}" ${host?'':'disabled'}><b>${c.crewVision}m</b></label><label class="settings-row">Impostor view <input data-cfg="impostorVision" type="range" min="4" max="24" value="${c.impostorVision}" ${host?'':'disabled'}><b>${c.impostorVision}m</b></label><label class="settings-row">Kill cooldown <input data-cfg="killCooldown" type="range" min="10" max="60" value="${c.killCooldown}" ${host?'':'disabled'}><b>${c.killCooldown}s</b></label><label class="settings-row">Confirm ejected role <input data-cfg="confirmEjects" type="checkbox" ${c.confirmEjects?'checked':''} ${host?'':'disabled'}></label></div></div><div class="actions">${host?'<button id="launch" class="primary">Launch mission</button>':'<span class="status">Waiting for host…</span>'}<button id="leave">Leave room</button></div></div>`);
  modal.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-cfg]').forEach(el=>el.onchange=()=>net?.config({[el.dataset.cfg!]:el instanceof HTMLInputElement&&el.type==='checkbox'?el.checked:Number(el.value)}));bind('launch',()=>net?.start());bind('leave',home);
}
const COLORS_HEX=['52d8ef','f35c5c','608bff','58d099','b18bff','f2c64e','e5eafa','ff9a7d','2e4e9d','68717b','95df53','e958a0'];
function beginOnline(b:SfBegin):void{
  online=true;localConfig=b.config;match=new Match(b.role,Math.random,{count:b.people.length,humanCount:b.people.filter(p=>!p.bot).length,names:b.people.map(p=>p.name),impostorIds:[b.me]});match.people.forEach((p,i)=>{p.impostor=false;p.color=b.people[i]?.color??p.color;p.bot=b.people[i]?.bot??p.bot;});if(b.role==='impostor')for(const id of [b.me,...b.partners])if(match.people[id])match.people[id]!.impostor=true;match.localId=b.me;match.killCooldown=b.config.killCooldown;view.setup(match);view.setVision(b.role==='impostor'?b.config.impostorVision:b.config.crewVision);yaw=0;pitch=0;trackedTask=0;renderHud();roleReveal(b.role,b.partners);
}
function roleReveal(role:'crew'|'impostor',partners:number[]=[]):void{
  mode='briefing';const names=partners.map(id=>match?.people[id]?.name).filter(Boolean).join(' and ');
  show(`<div class="role-reveal ${role}"><div class="scanlines"></div><div class="eyebrow">YOUR ASSIGNMENT IS</div><h2>${role==='impostor'?'IMPOSTOR':'CREWMATE'}</h2><p>${role==='impostor'?(names?`${names} ${partners.length>1?'are':'is'} your partner. You can identify each other.`:'You work alone. Blend in and take the ship.'):'Complete your tasks. Find the impostors. Trust what you witness.'}</p><button id="deploy" class="primary">Enter the ship</button></div>`);bind('deploy',()=>resume());
}
function help(): void { show(`<div class="panel"><div class="eyebrow">CREW HANDBOOK / 01</div><h2>Trust your eyes.</h2><div class="howto"><div><h3>Crew</h3><p>Complete six tasks around the ship. Report bodies, question witnesses in chat, then eject the impostor. If killed, continue tasks as a ghost.</p></div><div><h3>Impostor</h3><p>Eliminate isolated crew. Sabotage lights or the reactor, use vents, and avoid witnesses. Win when only one crew member remains.</p></div><div><h3>Keyboard & mouse</h3><p>WASD: move · mouse: look<br>E: use · R: report · Q: eliminate<br>F: vent · Z: lights · X: reactor<br>M: map · Esc: pause</p></div><div><h3>Controller</h3><p>Left stick: move · right stick: look<br>A/✕: use · Y/△: report · X/□: eliminate<br>B/○: vent · LB: lights · RB: reactor<br>View/Share: map · Start: pause<br>D-pad + A/✕: operate all panels</p></div></div><p class="hint">An emergency console is in Commons. Each survivor can call one meeting. During discussion, type questions like “Atlas, where were you?”, “who reported?”, or “what did you see?” Bots answer from their simulated tasks and sightings.</p><button id="back" class="primary">Understood</button></div>`); bind('back',home); }
function settings(returnTo:()=>void=home): void {
  show(`<div class="panel"><div class="eyebrow">DISPLAY / AUDIO / INPUT</div><h2>Flight preferences</h2><div class="settings-row"><span>Graphics quality</span><button id="quality">${quality.toUpperCase()}</button></div><p class="hint">High: dynamic shadows + bloom + sharper resolution.<br>Balanced: bloom and contact shadows. Low: reduced resolution, no bloom.</p><label class="settings-row">Field of view<input id="fov" type="range" min="60" max="100" step="2" value="${fov}"></label><label class="settings-row">Look sensitivity<input id="sensitivity" type="range" min="0.0007" max="0.005" step="0.0001" value="${sensitivity}"></label><label class="settings-row">Audio volume<input id="volume" type="range" min="0" max="0.7" step="0.05" value="${volume}"></label><p class="hint">A steady camera: no forced camera shake or head bob. Controller settings use D-pad left/right.</p><button id="back" class="primary">Save & return</button></div>`);
  bind('quality',()=>{const values:Quality[]=['balanced','high','low'];quality=values[(values.indexOf(quality)+1)%3]!;view.setQuality(quality);document.getElementById('quality')!.textContent=quality.toUpperCase();save();});
  document.getElementById('fov')!.oninput=e=>{fov=Number((e.target as HTMLInputElement).value);view.setFov(fov);save();};
  document.getElementById('sensitivity')!.oninput = e => { sensitivity = Number((e.target as HTMLInputElement).value); save(); };
  document.getElementById('volume')!.oninput = e => { volume = Number((e.target as HTMLInputElement).value); save(); };
  bind('back',returnTo);
}
function start(role: 'crew' | 'impostor'): void {
  online=false;const opts={count:localConfig.players,impostors:localConfig.impostors,humanCount:1};match = new Match(role,Math.random,opts);match.killCooldown=localConfig.killCooldown;view.setup(match);view.setVision(role==='impostor'?localConfig.impostorVision:localConfig.crewVision); yaw = 0; pitch = 0; trackedTask=0;route=[];routeRefresh=0;previousRoom='';renderHud();beep();
  const partners=match.people.filter(p=>p.impostor&&p.id!==0).map(p=>p.id);roleReveal(role,partners);
}
function renderHud(): void { hud.innerHTML = `<div class="visor-frame"></div><div class="topbar"><div class="hud-card"><div class="badge">AURORA-09 / <span id="role"></span></div><div id="room" class="room"></div><div class="bar"><i id="progress"></i></div><div id="tasks"></div></div><div class="hud-card"><div class="badge">SHIP STATUS</div><div id="alarm" class="status"></div><div id="alive" class="taskline"></div></div></div><div class="crosshair"></div><div id="objective" class="objective"></div><div id="prompt" class="prompt hidden"></div><div class="action-dock"><button id="act-use"><span>E</span>USE</button><button id="act-report"><span>R</span>REPORT</button><button id="act-kill" class="danger hidden"><span>Q</span>KILL</button><button id="act-vent" class="hidden"><span>F</span>VENT</button></div><div class="bottom"><div class="controls" id="controls"></div><button id="pause">Pause / Esc</button></div>`; bind('pause',pause);bind('act-use',use);bind('act-report',report);bind('act-kill',eliminate);bind('act-vent',vent); }
function pause(): void { if (!match || mode !== 'play') return; mode = 'pause'; show('<div class="panel"><div class="eyebrow">SIMULATION PAUSED</div><h2>Take a breath.</h2><p class="muted">The crew, task progress, and sabotage timers are paused.</p><div class="actions"><button id="resume" class="primary">Resume mission</button><button id="flight-settings">Settings</button><button id="quit">Return to hangar</button></div></div>'); bind('resume',()=>resume()); bind('flight-settings',()=>settings(()=>{mode='play';pause();})); bind('quit',home); }
type Target = { label: string; action: () => void };
function nearest(): Target | null {
  if (!match) return null; const m = match, p = m.player;
  if (p.alive && m.sabotage && distance(p,m.sabotage === 'reactor' ? REACTOR : ELECTRICAL)<2.8 && visible(p,m.sabotage === 'reactor'?REACTOR:ELECTRICAL)) return { label:'Restore '+(m.sabotage==='reactor'?'reactor containment':'electrical power'), action:()=>taskPanel({ name:'Restore '+m.sabotage, room:location(p), kind:'power',done:false,x:p.x,z:p.z },()=>online?net?.action({k:'fix'}):m.fix()) };
  const t = m.tasks.findIndex(t=>!t.done && distance(p,t)<2.8 && visible(p,t));
  if(t>=0) return { label:(p.impostor?'Fake task: ':'')+m.tasks[t]!.name,action:()=>taskPanel(m.tasks[t]!,()=>online?net?.action({k:'task',index:t}):m.complete(t)) };
  if(p.alive && !p.emergency && !m.sabotage && distance(p,CENTER)<3) return { label:'Call emergency meeting',action:()=>{ if(online)net?.action({k:'emergency'});else if(m.callMeeting(p))processEvents(); } };
  return null;
}
function use(): void { if (mode==='play') nearest()?.action(); }
function cycleTask():void {
  if(!match)return;
  for(let i=1;i<=match.tasks.length;i++){const next=(trackedTask+i)%match.tasks.length;if(!match.tasks[next]!.done){trackedTask=next;routeRefresh=0;beep(480,.06);break;}}
}
function updateObjective():void {
  if(!match)return;const element=document.getElementById('objective');if(!element)return;
  const m=match,p=m.player;
  if(m.tasks[trackedTask]?.done)cycleTask();
  const task=m.tasks[trackedTask];
  const target=m.sabotage?(m.sabotage==='reactor'?REACTOR:ELECTRICAL):task&&!task.done?task:null;
  if(!target||(!m.sabotage&&p.impostor)){element.innerHTML='<span class="badge">'+(p.impostor?'BLEND IN · WATCH FOR WITNESSES':'TASKS COMPLETE · FIND THE IMPOSTOR')+'</span>';return;}
  if(performance.now()>routeRefresh){route=pathTo(p,target);routeRefresh=performance.now()+650;}
  while(route.length&&distance(p,route[0]!)<.7)route.shift();
  const next=route[0]??target,dx=next.x-p.x,dz=next.z-p.z;
  const side=Math.cos(yaw)*dx-Math.sin(yaw)*dz,ahead=-Math.sin(yaw)*dx-Math.cos(yaw)*dz;
  const angle=Math.atan2(side,ahead)*180/Math.PI;
  const meters=route.length?distance(p,route[0]!)+Math.max(0,route.length-1)*SCALE:distance(p,target);
  element.innerHTML=`<span class="nav-arrow" style="transform:rotate(${angle}deg)">↑</span><div><span class="badge">${m.sabotage?'PRIORITY REPAIR':'TRACKING · '+(padConnected()?'D-PAD UP':'T')+' TO CHANGE'}</span><strong>${m.sabotage?(m.sabotage==='reactor'?'Reactor containment':'Electrical power'):task!.room}</strong><small>${Math.ceil(meters)} m via corridors</small></div>`;
}
function report(): void { if(!match || mode!=='play')return; const body=match.bodies.find(b=>!b.reported&&distance(match!.player,b)<3&&visible(match!.player,b)); if(body){if(online)net?.action({k:'report',body:body.id});else if(match.callMeeting(match.player,body))processEvents();}else notify('No reportable body nearby.'); }
function eliminate(): void { if(!match || mode!=='play'||!match.player.impostor)return; const victim=match.people.filter(p=>p.alive&&!p.impostor&&distance(match!.player,p)<2.25&&visible(match!.player,p)).sort((a,b)=>distance(match!.player,a)-distance(match!.player,b))[0]; if(online){if(victim)net?.action({k:'kill',target:victim.id});else notify(match.cooldown>0?`Elimination ready in ${Math.ceil(match.cooldown)}s.`:'Get closer to a crew member.');}else if(victim&&match.kill(match.player,victim)){beep(110,.22);notify(`${victim.name} eliminated. Leave before someone arrives.`);}else notify(match.cooldown>0?`Elimination ready in ${Math.ceil(match.cooldown)}s.`:'Get within 2 metres of a crew member.'); }
function sabotage(kind:'lights'|'reactor'):void{if(!match||mode!=='play'||!match.player.impostor||!match.player.alive)return;if(online)net?.action({k:'sabotage',kind});else if(!match.triggerSabotage(kind))notify(`Sabotage ${match.sabotage?'already active':`ready in ${Math.ceil(match.sabotageCooldown)}s`}.`);}
function vent():void{if(!match||mode!=='play'||!match.player.impostor||!match.player.alive)return;const m=match;const i=VENTS.findIndex(v=>distance(m.player,v)<2);if(i<0){notify('Find a floor vent. Locations are marked on your map.');return;}if(online)net?.action({k:'vent'});else{for(const p of m.people)if(p.id!==0&&p.alive&&distance(p,m.player)<10&&visible(p,m.player))p.evidence[0]=1;Object.assign(m.player,VENTS[(i+1)%VENTS.length]);}beep(180,.15);notify('Vent transit complete.');}
function openMap():void{if(!match||mode!=='play')return;mode='map';const m=match;let cells='';GRID.forEach((row,z)=>row.forEach((v,x)=>{if(v)cells+=`<rect x="${x*20}" y="${z*20}" width="19" height="19" fill="#203b52"/>`;}));const labels=ROOMS.map(r=>`<text x="${(r.x+r.w/2)*20}" y="${(r.z+r.h/2)*20}" fill="#b5ccdf" font-size="10" text-anchor="middle">${r.name}</text>`).join('');const dots=m.tasks.filter(t=>!t.done).map(t=>`<circle cx="${t.x/SCALE*20}" cy="${t.z/SCALE*20}" r="5" fill="#f5cc67"/>`).join('');const vents=m.player.impostor?VENTS.map(v=>`<rect x="${v.x/SCALE*20-4}" y="${v.z/SCALE*20-4}" width="8" height="8" fill="#ff7289"/>`).join(''):'';
  show(`<div class="panel"><div class="eyebrow">DECK 01 / MISSION PAUSED</div><h2>Ship schematic</h2><svg class="map" viewBox="0 0 580 460" role="img" aria-label="Ship map with your position and task locations">${cells}${labels}${dots}${vents}<circle cx="${m.player.x/SCALE*20}" cy="${m.player.z/SCALE*20}" r="6" fill="#76eada" stroke="white" stroke-width="2"/></svg><div class="map-key"><span>● You</span><span style="color:#f5cc67">● Tasks</span>${m.player.impostor?'<span class="red">■ Vents</span>':''}</div><div class="actions"><button id="close-map" class="primary">Back to mission</button></div></div>`);bind('close-map',()=>resume());}

let taskCleanup = ():void=>{};
function taskPanel(station:Station,complete:()=>void):void{
  if(!match)return;mode='task';let disposed=false;
  show(`<div class="panel"><div class="eyebrow">${station.room.toUpperCase()} / SERVICE TERMINAL</div><h2>${station.name}</h2><div id="task-content"></div><p id="task-status" class="hint"></p><button id="cancel-task">Close terminal</button></div>`);
  const content=document.getElementById('task-content')!,status=document.getElementById('task-status')!;
  const finish=()=>{if(disposed)return;disposed=true;taskCleanup();complete();beep(820,.17);notify(match?.player.impostor?'Terminal sequence completed.':'System restored.');resume();};
  const close=()=>{disposed=true;taskCleanup();resume();};bind('cancel-task',close);taskCleanup=()=>{};
  if(station.kind==='sequence'){
    let step=0;const order=[...Array(6)].map((_,i)=>i+1).sort(()=>Math.random()-.5);content.innerHTML='<p class="muted">Validate the data packets in ascending order, 1 through 6.</p><div class="task-grid">'+order.map(n=>`<button data-number="${n}">${n}</button>`).join('')+'</div><div class="task-progress"><span style="width:0"></span></div>';
    content.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.onclick=()=>{if(Number(b.dataset.number)===step+1){step++;b.disabled=true;beep(350+step*90);(content.querySelector('.task-progress span')as HTMLElement).style.width=step/6*100+'%';if(step===6)finish();}else{status.textContent='Out of order. Start again at 1.';step=0;content.querySelectorAll('button').forEach(b=>b.disabled=false);(content.querySelector('.task-progress span')as HTMLElement).style.width='0';beep(140);}});
  }else if(station.kind==='power'){
    const switches=Array<boolean>(6).fill(true);
    const toggle=(i:number)=>{for(const n of [i,(i+1)%6,(i+5)%6])switches[n]=!switches[n];};
    for(let i=0;i<4;i++)toggle(Math.floor(Math.random()*6));if(switches.every(Boolean))toggle(0);
    content.innerHTML='<p class="muted">Bring all six circuits online. Each switch also toggles its two neighbors (1 and 6 are connected).</p><div class="task-grid circuit-grid">'+switches.map((s,i)=>`<button data-switch="${i}" class="${s?'active':''}" aria-pressed="${s}"><small>CIRCUIT 0${i+1}</small><span>${s?'ONLINE':'OFFLINE'}</span></button>`).join('')+'</div>';
    content.querySelectorAll<HTMLButtonElement>('button').forEach((b,i)=>b.onclick=()=>{toggle(i);content.querySelectorAll<HTMLButtonElement>('button').forEach((button,j)=>{button.classList.toggle('active',switches[j]);button.setAttribute('aria-pressed',String(switches[j]));button.innerHTML=`<small>CIRCUIT 0${j+1}</small><span>${switches[j]?'ONLINE':'OFFLINE'}</span>`;});beep(450);status.textContent=`${switches.filter(Boolean).length} / 6 circuits online`;if(switches.every(Boolean))finish();});
  }else if(station.kind==='tune'){
    let value=0;const target=4+Math.floor(Math.random()*5);content.innerHTML=`<p class="muted">Match the carrier frequency to <b>${target*10} MHz</b>.</p><div class="actions"><button id="minus">− 10 MHz</button><button id="plus">+ 10 MHz</button></div><h2 id="frequency">0 MHz</h2><button id="confirm-frequency" class="primary">Lock frequency</button>`;
    const update=()=>{document.getElementById('frequency')!.textContent=value*10+' MHz';beep(200+value*45);};bind('minus',()=>{value=Math.max(0,value-1);update();});bind('plus',()=>{value=Math.min(10,value+1);update();});bind('confirm-frequency',()=>{if(value===target)finish();else{status.textContent='Signal mismatch. Adjust the frequency.';beep(120);}});
  }else if(station.kind==='scan'){
    let progress=0,timer=0;content.innerHTML='<p class="muted">Remain inside the scanner until the biometric pass completes.</p><div class="scan-bed"><div class="scan-person"></div><i></i></div><div class="task-progress"><span></span></div><button id="begin-scan" class="primary">Begin scan</button>';
    bind('begin-scan',()=>{(document.getElementById('begin-scan')as HTMLButtonElement).disabled=true;status.textContent='Scanning life signs…';timer=window.setInterval(()=>{progress=Math.min(100,progress+4);(content.querySelector('.task-progress span')as HTMLElement).style.width=progress+'%';beep(250+progress*3,.025);if(progress>=100){clearInterval(timer);finish();}},90);});taskCleanup=()=>clearInterval(timer);
  }else if(station.kind==='swipe'){
    let position=0;content.innerHTML='<p class="muted">Move the authorization card through the reader at a steady pace.</p><div class="card-reader"><div class="card-track"><button id="auth-card">AURORA ACCESS</button></div></div><div class="actions"><button id="swipe-step">Slide card →</button></div>';
    const step=()=>{position++;const card=document.getElementById('auth-card')!;card.style.transform=`translateX(${Math.min(position,5)*70}px)`;beep(280+position*60,.06);status.textContent=position<5?'Keep a steady pace…':'Authorization accepted.';if(position>=5)setTimeout(finish,250);};bind('swipe-step',step);bind('auth-card',step);
  }else{
    const colors=['#f45b69','#ffd166','#58d099','#63cfff'];let selected=-1,done=0;const shuffled=[0,1,2,3].sort(()=>Math.random()-.5);content.innerHTML='<p class="muted">Connect each colored lead to its matching terminal.</p><div class="wire-board"><div>'+colors.map((c,i)=>`<button data-wire="${i}" style="--wire:${c}">LEAD ${i+1}</button>`).join('')+'</div><div>'+shuffled.map(i=>`<button data-port="${i}" style="--wire:${colors[i]}">PORT ${i+1}</button>`).join('')+'</div></div>';
    content.querySelectorAll<HTMLButtonElement>('[data-wire]').forEach(b=>b.onclick=()=>{selected=Number(b.dataset.wire);content.querySelectorAll('[data-wire]').forEach(x=>x.classList.toggle('active',x===b));status.textContent='Choose the matching port.';});
    content.querySelectorAll<HTMLButtonElement>('[data-port]').forEach(b=>b.onclick=()=>{if(selected<0){status.textContent='Select a lead first.';return;}if(Number(b.dataset.port)===selected){b.disabled=true;(content.querySelector(`[data-wire="${selected}"]`)as HTMLButtonElement).disabled=true;done++;selected=-1;beep(650,.08);status.textContent=`${done} / 4 leads routed`;if(done===4)finish();}else{selected=-1;content.querySelectorAll('[data-wire]').forEach(x=>x.classList.remove('active'));status.textContent='Wrong terminal. Trace the colors again.';beep(130);}});
  }
}
function appendMeetingLine(line:string,id?:number):void{
  const log=document.getElementById('meeting-log');if(!log)return;const split=line.indexOf(':'),prefix=split>0?line.slice(0,split):'',person=id===undefined?match?.people.find(p=>p.name===prefix):match?.people[id],effectiveId=person?.id;const row=document.createElement('p');row.className='chat-line'+(effectiveId===match?.localId?' self':'')+(person?.bot?' bot':'');
  const speaker=person?.name??(prefix||'SHIP'),message=id!==undefined?line:(split>0?line.slice(split+1).trim():line);const badge=document.createElement('span');badge.className='chat-avatar';badge.style.background=person?`#${person.color.toString(16).padStart(6,'0')}`:'#496174';const body=document.createElement('span'),name=document.createElement('strong');name.textContent=speaker+(person?.bot?' · BOT':'')+': ';body.append(name,document.createTextNode(message));row.append(badge,body);log.append(row);log.scrollTop=log.scrollHeight;
}
function sendMeetingChat():void{
  if(!match||mode!=='meeting'||!match.player.alive)return;const input=document.getElementById('meeting-chat')as HTMLInputElement|null,text=input?.value.replace(/\s+/g,' ').trim().slice(0,160)??'';if(!text)return;if(input)input.value='';
  meetingDialogueToken++;
  if(online){net?.action({k:'chat',text});return;}appendMeetingLine(text,match.player.id);const replies=match.chatReplies(text,match.player);replies.forEach((reply,i)=>setTimeout(()=>{if(mode==='meeting')appendMeetingLine(reply.text,reply.id);},260+i*380));
}
function meeting(lines?:string[]):void{
  if(!match)return;taskCleanup();mode='meeting';const m=match;
  const dialogue=lines??m.discussion();
  show(`<div class="panel wide meeting-panel"><div class="eyebrow">EMERGENCY ASSEMBLY / <span id="meeting-time">${Math.ceil(m.meetingTime||60)}</span>s TO VOTE</div><h2>Discuss. Question. Decide.</h2><p class="meeting-reason"><b>${m.meetingBody===null?'EMERGENCY':'BODY REPORTED'}</b> ${m.meetingReason}</p><div class="meeting-grid"><div class="discussion-column"><div class="log" id="meeting-log" aria-live="polite"><div class="chat-waiting"><i></i><span>Crew channel opened</span></div></div>${m.player.alive?'<form id="chat-form" class="chat-compose"><input id="meeting-chat" maxlength="160" autocomplete="off" aria-label="Message the crew" placeholder="Message the crew…"><button class="primary" type="submit">Send</button></form>':'<p class="ghost-chat">Ghosts cannot speak to the living crew.</p>'}<p class="hint">Ask by name or color: “Blue, where were you?” · “Who saw Red?” · “Where was the body?”</p></div><div class="vote-column"><div class="vote-heading"><span>VOTE BOARD</span><small>Choose only when you are ready</small></div><div class="votes">${m.people.filter(p=>p.alive).map(p=>`<button data-vote="${p.id}" ${!m.player.alive?'disabled':''}><span class="dot" style="background:#${p.color.toString(16).padStart(6,'0')}"></span>${p.name}${p.impostor&&m.player.impostor&&p.id!==m.player.id?' · PARTNER':''}</button>`).join('')}</div><div class="actions"><button id="skip" class="primary">${m.player.alive?'Skip vote':'Resolve crew vote'}</button></div></div></div></div>`);
  const dialogueToken=++meetingDialogueToken;dialogue.forEach((line,i)=>setTimeout(()=>{if(mode!=='meeting'||match!==m||meetingDialogueToken!==dialogueToken)return;document.querySelector('.chat-waiting')?.remove();appendMeetingLine(line);},320+i*620));const form=document.getElementById('chat-form')as HTMLFormElement|null;form?.addEventListener('submit',e=>{e.preventDefault();document.querySelector('.chat-waiting')?.remove();sendMeetingChat();});
  modal.querySelectorAll<HTMLButtonElement>('[data-vote]').forEach(b=>b.onclick=()=>resolveVote(Number(b.dataset.vote)));bind('skip',()=>resolveVote(-1));beep(290,.3);
}
function resolveVote(choice:number):void{if(!match||match.phase!=='meeting')return;if(online){net?.action({k:'vote',target:choice});show(`<div class="panel"><div class="eyebrow">VOTE LOCKED</div><h2>Waiting for the crew…</h2><p class="muted">Your vote cannot be changed.</p></div>`);return;}const m=match;const r=m.vote(choice);const summary=Object.entries(r.tally).map(([id,n])=>`${Number(id)<0?'Skip':m.people[Number(id)]!.name}: ${n}`).join(' · ');const text=r.ejected?`${r.ejected.name} was ejected. ${r.ejected.impostor?'They were the impostor.':'They were crew.'}`:'No one was ejected.';
  if(m.phase==='result'){processEvents();return;}mode='briefing';show(`<div class="panel"><div class="eyebrow">VOTE RESULTS</div><h2>${text}</h2><p class="muted">${summary}</p><p class="hint">${!m.player.alive?'As a ghost, complete your remaining tasks. You can no longer report or vote.':'The remaining crew return to their stations.'}</p><button id="continue" class="primary">Return to ship</button></div>`);bind('continue',()=>resume());}
function end():void{if(!match)return;mode='result';const win=match.winner===(match.player.impostor?'IMPOSTOR':'CREW'),impostors=match.people.filter(p=>p.impostor).map(p=>p.name).join(' · ')||'Awaiting final telemetry';show(`<div class="panel"><div class="eyebrow">MISSION DEBRIEF</div><h2 class="role ${win?'':'red'}">${win?'VICTORY':'DEFEAT'}</h2><h3>${match.winner} WINS</h3><p class="muted">${match.result}</p><p class="hint">Impostor${match.people.filter(p=>p.impostor).length===1?'':'s'}: ${impostors}<br>Time aboard: ${Math.floor(match.elapsed/60)}m ${Math.floor(match.elapsed%60)}s · Systems restored: ${Math.round(match.progress*100)}%</p><div class="actions"><button id="again" class="primary">New mission</button><button id="hangar">Hangar</button></div></div>`);bind('again',()=>start(match!.player.impostor?'impostor':'crew'));bind('hangar',home);beep(win?880:160,.4);}
function processEvents():void{if(!match)return;for(const e of match.events.splice(0)){if(e.type==='meeting')meeting();else if(e.type==='result')end();else{notify(e.text,6);beep(e.type==='death'?120:260,.3);}}}
function applyOnlineSnap(s:SfSnap):void{
  if(!match)return;match.elapsed=s.t;match.phase=s.phase;match.cooldown=s.cooldown;match.sabotage=s.sabotage;match.sabotageTime=s.sabotageTime;match.meetingTime=s.meetingTime;match.meetingReason=s.meetingReason;match.winner=s.winner;match.result=s.result;
  for(const row of s.people){const p=match.people[row[0]];if(!p)continue;p.x=row[1];p.z=row[2];p.yaw=row[3];p.alive=!!(row[4]&1);if(row[4]&2)p.impostor=true;}
  match.bodies=s.bodies.map(b=>({id:b[0],x:b[1],z:b[2],reported:!!b[3]}));match.tasks.forEach((t,i)=>t.done=!!s.tasks[i]);
}
function onlineEvent(e:SfEvent):void{
  if(!match)return;
  if(e.k==='meeting'){match.phase='meeting';match.meetingReason=e.text;meetingLines=e.lines??[];meeting(meetingLines);beep(250,.35);}
  else if(e.k==='eject')ejectAnimation(e);
  else if(e.k==='kill'){notify(e.text,4);beep(110,.2);}
  else if(e.k==='sabotage'){notify(e.text,5);beep(260,.3);}
  else if(e.k==='chat'){meetingDialogueToken++;document.querySelector('.chat-waiting')?.remove();appendMeetingLine(e.text,e.id);}
  else if(e.k==='result'){match.result=e.text;if(!modal.querySelector('.eject-scene'))end();}
}
function ejectAnimation(e:SfEvent):void{
  if(!match)return;mode='briefing';const person=e.id===undefined?null:match.people[e.id];const reveal=e.confirmed&&person?(e.impostor?'They were an impostor.':'They were not an impostor.'):'Their role remains unknown.';
  show(`<div class="eject-scene"><div class="stars-layer"></div>${person?`<div class="ejected-bean" style="--suit:#${person.color.toString(16).padStart(6,'0')}"><i></i></div>`:''}<h2>${e.text}</h2><p>${person?reveal:'The vote ended in a tie.'}</p></div>`);
  setTimeout(()=>{if(match?.phase==='result')end();else resume(false);},4200);
}
function updateHud():void{if(!match||!document.getElementById('room'))return;const m=match,p=m.player;document.getElementById('room')!.textContent=location(p);document.getElementById('role')!.textContent=!p.alive?'GHOST':p.impostor?'IMPOSTOR':'CREW';document.getElementById('progress')!.style.width=m.progress*100+'%';document.getElementById('tasks')!.innerHTML=p.impostor?`<div class="taskline alarm">ELIMINATE · ${m.cooldown>0?Math.ceil(m.cooldown)+'s':'READY'}</div><div class="taskline">Sabotage · ${m.sabotageCooldown>0?Math.ceil(m.sabotageCooldown)+'s':'READY'}</div>`:m.tasks.map(t=>`<div class="taskline ${t.done?'done':''}">${t.done?'✓':'◇'} ${t.room}</div>`).join('');document.getElementById('alive')!.textContent=`${m.people.filter(p=>p.alive).length} life signs · Crew tasks ${Math.round(m.progress*100)}%`;const alarm=document.getElementById('alarm')!;alarm.classList.toggle('alarm',!!m.sabotage);alarm.textContent=m.sabotage?`${m.sabotage.toUpperCase()} · ${Math.ceil(m.sabotageTime)}s`:'All systems nominal';
  const target=nearest();const body=p.alive&&m.bodies.some(b=>!b.reported&&distance(p,b)<3&&visible(p,b));const prompt=document.getElementById('prompt')!;prompt.classList.toggle('hidden',mode!=='play'||(!target&&!body));prompt.textContent=body?(padConnected()?'Y / △':'R')+' · Report body':target?(padConnected()?'A / ✕':'E')+' · '+target.label:'';
  document.getElementById('controls')!.innerHTML=padConnected()?'<b>LS</b> Move · <b>RS</b> Look · <b>A</b> Use · <b>Y</b> Report<br><b>View</b> Map · <b>Start</b> Pause'+(p.impostor?'<br><b>X</b> Eliminate · <b>B</b> Vent · <b>LB/RB</b> Sabotage':''):'<b>WASD</b> Move · <b>Mouse</b> Look · <b>E</b> Use · <b>R</b> Report<br><b>M</b> Map · <b>Esc</b> Pause'+(p.impostor?'<br><b>Q</b> Eliminate · <b>F</b> Vent · <b>Z/X</b> Sabotage':'');
  hud.querySelector('.crosshair')?.classList.toggle('ready',!!target||!!body);
  const killTarget=p.impostor&&p.alive&&m.cooldown<=0&&m.people.some(other=>other.alive&&!other.impostor&&distance(p,other)<2.25&&visible(p,other));
  const ventReady=p.impostor&&p.alive&&VENTS.some(v=>distance(p,v)<2);
  document.getElementById('act-use')?.toggleAttribute('disabled',!target);document.getElementById('act-report')?.toggleAttribute('disabled',!body);
  document.getElementById('act-kill')?.classList.toggle('hidden',!p.impostor);document.getElementById('act-kill')?.toggleAttribute('disabled',!killTarget);
  document.getElementById('act-kill')?.querySelector('span')?.replaceChildren(document.createTextNode(m.cooldown>0?String(Math.ceil(m.cooldown)):(padConnected()?'X':'Q')));
  document.getElementById('act-vent')?.classList.toggle('hidden',!p.impostor);document.getElementById('act-vent')?.toggleAttribute('disabled',!ventReady);
  hud.classList.toggle('is-ghost',!p.alive);hud.classList.toggle('is-alarm',!!m.sabotage);
  const room=location(p);if(previousRoom!==room){previousRoom=room;document.getElementById('room')?.animate([{opacity:.15,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:450});}
  updateObjective();
}

addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement&&e.target.type!=='range'){if(e.code==='Escape')e.target.blur();return;}if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.repeat)return;keys.add(e.code);if(mode==='play'){const actions:Record<string,()=>void>={KeyE:use,KeyR:report,KeyQ:eliminate,KeyF:vent,KeyZ:()=>sabotage('lights'),KeyX:()=>sabotage('reactor'),KeyM:openMap,KeyT:cycleTask,Escape:pause};actions[e.code]?.();}else if(e.code==='Escape'){if(mode==='pause'||mode==='map'||mode==='task'){taskCleanup();resume();}}});
addEventListener('keyup',e=>keys.delete(e.code));
function pauseOnBlur(): void {
  keys.clear();
  if (mode === 'task') { taskCleanup(); mode = 'play'; }
  if (mode === 'play') pause();
}
addEventListener('blur',pauseOnBlur);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseOnBlur();});
let dragging=false;
canvas.addEventListener('pointerdown',e=>{if(mode!=='play')return;if(e.pointerType==='mouse')lock();dragging=true;canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
addEventListener('mousemove',e=>{if(mode!=='play'||(document.pointerLockElement!==canvas&&!dragging))return;yaw-=e.movementX*sensitivity;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*sensitivity));});
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&mode==='play'&&!padConnected())pause();});
function padConnected():Gamepad|null{return [...(navigator.getGamepads?.()??[])].find(p=>p?.connected)??null;}
let prevButtons:boolean[]=[],focusIndex=0,navWait=0;
const dead=(v:number)=>Math.abs(v)<.18?0:Math.sign(v)*(Math.abs(v)-.18)/.82;
function padPoll(dt: number): { x: number; z: number } {
  const pad = padConnected();
  if (!pad) { if (prevButtons.length && mode === 'play') pause(); prevButtons = []; return {x:0,z:0}; }
  const pressed = (i: number) => !!pad.buttons[i]?.pressed && !prevButtons[i];
  if (mode === 'play') {
    yaw -= dead(pad.axes[2]??0)*dt*2.3*(sensitivity/.0022);
    pitch = Math.max(-1.35,Math.min(1.35,pitch-dead(pad.axes[3]??0)*dt*1.7*(sensitivity/.0022)));
    if (pressed(0)) use(); if (pressed(3)) report(); if (pressed(2)) eliminate(); if (pressed(1)) vent();
    if (pressed(4)) sabotage('lights'); if (pressed(5)) sabotage('reactor'); if (pressed(8)) openMap(); if (pressed(9)) pause();
    if (pressed(12)) cycleTask();
  } else {
    navWait -= dt; const elements = buttons();
    const direction = (pad.buttons[13]?.pressed || (pad.axes[1]??0)>.6) ? 1 : (pad.buttons[12]?.pressed || (pad.axes[1]??0)<-.6) ? -1 : 0;
    if (direction && navWait<=0) { focusIndex = (focusIndex+direction+elements.length)%Math.max(1,elements.length); navWait=.22; }
    focusIndex = Math.min(focusIndex,Math.max(0,elements.length-1));
    elements.forEach((el,i)=>el.classList.toggle('padfocus',i===focusIndex));
    const selected = elements[focusIndex];
    if (selected instanceof HTMLInputElement && selected.type==='range' && (pressed(14)||pressed(15))) {
      selected.value = String(Number(selected.value)+(pressed(15)?1:-1)*Number(selected.step)); selected.dispatchEvent(new Event('input'));
    }
    if (pressed(0) && selected) selected.click();
    if ((pressed(1)||pressed(9)) && (mode==='pause'||mode==='map'||mode==='task')) { taskCleanup(); resume(false); }
  }
  prevButtons = pad.buttons.map(b=>b.pressed);
  return {x:dead(pad.axes[0]??0),z:dead(pad.axes[1]??0)};
}
let last=performance.now(),uiTime=0;
function frame(now: number): void {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const pad = padPoll(dt);
  let moving=false,x=0,z=0;
  if (match && (mode === 'play' || mode === 'task')) {
    if (mode === 'play') {
      x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + pad.x;
      z = Number(keys.has('KeyS')) - Number(keys.has('KeyW')) + pad.z;
      const mag = Math.max(1, Math.hypot(x,z)); x /= mag; z /= mag;
      moving=Math.abs(x)+Math.abs(z)>.1;
      const speed = match.player.alive ? 4.3 : 5.6;
      match.move(match.player, (Math.cos(yaw)*x + Math.sin(yaw)*z)*speed*dt, (-Math.sin(yaw)*x + Math.cos(yaw)*z)*speed*dt);
    }
    if(online){lastNetInput-=dt;if(lastNetInput<=0){lastNetInput=.05;net?.input({x,z,yaw});}}else{match.step(dt);processEvents();}
  } else if (match && mode === 'meeting') {
    if(!online)match.meetingTime -= dt;
    const el = document.getElementById('meeting-time');
    if (el) el.textContent = String(Math.max(0,Math.ceil(match.meetingTime)));
    if (!online&&match.meetingTime <= 0) resolveVote(-1);
  }
  view.render(match,yaw,pitch,now/1000);
  audio.volume=volume;audio.update(dt,moving&&!!match?.player.alive,mode==='play'||mode==='task',match?.sabotage==='reactor');
  uiTime -= dt;
  if (uiTime <= 0) {
    uiTime = .12; updateHud();
    const p = document.getElementById('pad');
    if (p) p.textContent = padConnected() ? '● Controller connected — D-pad to navigate, A / ✕ to select' : 'Connect a controller and press any button to join.';
  }
  if (now > noticeUntil) toast.classList.add('hidden');
  requestAnimationFrame(frame);
}
home();requestAnimationFrame(frame);
