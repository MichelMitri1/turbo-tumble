import * as T from 'three';
import { GRID, SCALE, ROOMS, CENTER, REACTOR, ELECTRICAL, VENTS } from './sim';

export const metal = (color: number, emissive = 0, strength = 1) => new T.MeshStandardMaterial({ color, roughness: .48, metalness: .36, emissive, emissiveIntensity: strength });

function texture(draw: (ctx: CanvasRenderingContext2D) => void, w = 512, h = 512): T.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d')!);
  const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace; map.anisotropy = 4;
  return map;
}

export function displayTexture(title: string, color = '#7de4e1'): T.CanvasTexture {
  return texture(c => {
    c.fillStyle = '#07121d'; c.fillRect(0,0,512,256);
    c.strokeStyle = '#203c4a'; c.lineWidth = 1;
    for (let x = 20; x < 512; x += 24) { c.beginPath(); c.moveTo(x,50); c.lineTo(x,220); c.stroke(); }
    for (let y = 55; y < 230; y += 24) { c.beginPath(); c.moveTo(20,y); c.lineTo(492,y); c.stroke(); }
    c.fillStyle = color; c.font = 'bold 24px monospace'; c.fillText(title,22,35);
    c.strokeStyle = color; c.lineWidth = 3; c.beginPath();
    for (let x = 22; x < 490; x++) { const y = 117 + Math.sin(x*.037)*16 + (x%113>99 ? -48 : 0); if(x===22)c.moveTo(x,y);else c.lineTo(x,y); } c.stroke();
    for (let i = 0; i < 8; i++) { c.fillStyle = i%3===0 ? '#d0ba73' : color; c.fillRect(25+i*59,177,38,10+i%3*6); }
    c.font = '14px monospace'; c.fillStyle = '#6e8d9e'; c.fillText('AURORA // FLIGHT SYSTEMS             ONLINE',22,238);
  },512,256);
}

/** Repeated ship structures share geometry and render in one draw per material. */
class Batches {
  private entries = new Map<T.Material,T.Matrix4[]>(); private dummy = new T.Object3D();
  box(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,ry=0):void {
    this.dummy.position.set(x,y,z); this.dummy.scale.set(w,h,d); this.dummy.rotation.set(0,ry,0); this.dummy.updateMatrix();
    const list = this.entries.get(m) ?? []; list.push(this.dummy.matrix.clone()); this.entries.set(m,list);
  }
  flush(parent:T.Object3D):void { const geo = new T.BoxGeometry(1,1,1); for (const [m,transforms] of this.entries) { const mesh = new T.InstancedMesh(geo,m,transforms.length); transforms.forEach((t,i)=>mesh.setMatrixAt(i,t)); mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh); } }
}

