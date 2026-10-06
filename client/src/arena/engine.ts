import { AI_DECKS, DEFAULT_DECK, getCard, has } from './cards';
import type { BattleSnapshot, CardDefinition, Entity, PlayerState, Team, Vec2 } from './types';

const TICK = 1 / 30;
const ARENA_W = 18;
const ARENA_H = 30;
const RIVER_Y = 15;
const BRIDGES = [5, 13];
const dist = (a: Vec2,b: Vec2) => Math.hypot(a.x-b.x,a.y-b.y);
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export interface Command { type:'play'; team:Team; cardId:string; x:number; y:number }

export class BattleEngine {
  readonly fixedStep = TICK;
  time = 0;
  duration = 180;
  phase: BattleSnapshot['phase'] = 'countdown';
  countdown = 3.7;
  winner?: Team | 'draw';
  entities: Entity[] = [];
  blue: PlayerState;
  red: PlayerState;
  events: Array<{type:string; x:number; y:number; team?:Team; text?:string}> = [];
  private nextId = 1;
  private accumulator = 0;
  private aiTimer = 2;
  private rngState = 0xC0FFEE;
  private lastMultiplier = 1;
  private regulationChecked = false;
  private lastPlayed = new Map<Team,string>();
  debug = { infiniteElixir:false, speed:1, showRanges:false };

  constructor(blueDeck = BattleEngine.loadDeck(), redDeck = AI_DECKS[Math.floor(Math.random()*AI_DECKS.length)]!) {
    this.blue = this.makePlayer('blue','YOU',blueDeck);
    this.red = this.makePlayer('red','RIVAL',redDeck);
    this.spawnTowers();
  }

  static loadDeck(): string[] {
    try { const d=JSON.parse(localStorage.getItem('crownfall-deck')||'[]'); if(Array.isArray(d)&&d.length===8) return d; } catch {}
    return [...DEFAULT_DECK];
  }

  private makePlayer(team:Team,name:string,deck:string[]):PlayerState {
    const clean=deck.slice(0,8); while(clean.length<8) clean.push(DEFAULT_DECK[clean.length]!);
    return {team,name,elixir:5,deck:clean,cycle:clean.slice(4),hand:clean.slice(0,4),next:clean[4]!,crowns:0};
  }

  private spawnTowers():void {
    for(const team of ['blue','red'] as Team[]) {
      const y=team==='blue'?27:3, sideY=team==='blue'?24.4:5.6;
      this.addTower(team,9,y,'king',4800,7.2,165,1.05,false);
      this.addTower(team,4.6,sideY,'left',3050,7,150,.9,true);
      this.addTower(team,13.4,sideY,'right',3050,7,150,.9,true);
    }
  }

  private addTower(team:Team,x:number,y:number,role:Entity['towerRole'],hp:number,range:number,damage:number,hitSpeed:number,active:boolean):void {
    this.entities.push({id:this.nextId++,cardId:`${role}-tower`,name:role==='king'?'Crown Keep':'Guard Tower',team,kind:'tower',pos:{x,y},vel:{x:0,y:0},hp,maxHp:hp,damage,speed:0,range,hitSpeed,attackTimer:.4,radius:role==='king'?1.25:1,target:'all',mechanics:['ranged'],flying:false,lifetime:Infinity,age:0,towerRole:role,active,color:team==='blue'?'#34a9ff':'#ff4268',accent:'#ffe485'});
  }

  get multiplier():number { const left=this.duration-this.time; return left<=0?3:left<=60?2:1; }
  get snapshot():BattleSnapshot { return {time:this.time,duration:this.duration,overtime:this.time>=this.duration,multiplier:this.multiplier,phase:this.phase,winner:this.winner,entities:this.entities,blue:this.blue,red:this.red}; }
  rand():number { this.rngState=(1664525*this.rngState+1013904223)>>>0; return this.rngState/4294967296; }

