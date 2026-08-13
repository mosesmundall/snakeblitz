import Phaser from "phaser";
import { network } from "../network";
import type { BossSnapshot, CashCrateSnapshot, GameSnapshot, ObstacleSnapshot, Role, SnakeSnapshot } from "../types";
import { audio } from "./AudioManager";

interface SnakeVisual {
  sprite: Phaser.GameObjects.Image;
  target: SnakeSnapshot;
}

interface CashVisual {
  sprite: Phaser.GameObjects.Image;
  timer: Phaser.GameObjects.Text;
  target: CashCrateSnapshot;
}

interface ProjectileVisual {
  sprite: Phaser.GameObjects.Image;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
}

interface FxParticle {
  sprite: Phaser.GameObjects.Image;
  active: boolean;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  maxLife: number;
  startAlpha: number;
  startScale: number;
  endScale: number;
  spin: number;
}

interface FloatingText {
  text: Phaser.GameObjects.Text;
  active: boolean;
  life: number;
  maxLife: number;
  vy: number;
}

export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Container;
  private turret!: Phaser.GameObjects.Container;
  private hullShadow!: Phaser.GameObjects.Ellipse;
  private targetTank = { x: 800, y: 450, rotation: -Math.PI / 2, turretRotation: -Math.PI / 2, health: 100, maxHealth: 100 };

  // Performance-critical actors are one textured Image each, not multi-object Containers.
  private bulletSprites = new Map<number, ProjectileVisual>();
  private snakeVisuals = new Map<number, SnakeVisual>();
  private cashVisuals = new Map<number, CashVisual>();
  private obstacleIds = new Set<number>();
  private enemyProjectileSprites = new Map<number, ProjectileVisual>();
  private snakeHealthBars!: Phaser.GameObjects.Graphics;
  private bossVisual?: Phaser.GameObjects.Container;
  private bossTarget?: BossSnapshot;
  private bossHpBg?: Phaser.GameObjects.Rectangle;
  private bossHpFill?: Phaser.GameObjects.Rectangle;
  private bossTelegraph?: Phaser.GameObjects.Graphics;
  private cameraConfigured = false;
  private tankEvolution = new Map<string, Phaser.GameObjects.GameObject>();
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<"W" | "A" | "S" | "D" | "SPACE", Phaser.Input.Keyboard.Key>;
  private localRole?: Role;
  private currentSnapshot?: GameSnapshot;
  private lastInputSentAt = 0;
  private lastFiring = false;
  private dustTimer = 0;
  private reticle!: Phaser.GameObjects.Container;
  private blackoutOverlay!: Phaser.GameObjects.Rectangle;
  private blackoutDim!: Phaser.GameObjects.Rectangle;
  private blackoutEdge!: Phaser.GameObjects.Graphics;
  private blackoutMaskShape!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private minimapFrame!: Phaser.GameObjects.Graphics;
  private minimapMaskShape!: Phaser.GameObjects.Graphics;
  private minimapTitle!: Phaser.GameObjects.Text;
  private lastMinimapUpdateAt = 0;
  private lastHealthBarUpdateAt = 0;
  private lastCashVisualUpdateAt = 0;
  private lastBossTelegraphAt = 0;
  private lastAudioTank?: { x: number; y: number; at: number };
  private engineMotion = 0;
  private latestUpgradeLevels = new Map<string, number>();

  // Fixed object pools eliminate the create/destroy/tween garbage-collection spikes
  // that previously happened during rapid fire, explosions and crowded waves.
  private fxPool: FxParticle[] = [];
  private fxCursor = 0;
  private textPool: FloatingText[] = [];
  private textCursor = 0;
  private actorImagePool: Phaser.GameObjects.Image[] = [];

  // Adaptive presentation only affects disposable FX. Gameplay and enemy counts never change.
  private perfFps = 60;
  private perfQuality = 1;
  private perfSampleMs = 0;
  private perfFrames = 0;
  private lowFpsMs = 0;
  private goodFpsMs = 0;
  private perfPanel?: Phaser.GameObjects.Text;
  private perfPanelVisible = false;

  constructor() {
    super("GameScene");
  }

  create() {
    this.createPerformanceTextures();
    this.drawArena();
    this.createTank();
    this.createReticle();
    this.createBlackoutLayer();
    this.createMinimap();
    this.snakeHealthBars = this.add.graphics().setDepth(31);
    this.createFxPools();
    this.createPerfPanel();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE") as typeof this.keys;

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      audio.unlock();
      if (pointer.rightButtonDown()) network.cycleBoost(1);
      if (pointer.middleButtonDown()) network.useBoost();
    });
    this.input.mouse?.disableContextMenu();
    this.game.canvas.addEventListener("mousedown", (event) => { if (event.button === 1) event.preventDefault(); }, { passive: false });
    this.game.canvas.addEventListener("auxclick", (event) => event.preventDefault(), { passive: false });
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      audio.unlock();
      if (event.code === "F3") {
        event.preventDefault();
        this.perfPanelVisible = !this.perfPanelVisible;
        this.perfPanel?.setVisible(this.perfPanelVisible);
      }
    });

    network.addEventListener("snapshot", (event) => {
      const snapshot = (event as CustomEvent<GameSnapshot>).detail;
      this.applySnapshot(snapshot);
    });

    network.addEventListener("shot_fx", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number; angle: number }>).detail;
      this.playMuzzleFlash(data.x, data.y, data.angle);
      audio.shot(this.currentSnapshot?.combatStats.weaponTier ?? "SHELL");
    });

    network.addEventListener("impact_fx", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number }>).detail;
      this.playImpact(data.x, data.y);
    });

    network.addEventListener("hit_fx", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number; damage: number; headshot: boolean }>).detail;
      this.playHit(data.x, data.y, data.damage, data.headshot);
    });

    network.addEventListener("snake_death", (event) => {
      const data = (event as CustomEvent<{ snakeId: number; x: number; y: number; exploded: boolean }>).detail;
      this.playSnakeDeath(data.snakeId, data.x, data.y, data.exploded);
    });

    network.addEventListener("explosion_fx", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number; radius: number }>).detail;
      this.playExplosion(data.x, data.y, data.radius);
      audio.explosion();
    });

    network.addEventListener("tank_hit", (event) => {
      const data = (event as CustomEvent<{ amount: number; source: string }>).detail;
      this.playTankHit(data.amount, data.source);
      audio.tankHit();
    });

    network.addEventListener("cash_pickup", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number; value: number }>).detail;
      this.playCashPickup(data.x, data.y, data.value);
      audio.pickup();
    });

    network.addEventListener("wave_start", () => audio.waveStart());
  }

  update(time: number, delta: number) {
    this.measurePerformance(delta);
    const tankBlend = 1 - Math.pow(0.70, delta / 16.667);
    this.tank.x = Phaser.Math.Linear(this.tank.x, this.targetTank.x, tankBlend);
    this.tank.y = Phaser.Math.Linear(this.tank.y, this.targetTank.y, tankBlend);
    this.hullShadow.x = this.tank.x + 8;
    this.hullShadow.y = this.tank.y + 11;

    this.tank.rotation = Phaser.Math.Angle.RotateTo(this.tank.rotation, this.targetTank.rotation, 0.12 * Math.max(0.5, delta / 16.667));
    this.turret.rotation = Phaser.Math.Angle.RotateTo(this.turret.rotation, this.targetTank.turretRotation - this.tank.rotation, 0.2 * Math.max(0.5, delta / 16.667));

    this.updateProjectiles(delta);
    this.updateBossVisual(delta);
    this.updateSnakeVisuals(time, delta);
    this.updateCashVisuals(time);
    this.updateFx(delta);
    this.updateFloatingTexts(delta);
    this.updateReticle();
    this.updateBlackout();
    this.updateBossTelegraph(time);
    this.updateMinimap(time);

    if (time - this.lastInputSentAt > 34) {
      this.lastInputSentAt = time;
      this.sendControls();
    }

    this.updateDust(delta);
  }

  private drawArena() {
    // Bake the large static battlefield into a single texture once. The previous
    // Graphics command buffers were being traversed every rendered frame.
    const W = 3600, H = 2100;
    const texture = this.textures.createCanvas("sb-arena-baked", W, H);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.fillStyle = "#3f5540";
    ctx.fillRect(0, 0, W, H);

    const road = (x1:number,y1:number,x2:number,y2:number,width:number,color:string) => {
      ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap="round";
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    };
    road(180,1050,3420,1050,135,"rgba(140,121,88,.10)");
    road(1800,140,1800,1960,95,"rgba(120,105,79,.08)");
    road(500,350,3100,1700,70,"rgba(140,121,88,.06)");

    const palette=["rgba(98,112,82,.12)","rgba(48,74,52,.14)","rgba(109,104,77,.10)","rgba(41,61,45,.14)","rgba(81,96,68,.12)"];
    let seed=0x51a7b11;
    const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<430;i++){
      const x=35+rand()*(W-70),y=35+rand()*(H-70),r=8+rand()*32;
      ctx.fillStyle=palette[i%palette.length]; ctx.beginPath(); ctx.ellipse(x,y,r*1.7,r,0,0,Math.PI*2); ctx.fill();
    }
    ctx.strokeStyle="rgba(154,170,125,.10)";ctx.lineWidth=2;
    for(let i=0;i<620;i++){
      const x=30+rand()*(W-60),y=30+rand()*(H-60),h=4+rand()*8;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+(rand()-.5)*6,y-h);ctx.stroke();
    }
    ctx.fillStyle="#111b17";ctx.fillRect(0,0,W,28);ctx.fillRect(0,H-28,W,28);ctx.fillRect(0,0,28,H);ctx.fillRect(W-28,0,28,H);
    ctx.strokeStyle="rgba(214,189,120,.18)";ctx.lineWidth=3;ctx.strokeRect(30,30,W-60,H-60);

    const base=(x:number,y:number,color:string)=>{ctx.fillStyle="rgba(16,24,19,.34)";this.canvasRoundRect(ctx,x-120,y-85,240,170,18,true,false);ctx.strokeStyle=color;ctx.lineWidth=4;this.canvasRoundRect(ctx,x-112,y-77,224,154,16,false,true);};
    base(3050,410,"rgba(107,112,77,.48)"); base(3230,1550,"rgba(94,105,81,.48)"); base(1180,1660,"rgba(101,94,72,.48)");
    ctx.strokeStyle="rgba(154,138,102,.18)";ctx.lineWidth=3;
    for(const [x,y] of [[740,620],[2600,650],[820,1380],[2440,1500],[1880,480]] as Array<[number,number]>){ctx.strokeRect(x-120,y-70,240,140);for(let dx=-100;dx<=100;dx+=40){ctx.beginPath();ctx.moveTo(x+dx,y-70);ctx.lineTo(x+dx+15,y-55);ctx.stroke();}}
    texture.refresh();
    this.add.image(0,0,"sb-arena-baked").setOrigin(0).setDepth(0);

    // Only three labels remain as Text objects; all other decoration is baked.
    this.add.text(3050,522,"NORTH OUTPOST",{fontFamily:"Arial Black, Arial",fontSize:"15px",color:"#cfc69d",stroke:"#101510",strokeThickness:5}).setOrigin(.5).setDepth(6).setAlpha(.7);
    this.add.text(3230,1662,"EASTERN DEPOT",{fontFamily:"Arial Black, Arial",fontSize:"15px",color:"#cfc69d",stroke:"#101510",strokeThickness:5}).setOrigin(.5).setDepth(6).setAlpha(.7);
    this.add.text(1180,1772,"OLD FIELD BASE",{fontFamily:"Arial Black, Arial",fontSize:"15px",color:"#cfc69d",stroke:"#101510",strokeThickness:5}).setOrigin(.5).setDepth(6).setAlpha(.7);
  }

  private canvasRoundRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,fill:boolean,stroke:boolean){
    const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();if(fill)ctx.fill();if(stroke)ctx.stroke();
  }

  private drawBaseDecoration(x:number,y:number,label:string,color:number){
    const g=this.add.graphics().setDepth(4);
    g.fillStyle(0x101813,.34);g.fillRoundedRect(x-120,y-85,240,170,18);
    g.lineStyle(4,color,.48);g.strokeRoundedRect(x-112,y-77,224,154,16);
    g.fillStyle(color,.18);g.fillRoundedRect(x-80,y-40,160,80,12);
    const t=this.add.text(x,y+112,label,{fontFamily:"Arial Black, Arial",fontSize:"15px",color:"#cfc69d",stroke:"#101510",strokeThickness:5}).setOrigin(.5).setDepth(6).setAlpha(.7);
    t.setRotation(-.02);
  }

  private createMinimap() {
    const cx = 1460, cy = 205, radius = 108;
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(118);
    this.minimapMaskShape = this.make.graphics({ x: 0, y: 0, add: false }).setScrollFactor(0);
    this.minimapMaskShape.fillStyle(0xffffff, 1);
    this.minimapMaskShape.fillCircle(cx, cy, radius);
    this.minimap.setMask(this.minimapMaskShape.createGeometryMask());

    this.minimapFrame = this.add.graphics().setScrollFactor(0).setDepth(119);
    this.minimapFrame.lineStyle(12, 0x07100d, 0.96); this.minimapFrame.strokeCircle(cx, cy, radius + 5);
    this.minimapFrame.lineStyle(3, 0xd6bd78, 0.48); this.minimapFrame.strokeCircle(cx, cy, radius + 2);
    this.minimapFrame.lineStyle(1, 0xffffff, 0.10); this.minimapFrame.strokeCircle(cx, cy, radius - 7);
    this.minimapFrame.fillStyle(0xd8d6bd, 0.7); this.minimapFrame.fillTriangle(cx, cy-radius+7, cx-4, cy-radius+16, cx+4, cy-radius+16);

    this.minimapTitle = this.add.text(cx, 78, "TACTICAL MAP", {
      fontFamily: "Arial Black, Arial", fontSize: "11px", color: "#d9d7b9",
      stroke: "#07100d", strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(120).setAlpha(0.9);
  }

  private updateMinimap(time: number) {
    const snapshot = this.currentSnapshot;
    const minimapInterval=this.perfQuality<.6?180:this.perfQuality<.8?135:100;
    if (!snapshot || !this.minimap || time-this.lastMinimapUpdateAt<minimapInterval) return;
    this.lastMinimapUpdateAt=time;
    const g=this.minimap,cx=1460,cy=205,radius=108;
    // Zoomed tactical view: ~1.8 km diameter rather than squeezing the full
    // rectangular battlefield into a circle. This fills the HUD naturally.
    const worldRadius=900,scale=(radius-8)/worldRadius;
    const px=(x:number)=>cx+(x-snapshot.tank.x)*scale;
    const py=(y:number)=>cy+(y-snapshot.tank.y)*scale;

    g.clear();
    g.fillStyle(0x304633,0.98);g.fillCircle(cx,cy,radius);
    g.lineStyle(10,0xa48b62,0.15);g.lineBetween(px(180),py(1050),px(3420),py(1050));
    g.lineStyle(7,0xa48b62,0.12);g.lineBetween(px(1800),py(140),px(1800),py(1960));
    g.lineStyle(5,0xa48b62,0.09);g.lineBetween(px(500),py(350),px(3100),py(1700));

    // World edge appears only when the player is actually close to it.
    g.lineStyle(2,0xd9c88f,0.34);
    g.strokeRect(px(0),py(0),snapshot.world.width*scale,snapshot.world.height*scale);

    for(const obstacle of snapshot.obstacles){
      const dx=obstacle.x-snapshot.tank.x,dy=obstacle.y-snapshot.tank.y;if(dx*dx+dy*dy>(worldRadius+180)**2)continue;
      const x=px(obstacle.x),y=py(obstacle.y);
      if(obstacle.type==="base"){g.fillStyle(0xe1bd68,.9);g.fillRect(x-5,y-5,10,10);g.lineStyle(1,0x3e3218,.9);g.strokeRect(x-5,y-5,10,10);}
      else if(obstacle.type==="tower"){g.lineStyle(2,0xd9d6b8,.82);g.strokeCircle(x,y,4.2);}
      else if(obstacle.type==="wreck"){g.fillStyle(0xa97b55,.72);g.fillRect(x-4,y-2.5,8,5);}
      else {g.fillStyle(0x18251d,.7);g.fillCircle(x,y,Math.max(2,Math.min(7,obstacle.radius*scale*.55)));}
    }

    const view=this.cameras.main.worldView;
    g.lineStyle(1.5,0xd7e5d1,.22);g.strokeRect(px(view.x),py(view.y),view.width*scale,view.height*scale);

    if(snapshot.boss){
      const dx=snapshot.boss.x-snapshot.tank.x,dy=snapshot.boss.y-snapshot.tank.y,d=Math.hypot(dx,dy)||1;
      const clamped=Math.min(d,worldRadius*.9),bx=cx+dx/d*clamped*scale,by=cy+dy/d*clamped*scale;
      const pulse=5+Math.sin(time*.01)*1.2;g.fillStyle(0xff5e4b,.22);g.fillCircle(bx,by,pulse+4);g.fillStyle(0xff6a54,1);g.fillCircle(bx,by,pulse);g.lineStyle(1.5,0xffd0a0,.85);g.strokeCircle(bx,by,pulse+2);
    }

    const a=snapshot.tank.rotation,tipX=cx+Math.cos(a)*10,tipY=cy+Math.sin(a)*10,lX=cx+Math.cos(a+2.45)*6,lY=cy+Math.sin(a+2.45)*6,rX=cx+Math.cos(a-2.45)*6,rY=cy+Math.sin(a-2.45)*6;
    g.fillStyle(0xf3d36d,1);g.fillTriangle(tipX,tipY,lX,lY,rX,rY);g.lineStyle(1.5,0x17150d,.85);g.strokeTriangle(tipX,tipY,lX,lY,rX,rY);
  }

  private createTank() {
    this.hullShadow = this.add.ellipse(808, 461, 112, 62, 0x09100d, 0.42).setDepth(20);

    const hull = this.add.container(0, 0);

    const tracks = this.add.graphics();
    tracks.fillStyle(0x111713, 1);
    tracks.fillRoundedRect(-52, -36, 104, 19, 7);
    tracks.fillRoundedRect(-52, 17, 104, 19, 7);
    tracks.lineStyle(2, 0x697362, 0.66);
    for (let x = -43; x <= 42; x += 13) {
      tracks.lineBetween(x, -33, x, -20);
      tracks.lineBetween(x, 20, x, 33);
    }

    const body = this.add.graphics();
    body.fillStyle(0x293b2e, 1);
    body.fillRoundedRect(-46, -29, 92, 58, 12);
    body.lineStyle(3, 0x8a967c, 0.48);
    body.strokeRoundedRect(-42, -25, 84, 50, 9);
    body.fillStyle(0x52664c, 1);
    body.fillRoundedRect(-32, -20, 64, 40, 9);
    body.fillStyle(0x1c261f, 1);
    body.fillCircle(-18, 0, 9);
    body.lineStyle(2, 0x9da691, 0.45);
    body.strokeCircle(-18, 0, 9);

    const nosePlate = this.add.graphics();
    nosePlate.fillStyle(0x6d7a61, 0.56);
    nosePlate.fillTriangle(31, -18, 46, 0, 31, 18);

    this.turret = this.add.container(0, 0);
    const turretShape = this.add.graphics();
    turretShape.fillStyle(0x1f3026, 1);
    turretShape.fillRoundedRect(-18, -19, 43, 38, 11);
    turretShape.fillStyle(0x78846e, 1);
    turretShape.fillCircle(0, 0, 11);
    turretShape.lineStyle(2, 0xc2c8b6, 0.36);
    turretShape.strokeCircle(0, 0, 12);

    const barrel = this.add.graphics();
    barrel.fillStyle(0x18231c, 1);
    barrel.fillRoundedRect(10, -5, 66, 10, 4);
    barrel.fillStyle(0x0b110e, 1);
    barrel.fillRect(66, -7, 13, 14);
    barrel.lineStyle(2, 0x84907c, 0.24);
    barrel.lineBetween(16, -3, 61, -3);

    this.turret.add([barrel, turretShape]);
    hull.add([tracks, body, nosePlate, this.turret]);
    this.tank = hull;
    this.tank.setPosition(800, 450).setDepth(24);
  }

  private createReticle() {
    const g = this.add.graphics();
    g.lineStyle(2, 0xf3d47d, 0.78);
    g.strokeCircle(0, 0, 15);
    g.lineBetween(-24, 0, -10, 0);
    g.lineBetween(24, 0, 10, 0);
    g.lineBetween(0, -24, 0, -10);
    g.lineBetween(0, 24, 0, 10);
    g.fillStyle(0xffffff, 0.72);
    g.fillCircle(0, 0, 2.5);
    this.reticle = this.add.container(0, 0, [g]).setDepth(80).setVisible(false);
  }

  private createBlackoutLayer() {
    this.blackoutDim=this.add.rectangle(800,450,1600,900,0x000000,.18).setScrollFactor(0).setDepth(88).setVisible(false);
    this.blackoutOverlay=this.add.rectangle(1800,1050,3600,2100,0x010303,.94).setDepth(89).setVisible(false);
    this.blackoutMaskShape=this.make.graphics({x:0,y:0,add:false});this.blackoutMaskShape.fillStyle(0xffffff,1);this.blackoutMaskShape.fillCircle(0,0,235);
    const mask=this.blackoutMaskShape.createGeometryMask();mask.invertAlpha=true;this.blackoutOverlay.setMask(mask);
    this.blackoutEdge=this.add.graphics().setDepth(90).setVisible(false);this.blackoutEdge.lineStyle(86,0x010303,.38);this.blackoutEdge.strokeCircle(0,0,273);this.blackoutEdge.lineStyle(4,0xb7c393,.04);this.blackoutEdge.strokeCircle(0,0,233);
  }

  private applySnapshot(snapshot: GameSnapshot) {
    this.currentSnapshot = snapshot;
    this.targetTank = { ...snapshot.tank };
    this.localRole = snapshot.mode === "local" ? undefined : snapshot.players.find((p) => p.sessionId === network.sessionId)?.role;

    const audioNow = performance.now();
    if (this.lastAudioTank) {
      const dt = Math.max(0.016, (audioNow - this.lastAudioTank.at) / 1000);
      const distance = Phaser.Math.Distance.Between(snapshot.tank.x, snapshot.tank.y, this.lastAudioTank.x, this.lastAudioTank.y);
      const measuredSpeed = distance / dt;
      const targetMotion = Phaser.Math.Clamp(measuredSpeed / Math.max(1, snapshot.combatStats.forwardSpeed), 0, 1.15);
      this.engineMotion = Phaser.Math.Linear(this.engineMotion, targetMotion, 0.42);
    }
    this.lastAudioTank = { x: snapshot.tank.x, y: snapshot.tank.y, at: audioNow };
    for (const u of snapshot.upgrades) this.latestUpgradeLevels.set(u.id, u.level);
    const engineLevel = this.latestUpgradeLevels.get("ENGINE") ?? 0;
    audio.setEngineMotion(this.engineMotion, engineLevel, snapshot.phase !== "gameover" && snapshot.players.length >= 2);

    if (!this.cameraConfigured) {
      this.cameraConfigured = true;
      this.cameras.main.setBounds(0, 0, snapshot.world.width, snapshot.world.height);
      this.cameras.main.startFollow(this.tank, true, 0.09, 0.09);
      this.cameras.main.setDeadzone(760, 430);
      this.cameras.main.setFollowOffset(0, 0);
    }
    if (this.obstacleIds.size === 0) for (const obstacle of snapshot.obstacles) this.drawObstacle(obstacle);
    this.updateTankEvolution(snapshot);
    this.syncBullets(snapshot);
    this.syncEnemyProjectiles(snapshot);
    this.syncSnakes(snapshot);
    this.syncBoss(snapshot.boss);
    this.syncCash(snapshot);
  }

  private syncBullets(snapshot: GameSnapshot) {
    const liveIds = new Set(snapshot.bullets.map((b) => b.id));
    for (const [id, visual] of this.bulletSprites) {
      if (!liveIds.has(id)) { this.releaseActorImage(visual.sprite); this.bulletSprites.delete(id); }
    }
    const speed=snapshot.combatStats.bulletSpeed;
    for (const bullet of snapshot.bullets) {
      let visual=this.bulletSprites.get(bullet.id);
      if(!visual){
        const sprite=this.makeBullet(bullet.x,bullet.y,bullet.radius,bullet.weaponTier);
        visual={sprite,targetX:bullet.x,targetY:bullet.y,vx:Math.cos(bullet.angle)*speed,vy:Math.sin(bullet.angle)*speed};
        this.bulletSprites.set(bullet.id,visual);
      }
      visual.targetX=bullet.x;visual.targetY=bullet.y;visual.vx=Math.cos(bullet.angle)*speed;visual.vy=Math.sin(bullet.angle)*speed;visual.sprite.rotation=bullet.angle;
    }
  }

  private syncSnakes(snapshot: GameSnapshot) {
    const liveIds=new Set(snapshot.snakes.map(s=>s.id));
    for(const [id,visual] of this.snakeVisuals){if(!liveIds.has(id)){this.releaseActorImage(visual.sprite);this.snakeVisuals.delete(id);}}
    for(const snake of snapshot.snakes){
      let visual=this.snakeVisuals.get(snake.id);
      if(!visual){visual=this.createSnakeVisual(snake);this.snakeVisuals.set(snake.id,visual);}
      visual.target=snake;
    }
  }

  private syncCash(snapshot: GameSnapshot) {
    const liveIds=new Set(snapshot.cashCrates.map(c=>c.id));
    for(const [id,v] of this.cashVisuals){if(!liveIds.has(id)){this.releaseActorImage(v.sprite);v.timer.destroy();this.cashVisuals.delete(id);}}
    for(const crate of snapshot.cashCrates){let v=this.cashVisuals.get(crate.id);if(!v){v=this.createCashVisual(crate);this.cashVisuals.set(crate.id,v);}v.target=crate;}
  }

  private createSnakeVisual(snake: SnakeSnapshot): SnakeVisual {
    const {key,originX}=this.ensureSnakeTexture(snake);
    const sprite=this.acquireActorImage(key,snake.x,snake.y,17).setOrigin(originX,.5);
    sprite.rotation=snake.rotation;
    return {sprite,target:snake};
  }

  private ensureSnakeTexture(snake:SnakeSnapshot){
    const hr=Math.round(snake.headRadius),br=Math.round(snake.bodyRadius),len=Math.round(snake.length);
    const key=`sb-snake-${snake.variant}-${snake.volatile?1:0}-${hr}-${br}-${len}`;
    const margin=12,headX=margin+len,width=Math.ceil(len+hr*2+margin*2+8),height=Math.ceil(Math.max(hr*2.2,br*3)+margin*2);
    const originX=headX/width;
    if(this.textures.exists(key))return{key,originX};
    const g=this.make.graphics({x:0,y:0,add:false});const cy=height/2;
    const bodyPalette=snake.variant==="BOMBER"?[0x6f362d,0x8a4534,0x9e523b]:snake.variant==="VENOM"?[0x2e5d50,0x397665,0x438675]:snake.variant==="CASH"?[0x75662f,0x91813b,0xa89142]:[0x365c32,0x3f6938,0x487442];
    // Integrated shadow and a slightly curved body preserve the organic silhouette without 12+ live objects per snake.
    g.fillStyle(0x07100b,.24);g.fillEllipse(headX-len*.42+5,cy+7,len*.92,br*2.1);
    const segments=7,spacing=len/segments;
    for(let i=segments;i>=1;i--){const taper=Phaser.Math.Linear(.42,1,1-i/(segments+1));const r=Math.max(5,br*taper),x=headX-spacing*i,y=cy+Math.sin(i*.9+snake.seed*.15)*br*.24;g.fillStyle(bodyPalette[i%bodyPalette.length],1);g.fillCircle(x,y,r);g.lineStyle(2,0x192f1b,.55);g.strokeCircle(x,y,r);if((snake.volatile||snake.variant==="BOMBER")&&(i===2||i===4||i===6)){g.fillStyle(0xff9a37,.88);g.fillCircle(x,y,Math.max(3.5,r*.42));g.lineStyle(1,0xffd06a,.7);g.strokeCircle(x,y,Math.max(3.5,r*.42));}}
    g.fillStyle(0x477541,1);g.fillCircle(headX-hr*.62,cy,Math.max(br,hr*.54));
    if(snake.variant==="VENOM"){g.fillStyle(0x3f7c69,.5);g.fillEllipse(headX-hr*.35,cy,hr*1.4,hr*2.05);}
    const hc=snake.variant==="BOMBER"?0xaa503b:snake.variant==="VENOM"?0x4c9480:snake.variant==="CASH"?0xb19c4d:0x558c4d;
    g.fillStyle(hc,1);g.fillEllipse(headX,cy,hr*2,hr*1.55);g.lineStyle(3,0x17361b,.78);g.strokeEllipse(headX,cy,hr*2,hr*1.55);
    g.fillStyle(0x75a867,.28);g.fillEllipse(headX+hr*.2,cy,hr*.95,hr*1.1);
    const ey=hr*.3,ex=hr*.28;for(const sign of [-1,1]){g.fillStyle(0xf5e6bd,1);g.fillCircle(headX+ex,cy+ey*sign,Math.max(3,hr*.17));g.fillStyle(0x11180f,1);g.fillCircle(headX+ex+hr*.07,cy+ey*sign,Math.max(1.7,hr*.075));}
    g.lineStyle(2,0xe45d66,.72);g.lineBetween(headX+hr*.82,cy,headX+hr*1.3,cy);g.lineBetween(headX+hr*1.18,cy,headX+hr*1.38,cy-4);g.lineBetween(headX+hr*1.18,cy,headX+hr*1.38,cy+4);
    if(snake.variant==="CASH"){const bx=headX-len*.42;g.fillStyle(0xffd35f,.95);g.fillRoundedRect(bx-10,cy-br-14,20,16,3);g.lineStyle(2,0x6b4a20,.8);g.strokeRoundedRect(bx-10,cy-br-14,20,16,3);g.lineBetween(bx,cy-br-11,bx,cy-br-1);}
    g.generateTexture(key,width,height);g.destroy();return{key,originX};
  }

  private updateSnakeVisuals(time:number,delta:number){
    const view=this.cameras.main.worldView,pad=180;
    const blend=1-Math.pow(.66,delta/16.667);
    for(const v of this.snakeVisuals.values()){
      const s=v.target,visible=s.x>view.x-pad&&s.x<view.right+pad&&s.y>view.y-pad&&s.y<view.bottom+pad;
      v.sprite.setVisible(visible);if(!visible)continue;
      v.sprite.x=Phaser.Math.Linear(v.sprite.x,s.x,blend);v.sprite.y=Phaser.Math.Linear(v.sprite.y,s.y,blend);
      v.sprite.rotation=Phaser.Math.Angle.RotateTo(v.sprite.rotation,s.rotation,.16*Math.max(.5,delta/16.667));
      // One transform replaces seven individually animated body segments.
      v.sprite.scaleY=.995+Math.sin(time*.006+s.seed)*.025;
    }
    if(time-this.lastHealthBarUpdateAt>=95){this.lastHealthBarUpdateAt=time;this.drawSnakeHealthBars(view,pad);}
  }

  private drawSnakeHealthBars(view:Phaser.Geom.Rectangle,pad:number){
    const g=this.snakeHealthBars;g.clear();
    for(const v of this.snakeVisuals.values()){
      const s=v.target;if(s.hp>=s.maxHp*.999||s.x<view.x-pad||s.x>view.right+pad||s.y<view.y-pad||s.y>view.bottom+pad)continue;
      const ratio=Phaser.Math.Clamp(s.hp/s.maxHp,0,1),x=v.sprite.x-30,y=v.sprite.y-s.headRadius-20;
      g.fillStyle(0x09100c,.78);g.fillRect(x,y,60,7);g.fillStyle(ratio>.35?0x9edb6c:0xe06d55,1);g.fillRect(x+2,y+2,56*ratio,3);
    }
  }

  private createCashVisual(crate:CashCrateSnapshot):CashVisual{
    const sprite=this.acquireActorImage("sb-cash-crate",crate.x,crate.y,15);
    const timer=this.add.text(crate.x,crate.y+43,"",{fontFamily:"Arial, sans-serif",fontSize:"11px",fontStyle:"bold",color:"#f0eee0",stroke:"#10140f",strokeThickness:3}).setOrigin(.5).setDepth(16);
    return{sprite,timer,target:crate};
  }

  private updateCashVisuals(time:number){
    if(time-this.lastCashVisualUpdateAt<67)return;this.lastCashVisualUpdateAt=time;const view=this.cameras.main.worldView,pad=100;
    for(const v of this.cashVisuals.values()){const c=v.target,visible=c.x>view.x-pad&&c.x<view.right+pad&&c.y>view.y-pad&&c.y<view.bottom+pad;v.sprite.setVisible(visible);v.timer.setVisible(visible);if(!visible)continue;const yy=c.y+Math.sin(time*.004+c.id)*3;v.sprite.setPosition(c.x,yy);v.timer.setPosition(c.x,yy+43);const urgent=c.timeLeftMs<3000;v.timer.setText(`$${c.value} • ${Math.max(0,c.timeLeftMs/1000).toFixed(1)}s`);v.timer.setColor(urgent?"#ff8372":"#f0eee0");v.sprite.alpha=urgent?.72+Math.sin(time*.02)*.24:1;}
  }

  private drawObstacle(obstacle: ObstacleSnapshot) {
    if(this.obstacleIds.has(obstacle.id))return;this.obstacleIds.add(obstacle.id);
    const r=Math.round(obstacle.radius),key=`sb-obstacle-${obstacle.type}-${r}`;
    if(!this.textures.exists(key)){
      const pad=22,size=r*2+pad*2,cx=r+pad,cy=r+pad;const g=this.make.graphics({x:0,y:0,add:false});
      g.fillStyle(0x09100c,.34);g.fillEllipse(cx+8,cy+12,r*2.05,r*1.25);
      if(obstacle.type==="wreck"){
        g.fillStyle(0x3e473f,1);g.fillRoundedRect(cx-r,cy-r*.48,r*2,r*.96,12);g.lineStyle(4,0x171f19,.8);g.strokeRoundedRect(cx-r,cy-r*.48,r*2,r*.96,12);g.fillStyle(0x7a5a38,.75);g.fillRect(cx-r*.45,cy-r*.58,r*.9,r*1.16);
      }else if(obstacle.type==="base"){
        g.fillStyle(0x303a30,1);g.fillRoundedRect(cx-r,cy-r*.72,r*2,r*1.44,14);g.lineStyle(4,0x81856d,.55);g.strokeRoundedRect(cx-r+6,cy-r*.62,r*2-12,r*1.24,12);g.fillStyle(0x191f1a,1);g.fillRect(cx-r*.25,cy-r*.9,r*.5,r*.45);g.fillStyle(0xc9a950,.35);g.fillCircle(cx+r*.55,cy-r*.35,10);
      }else if(obstacle.type==="tower"){
        g.fillStyle(0x28332a,1);g.fillCircle(cx,cy,r);g.lineStyle(5,0x838b77,.5);g.strokeCircle(cx,cy,r*.72);g.lineBetween(cx-r*.55,cy-r*.55,cx+r*.55,cy+r*.55);g.lineBetween(cx+r*.55,cy-r*.55,cx-r*.55,cy+r*.55);g.fillStyle(0xd9b354,.35);g.fillCircle(cx,cy,9);
      }else{
        g.fillStyle(0x2b352e,1);g.fillCircle(cx,cy,r);g.fillStyle(0x596052,.72);g.fillEllipse(cx-r*.18,cy-r*.25,r*1.25,r*.8);g.lineStyle(3,0x171e19,.62);g.strokeCircle(cx,cy,r);
      }
      g.generateTexture(key,size,size);g.destroy();
    }
    this.add.image(obstacle.x,obstacle.y,key).setDepth(9);
    if(obstacle.label)this.add.text(obstacle.x,obstacle.y+obstacle.radius+22,obstacle.label,{fontFamily:"Arial Black, Arial",fontSize:"12px",color:"#bbb89d",stroke:"#101510",strokeThickness:4}).setOrigin(.5).setDepth(10).setAlpha(.65);
  }

  private sendControls() {
    const snapshot=this.currentSnapshot;
    const forward=this.keys.W.isDown||this.cursors.up.isDown, reverse=this.keys.S.isDown||this.cursors.down.isDown, left=this.keys.A.isDown||this.cursors.left.isDown, right=this.keys.D.isDown||this.cursors.right.isDown;
    const pointer=this.input.activePointer;
    const angle=Phaser.Math.Angle.Between(this.tank.x,this.tank.y,pointer.worldX,pointer.worldY);
    const firing=pointer.leftButtonDown()||this.keys.SPACE.isDown;
    if(snapshot?.mode==="local"){
      network.sendDrive(Number(forward)-Number(reverse),Number(right)-Number(left));network.sendAim(angle);
      if(firing!==this.lastFiring||firing){network.sendFiring(firing);this.lastFiring=firing;}return;
    }
    if(this.localRole==="driver"){network.sendDrive(Number(forward)-Number(reverse),Number(right)-Number(left));if(this.lastFiring){network.sendFiring(false);this.lastFiring=false;}return;}
    if(this.localRole==="gunner"){network.sendAim(angle);if(firing!==this.lastFiring||firing){network.sendFiring(firing);this.lastFiring=firing;}}
    else if(this.lastFiring){network.sendFiring(false);this.lastFiring=false;}
  }

  private updateReticle() {
    const active = (this.currentSnapshot?.mode === "local" || this.localRole === "gunner") && this.currentSnapshot?.phase === "combat";
    this.reticle.setVisible(active);
    if (!active) return;
    const pointer = this.input.activePointer;
    this.reticle.x = pointer.worldX;
    this.reticle.y = pointer.worldY;
    const pulse = 0.92 + Math.sin(this.time.now * 0.008) * 0.08;
    this.reticle.setScale(pulse);
  }

  private updateBlackout() {
    const active=this.currentSnapshot?.waveType==="BLACKOUT"&&this.currentSnapshot.phase==="combat";
    this.blackoutOverlay.setVisible(active);this.blackoutDim.setVisible(active);this.blackoutEdge.setVisible(active);if(!active)return;
    this.blackoutMaskShape.setPosition(this.tank.x,this.tank.y);
    this.blackoutEdge.setPosition(this.tank.x,this.tank.y);
  }

  private syncEnemyProjectiles(snapshot:GameSnapshot){
    const live=new Set(snapshot.enemyProjectiles.map(p=>p.id));for(const [id,v] of this.enemyProjectileSprites){if(!live.has(id)){this.releaseActorImage(v.sprite);this.enemyProjectileSprites.delete(id);}}
    for(const p of snapshot.enemyProjectiles){let v=this.enemyProjectileSprites.get(p.id);if(!v){const sprite=this.acquireActorImage("sb-venom-projectile",p.x,p.y,29);v={sprite,targetX:p.x,targetY:p.y,vx:p.vx,vy:p.vy};this.enemyProjectileSprites.set(p.id,v);}v.targetX=p.x;v.targetY=p.y;v.vx=p.vx;v.vy=p.vy;}
  }

  private syncBoss(boss?:BossSnapshot){
    this.bossTarget=boss;
    if(!boss){if(this.bossVisual){this.bossVisual.destroy(true);this.bossVisual=undefined;}this.bossHpBg?.destroy();this.bossHpFill?.destroy();this.bossHpBg=undefined;this.bossHpFill=undefined;this.bossTelegraph?.destroy();this.bossTelegraph=undefined;return;}
    if(!this.bossVisual){
      const parts:Phaser.GameObjects.GameObject[]=[];const shadow=this.add.ellipse(-22,20,boss.radius*2.2,boss.radius*1.25,0x070d09,.38);parts.push(shadow);
      if(boss.type==="LACE_MONITOR"){
        const body=this.add.ellipse(0,0,boss.radius*2.0,boss.radius*1.05,0x5d6744,1).setStrokeStyle(5,0x26311f,.9);const head=this.add.ellipse(boss.radius*.8,0,boss.radius*.72,boss.radius*.56,0x778058,1).setStrokeStyle(4,0x26311f,.9);const tail=this.add.triangle(-boss.radius*.82,0,0,-24,-boss.radius*1.5,0,0,24,0x4f5b3b,1);parts.push(tail,body,head);for(const sy of [-1,1])for(const sx of [-.35,.35]){const leg=this.add.rectangle(sx*boss.radius,sy*boss.radius*.53,boss.radius*.52,14,0x4a5537,1).setRotation(sy*.45);parts.push(leg);}
      }else{
        for(let i=8;i>=1;i--){const r=boss.radius*(.36+i*.035);parts.push(this.add.circle(-i*boss.radius*.34,Math.sin(i)*12,r,i%2?0x486f3e:0x577e48,1).setStrokeStyle(3,0x1b351e,.7));}
        parts.push(this.add.ellipse(0,0,boss.radius*1.5,boss.radius,boss.type==="COBRA_SENTINEL"?0x618c4f:0x568248,1).setStrokeStyle(5,0x18341d,.85));
        if(boss.type==="COBRA_SENTINEL")parts.push(this.add.ellipse(-boss.radius*.2,0,boss.radius*1.25,boss.radius*1.7,0x7ca664,.5));
      }
      this.bossVisual=this.add.container(boss.x,boss.y,parts).setDepth(19);this.bossVisual.rotation=boss.rotation;
      this.bossHpBg=this.add.rectangle(800,70,700,22,0x0a0f0b,.85).setScrollFactor(0).setDepth(110);
      this.bossHpFill=this.add.rectangle(450,70,700,14,0xd44f42,1).setOrigin(0,.5).setScrollFactor(0).setDepth(111);
      this.bossTelegraph=this.add.graphics().setDepth(18);
    }
    if(this.bossHpFill)this.bossHpFill.displayWidth=700*Phaser.Math.Clamp(boss.hp/boss.maxHp,0,1);
    this.bossVisual.setAlpha(boss.vulnerable?1:.82);
  }

  private updateBossVisual(delta:number){const boss=this.bossTarget,visual=this.bossVisual;if(!boss||!visual)return;const blend=1-Math.pow(.68,delta/16.667);visual.x=Phaser.Math.Linear(visual.x,boss.x,blend);visual.y=Phaser.Math.Linear(visual.y,boss.y,blend);visual.rotation=Phaser.Math.Angle.RotateTo(visual.rotation,boss.rotation,.14*Math.max(.5,delta/16.667));}

  private updateBossTelegraph(time:number){
    const b=this.currentSnapshot?.boss;if(!this.bossTelegraph||!b){return;}if(time-this.lastBossTelegraphAt<67)return;this.lastBossTelegraphAt=time;this.bossTelegraph.clear();
    if(b.phase==="TELEGRAPH"){const a=Math.atan2(this.tank.y-b.y,this.tank.x-b.x);this.bossTelegraph.lineStyle(16,0xff5d45,.14);this.bossTelegraph.lineBetween(b.x,b.y,b.x+Math.cos(a)*900,b.y+Math.sin(a)*900);this.bossTelegraph.lineStyle(3,0xffd36a,.8);this.bossTelegraph.lineBetween(b.x,b.y,b.x+Math.cos(a)*900,b.y+Math.sin(a)*900);}
  }

  private updateTankEvolution(snapshot:GameSnapshot){
    for(const u of snapshot.upgrades)this.latestUpgradeLevels.set(u.id,u.level);
    const levels=Object.fromEntries(this.latestUpgradeLevels) as Record<string,number>;
    const ensure=(key:string,obj:()=>Phaser.GameObjects.GameObject)=>{if(!this.tankEvolution.has(key)){const o=obj();this.tank.add(o);this.tank.sendToBack(o);this.tankEvolution.set(key,o);}};
    if((levels.ARMOR??0)>=2)ensure("armor",()=>{const g=this.add.graphics();g.fillStyle(0x82907a,.8);g.fillRoundedRect(-50,-34,25,68,5);g.fillRoundedRect(28,-34,22,68,5);g.lineStyle(2,0xc7ccb8,.25);g.lineBetween(-47,-28,-47,28);g.lineBetween(44,-28,44,28);return g;});
    if((levels.ENGINE??0)>=2)ensure("engine",()=>{const g=this.add.graphics();g.fillStyle(0x242d26,1);g.fillCircle(-38,-22,8);g.fillCircle(-38,22,8);g.lineStyle(3,0x9ba28f,.35);g.strokeCircle(-38,-22,8);g.strokeCircle(-38,22,8);return g;});
    if((levels.AUTOLOADER??0)>=3)ensure("loader",()=>this.add.rectangle(-5,24,34,10,0x6f7a66,.95).setStrokeStyle(2,0xc1c7b3,.3));
    if((levels.SCAVENGER??0)>=2)ensure("scavenger",()=>this.add.rectangle(-20,-35,30,12,0x8b6f39,.9).setStrokeStyle(2,0xe1bd68,.35));
    if((levels.ORDNANCE??0)>=3)ensure("ordnance",()=>{const g=this.add.graphics();g.fillStyle(0x3f4a3c,1);g.fillRoundedRect(8,-9,76,18,5);g.fillStyle(0x171f19,1);g.fillRect(72,-12,18,24);return g;});
  }

  private makeBullet(x:number,y:number,radius=5,weaponTier="SHELL"){
    const key=weaponTier==="ROCKET"?"sb-bullet-rocket":weaponTier==="HEAVY_SHELL"?"sb-bullet-heavy":"sb-bullet-shell";
    const sprite=this.acquireActorImage(key,x,y,27);const base=weaponTier==="ROCKET"?7:5;sprite.setScale(Math.max(.7,radius/base));return sprite;
  }

  private updateProjectiles(delta:number){
    const dt=Math.min(.05,delta/1000),correction=1-Math.pow(.82,delta/16.667),view=this.cameras.main.worldView,pad=100;
    for(const v of this.bulletSprites.values()){v.sprite.x+=v.vx*dt;v.sprite.y+=v.vy*dt;v.sprite.x=Phaser.Math.Linear(v.sprite.x,v.targetX,correction*.32);v.sprite.y=Phaser.Math.Linear(v.sprite.y,v.targetY,correction*.32);v.sprite.setVisible(v.sprite.x>view.x-pad&&v.sprite.x<view.right+pad&&v.sprite.y>view.y-pad&&v.sprite.y<view.bottom+pad);}
    for(const v of this.enemyProjectileSprites.values()){v.sprite.x+=v.vx*dt;v.sprite.y+=v.vy*dt;v.sprite.x=Phaser.Math.Linear(v.sprite.x,v.targetX,correction*.3);v.sprite.y=Phaser.Math.Linear(v.sprite.y,v.targetY,correction*.3);v.sprite.rotation+=delta*.004;v.sprite.setVisible(v.sprite.x>view.x-pad&&v.sprite.x<view.right+pad&&v.sprite.y>view.y-pad&&v.sprite.y<view.bottom+pad);}
  }

  private playMuzzleFlash(x:number,y:number,angle:number){
    this.spawnFx(x,y,{texture:"sb-fx-muzzle",tint:0xffffff,life:70,scale:1,endScale:1.35,alpha:.95,rotation:angle,depth:50});
    const count=this.fxCount(2,1);for(let i=0;i<count;i++){const a=angle+Phaser.Math.FloatBetween(-.4,.4),speed=Phaser.Math.Between(150,300);this.spawnFx(x+Math.cos(angle)*10,y+Math.sin(angle)*10,{tint:0xffdf78,life:120,scale:.5,endScale:.12,alpha:.85,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,depth:49});}
    if(this.perfQuality>.55)this.cameras.main.shake(34,.0009);
  }

  private playImpact(x:number,y:number){
    const count=this.fxCount(5,1);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,speed=90+Math.random()*180;this.spawnFx(x,y,{tint:0xe5d4ac,life:150+Math.random()*70,scale:.38,endScale:.08,alpha:.8,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,depth:48});}
  }

  private playHit(x:number,y:number,damage:number,headshot:boolean){
    if(headshot)audio.headshot();else audio.bodyHit();const color=headshot?0xffe36e:0x8fd16f,count=this.fxCount(headshot?7:4,headshot?3:1);
    for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,speed=(headshot?130:85)+Math.random()*(headshot?150:90);this.spawnFx(x,y,{tint:color,life:180+Math.random()*150,scale:headshot?.55:.42,endScale:.1,alpha:.75,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,gravity:55,depth:47});}
    // Damage text is pooled and body-hit text is automatically reduced only under sustained low FPS.
    if(headshot||this.perfQuality>.68)this.spawnFloatingText(x,y-14,headshot?`HEADSHOT  ${damage}`:`${damage}`,headshot);
  }

  private playSnakeDeath(snakeId:number,x:number,y:number,exploded:boolean){
    const v=this.snakeVisuals.get(snakeId);if(v){this.snakeVisuals.delete(snakeId);this.releaseActorImage(v.sprite);}if(exploded)return;
    const count=this.fxCount(7,2);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,speed=70+Math.random()*130;this.spawnFx(x,y,{tint:0x3b773b,life:300+Math.random()*260,scale:.65,endScale:.2,alpha:.72,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,gravity:30,depth:13});}
  }

  private playExplosion(x:number,y:number,radius:number){
    this.spawnFx(x,y,{texture:"sb-fx-flash",tint:0xfff1aa,life:150,scale:1,endScale:2.7,alpha:.95,depth:65});
    this.spawnFx(x,y,{texture:"sb-fx-flash",tint:0xff8c2d,life:260,scale:1.35,endScale:4.8,alpha:.72,depth:64});
    this.spawnFx(x,y,{texture:"sb-fx-ring",tint:0xffc45d,life:320,scale:.7,endScale:Math.max(1.2,radius/34),alpha:.8,depth:63});
    const count=this.fxCount(14,4);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,speed=100+Math.random()*Math.min(420,radius*2.2);this.spawnFx(x,y,{tint:i%3===0?0xffe29a:0xff7832,life:280+Math.random()*300,scale:.55,endScale:.12,alpha:.9,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,gravity:25,depth:66});}
    if(this.perfQuality>.42)this.cameras.main.shake(120,.0048);
  }

  private playTankHit(amount:number,source:string){
    if(this.perfQuality>.5){const flash=this.add.rectangle(800,450,1600,900,0xa91616,source==="explosion"?.18:.10).setScrollFactor(0).setDepth(95);this.tweens.add({targets:flash,alpha:0,duration:150,onComplete:()=>flash.destroy()});}
    this.cameras.main.shake(source==="explosion"?130:75,source==="explosion"?.006:.0035);this.spawnFloatingText(this.tank.x,this.tank.y-65,`-${amount} HP`,true,0xff8a76);
  }

  private playCashPickup(x:number,y:number,value:number){
    this.spawnFloatingText(x,y-15,`+$${value}`,true,0xffd969);const count=this.fxCount(6,2);for(let i=0;i<count;i++){const a=Phaser.Math.FloatBetween(-Math.PI,0),speed=80+Math.random()*130;this.spawnFx(x,y,{tint:0xffd35f,life:420+Math.random()*260,scale:.45,endScale:.15,alpha:.9,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,gravity:120,depth:58});}
  }

  private fxCount(base:number,min:number){const snakes=this.currentSnapshot?.snakes.length??0;const density=snakes>=60?.4:snakes>=40?.58:snakes>=25?.78:1;return Math.max(min,Math.round(base*density*this.perfQuality));}

  private updateDust(delta:number){
    const canDrive=this.currentSnapshot?.mode==="local"||this.localRole==="driver";if(!canDrive||this.currentSnapshot?.phase!=="combat")return;
    const moving=this.keys.W.isDown||this.keys.S.isDown||this.cursors.up.isDown||this.cursors.down.isDown;if(!moving)return;this.dustTimer-=delta;if(this.dustTimer>0)return;this.dustTimer=this.perfQuality<.65?145:95;
    for(const off of [-21,21]){const x=this.tank.x-Math.cos(this.tank.rotation)*46-Math.sin(this.tank.rotation)*off,y=this.tank.y-Math.sin(this.tank.rotation)*46+Math.cos(this.tank.rotation)*off;this.spawnFx(x+Phaser.Math.Between(-4,4),y+Phaser.Math.Between(-4,4),{tint:0xc6b98f,life:440,scale:.65,endScale:1.8,alpha:.16,vx:-Math.cos(this.tank.rotation)*50,vy:-Math.sin(this.tank.rotation)*50,depth:7});}
  }

  private acquireActorImage(texture:string,x:number,y:number,depth:number){
    const image=this.actorImagePool.pop()??this.add.image(x,y,texture);image.setTexture(texture).clearTint().setOrigin(.5).setPosition(x,y).setRotation(0).setScale(1).setAlpha(1).setDepth(depth).setVisible(true).setActive(true);return image;
  }

  private releaseActorImage(image:Phaser.GameObjects.Image){image.setVisible(false).setActive(false).setPosition(-9999,-9999).setScale(1).setAlpha(1);this.actorImagePool.push(image);}

  private createPerformanceTextures(){
    const make=(key:string,w:number,h:number,draw:(g:Phaser.GameObjects.Graphics)=>void)=>{if(this.textures.exists(key))return;const g=this.make.graphics({x:0,y:0,add:false});draw(g);g.generateTexture(key,w,h);g.destroy();};
    make("sb-fx-dot",16,16,g=>{g.fillStyle(0xffffff,1);g.fillCircle(8,8,7);});
    make("sb-fx-flash",40,40,g=>{g.fillStyle(0xffffff,1);g.fillCircle(20,20,18);});
    make("sb-fx-ring",64,64,g=>{g.lineStyle(5,0xffffff,1);g.strokeCircle(32,32,26);});
    make("sb-fx-muzzle",52,34,g=>{g.fillStyle(0xffb73f,.95);g.fillTriangle(2,17,50,3,42,31);g.fillStyle(0xfff1ae,1);g.fillCircle(7,17,6);});
    make("sb-bullet-shell",38,12,g=>{g.fillStyle(0xffc94f,.20);g.fillEllipse(10,6,20,5);g.fillStyle(0xffefb5,1);g.fillCircle(29,6,5);});
    make("sb-bullet-heavy",44,15,g=>{g.fillStyle(0xffc94f,.25);g.fillEllipse(11,7.5,23,6);g.fillStyle(0xffd66f,1);g.fillCircle(34,7.5,7);});
    make("sb-bullet-rocket",60,18,g=>{g.fillStyle(0xff7d32,.45);g.fillEllipse(15,9,30,8);g.fillStyle(0xe9e5cf,1);g.fillRoundedRect(30,3,24,12,5);g.lineStyle(2,0x6d2f1c,.8);g.strokeRoundedRect(30,3,24,12,5);});
    make("sb-venom-projectile",30,30,g=>{g.fillStyle(0x70f28c,.18);g.fillCircle(15,15,14);g.fillStyle(0x61d978,1);g.fillCircle(15,15,7);g.lineStyle(2,0x183a20,.8);g.strokeCircle(15,15,7);});
    make("sb-cash-crate",70,92,g=>{g.fillStyle(0xffd45c,.10);g.fillRect(31,0,8,50);g.fillStyle(0xffd45c,.12);g.fillCircle(35,55,31);g.fillStyle(0x080d09,.3);g.fillEllipse(39,66,48,24);g.fillStyle(0xc78a2a,1);g.fillRoundedRect(16,40,39,31,4);g.lineStyle(3,0xffdc78,.8);g.strokeRoundedRect(16,40,39,31,4);g.fillStyle(0x6d461f,.85);g.fillRect(31,40,8,31);g.lineStyle(3,0xfff1a7,.9);g.lineBetween(35,47,35,65);g.lineBetween(29,51,41,51);g.lineBetween(29,61,41,61);});
  }

  private createFxPools(){
    const poolSize=180;for(let i=0;i<poolSize;i++){const sprite=this.add.image(-9999,-9999,"sb-fx-dot").setVisible(false).setActive(false).setDepth(60);this.fxPool.push({sprite,active:false,vx:0,vy:0,gravity:0,life:0,maxLife:1,startAlpha:1,startScale:1,endScale:1,spin:0});}
    for(let i=0;i<24;i++){const text=this.add.text(-9999,-9999,"",{fontFamily:"Arial Black, Arial",fontSize:"16px",color:"#d8efc9",stroke:"#101710",strokeThickness:4}).setOrigin(.5).setVisible(false).setActive(false).setDepth(70);this.textPool.push({text,active:false,life:0,maxLife:1,vy:-70});}
  }

  private spawnFx(x:number,y:number,opt:{texture?:string;tint?:number;life?:number;scale?:number;endScale?:number;alpha?:number;vx?:number;vy?:number;gravity?:number;rotation?:number;spin?:number;depth?:number}){
    let p:FxParticle|undefined;for(let n=0;n<this.fxPool.length;n++){const idx=(this.fxCursor+n)%this.fxPool.length;if(!this.fxPool[idx].active){p=this.fxPool[idx];this.fxCursor=(idx+1)%this.fxPool.length;break;}}if(!p)return;
    const life=opt.life??250;p.active=true;p.vx=opt.vx??0;p.vy=opt.vy??0;p.gravity=opt.gravity??0;p.life=life;p.maxLife=life;p.startAlpha=opt.alpha??1;p.startScale=opt.scale??1;p.endScale=opt.endScale??.2;p.spin=opt.spin??0;
    p.sprite.setTexture(opt.texture??"sb-fx-dot").setTint(opt.tint??0xffffff).setPosition(x,y).setRotation(opt.rotation??0).setScale(p.startScale).setAlpha(p.startAlpha).setDepth(opt.depth??60).setVisible(true).setActive(true);
  }

  private updateFx(delta:number){const dt=Math.min(.05,delta/1000);for(const p of this.fxPool){if(!p.active)continue;p.life-=delta;if(p.life<=0){p.active=false;p.sprite.setVisible(false).setActive(false);continue;}const t=1-p.life/p.maxLife;p.vy+=p.gravity*dt;p.sprite.x+=p.vx*dt;p.sprite.y+=p.vy*dt;p.sprite.rotation+=p.spin*dt;p.sprite.alpha=p.startAlpha*(1-t);p.sprite.setScale(Phaser.Math.Linear(p.startScale,p.endScale,t));}}

  private spawnFloatingText(x:number,y:number,value:string,important=false,color?:number){
    let p:FloatingText|undefined;for(let n=0;n<this.textPool.length;n++){const idx=(this.textCursor+n)%this.textPool.length;if(!this.textPool[idx].active){p=this.textPool[idx];this.textCursor=(idx+1)%this.textPool.length;break;}}if(!p)return;
    p.active=true;p.life=important?620:420;p.maxLife=p.life;p.vy=important?-72:-58;const hex=`#${(color??(important?0xffe36e:0xd8efc9)).toString(16).padStart(6,"0")}`;p.text.setText(value).setColor(hex).setFontSize(important?18:13).setPosition(x,y).setScale(1).setAlpha(1).setVisible(true).setActive(true);
  }

  private updateFloatingTexts(delta:number){const dt=Math.min(.05,delta/1000);for(const p of this.textPool){if(!p.active)continue;p.life-=delta;if(p.life<=0){p.active=false;p.text.setVisible(false).setActive(false);continue;}const t=1-p.life/p.maxLife;p.text.y+=p.vy*dt;p.text.alpha=1-t;p.text.setScale(1+t*.08);}}

  private createPerfPanel(){this.perfPanel=this.add.text(12,12,"",{fontFamily:"Consolas, monospace",fontSize:"13px",color:"#d9f5c7",backgroundColor:"#07100dcc",padding:{x:8,y:6}}).setScrollFactor(0).setDepth(200).setVisible(false);}

  private measurePerformance(delta:number){
    this.perfFrames++;this.perfSampleMs+=delta;if(this.perfSampleMs<500)return;const fps=this.perfFrames*1000/this.perfSampleMs;this.perfFps=Phaser.Math.Linear(this.perfFps,fps,.35);const sampleMs=this.perfSampleMs;this.perfFrames=0;this.perfSampleMs=0;
    if(this.perfFps<48){this.lowFpsMs+=sampleMs;this.goodFpsMs=0;}else if(this.perfFps>56){this.goodFpsMs+=sampleMs;this.lowFpsMs=Math.max(0,this.lowFpsMs-sampleMs*.5);}else{this.lowFpsMs=Math.max(0,this.lowFpsMs-sampleMs*.2);this.goodFpsMs=0;}
    if(this.lowFpsMs>1200)this.perfQuality=.48;else if(this.lowFpsMs>500)this.perfQuality=.68;else if(this.goodFpsMs>2500)this.perfQuality=1;
    if(this.perfPanelVisible&&this.perfPanel){const visible=[...this.snakeVisuals.values()].filter(v=>v.sprite.visible).length,fx=this.fxPool.filter(p=>p.active).length;this.perfPanel.setText(`FPS ${this.perfFps.toFixed(0)} • quality ${(this.perfQuality*100).toFixed(0)}%\\nSnakes ${visible}/${this.snakeVisuals.size} • FX ${fx} • display ${this.children.getChildren().length}`);}
  }

}
