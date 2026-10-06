import * as THREE from 'three';
import type { CardDefinition, Team } from './types';
import { has } from './cards';

const mat = (color: string, roughness=.72, metalness=.05) => new THREE.MeshStandardMaterial({color,roughness,metalness});
const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => { const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;return m; };
const box=(x:number,y:number,z:number,m:THREE.Material)=>mesh(new THREE.BoxGeometry(x,y,z),m);
const sphere=(r:number,m:THREE.Material)=>mesh(new THREE.SphereGeometry(r,12,8),m);
const cyl=(r:number,h:number,m:THREE.Material)=>mesh(new THREE.CylinderGeometry(r,r,h,10),m);

function addWeapon(root:THREE.Group, card:CardDefinition, metal:THREE.Material, wood:THREE.Material):void {
  const w=new THREE.Group();w.name='weapon';w.position.set(.42,.78,0);w.rotation.z=-.35;
  const shaft=cyl(.045,.9,wood);shaft.rotation.z=Math.PI/2;w.add(shaft);
  if(has(card,'ranged')){const bow=new THREE.Mesh(new THREE.TorusGeometry(.28,.035,6,12,Math.PI),metal);bow.rotation.y=Math.PI/2;bow.rotation.z=Math.PI/2;bow.position.x=.38;w.add(bow);}
  else if(has(card,'beam')||card.name.includes('P.E.K.K.A')){const blade=box(.12,.72,.16,metal);blade.position.x=.55;blade.rotation.z=Math.PI/2;w.add(blade);}
  else {const head=box(.3,.24,.24,metal);head.position.x=.45;w.add(head);}
  root.add(w);
}

function humanoid(card:CardDefinition, team:Team):THREE.Group {
  const g=new THREE.Group(), bodyMat=mat(card.color), accent=mat(card.accent,.45,.2), skin=mat(/Goblin|Bush/.test(card.name)?'#74bd4b':/Skeleton/.test(card.name)?'#e9e4d2':'#d9a06f'), dark=mat('#202a3e'), metal=mat('#b9c8d5',.3,.7), wood=mat('#6b4129');
  const scale=has(card,'tank')?1.32:has(card,'swarm')?.72:1;g.scale.setScalar(scale);
  const body=mesh(new THREE.CapsuleGeometry(.34,.5,4,8),bodyMat);body.position.y=.68;g.add(body);
  const head=sphere(.29,skin);head.position.y=1.3;head.scale.z=.9;g.add(head);
  const eye=mat(team==='blue'?'#74e7ff':'#ff8a9b',.25,.05);for(const x of [-.105,.105]){const e=sphere(.043,eye);e.position.set(x,1.34,.265);g.add(e);}
  if(/Knight|Prince|Guard|P.E.K.K.A|Recruit|Barbarian|Ronin|Bandit|Monk|Hunter|Executioner|Fisherman|Rider|Giant|Bowler|Valkyrie|Berserker/.test(card.name)){const helm=mesh(new THREE.SphereGeometry(.32,10,6,0,Math.PI*2,0,Math.PI*.58),accent);helm.position.y=1.4;g.add(helm);const crest=box(.08,.35,.34,bodyMat);crest.position.set(0,1.7,0);g.add(crest);}
  if(/Wizard|Witch|Princess|Archer|Musketeer|Firecracker|Mother|Queen/.test(card.name)){const hair=mesh(new THREE.SphereGeometry(.32,10,6,0,Math.PI*2,0,Math.PI*.55),accent);hair.position.y=1.39;g.add(hair);}
  for(const x of [-.18,.18]){const leg=cyl(.09,.48,dark);leg.position.set(x,.22,0);g.add(leg);}
  if(has(card,'shield')){const shield=mesh(new THREE.CylinderGeometry(.29,.29,.08,12),accent);shield.rotation.x=Math.PI/2;shield.position.set(-.42,.76,.12);g.add(shield);}
  addWeapon(g,card,metal,wood);
  if(card.name.includes('Giant')){const shoulder=box(1,.22,.55,accent);shoulder.position.y=1.06;g.add(shoulder);}
  return g;
}

function flyer(card:CardDefinition,team:Team):THREE.Group {
  const g=humanoid(card,team);g.scale.multiplyScalar(.85);g.position.y=.65;const wingMat=mat(card.accent,.6,.05);
  for(const side of [-1,1]){const wing=mesh(new THREE.ConeGeometry(.42,.9,3),wingMat);wing.name='wing';wing.position.set(side*.58,.94,0);wing.rotation.z=side*1.05;wing.rotation.y=side*.3;g.add(wing);}
  if(/Dragon|Phoenix/.test(card.name)){const snout=box(.42,.18,.38,mat(card.color));snout.position.set(0,1.25,.38);g.add(snout);}
  return g;
}

export function buildCardModel(card:CardDefinition,team:Team):THREE.Group {
  if(card.type==='building')return buildBuilding(card,team);
  if(card.type==='spell'){const g=new THREE.Group(), core=sphere(.44,mat(card.color,.25,.35));g.add(core);const ring=mesh(new THREE.TorusGeometry(.65,.08,8,24),mat(card.accent,.2,.5));ring.rotation.x=Math.PI/2;g.add(ring);return g;}
  const g=has(card,'flying')?flyer(card,team):humanoid(card,team);g.name=card.id;return g;
}

