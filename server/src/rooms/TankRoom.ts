import { Client, Room } from "colyseus";
import { leaderboardStore } from "../leaderboard";

const WORLD_WIDTH = 3600;
const WORLD_HEIGHT = 2100;
const BASE_TANK_SPEED = 300;
const BASE_TANK_REVERSE_SPEED = 195;
const BASE_TANK_TURN_SPEED = 2.5;
const TANK_RADIUS = 38;
const BASE_TANK_MAX_HEALTH = 100;
const BASE_BULLET_SPEED = 1040;
const BASE_FIRE_INTERVAL_MS = 205;
const BASE_BODY_DAMAGE = 12;
const HEADSHOT_MULTIPLIER = 4;
const SHOP_SECONDS = 26;
const SNAPSHOT_INTERVAL_MS = Math.max(20, Math.min(100, Number(process.env.SNAPSHOT_INTERVAL_MS) || 20));
const IDLE_SNAPSHOT_INTERVAL_MS = Math.max(SNAPSHOT_INTERVAL_MS, Math.min(500, Number(process.env.IDLE_SNAPSHOT_INTERVAL_MS) || 100));
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type Role = "driver" | "gunner";
type Phase = "waiting" | "combat" | "intermission" | "boss_reward" | "gameover";
type WaveType = "NORMAL" | "BONUS_MONEY" | "VOLATILE_SNAKES" | "BLACKOUT" | "FRENZY" | "TITAN_NEST" | "BOSS";
type EnemyVariant = "NORMAL" | "BOMBER" | "VENOM" | "CASH";
type BossType = "COIL_STRIKER" | "LACE_MONITOR" | "COBRA_SENTINEL";
type BossPhase = "STALK" | "TELEGRAPH" | "STRIKE" | "EXPOSED" | "VENOM" | "CHARGE";
type BoostType = "SPEED" | "MEDKIT" | "REVIVE" | "BOMB" | "NUKE" | "CASH_BONUS";
type UpgradeId = "AP_AMMO" | "AUTOLOADER" | "ENGINE" | "ARMOR" | "HV_SHELLS" | "SCAVENGER" | "ORDNANCE";

interface PlayerInfo { sessionId: string; name: string; role: Role; ownerSessionId: string; }
interface DriveInput { throttle: number; turn: number; }
interface GunInput { angle: number; firing: boolean; }
interface Bullet { id:number; x:number; y:number; vx:number; vy:number; ageMs:number; radius:number; splashRadius:number; weaponTier:string; }
interface EnemyProjectile { id:number; x:number; y:number; vx:number; vy:number; radius:number; ageMs:number; kind:"VENOM"; damage:number; }
interface SnakeEnemy {
  id:number; x:number; y:number; rotation:number; speed:number; turnSpeed:number; hp:number; maxHp:number;
  headRadius:number; bodyRadius:number; length:number; volatile:boolean; contactCooldownMs:number; seed:number;
  variant:EnemyVariant; attackCooldownMs:number;
}
interface BossEnemy {
  id:number; type:BossType; x:number; y:number; rotation:number; hp:number; maxHp:number; radius:number;
  phase:BossPhase; phaseTimeLeftMs:number; vulnerable:boolean; telegraphAngle:number; tier:number; contactCooldownMs:number;
}
interface CashCrate { id:number; x:number; y:number; value:number; timeLeftMs:number; }
interface UpgradeDefinition { id:UpgradeId; name:string; shortName:string; description:string; baseCost:number; costGrowth:number; maxLevel:number; }

const OBSTACLES = [
  { id:1,x:560,y:420,radius:72,type:"rock",label:"Granite Ridge" },
  { id:2,x:1020,y:350,radius:64,type:"rock" },
  { id:3,x:1640,y:330,radius:82,type:"wreck",label:"Convoy Wreck" },
  { id:4,x:2300,y:390,radius:70,type:"rock" },
  { id:5,x:3050,y:410,radius:88,type:"base",label:"North Outpost" },
  { id:6,x:3250,y:690,radius:58,type:"tower" },
  { id:7,x:2850,y:1030,radius:76,type:"wreck" },
  { id:8,x:3230,y:1550,radius:96,type:"base",label:"Eastern Depot" },
  { id:9,x:2650,y:1740,radius:62,type:"rock" },
  { id:10,x:2120,y:1620,radius:88,type:"wreck" },
  { id:11,x:1780,y:1790,radius:66,type:"rock" },
  { id:12,x:1180,y:1660,radius:92,type:"base",label:"Old Field Base" },
  { id:13,x:650,y:1750,radius:70,type:"wreck" },
  { id:14,x:350,y:1370,radius:86,type:"rock" },
  { id:15,x:420,y:900,radius:68,type:"tower" },
  { id:16,x:920,y:970,radius:54,type:"rock" },
  { id:17,x:1450,y:920,radius:72,type:"wreck" },
  { id:18,x:2210,y:1010,radius:62,type:"rock" },
  { id:19,x:1880,y:660,radius:52,type:"tower" },
  { id:20,x:1500,y:1370,radius:58,type:"rock" },
  { id:21,x:2450,y:1360,radius:68,type:"rock" },
];

const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  { id:"AP_AMMO", name:"AP Ammunition", shortName:"DAMAGE", description:"Harder-hitting shells. Keeps the 4× headshot reward.", baseCost:240, costGrowth:1.5, maxLevel:10 },
  { id:"AUTOLOADER", name:"Autoloader", shortName:"FIRE RATE", description:"Faster cycling, plus visible loader hardware at higher levels.", baseCost:280, costGrowth:1.52, maxLevel:9 },
  { id:"ENGINE", name:"Engine Tune", shortName:"MOBILITY", description:"More speed, reverse authority and steering response.", baseCost:220, costGrowth:1.48, maxLevel:9 },
  { id:"ARMOR", name:"Reinforced Armour", shortName:"SURVIVABILITY", description:"Adds maximum integrity and visible armour plating.", baseCost:330, costGrowth:1.56, maxLevel:8 },
  { id:"HV_SHELLS", name:"High-Velocity Shells", shortName:"BALLISTICS", description:"Faster shells make long-range weak-point shots easier.", baseCost:180, costGrowth:1.45, maxLevel:8 },
  { id:"SCAVENGER", name:"Scavenger Rig", shortName:"ECONOMY", description:"Improves crate value and pickup reach.", baseCost:240, costGrowth:1.5, maxLevel:7 },
  { id:"ORDNANCE", name:"Siege Ordnance", shortName:"WARHEAD", description:"Bigger projectiles and splash. Evolves into rockets at high levels.", baseCost:650, costGrowth:1.62, maxLevel:6 },
];

const BOOST_NAMES: Record<BoostType,{name:string;description:string}> = {
  SPEED:{name:"Overdrive",description:"8 seconds of extreme engine speed."},
  MEDKIT:{name:"Field Medkit",description:"Restore 45 tank integrity instantly."},
  REVIVE:{name:"Phoenix Kit",description:"Automatically revives the tank once at 45% integrity."},
  BOMB:{name:"Shock Bomb",description:"Blast nearby enemies and heavily damage non-bosses."},
  NUKE:{name:"Nuclear Clearance",description:"Ultra-rare: clears all normal enemies on the field."},
  CASH_BONUS:{name:"Requisition Cache",description:"Instantly grants a large cash award."},
};

