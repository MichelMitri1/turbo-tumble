import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Match, distance, location, CENTER } from './sim';
import { ShipWorld, metal, displayTexture } from './world';

interface CrewRig { group:T.Group; legs:T.Group[]; arms:T.Group[]; label:T.Sprite; shadow:T.Mesh; last:T.Vector2; moving:number; }
export type Quality = 'high' | 'balanced' | 'low';
export class ShipView {
  readonly renderer:T.WebGLRenderer;
  readonly scene=new T.Scene();
  readonly camera=new T.PerspectiveCamera(76,1,.08,200);
  readonly actors=new T.Group();
  private world:ShipWorld;
  private composer:EffectComposer;
  private bloom:UnrealBloomPass;
  private quality:Quality='balanced';
  private figures:CrewRig[]=[];
  private stations:T.Mesh[]=[];
  private markers:T.Mesh[]=[];
  private ambient:T.HemisphereLight;
  private lamp:T.SpotLight;
  private fog=new T.FogExp2(0x071525,.012);
  private lastTime=0;
  private hands=new T.Group();
  private direction=new T.Vector3();
  private vision=12;
  constructor(canvas:HTMLCanvasElement) {
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.12;
    this.renderer.shadowMap.enabled=false;this.renderer.shadowMap.type=T.PCFShadowMap;
    this.scene.background=new T.Color(0x020611);this.scene.fog=this.fog;
    const pmrem=new T.PMREMGenerator(this.renderer),environment=new RoomEnvironment();
    this.scene.environment=pmrem.fromScene(environment,.05).texture;
    this.scene.environmentIntensity=.28;environment.dispose();pmrem.dispose();
    this.ambient=new T.HemisphereLight(0xb9d7f2,0x233546,1.55);this.scene.add(this.ambient);
    this.lamp=new T.SpotLight(0xd6e9ff,35,24,1.12,.75,1.5);
    this.lamp.castShadow=true;this.lamp.shadow.mapSize.set(1024,1024);this.lamp.shadow.bias=-.0004;this.lamp.shadow.normalBias=.025;
    this.scene.add(this.lamp,this.lamp.target);
    this.world=new ShipWorld(this.scene);this.scene.add(this.actors,this.camera);
    this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));
    this.bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.24,.4,1.1);
    this.composer.addPass(this.bloom);this.composer.addPass(new OutputPass());
    this.makeHands();this.setup(new Match('crew'));this.resize();addEventListener('resize',()=>this.resize());
  }
  setQuality(value:Quality):void { this.quality=value;this.renderer.shadowMap.enabled=value==='high';this.bloom.enabled=value!=='low';this.resize(); }
  setFov(value:number):void { this.camera.fov=value;this.camera.updateProjectionMatrix(); }
  setVision(value:number):void{this.vision=value;}
  private mesh(geometry:T.BufferGeometry,material:T.Material,parent:T.Object3D,x=0,y=0,z=0):T.Mesh {
    const m=new T.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  private box(parent:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,mat:T.Material):T.Mesh{return this.mesh(new T.BoxGeometry(w,h,d),mat,parent,x,y,z);}
  private label(text:string):T.Sprite {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const c=canvas.getContext('2d')!;
    c.fillStyle='#091421cb';c.beginPath();c.roundRect(4,5,248,54,16);c.fill();c.font='600 29px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#e8f6ff';c.fillText(text,128,34);
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    return new T.Sprite(new T.SpriteMaterial({map,depthTest:true,transparent:true}));
  }
  private makeHands():void {
    const suit=metal(0x46a6b9),rubber=metal(0x182b3d);
    for(const side of [-1,1]){const wrist=new T.Group();wrist.position.set(side*.40,-.50,-.63);wrist.rotation.set(-.6,side*-.25,side*-.16);
      this.mesh(new T.CapsuleGeometry(.085,.21,4,12),suit,wrist,0,-.11,0);this.mesh(new T.SphereGeometry(.095,12,8),rubber,wrist,0,.08,0);
      const cuff=this.mesh(new T.CylinderGeometry(.097,.097,.055,12),rubber,wrist,0,-.01,0);cuff.castShadow=false;this.hands.add(wrist);
    }this.camera.add(this.hands);
  }
  setup(match:Match):void {
    const geometries=new Set<T.BufferGeometry>(),mats=new Set<T.Material>(),textures=new Set<T.Texture>();
    this.actors.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>mats.add(m));}else if(o instanceof T.Sprite)mats.add(o.material);});
    mats.forEach(m=>{for(const key of ['map','emissiveMap'] as const){const map=(m as T.MeshStandardMaterial)[key];if(map)textures.add(map);}m.dispose();});textures.forEach(t=>t.dispose());geometries.forEach(g=>g.dispose());
    this.actors.clear();this.figures=[];this.stations=[];this.markers=[];
    const rubber=metal(0x182333),trim=metal(0xb6c9d6),visor=new T.MeshPhysicalMaterial({color:0x192f4a,roughness:.12,metalness:.75,clearcoat:1,clearcoatRoughness:.08});
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d')!;const gradient=ctx.createRadialGradient(32,32,3,32,32,31);gradient.addColorStop(0,'#000000b0');gradient.addColorStop(1,'#00000000');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);const shadowMap=new T.CanvasTexture(shadowCanvas);
    for(const p of match.people){
      const group=new T.Group(),suit=metal(p.color);suit.roughness=.35;suit.metalness=.2;
      this.mesh(new T.CapsuleGeometry(.33,.43,8,20),suit,group,0,.96,0);
      const helmet=this.mesh(new T.SphereGeometry(.365,24,18),suit,group,0,1.46,0);helmet.scale.set(1,1,.93);
      const frame=this.mesh(new T.SphereGeometry(.30,24,14),rubber,group,0,1.46,-.235);frame.scale.set(1.05,.69,.42);
      const glass=this.mesh(new T.SphereGeometry(.278,24,14),visor,group,0,1.47,-.284);glass.scale.set(1.06,.67,.31);
      const reflection=this.mesh(new T.SphereGeometry(.16,16,8),new T.MeshBasicMaterial({color:0xbdeaff,transparent:true,opacity:.44}),group,-.09,1.54,-.359);reflection.scale.set(1,.15,.08);
      this.box(group,0,1.05,.34,.46,.6,.28,rubber);this.box(group,0,1.05,.50,.36,.46,.05,suit);
      this.box(group,0,.83,-.29,.32,.22,.09,rubber);this.box(group,.075,.86,-.342,.085,.045,.025,metal(0x8cffdd,0x67d6ba,1.8));
      for(const x of [-.20,.20])this.box(group,x,1.0,-.265,.047,.57,.06,trim);
      const legs:T.Group[]=[],arms:T.Group[]=[];
      for(const side of [-1,1]){
        const leg=new T.Group();leg.position.set(side*.18,.60,0);this.mesh(new T.CapsuleGeometry(.125,.26,5,12),suit,leg,0,-.19,0);const boot=this.mesh(new T.CapsuleGeometry(.132,.12,5,12),rubber,leg,0,-.46,-.06);boot.rotation.x=Math.PI/2;group.add(leg);legs.push(leg);
        const arm=new T.Group();arm.position.set(side*.36,1.13,0);this.mesh(new T.CapsuleGeometry(.10,.27,5,12),suit,arm,side*.015,-.17,0);this.mesh(new T.SphereGeometry(.11,12,8),rubber,arm,side*.015,-.39,0);group.add(arm);arms.push(arm);
      }
      const label=this.label(p.name);label.position.y=2.07;label.scale.set(1.25,.31,1);group.add(label);group.position.set(p.x,0,p.z);this.actors.add(group);
      const shadow=this.mesh(new T.PlaneGeometry(1.3,1.3),new T.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,opacity:.6}),this.actors,p.x,.015,p.z);shadow.rotation.x=-Math.PI/2;shadow.castShadow=false;
      this.figures.push({group,legs,arms,label,shadow,last:new T.Vector2(p.x,p.z),moving:0});
    }
    match.tasks.forEach(t=>{
      const console=new T.Group();console.position.set(t.x,0,t.z);this.actors.add(console);
      this.box(console,0,.43,0,.63,.86,.57,rubber);this.box(console,0,.93,0,1.0,.14,.76,trim);
      const map=displayTexture(t.room.toUpperCase());const screen=this.mesh(new T.PlaneGeometry(.89,.57),new T.MeshStandardMaterial({map,emissive:0x9cfde9,emissiveMap:map,emissiveIntensity:.75,roughness:.3}),console,0,1.12,-.08);screen.rotation.x=-.55;this.stations.push(screen);
      for(let i=0;i<5;i++)this.box(console,-.32+i*.16,1.025,.27,.10,.04,.11,i===4?metal(0xffba65,0x835521):rubber);
      const marker=this.mesh(new T.OctahedronGeometry(.10),new T.MeshBasicMaterial({color:0x89ffe1}),console,0,1.98,0);marker.castShadow=false;this.markers.push(marker);
    });
  }
  render(match:Match|null,yaw:number,pitch:number,time:number):void {
    const dt=Math.min(.05,Math.max(.001,time-this.lastTime));this.lastTime=time;
    const dark=match?.sabotage==='lights',alarm=match?.sabotage==='reactor';
    if(match){
      const p=match.player;this.camera.position.set(p.x,p.alive?1.62:2,p.z);this.camera.rotation.order='YXZ';this.camera.rotation.set(pitch,yaw,0);
      this.figures.forEach((rig,i)=>{
        const person=match.people[i]!,corpse=match.bodies.find(b=>b.id===i&&!b.reported);const moved=Math.hypot(person.x-rig.last.x,person.z-rig.last.y)/dt;
        rig.moving=T.MathUtils.lerp(rig.moving,Math.min(1,moved/2),Math.min(1,dt*12));rig.last.set(person.x,person.z);
        rig.group.visible=i!==p.id&&(person.alive||!!corpse)&&distance(p,person)<=this.vision;
        rig.group.position.set(person.alive?person.x:corpse?.x??person.x,person.alive?Math.sin(time*9+i)*.025*rig.moving:.37,person.alive?person.z:corpse?.z??person.z);
        rig.group.rotation.set(person.alive?0:Math.PI/2,person.yaw+Math.PI,0);
        rig.legs.forEach((leg,j)=>leg.rotation.x=Math.sin(time*9+i+j*Math.PI)*.48*rig.moving);
        rig.arms.forEach((arm,j)=>arm.rotation.x=-Math.sin(time*9+i+j*Math.PI)*.36*rig.moving);
        rig.label.visible=person.alive&&distance(p,person)<(dark?4:10);
        rig.shadow.visible=rig.group.visible;rig.shadow.position.set(rig.group.position.x,.019,rig.group.position.z);
      });
      this.stations.forEach((s,i)=>{(s.material as T.MeshStandardMaterial).emissiveIntensity=match.tasks[i]!.done ? .15 : .75;this.markers[i]!.visible=!match.tasks[i]!.done;this.markers[i]!.rotation.y=time;this.markers[i]!.position.y=1.98+Math.sin(time*2.7+i)*.06;});
      this.hands.visible=p.alive;this.hands.position.y=Math.sin(time*2)*.006;
    }else{
      this.camera.position.set(CENTER.x+4.3+Math.sin(time*.12)*.35,1.9,CENTER.z+5.0);this.camera.lookAt(CENTER.x+.8,1.35,CENTER.z-1.1);this.hands.visible=false;
      this.figures.forEach((rig,i)=>{rig.group.visible=i!==0;rig.label.visible=false;rig.group.rotation.y=Math.PI*.75;rig.group.position.y=Math.sin(time*2+i)*.012;rig.legs.forEach(l=>l.rotation.x=0);rig.arms.forEach(l=>l.rotation.x=Math.sin(time*1.5+i)*.02);});
    }
    this.ambient.intensity=dark?.12:1.55;this.scene.environmentIntensity=dark?.03:.28;
    this.fog.color.setHex(dark?0x02050b:0x071525);this.fog.density=dark?.18:.010;
    this.camera.getWorldDirection(this.direction);this.lamp.position.copy(this.camera.position);this.lamp.position.y+=.18;this.lamp.target.position.copy(this.camera.position).addScaledVector(this.direction,5);
    this.lamp.intensity=dark?9:35;this.lamp.distance=dark?6:24;this.lamp.color.setHex(alarm?0xff5677:0xd6e9ff);
    this.world.update(time,this.camera.position,dark,alarm);
    if(this.quality==='low')this.renderer.render(this.scene,this.camera);else this.composer.render();
  }
  resize():void {
    const ratio=Math.min(devicePixelRatio,this.quality==='high'?2:this.quality==='balanced'?1.35:1);
    this.renderer.setPixelRatio(ratio);this.renderer.setSize(innerWidth,innerHeight);this.composer.setPixelRatio(ratio);this.composer.setSize(innerWidth,innerHeight);
    this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();
  }
  room(match:Match):string{return location(match.player);}
}
