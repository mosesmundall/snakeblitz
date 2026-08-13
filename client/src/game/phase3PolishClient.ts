import { GameScene } from "./GameScene";
import { GameNetwork, network } from "../network";
import { audio } from "./AudioManager";

// Final Phase 3 polish presentation: hybrid spawn callouts plus a lightweight
// procedural rattlesnake cue. The existing Phase 2 blackout remains the visual penalty.
const proto=GameNetwork.prototype as any;
if(!proto.__phase3PolishEventsInstalled){
  proto.__phase3PolishEventsInstalled=true;
  const originalAttach=proto.attach;
  proto.attach=function(room:any){
    originalAttach.call(this,room);
    room.onMessage("combo_spawn",(payload:any)=>this.dispatchEvent(new CustomEvent("combo_spawn",{detail:payload})));
  };
}

let rattleContext:AudioContext|undefined;
function playRattle(){
  if(!audio.isSfxEnabled())return;
  try{
    rattleContext??=new AudioContext();
    const ctx=rattleContext;
    if(ctx.state==="suspended")void ctx.resume();
    const duration=.30,length=Math.max(1,Math.floor(ctx.sampleRate*duration));
    const buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<length;i++){
      const t=i/ctx.sampleRate;
      const pulse=(Math.sin(t*Math.PI*2*27)>.25?1:.12);
      const envelope=Math.sin(Math.min(1,t/.035)*Math.PI/2)*Math.max(0,1-t/duration);
      data[i]=(Math.random()*2-1)*pulse*envelope;
    }
    const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    filter.type="bandpass";filter.frequency.value=2300;filter.Q.value=.8;gain.gain.value=.13;
    source.buffer=buffer;source.connect(filter).connect(gain).connect(ctx.destination);source.start();
  }catch{}
}
network.addEventListener("rattle_blackout",()=>playRattle());

const sceneProto=GameScene.prototype as any;
if(!sceneProto.__phase3PolishVisualsInstalled){
  sceneProto.__phase3PolishVisualsInstalled=true;
  const originalCreate=sceneProto.create;
  sceneProto.create=function(){
    originalCreate.call(this);
    if(this.__phase3PolishSceneHooks)return;
    this.__phase3PolishSceneHooks=true;
    network.addEventListener("combo_spawn",(event:any)=>{
      const d=event.detail??{},traits=Array.isArray(d.traits)?d.traits:[];
      if(!traits.length)return;
      this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0xffd36a,life:420,scale:.55,endScale:2.5,alpha:.55,depth:39});
      this.spawnFloatingText(d.x,d.y-30,`HYBRID - ${traits.join("+")}`,true,0xffd36a);
    });
  };
}