  update(dt:number):void {
    this.accumulator += Math.min(dt,.1)*this.debug.speed;
    while(this.accumulator>=TICK){ this.step(TICK); this.accumulator-=TICK; }
  }

  step(dt=TICK):void {
    if(this.phase==='ended') return;
    if(this.phase==='countdown') { this.countdown-=dt; if(this.countdown<=0){this.phase='battle';this.events.push({type:'announce',x:9,y:15,text:'FIGHT!'});} return; }
    this.time+=dt;
    if(this.time>=this.duration&&!this.regulationChecked){this.regulationChecked=true;if(this.blue.crowns!==this.red.crowns){this.finish(this.blue.crowns>this.red.crowns?'blue':'red');return;}this.lastMultiplier=3;this.events.push({type:'announce',x:9,y:15,text:'SUDDEN DEATH · ×3'});}
    if(this.multiplier!==this.lastMultiplier){this.lastMultiplier=this.multiplier;this.events.push({type:'announce',x:9,y:15,text:`×${this.multiplier} ELIXIR`});}
    const regen=dt/(2.8/this.multiplier);
    this.blue.elixir=this.debug.infiniteElixir?10:Math.min(10,this.blue.elixir+regen);
    this.red.elixir=Math.min(10,this.red.elixir+regen);
    this.aiTimer-=dt; if(this.aiTimer<=0){this.aiMove();this.aiTimer=.55+this.rand()*.85;}
    for(const e of [...this.entities]) this.updateEntity(e,dt);
    this.resolveSeparation();
    this.cleanup();
    if(this.time>=this.duration+120) this.endByHealth();
  }

  canPlay(team:Team,cardId:string,x:number,y:number):boolean {
    if(this.phase!=='battle') return false;
    const p=team==='blue'?this.blue:this.red, c=getCard(cardId);
    if(!p.hand.includes(cardId)||(!this.debug.infiniteElixir&&p.elixir<c.cost)) return false;
    if(c.type==='spell'||has(c,'burrow')) return x>.5&&x<ARENA_W-.5&&y>.5&&y<ARENA_H-.5;
    const ownHalf=team==='blue'?y>RIVER_Y+.5:y<RIVER_Y-.5;
    if(!ownHalf) return false;
    return !this.entities.some(e=>(e.kind==='building'||e.kind==='tower')&&dist(e.pos,{x,y})<e.radius+1);
  }

  play(command:Command):boolean {
    const {team,cardId}=command; let {x,y}=command;
    if(!this.canPlay(team,cardId,x,y)) return false;
    const p=team==='blue'?this.blue:this.red, c=getCard(cardId);
    if(!this.debug.infiniteElixir) p.elixir-=c.cost;
    if(c.id==='mirror'){const prev=this.lastPlayed.get(team);if(prev){const mirrored=getCard(prev);this.spawnCard(mirrored,team,x,y,1.08);} }
    else this.spawnCard(c,team,x,y,1);
    this.lastPlayed.set(team,cardId);
    const i=p.hand.indexOf(cardId); p.hand.splice(i,1,p.next); p.cycle.push(cardId); p.next=p.cycle.shift()!;
    this.events.push({type:'deploy',x,y,team,text:c.name});
    return true;
  }

  private spawnCard(c:CardDefinition,team:Team,x:number,y:number,scale:number):void {
    if(c.type==='spell'){this.castSpell(c,team,x,y);return;}
    const spread=c.count>5?.8:c.count>1?.55:0;
    for(let i=0;i<c.count;i++){
      const a=(i/c.count)*Math.PI*2, ox=Math.cos(a)*spread, oy=Math.sin(a)*spread;
      this.entities.push({id:this.nextId++,cardId:c.id,name:c.name,team,kind:c.type==='building'?'building':'unit',pos:{x:clamp(x+ox,.5,17.5),y:clamp(y+oy,.5,29.5)},vel:{x:0,y:0},hp:c.hp*scale,maxHp:c.hp*scale,damage:c.damage*scale,speed:c.speed,range:c.range,hitSpeed:c.hitSpeed,attackTimer:.45+i*.04,radius:has(c,'tank')?.72:c.count>3?.28:.46,target:c.target,mechanics:[...c.mechanics],flying:has(c,'flying'),lifetime:c.type==='building'?30:Infinity,age:0,shield:has(c,'shield')?c.hp*.35:undefined,invisible:has(c,'invisible'),color:c.color,accent:c.accent});
    }
  }

