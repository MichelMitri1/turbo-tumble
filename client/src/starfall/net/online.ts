import {Client,type Room}from'@colyseus/sdk';
import{defaultServerUrl}from'../../net/serverUrl';
import{SF_ROOM,SF_VERSION,SfMsg,type SfAction,type SfBegin,type SfConfig,type SfInput,type SfJoin,type SfLobby,type SfSnap,type SfEvent}from'./protocol';
export class StarfallNet{
 readonly url=defaultServerUrl();private sdk=new Client(this.url);room:Room|null=null;lobby:SfLobby|null=null;
 onLobby:((v:SfLobby)=>void)|null=null;onBegin:((v:SfBegin)=>void)|null=null;onSnap:((v:SfSnap)=>void)|null=null;onEvent:((v:SfEvent)=>void)|null=null;onError:((v:string)=>void)|null=null;onClosed:(()=>void)|null=null;
 get sessionId(){return this.room?.sessionId??''}get code(){return this.room?.roomId??''}
 async probe(){try{const r=await fetch(`${this.url.replace(/^ws/,'http')}/health`,{signal:AbortSignal.timeout(2500)});const j=await r.json()as{lan?:string[]};return{ok:r.ok,lan:j.lan??null};}catch{return{ok:false,lan:null}}}
 private opts(name:string,color:number,visibility?:'private'|'public'):SfJoin{return{version:SF_VERSION,name,color,visibility}}
 async create(name:string,color:number){this.attach(await this.sdk.create(SF_ROOM,this.opts(name,color,'private')))}
 async quick(name:string,color:number){this.attach(await this.sdk.joinOrCreate(SF_ROOM,this.opts(name,color,'public')))}
 async join(code:string,name:string,color:number){this.attach(await this.sdk.joinById(code.trim().toUpperCase(),this.opts(name,color)))}
 private attach(room:Room){this.room=room;room.onMessage(SfMsg.Lobby,(v:SfLobby)=>{this.lobby=v;this.onLobby?.(v)});room.onMessage(SfMsg.Begin,(v:SfBegin)=>this.onBegin?.(v));room.onMessage(SfMsg.Snap,(v:SfSnap)=>this.onSnap?.(v));room.onMessage(SfMsg.Event,(v:SfEvent)=>this.onEvent?.(v));room.onMessage(SfMsg.Error,(v:{msg:string})=>this.onError?.(v.msg));room.onLeave(()=>{this.room=null;this.onClosed?.()});room.send(SfMsg.Hello)}
 config(v:Partial<SfConfig>){this.room?.send(SfMsg.Config,v)}start(){this.room?.send(SfMsg.Start)}input(v:SfInput){this.room?.send(SfMsg.Input,v)}action(v:SfAction){this.room?.send(SfMsg.Action,v)}async leave(){const r=this.room;this.room=null;if(r)await r.leave(true).catch(()=>undefined)}
}
