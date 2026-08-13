import { GameScene } from "./GameScene";
import { GameNetwork, network } from "../network";

// Phase 3 client layer:
// - online role-mode option
// - Veteran Arsenal UI and combat hotkeys
// - advanced/elite enemy presentation
// - precise boss reward wheel alignment
// - full-reset Back button
// - richer boss telegraphs without extra simulation entities

type Phase3State = {
  alternateRoles:boolean;
  highTierUnlocked:boolean;
  bombRackInstalled:boolean;
  bombCharges:number;
  bombCapacity:number;
  medkits:number;
  medkitCapacity:number;
  bombRackCost:number;
  bombChargeCost:number;
  medkitCost:number;
  cash:number;
  wave:number;
};

const P3_EVENTS=[
  "phase3_state",
  "role_mode",
  "roles_locked",
  "high_tier_purchase",
  "field_bomb_dropped",
  "field_bomb_explode",
  "phase_shift",
  "phase_resist",
  "shield_resist",
  "shield_pulse",
  "venom_contact",
  "elite_spawn",
  "boss_target_lock",
  "boss_turret_shot",
  "boss_stage",
];

let latestState:Phase3State|undefined;
const eliteInfo=new Map<number,string[]>();
let p3BannerTimer:number|undefined;

const networkProto=GameNetwork.prototype as any;
if(!networkProto.__phase3NetworkInstalled){
  networkProto.__phase3NetworkInstalled=true;
  const originalAttach=networkProto.attach;
  networkProto.attach=function(room:any){
    originalAttach.call(this,room);
    for(const name of P3_EVENTS){
      room.onMessage(name,(payload:any)=>this.dispatchEvent(new CustomEvent(name,{detail:payload})));
    }
  };

  networkProto.createGame=async function(name:string){
    const room=await this.client.create("snake_blitz",{
      mode:"online",
      name,
      alternateRoles:this.phase3AlternateRoles!==false,
    });
    this.attach(room);
    return room.roomId;
  };

  networkProto.buyBombRack=function(){this.room?.send("buy_bomb_rack");};
  networkProto.buyBombCharge=function(){this.room?.send("buy_bomb_charge");};
  networkProto.buyFieldMedkit=function(){this.room?.send("buy_field_medkit");};
  networkProto.dropFieldBomb=function(){this.room?.send("drop_field_bomb");};
  networkProto.useFieldMedkit=function(){this.room?.send("use_field_medkit");};
}

function installStyles(){
  if(document.getElementById("phase3-runtime-style"))return;
  const style=document.createElement("style");
  style.id="phase3-runtime-style";
  style.textContent=`
    .role-mode-setting{
      margin:0 0 12px;padding:12px 13px;border:1px solid rgba(216,166,77,.16);
      border-radius:11px;background:rgba(216,166,77,.045);display:grid;gap:4px
    }
    .role-mode-setting label{display:flex;align-items:center;gap:10px;color:#eee8d2;cursor:pointer}
    .role-mode-setting input[type="checkbox"]{width:18px;height:18px;margin:0;accent-color:#d8a64d;flex:0 0 auto}
    .role-mode-setting strong{font-size:12px;letter-spacing:.04em}
    .role-mode-setting small{color:#87938a;font-size:10px;line-height:1.4;padding-left:28px}
    .veteran-arsenal{
      margin-top:12px;padding:14px;border:1px solid rgba(236,180,76,.26);border-radius:13px;
      background:linear-gradient(180deg,rgba(91,57,21,.18),rgba(10,16,12,.76));
      display:grid;grid-template-columns:1.35fr 1fr 1fr;gap:10px;align-items:center
    }
    .veteran-copy{min-width:0}.veteran-copy strong{display:block;color:#f1cf75;margin:2px 0 4px}
    .veteran-copy p{margin:0;color:#97a195;font-size:10px;line-height:1.45}
    .veteran-arsenal.locked{opacity:.62;filter:saturate(.7)}
    .veteran-arsenal button{min-height:48px;font-size:10px;padding:9px 10px}
    .p3-ability-hud{
      right:22px;bottom:126px;z-index:102;pointer-events:none;min-width:245px;
      border:1px solid rgba(235,187,79,.2);background:rgba(7,14,11,.86);
      border-radius:10px;padding:9px 12px;display:grid;gap:3px
    }
    .p3-ability-hud strong{font-size:11px;color:#f0d077}.p3-ability-hud small{font-size:9px;color:#8e9a90}
    .p3-ability-hud.hidden-arsenal{display:none}
    .reward-wheel div:nth-child(1){transform:translate(58px,-100px)!important}
    .reward-wheel div:nth-child(2){transform:translate(115px,0)!important}
    .reward-wheel div:nth-child(3){transform:translate(58px,100px)!important}
    .reward-wheel div:nth-child(4){transform:translate(-58px,100px)!important}
    .reward-wheel div:nth-child(5){transform:translate(-115px,0)!important}
    .reward-wheel div:nth-child(6){transform:translate(-58px,-100px)!important}
    @media(max-width:820px){
      .veteran-arsenal{grid-template-columns:1fr 1fr}.veteran-copy{grid-column:1/-1}
      .p3-ability-hud{right:9px;bottom:92px;min-width:190px}
    }
  `;
  document.head.append(style);
}