  private castSpell(c:CardDefinition,team:Team,x:number,y:number):void {
    const enemies=this.entities.filter(e=>e.team!==team&&e.kind!=='effect'&&dist(e.pos,{x,y})<=c.range);
    const friends=this.entities.filter(e=>e.team===team&&e.kind!=='effect'&&dist(e.pos,{x,y})<=c.range);
    if(has(c,'clone')) { for(const e of friends.filter(e=>e.kind==='unit').slice(0,12)){const clone={...e,id:this.nextId++,pos:{x:e.pos.x+.3,y:e.pos.y+.3},hp:1,maxHp:1,shield:undefined};this.entities.push(clone);} }
    else if(has(c,'spawn')) {
      const spawnId=c.id==='barbarian-barrel'?'barbarians':c.id==='royal-delivery'?'royal-recruits':'goblins';
      const spawn=getCard(spawnId); this.spawnCard({...spawn,count:Math.min(c.count||1,4),hp:spawn.hp*.55},team,x,y,1);
    }
    for(const e of enemies.slice(0,has(c,'chain')?3:99)){
      let dmg=c.damage; if(e.kind==='tower') dmg*=.3; if(c.id==='void') dmg/=Math.max(1,enemies.length*.6);
      this.damage(e,dmg,team);
      if(has(c,'freeze'))e.frozen=4;if(has(c,'stun'))e.frozen=Math.max(e.frozen||0,.6);if(has(c,'slow'))e.slowed=3;
      if(has(c,'pull')){e.pos.x+=(x-e.pos.x)*.35;e.pos.y+=(y-e.pos.y)*.35;}
      if(has(c,'knockback')){const d=dist(e.pos,{x,y})||1;e.pos.x+=(e.pos.x-x)/d*.65;e.pos.y+=(e.pos.y-y)/d*.65;}
    }
    if(has(c,'rage')) for(const e of friends)e.raged=6;
    this.entities.push({id:this.nextId++,cardId:c.id,name:c.name,team,kind:'effect',pos:{x,y},vel:{x:0,y:0},hp:1,maxHp:1,damage:has(c,'dot')?c.damage/6:0,speed:0,range:c.range,hitSpeed:1,attackTimer:1,radius:c.range,target:'all',mechanics:[...c.mechanics],flying:false,lifetime:has(c,'dot')?6:1.1,age:0,color:c.color,accent:c.accent});
  }