export class TankRoom extends Room {
  maxClients = 2;
  private readonly lobbyChannel = "$snake-blitz-room-codes";
  private mode:"online"|"local" = "online";
  private localOwnerSessionId = "";
  private players = new Map<string,PlayerInfo>();
  private driveInputs = new Map<string,DriveInput>();
  private gunInputs = new Map<string,GunInput>();
  private tank = { x:WORLD_WIDTH/2,y:WORLD_HEIGHT/2,rotation:-Math.PI/2,turretRotation:-Math.PI/2,health:100,maxHealth:100 };
  private bullets:Bullet[]=[]; private enemyProjectiles:EnemyProjectile[]=[];
  private snakes=new Map<number,SnakeEnemy>(); private boss?:BossEnemy; private cashCrates=new Map<number,CashCrate>();
  private readonly snakeGridCell=180; private snakeGrid=new Map<number,SnakeEnemy[]>();
  private nextBulletId=1; private nextEnemyProjectileId=1; private nextSnakeId=1; private nextCashId=1;
  private fireCooldownMs=0; private snapshotAccumulatorMs=0; private spawnAccumulatorMs=0; private cashSpawnAccumulatorMs=0;
  private spawnRemaining=0; private spawnIntervalMs=430; private phase:Phase="waiting"; private wave=0; private waveType:WaveType="NORMAL";
  private previousWaveType:WaveType="NORMAL"; private phaseTimeLeftMs=0; private waveElapsedMs=0; private lastClearMultiplier=10;
  private score=0; private cash=0; private cashCollected=0; private kills=0; private headshots=0;
  private readyPlayers=new Set<string>(); private pendingBossReward?:BoostType; private selectedBoostIndex=0;
  private reviveCharges=0; private speedBoostMs=0; private bossReinforcements=0; private bossSequenceIndex=0;
  private boostInventory:Record<BoostType,number>={SPEED:0,MEDKIT:0,REVIVE:0,BOMB:0,NUKE:0,CASH_BONUS:0};
  private upgradeLevels:Record<UpgradeId,number>={AP_AMMO:0,AUTOLOADER:0,ENGINE:0,ARMOR:0,HV_SHELLS:0,SCAVENGER:0,ORDNANCE:0};

  messages = {
    drive:(client:Client,p:any)=>{ if(!this.canControl(client,"driver"))return; const key=this.controllerKey(client,"driver"); this.driveInputs.set(key,{throttle:this.clamp(Number(p?.throttle??0),-1,1),turn:this.clamp(Number(p?.turn??0),-1,1)}); },
    aim:(client:Client,p:any)=>{ if(!this.canControl(client,"gunner"))return; const key=this.controllerKey(client,"gunner"); const cur=this.gunInputs.get(key)??{angle:this.tank.turretRotation,firing:false}; const angle=Number(p?.angle); if(Number.isFinite(angle))cur.angle=angle; this.gunInputs.set(key,cur); },
    firing:(client:Client,p:any)=>{ if(!this.canControl(client,"gunner"))return; const key=this.controllerKey(client,"gunner"); const cur=this.gunInputs.get(key)??{angle:this.tank.turretRotation,firing:false}; cur.firing=Boolean(p?.firing); this.gunInputs.set(key,cur); },
    buy_upgrade:(client:Client,p:any)=>{ if(this.phase!=="intermission")return; this.purchaseUpgrade(client,String(p?.id??"") as UpgradeId); },
    buy_repair:(client:Client)=>{ if(this.phase!=="intermission")return; this.purchaseRepair(client); },
    shop_ready:(client:Client,p:any)=>{ if(this.phase!=="intermission")return; const ready=Boolean(p?.ready); if(this.mode==="local"){ if(ready){for(const pl of this.players.values())this.readyPlayers.add(pl.sessionId);}else this.readyPlayers.clear(); } else { if(ready)this.readyPlayers.add(client.sessionId);else this.readyPlayers.delete(client.sessionId); } this.broadcast("shop_ready_changed",{}); if(this.readyPlayers.size>=2)this.startWave(this.wave+1); },
    cycle_boost:(_client:Client,p:any)=>{ const inv=this.inventoryArray().filter(i=>i.count>0); if(!inv.length)return; this.selectedBoostIndex=(this.selectedBoostIndex+(Number(p?.direction??1)>=0?1:-1)+inv.length)%inv.length; },
    use_boost:(client:Client)=>this.useSelectedBoost(client),
    spin_boss_reward:(client:Client)=>{ if(this.phase!=="boss_reward"||this.pendingBossReward)return; this.pendingBossReward=this.rollBossReward(); this.boostInventory[this.pendingBossReward]++; this.broadcast("boss_reward",{reward:this.pendingBossReward,...BOOST_NAMES[this.pendingBossReward]}); },
    continue_after_boss:(_client:Client)=>{ if(this.phase!=="boss_reward"||!this.pendingBossReward)return; this.openIntermission(); },
    restart:(client:Client)=>{ if(this.phase!=="gameover")return; this.resetRun(); this.assignRandomStartingRoles(); this.startWave(1); },
  };

  async onCreate(options:any){
    this.mode=options?.mode==="local"?"local":"online";
    // Local co-op never needs a public four-character join code. Keeping the
    // default Colyseus roomId here also avoids touching Presence entirely.
    if(this.mode==="online")this.roomId=await this.generateRoomId();
    this.setSimulationInterval(d=>this.updateGame(d),1000/45);
  }

  onJoin(client:Client,options:any){
    if(this.mode==="local"){
      if(this.players.size>0){ client.leave(4000,"Local game already occupied"); return; }
      this.localOwnerSessionId=client.sessionId;
      const n1=this.cleanName(options?.name1??"Player 1"), n2=this.cleanName(options?.name2??"Player 2");
      this.players.set("local-1",{sessionId:"local-1",name:n1,role:"driver",ownerSessionId:client.sessionId});
      this.players.set("local-2",{sessionId:"local-2",name:n2,role:"gunner",ownerSessionId:client.sessionId});
      this.driveInputs.set("local-driver",{throttle:0,turn:0}); this.gunInputs.set("local-gunner",{angle:this.tank.turretRotation,firing:false});
      client.send("room_info",{roomId:this.roomId,sessionId:client.sessionId,mode:"local"});
      this.lock(); this.resetRun(); this.assignRandomStartingRoles(); this.startWave(1);
    } else {
      const name=this.cleanName(options?.name);
      this.players.set(client.sessionId,{sessionId:client.sessionId,name,role:"driver",ownerSessionId:client.sessionId});
      this.driveInputs.set(client.sessionId,{throttle:0,turn:0}); this.gunInputs.set(client.sessionId,{angle:this.tank.turretRotation,firing:false});
      client.send("room_info",{roomId:this.roomId,sessionId:client.sessionId,mode:"online"});
      if(this.players.size===2){ this.lock(); this.resetRun(); this.assignRandomStartingRoles(); this.startWave(1); }
    }
    this.broadcastSnapshot();
  }