function installLobbyRoleMode(){
  const setup=document.querySelector<HTMLElement>("#online-setup");
  const actions=setup?.querySelector(".lobby-actions");
  if(!setup||!actions||document.getElementById("alternate-roles"))return;
  const wrap=document.createElement("div");
  wrap.className="role-mode-setting";
  wrap.innerHTML=`
    <label>
      <input id="alternate-roles" type="checkbox" checked />
      <strong>Alternate driver and gunner every wave</strong>
    </label>
    <small>Uncheck to lock roles for the whole run: room creator drives, joining player guns.</small>
  `;
  setup.insertBefore(wrap,actions);
  const checkbox=wrap.querySelector<HTMLInputElement>("#alternate-roles")!;
  (network as any).phase3AlternateRoles=true;
  checkbox.addEventListener("change",()=>{
    (network as any).phase3AlternateRoles=checkbox.checked;
  });
  const tagline=document.querySelector<HTMLElement>(".tagline");
  if(tagline)tagline.textContent="One tank. Two jobs. Swap every wave  -  or lock roles for the run. Blitz the horde before your cash multiplier collapses.";
}

function installVeteranArsenal(){
  const footer=document.querySelector<HTMLElement>(".shop-footer");
  if(!footer||document.getElementById("veteran-arsenal"))return;

  const panel=document.createElement("div");
  panel.id="veteran-arsenal";
  panel.className="veteran-arsenal locked";
  panel.innerHTML=`
    <div class="veteran-copy">
      <span class="upgrade-kicker">VETERAN ARSENAL</span>
      <strong id="veteran-title">LOCKED</strong>
      <p id="veteran-desc">Max every core upgrade to unlock combat consumables.</p>
    </div>
    <button id="buy-bomb-rack" type="button">BOMB RACK</button>
    <button id="buy-field-medkit" type="button">FIELD MEDKIT</button>
  `;
  footer.parentElement?.insertBefore(panel,footer);

  panel.querySelector<HTMLButtonElement>("#buy-bomb-rack")!.onclick=()=>{
    if(latestState?.bombRackInstalled)(network as any).buyBombCharge();
    else (network as any).buyBombRack();
  };
  panel.querySelector<HTMLButtonElement>("#buy-field-medkit")!.onclick=()=>{
    (network as any).buyFieldMedkit();
  };

  const shell=document.querySelector<HTMLElement>("#game-shell");
  if(shell&&!document.getElementById("phase3-ability-hud")){
    const hud=document.createElement("div");
    hud.id="phase3-ability-hud";
    hud.className="hud p3-ability-hud hidden-arsenal";
    hud.innerHTML=`<strong id="phase3-ability-main">VETERAN ARSENAL</strong><small id="phase3-ability-help"></small>`;
    shell.append(hud);
  }
}