  private updateEntity(e:Entity,dt:number):void {
    e.age+=dt;e.attackTimer-=dt;if(e.frozen)e.frozen=Math.max(0,e.frozen-dt);if(e.slowed)e.slowed=Math.max(0,e.slowed-dt);if(e.raged)e.raged=Math.max(0,e.raged-dt);
    if(e.kind==='effect'){if(e.damage>0&&e.attackTimer<=0){e.attackTimer=1;for(const v of this.entities.filter(v=>v.team!==e.team&&v.kind!=='effect'&&dist(v.pos,e.pos)<e.range))this.damage(v,e.damage/6,e.team);}return;}
    if(e.hp<=0||e.frozen) return;
    if(e.kind==='building'&&hasEntity(e,'spawner')&&e.age>2&&Math.floor(e.age/5)!==Math.floor((e.age-dt)/5)){const s=getCard(e.name.includes('Furnace')?'fire-spirit':e.name.includes('Tombstone')?'skeletons':'goblins');this.spawnCard({...s,count:Math.min(s.count,2),hp:s.hp*.72},e.team,e.pos.x,e.pos.y+(e.team==='blue'?-.8:.8),1);}
    const target=this.acquire(e); if(!target) return;e.targetId=target.id;
    const d=dist(e.pos,target.pos)-e.radius-target.radius;
    if(d<=e.range){if(e.attackTimer<=0){e.attackTimer=e.hitSpeed/(e.raged?1.35:1);this.attack(e,target);}return;}
    if(e.kind==='tower'||e.kind==='building')return;
    const waypoint=this.waypoint(e,target), dx=waypoint.x-e.pos.x,dy=waypoint.y-e.pos.y,len=Math.hypot(dx,dy)||1;
    const speed=e.speed*(e.slowed?.65:1)*(e.raged?1.25:1)*dt;
    e.vel.x=dx/len*speed;e.vel.y=dy/len*speed;e.pos.x=clamp(e.pos.x+e.vel.x,.35,17.65);e.pos.y=clamp(e.pos.y+e.vel.y,.35,29.65);
  }

  private waypoint(e:Entity,target:Entity):Vec2 {
    if(e.flying||hasEntity(e,'burrow'))return target.pos;
    const crossing=(e.pos.y-RIVER_Y)*(target.pos.y-RIVER_Y)<0;
    if(crossing&&Math.abs(e.pos.y-RIVER_Y)>1){const bridge=BRIDGES.reduce((a,b)=>Math.abs(e.pos.x-b)<Math.abs(e.pos.x-a)?b:a);return{x:bridge,y:RIVER_Y+(e.pos.y>RIVER_Y?-.3:.3)};}
    return target.pos;
  }

  private acquire(e:Entity):Entity|undefined {
    const old=this.entities.find(t=>t.id===e.targetId&&t.hp>0&&t.team!==e.team);if(old&&dist(e.pos,old.pos)<10&&this.validTarget(e,old))return old;
    let list=this.entities.filter(t=>t.team!==e.team&&t.hp>0&&t.kind!=='effect'&&this.validTarget(e,t));
    if(e.kind==='tower'||e.kind==='building')list=list.filter(t=>dist(e.pos,t.pos)<=e.range+1.5);
    list.sort((a,b)=>dist(e.pos,a.pos)-dist(e.pos,b.pos));return list[0];
  }

  private validTarget(e:Entity,t:Entity):boolean {
    if(t.invisible&&t.kind==='unit'&&dist(e.pos,t.pos)>1.6)return false;
    if(e.target==='buildings')return t.kind==='building'||t.kind==='tower';if(e.target==='ground')return !t.flying;return true;
  }

  private attack(e:Entity,t:Entity):void {
    e.invisible=false;let damage=e.damage;if(hasEntity(e,'charge')&&Math.hypot(e.vel.x,e.vel.y)>.02)damage*=1.7;if(hasEntity(e,'beam'))damage*=Math.min(4,1+e.age%4);
    this.damage(t,damage,e.team);this.events.push({type:'hit',x:t.pos.x,y:t.pos.y,team:e.team});
    if(hasEntity(e,'stun'))t.frozen=Math.max(t.frozen||0,.35);if(hasEntity(e,'slow'))t.slowed=1.5;
    if(hasEntity(e,'splash'))for(const v of this.entities.filter(v=>v.team!==e.team&&v.id!==t.id&&dist(v.pos,t.pos)<1.35))this.damage(v,damage*.45,e.team);
    if(hasEntity(e,'chain')){const v=this.entities.find(v=>v.team!==e.team&&v.id!==t.id&&v.hp>0&&dist(v.pos,t.pos)<2.5);if(v)this.damage(v,damage*.6,e.team);}
    if(hasEntity(e,'heal'))for(const v of this.entities.filter(v=>v.team===e.team&&v.kind==='unit'&&dist(v.pos,e.pos)<2.5))v.hp=Math.min(v.maxHp,v.hp+damage*.35);
  }