  onLeave(client:Client){
    if(this.mode==="local"){ this.players.clear(); this.phase="waiting"; return; }
    this.players.delete(client.sessionId); this.driveInputs.delete(client.sessionId); this.gunInputs.delete(client.sessionId); this.readyPlayers.delete(client.sessionId);
    if(this.players.size<2){this.phase="waiting";this.bullets=[];this.enemyProjectiles=[];this.snakes.clear();this.boss=undefined;this.cashCrates.clear();this.spawnRemaining=0;this.unlock();}
    this.broadcastSnapshot();
  }
  async onDispose(){
    if(this.mode==="online")await this.presence.srem(this.lobbyChannel,this.roomId);
  }

  private updateGame(deltaMs:number){
    const dt=Math.min(deltaMs,50)/1000;
    if(this.players.size===2){
      if(this.phase==="combat"){
        this.waveElapsedMs+=deltaMs; this.updateTank(dt); this.updateGun(deltaMs); this.updateSpawning(deltaMs); this.updateSnakes(deltaMs,dt); this.updateBoss(deltaMs,dt); this.updateBullets(deltaMs,dt); this.updateEnemyProjectiles(deltaMs,dt); this.updateCash(deltaMs); this.checkWaveComplete();
      } else if(this.phase==="intermission"){ this.phaseTimeLeftMs-=deltaMs; if(this.phaseTimeLeftMs<=0)this.startWave(this.wave+1); }
    }
    const snapshotInterval=this.phase==="combat"?SNAPSHOT_INTERVAL_MS:IDLE_SNAPSHOT_INTERVAL_MS;
    this.snapshotAccumulatorMs+=deltaMs; if(this.snapshotAccumulatorMs>=snapshotInterval){this.snapshotAccumulatorMs=0;this.broadcastSnapshot();}
  }

  private resetRun(){
    Object.assign(this.tank,{x:WORLD_WIDTH/2,y:WORLD_HEIGHT/2,rotation:-Math.PI/2,turretRotation:-Math.PI/2,maxHealth:BASE_TANK_MAX_HEALTH,health:BASE_TANK_MAX_HEALTH});
    this.bullets=[];this.enemyProjectiles=[];this.snakes.clear();this.boss=undefined;this.cashCrates.clear();this.nextBulletId=1;this.nextEnemyProjectileId=1;this.nextSnakeId=1;this.nextCashId=1;
    this.fireCooldownMs=0;this.wave=0;this.waveType="NORMAL";this.previousWaveType="NORMAL";this.phase="waiting";this.phaseTimeLeftMs=0;this.waveElapsedMs=0;this.lastClearMultiplier=10;
    this.score=0;this.cash=250;this.cashCollected=0;this.kills=0;this.headshots=0;this.readyPlayers.clear();this.pendingBossReward=undefined;this.selectedBoostIndex=0;this.reviveCharges=0;this.speedBoostMs=0;this.bossReinforcements=0;this.bossSequenceIndex=0;
    for(const k of Object.keys(this.boostInventory) as BoostType[])this.boostInventory[k]=0;
    for(const d of UPGRADE_DEFINITIONS)this.upgradeLevels[d.id]=0; this.resetInputs();
  }

  private updateTank(dt:number){
    const driver=[...this.players.values()].find(p=>p.role==="driver"); if(!driver)return;
    const key=this.mode==="local"?"local-driver":driver.sessionId; const input=this.driveInputs.get(key)??{throttle:0,turn:0}; const stats=this.combatStats();
    if(this.speedBoostMs>0)this.speedBoostMs=Math.max(0,this.speedBoostMs-dt*1000);
    const boost=this.speedBoostMs>0?1.75:1; const speed=(input.throttle>=0?stats.forwardSpeed:stats.reverseSpeed)*boost;
    this.tank.rotation+=input.turn*stats.turnSpeed*dt*(Math.abs(input.throttle)>0.05?1:0.72);
    this.tank.x+=Math.cos(this.tank.rotation)*input.throttle*speed*dt; this.tank.y+=Math.sin(this.tank.rotation)*input.throttle*speed*dt;
    const m=55;this.tank.x=this.clamp(this.tank.x,m,WORLD_WIDTH-m);this.tank.y=this.clamp(this.tank.y,m,WORLD_HEIGHT-m);this.resolveTankObstacleCollisions();
  }
  private resolveTankObstacleCollisions(){for(const o of OBSTACLES){const dx=this.tank.x-o.x,dy=this.tank.y-o.y,d=Math.hypot(dx,dy)||.001,min=TANK_RADIUS+o.radius;if(d<min){const p=min-d;this.tank.x+=dx/d*p;this.tank.y+=dy/d*p;}}}

  private updateGun(deltaMs:number){
    const gunner=[...this.players.values()].find(p=>p.role==="gunner"); if(!gunner)return;
    const key=this.mode==="local"?"local-gunner":gunner.sessionId; const input=this.gunInputs.get(key);if(!input)return;this.tank.turretRotation=input.angle;this.fireCooldownMs=Math.max(0,this.fireCooldownMs-deltaMs);
    if(input.firing&&this.fireCooldownMs<=0){this.spawnBullet();this.fireCooldownMs=this.combatStats().fireIntervalMs;}
  }
  private spawnBullet(){const s=this.combatStats(),a=this.tank.turretRotation,m=78,x=this.tank.x+Math.cos(a)*m,y=this.tank.y+Math.sin(a)*m;this.bullets.push({id:this.nextBulletId++,x,y,vx:Math.cos(a)*s.bulletSpeed,vy:Math.sin(a)*s.bulletSpeed,ageMs:0,radius:s.bulletRadius,splashRadius:s.splashRadius,weaponTier:s.weaponTier});this.broadcast("shot_fx",{x,y,angle:a,radius:s.bulletRadius,weaponTier:s.weaponTier});}

