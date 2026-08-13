// Phase 2: priority-target snake classes.
// This layer reuses TankRoom's existing movement, grid and collision loop.
// New behaviour is timer/state based and keeps Phase 1 entity caps intact.

export function applyPhase2Balance(RoomClass: any) {
  const p = RoomClass.prototype as any;
  if (p.__phase2BalanceApplied) return;
  p.__phase2BalanceApplied = true;

  type P2Class = "GOLDEN" | "HEALER" | "RATTLER" | "ARMOURED" | "CHARGER" | "ALPHA";

  const damageScale = (wave: number) => {
    const w = Math.max(1, wave);
    const lerp = (a:number,b:number,t:number)=>a+(b-a)*Math.max(0,Math.min(1,t));
    if (w <= 10) return lerp(.5, 1, (w - 1) / 9);
    if (w <= 20) return lerp(1, 1.6, (w - 10) / 10);
    if (w <= 30) return lerp(1.6, 2.3, (w - 20) / 10);
    if (w <= 40) return lerp(2.3, 3, (w - 30) / 10);
    if (w <= 50) return lerp(3, 4, (w - 40) / 10);
    return 4 * Math.pow(1.22, (w - 50) / 10);
  };

  const classCaps: Record<P2Class,number> = {
    GOLDEN:2, HEALER:3, RATTLER:1, ARMOURED:5, CHARGER:3, ALPHA:2,
  };

  function ensureRoomState(room:any){
    if(!room.phase2WaveCounts)room.phase2WaveCounts={GOLDEN:0,HEALER:0,RATTLER:0,ARMOURED:0,CHARGER:0,ALPHA:0};
    if(!room.phase2AlphaBuffed)room.phase2AlphaBuffed=new Set<number>();
    if(room.phase2AuraAccumulatorMs==null)room.phase2AuraAccumulatorMs=0;
    if(room.phase2BlackoutCooldownMs==null)room.phase2BlackoutCooldownMs=0;
  }

  const originalStartWave=p.startWave;
  p.startWave=function(wave:number){
    ensureRoomState(this);
    this.phase2WaveCounts={GOLDEN:0,HEALER:0,RATTLER:0,ARMOURED:0,CHARGER:0,ALPHA:0};
    this.phase2AlphaBuffed.clear();
    this.phase2AuraAccumulatorMs=0;
    this.phase2BlackoutCooldownMs=0;
    return originalStartWave.call(this,wave);
  };

  function chooseClass(room:any):P2Class|undefined{
    const w=room.wave as number;
    const candidates:Array<[P2Class,number]> = [];
    if(w>=4)candidates.push(["GOLDEN",.025]);
    if(w>=7)candidates.push(["HEALER",.05]);
    if(w>=9)candidates.push(["ARMOURED",.07]);
    if(w>=12)candidates.push(["CHARGER",.06]);
    if(w>=15)candidates.push(["RATTLER",.04]);
    if(w>=18)candidates.push(["ALPHA",.04]);
    const available=candidates.filter(([c])=>(room.phase2WaveCounts[c]??0)<classCaps[c]);
    if(!available.length)return undefined;
    const total=available.reduce((n,[,weight])=>n+weight,0);
    if(Math.random()>=Math.min(.285,total))return undefined;
    let roll=Math.random()*total;
    for(const [c,weight] of available){roll-=weight;if(roll<=0)return c;}
    return available[available.length-1][0];
  }

  const originalSpawnSnake=p.spawnSnake;
  p.spawnSnake=function(){
    ensureRoomState(this);
    originalSpawnSnake.call(this);
    const id=this.nextSnakeId-1;
    const s=this.snakes.get(id);
    if(!s)return;
    const cls=chooseClass(this);
    if(!cls)return;

    const stats=this.waveStats();
    this.phase2WaveCounts[cls]=(this.phase2WaveCounts[cls]??0)+1;
    s.variant=cls;
    s.p2Class=cls;
    s.p2State="CHASE";
    s.p2TimerMs=0;
    s.p2ChargeHit=false;
    s.p2LockedAngle=s.rotation;

    let hpMult=1,speedMult=1,headMult=1,bodyMult=1,lengthMult=1;
    if(cls==="GOLDEN"){hpMult=.8;speedMult=1.65;headMult=.92;bodyMult=.86;lengthMult=.9;s.p2TimerMs=7000+Math.random()*3000;}
    else if(cls==="HEALER"){hpMult=.65;speedMult=.82;headMult=.92;bodyMult=.9;lengthMult=.92;s.p2TimerMs=2600+Math.random()*1800;}
    else if(cls==="RATTLER"){hpMult=1.15;speedMult=.9;bodyMult=1.05;s.p2TimerMs=5000+Math.random()*5000;}
    else if(cls==="ARMOURED"){hpMult=4;speedMult=.68;headMult=1.15;bodyMult=1.3;lengthMult=1.14;}
    else if(cls==="CHARGER"){hpMult=1.4;speedMult=1.02;headMult=1.04;bodyMult=1.06;lengthMult=1.04;s.p2TimerMs=3200+Math.random()*3000;}
    else if(cls==="ALPHA"){hpMult=1.8;speedMult=.82;headMult=1.12;bodyMult=1.15;lengthMult=1.12;}

    const hp=Math.max(1,Math.round(stats.hp*hpMult));
    s.hp=hp;s.maxHp=hp;
    s.speed=stats.speed*speedMult;
    s.turnSpeed=Math.max(1.5,s.turnSpeed*(cls==="ARMOURED"?.8:1));
    s.headRadius=stats.headRadius*headMult;
    s.bodyRadius=stats.bodyRadius*bodyMult;
    s.length=stats.length*lengthMult;
    s.p2BaseSpeed=s.speed;
    s.p2BaseTurnSpeed=s.turnSpeed;
  };

  function rebuildAlphaAura(room:any){
    room.phase2AlphaBuffed.clear();
    const alphas=[...room.snakes.values()].filter((s:any)=>s.p2Class==="ALPHA");
    if(!alphas.length)return;
    const r2=300*300;
    for(const a of alphas){
      for(const s of room.snakes.values()){
        if(s.id===a.id)continue;
        const dx=s.x-a.x,dy=s.y-a.y;
        if(dx*dx+dy*dy<=r2)room.phase2AlphaBuffed.add(s.id);
      }
    }
  }

  const originalUpdateSnakes=p.updateSnakes;
  p.updateSnakes=function(deltaMs:number,dt:number){
    ensureRoomState(this);
    this.phase2BlackoutCooldownMs=Math.max(0,this.phase2BlackoutCooldownMs-deltaMs);
    this.phase2AuraAccumulatorMs+=deltaMs;
    if(this.phase2AuraAccumulatorMs>=250){
      this.phase2AuraAccumulatorMs-=250;
      rebuildAlphaAura(this);
    }

    const pre=[...this.snakes.values()];
    for(const s of pre){
      if(!s.p2Class)continue;
      s.p2BaseSpeed=s.p2BaseSpeed??s.speed;
      s.p2BaseTurnSpeed=s.p2BaseTurnSpeed??s.turnSpeed;
      const alphaBoost=this.phase2AlphaBuffed.has(s.id)?1.2:1;
      s.speed=s.p2BaseSpeed*alphaBoost;
      s.turnSpeed=s.p2BaseTurnSpeed;

      if(s.p2Class==="GOLDEN"){
        s.p2TimerMs-=deltaMs;
        // The base AI still points toward the tank; negative speed makes the
        // Golden snake flee without adding a second steering/pathfinding system.
        s.speed=-Math.abs(s.p2BaseSpeed)*alphaBoost;
      }
      else if(s.p2Class==="HEALER"){
        s.p2TimerMs-=deltaMs;
        if(s.p2TimerMs<=0){
          s.p2TimerMs=3000+Math.random()*1700;
          const radius=250,r2=radius*radius;
          let healed=0;
          for(const other of this.snakes.values()){
            if(other.id===s.id||other.hp>=other.maxHp)continue;
            const dx=other.x-s.x,dy=other.y-s.y;
            if(dx*dx+dy*dy>r2)continue;
            const amount=Math.max(1,Math.round(other.maxHp*.1));
            const before=other.hp;
            other.hp=Math.min(other.maxHp,other.hp+amount);
            healed+=other.hp-before;
          }
          if(healed>0)this.broadcast("healer_pulse",{x:s.x,y:s.y,radius,healed});
        }
      }
      else if(s.p2Class==="RATTLER"){
        s.p2TimerMs-=deltaMs;
        if(s.p2TimerMs<=0){
          s.p2TimerMs=5000+Math.random()*5000;
          // Room-wide lockout prevents several rattlers from chaining a
          // permanent blackout.
          if(this.phase2BlackoutCooldownMs<=0){
            const duration=Math.round(320+Math.random()*240);
            this.phase2BlackoutCooldownMs=2800;
            this.broadcast("rattle_blackout",{snakeId:s.id,duration});
          }
        }
      }
      else if(s.p2Class==="CHARGER"){
        s.p2TimerMs-=deltaMs;
        if(s.p2State==="CHASE"&&s.p2TimerMs<=0){
          const dist=Math.hypot(this.tank.x-s.x,this.tank.y-s.y);
          if(dist<760){
            s.p2State="TELEGRAPH";
            s.p2TimerMs=850;
            s.p2LockedAngle=Math.atan2(this.tank.y-s.y,this.tank.x-s.x);
            s.rotation=s.p2LockedAngle;
            s.speed=0;s.turnSpeed=0;s.p2ChargeHit=false;
            this.broadcast("charger_telegraph",{snakeId:s.id,x:s.x,y:s.y,angle:s.p2LockedAngle,duration:850});
          }else s.p2TimerMs=900;
        }else if(s.p2State==="TELEGRAPH"){
          s.rotation=s.p2LockedAngle;s.speed=0;s.turnSpeed=0;
          if(s.p2TimerMs<=0){
            s.p2State="CHARGE";s.p2TimerMs=680;
            s.speed=Math.max(520,s.p2BaseSpeed*4.1);
            s.turnSpeed=0;
            s.contactCooldownMs=Math.max(s.contactCooldownMs,1200);
          }
        }else if(s.p2State==="CHARGE"){
          s.rotation=s.p2LockedAngle;
          s.speed=Math.max(520,s.p2BaseSpeed*4.1);
          s.turnSpeed=0;
          s.contactCooldownMs=Math.max(s.contactCooldownMs,1200);
          if(s.p2TimerMs<=0){
            s.p2State="RECOVER";s.p2TimerMs=850;
            s.speed=s.p2BaseSpeed*.52;s.turnSpeed=s.p2BaseTurnSpeed*.7;
          }
        }else if(s.p2State==="RECOVER"){
          s.speed=s.p2BaseSpeed*.52;s.turnSpeed=s.p2BaseTurnSpeed*.7;
          if(s.p2TimerMs<=0){
            s.p2State="CHASE";s.p2TimerMs=3800+Math.random()*2800;s.p2ChargeHit=false;
          }
        }
      }
    }

    originalUpdateSnakes.call(this,deltaMs,dt);

    for(const s of [...this.snakes.values()]){
      if(!s.p2Class)continue;

      if(s.p2Class==="CHARGER"&&s.p2State==="CHARGE"&&!s.p2ChargeHit){
        const range=38+s.headRadius+9;
        const dx=this.tank.x-s.x,dy=this.tank.y-s.y;
        if(dx*dx+dy*dy<=range*range){
          const alpha=this.phase2AlphaBuffed.has(s.id)?1.25:1;
          const damage=Math.max(18,Math.round(17*damageScale(this.wave)*alpha));
          s.p2ChargeHit=true;s.p2State="RECOVER";s.p2TimerMs=950;
          this.damageTank(damage,"charger",s.x,s.y);
        }
      }

      if(s.p2Class==="GOLDEN"&&s.p2TimerMs<=0){
        this.snakes.delete(s.id);
        this.broadcast("golden_escaped",{snakeId:s.id,x:s.x,y:s.y});
        continue;
      }

      if(this.snakes.has(s.id)){
        s.speed=s.p2BaseSpeed;
        s.turnSpeed=s.p2BaseTurnSpeed;
      }
    }
  };

  // Resolve support/armour multipliers using the attacker's coordinates that
  // the existing bite collision already supplies. No extra collision objects.
  const originalDamageTank=p.damageTank;
  p.damageTank=function(amount:number,source:string,x:number,y:number){
    if(source==="bite"){
      let attacker:any;
      let best=80*80;
      for(const s of this.snakes.values()){
        const dx=s.x-x,dy=s.y-y,d2=dx*dx+dy*dy;
        if(d2<best){best=d2;attacker=s;}
      }
      if(attacker?.p2Class==="ARMOURED"||this.phase2AlphaBuffed?.has(attacker?.id)){
        let scaled=Math.max(5,Math.round(10*damageScale(this.wave)));
        if(attacker?.p2Class==="ARMOURED")scaled=Math.round(scaled*1.75);
        if(this.phase2AlphaBuffed?.has(attacker?.id))scaled=Math.round(scaled*1.3);
        return originalDamageTank.call(this,scaled,"special_bite",x,y);
      }
    }
    return originalDamageTank.call(this,amount,source,x,y);
  };

  const originalKillSnake=p.killSnake;
  p.killSnake=function(s:any,exploded:boolean){
    const wasAlive=this.snakes.has(s.id);
    const golden=wasAlive&&s.p2Class==="GOLDEN";
    const x=s.x,y=s.y;
    originalKillSnake.call(this,s,exploded);
    if(golden){
      const reward=Math.round((200+this.wave*30)/5)*5;
      this.cash+=reward;
      this.cashCollected+=reward;
      this.score+=reward;
      this.broadcast("golden_reward",{x,y,reward,cash:this.cash});
    }
  };
}