  private damage(e:Entity,amount:number,sourceTeam:Team):void {
    if(e.shield&&e.shield>0){const used=Math.min(e.shield,amount);e.shield-=used;amount-=used;}
    e.hp-=amount;if(e.kind==='tower'&&e.towerRole==='king'&&!e.active)e.active=true;
    if(e.hp<=0&&e.kind==='tower'){const p=sourceTeam==='blue'?this.blue:this.red;p.crowns+=e.towerRole==='king'?3-p.crowns:1;this.events.push({type:'tower',x:e.pos.x,y:e.pos.y,team:sourceTeam});if(e.towerRole==='king')this.finish(sourceTeam);}
  }

  private cleanup():void {
    const dead=this.entities.filter(e=>e.hp<=0||e.age>=e.lifetime);
    for(const e of dead){if(e.kind==='unit'||e.kind==='building')this.onDeath(e);}
    this.entities=this.entities.filter(e=>e.hp>0&&e.age<e.lifetime);
  }

  private onDeath(e:Entity):void {
    if(hasEntity(e,'deathBomb'))for(const v of this.entities.filter(v=>v.team!==e.team&&v.hp>0&&dist(v.pos,e.pos)<2.2))this.damage(v,e.damage*1.2,e.team);
    if(hasEntity(e,'deathSpawn')){const id=e.cardId.includes('lava')?'minions':e.cardId.includes('ram')?'barbarians':e.cardId.includes('cage')?'goblins':'skeletons';const s=getCard(id);this.spawnCard({...s,count:Math.min(3,s.count),hp:s.hp*.65},e.team,e.pos.x,e.pos.y,1);}
  }

  private resolveSeparation():void {
    const units=this.entities.filter(e=>e.kind==='unit'&&!e.flying);for(let i=0;i<units.length;i++)for(let j=i+1;j<units.length;j++){const a=units[i]!,b=units[j]!,d=dist(a.pos,b.pos),min=a.radius+b.radius;if(d>0&&d<min){const push=(min-d)*.08,dx=(a.pos.x-b.pos.x)/d,dy=(a.pos.y-b.pos.y)/d;a.pos.x+=dx*push;a.pos.y+=dy*push;b.pos.x-=dx*push;b.pos.y-=dy*push;}}
  }

  private aiMove():void {
    if(this.phase!=='battle')return;const options=this.red.hand.map(getCard).filter(c=>c.cost<=this.red.elixir);if(!options.length)return;
    const threatened=this.entities.filter(e=>e.team==='blue'&&e.kind==='unit'&&e.pos.y<11);let c:CardDefinition;
    if(threatened.length){c=options.find(c=>c.type==='spell'&&c.cost<=this.red.elixir)||options.find(c=>has(c,'splash'))||options[0]!;}
    else {if(this.red.elixir<6&&this.rand()<.7)return;c=options[Math.floor(this.rand()*options.length)]!;}
    const lane=this.rand()<.5?4.6:13.4,x=threatened[0]?.pos.x??lane,y=c.type==='spell'&&threatened[0]?threatened[0].pos.y:6.8+this.rand()*4;
    this.play({type:'play',team:'red',cardId:c.id,x,y});
  }

  private endByHealth():void {
    const hp=(t:Team)=>this.entities.filter(e=>e.team===t&&e.kind==='tower').reduce((s,e)=>s+Math.max(0,e.hp),0);const a=hp('blue'),b=hp('red');this.finish(a===b?'draw':a>b?'blue':'red');
  }
  private finish(winner:Team|'draw'):void{this.winner=winner;this.phase='ended';this.events.push({type:'announce',x:9,y:15,text:winner==='draw'?'DRAW':winner==='blue'?'VICTORY':'DEFEAT'});}
  forceEnd():void{this.endByHealth();}
}

function hasEntity(e:Entity,m:Entity['mechanics'][number]):boolean{return e.mechanics.includes(m);}