export class ShipWorld {
  readonly group = new T.Group(); readonly holograms: T.Object3D[] = []; readonly emergencyMaterials: T.MeshStandardMaterial[] = [];
  readonly roomLights: T.PointLight[] = []; readonly core: T.Mesh;
  private batch = new Batches(); private dark = metal(0x121f2e); private alloy = metal(0x839bac); private white = metal(0xa0b9c6);
  private floor: T.MeshStandardMaterial; private wall: T.MeshStandardMaterial; private cyan = metal(0x7bffff,0x32c9e6,2.4);
  constructor(scene:T.Scene) {
    scene.add(this.group);
    const floorMap = texture(c=>{ c.fillStyle='#607380';c.fillRect(0,0,512,512);c.strokeStyle='#344653';c.lineWidth=5;c.strokeRect(5,5,502,502);c.strokeStyle='#768692';c.lineWidth=2;c.strokeRect(12,12,488,488);for(let i=0;i<1300;i++){const x=(i*113)%512,y=(i*271)%512;c.fillStyle=i%2?'#ffffff07':'#00000009';c.fillRect(x,y,13,1);}for(const x of [22,490])for(const y of [22,490]){c.fillStyle='#223542';c.beginPath();c.arc(x,y,4,0,Math.PI*2);c.fill();} });
    const wallMap = texture(c=>{c.fillStyle='#92a8b5';c.fillRect(0,0,512,512);c.fillStyle='#526c7e';c.fillRect(0,329,512,125);c.fillStyle='#263e50';c.fillRect(0,335,512,10);c.fillRect(0,445,512,8);c.strokeStyle='#4f6677';c.lineWidth=4;c.strokeRect(8,8,496,496);c.fillStyle='#1c3449';for(let i=0;i<7;i++)c.fillRect(375,110+i*12,95,4);c.fillStyle='#dce6ea';c.font='18px monospace';c.fillText('A-09',28,63);});
    this.floor = metal(0x718a9d);this.floor.map=floorMap;this.floor.roughness=.74;
    this.wall = metal(0x869eb0);this.wall.map=wallMap;
    const ceiling=metal(0x293d50),light=metal(0xd7f6ff,0xbcefff,2.3);
    const accents = ROOMS.map(r=>metal(r.color,r.color,1.2));
    for(let z=0;z<GRID.length;z++)for(let x=0;x<GRID[z]!.length;x++){
      if(!GRID[z]![x])continue;const px=(x+.5)*SCALE,pz=(z+.5)*SCALE;
      const ri=ROOMS.findIndex(r=>x>=r.x&&x<r.x+r.w&&z>=r.z&&z<r.z+r.h), accent=accents[ri]??this.cyan;
      this.box(px,-.10,pz,SCALE-.015,.18,SCALE-.015,this.floor);this.box(px,3.65,pz,SCALE,.16,SCALE,ceiling);
      for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]]as const)if(!GRID[z+dz]?.[x+dx]){
        const window=(ri===0&&dz===-1&&x>=4&&x<=7)||(ri===6&&dz===1&&x>=22&&x<=25)||(ri===3&&dz===-1&&x>=12&&x<=13);
        if(window){this.box(px+dx*1.2,.34,pz+dz*1.2,dx?.15:SCALE,.68,dz?.15:SCALE,this.dark);this.box(px+dx*1.2,3.3,pz+dz*1.2,dx?.15:SCALE,.7,dz?.15:SCALE,this.dark);this.box(px+1.13,1.85,pz+dz*1.18,.13,2.7,.15,this.alloy);this.box(px,3.0,pz+dz*1.13,SCALE,.045,.07,accent);}
        else this.box(px+dx*1.2,1.8,pz+dz*1.2,dx?.13:SCALE,3.6,dz?.13:SCALE,this.wall);
        this.box(px+dx*1.1,.10,pz+dz*1.1,dx?.11:SCALE,.15,dz?.11:SCALE,this.dark);
        this.box(px+dx*1.015,.27,pz+dz*1.015,dx?.035:SCALE,.035,dz?.035:SCALE,accent);
        this.box(px+dx*1.04,3.25,pz+dz*1.04,dx?.11:SCALE,.14,dz?.11:SCALE,this.dark);
      }
      if((x+z)%3===0){this.box(px,3.49,pz,1.2,.12,.62,this.dark);this.box(px,3.42,pz,.92,.035,.40,light);}
      if(ri<0){this.box(px,.006,pz,.10,.01,.7,this.cyan);if((x+z)%3===0){this.box(px,3.23,pz,SCALE,.18,.18,this.alloy);this.box(px-1.06,1.6,pz,.12,3.2,.18,this.dark);this.box(px+1.06,1.6,pz,.12,3.2,.18,this.dark);}}
    }
    ROOMS.forEach((r,i)=>this.decorate(r,i,accents[i]!));
    // Clear landmarks for repair targets and the meeting console.
    this.cylinder(CENTER.x,.40,CENTER.z,.65,.80,this.dark);
    this.cylinder(CENTER.x,.82,CENTER.z,.83,.12,this.alloy);
    this.cylinder(CENTER.x,.91,CENTER.z,.24,.09,metal(0xff697a,0xf12e4b,2));
    this.sign('EMERGENCY / HOLD YOUR GROUND',CENTER.x,1.1,CENTER.z+.62,1.35,.18,0,'#f6b4b9');
    this.core = this.cylinder(REACTOR.x,1.7,REACTOR.z,.42,2.55,metal(0x9ffaff,0x46c7ec,2.5));
    for(const y of [.2,.65,2.8,3.2])this.cylinder(REACTOR.x,y,REACTOR.z,.76,.16,this.dark);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;this.box(REACTOR.x+Math.sin(a)*.62,1.7,REACTOR.z+Math.cos(a)*.62,.09,2.8,.09,this.alloy);}
    this.box(ELECTRICAL.x,.8,ELECTRICAL.z,1,1.6,.45,this.dark);
    for(let i=0;i<4;i++)this.box(ELECTRICAL.x-.30+i*.20,1.1,ELECTRICAL.z-.25,.1,.26,.05,accents[5]!);
    for(const v of VENTS){this.box(v.x,.014,v.z,1.5,.06,1.45,this.dark);for(let i=0;i<8;i++)this.box(v.x-.61+i*.17,.055,v.z,.075,.035,1.3,this.alloy);this.box(v.x,.065,v.z+.64,.22,.04,.035,metal(0xefc676,0xaf6418));}
    this.space();this.batch.flush(this.group);
  }
  private box(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,ry=0):void{this.batch.box(x,y,z,w,h,d,m,ry);}
  private cylinder(x:number,y:number,z:number,r:number,h:number,m:T.Material):T.Mesh{const mesh=new T.Mesh(new T.CylinderGeometry(r,r,h,32),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;this.group.add(mesh);return mesh;}
  private screen(x:number,y:number,z:number,title:string,color:string,ry=0):void{const mesh=new T.Mesh(new T.PlaneGeometry(1.2,.64),new T.MeshBasicMaterial({map:displayTexture(title,color)}));mesh.position.set(x,y,z);mesh.rotation.y=ry;this.group.add(mesh);}
  private sign(text:string,x:number,y:number,z:number,w:number,h:number,ry=0,color='#b4e3f8'):void{
    const map=texture(c=>{c.fillStyle='#0a1723';c.fillRect(0,0,1024,128);c.fillStyle=color;c.fillRect(0,0,8,128);c.font='bold 50px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(text,512,66,960);},1024,128);
    const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map}));mesh.position.set(x,y,z);mesh.rotation.y=ry;this.group.add(mesh);
  }
  private decorate(r:typeof ROOMS[number],index:number,accent:T.Material):void{
    const x=(r.x+r.w/2)*SCALE,z=(r.z+r.h/2)*SCALE,left=r.x*SCALE,right=(r.x+r.w)*SCALE,north=r.z*SCALE,south=(r.z+r.h)*SCALE;
    const hex='#'+r.color.toString(16).padStart(6,'0');
    this.sign(`0${index+1} / ${r.name.toUpperCase()}`,x,2.93,north+.12,4.6,.58,0,hex);
    this.box(x,.008,z,r.w*SCALE-1,.014,.065,accent);
    this.box(x,.009,north+1.05,r.w*SCALE-2,.016,.07,accent);
    // Soft room fill. Only the two closest lights are enabled by the view.
    const light=new T.PointLight(r.color,15,13,1.5);light.position.set(x,2.8,z);this.roomLights.push(light);this.group.add(light);
    for(let i=0;i<3;i++){
      const pz=north+2.5+i*2.9;
      this.box(right-.42,.55,pz,.8,1.1,1.8,this.dark);this.box(right-.49,1.14,pz,.9,.13,1.9,this.white);
      if(index!==4){this.screen(right-.91,1.75,pz,r.name.toUpperCase(),hex,-Math.PI/2);this.box(right-.42,2.05,pz,.34,1.1,1.7,this.dark);}
    }
    if(r.name==='Commons'){
      for(const side of [-1,1])for(let i=0;i<3;i++){const bx=side<0?left+.5:right-.6,bz=north+2+i*2.8;this.box(bx,.48,bz,.7,.25,1.8,this.white);this.box(bx-side*.20,.87,bz,.22,.65,1.8,this.dark);this.box(bx,.15,bz,.4,.3,1.5,this.dark);}
      this.sign('AURORA  /  DEEP SPACE RESEARCH',x,2.35,south-.09,6,.68,Math.PI);
      // Observatory imagery visible through the north windows.
      this.sign('NORTH  →  MEDBAY / BRIDGE / REACTOR',x+2.1,2.55,north+.18,3.5,.32);
      this.sign('SOUTH  →  CARGO / ELECTRICAL / NAV',x,2.95,south-.11,4.3,.38,Math.PI);
    }else if(r.name==='Medbay'){
      const glass=new T.MeshStandardMaterial({color:0x5ce1c2,transparent:true,opacity:.22,roughness:.14,metalness:.15,depthWrite:false});
      for(let i=0;i<3;i++){const bz=north+2.7+i*2.8;this.cylinder(left+.64,.15,bz,.49,.24,this.white);this.cylinder(left+.64,1.28,bz,.47,2.05,glass);this.cylinder(left+.64,2.35,bz,.49,.12,this.white);this.box(left+.61,1.2,bz,.14,1.4,.14,accent);}
      this.sign('+  LIFE SUPPORT / BIO LAB',x,2.4,south-.1,3.8,.5,Math.PI,hex);
    }else if(r.name==='Cargo'){
      const crate=metal(0x8c785a),strap=metal(0x3c4141);
      for(let i=0;i<5;i++){const cx=left+2+i*2.1;for(let j=0;j<(i%2)+1;j++){this.box(cx,.58+j*1.12,south-.62,1.55,1.06,.95,crate);this.box(cx,.58+j*1.12,south-1.11,.19,.99,.035,strap);this.box(cx-.52,.78+j*1.12,south-1.13,.23,.16,.025,accent);}}
      this.sign('CAUTION  /  SECURE ALL FREIGHT',x,2.85,south-.08,5,.42,Math.PI,'#f4cb76');
    }else if(r.name==='Electrical'){
      for(let i=0;i<4;i++){const bz=north+2+i*2.2;this.box(left+.38,1.45,bz,.6,2.8,1.7,this.dark);for(let j=0;j<7;j++)this.box(left+.72,.55+j*.28,bz,.04,.055,1.35,this.alloy);this.box(left+.75,2.35,bz+.45,.045,.09,.09,accent);}
      for(let i=0;i<4;i++)this.box(x-.65+i*.42,3.34,z,.12,.12,r.h*SCALE,this.dark);
    }else if(r.name==='Reactor'){
      this.sign('CONTAINMENT  /  CORE 01',REACTOR.x,2.95,north+.14,4,.48,0,'#ffb779');
      for(let i=0;i<4;i++)this.box(left+.55,.65,north+2.2+i*2.3,.75,1.3,1.6,this.dark);
    }else{
      for(let i=0;i<4;i++){const cx=left+2.2+i*2.7;this.box(cx,.52,(r.name==='Bridge'?north+.52:south-.52),2.1,1.04,.85,this.dark);this.box(cx,1.1,(r.name==='Bridge'?north+.67:south-.67),2.15,.12,.9,this.alloy);this.screen(cx,1.68,(r.name==='Bridge'?north+.75:south-.75),i%2?'ORBITAL TELEMETRY':'VECTOR / 009',hex,r.name==='Bridge'?0:Math.PI);}
      if(r.name==='Navigation'){
        const orb=new T.Mesh(new T.SphereGeometry(.61,20,12),new T.MeshBasicMaterial({color:0x57d9ef,wireframe:true,transparent:true,opacity:.55}));orb.position.set(right-.9,2.45,z);this.group.add(orb);this.holograms.push(orb);
      }
    }
  }
  private space():void{
    const map=texture(c=>{const g=c.createLinearGradient(0,0,1024,512);g.addColorStop(0,'#095565');g.addColorStop(.5,'#154c81');g.addColorStop(1,'#040e29');c.fillStyle=g;c.fillRect(0,0,1024,512);for(let i=0;i<90;i++){c.fillStyle=`rgba(154,209,234,${.04+(i%5)*.016})`;c.beginPath();c.ellipse((i*197)%1024,(i*83)%512,90+i%31,4+i%13,-.17,0,Math.PI*2);c.fill();}},1024,512);
    const planet=new T.Mesh(new T.SphereGeometry(28,64,40),new T.MeshBasicMaterial({map,color:0x92b8e2}));planet.position.set(29,8,-70);this.group.add(planet);
    const ring=new T.Mesh(new T.RingGeometry(35,47,100),new T.MeshBasicMaterial({color:0x5680ad,transparent:true,opacity:.26,side:T.DoubleSide}));ring.position.copy(planet.position);ring.rotation.set(1.2,.12,.3);this.group.add(ring);
    const glow=new T.Mesh(new T.SphereGeometry(28.6,48,32),new T.MeshBasicMaterial({color:0x348ede,transparent:true,opacity:.08,side:T.BackSide}));glow.position.copy(planet.position);this.group.add(glow);
    const data:number[]=[];for(let i=0;i<1200;i++){const a=i*2.39996;const y=((i*73)%401)-200;data.push(Math.sin(a)*145,y,Math.cos(a)*145);}
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(data,3));this.group.add(new T.Points(geo,new T.PointsMaterial({size:.18,color:0xb5d8ff,fog:false})));
  }
  update(time:number,position:T.Vector3,dark:boolean,alarm:boolean):void{
    this.holograms.forEach(h=>h.rotation.y=time*.25);
    (this.core.material as T.MeshStandardMaterial).emissiveIntensity=alarm?2+Math.sin(time*5):1.6+Math.sin(time*1.6)*.3;
    (this.core.material as T.MeshStandardMaterial).emissive.setHex(alarm?0xf34a25:0x46c7ec);
    const nearest=[...this.roomLights].sort((a,b)=>a.position.distanceToSquared(position)-b.position.distanceToSquared(position)).slice(0,2);
    this.roomLights.forEach(l=>{l.visible=nearest.includes(l);l.intensity=dark?0:15;});
  }
}