function updatePhase3Ui(state:Phase3State){
  latestState=state;
  (window as any).__snakeBlitzAlternateRoles=state.alternateRoles;

  const panel=document.querySelector<HTMLElement>("#veteran-arsenal");
  const title=document.querySelector<HTMLElement>("#veteran-title");
  const desc=document.querySelector<HTMLElement>("#veteran-desc");
  const bomb=document.querySelector<HTMLButtonElement>("#buy-bomb-rack");
  const medkit=document.querySelector<HTMLButtonElement>("#buy-field-medkit");

  if(panel&&title&&desc&&bomb&&medkit){
    panel.classList.toggle("locked",!state.highTierUnlocked);
    if(!state.highTierUnlocked){
      title.textContent="LOCKED  -  MAX ALL CORE UPGRADES";
      desc.textContent="The Bomb Rack and combat Field Medkits unlock after every core upgrade reaches MAX.";
      bomb.textContent="LOCKED";
      medkit.textContent="LOCKED";
      bomb.disabled=true;medkit.disabled=true;
    }else{
      title.textContent="VETERAN ARSENAL ONLINE";
      desc.textContent=state.bombRackInstalled
        ?"Driver: SPACE drops a 1.9s timed bomb. Q uses a shared Field Medkit."
        :"Install the Bomb Rack, then buy timed bomb charges. Q uses shared Field Medkits during combat.";
      if(!state.bombRackInstalled){
        bomb.textContent=`INSTALL BOMB RACK  |  $${state.bombRackCost.toLocaleString()}`;
        bomb.disabled=state.cash<state.bombRackCost;
      }else{
        bomb.textContent=state.bombCharges>=state.bombCapacity
          ?`BOMBS ${state.bombCharges}/${state.bombCapacity}  |  FULL`
          :`BOMB ${state.bombCharges}/${state.bombCapacity}  |  $${state.bombChargeCost.toLocaleString()}`;
        bomb.disabled=state.bombCharges>=state.bombCapacity||state.cash<state.bombChargeCost;
      }
      medkit.textContent=state.medkits>=state.medkitCapacity
        ?`MEDKITS ${state.medkits}/${state.medkitCapacity}  |  FULL`
        :`MEDKIT ${state.medkits}/${state.medkitCapacity}  |  $${state.medkitCost.toLocaleString()}`;
      medkit.disabled=state.medkits>=state.medkitCapacity||state.cash<state.medkitCost;
    }
  }

  const hud=document.querySelector<HTMLElement>("#phase3-ability-hud");
  const main=document.querySelector<HTMLElement>("#phase3-ability-main");
  const help=document.querySelector<HTMLElement>("#phase3-ability-help");
  if(hud&&main&&help){
    const visible=state.highTierUnlocked&&(state.bombRackInstalled||state.medkits>0);
    hud.classList.toggle("hidden-arsenal",!visible);
    if(visible){
      main.textContent=`BOMBS Ã—${state.bombCharges}  |  MEDKITS Ã—${state.medkits}`;
      help.textContent=state.bombRackInstalled
        ?"Driver SPACE: drop bomb  |  Q: Field Medkit"
        :"Q: Field Medkit";
    }
  }

  const miniLabel=document.querySelector<HTMLElement>(".shop-mini-label");
  if(miniLabel)miniLabel.textContent=state.alternateRoles?"NEXT ROLES":"LOCKED ROLES";
}

function phase3Banner(text:string,duration=1800){
  const el=document.querySelector<HTMLElement>("#event-banner");
  if(!el)return;
  if(p3BannerTimer)window.clearTimeout(p3BannerTimer);
  el.textContent=text;
  el.classList.remove("hidden");
  p3BannerTimer=window.setTimeout(()=>el.classList.add("hidden"),duration);
}

installStyles();
installLobbyRoleMode();
installVeteranArsenal();

network.addEventListener("phase3_state",(event)=>{
  updatePhase3Ui((event as CustomEvent<Phase3State>).detail);
});

network.addEventListener("role_mode",(event)=>{
  const d=(event as CustomEvent<any>).detail;
  (window as any).__snakeBlitzAlternateRoles=d.alternateRoles!==false;
});

network.addEventListener("boss_stage",(event)=>{
  const d=(event as CustomEvent<any>).detail;
  if(d.stage===2)phase3Banner("BOSS ENRAGED  -  ATTACK PATTERNS ACCELERATED",1900);
  else if(d.stage===3)phase3Banner("BOSS CRITICAL PHASE  -  MAXIMUM AGGRESSION",2200);
});

network.addEventListener("high_tier_purchase",(event)=>{
  const d=(event as CustomEvent<any>).detail;
  phase3Banner(`${String(d.name??"ARSENAL").toUpperCase()} ACQUIRED`,1200);
});