  private updateBullets(deltaMs:number,dt:number){
    const survivors:Bullet[]=[];
    for(const b of this.bullets){
      b.x+=b.vx*dt;b.y+=b.vy*dt;b.ageMs+=deltaMs;if(b.ageMs>2100||b.x<0||b.x>WORLD_WIDTH||b.y<0||b.y>WORLD_HEIGHT)continue;
      if(OBSTACLES.some(o=>this.distanceSq(b.x,b.y,o.x,o.y)<(o.radius+b.radius)**2)){this.broadcast("impact_fx",{x:b.x,y:b.y,kind:"obstacle"});continue;}
      if(this.boss&&this.hitBoss(b))continue;
      let hit=false;for(const enemy of this.nearbySnakes(b.x,b.y,1)){if(this.hitSnake(b,enemy)){hit=true;break;}}if(!hit)survivors.push(b);
    }
    this.bullets=survivors;
  }
  private hitSnake(b:Bullet,s:SnakeEnemy){
    const dx=b.x-s.x,dy=b.y-s.y;const c=Math.cos(-s.rotation),si=Math.sin(-s.rotation);const lx=dx*c-dy*si,ly=dx*si+dy*c;
    const head=lx>-s.headRadius*.8&&lx<s.headRadius*1.3&&Math.abs(ly)<s.headRadius*.9; const body=lx<=0&&lx>-s.length&&Math.abs(ly)<s.bodyRadius*1.2;
    if(!head&&!body)return false; const damage=head?this.combatStats().headDamage:this.combatStats().bodyDamage; s.hp-=damage;if(head)this.headshots++;this.score+=head?35:8;
    this.broadcast("hit_fx",{x:b.x,y:b.y,damage,headshot:head,variant:s.variant});
    if(s.volatile&&Math.random()<.14)this.explodeSnake(s,true);
    else if(s.hp<=0)this.killSnake(s,false);
    if(b.splashRadius>0)this.applySplash(b.x,b.y,b.splashRadius,Math.round(damage*.45),s.id);
    return true;
  }
  private hitBoss(b:Bullet){
    const boss=this.boss!;if(this.distanceSq(b.x,b.y,boss.x,boss.y)>(boss.radius+b.radius)**2)return false;
    if(!boss.vulnerable){this.broadcast("impact_fx",{x:b.x,y:b.y,kind:"boss_armor"});return true;}
    const weakAngle=Math.atan2(b.y-boss.y,b.x-boss.x);const facingDiff=Math.abs(this.normalizeAngle(weakAngle-boss.rotation));const precision=facingDiff<.55;
    const base=this.combatStats().bodyDamage;const damage=precision?this.combatStats().headDamage:Math.round(base*.75);boss.hp-=damage;if(precision)this.headshots++;this.score+=precision?60:15;this.broadcast("hit_fx",{x:b.x,y:b.y,damage,headshot:precision,boss:true});
    if(boss.hp<=0)this.defeatBoss();return true;
  }
  private applySplash(x:number,y:number,r:number,damage:number,exclude:number){const cells=Math.max(1,Math.ceil(r/this.snakeGridCell));for(const s of this.nearbySnakes(x,y,cells)){if(s.id===exclude||!this.snakes.has(s.id))continue;if(this.distanceSq(x,y,s.x,s.y)<=r*r){s.hp-=damage;if(s.hp<=0)this.killSnake(s,false);}}this.broadcast("explosion_fx",{x,y,radius:r,tankDamage:0,weapon:true});}

  private updateSpawning(deltaMs:number){if(this.waveType==="BOSS"||this.spawnRemaining<=0)return;this.spawnAccumulatorMs-=deltaMs;if(this.spawnAccumulatorMs>0)return;const burst=this.waveType==="FRENZY"&&Math.random()<.3?2:1;for(let i=0;i<burst&&this.spawnRemaining>0;i++){this.spawnSnake();this.spawnRemaining--;}this.spawnAccumulatorMs=this.spawnIntervalMs;}
  private spawnSnake(){
    const stats=this.waveStats(),spawn=this.spawnNearTankEdge(),id=this.nextSnakeId++;let variant:EnemyVariant="NORMAL";const r=Math.random();if(this.wave>=4&&r<.12)variant="BOMBER";else if(this.wave>=6&&r<.22)variant="VENOM";else if(this.wave>=3&&r<.30)variant="CASH";
    const speed=stats.speed*(variant==="BOMBER"?1.48:variant==="VENOM"?.65:1)*this.randomRange(.9,1.1);const hp=Math.round(stats.hp*(variant==="BOMBER"?.7:variant==="VENOM"?1.25:variant==="CASH"?.9:1));
    this.snakes.set(id,{id,x:spawn.x,y:spawn.y,rotation:Math.atan2(this.tank.y-spawn.y,this.tank.x-spawn.x),speed,turnSpeed:this.randomRange(2.2,3.2),hp,maxHp:hp,headRadius:stats.headRadius*(variant==="VENOM"?1.12:1),bodyRadius:stats.bodyRadius*(variant==="BOMBER"?.85:1),length:stats.length*(variant==="BOMBER"?.8:1),volatile:this.waveType==="VOLATILE_SNAKES"&&Math.random()<.72,contactCooldownMs:this.randomRange(0,300),seed:Math.random()*Math.PI*2,variant,attackCooldownMs:this.randomRange(900,2200)});
  }
  private waveStats(){const l=Math.max(0,this.wave-1);let count=Math.min(58,7+Math.floor(this.wave*1.8)),hp=Math.min(1100,Math.round(54*Math.pow(1.14,l))),speed=Math.min(190,88+l*4.2),headRadius=Math.max(9,27-l*1.02),bodyRadius=Math.min(24,11+l*.68),length=Math.min(165,92+l*3.1);if(this.waveType==="FRENZY"){count=Math.round(count*1.5);hp=Math.round(hp*.62);speed*=1.28;headRadius*=.88;bodyRadius*=.84;length*=.86;}if(this.waveType==="TITAN_NEST"){count=Math.max(4,Math.round(count*.45));hp=Math.round(hp*2.3);speed*=.8;headRadius*=1.12;bodyRadius*=1.5;length*=1.26;}return{count,hp,speed,headRadius,bodyRadius,length};}

  private updateSnakes(deltaMs:number,dt:number){
    this.rebuildSnakeGrid(this.snakes.values());
    for(const enemy of this.snakes.values()){
      if(!this.snakes.has(enemy.id))continue;enemy.contactCooldownMs=Math.max(0,enemy.contactCooldownMs-deltaMs);enemy.attackCooldownMs=Math.max(0,enemy.attackCooldownMs-deltaMs);
      const tx=this.tank.x-enemy.x,ty=this.tank.y-enemy.y,dToTank=Math.hypot(tx,ty)||1;
      if(enemy.variant==="VENOM"&&dToTank<520){if(enemy.attackCooldownMs<=0){this.fireVenom(enemy);enemy.attackCooldownMs=Math.max(900,2200-this.wave*20);}enemy.rotation=this.rotateTowards(enemy.rotation,Math.atan2(ty,tx),enemy.turnSpeed*dt);continue;}
      let dx=tx/dToTank,dy=ty/dToTank,sepX=0,sepY=0;
      // Spatial hashing makes separation roughly O(n) instead of O(n²).
      for(const other of this.nearbySnakes(enemy.x,enemy.y,1)){
        if(other.id===enemy.id)continue;const ox=enemy.x-other.x,oy=enemy.y-other.y,d2=ox*ox+oy*oy,range=Math.max(48,(enemy.bodyRadius+other.bodyRadius)*2.1);
        if(d2>1&&d2<range*range){const d=Math.sqrt(d2),q=(range-d)/range;sepX+=ox/d*q;sepY+=oy/d*q;}
      }
      let ax=0,ay=0;
      for(const o of OBSTACLES){const ox=enemy.x-o.x,oy=enemy.y-o.y,range=o.radius+enemy.bodyRadius+75,d2=ox*ox+oy*oy;if(d2<range*range){const d=Math.sqrt(d2)||.001,q=(range-d)/range;ax+=ox/d*q*2.3;ay+=oy/d*q*2.3;}}
      const a=Math.atan2(dy+sepY*.75+ay,dx+sepX*.75+ax);enemy.rotation=this.rotateTowards(enemy.rotation,a,enemy.turnSpeed*dt);enemy.x+=Math.cos(enemy.rotation)*enemy.speed*dt;enemy.y+=Math.sin(enemy.rotation)*enemy.speed*dt;enemy.x=this.clamp(enemy.x,25,WORLD_WIDTH-25);enemy.y=this.clamp(enemy.y,25,WORLD_HEIGHT-25);this.resolveSnakeObstacleCollisions(enemy);
      const distSq=this.distanceSq(this.tank.x,this.tank.y,enemy.x,enemy.y),bombRange=TANK_RADIUS+enemy.headRadius+24,biteRange=TANK_RADIUS+enemy.headRadius+5;
      if(enemy.variant==="BOMBER"&&distSq<bombRange*bombRange){this.explodeSnake(enemy,true);continue;}if(distSq<biteRange*biteRange&&enemy.contactCooldownMs<=0){this.damageTank(Math.min(18,5+Math.floor(this.wave*.5)),"bite",enemy.x,enemy.y);enemy.contactCooldownMs=740;}
    }
    // Positions have changed, so refresh the grid for bullet collision later this tick.
    this.rebuildSnakeGrid(this.snakes.values());
  }

