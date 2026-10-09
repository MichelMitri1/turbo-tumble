/** Small synthesized ship soundscape; no downloaded audio or autoplay. */
export class ShipAudio {
  private ctx?:AudioContext; private master?:GainNode; private hum?:GainNode; private stepClock=0; private alarmClock=0;
  volume=.25;
  unlock():void {
    if(!this.ctx){this.ctx=new AudioContext();this.master=this.ctx.createGain();this.master.gain.value=this.volume;this.master.connect(this.ctx.destination);
      this.hum=this.ctx.createGain();this.hum.gain.value=0;this.hum.connect(this.master);
      for(const freq of [48,73]){const o=this.ctx.createOscillator();o.type='sine';o.frequency.value=freq;o.connect(this.hum);o.start();}
    }void this.ctx.resume();
  }
  tone(freq:number,length=.1):void{this.unlock();const ctx=this.ctx!,osc=ctx.createOscillator(),g=ctx.createGain();this.master!.gain.value=this.volume;osc.frequency.value=freq;g.gain.setValueAtTime(.13,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+length);osc.connect(g).connect(this.master!);osc.start();osc.stop(ctx.currentTime+length);}
  update(dt:number,moving:boolean,active:boolean,alarm:boolean):void {
    if(!this.ctx||!this.master||!this.hum)return;this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.08);this.hum.gain.setTargetAtTime(active?.027:0,this.ctx.currentTime,.35);
    this.stepClock-=dt;this.alarmClock-=dt;
    if(active&&moving&&this.stepClock<=0){this.stepClock=.39;this.tone(96,.07);}
    if(active&&alarm&&this.alarmClock<=0){this.alarmClock=1.6;this.tone(430,.25);}
  }
}