// Register these after main.ts has finished assigning its handlers. This makes
// the Back button a genuine clean-page reset and puts the server-selected wheel
// reward exactly under the pointer rather than on a sector boundary.
window.setTimeout(()=>{
  const back=document.querySelector<HTMLButtonElement>("#back-home");
  if(back){
    back.onclick=()=>{
      void network.leaveGame();
      window.location.reload();
    };
  }

  network.addEventListener("boss_reward",(event)=>{
    const d=(event as CustomEvent<any>).detail;
    const order=["SPEED","MEDKIT","REVIVE","BOMB","NUKE","CASH_BONUS"];
    const idx=order.indexOf(d.reward);
    const wheel=document.querySelector<HTMLElement>("#reward-wheel");
    if(!wheel||idx<0)return;
    // Conic sectors are 60 degrees wide and start at the top. Their centers are
    // 30,90,150... degrees, hence 330 - index*60 to land the chosen center at 0.
    wheel.style.setProperty("--spin-angle",`${1440+330-idx*60}deg`);
    wheel.dataset.reward=String(d.reward);
  });

  network.addEventListener("wave_complete",(event)=>{
    if((window as any).__snakeBlitzAlternateRoles!==false)return;
    const d=(event as CustomEvent<any>).detail;
    const el=document.querySelector<HTMLElement>("#event-banner");
    if(!el)return;
    el.textContent=`WAVE ${d.wave} CLEARED  |  ${Number(d.multiplier).toFixed(2)}Ã— CLEAR MULTIPLIER  |  ROLES LOCKED${d.repair?`  |  +${d.repair} HP`:""}`;
  });
},0);

