// Phase 3: advanced enemies, elite modifiers, late-game arsenal, role-mode choice,
// escalating boss mechanics, and progression polish.
//
// Applied after Phase 1 and Phase 2 so the existing optimized simulation,
// spatial grid, economy and priority-enemy layers stay intact.

export function applyPhase3Balance(RoomClass: any) {
  const p = RoomClass.prototype as any;
  if (p.__phase3BalanceApplied) return;
  p.__phase3BalanceApplied = true;

  type AdvancedClass =
    | "TANK"
    | "BERSERKER"
    | "VENOM_CONTACT"
    | "SHIELD"
    | "PHASE"
    | "PREDATOR"
    | "EXPLOSIVE";

  type EliteMod = "HP" | "SPEED" | "DAMAGE" | "REGEN" | "EXPLOSIVE" | "LIFESTEAL";

  const advancedCaps: Record<AdvancedClass, number> = {
    TANK: 3,
    BERSERKER: 4,
    VENOM_CONTACT: 3,
    SHIELD: 2,
    PHASE: 3,
    PREDATOR: 3,
    EXPLOSIVE: 3,
  };

  const lerp = (a:number,b:number,t:number)=>a+(b-a)*Math.max(0,Math.min(1,t));

  const hpScale = (wave:number) => {
    const w=Math.max(1,wave);
    if(w<=10)return lerp(.17,1,(w-1)/9);
    if(w<=20)return lerp(1,2,(w-10)/10);
    if(w<=30)return lerp(2,3.5,(w-20)/10);
    if(w<=40)return lerp(3.5,6,(w-30)/10);
    if(w<=50)return lerp(6,10,(w-40)/10);
    return 10*Math.pow(1.45,(w-50)/10);
  };

  const damageScale = (wave:number) => {
    const w=Math.max(1,wave);
    if(w<=10)return lerp(.5,1,(w-1)/9);
    if(w<=20)return lerp(1,1.6,(w-10)/10);
    if(w<=30)return lerp(1.6,2.3,(w-20)/10);
    if(w<=40)return lerp(2.3,3,(w-30)/10);
    if(w<=50)return lerp(3,4,(w-40)/10);
    return 4*Math.pow(1.22,(w-50)/10);
  };

  const round5=(v:number)=>Math.round(v/5)*5;
  const round50=(v:number)=>Math.round(v/50)*50;

  function ensureState(room:any){
    if(room.p3AlternateRoles==null)room.p3AlternateRoles=true;
    if(room.p3BombRackInstalled==null)room.p3BombRackInstalled=false;
    if(room.p3BombCharges==null)room.p3BombCharges=0;
    if(room.p3Medkits==null)room.p3Medkits=0;
    if(!room.p3Bombs)room.p3Bombs=[];
    if(room.p3NextBombId==null)room.p3NextBombId=1;
    if(room.p3AbilityCooldownMs==null)room.p3AbilityCooldownMs=0;
    if(room.p3PoisonMs==null)room.p3PoisonMs=0;
    if(room.p3PoisonTickMs==null)room.p3PoisonTickMs=0;
    if(!room.p3SnakeCounts)room.p3SnakeCounts={TANK:0,BERSERKER:0,VENOM_CONTACT:0,SHIELD:0,PHASE:0,PREDATOR:0,EXPLOSIVE:0};
    if(room.p3ShieldPulseMs==null)room.p3ShieldPulseMs=0;
    if(room.p3RegenAccumulatorMs==null)room.p3RegenAccumulatorMs=0;
    if(!room.p3BossShots)room.p3BossShots=[];
    if(room.p3LastStateBroadcastAt==null)room.p3LastStateBroadcastAt=0;
  }

  function coreMaxed(room:any){
    try{return room.upgradeSnapshot().every((u:any)=>u.maxed);}
    catch{return false;}
  }

  function bombRackCost(room:any){return round50(4800+Math.max(0,room.wave)*145);}
  function bombChargeCost(room:any){return round5(760+Math.max(0,room.wave)*34);}
  function medkitCost(room:any){return round5(620+Math.max(0,room.wave)*29);}

  function statePayload(room:any){
    ensureState(room);
    return {
      alternateRoles:Boolean(room.p3AlternateRoles),
      highTierUnlocked:coreMaxed(room),
      bombRackInstalled:Boolean(room.p3BombRackInstalled),
      bombCharges:room.p3BombCharges,
      bombCapacity:4,
      medkits:room.p3Medkits,
      medkitCapacity:3,
      bombRackCost:bombRackCost(room),
      bombChargeCost:bombChargeCost(room),
      medkitCost:medkitCost(room),
      cash:Math.round(room.cash),
      wave:room.wave,
    };
  }

  function sendState(room:any,client?:any){
    const payload=statePayload(room);
    if(client)client.send("phase3_state",payload);
    else room.broadcast("phase3_state",payload);
  }

  const originalOnCreate=p.onCreate;
  p.onCreate=async function(options:any){
    ensureState(this);
    this.p3AlternateRoles=options?.alternateRoles!==false;

    this.messages.buy_bomb_rack=(client:any)=>{
      if(this.phase!=="intermission")return;
      if(!coreMaxed(this)){client.send("purchase_denied",{reason:"Veteran Arsenal unlocks after every core upgrade is maxed."});return;}
      if(this.p3BombRackInstalled){client.send("purchase_denied",{reason:"Bomb Rack already installed."});return;}
      const cost=bombRackCost(this);
      if(this.cash<cost){client.send("purchase_denied",{reason:`Need $${cost.toLocaleString()} to install the Bomb Rack.`});return;}
      this.cash-=cost;this.p3BombRackInstalled=true;this.p3BombCharges=2;this.readyPlayers.clear();
      this.broadcast("high_tier_purchase",{type:"BOMB_RACK",name:"Bomb Rack",cost,cash:this.cash});
      sendState(this);
    };

    this.messages.buy_bomb_charge=(client:any)=>{
      if(this.phase!=="intermission")return;
      if(!coreMaxed(this)||!this.p3BombRackInstalled){client.send("purchase_denied",{reason:"Install the Veteran Bomb Rack first."});return;}
      if(this.p3BombCharges>=4){client.send("purchase_denied",{reason:"Bomb Rack is already fully loaded."});return;}
      const cost=bombChargeCost(this);
      if(this.cash<cost){client.send("purchase_denied",{reason:`Need $${cost.toLocaleString()} for a timed bomb.`});return;}
      this.cash-=cost;this.p3BombCharges++;this.readyPlayers.clear();
      this.broadcast("high_tier_purchase",{type:"BOMB_CHARGE",name:"Timed Bomb",cost,cash:this.cash,count:this.p3BombCharges});
      sendState(this);
    };

    this.messages.buy_field_medkit=(client:any)=>{
      if(this.phase!=="intermission")return;
      if(!coreMaxed(this)){client.send("purchase_denied",{reason:"Veteran Arsenal unlocks after every core upgrade is maxed."});return;}
      if(this.p3Medkits>=3){client.send("purchase_denied",{reason:"Field Medkit storage is full."});return;}
      const cost=medkitCost(this);
      if(this.cash<cost){client.send("purchase_denied",{reason:`Need $${cost.toLocaleString()} for a Field Medkit.`});return;}
      this.cash-=cost;this.p3Medkits++;this.readyPlayers.clear();
      this.broadcast("high_tier_purchase",{type:"FIELD_MEDKIT",name:"Field Medkit",cost,cash:this.cash,count:this.p3Medkits});
      sendState(this);
    };

    this.messages.drop_field_bomb=(client:any)=>{
      if(this.phase!=="combat"||!this.canControl(client,"driver"))return;
      if(!this.p3BombRackInstalled||this.p3BombCharges<=0){client.send("boost_denied",{reason:"No timed bombs loaded."});return;}
      if(this.p3AbilityCooldownMs>0)return;
      this.p3AbilityCooldownMs=650;
      this.p3BombCharges--;
      const id=this.p3NextBombId++;
      const back=62;
      const x=this.clamp(this.tank.x-Math.cos(this.tank.rotation)*back,30,3570);
      const y=this.clamp(this.tank.y-Math.sin(this.tank.rotation)*back,30,2070);
      const bomb={id,x,y,fuseMs:1900,radius:220};
      this.p3Bombs.push(bomb);
      this.broadcast("field_bomb_dropped",{...bomb});
      sendState(this);
    };

    this.messages.use_field_medkit=(client:any)=>{
      if(this.phase!=="combat")return;
      if(this.p3Medkits<=0){client.send("boost_denied",{reason:"No Field Medkits stored."});return;}
      if(this.tank.health>=this.tank.maxHealth-.5){client.send("boost_denied",{reason:"Tank integrity is already full."});return;}
      if(this.p3AbilityCooldownMs>0)return;
      this.p3AbilityCooldownMs=450;
      this.p3Medkits--;
      const before=this.tank.health;
      this.tank.health=Math.min(this.tank.maxHealth,this.tank.health+40);
      this.broadcast("boost_used",{type:"FIELD_MEDKIT",name:"Field Medkit",restored:Math.round(this.tank.health-before)});
      sendState(this);
    };

    const result=await originalOnCreate.call(this,options);
    return result;
  };

  const originalResetRun=p.resetRun;
  p.resetRun=function(){
    const alternate=this.p3AlternateRoles;
    originalResetRun.call(this);
    ensureState(this);
    this.p3AlternateRoles=alternate!==false;
    this.p3BombRackInstalled=false;
    this.p3BombCharges=0;
    this.p3Medkits=0;
    this.p3Bombs=[];
    this.p3NextBombId=1;
    this.p3AbilityCooldownMs=0;
    this.p3PoisonMs=0;
    this.p3PoisonTickMs=0;
    this.p3BossShots=[];
  };

  const originalAssignRoles=p.assignRandomStartingRoles;
  p.assignRandomStartingRoles=function(){
    ensureState(this);
    if(this.mode==="online"&&!this.p3AlternateRoles){
      const players=[...this.players.values()];
      if(players.length>=2){
        players[0].role="driver";
        players[1].role="gunner";
        this.resetInputs();
        this.broadcast("roles_assigned",this.rolePayload());
        this.broadcast("role_mode",{alternateRoles:false});
        return;
      }
    }
    originalAssignRoles.call(this);
    this.broadcast("role_mode",{alternateRoles:true});
  };

  const originalSwapRoles=p.swapRoles;
  p.swapRoles=function(){
    ensureState(this);
    if(this.mode==="online"&&!this.p3AlternateRoles){
      this.broadcast("roles_locked",this.rolePayload());
      return;
    }
    originalSwapRoles.call(this);
  };

  const originalStartWave=p.startWave;
  p.startWave=function(wave:number){
    ensureState(this);
    this.p3SnakeCounts={TANK:0,BERSERKER:0,VENOM_CONTACT:0,SHIELD:0,PHASE:0,PREDATOR:0,EXPLOSIVE:0};
    this.p3ShieldPulseMs=0;
    this.p3RegenAccumulatorMs=0;
    this.p3BossShots=[];
    const result=originalStartWave.call(this,wave);
    if(this.waveType==="BOSS"){
      const tier=Math.floor(this.wave/10);
      this.bossReinforcements=tier>=9?2:tier>=6?1:0;
    }
    this.broadcast("role_mode",{alternateRoles:this.mode==="local"?true:Boolean(this.p3AlternateRoles)});
    sendState(this);
    return result;
  };

  const originalPurchaseUpgrade=p.purchaseUpgrade;
  p.purchaseUpgrade=function(client:any,id:any){
    const result=originalPurchaseUpgrade.call(this,client,id);
    sendState(this);
    return result;
  };

  const originalBroadcastSnapshot=p.broadcastSnapshot;
  p.broadcastSnapshot=function(){
    originalBroadcastSnapshot.call(this);
    ensureState(this);
    const now=Date.now();
    if(now-this.p3LastStateBroadcastAt>=900){
      this.p3LastStateBroadcastAt=now;
      sendState(this);
    }
  };

  // Repairs still scale gently in the early game, then become meaningfully more
  // expensive so armour damage remains an economic decision in long runs.
  p.repairSnapshot=function(){
    const late=Math.max(0,this.wave-12);
    const cost=round5(180+this.wave*24+4*Math.pow(late,1.22));
    return {cost,restore:35,canBuy:this.phase==="intermission"&&this.cash>=cost&&this.tank.health<this.tank.maxHealth-.5};
  };

  function chooseAdvanced(room:any):AdvancedClass|undefined{
    const w=room.wave as number;
    const choices:Array<[AdvancedClass,number]>=[];
    if(w>=14)choices.push(["EXPLOSIVE",1]);
    if(w>=16)choices.push(["VENOM_CONTACT",1]);
    if(w>=18)choices.push(["BERSERKER",1.15]);
    if(w>=20)choices.push(["TANK",.8]);
    if(w>=22)choices.push(["SHIELD",.72]);
    if(w>=25)choices.push(["PHASE",.82]);
    if(w>=28)choices.push(["PREDATOR",.92]);
    const available=choices.filter(([c])=>(room.p3SnakeCounts[c]??0)<advancedCaps[c]);
    if(!available.length)return undefined;
    const chance=Math.min(.22,.045+Math.max(0,w-14)*.0055);
    if(Math.random()>=chance)return undefined;
    const total=available.reduce((n,[,weight])=>n+weight,0);
    let roll=Math.random()*total;
    for(const [cls,weight] of available){roll-=weight;if(roll<=0)return cls;}
    return available[available.length-1][0];
  }

  function chooseEliteMods(wave:number):EliteMod[]{
    const pool:EliteMod[]=["HP","SPEED","DAMAGE","REGEN","EXPLOSIVE","LIFESTEAL"];
    const first=pool.splice(Math.floor(Math.random()*pool.length),1)[0];
    const mods=[first];
    if(wave>=30&&Math.random()<Math.min(.62,.28+(wave-30)*.012)){
      mods.push(pool[Math.floor(Math.random()*pool.length)]);
    }
    return mods;
  }

  const originalSpawnSnake=p.spawnSnake;
  p.spawnSnake=function(){
    ensureState(this);
    originalSpawnSnake.call(this);
    const s=this.snakes.get(this.nextSnakeId-1);
    if(!s)return;

    const stats=this.waveStats();
    if(!s.p2Class&&s.variant==="NORMAL"){
      const cls=chooseAdvanced(this);
      if(cls){
        this.p3SnakeCounts[cls]=(this.p3SnakeCounts[cls]??0)+1;
        s.variant=cls;
        s.p3Class=cls;
        let hpMult=1,speedMult=1,headMult=1,bodyMult=1,lengthMult=1,turnMult=1;
        if(cls==="TANK"){hpMult=5;speedMult=.48;headMult=1.25;bodyMult=1.62;lengthMult=1.3;turnMult=.72;}
        else if(cls==="BERSERKER"){hpMult=1.25;speedMult=1.02;headMult=1.04;bodyMult=1.04;}
        else if(cls==="VENOM_CONTACT"){hpMult=1.15;speedMult=.96;headMult=1.04;}
        else if(cls==="SHIELD"){hpMult=1.45;speedMult=.78;headMult=1.08;bodyMult=1.12;lengthMult=1.08;}
        else if(cls==="PHASE"){hpMult=1.2;speedMult=1.05;headMult=.98;bodyMult=.96;s.p3PhaseActive=false;s.p3PhaseTimerMs=3200+Math.random()*2600;}
        else if(cls==="PREDATOR"){hpMult=1.2;speedMult=1.22;turnMult=1.3;s.p3FlankSign=Math.random()<.5?-1:1;}
        else if(cls==="EXPLOSIVE"){hpMult=.92;speedMult=1.08;bodyMult=.92;lengthMult=.92;}

        const hp=Math.max(1,Math.round(stats.hp*hpMult));
        s.hp=hp;s.maxHp=hp;
        s.speed=stats.speed*speedMult;
        s.turnSpeed=Math.max(1.3,s.turnSpeed*turnMult);
        s.headRadius=stats.headRadius*headMult;
        s.bodyRadius=stats.bodyRadius*bodyMult;
        s.length=stats.length*lengthMult;
      }
    }

    s.p3BaseSpeed=s.speed;
    s.p3BaseTurnSpeed=s.turnSpeed;

    if(!s.p2Class&&this.wave>=15){
      const eliteChance=Math.min(.22,.07+Math.max(0,this.wave-15)*.004);
      if(Math.random()<eliteChance){
        const mods=chooseEliteMods(this.wave);
        s.p3EliteMods=mods;
        if(mods.includes("HP")){s.maxHp=Math.round(s.maxHp*1.8);s.hp=s.maxHp;}
        if(mods.includes("SPEED")){s.speed*=1.26;s.p3BaseSpeed=s.speed;}
        this.broadcast("elite_spawn",{snakeId:s.id,x:s.x,y:s.y,variant:s.variant,mods});
      }
    }
  };

  function isShielded(room:any,s:any){
    if(s.p3Class==="SHIELD")return false;
    const r2=265*265;
    for(const shield of room.nearbySnakes(s.x,s.y,2)){
      if(shield.p3Class!=="SHIELD"||shield.id===s.id)continue;
      const dx=s.x-shield.x,dy=s.y-shield.y;
      if(dx*dx+dy*dy<=r2)return true;
    }
    return false;
  }

  function damageFactor(room:any,s:any){
    if(s.p3Class==="PHASE"&&s.p3PhaseActive)return .15;
    if(isShielded(room,s))return .55;
    return 1;
  }

  const originalHitSnake=p.hitSnake;
  p.hitSnake=function(b:any,s:any){
    const factor=damageFactor(this,s);
    if(factor>=.999)return originalHitSnake.call(this,b,s);

    const before=s.hp;
    const guard=100000000;
    const volatile=s.volatile;
    s.volatile=false;
    s.hp=before+guard;
    const hit=originalHitSnake.call(this,b,s);
    s.volatile=volatile;
    if(!hit){s.hp=before;return false;}
    if(!this.snakes.has(s.id))return true;

    const raw=Math.max(0,before+guard-s.hp);
    const adjusted=Math.max(1,Math.round(raw*factor));
    s.hp=before-adjusted;
    if(factor<.3)this.broadcast("phase_resist",{snakeId:s.id,x:s.x,y:s.y});
    else this.broadcast("shield_resist",{snakeId:s.id,x:s.x,y:s.y});
    if(s.hp<=0)this.killSnake(s,false);
    return true;
  };

  p.applySplash=function(x:number,y:number,r:number,damage:number,exclude:number){
    const cells=Math.max(1,Math.ceil(r/this.snakeGridCell));
    for(const s of this.nearbySnakes(x,y,cells)){
      if(s.id===exclude||!this.snakes.has(s.id))continue;
      if(this.distanceSq(x,y,s.x,s.y)>r*r)continue;
      const applied=Math.max(1,Math.round(damage*damageFactor(this,s)));
      s.hp-=applied;
      if(s.hp<=0)this.killSnake(s,false);
    }
    this.broadcast("explosion_fx",{x,y,radius:r,tankDamage:0,weapon:true});
  };

  const originalUpdateSnakes=p.updateSnakes;
  p.updateSnakes=function(deltaMs:number,dt:number){
    ensureState(this);
    let predatorPresent=false;

    for(const s of this.snakes.values()){
      if(!s.p3Class)continue;
      s.p3BaseSpeed=s.p3BaseSpeed??s.speed;
      s.p3BaseTurnSpeed=s.p3BaseTurnSpeed??s.turnSpeed;
      const alpha=this.phase2AlphaBuffed?.has(s.id)?1.2:1;

      if(s.p3Class==="BERSERKER"){
        const rage=s.hp/s.maxHp<=.42?1.72:1;
        s.speed=s.p3BaseSpeed*rage*alpha;
      }else if(s.p3Class==="PREDATOR"){
        predatorPresent=true;
        s.p3PredatorSpeed=s.p3BaseSpeed*alpha;
        s.speed=0;
      }else{
        s.speed=s.p3BaseSpeed*alpha;
      }

      if(s.p3Class==="PHASE"){
        s.p3PhaseTimerMs=(s.p3PhaseTimerMs??3000)-deltaMs;
        if(s.p3PhaseTimerMs<=0){
          s.p3PhaseActive=!s.p3PhaseActive;
          s.p3PhaseTimerMs=s.p3PhaseActive?900+Math.random()*300:4300+Math.random()*3000;
          this.broadcast("phase_shift",{snakeId:s.id,x:s.x,y:s.y,active:s.p3PhaseActive,duration:s.p3PhaseTimerMs});
        }
      }
    }

    originalUpdateSnakes.call(this,deltaMs,dt);

    if(predatorPresent){
      for(const s of this.snakes.values()){
        if(s.p3Class!=="PREDATOR")continue;
        const side=s.p3FlankSign??1;
        const lead=230;
        const flank=210;
        const hx=Math.cos(this.tank.rotation),hy=Math.sin(this.tank.rotation);
        const sx=-hy*side,sy=hx*side;
        const tx=this.tank.x+hx*lead+sx*flank;
        const ty=this.tank.y+hy*lead+sy*flank;
        const desired=Math.atan2(ty-s.y,tx-s.x);
        s.rotation=this.rotateTowards(s.rotation,desired,(s.p3BaseTurnSpeed??2.8)*1.25*dt);
        const speed=s.p3PredatorSpeed??s.p3BaseSpeed;
        s.x+=Math.cos(s.rotation)*speed*dt;
        s.y+=Math.sin(s.rotation)*speed*dt;
        s.x=this.clamp(s.x,25,3575);s.y=this.clamp(s.y,25,2075);
        this.resolveSnakeObstacleCollisions(s);
        s.speed=s.p3BaseSpeed;
      }
      this.rebuildSnakeGrid(this.snakes.values());
    }

    this.p3ShieldPulseMs+=deltaMs;
    if(this.p3ShieldPulseMs>=1000){
      this.p3ShieldPulseMs-=1000;
      const shields=[...this.snakes.values()].filter((s:any)=>s.p3Class==="SHIELD").map((s:any)=>({id:s.id,x:s.x,y:s.y,radius:265}));
      if(shields.length)this.broadcast("shield_pulse",{shields});
    }

    this.p3RegenAccumulatorMs+=deltaMs;
    if(this.p3RegenAccumulatorMs>=500){
      const ticks=Math.floor(this.p3RegenAccumulatorMs/500);
      this.p3RegenAccumulatorMs-=ticks*500;
      for(const s of this.snakes.values()){
        if(!s.p3EliteMods?.includes("REGEN")||s.hp<=0||s.hp>=s.maxHp)continue;
        s.hp=Math.min(s.maxHp,s.hp+s.maxHp*.0065*ticks);
      }
    }
  };

  const originalDamageTank=p.damageTank;
  p.damageTank=function(amount:number,source:string,x:number,y:number){
    if(source==="bite"){
      let attacker:any;
      let best=82*82;
      for(const s of this.nearbySnakes(x,y,1)){
        const dx=s.x-x,dy=s.y-y,d2=dx*dx+dy*dy;
        if(d2<best){best=d2;attacker=s;}
      }
      if(attacker&&(attacker.p3Class||attacker.p3EliteMods?.length)){
        let scaled=Math.max(5,Math.round(10*damageScale(this.wave)));
        if(attacker.p3Class==="TANK")scaled=Math.round(scaled*1.9);
        else if(attacker.p3Class==="PREDATOR")scaled=Math.round(scaled*1.18);
        else if(attacker.p3Class==="BERSERKER"&&attacker.hp/attacker.maxHp<=.42)scaled=Math.round(scaled*1.28);
        if(attacker.p3EliteMods?.includes("DAMAGE"))scaled=Math.round(scaled*1.35);
        const result=originalDamageTank.call(this,scaled,"p3_bite",x,y);
        if(attacker.p3Class==="VENOM_CONTACT"){
          this.p3PoisonMs=Math.max(this.p3PoisonMs,3000);
          this.p3PoisonTickMs=Math.min(this.p3PoisonTickMs||750,750);
          this.broadcast("venom_contact",{snakeId:attacker.id,duration:3000});
        }
        if(attacker.p3EliteMods?.includes("LIFESTEAL")&&this.snakes.has(attacker.id)){
          attacker.hp=Math.min(attacker.maxHp,attacker.hp+scaled*.7);
        }
        return result;
      }
    }
    return originalDamageTank.call(this,amount,source,x,y);
  };

  const originalKillSnake=p.killSnake;
  p.killSnake=function(s:any,exploded:boolean){
    const wasAlive=this.snakes.has(s.id);
    const deathBlast=wasAlive&&!exploded&&(s.p3Class==="EXPLOSIVE"||s.p3EliteMods?.includes("EXPLOSIVE"));
    const x=s.x,y=s.y;
    originalKillSnake.call(this,s,exploded);
    if(!deathBlast)return;

    const radius=s.p3Class==="EXPLOSIVE"?150:135;
    if(this.distanceSq(x,y,this.tank.x,this.tank.y)<radius*radius){
      const tankDamage=Math.max(8,Math.round(9*damageScale(this.wave)));
      this.damageTank(tankDamage,"p3_explosion",x,y);
    }
    for(const other of this.nearbySnakes(x,y,1)){
      if(!this.snakes.has(other.id)||this.distanceSq(x,y,other.x,other.y)>radius*radius)continue;
      other.hp-=Math.max(1,Math.round(other.maxHp*.36));
      if(other.hp<=0)this.killSnake(other,true);
    }
    this.broadcast("explosion_fx",{x,y,radius,tankDamage:0,elite:true});
  };

  function explodeFieldBomb(room:any,bomb:any){
    const {x,y,radius}=bomb;
    const cells=Math.max(1,Math.ceil(radius/room.snakeGridCell));
    for(const s of room.nearbySnakes(x,y,cells)){
      if(!room.snakes.has(s.id)||room.distanceSq(x,y,s.x,s.y)>radius*radius)continue;
      const fraction=s.p3Class==="TANK"?.42:.68;
      s.hp-=Math.max(500,Math.round(s.maxHp*fraction));
      if(s.hp<=0)room.killSnake(s,false);
    }
    if(room.boss&&room.distanceSq(x,y,room.boss.x,room.boss.y)<(radius+room.boss.radius)**2){
      room.boss.hp-=Math.max(350,Math.round(room.boss.maxHp*.045));
      if(room.boss.hp<=0)room.defeatBoss();
    }
    room.broadcast("field_bomb_explode",{id:bomb.id,x,y,radius});
    room.broadcast("explosion_fx",{x,y,radius,fieldBomb:true,tankDamage:0});
  }

  const originalUpdateGame=p.updateGame;
  p.updateGame=function(deltaMs:number){
    const result=originalUpdateGame.call(this,deltaMs);
    ensureState(this);

    this.p3AbilityCooldownMs=Math.max(0,this.p3AbilityCooldownMs-deltaMs);

    if(this.phase!=="combat"){
      this.p3Bombs=[];
      this.p3PoisonMs=0;
      return result;
    }

    const bombs=[];
    for(const bomb of this.p3Bombs){
      bomb.fuseMs-=deltaMs;
      if(bomb.fuseMs<=0)explodeFieldBomb(this,bomb);
      else bombs.push(bomb);
    }
    this.p3Bombs=bombs;

    if(this.p3PoisonMs>0){
      this.p3PoisonMs=Math.max(0,this.p3PoisonMs-deltaMs);
      this.p3PoisonTickMs-=deltaMs;
      if(this.p3PoisonTickMs<=0){
        this.p3PoisonTickMs+=750;
        const damage=Math.max(2,Math.round(2.5*damageScale(this.wave)));
        this.damageTank(damage,"p3_poison",this.tank.x,this.tank.y);
      }
    }
    return result;
  };

  // Enemy projectiles keep the existing pooled client rendering but can now
  // carry a server-only source tag so boss fire has its own tuned damage.
  p.updateEnemyProjectiles=function(deltaMs:number,dt:number){
    const projectiles=this.enemyProjectiles;
    let write=0;
    for(let i=0;i<projectiles.length;i++){
      const projectile=projectiles[i];
      projectile.x+=projectile.vx*dt;
      projectile.y+=projectile.vy*dt;
      projectile.ageMs+=deltaMs;
      if(projectile.ageMs>4500)continue;
      if(this.distanceSq(projectile.x,projectile.y,this.tank.x,this.tank.y)<(38+projectile.radius)**2){
        this.damageTank(projectile.damage,projectile.p3Source??"venom",projectile.x,projectile.y);
        continue;
      }
      projectiles[write++]=projectile;
    }
    projectiles.length=write;
  };

  function setBossState(room:any,b:any,state:string,duration:number,angle?:number){
    b.p3State=state;
    b.p3StateMs=duration;
    b.phase=state;
    b.phaseTimeLeftMs=duration;
    b.vulnerable=true;
    if(angle!=null)b.telegraphAngle=angle;
    room.broadcast("boss_phase",{type:b.type,phase:state,tier:b.tier,telegraphAngle:b.telegraphAngle});
  }

  function queueBossBurst(room:any,b:any,stage:number){
    const delay=Math.max(380,650-stage*70-Math.min(90,b.tier*10));
    const count=Math.min(6,2+stage+Math.floor(b.tier/3));
    const step=105;
    const tx=room.tank.x,ty=room.tank.y;
    const baseAngle=Math.atan2(ty-b.y,tx-b.x);
    const px=-Math.sin(baseAngle),py=Math.cos(baseAngle);
    room.broadcast("boss_target_lock",{x:tx,y:ty,delay,duration:delay+(count-1)*step+240,count,type:b.type});
    for(let i=0;i<count;i++){
      const offset=(i-(count-1)/2)*18;
      room.p3BossShots.push({
        delayMs:delay+i*step,
        targetX:tx+px*offset,
        targetY:ty+py*offset,
        bossId:b.id,
        stage,
      });
    }
  }

  function fireBossProjectile(room:any,b:any,shot:any){
    const a=Math.atan2(shot.targetY-b.y,shot.targetX-b.x);
    const speed=520+b.tier*25+shot.stage*42;
    const damage=7+b.tier*2+shot.stage*2;
    room.enemyProjectiles.push({
      id:room.nextEnemyProjectileId++,
      x:b.x,y:b.y,
      vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
      radius:9,ageMs:0,kind:"BOSS",damage,p3Source:"boss_turret",
    });
    room.broadcast("boss_turret_shot",{x:b.x,y:b.y,angle:a,type:b.type});
  }

  function processBossShots(room:any,deltaMs:number,b:any){
    const keep=[];
    for(const shot of room.p3BossShots){
      shot.delayMs-=deltaMs;
      if(shot.delayMs<=0&&room.boss===b)fireBossProjectile(room,b,shot);
      else if(shot.delayMs>0)keep.push(shot);
    }
    room.p3BossShots=keep;
  }

  function fireCobraFan(room:any,b:any,stage:number){
    const count=Math.min(9,3+stage*2);
    const center=Math.atan2(room.tank.y-b.y,room.tank.x-b.x);
    const spread=.12;
    const speed=440+b.tier*22+stage*25;
    const damage=6+b.tier*2+stage*2;
    for(let i=0;i<count;i++){
      const a=center+(i-(count-1)/2)*spread;
      room.enemyProjectiles.push({
        id:room.nextEnemyProjectileId++,
        x:b.x,y:b.y,
        vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
        radius:10,ageMs:0,kind:"BOSS_VENOM",damage,p3Source:"boss_venom",
      });
    }
    room.broadcast("venom_shot",{x:b.x,y:b.y,boss:true});
  }

  p.spawnBoss=function(){
    ensureState(this);
    const tier=Math.max(1,Math.floor(this.wave/10));
    const types=["COIL_STRIKER","LACE_MONITOR","COBRA_SENTINEL"];
    const type=types[(tier-1+this.bossSequenceIndex)%types.length];
    const radius=type==="LACE_MONITOR"?102:type==="COBRA_SENTINEL"?94:90;
    const maxHp=Math.round(3200*hpScale(this.wave));
    const pos=this.spawnNearTankEdge(760);
    this.boss={
      id:tier*10+this.bossSequenceIndex,
      type,
      x:pos.x,y:pos.y,
      rotation:Math.atan2(this.tank.y-pos.y,this.tank.x-pos.x),
      hp:maxHp,maxHp,radius,
      phase:"STALK",phaseTimeLeftMs:2200,vulnerable:true,telegraphAngle:0,tier,contactCooldownMs:0,
      p3State:"STALK",p3StateMs:2200,p3Stage:1,p3TurretMs:1100,p3VenomMs:650,p3OrbitSign:Math.random()<.5?-1:1,
    };
    this.p3BossShots=[];
    this.broadcast("boss_phase",{type,phase:"STALK",tier});
    this.broadcast("boss_stage",{type,stage:1,tier,maxHp});
  };

  p.updateBoss=function(deltaMs:number,dt:number){
    const b=this.boss;if(!b)return;
    ensureState(this);
    b.vulnerable=true;
    b.contactCooldownMs=Math.max(0,b.contactCooldownMs-deltaMs);
    b.p3StateMs-=deltaMs;
    b.phaseTimeLeftMs=Math.max(0,b.p3StateMs);

    const ratio=Math.max(0,b.hp/b.maxHp);
    const stage=ratio>.68?1:ratio>.34?2:3;
    if(stage!==b.p3Stage){
      b.p3Stage=stage;
      b.p3TurretMs=Math.min(b.p3TurretMs,500);
      this.broadcast("boss_stage",{type:b.type,stage,tier:b.tier,hp:b.hp,maxHp:b.maxHp});
    }

    b.p3TurretMs-=deltaMs;
    if(b.p3TurretMs<=0){
      queueBossBurst(this,b,stage);
      const base=b.type==="COBRA_SENTINEL"?1320:1520;
      b.p3TurretMs=Math.max(470,base-b.tier*65-(stage-1)*220);
    }
    processBossShots(this,deltaMs,b);

    const toTank=Math.atan2(this.tank.y-b.y,this.tank.x-b.x);
    const dist=Math.hypot(this.tank.x-b.x,this.tank.y-b.y)||1;

    if(b.type==="COIL_STRIKER"){
      if(b.p3State==="STALK"){
        const moveAngle=dist>410?toTank:toTank+(b.p3OrbitSign??1)*.72;
        b.rotation=this.rotateTowards(b.rotation,moveAngle,(1.65+stage*.12)*dt);
        const speed=100+b.tier*6+stage*13;
        b.x+=Math.cos(b.rotation)*speed*dt;b.y+=Math.sin(b.rotation)*speed*dt;
        if(b.p3StateMs<=0){
          const lock=toTank;
          setBossState(this,b,"TELEGRAPH",Math.max(520,980-b.tier*25-stage*80),lock);
        }
      }else if(b.p3State==="TELEGRAPH"){
        b.rotation=this.rotateTowards(b.rotation,b.telegraphAngle,3.2*dt);
        if(b.p3StateMs<=0)setBossState(this,b,"STRIKE",620,b.telegraphAngle);
      }else if(b.p3State==="STRIKE"){
        const speed=690+b.tier*24+stage*75;
        b.rotation=b.telegraphAngle;
        b.x+=Math.cos(b.telegraphAngle)*speed*dt;b.y+=Math.sin(b.telegraphAngle)*speed*dt;
        if(b.p3StateMs<=0)setBossState(this,b,"EXPOSED",Math.max(720,1250-stage*140));
      }else if(b.p3State==="EXPOSED"){
        b.rotation=this.rotateTowards(b.rotation,toTank,.8*dt);
        if(b.p3StateMs<=0)setBossState(this,b,"STALK",Math.max(1050,2200-b.tier*55-stage*180));
      }
    }else if(b.type==="LACE_MONITOR"){
      if(b.p3State==="STALK"){
        const sign=b.p3OrbitSign??1;
        const radial=dist>520?0.65:dist<330?-0.5:0;
        const vx=Math.cos(toTank)*radial+Math.cos(toTank+sign*Math.PI/2);
        const vy=Math.sin(toTank)*radial+Math.sin(toTank+sign*Math.PI/2);
        const moveAngle=Math.atan2(vy,vx);
        b.rotation=this.rotateTowards(b.rotation,moveAngle,(2+stage*.15)*dt);
        const speed=125+b.tier*7+stage*12;
        b.x+=Math.cos(b.rotation)*speed*dt;b.y+=Math.sin(b.rotation)*speed*dt;
        if(b.p3StateMs<=0)setBossState(this,b,"TELEGRAPH",Math.max(480,820-b.tier*18-stage*65),toTank);
      }else if(b.p3State==="TELEGRAPH"){
        b.rotation=this.rotateTowards(b.rotation,b.telegraphAngle,3.5*dt);
        if(b.p3StateMs<=0)setBossState(this,b,"CHARGE",780,b.telegraphAngle);
      }else if(b.p3State==="CHARGE"){
        const speed=610+b.tier*23+stage*68;
        b.rotation=b.telegraphAngle;
        b.x+=Math.cos(b.telegraphAngle)*speed*dt;b.y+=Math.sin(b.telegraphAngle)*speed*dt;
        if(b.p3StateMs<=0)setBossState(this,b,"EXPOSED",Math.max(650,1080-stage*110));
      }else if(b.p3State==="EXPOSED"){
        if(b.p3StateMs<=0){
          b.p3OrbitSign=(b.p3OrbitSign??1)*-1;
          setBossState(this,b,"STALK",Math.max(1050,2300-b.tier*55-stage*190));
        }
      }
    }else{
      // Cobra Sentinel: ranged zoning boss. It tries to hold medium range while
      // the predictive turret and fan barrages punish standing still.
      const sign=b.p3OrbitSign??1;
      const radial=dist>610?.75:dist<420?-.72:0;
      const vx=Math.cos(toTank)*radial+Math.cos(toTank+sign*Math.PI/2)*.85;
      const vy=Math.sin(toTank)*radial+Math.sin(toTank+sign*Math.PI/2)*.85;
      const moveAngle=Math.atan2(vy,vx);
      b.rotation=this.rotateTowards(b.rotation,moveAngle,(1.7+stage*.12)*dt);
      const moveSpeed=102+b.tier*6+stage*11;
      if(b.p3State!=="EXPOSED"){
        b.x+=Math.cos(b.rotation)*moveSpeed*dt;b.y+=Math.sin(b.rotation)*moveSpeed*dt;
      }

      if(b.p3State==="STALK"&&b.p3StateMs<=0){
        b.p3VenomMs=160;
        setBossState(this,b,"VENOM",Math.max(1800,2900-stage*180));
      }else if(b.p3State==="VENOM"){
        b.p3VenomMs-=deltaMs;
        if(b.p3VenomMs<=0){
          fireCobraFan(this,b,stage);
          b.p3VenomMs=Math.max(360,720-stage*85-b.tier*12);
        }
        if(b.p3StateMs<=0)setBossState(this,b,"EXPOSED",Math.max(650,1050-stage*100));
      }else if(b.p3State==="EXPOSED"&&b.p3StateMs<=0){
        b.p3OrbitSign=(b.p3OrbitSign??1)*-1;
        setBossState(this,b,"STALK",Math.max(950,2100-b.tier*45-stage*150));
      }
    }

    const hitRange=b.radius+38;
    if(this.distanceSq(b.x,b.y,this.tank.x,this.tank.y)<hitRange*hitRange&&b.contactCooldownMs<=0){
      const damage=Math.round(18+b.tier*3+stage*5);
      this.damageTank(damage,"boss_strike",b.x,b.y);
      b.contactCooldownMs=900;
    }

    b.x=this.clamp(b.x,b.radius,3600-b.radius);
    b.y=this.clamp(b.y,b.radius,2100-b.radius);
  };

  const originalHitBoss=p.hitBoss;
  p.hitBoss=function(bullet:any){
    const b=this.boss;
    if(b)b.vulnerable=true;
    const before=b?.hp??0;
    const hit=originalHitBoss.call(this,bullet);
    if(hit&&b&&this.boss===b&&b.phase==="EXPOSED"){
      const raw=Math.max(0,before-b.hp);
      if(raw>0){
        b.hp-=Math.round(raw*.35);
        if(b.hp<=0)this.defeatBoss();
      }
    }
    return hit;
  };
}