  private rebuildSnakeGrid(list:Iterable<SnakeEnemy>){this.snakeGrid.clear();for(const enemy of this.snakes.values()){const cx=Math.floor(enemy.x/this.snakeGridCell),cy=Math.floor(enemy.y/this.snakeGridCell),key=this.gridKey(cx,cy);let bucket=this.snakeGrid.get(key);if(!bucket){bucket=[];this.snakeGrid.set(key,bucket);}bucket.push(enemy);}}
  private nearbySnakes(x:number,y:number,radiusCells:number){const out:SnakeEnemy[]=[];const cx=Math.floor(x/this.snakeGridCell),cy=Math.floor(y/this.snakeGridCell);for(let oy=-radiusCells;oy<=radiusCells;oy++)for(let ox=-radiusCells;ox<=radiusCells;ox++){const bucket=this.snakeGrid.get(this.gridKey(cx+ox,cy+oy));if(bucket)out.push(...bucket);}return out;}
  private gridKey(cx:number,cy:number){return cx+cy*10000;}
  private fireVenom(s:SnakeEnemy){const a=Math.atan2(this.tank.y-s.y,this.tank.x-s.x),speed=390+Math.min(180,this.wave*6);this.enemyProjectiles.push({id:this.nextEnemyProjectileId++,x:s.x,y:s.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,radius:9,ageMs:0,kind:"VENOM",damage:Math.min(22,8+Math.floor(this.wave*.45))});this.broadcast("venom_shot",{x:s.x,y:s.y,angle:a});}
  private updateEnemyProjectiles(deltaMs:number,dt:number){const keep:EnemyProjectile[]=[];for(const p of this.enemyProjectiles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.ageMs+=deltaMs;if(p.ageMs>4000)continue;if(this.distanceSq(p.x,p.y,this.tank.x,this.tank.y)<(TANK_RADIUS+p.radius)**2){this.damageTank(p.damage,"venom",p.x,p.y);continue;}keep.push(p);}this.enemyProjectiles=keep;}
  private resolveSnakeObstacleCollisions(s:SnakeEnemy){for(const o of OBSTACLES){const dx=s.x-o.x,dy=s.y-o.y,d=Math.hypot(dx,dy)||.001,min=o.radius+s.bodyRadius+4;if(d<min){const p=min-d;s.x+=dx/d*p;s.y+=dy/d*p;s.rotation+=this.randomRange(-.25,.25);}}}
  private killSnake(s:SnakeEnemy,exploded:boolean){if(!this.snakes.has(s.id))return;this.snakes.delete(s.id);this.kills++;this.score+=70+this.wave*12;if(s.variant==="CASH")this.spawnCashAt(s.x,s.y,1.6);this.broadcast("snake_death",{snakeId:s.id,x:s.x,y:s.y,exploded,variant:s.variant});}
  private explodeSnake(s:SnakeEnemy,triggered:boolean){if(!this.snakes.has(s.id))return;const x=s.x,y=s.y;this.killSnake(s,true);const radius=115+Math.min(45,this.wave);let tankDamage=0;if(this.distanceSq(x,y,this.tank.x,this.tank.y)<radius*radius){tankDamage=Math.min(32,14+Math.floor(this.wave*.6));this.damageTank(tankDamage,"explosion",x,y);}for(const other of this.nearbySnakes(x,y,1))if(this.snakes.has(other.id)&&this.distanceSq(x,y,other.x,other.y)<radius*radius){other.hp-=Math.round(other.maxHp*.62);if(other.hp<=0)this.killSnake(other,true);}this.broadcast("explosion_fx",{x,y,radius,tankDamage,sourceSnakeId:s.id,triggered});}

  private spawnBoss(){const tier=Math.floor(this.wave/10),types:BossType[]=["COIL_STRIKER","LACE_MONITOR","COBRA_SENTINEL"],type=types[(tier-1+this.bossSequenceIndex)%types.length],radius=type==="LACE_MONITOR"?100:88,maxHp=Math.round(1350*Math.pow(1.42,tier-1));const p=this.spawnNearTankEdge(720);this.boss={id:tier,type,x:p.x,y:p.y,rotation:Math.atan2(this.tank.y-p.y,this.tank.x-p.x),hp:maxHp,maxHp,radius,phase:"STALK",phaseTimeLeftMs:3200,vulnerable:type==="LACE_MONITOR",telegraphAngle:0,tier,contactCooldownMs:0};this.broadcast("boss_phase",{type,phase:"STALK",tier});}
  private updateBoss(deltaMs:number,dt:number){const b=this.boss;if(!b)return;b.phaseTimeLeftMs-=deltaMs;b.contactCooldownMs=Math.max(0,b.contactCooldownMs-deltaMs);const angle=Math.atan2(this.tank.y-b.y,this.tank.x-b.x);b.rotation=this.rotateTowards(b.rotation,angle,1.65*dt);
    if(b.phase==="STALK"){const speed=90+b.tier*7;b.x+=Math.cos(b.rotation)*speed*dt;b.y+=Math.sin(b.rotation)*speed*dt;if(b.phaseTimeLeftMs<=0)this.setBossPhase(b,b.type==="COBRA_SENTINEL"?"VENOM":"TELEGRAPH");}
    else if(b.phase==="TELEGRAPH"){if(b.phaseTimeLeftMs<=0){b.telegraphAngle=angle;this.setBossPhase(b,b.type==="LACE_MONITOR"?"CHARGE":"STRIKE");}}
    else if(b.phase==="STRIKE"||b.phase==="CHARGE"){const speed=(b.phase==="STRIKE"?770:630)+b.tier*20;b.x+=Math.cos(b.telegraphAngle)*speed*dt;b.y+=Math.sin(b.telegraphAngle)*speed*dt;if(this.distanceSq(b.x,b.y,this.tank.x,this.tank.y)<(b.radius+TANK_RADIUS)**2&&b.contactCooldownMs<=0){this.damageTank(Math.min(65,34+b.tier*5),"boss",b.x,b.y);b.contactCooldownMs=1000;}if(b.phaseTimeLeftMs<=0)this.setBossPhase(b,"EXPOSED");}
    else if(b.phase==="VENOM"){if(Math.floor((b.phaseTimeLeftMs+deltaMs)/650)!==Math.floor(b.phaseTimeLeftMs/650))this.fireBossVenom(b);if(b.phaseTimeLeftMs<=0)this.setBossPhase(b,"EXPOSED");}
    else if(b.phase==="EXPOSED"&&b.phaseTimeLeftMs<=0)this.setBossPhase(b,"STALK");
    b.x=this.clamp(b.x,b.radius,WORLD_WIDTH-b.radius);b.y=this.clamp(b.y,b.radius,WORLD_HEIGHT-b.radius);
  }
  private setBossPhase(b:BossEnemy,phase:BossPhase){b.phase=phase;b.vulnerable=phase==="EXPOSED"||(b.type==="LACE_MONITOR"&&phase==="STALK");if(phase==="STALK")b.phaseTimeLeftMs=2800;else if(phase==="TELEGRAPH")b.phaseTimeLeftMs=1900;else if(phase==="STRIKE"||phase==="CHARGE")b.phaseTimeLeftMs=720;else if(phase==="EXPOSED")b.phaseTimeLeftMs=2600;else if(phase==="VENOM")b.phaseTimeLeftMs=3300;this.broadcast("boss_phase",{type:b.type,phase,tier:b.tier,telegraphAngle:b.telegraphAngle});}
  private fireBossVenom(b:BossEnemy){for(let i=-2;i<=2;i++){const a=Math.atan2(this.tank.y-b.y,this.tank.x-b.x)+i*.16,speed=430+b.tier*12;this.enemyProjectiles.push({id:this.nextEnemyProjectileId++,x:b.x,y:b.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,radius:11,ageMs:0,kind:"VENOM",damage:10+b.tier*3});}this.broadcast("venom_shot",{x:b.x,y:b.y,boss:true});}
  private defeatBoss(){if(!this.boss)return;const b=this.boss;this.score+=this.wave*1800;this.cash+=400*this.wave/10;this.lastClearMultiplier=Number(this.economyMultiplier().toFixed(2));this.broadcast("boss_defeated",{type:b.type,tier:b.tier,x:b.x,y:b.y,reinforcements:this.bossReinforcements,multiplier:this.lastClearMultiplier});this.boss=undefined;this.bullets=[];this.enemyProjectiles=[];this.snakes.clear();this.cashCrates.clear();
    if(this.bossReinforcements>0){this.bossReinforcements--;this.bossSequenceIndex++;this.spawnBoss();this.broadcast("boss_phase",{phase:"REINFORCEMENT",remaining:this.bossReinforcements+1});return;}
    this.swapRoles();this.resetInputs();this.phase="boss_reward";this.pendingBossReward=undefined;this.phaseTimeLeftMs=0;}

