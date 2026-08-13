import { GameScene } from "./GameScene";
import { GameNetwork, network } from "../network";

// Cheap Phase 2 presentation: one tint per special snake, one reusable blackout
// rectangle, pooled healer rings and short-lived geometric charge telegraphs.

const SPECIAL_EVENTS=["healer_pulse","rattle_blackout","charger_telegraph","golden_reward","golden_escaped"];

const networkProto=GameNetwork.prototype as any;
if(!networkProto.__phase2EventsInstalled){
  networkProto.__phase2EventsInstalled=true;
  const originalAttach=networkProto.attach;
  networkProto.attach=function(room:any){
    originalAttach.call(this,room);
    for(const name of SPECIAL_EVENTS){
      room.onMessage(name,(payload:any)=>this.dispatchEvent(new CustomEvent(name,{detail:payload})));
    }
  };
}

const sceneProto=GameScene.prototype as any;
if(!sceneProto.__phase2VisualsInstalled){
  sceneProto.__phase2VisualsInstalled=true;

  const originalCreateSnakeVisual=sceneProto.createSnakeVisual;
  sceneProto.createSnakeVisual=function(snake:any){
    const visual=originalCreateSnakeVisual.call(this,snake);
    const tint:Record<string,number>={
      GOLDEN:0xffd34f,
      HEALER:0x78ff9a,
      RATTLER:0xd09a62,
      ARMOURED:0xaab3bd,
      CHARGER:0xff7358,
      ALPHA:0xc07cff,
    };
    const colour=tint[snake.variant];
    if(colour!=null)visual.sprite.setTint(colour);
    return visual;
  };

  const originalCreate=sceneProto.create;
  sceneProto.create=function(){
    originalCreate.call(this);
    if(this.__phase2SceneHooks)return;
    this.__phase2SceneHooks=true;

    const rattleOverlay=this.add.rectangle(800,450,1600,900,0x000000,.98)
      .setScrollFactor(0).setDepth(240).setVisible(false);

    network.addEventListener("rattle_blackout",(event:any)=>{
      const duration=Math.max(250,Math.min(650,Number(event.detail?.duration??450)));
      this.tweens.killTweensOf(rattleOverlay);
      rattleOverlay.setVisible(true).setAlpha(.98);
      this.time.delayedCall(Math.max(120,duration-100),()=>{
        this.tweens.add({
          targets:rattleOverlay,alpha:0,duration:100,
          onComplete:()=>rattleOverlay.setVisible(false),
        });
      });
    });

    network.addEventListener("charger_telegraph",(event:any)=>{
      const d=event.detail??{},angle=Number(d.angle??0),duration=Math.max(450,Number(d.duration??850));
      const g=this.add.graphics().setDepth(34);
      const length=900;
      g.lineStyle(18,0xff4938,.14);
      g.lineBetween(d.x,d.y,d.x+Math.cos(angle)*length,d.y+Math.sin(angle)*length);
      g.lineStyle(3,0xffd171,.92);
      g.lineBetween(d.x,d.y,d.x+Math.cos(angle)*length,d.y+Math.sin(angle)*length);
      g.fillStyle(0xff6a4b,.22);g.fillCircle(d.x,d.y,52);
      this.time.delayedCall(duration,()=>g.destroy());
    });

    network.addEventListener("healer_pulse",(event:any)=>{
      const d=event.detail??{};
      this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0x77ff9a,life:480,scale:.8,endScale:5.2,alpha:.85,depth:42});
      this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0xd5ffe0,life:360,scale:.55,endScale:3.7,alpha:.5,depth:43});
    });

    network.addEventListener("golden_reward",(event:any)=>{
      const d=event.detail??{};
      this.spawnFloatingText(d.x,d.y-20,`GOLDEN +$${d.reward}`,true,0xffd34f);
    });

    network.addEventListener("golden_escaped",(event:any)=>{
      const d=event.detail??{};
      this.spawnFloatingText(d.x,d.y-18,"GOLDEN ESCAPED",true,0xffb95c);
    });
  };
}