const sceneProto=GameScene.prototype as any;
if(!sceneProto.__phase3VisualsInstalled){
  sceneProto.__phase3VisualsInstalled=true;

  const originalCreateSnakeVisual=sceneProto.createSnakeVisual;
  sceneProto.createSnakeVisual=function(snake:any){
    const visual=originalCreateSnakeVisual.call(this,snake);
    const tints:Record<string,number>={
      TANK:0x8f9891,
      BERSERKER:0xdf5a4d,
      VENOM_CONTACT:0x73d76f,
      SHIELD:0x69c9df,
      PHASE:0xb996e8,
      PREDATOR:0xd77b4c,
      EXPLOSIVE:0xff9b44,
    };
    const tint=tints[snake.variant];
    if(tint!=null)visual.sprite.setTint(tint);
    if(eliteInfo.has(snake.id))visual.sprite.setScale(1.08);
    return visual;
  };

  const originalSyncEnemyProjectiles=sceneProto.syncEnemyProjectiles;
  sceneProto.syncEnemyProjectiles=function(snapshot:any){
    originalSyncEnemyProjectiles.call(this,snapshot);
    for(const projectile of snapshot.enemyProjectiles??[]){
      const visual=this.enemyProjectileSprites.get(projectile.id);
      if(!visual)continue;
      if(projectile.kind==="BOSS")visual.sprite.setTint(0xffc95f).setScale(1.12);
      else if(projectile.kind==="BOSS_VENOM")visual.sprite.setTint(0xb873ff).setScale(1.18);
      else visual.sprite.clearTint().setScale(1);
    }
  };

  sceneProto.updateBossTelegraph=function(time:number){
    const b=this.currentSnapshot?.boss;
    if(!this.bossTelegraph||!b)return;
    if(time-this.lastBossTelegraphAt<50)return;
    this.lastBossTelegraphAt=time;
    this.bossTelegraph.clear();
    if(b.phase==="TELEGRAPH"){
      const a=Number.isFinite(b.telegraphAngle)?b.telegraphAngle:Math.atan2(this.tank.y-b.y,this.tank.x-b.x);
      this.bossTelegraph.lineStyle(19,0xff4938,.13);
      this.bossTelegraph.lineBetween(b.x,b.y,b.x+Math.cos(a)*1050,b.y+Math.sin(a)*1050);
      this.bossTelegraph.lineStyle(3,0xffd36a,.92);
      this.bossTelegraph.lineBetween(b.x,b.y,b.x+Math.cos(a)*1050,b.y+Math.sin(a)*1050);
    }
  };

  const originalCreate=sceneProto.create;
  sceneProto.create=function(){
    originalCreate.call(this);
    if(this.__phase3SceneHooks)return;
    this.__phase3SceneHooks=true;

    this.__phase3BombVisuals=new Map<number,any>();

    this.input.keyboard?.on("keydown",(event:KeyboardEvent)=>{
      if(event.repeat)return;
      const snapshot=this.currentSnapshot;
      if(!snapshot||snapshot.phase!=="combat")return;

      if(event.code==="Space"&&snapshot.mode==="online"&&this.localRole==="driver"){
        event.preventDefault();
        (network as any).dropFieldBomb();
      }else if(event.code==="KeyB"&&snapshot.mode==="local"){
        event.preventDefault();
        (network as any).dropFieldBomb();
      }else if(event.code==="KeyQ"){
        event.preventDefault();
        (network as any).useFieldMedkit();
      }
    });

    network.addEventListener("field_bomb_dropped",(event:any)=>{
      const d=event.detail??{};
      const shell=this.add.circle(0,0,14,0x353b34,1).setStrokeStyle(3,0xf2b64e,.95);
      const core=this.add.circle(0,0,5,0xff6f42,1);
      const label=this.add.text(0,24,"1.9s",{fontFamily:"Arial Black, Arial",fontSize:"10px",color:"#ffd77a",stroke:"#111",strokeThickness:3}).setOrigin(.5);
      const container=this.add.container(d.x,d.y,[shell,core,label]).setDepth(32);
      this.__phase3BombVisuals.set(d.id,container);
      this.tweens.add({targets:core,alpha:.25,scale:1.65,duration:180,yoyo:true,repeat:-1});
      this.time.delayedCall(Number(d.fuseMs??1900)+600,()=>{
        const live=this.__phase3BombVisuals.get(d.id);
        if(live){live.destroy(true);this.__phase3BombVisuals.delete(d.id);}
      });
    });

    network.addEventListener("field_bomb_explode",(event:any)=>{
      const d=event.detail??{};
      const visual=this.__phase3BombVisuals.get(d.id);
      if(visual){visual.destroy(true);this.__phase3BombVisuals.delete(d.id);}
    });

    network.addEventListener("boss_target_lock",(event:any)=>{
      const d=event.detail??{};
      const g=this.add.graphics().setDepth(37);
      g.lineStyle(3,0xff6054,.9);
      g.strokeCircle(d.x,d.y,44);
      g.lineBetween(d.x-58,d.y,d.x+58,d.y);
      g.lineBetween(d.x,d.y-58,d.x,d.y+58);
      g.lineStyle(12,0xff4b3c,.1);
      g.strokeCircle(d.x,d.y,58);
      this.tweens.add({targets:g,alpha:.28,duration:Math.max(90,Number(d.delay??500)/3),yoyo:true,repeat:2});
      this.time.delayedCall(Number(d.duration??900),()=>g.destroy());
    });

    network.addEventListener("boss_turret_shot",(event:any)=>{
      const d=event.detail??{};
      this.playMuzzleFlash(d.x,d.y,d.angle);
    });

    network.addEventListener("shield_pulse",(event:any)=>{
      for(const shield of event.detail?.shields??[]){
        this.spawnFx(shield.x,shield.y,{texture:"sb-fx-ring",tint:0x68d5ef,life:520,scale:.8,endScale:5.7,alpha:.42,depth:18});
      }
    });

    network.addEventListener("phase_shift",(event:any)=>{
      const d=event.detail??{};
      const visual=this.snakeVisuals.get(d.snakeId);
      if(visual)visual.sprite.setAlpha(d.active?.38:1);
      if(d.active)this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0xc394ff,life:420,scale:.65,endScale:3.8,alpha:.6,depth:20});
    });

    network.addEventListener("phase_resist",(event:any)=>{
      const d=event.detail??{};
      this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0xc6a0ff,life:180,scale:.35,endScale:1.25,alpha:.65,depth:46});
    });

    network.addEventListener("shield_resist",(event:any)=>{
      const d=event.detail??{};
      this.spawnFx(d.x,d.y,{texture:"sb-fx-ring",tint:0x75d9ec,life:170,scale:.3,endScale:1.1,alpha:.55,depth:45});
    });

    network.addEventListener("venom_contact",()=>{
      const flash=this.add.rectangle(800,450,1600,900,0x45a85d,.09).setScrollFactor(0).setDepth(96);
      this.tweens.add({targets:flash,alpha:0,duration:260,onComplete:()=>flash.destroy()});
    });

    network.addEventListener("elite_spawn",(event:any)=>{
      const d=event.detail??{};
      eliteInfo.set(d.snakeId,Array.isArray(d.mods)?d.mods:[]);
      const visual=this.snakeVisuals.get(d.snakeId);
      if(visual)visual.sprite.setScale(1.08);
      this.spawnFloatingText(d.x,d.y-28,`ELITE  |  ${(d.mods??[]).join("+")}`,true,0xffc963);
    });
  };
}
