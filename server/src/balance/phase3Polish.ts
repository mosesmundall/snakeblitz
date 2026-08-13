// Snake Blitz final Phase 3 polish.
// Adds progressively stackable hybrid traits and gentle late-game venom tracking.
// Applied after Phase 1/2/3 so it layers onto every existing snake family.
export function applyPhase3Polish(RoomClass:any){
  const p=RoomClass.prototype as any;
  if(p.__phase3PolishApplied)return;
  p.__phase3PolishApplied=true;

  type HybridTrait="ARMOURED"|"VENOM"|"HEALER"|"EXPLOSIVE"|"REGEN"|"RATTLER";

  const lerp=(a:number,b:number,t:number)=>a+(b-a)*Math.max(0,Math.min(1,t));
  const damageScale=(wave:number)=>{
    const w=Math.max(1,wave);
    if(w<=10)return lerp(.5,1,(w-1)/9);
    if(w<=20)return lerp(1,1.6,(w-10)/10);
    if(w<=30)return lerp(1.6,2.3,(w-20)/10);
    if(w<=40)return lerp(2.3,3,(w-30)/10);
    if(w<=50)return lerp(3,4,(w-40)/10);
    return 4*Math.pow(1.22,(w-50)/10);
  };

  function ensure(room:any){
    if(room.p4ComboHealers==null)room.p4ComboHealers=0;
    if(room.p4RegenMs==null)room.p4RegenMs=0;
    if(room.p4RattleCooldownMs==null)room.p4RattleCooldownMs=0;
  }

  const originalStartWave=p.startWave;
  p.startWave=function(wave:number){
    ensure(this);
    this.p4ComboHealers=0;
    this.p4RegenMs=0;
    this.p4RattleCooldownMs=0;
    return originalStartWave.call(this,wave);
  };

  function innateTraits(s:any){
    const set=new Set<HybridTrait>();
    if(s.variant==="VENOM")set.add("VENOM");
    if(s.variant==="BOMBER"||s.volatile||s.p3Class==="EXPLOSIVE"||s.p3EliteMods?.includes("EXPLOSIVE"))set.add("EXPLOSIVE");
    if(s.p2Class==="ARMOURED"||s.p3Class==="TANK"||s.p3Class==="SHIELD")set.add("ARMOURED");
    if(s.p2Class==="HEALER")set.add("HEALER");
    if(s.p2Class==="RATTLER")set.add("RATTLER");
    if(s.p3EliteMods?.includes("REGEN"))set.add("REGEN");
    return set;
  }

  function extraTraitCount(wave:number){
    let count=1;
    if(wave>=30&&Math.random()<Math.min(.72,.18+(wave-30)*.018))count++;
    if(wave>=40&&Math.random()<Math.min(.50,.12+(wave-40)*.014))count++;
    if(wave>=55&&Math.random()<Math.min(.30,.08+(wave-55)*.010))count++;
    return Math.min(4,count);
  }

  function chooseTraits(room:any,s:any):HybridTrait[]{
    const w=room.wave as number;
    if(w<20||s.p2Class==="GOLDEN"||s.variant==="CASH")return [];
    const chance=Math.min(.34,.07+(w-20)*.006);
    if(Math.random()>=chance)return [];

    const innate=innateTraits(s);
    const pool:Array<[HybridTrait,number]>=[
      ["ARMOURED",1.00],["VENOM",1.00],["EXPLOSIVE",.90],["REGEN",.82],["HEALER",.62],
    ];
    if(w>=35&&(room.phase2WaveCounts?.RATTLER??0)<1)pool.push(["RATTLER",.18]);

    let available=pool.filter(([trait])=>!innate.has(trait));
    if(room.p4ComboHealers>=1)available=available.filter(([trait])=>trait!=="HEALER");
    if(!available.length)return [];

    const target=Math.min(extraTraitCount(w),available.length);
    const chosen:HybridTrait[]=[];
    for(let i=0;i<target&&available.length;i++){
      const total=available.reduce((sum,[,weight])=>sum+weight,0);
      let roll=Math.random()*total,index=available.length-1;
      for(let j=0;j<available.length;j++){
        roll-=available[j][1];
        if(roll<=0){index=j;break;}
      }
      const [trait]=available.splice(index,1)[0];
      chosen.push(trait);
      if(trait==="RATTLER"){
        if(room.phase2WaveCounts)room.phase2WaveCounts.RATTLER=1; // consumes the one-rattler-per-wave cap
        available=available.filter(([t])=>t!=="RATTLER");
      }
      if(trait==="HEALER"){
        room.p4ComboHealers++;
        available=available.filter(([t])=>t!=="HEALER");
      }
    }
    return chosen;
  }

  function scalePersistentSpeed(s:any,mult:number){
    s.speed*=mult;
    if(s.p2BaseSpeed!=null)s.p2BaseSpeed*=mult;
    if(s.p3BaseSpeed!=null)s.p3BaseSpeed*=mult;
  }

  const originalSpawnSnake=p.spawnSnake;
  p.spawnSnake=function(){
    ensure(this);
    originalSpawnSnake.call(this);
    const s=this.snakes.get(this.nextSnakeId-1);
    if(!s)return;
    const traits=chooseTraits(this,s);
    if(!traits.length)return;

    s.p4Traits=traits;
    if(traits.includes("ARMOURED")){
      s.maxHp=Math.max(1,Math.round(s.maxHp*1.75));s.hp=s.maxHp;
      s.bodyRadius*=1.10;s.length*=1.05;scalePersistentSpeed(s,.90);
    }
    if(traits.includes("HEALER"))s.p4HealMs=2600+Math.random()*1900;
    if(traits.includes("RATTLER"))s.p4RattleMs=6500+Math.random()*3500;
    if(traits.includes("VENOM"))s.p4VenomMs=1300+Math.random()*1200;

    this.broadcast("combo_spawn",{snakeId:s.id,x:s.x,y:s.y,variant:s.variant,traits:[...traits]});
  };

  function fireHybridVenom(room:any,s:any){
    const dx=room.tank.x-s.x,dy=room.tank.y-s.y,d=Math.hypot(dx,dy)||1;
    if(d<170||d>650)return;
    const a=Math.atan2(dy,dx);
    const speed=400+Math.min(220,room.wave*5);
    const damage=Math.max(6,Math.round(7.5*damageScale(room.wave)));
    room.enemyProjectiles.push({
      id:room.nextEnemyProjectileId++,x:s.x,y:s.y,
      vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
      radius:8,ageMs:0,kind:"VENOM",damage,p4Hybrid:true,
    });
    room.broadcast("venom_shot",{x:s.x,y:s.y,angle:a,hybrid:true});
  }

  const originalUpdateSnakes=p.updateSnakes;
  p.updateSnakes=function(deltaMs:number,dt:number){
    ensure(this);
    const result=originalUpdateSnakes.call(this,deltaMs,dt);
    this.p4RattleCooldownMs=Math.max(0,this.p4RattleCooldownMs-deltaMs);

    for(const s of this.snakes.values()){
      const traits=s.p4Traits as HybridTrait[]|undefined;
      if(!traits?.length)continue;

      if(traits.includes("HEALER")){
        s.p4HealMs=(s.p4HealMs??3200)-deltaMs;
        if(s.p4HealMs<=0){
          s.p4HealMs=3400+Math.random()*1800;
          const radius=235,r2=radius*radius;
          let healed=0;
          for(const other of this.nearbySnakes(s.x,s.y,2)){
            if(other.id===s.id||other.hp>=other.maxHp)continue;
            const dx=other.x-s.x,dy=other.y-s.y;
            if(dx*dx+dy*dy>r2)continue;
            const amount=Math.max(1,Math.round(other.maxHp*.075));
            const before=other.hp;other.hp=Math.min(other.maxHp,other.hp+amount);healed+=other.hp-before;
          }
          if(healed>0)this.broadcast("healer_pulse",{x:s.x,y:s.y,radius,healed,hybrid:true});
        }
      }

      if(traits.includes("RATTLER")){
        s.p4RattleMs=(s.p4RattleMs??7500)-deltaMs;
        if(s.p4RattleMs<=0){
          s.p4RattleMs=7000+Math.random()*4000;
          if(this.p4RattleCooldownMs<=0&&(this.phase2BlackoutCooldownMs??0)<=0){
            const duration=Math.round(420+Math.random()*180);
            this.p4RattleCooldownMs=3200;
            if(this.phase2BlackoutCooldownMs!=null)this.phase2BlackoutCooldownMs=3200;
            this.broadcast("rattle_blackout",{snakeId:s.id,duration,hybrid:true});
          }
        }
      }

      if(traits.includes("VENOM")){
        s.p4VenomMs=(s.p4VenomMs??1800)-deltaMs;
        const canFire=!s.p2State||s.p2State==="CHASE"||s.p2State==="RECOVER";
        if(s.p4VenomMs<=0&&canFire){
          fireHybridVenom(this,s);
          s.p4VenomMs=Math.max(1200,2400-this.wave*12)+Math.random()*650;
        }
      }
    }

    this.p4RegenMs+=deltaMs;
    if(this.p4RegenMs>=500){
      const ticks=Math.floor(this.p4RegenMs/500);this.p4RegenMs-=ticks*500;
      for(const s of this.snakes.values()){
        if(!s.p4Traits?.includes("REGEN")||s.hp<=0||s.hp>=s.maxHp)continue;
        s.hp=Math.min(s.maxHp,s.hp+s.maxHp*.005*ticks);
      }
    }
    return result;
  };

  const originalKillSnake=p.killSnake;
  p.killSnake=function(s:any,exploded:boolean){
    const comboBlast=this.snakes.has(s.id)&&!exploded&&s.p4Traits?.includes("EXPLOSIVE");
    const x=s.x,y=s.y;
    const result=originalKillSnake.call(this,s,exploded);
    if(!comboBlast)return result;

    const radius=135;
    if(this.distanceSq(x,y,this.tank.x,this.tank.y)<radius*radius){
      const damage=Math.max(8,Math.round(8*damageScale(this.wave)));
      this.damageTank(damage,"p4_explosion",x,y);
    }
    for(const other of this.nearbySnakes(x,y,1)){
      if(!this.snakes.has(other.id)||this.distanceSq(x,y,other.x,other.y)>radius*radius)continue;
      other.hp-=Math.max(1,Math.round(other.maxHp*.30));
      if(other.hp<=0)this.killSnake(other,true);
    }
    this.broadcast("explosion_fx",{x,y,radius,tankDamage:0,hybrid:true});
    return result;
  };

  // From Wave 25 onward, ordinary snake venom gains a small amount of tracking.
  // It only steers during the first 1.6 seconds and caps at ~0.20 rad/s, so
  // continuous movement still cleanly dodges it. Boss projectiles are untouched.
  const originalUpdateEnemyProjectiles=p.updateEnemyProjectiles;
  p.updateEnemyProjectiles=function(deltaMs:number,dt:number){
    if(this.wave>=25){
      const t=Math.max(0,Math.min(1,(this.wave-25)/35));
      const turnRate=lerp(.055,.20,t);
      const maxTurn=turnRate*dt;
      for(const projectile of this.enemyProjectiles){
        if(projectile.kind!=="VENOM"||projectile.ageMs>=1600)continue;
        const speed=Math.hypot(projectile.vx,projectile.vy)||1;
        const current=Math.atan2(projectile.vy,projectile.vx);
        const desired=Math.atan2(this.tank.y-projectile.y,this.tank.x-projectile.x);
        const next=this.rotateTowards(current,desired,maxTurn);
        projectile.vx=Math.cos(next)*speed;projectile.vy=Math.sin(next)*speed;
      }
    }
    return originalUpdateEnemyProjectiles.call(this,deltaMs,dt);
  };
}
