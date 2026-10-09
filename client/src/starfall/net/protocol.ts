export const SF_ROOM='starfall',SF_VERSION=1,SF_MAX=12;
export const SfMsg={Hello:'sf:hello',Config:'sf:cfg',Start:'sf:start',Input:'sf:in',Action:'sf:act',Lobby:'sf:lobby',Begin:'sf:begin',Snap:'sf:snap',Event:'sf:event',Error:'sf:err'} as const;
export interface SfConfig { players:number; impostors:1|2; bots:number; crewVision:number; impostorVision:number; killCooldown:number; confirmEjects:boolean; }
export interface SfJoin { version:number; name:string; color:number; visibility?:'private'|'public' }
export interface SfLobby { code:string; phase:'lobby'|'playing'|'over'; hostId:string; config:SfConfig; players:Array<{id:string;name:string;color:number;connected:boolean}>; lan:boolean }
export interface SfBegin { me:number; people:Array<{id:number;name:string;color:number;bot:boolean}>; role:'crew'|'impostor'; partners:number[]; config:SfConfig }
export interface SfInput { x:number;z:number;yaw:number }
export type SfAction={k:'kill';target:number}|{k:'report';body:number}|{k:'emergency'}|{k:'sabotage';kind:'lights'|'reactor'}|{k:'fix'}|{k:'vent'}|{k:'task';index:number}|{k:'vote';target:number}|{k:'chat';text:string};
export interface SfSnap { t:number;phase:'play'|'meeting'|'result';people:Array<[number,number,number,number,number]>;bodies:Array<[number,number,number,number]>;progress:number;cooldown:number;sabotage:'lights'|'reactor'|null;sabotageTime:number;meetingTime:number;meetingReason:string;winner:string;result:string;tasks:number[] }
export interface SfEvent { k:'meeting'|'kill'|'eject'|'sabotage'|'result'|'chat'; text:string;id?:number;impostor?:boolean;confirmed?:boolean;lines?:string[] }
