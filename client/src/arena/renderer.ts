import * as THREE from 'three';
import type { BattleEngine } from './engine';
import type { Entity, Vec2 } from './types';
import { buildCardModel, buildTower } from './models';
import { getCard } from './cards';

type SceneEntity={group:THREE.Group;bar:THREE.Sprite;lastHp:number};
type Burst={mesh:THREE.Mesh;velocity:THREE.Vector3;life:number};
const W=18,H=30;
const to3=(p:Vec2,y=0)=>new THREE.Vector3(p.x-W/2,y,p.y-H/2);

export class ArenaRenderer {
  readonly canvas:HTMLCanvasElement;
  private renderer:THREE.WebGLRenderer;
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(38,1,.1,120);
  private raycaster=new THREE.Raycaster();
  private groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  private models=new Map<number,SceneEntity>();
  private bursts:Burst[]=[];
  private clock=new THREE.Clock();
  private water?:THREE.Mesh;
  private placement?:THREE.Mesh;
  private shake=0;

  constructor(private engine:BattleEngine){
    this.renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});this.canvas=this.renderer.domElement;this.canvas.className='arena-canvas';
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.scene.background=new THREE.Color('#111b3d');this.scene.fog=new THREE.Fog('#111b3d',35,63);this.camera.position.set(0,29,25);this.camera.lookAt(0,0,0);
    this.buildLights();this.buildArena();this.resize();addEventListener('resize',()=>this.resize());
  }

  private material(color:string,rough=.76,metal=.04){return new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal});}
  private addMesh(geo:THREE.BufferGeometry,material:THREE.Material,pos:THREE.Vector3,cast=true){const m=new THREE.Mesh(geo,material);m.position.copy(pos);m.castShadow=cast;m.receiveShadow=true;this.scene.add(m);return m;}
  private buildLights(){this.scene.add(new THREE.HemisphereLight('#b7d5ff','#223019',2.2));const sun=new THREE.DirectionalLight('#fff1ca',3.4);sun.position.set(-11,27,18);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-18;sun.shadow.camera.right=18;sun.shadow.camera.top=25;sun.shadow.camera.bottom=-25;sun.shadow.bias=-.0004;this.scene.add(sun);const rim=new THREE.DirectionalLight('#5e82ff',1.25);rim.position.set(15,12,-14);this.scene.add(rim);}

  private buildArena(){
    const grass=this.material('#527d38');this.addMesh(new THREE.BoxGeometry(19,.5,31),grass,new THREE.Vector3(0,-.38,0),false);
    const tileA=this.material('#5f8c41'),tileB=this.material('#4e7937');for(let z=0;z<15;z++)for(let x=0;x<9;x++){const m=new THREE.Mesh(new THREE.PlaneGeometry(1.92,1.92),((x+z)%2?tileA:tileB));m.rotation.x=-Math.PI/2;m.position.set(-7.7+x*1.92,.005,-13.5+z*1.92);m.receiveShadow=true;this.scene.add(m);}
    const stone=this.material('#758092'),darkStone=this.material('#485264');
    for(const side of [-1,1])for(let i=0;i<16;i++){const block=this.addMesh(new THREE.BoxGeometry(.72,.62,1.78),(i%2?stone:darkStone),new THREE.Vector3(side*9.42,.08,-13.5+i*1.8));block.rotation.y=(i%3-1)*.035;}
    for(const z of [-15.4,15.4])for(let i=0;i<10;i++)this.addMesh(new THREE.BoxGeometry(1.78,.6,.72),(i%2?stone:darkStone),new THREE.Vector3(-8.1+i*1.8,.08,z));
    const waterMat=new THREE.MeshPhysicalMaterial({color:'#1788bf',roughness:.22,metalness:.05,transparent:true,opacity:.9,clearcoat:1});this.water=this.addMesh(new THREE.BoxGeometry(18.8,.12,2.6),waterMat,new THREE.Vector3(0,-.03,0),false);
    for(const x of [-4,4])this.buildBridge(x);this.buildDecor();
    for(const e of this.engine.entities.filter(e=>e.kind==='tower'))this.addEntity(e);
  }

  private buildBridge(x:number){const wood=this.material('#9a6237'),edge=this.material('#d9a95c');for(let i=0;i<7;i++){const plank=this.addMesh(new THREE.BoxGeometry(2.55,.24,.42),i%2?wood:edge,new THREE.Vector3(x,.2,-1.28+i*.43));plank.rotation.y=(i%2?.015:-.015);}for(const sx of [-1.38,1.38]){this.addMesh(new THREE.BoxGeometry(.16,.22,3.2),edge,new THREE.Vector3(x+sx,.62,0));for(const z of [-1.3,0,1.3])this.addMesh(new THREE.CylinderGeometry(.09,.12,.9,8),edge,new THREE.Vector3(x+sx,.55,z));}}
  private buildDecor(){const rock=this.material('#5f6972'),gold=this.material('#f0bd46',.35,.45),blue=this.material('#278ed5'),red=this.material('#ce3d56'),leaf=this.material('#37733d'),flower=this.material('#ffcf67');for(const side of [-1,1])for(const z of [-12,-7,-2,3,8,13]){const r=this.addMesh(new THREE.DodecahedronGeometry(.3+((z+13)%3)*.08),rock,new THREE.Vector3(side*8.65,.22,z));r.rotation.set(z,z*.3,0);const bush=this.addMesh(new THREE.IcosahedronGeometry(.34,1),leaf,new THREE.Vector3(side*8.2,.3,z+.7));bush.scale.set(1.4,.8,1);}
    for(const team of ['red','blue'] as const){const z=team==='red'?-14.2:14.2,tm=team==='red'?red:blue;for(const x of [-6.8,6.8]){this.addMesh(new THREE.CylinderGeometry(.045,.06,2.8,8),gold,new THREE.Vector3(x,1.2,z));const flag=this.addMesh(new THREE.PlaneGeometry(1.25,.7),tm,new THREE.Vector3(x+.62,2.05,z));flag.name='flag';flag.rotation.y=team==='red'?0:Math.PI;}for(const x of [-7.6,7.6])for(let k=0;k<3;k++)this.addMesh(new THREE.OctahedronGeometry(.09),flower,new THREE.Vector3(x+k*.18,.13,z+(team==='red'?1:-1)*(1+k*.2)));}
    const centerRing=this.addMesh(new THREE.RingGeometry(1.4,1.52,48),this.material('#cfdf89'),new THREE.Vector3(0,.025,0),false);centerRing.rotation.x=-Math.PI/2;
  }

  private resize(){const w=this.canvas.clientWidth||innerWidth,h=this.canvas.clientHeight||innerHeight,dpr=Math.min(devicePixelRatio,1.75);this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  worldToScreen(p:Vec2):Vec2{const v=to3(p,1).project(this.camera),r=this.canvas.getBoundingClientRect();return{x:(v.x*.5+.5)*r.width,y:(-.5*v.y+.5)*r.height};}
  screenToWorld(x:number,y:number):Vec2{const r=this.canvas.getBoundingClientRect(),n=new THREE.Vector2((x-r.left)/r.width*2-1,-((y-r.top)/r.height)*2+1);this.raycaster.setFromCamera(n,this.camera);const v=new THREE.Vector3();this.raycaster.ray.intersectPlane(this.groundPlane,v);return{x:THREE.MathUtils.clamp(v.x+W/2,.1,W-.1),y:THREE.MathUtils.clamp(v.z+H/2,.1,H-.1)};}

  render(selected?:string,pointer?:Vec2){const dt=Math.min(.04,this.clock.getDelta()),t=performance.now()/1000;this.syncEntities(dt,t);this.animateArena(t);this.updatePlacement(selected,pointer);this.updateBursts(dt);const base=new THREE.Vector3(0,29,25);if(this.shake>.02){base.x+=(Math.random()-.5)*this.shake;base.y+=(Math.random()-.5)*this.shake*.4;this.shake*=.86;}this.camera.position.copy(base);this.camera.lookAt(0,0,0);this.renderer.render(this.scene,this.camera);this.consumeEvents();}

  private syncEntities(dt:number,t:number){const live=new Set(this.engine.entities.filter(e=>e.kind!=='effect').map(e=>e.id));for(const [id,v] of this.models)if(!live.has(id)){this.scene.remove(v.group,v.bar);this.models.delete(id);}
    for(const e of this.engine.entities){if(e.kind==='effect'){this.drawEffect(e,t);continue;}let v=this.models.get(e.id);if(!v){this.addEntity(e);v=this.models.get(e.id)!;}const p=to3(e.pos);v.group.position.x=THREE.MathUtils.lerp(v.group.position.x,p.x,.35);v.group.position.z=THREE.MathUtils.lerp(v.group.position.z,p.z,.35);v.group.position.y=e.flying?.8+Math.sin(t*4+e.id)*.12:0;const move=Math.hypot(e.vel.x,e.vel.y);v.group.rotation.z=THREE.MathUtils.lerp(v.group.rotation.z,move?Math.sin(t*10+e.id)*.06:0,.2);if(move){const angle=Math.atan2(e.vel.x,e.vel.y);v.group.rotation.y=angle+(e.team==='blue'?0:Math.PI);}const weapon=v.group.getObjectByName('weapon');if(weapon)weapon.rotation.z=-.35+(e.attackTimer<.18?Math.sin(e.attackTimer*45)*1.2:0);for(const wing of v.group.children.filter(x=>x.name==='wing'))wing.rotation.z+=Math.sin(t*8+e.id)*dt*.8;this.updateBar(v,e);}
  }
  private addEntity(e:Entity){let group:THREE.Group;if(e.kind==='tower')group=buildTower(e.team,e.towerRole==='king');else group=buildCardModel(getCard(e.cardId),e.team);group.position.copy(to3(e.pos));const ring=new THREE.Mesh(new THREE.RingGeometry(e.radius*.72,e.radius*.94,24),new THREE.MeshBasicMaterial({color:e.team==='blue'?'#39c9ff':'#ff486c',transparent:true,opacity:.78,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.035;group.add(ring);this.scene.add(group);const bar=this.makeBar(e);this.scene.add(bar);this.models.set(e.id,{group,bar,lastHp:e.hp});}
  private makeBar(e:Entity){const canvas=document.createElement('canvas');canvas.width=128;canvas.height=20;const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));s.scale.set(e.kind==='tower'?2.4:1.6,.25,1);s.userData.canvas=canvas;s.userData.texture=tex;return s;}
  private updateBar(v:SceneEntity,e:Entity){const c=v.bar.userData.canvas as HTMLCanvasElement,ctx=c.getContext('2d')!,pct=Math.max(0,e.hp/e.maxHp);ctx.clearRect(0,0,128,20);ctx.fillStyle='#11182b';ctx.roundRect(2,4,124,12,6);ctx.fill();ctx.fillStyle=e.team==='blue'?'#35bfff':'#ff4c69';ctx.roundRect(4,6,120*pct,8,4);ctx.fill();if(e.shield){ctx.strokeStyle='#dff9ff';ctx.lineWidth=2;ctx.strokeRect(3,5,121,10);}v.bar.userData.texture.needsUpdate=true;v.bar.position.copy(to3(e.pos,e.kind==='tower'?3.1:e.flying?3:2.15));v.bar.visible=e.kind==='tower'||e.hp<e.maxHp;}
  private drawEffect(e:Entity,t:number){const existing=this.scene.getObjectByName(`fx-${e.id}`) as THREE.Mesh|undefined;if(existing){existing.scale.setScalar(1+Math.sin(t*6)*.08);return;}const m=new THREE.Mesh(new THREE.RingGeometry(e.range*.72,e.range*.82,36),new THREE.MeshBasicMaterial({color:e.accent,transparent:true,opacity:.42,side:THREE.DoubleSide}));m.name=`fx-${e.id}`;m.rotation.x=-Math.PI/2;m.position.copy(to3(e.pos,.05));this.scene.add(m);setTimeout(()=>this.scene.remove(m),Math.max(100,e.lifetime*1000));}
  private updatePlacement(id?:string,p?:Vec2){if(!id||!p){if(this.placement)this.placement.visible=false;return;}const card=getCard(id),valid=this.engine.canPlay('blue',id,p.x,p.y);if(!this.placement){this.placement=new THREE.Mesh(new THREE.CircleGeometry(1,36),new THREE.MeshBasicMaterial({transparent:true,opacity:.3,side:THREE.DoubleSide}));this.placement.rotation.x=-Math.PI/2;this.scene.add(this.placement);}this.placement.visible=true;this.placement.position.copy(to3(p,.07));this.placement.scale.setScalar(card.type==='spell'?card.range:1);(this.placement.material as THREE.MeshBasicMaterial).color.set(valid?'#5be9ff':'#ff385e');}
  private animateArena(t:number){if(this.water){this.water.position.y=-.03+Math.sin(t*1.7)*.025;(this.water.material as THREE.MeshPhysicalMaterial).color.setHSL(.54,.72,.39+Math.sin(t*.8)*.025);}for(const f of this.scene.children.filter(o=>o.name==='flag'))f.rotation.z=Math.sin(t*3+f.position.x)*.07;}
  private consumeEvents(){for(const e of this.engine.events){if(!['hit','tower','deploy'].includes(e.type))continue;const p=to3(e,.4);const n=e.type==='tower'?30:e.type==='deploy'?12:6;this.shake=Math.max(this.shake,e.type==='tower'?.35:.06);for(let i=0;i<n;i++){const m=new THREE.Mesh(new THREE.TetrahedronGeometry(.05+Math.random()*.08),new THREE.MeshBasicMaterial({color:e.team==='blue'?'#55d6ff':'#ff5676'}));m.position.copy(p);this.scene.add(m);this.bursts.push({mesh:m,velocity:new THREE.Vector3((Math.random()-.5)*3,Math.random()*3,(Math.random()-.5)*3),life:.45+Math.random()*.45});}}this.engine.events.length=0;}
  private updateBursts(dt:number){for(const b of this.bursts){b.life-=dt;b.velocity.y-=6*dt;b.mesh.position.addScaledVector(b.velocity,dt);b.mesh.rotation.x+=dt*6;b.mesh.scale.setScalar(Math.max(0,b.life));}for(const b of this.bursts.filter(b=>b.life<=0))this.scene.remove(b.mesh);this.bursts=this.bursts.filter(b=>b.life>0);}
}