  private updateCash(deltaMs:number){const mult=this.economyMultiplier();const spawnEvery=this.waveType==="BONUS_MONEY"?4300:12800;this.cashSpawnAccumulatorMs+=deltaMs;if(mult>0&&this.cashSpawnAccumulatorMs>=spawnEvery){this.cashSpawnAccumulatorMs=0;this.spawnCashCrate(this.waveType==="BONUS_MONEY"?1.45:1);if(this.waveType==="BONUS_MONEY"&&Math.random()<.45)this.spawnCashCrate(1.15);}for(const c of this.cashCrates.values()){c.timeLeftMs-=deltaMs;if(c.timeLeftMs<=0){this.cashCrates.delete(c.id);continue;}const r=this.combatStats().pickupRadius;if(this.distanceSq(c.x,c.y,this.tank.x,this.tank.y)<=r*r){this.cashCrates.delete(c.id);const awarded=Math.max(0,Math.round(c.value*mult/5)*5);if(awarded>0){this.cash+=awarded;this.cashCollected+=awarded;this.score+=Math.round(awarded*.8);}this.broadcast("cash_pickup",{x:c.x,y:c.y,value:awarded,baseValue:c.value,multiplier:mult,cash:this.cash});}}}
  private economyMultiplier(){const s=this.waveElapsedMs/1000;if(s<=10)return this.lerp(10,5,s/10);if(s<=20)return this.lerp(5,3,(s-10)/10);if(s<=30)return this.lerp(3,1,(s-20)/10);if(s<=45)return 1;if(s<=60)return this.lerp(1,.75,(s-45)/15);if(s<=75)return this.lerp(.75,.5,(s-60)/15);if(s<=90)return this.lerp(.5,0,(s-75)/15);return 0;}
  private spawnCashCrate(mult=1){const p=this.randomSafePoint(170);this.spawnCashAt(p.x,p.y,mult);}
  private spawnCashAt(x:number,y:number,mult=1){const base=85+this.wave*15,econ=this.combatStats().cashValueMultiplier,value=Math.round(base*mult*econ/5)*5,id=this.nextCashId++;this.cashCrates.set(id,{id,x,y,value,timeLeftMs:this.waveType==="BONUS_MONEY"?11500:9200});}

  private checkWaveComplete(){if(this.phase!=="combat"||this.waveType==="BOSS"||this.spawnRemaining>0||this.snakes.size>0)return;this.lastClearMultiplier=Number(this.economyMultiplier().toFixed(2));this.score+=this.wave*500;this.openIntermission(true);}
  private openIntermission(fromWave=false){if(fromWave){const before=this.tank.health;this.tank.health=Math.min(this.tank.maxHealth,this.tank.health+5);this.swapRoles();this.broadcast("wave_complete",{wave:this.wave,score:this.score,cash:this.cash,repair:Math.round(this.tank.health-before),shopSeconds:SHOP_SECONDS,multiplier:this.lastClearMultiplier});}this.phase="intermission";this.phaseTimeLeftMs=SHOP_SECONDS*1000;this.bullets=[];this.enemyProjectiles=[];this.cashCrates.clear();this.readyPlayers.clear();this.pendingBossReward=undefined;this.resetInputs();}
  private startWave(wave:number){this.wave=wave;this.previousWaveType=this.waveType;this.waveType=this.pickWaveType(wave);this.phase="combat";this.phaseTimeLeftMs=0;this.waveElapsedMs=0;this.bullets=[];this.enemyProjectiles=[];this.snakes.clear();this.boss=undefined;this.cashCrates.clear();this.fireCooldownMs=0;this.spawnAccumulatorMs=0;this.cashSpawnAccumulatorMs=this.waveType==="BONUS_MONEY"?0:6000;this.readyPlayers.clear();this.resetInputs();if(this.waveType==="BOSS"){this.spawnRemaining=0;const tier=Math.floor(this.wave/10);this.bossReinforcements=tier>=7?2:tier>=5?1:0;this.bossSequenceIndex=0;this.spawnBoss();}else{const stats=this.waveStats();this.spawnRemaining=stats.count;this.spawnIntervalMs=Math.max(230,470-this.wave*11);if(this.waveType==="BONUS_MONEY"){this.spawnCashCrate(1.5);this.spawnCashCrate(1.25);this.spawnCashCrate(1.25);}}this.broadcast("wave_start",{wave:this.wave,waveType:this.waveType,count:this.waveType==="BOSS"?1:this.waveStats().count,economyMultiplier:10});}
  private pickWaveType(wave:number):WaveType{if(wave%10===0)return"BOSS";if(wave<3)return"NORMAL";const chance=wave>=8?.36:.3;if(Math.random()>chance)return"NORMAL";const all:WaveType[]=["BONUS_MONEY","VOLATILE_SNAKES","BLACKOUT","FRENZY","TITAN_NEST"];const f=all.filter(x=>x!==this.previousWaveType);return f[Math.floor(Math.random()*f.length)];}