export function buildBuilding(card:CardDefinition,team:Team):THREE.Group {
  const g=new THREE.Group(), stone=mat('#4b5364'), trim=mat(team==='blue'?'#248ed6':'#c63251',.5,.15), roof=mat(card.color), wood=mat('#724c2c');
  const base=box(1.25,.3,1.25,stone);base.position.y=.15;g.add(base);
  const body=box(.9,.85,.9,wood);body.position.y=.72;g.add(body);
  if(/Hut|Tombstone|Cage|Collector|Drill/.test(card.name)){const top=mesh(new THREE.ConeGeometry(.78,.62,4),roof);top.position.y=1.45;top.rotation.y=Math.PI/4;g.add(top);}
  else {const barrel=cyl(.2,1.1,mat('#263246',.35,.7));barrel.name='weapon';barrel.rotation.x=Math.PI/2;barrel.position.set(0,1.25,.32);g.add(barrel);const rim=cyl(.55,.2,trim);rim.position.y=1;g.add(rim);}
  return g;
}

export function buildTower(team:Team,king=false):THREE.Group {
  const g=new THREE.Group(), stone=mat('#596375'), dark=mat('#31394c'), teamMat=mat(team==='blue'?'#208fd8':'#ce3554'), gold=mat('#f6c94c',.3,.55);
  const base=cyl(king?1.05:.78,.35,dark);base.position.y=.18;g.add(base);
  const body=box(king?1.55:1.2,king?1.75:1.42,king?1.55:1.2,stone);body.position.y=king?1.16:.92;g.add(body);
  const band=box(king?1.68:1.32,.22,king?1.68:1.32,teamMat);band.position.y=king?1.55:1.25;g.add(band);
  for(const x of [-.55,.55])for(const z of [-.55,.55]){const merlon=box(.34,.38,.34,stone);merlon.position.set(x*(king?1.15:.9),king?2.12:1.76,z*(king?1.15:.9));g.add(merlon);}
  const cannon=cyl(.16,.9,dark);cannon.name='weapon';cannon.rotation.x=Math.PI/2;cannon.position.set(0,king?2.05:1.7,.45);g.add(cannon);
  if(king){const crown=mesh(new THREE.ConeGeometry(.42,.55,5),gold);crown.position.y=2.55;g.add(crown);}return g;
}

export function portraitDataUrl(card:CardDefinition):string {
  const canvas=document.createElement('canvas');canvas.width=180;canvas.height=150;const c=canvas.getContext('2d')!;
  const grad=c.createLinearGradient(0,0,180,150);grad.addColorStop(0,card.accent);grad.addColorStop(1,card.color);c.fillStyle=grad;c.fillRect(0,0,180,150);
  c.fillStyle='rgba(6,13,35,.22)';c.beginPath();c.arc(145,15,70,0,7);c.fill();c.beginPath();c.arc(20,145,65,0,7);c.fill();
  c.save();c.translate(90,88);
  if(card.type==='spell'){c.strokeStyle='#fff';c.lineWidth=8;c.shadowColor=card.accent;c.shadowBlur=18;c.beginPath();c.arc(0,0,34,0,Math.PI*1.5);c.stroke();c.rotate(.7);for(let i=0;i<4;i++){c.rotate(Math.PI/2);c.fillStyle='#fff';c.fillRect(-4,-52,8,24);}}
  else if(card.type==='building'){c.fillStyle='#303a50';c.fillRect(-42,-20,84,58);c.fillStyle=card.color;c.beginPath();c.moveTo(-50,-20);c.lineTo(0,-63);c.lineTo(50,-20);c.fill();c.fillStyle='#dbe8ef';c.fillRect(-8,-7,16,45);c.strokeStyle='#fff8';c.lineWidth=4;c.strokeRect(-42,-20,84,58);}
  else {const gob=/Goblin|Bush/.test(card.name),skel=/Skeleton/.test(card.name);c.fillStyle=card.color;c.beginPath();c.ellipse(0,35,55,42,0,0,7);c.fill();if(has(card,'flying')){c.fillStyle=card.accent;c.beginPath();c.moveTo(-32,20);c.lineTo(-76,-20);c.lineTo(-42,35);c.moveTo(32,20);c.lineTo(76,-20);c.lineTo(42,35);c.fill();}c.fillStyle=gob?'#72bd4a':skel?'#eee9d8':'#d9a06f';c.beginPath();c.arc(0,-12,39,0,7);c.fill();if(/Knight|Prince|Guard|P.E.K.K.A|Ronin|Bandit|Rider|Valkyrie|Giant/.test(card.name)){c.fillStyle=card.accent;c.beginPath();c.arc(0,-22,42,Math.PI,Math.PI*2);c.lineTo(38,-8);c.lineTo(-38,-8);c.fill();}c.fillStyle='#fff';for(const x of [-13,13]){c.beginPath();c.arc(x,-12,7,0,7);c.fill();c.fillStyle='#17213d';c.beginPath();c.arc(x,-11,3,0,7);c.fill();c.fillStyle='#fff';}c.strokeStyle='#5a2630';c.lineWidth=4;c.beginPath();c.arc(0,1,14,.3,Math.PI-.3);c.stroke();}
  c.restore();c.strokeStyle='rgba(255,255,255,.45)';c.lineWidth=5;c.strokeRect(3,3,174,144);return canvas.toDataURL('image/webp',.82);
}