  private damageTank(amount:number,source:string,x:number,y:number){if(this.phase!=="combat"||this.tank.health<=0)return;this.tank.health=Math.max(0,this.tank.health-amount);this.broadcast("tank_hit",{amount,source,x,y,health:this.tank.health});if(this.tank.health<=0){if(this.reviveCharges>0){this.reviveCharges--;this.tank.health=Math.round(this.tank.maxHealth*.45);this.broadcast("boost_used",{type:"REVIVE",name:BOOST_NAMES.REVIVE.name,automatic:true});}else this.endGame();}}
  private endGame(){
    this.phase="gameover";this.bullets=[];this.enemyProjectiles=[];this.resetInputs();
    const names=[...this.players.values()].map(player=>player.name);
    const result=leaderboardStore.submit({
      players:[names[0]??"Player 1",names[1]??"Player 2"],
      wave:this.wave,score:this.score,kills:this.kills,headshots:this.headshots,mode:this.mode,
    });
    this.broadcast("game_over",{
      wave:this.wave,score:this.score,cash:this.cash,cashCollected:this.cashCollected,kills:this.kills,headshots:this.headshots,
      upgrades:{...this.upgradeLevels},leaderboardRank:result.rank,leaderboard:result.entries,
    });
  }

  private purchaseUpgrade(client:Client,id:UpgradeId){const d=UPGRADE_DEFINITIONS.find(x=>x.id===id);if(!d){client.send("purchase_denied",{reason:"Unknown upgrade."});return;}const level=this.upgradeLevels[id];if(level>=d.maxLevel){client.send("purchase_denied",{reason:`${d.name} is maxed.`});return;}const cost=this.upgradeCost(d,level);if(this.cash<cost){client.send("purchase_denied",{reason:`Need $${cost.toLocaleString()} — team cash is $${this.cash.toLocaleString()}.`});return;}const oldMax=this.tank.maxHealth;this.cash-=cost;this.upgradeLevels[id]++;this.readyPlayers.clear();if(id==="ARMOR"){const newMax=this.combatStats().maxHealth;this.tank.maxHealth=newMax;this.tank.health=Math.min(newMax,this.tank.health+(newMax-oldMax));}this.broadcast("upgrade_purchased",{id,name:d.name,level:this.upgradeLevels[id],cost,cash:this.cash,purchaser:this.displayPurchaser(client),effect:this.describeUpgrade(id,this.upgradeLevels[id])});}
  private purchaseRepair(client:Client){const r=this.repairSnapshot();if(this.tank.health>=this.tank.maxHealth-.5){client.send("purchase_denied",{reason:"Tank integrity is already full."});return;}if(this.cash<r.cost){client.send("purchase_denied",{reason:`Need $${r.cost.toLocaleString()} for field repair.`});return;}const before=this.tank.health;this.cash-=r.cost;this.tank.health=Math.min(this.tank.maxHealth,this.tank.health+r.restore);this.readyPlayers.clear();this.broadcast("repair_purchased",{restored:Math.round(this.tank.health-before),cost:r.cost,cash:this.cash,purchaser:this.displayPurchaser(client),health:this.tank.health,maxHealth:this.tank.maxHealth});}
  private useSelectedBoost(client:Client){if(this.phase!=="combat"){client.send("boost_denied",{reason:"Boosts can only be used during combat."});return;}const inv=this.inventoryArray().filter(i=>i.count>0);if(!inv.length){client.send("boost_denied",{reason:"No boosts stored."});return;}const item=inv[this.selectedBoostIndex%inv.length];const t=item.type;if(this.boostInventory[t]<=0)return;this.boostInventory[t]--;if(t==="SPEED")this.speedBoostMs=8000;else if(t==="MEDKIT")this.tank.health=Math.min(this.tank.maxHealth,this.tank.health+45);else if(t==="REVIVE")this.reviveCharges++;else if(t==="BOMB"){const r=500;for(const s of this.nearbySnakes(this.tank.x,this.tank.y,Math.ceil(r/this.snakeGridCell)))if(this.snakes.has(s.id)&&this.distanceSq(s.x,s.y,this.tank.x,this.tank.y)<r*r){s.hp-=Math.round(s.maxHp*.85);if(s.hp<=0)this.killSnake(s,false);}if(this.boss&&this.distanceSq(this.boss.x,this.boss.y,this.tank.x,this.tank.y)<r*r)this.boss.hp-=Math.round(this.boss.maxHp*.08);this.broadcast("explosion_fx",{x:this.tank.x,y:this.tank.y,radius:r,boost:true});}else if(t==="NUKE"){for(const s of [...this.snakes.values()])this.killSnake(s,true);this.spawnRemaining=0;this.broadcast("explosion_fx",{x:this.tank.x,y:this.tank.y,radius:1200,nuke:true});}else if(t==="CASH_BONUS"){const reward=500+this.wave*55;this.cash+=reward;this.cashCollected+=reward;}this.broadcast("boost_used",{type:t,name:BOOST_NAMES[t].name});this.selectedBoostIndex=0;}
  private rollBossReward():BoostType{const r=Math.random();if(r<.02)return"NUKE";if(r<.13)return"REVIVE";if(r<.31)return"BOMB";if(r<.50)return"SPEED";if(r<.70)return"MEDKIT";return"CASH_BONUS";}

  private combatStats(){const a=this.upgradeLevels.AP_AMMO,l=this.upgradeLevels.AUTOLOADER,e=this.upgradeLevels.ENGINE,ar=this.upgradeLevels.ARMOR,h=this.upgradeLevels.HV_SHELLS,s=this.upgradeLevels.SCAVENGER,o=this.upgradeLevels.ORDNANCE;const body=Math.round(BASE_BODY_DAMAGE*(1+a*.18));const weaponTier=o>=5?"ROCKET":o>=3?"HEAVY_SHELL":"SHELL";return{bodyDamage:body,headDamage:body*HEADSHOT_MULTIPLIER,headshotMultiplier:HEADSHOT_MULTIPLIER,fireIntervalMs:Math.round(Math.max(82,BASE_FIRE_INTERVAL_MS*Math.pow(.9,l))),forwardSpeed:Math.round(BASE_TANK_SPEED*(1+e*.075)),reverseSpeed:Math.round(BASE_TANK_REVERSE_SPEED*(1+e*.075)),turnSpeed:Number((BASE_TANK_TURN_SPEED*(1+e*.045)).toFixed(3)),maxHealth:BASE_TANK_MAX_HEALTH+ar*25,bulletSpeed:Math.round(BASE_BULLET_SPEED*(1+h*.11)),bulletRadius:5+o*2.2,splashRadius:o===0?0:30+o*22,weaponTier,pickupRadius:Math.round(58*(1+s*.14)),cashValueMultiplier:Number((1+s*.1).toFixed(2))};}
  private upgradeSnapshot(){return UPGRADE_DEFINITIONS.map(d=>{const level=this.upgradeLevels[d.id],maxed=level>=d.maxLevel;return{id:d.id,name:d.name,shortName:d.shortName,description:d.description,level,maxLevel:d.maxLevel,maxed,cost:maxed?null:this.upgradeCost(d,level),currentEffect:this.describeUpgrade(d.id,level),nextEffect:maxed?"MAXIMUM":this.describeUpgrade(d.id,level+1)};});}
  private describeUpgrade(id:UpgradeId,l:number){if(id==="AP_AMMO"){const b=Math.round(BASE_BODY_DAMAGE*(1+l*.18));return`${b} body / ${b*4} head damage`;}if(id==="AUTOLOADER"){const i=Math.round(Math.max(82,BASE_FIRE_INTERVAL_MS*Math.pow(.9,l)));return`${(1000/i).toFixed(1)} rounds/sec`;}if(id==="ENGINE")return`${Math.round(BASE_TANK_SPEED*(1+l*.075))} speed / ${(BASE_TANK_TURN_SPEED*(1+l*.045)).toFixed(2)} steering`;if(id==="ARMOR")return`${BASE_TANK_MAX_HEALTH+l*25} max integrity`;if(id==="HV_SHELLS")return`${Math.round(BASE_BULLET_SPEED*(1+l*.11))} projectile velocity`;if(id==="ORDNANCE"){const tier=l>=5?"ROCKET":l>=3?"HEAVY SHELL":"SHELL";return`${tier} • ${Math.round(5+l*2.2)}px • ${l===0?0:30+l*22} splash`;}return`+${l*10}% crate value / ${Math.round(58*(1+l*.14))} pickup radius`;}
  private upgradeCost(d:UpgradeDefinition,l:number){return Math.round(d.baseCost*Math.pow(d.costGrowth,l)/5)*5;}
  private repairSnapshot(){const cost=Math.round((165+this.wave*22)/5)*5;return{cost,restore:35,canBuy:this.phase==="intermission"&&this.cash>=cost&&this.tank.health<this.tank.maxHealth-.5};}

  private assignRandomStartingRoles(){const p=[...this.players.values()],i=Math.random()<.5?0:1;p[i].role="driver";p[1-i].role="gunner";this.resetInputs();this.broadcast("roles_assigned",this.rolePayload());}
  private swapRoles(){for(const p of this.players.values())p.role=p.role==="driver"?"gunner":"driver";this.broadcast("roles_swapped",this.rolePayload());}
  private resetInputs(){if(this.mode==="local"){this.driveInputs.set("local-driver",{throttle:0,turn:0});this.gunInputs.set("local-gunner",{angle:this.tank.turretRotation,firing:false});}else for(const id of this.players.keys()){this.driveInputs.set(id,{throttle:0,turn:0});this.gunInputs.set(id,{angle:this.tank.turretRotation,firing:false});}}
  private canControl(c:Client,r:Role){return this.mode==="local"?c.sessionId===this.localOwnerSessionId:this.players.get(c.sessionId)?.role===r;}
  private controllerKey(c:Client,r:Role){return this.mode==="local"?`local-${r}`:c.sessionId;}
  private rolePayload(){return[...this.players.values()].map(p=>({sessionId:p.sessionId,name:p.name,role:p.role}));}
  private displayPurchaser(c:Client){if(this.mode==="local")return"Local team";return this.players.get(c.sessionId)?.name??"Player";}
  private inventoryArray(){return(Object.keys(this.boostInventory) as BoostType[]).map(type=>({type,name:BOOST_NAMES[type].name,count:this.boostInventory[type],description:BOOST_NAMES[type].description}));}

  private broadcastSnapshot(){this.broadcast("snapshot",{roomId:this.roomId,mode:this.mode,world:{width:WORLD_WIDTH,height:WORLD_HEIGHT},players:this.rolePayload(),tank:{...this.tank},bullets:this.bullets.map(b=>({id:b.id,x:b.x,y:b.y,angle:Math.atan2(b.vy,b.vx),radius:b.radius,weaponTier:b.weaponTier})),enemyProjectiles:this.enemyProjectiles.map(p=>({id:p.id,x:p.x,y:p.y,vx:p.vx,vy:p.vy,kind:p.kind})),snakes:[...this.snakes.values()].map(s=>({id:s.id,x:s.x,y:s.y,rotation:s.rotation,hp:Math.max(0,s.hp),maxHp:s.maxHp,headRadius:s.headRadius,bodyRadius:s.bodyRadius,length:s.length,volatile:s.volatile,seed:s.seed,variant:s.variant,attackCooldownMs:s.attackCooldownMs})),boss:this.boss?{...this.boss}:undefined,cashCrates:[...this.cashCrates.values()].map(c=>({...c})),obstacles:OBSTACLES,phase:this.phase,wave:this.wave,waveType:this.waveType,timeLeftMs:Math.max(0,this.phaseTimeLeftMs),waveElapsedMs:this.waveElapsedMs,economyMultiplier:Number(this.economyMultiplier().toFixed(2)),lastClearMultiplier:this.lastClearMultiplier,snakesRemaining:this.snakes.size+this.spawnRemaining+(this.boss?1:0),snakesAlive:this.snakes.size,score:this.score,cash:Math.round(this.cash),cashCollected:Math.round(this.cashCollected),kills:this.kills,headshots:this.headshots,readySessionIds:[...this.readyPlayers],upgrades:this.upgradeSnapshot(),combatStats:this.combatStats(),repair:this.repairSnapshot(),boosts:this.inventoryArray(),selectedBoostIndex:this.selectedBoostIndex,pendingBossReward:this.pendingBossReward});}

  private spawnNearTankEdge(extra=520){const a=Math.random()*Math.PI*2,d=Math.max(extra,Math.min(920,560+Math.random()*340));return{x:this.clamp(this.tank.x+Math.cos(a)*d,35,WORLD_WIDTH-35),y:this.clamp(this.tank.y+Math.sin(a)*d,35,WORLD_HEIGHT-35)};}
  private randomSafePoint(min:number){for(let i=0;i<40;i++){const a=Math.random()*Math.PI*2,d=this.randomRange(min,700),x=this.clamp(this.tank.x+Math.cos(a)*d,100,WORLD_WIDTH-100),y=this.clamp(this.tank.y+Math.sin(a)*d,100,WORLD_HEIGHT-100);if(OBSTACLES.some(o=>Math.hypot(x-o.x,y-o.y)<o.radius+75))continue;return{x,y};}return{x:this.clamp(this.tank.x+300,100,WORLD_WIDTH-100),y:this.tank.y};}
  private distanceSq(ax:number,ay:number,bx:number,by:number){const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;}
  private clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
  private lerp(a:number,b:number,t:number){return a+(b-a)*this.clamp(t,0,1);}
  private randomRange(min:number,max:number){return min+Math.random()*(max-min);}
  private rotateTowards(cur:number,target:number,max:number){const d=this.normalizeAngle(target-cur);return cur+this.clamp(d,-max,max);}
  private normalizeAngle(a:number){while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a;}
  private cleanName(v:any){const s=String(v??"Player").replace(/[<>]/g,"").trim().slice(0,18);return s||"Player";}
  private async generateRoomId(){
    // Follow Colyseus' documented custom-room-ID recipe: inspect the current
    // set, choose an unused code, then register it. Presence.sadd() is not a
    // numeric allocation test and must not be treated as one.
    const currentIds=await this.presence.smembers(this.lobbyChannel);
    let id="";
    do{
      id="";
      for(let i=0;i<4;i++)id+=LETTERS[Math.floor(Math.random()*LETTERS.length)];
    }while(currentIds.includes(id));
    await this.presence.sadd(this.lobbyChannel,id);
    return id;
  }
}
