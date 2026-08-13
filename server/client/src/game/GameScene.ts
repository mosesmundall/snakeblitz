import Phaser from "phaser";
import { network } from "../network";
import type { CashCrateSnapshot, GameSnapshot, ObstacleSnapshot, Role, SnakeSnapshot } from "../types";
import { audio } from "./AudioManager";

interface SnakeVisual {
  container: Phaser.GameObjects.Container;
  segments: Phaser.GameObjects.Arc[];
  head: Phaser.GameObjects.Ellipse;
  volatileSacs: Phaser.GameObjects.Arc[];
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  target: SnakeSnapshot;
}

interface CashVisual {
  container: Phaser.GameObjects.Container;
  timer: Phaser.GameObjects.Text;
  target: CashCrateSnapshot;
}

export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Container;
  private turret!: Phaser.GameObjects.Container;
  private hullShadow!: Phaser.GameObjects.Ellipse;
  private targetTank = {
    x: 800,
    y: 450,
    rotation: -Math.PI / 2,
    turretRotation: -Math.PI / 2,
    health: 100,
    maxHealth: 100,
  };

  private bulletSprites = new Map<number, Phaser.GameObjects.Container>();
  private snakeVisuals = new Map<number, SnakeVisual>();
  private cashVisuals = new Map<number, CashVisual>();
  private obstacleIds = new Set<number>();
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

  constructor() {
    super("GameScene");
  }

  create() {
    this.drawArena();
    this.createTank();
    this.createReticle();
    this.createBlackoutLayer();

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE") as typeof this.keys;

    this.input.on("pointerdown", () => audio.unlock());
    this.input.keyboard?.on("keydown", () => audio.unlock());

    network.addEventListener("snapshot", (event) => {
      const snapshot = (event as CustomEvent<GameSnapshot>).detail;
      this.applySnapshot(snapshot);
    });

    network.addEventListener("shot_fx", (event) => {
      const data = (event as CustomEvent<{ x: number; y: number; angle: number }>).detail;
      this.playMuzzleFlash(data.x, data.y, data.angle);
      audio.shot();
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
    this.tank.x = Phaser.Math.Linear(this.tank.x, this.targetTank.x, 0.3);
    this.tank.y = Phaser.Math.Linear(this.tank.y, this.targetTank.y, 0.3);
    this.hullShadow.x = this.tank.x + 8;
    this.hullShadow.y = this.tank.y + 11;

    this.tank.rotation = Phaser.Math.Angle.RotateTo(this.tank.rotation, this.targetTank.rotation, 0.12);
    this.turret.rotation = Phaser.Math.Angle.RotateTo(
      this.turret.rotation,
      this.targetTank.turretRotation - this.tank.rotation,
      0.2,
    );

    this.updateSnakeVisuals(time);
    this.updateCashVisuals(time);
    this.updateReticle();
    this.updateBlackout();

    if (time - this.lastInputSentAt > 42) {
      this.lastInputSentAt = time;
      this.sendControls();
    }

    this.updateDust(delta);
  }

  private drawArena() {
    const bg = this.add.graphics();
    bg.fillStyle(0x42573d, 1);
    bg.fillRect(0, 0, 1600, 900);

    // Subtle worn dirt lanes give the arena a designed, readable battlefield shape.
    const lanes = this.add.graphics();
    lanes.lineStyle(110, 0x8b7a59, 0.09);
    lanes.beginPath();
    lanes.moveTo(120, 460);
    lanes.lineTo(1480, 460);
    lanes.strokePath();
    lanes.lineStyle(86, 0x756a4f, 0.07);
    lanes.beginPath();
    lanes.moveTo(800, 85);
    lanes.lineTo(800, 815);
    lanes.strokePath();

    const patches = this.add.graphics();
    for (let i = 0; i < 115; i++) {
      const x = Phaser.Math.Between(35, 1565);
      const y = Phaser.Math.Between(35, 865);
      const r = Phaser.Math.Between(8, 34);
      const palette = [0x637052, 0x304a34, 0x6d684d, 0x293d2d];
      patches.fillStyle(palette[i % palette.length], Phaser.Math.FloatBetween(0.08, 0.22));
      patches.fillEllipse(x, y, r * 1.6, r);
    }

    const grass = this.add.graphics();
    grass.lineStyle(2, 0x91a274, 0.12);
    for (let i = 0; i < 170; i++) {
      const x = Phaser.Math.Between(28, 1572);
      const y = Phaser.Math.Between(28, 872);
      const h = Phaser.Math.Between(4, 11);
      grass.lineBetween(x, y, x + Phaser.Math.Between(-3, 3), y - h);
    }

    const border = this.add.graphics();
    border.fillStyle(0x111b17, 1);
    border.fillRect(0, 0, 1600, 24);
    border.fillRect(0, 876, 1600, 24);
    border.fillRect(0, 0, 24, 900);
    border.fillRect(1576, 0, 24, 900);
    border.lineStyle(3, 0xd6bd78, 0.22);
    border.strokeRect(26, 26, 1548, 848);

    for (let x = 65; x < 1560; x += 92) {
      const marker = this.add.rectangle(x, 18, 42, 5, 0xd4a94f, 0.24).setAngle(-12);
      marker.setDepth(2);
      const bottom = this.add.rectangle(x + 34, 882, 42, 5, 0xd4a94f, 0.2).setAngle(-12);
      bottom.setDepth(2);
    }
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
    this.blackoutDim = this.add.rectangle(800, 450, 1600, 900, 0x020606, 0.23).setDepth(88).setVisible(false);
    this.blackoutOverlay = this.add.rectangle(800, 450, 1600, 900, 0x010303, 0.94).setDepth(89).setVisible(false);
    this.blackoutMaskShape = this.make.graphics({ x: 0, y: 0, add: false });
    const mask = this.blackoutMaskShape.createGeometryMask();
    mask.invertAlpha = true;
    this.blackoutOverlay.setMask(mask);
    this.blackoutEdge = this.add.graphics().setDepth(90).setVisible(false);
  }

  private applySnapshot(snapshot: GameSnapshot) {
    this.currentSnapshot = snapshot;
    this.targetTank = { ...snapshot.tank };
    this.localRole = snapshot.players.find((p) => p.sessionId === network.sessionId)?.role;

    if (this.obstacleIds.size === 0) {
      for (const obstacle of snapshot.obstacles) this.drawObstacle(obstacle);
    }

    this.syncBullets(snapshot);
    this.syncSnakes(snapshot);
    this.syncCash(snapshot);
  }

  private syncBullets(snapshot: GameSnapshot) {
    const liveIds = new Set(snapshot.bullets.map((b) => b.id));
    for (const [id, sprite] of this.bulletSprites) {
      if (!liveIds.has(id)) {
        sprite.destroy(true);
        this.bulletSprites.delete(id);
      }
    }

    for (const bullet of snapshot.bullets) {
      let sprite = this.bulletSprites.get(bullet.id);
      if (!sprite) {
        sprite = this.makeBullet(bullet.x, bullet.y);
        this.bulletSprites.set(bullet.id, sprite);
      }
      sprite.x = Phaser.Math.Linear(sprite.x, bullet.x, 0.72);
      sprite.y = Phaser.Math.Linear(sprite.y, bullet.y, 0.72);
      sprite.rotation = bullet.angle;
    }
  }

  private syncSnakes(snapshot: GameSnapshot) {
    const liveIds = new Set(snapshot.snakes.map((s) => s.id));
    for (const [id, visual] of this.snakeVisuals) {
      if (!liveIds.has(id)) {
        this.destroySnakeVisual(visual);
        this.snakeVisuals.delete(id);
      }
    }

    for (const snake of snapshot.snakes) {
      let visual = this.snakeVisuals.get(snake.id);
      if (!visual) {
        visual = this.createSnakeVisual(snake);
        this.snakeVisuals.set(snake.id, visual);
      }
      visual.target = snake;
      const healthRatio = Phaser.Math.Clamp(snake.hp / snake.maxHp, 0, 1);
      visual.hpFill.displayWidth = 56 * healthRatio;
      visual.hpBg.setVisible(healthRatio < 0.999);
      visual.hpFill.setVisible(healthRatio < 0.999);
    }
  }

  private syncCash(snapshot: GameSnapshot) {
    const liveIds = new Set(snapshot.cashCrates.map((c) => c.id));
    for (const [id, visual] of this.cashVisuals) {
      if (!liveIds.has(id)) {
        visual.container.destroy(true);
        this.cashVisuals.delete(id);
      }
    }

    for (const crate of snapshot.cashCrates) {
      let visual = this.cashVisuals.get(crate.id);
      if (!visual) {
        visual = this.createCashVisual(crate);
        this.cashVisuals.set(crate.id, visual);
      }
      visual.target = crate;
    }
  }

  private createSnakeVisual(snake: SnakeSnapshot): SnakeVisual {
    const container = this.add.container(snake.x, snake.y).setDepth(17);
    container.rotation = snake.rotation;

    const shadow = this.add.ellipse(-snake.length * 0.35 + 5, 8, snake.length * 0.92, snake.bodyRadius * 2.2, 0x07100b, 0.28);
    shadow.setOrigin(0.5);
    container.add(shadow);

    const segments: Phaser.GameObjects.Arc[] = [];
    const volatileSacs: Phaser.GameObjects.Arc[] = [];
    const segmentCount = 7;
    const spacing = snake.length / segmentCount;
    const bodyPalette = [0x365c32, 0x3f6938, 0x487442];

    for (let i = segmentCount; i >= 1; i--) {
      const taper = Phaser.Math.Linear(0.42, 1, 1 - i / (segmentCount + 1));
      const radius = Math.max(5, snake.bodyRadius * taper);
      const segment = this.add.circle(-spacing * i, 0, radius, bodyPalette[i % bodyPalette.length], 1);
      segment.setStrokeStyle(2, 0x192f1b, 0.65);
      segments.push(segment);
      container.add(segment);

      if (snake.volatile && (i === 2 || i === 4 || i === 6)) {
        const sac = this.add.circle(-spacing * i, 0, Math.max(3.5, radius * 0.42), 0xff9a37, 0.8);
        sac.setStrokeStyle(2, 0xffd06a, 0.55);
        volatileSacs.push(sac);
        container.add(sac);
      }
    }

    const neck = this.add.circle(-snake.headRadius * 0.62, 0, Math.max(snake.bodyRadius, snake.headRadius * 0.54), 0x477541, 1);
    neck.setStrokeStyle(2, 0x173019, 0.65);
    container.add(neck);

    const head = this.add.ellipse(0, 0, snake.headRadius * 2.0, snake.headRadius * 1.55, 0x558c4d, 1);
    head.setStrokeStyle(3, 0x17361b, 0.82);
    container.add(head);

    const brow = this.add.ellipse(snake.headRadius * 0.2, 0, snake.headRadius * 0.95, snake.headRadius * 1.1, 0x75a867, 0.28);
    container.add(brow);

    const eyeY = snake.headRadius * 0.3;
    const eyeX = snake.headRadius * 0.28;
    for (const sign of [-1, 1]) {
      const eye = this.add.circle(eyeX, eyeY * sign, Math.max(3, snake.headRadius * 0.17), 0xf5e6bd, 1);
      const pupil = this.add.circle(eyeX + snake.headRadius * 0.07, eyeY * sign, Math.max(1.7, snake.headRadius * 0.075), 0x11180f, 1);
      container.add([eye, pupil]);
    }

    const tongue = this.add.graphics();
    tongue.lineStyle(2, 0xe45d66, 0.74);
    tongue.lineBetween(snake.headRadius * 0.82, 0, snake.headRadius * 1.2, 0);
    tongue.lineBetween(snake.headRadius * 1.18, 0, snake.headRadius * 1.38, -4);
    tongue.lineBetween(snake.headRadius * 1.18, 0, snake.headRadius * 1.38, 4);
    container.add(tongue);

    const hpBg = this.add.rectangle(snake.x - 28, snake.y - snake.headRadius - 18, 60, 7, 0x09100c, 0.78)
      .setOrigin(0, 0.5)
      .setDepth(31)
      .setVisible(false);
    const hpFill = this.add.rectangle(snake.x - 26, snake.y - snake.headRadius - 18, 56, 3, 0x9edb6c, 1)
      .setOrigin(0, 0.5)
      .setDepth(32)
      .setVisible(false);

    return { container, segments, head, volatileSacs, hpBg, hpFill, target: snake };
  }

  private updateSnakeVisuals(time: number) {
    for (const visual of this.snakeVisuals.values()) {
      const snake = visual.target;
      visual.container.x = Phaser.Math.Linear(visual.container.x, snake.x, 0.32);
      visual.container.y = Phaser.Math.Linear(visual.container.y, snake.y, 0.32);
      visual.container.rotation = Phaser.Math.Angle.RotateTo(visual.container.rotation, snake.rotation, 0.15);

      const segmentCount = visual.segments.length;
      const spacing = snake.length / segmentCount;
      for (let j = 0; j < segmentCount; j++) {
        const i = segmentCount - j;
        const segment = visual.segments[j];
        const wave = Math.sin(time * 0.009 + snake.seed + i * 0.9) * snake.bodyRadius * 0.42;
        segment.x = -spacing * i;
        segment.y = wave;
      }

      for (let i = 0; i < visual.volatileSacs.length; i++) {
        const sac = visual.volatileSacs[i];
        const segmentIndex = [6, 4, 2][i] ?? 2;
        sac.y = Math.sin(time * 0.009 + snake.seed + segmentIndex * 0.9) * snake.bodyRadius * 0.42;
        const pulse = 1 + Math.sin(time * 0.012 + i) * 0.18;
        sac.setScale(pulse);
        sac.alpha = 0.68 + Math.sin(time * 0.014 + i) * 0.24;
      }

      visual.hpBg.x = visual.container.x - 30;
      visual.hpBg.y = visual.container.y - snake.headRadius - 19;
      visual.hpFill.x = visual.container.x - 28;
      visual.hpFill.y = visual.container.y - snake.headRadius - 19;
    }
  }

  private destroySnakeVisual(visual: SnakeVisual) {
    visual.container.destroy(true);
    visual.hpBg.destroy();
    visual.hpFill.destroy();
  }

  private createCashVisual(crate: CashCrateSnapshot): CashVisual {
    const container = this.add.container(crate.x, crate.y).setDepth(15);
    const beam = this.add.rectangle(0, -47, 8, 82, 0xffd45c, 0.12);
    const glow = this.add.circle(0, 0, 33, 0xffd45c, 0.12);
    const shadow = this.add.ellipse(5, 10, 48, 25, 0x080d09, 0.33);
    const box = this.add.rectangle(0, 0, 39, 31, 0xc78a2a, 1);
    box.setStrokeStyle(3, 0xffdc78, 0.8);
    const strap = this.add.rectangle(0, 0, 8, 31, 0x6d461f, 0.85);
    const cashText = this.add.text(0, -1, "$", {
      fontFamily: "Arial Black, Arial",
      fontSize: "21px",
      color: "#fff1a7",
      stroke: "#624317",
      strokeThickness: 3,
    }).setOrigin(0.5);
    const valueText = this.add.text(0, 27, `$${crate.value}`, {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#ffe39a",
      stroke: "#11170f",
      strokeThickness: 3,
    }).setOrigin(0.5);
    const timer = this.add.text(0, 43, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "10px",
      fontStyle: "bold",
      color: "#f0eee0",
      stroke: "#10140f",
      strokeThickness: 3,
    }).setOrigin(0.5);
    container.add([beam, glow, shadow, box, strap, cashText, valueText, timer]);
    return { container, timer, target: crate };
  }

  private updateCashVisuals(time: number) {
    for (const visual of this.cashVisuals.values()) {
      const crate = visual.target;
      visual.container.x = crate.x;
      visual.container.y = crate.y + Math.sin(time * 0.004 + crate.id) * 3;
      const urgent = crate.timeLeftMs < 3000;
      visual.timer.setText(`${Math.max(0, crate.timeLeftMs / 1000).toFixed(1)}s`);
      visual.timer.setColor(urgent ? "#ff8372" : "#f0eee0");
      visual.container.alpha = urgent ? 0.72 + Math.sin(time * 0.02) * 0.24 : 1;
    }
  }

  private drawObstacle(obstacle: ObstacleSnapshot) {
    if (this.obstacleIds.has(obstacle.id)) return;
    this.obstacleIds.add(obstacle.id);

    const shadow = this.add.ellipse(
      obstacle.x + 8,
      obstacle.y + 12,
      obstacle.radius * 2.05,
      obstacle.radius * 1.25,
      0x09100c,
      0.36,
    ).setDepth(8);
    shadow.rotation = obstacle.id * 0.31;

    const g = this.add.graphics().setPosition(obstacle.x, obstacle.y).setDepth(9);
    if (obstacle.type === "wreck") {
      g.fillStyle(0x3e473f, 1);
      g.fillRoundedRect(-obstacle.radius, -obstacle.radius * 0.48, obstacle.radius * 2, obstacle.radius * 0.96, 12);
      g.lineStyle(4, 0x171f19, 0.8);
      g.strokeRoundedRect(-obstacle.radius, -obstacle.radius * 0.48, obstacle.radius * 2, obstacle.radius * 0.96, 12);
      g.fillStyle(0x7a5a38, 0.75);
      g.fillRect(-obstacle.radius * 0.45, -obstacle.radius * 0.58, obstacle.radius * 0.9, obstacle.radius * 1.16);
      g.lineStyle(3, 0xb4834c, 0.28);
      g.lineBetween(-obstacle.radius * 0.75, -8, obstacle.radius * 0.72, 12);
    } else {
      g.fillStyle(0x2b352e, 1);
      g.fillCircle(0, 0, obstacle.radius);
      g.fillStyle(0x596052, 0.72);
      g.fillEllipse(-obstacle.radius * 0.18, -obstacle.radius * 0.25, obstacle.radius * 1.25, obstacle.radius * 0.8);
      g.lineStyle(3, 0x171e19, 0.62);
      g.strokeCircle(0, 0, obstacle.radius);
      g.lineStyle(3, 0x828778, 0.24);
      g.beginPath();
      g.moveTo(-obstacle.radius * 0.45, -obstacle.radius * 0.25);
      g.lineTo(-obstacle.radius * 0.1, 0);
      g.lineTo(obstacle.radius * 0.32, -obstacle.radius * 0.17);
      g.strokePath();
    }
  }

  private sendControls() {
    if (this.localRole === "driver") {
      const forward = this.keys.W.isDown || this.cursors.up.isDown;
      const reverse = this.keys.S.isDown || this.cursors.down.isDown;
      const left = this.keys.A.isDown || this.cursors.left.isDown;
      const right = this.keys.D.isDown || this.cursors.right.isDown;
      network.sendDrive(Number(forward) - Number(reverse), Number(right) - Number(left));
      if (this.lastFiring) {
        network.sendFiring(false);
        this.lastFiring = false;
      }
      return;
    }

    if (this.localRole === "gunner") {
      const pointer = this.input.activePointer;
      const angle = Phaser.Math.Angle.Between(this.tank.x, this.tank.y, pointer.worldX, pointer.worldY);
      network.sendAim(angle);

      const firing = pointer.isDown || this.keys.SPACE.isDown;
      if (firing !== this.lastFiring || firing) {
        network.sendFiring(firing);
        this.lastFiring = firing;
      }
    } else if (this.lastFiring) {
      network.sendFiring(false);
      this.lastFiring = false;
    }
  }

  private updateReticle() {
    const active = this.localRole === "gunner" && this.currentSnapshot?.phase === "combat";
    this.reticle.setVisible(active);
    if (!active) return;
    const pointer = this.input.activePointer;
    this.reticle.x = pointer.worldX;
    this.reticle.y = pointer.worldY;
    const pulse = 0.92 + Math.sin(this.time.now * 0.008) * 0.08;
    this.reticle.setScale(pulse);
  }

  private updateBlackout() {
    const active = this.currentSnapshot?.waveType === "BLACKOUT" && this.currentSnapshot.phase === "combat";
    this.blackoutOverlay.setVisible(active);
    this.blackoutDim.setVisible(active);
    this.blackoutEdge.setVisible(active);
    if (!active) return;

    const radius = 235;
    this.blackoutMaskShape.clear();
    this.blackoutMaskShape.fillStyle(0xffffff, 1);
    this.blackoutMaskShape.fillCircle(this.tank.x, this.tank.y, radius);

    this.blackoutEdge.clear();
    this.blackoutEdge.lineStyle(86, 0x010303, 0.38);
    this.blackoutEdge.strokeCircle(this.tank.x, this.tank.y, radius + 38);
    this.blackoutEdge.lineStyle(4, 0xb7c393, 0.04);
    this.blackoutEdge.strokeCircle(this.tank.x, this.tank.y, radius - 2);
  }

  private makeBullet(x: number, y: number) {
    const tail = this.add.ellipse(-8, 0, 22, 4, 0xffc94f, 0.2);
    const glow = this.add.circle(0, 0, 10, 0xf1c35d, 0.2);
    const core = this.add.circle(0, 0, 3.8, 0xffefb5, 1);
    return this.add.container(x, y, [tail, glow, core]).setDepth(27);
  }

  private playMuzzleFlash(x: number, y: number, angle: number) {
    const flash = this.add.graphics().setDepth(50);
    flash.x = x;
    flash.y = y;
    flash.rotation = angle;
    flash.fillStyle(0xffb73f, 0.9);
    flash.fillTriangle(0, 0, 34, -13, 25, 13);
    flash.fillStyle(0xfff1ae, 1);
    flash.fillCircle(1, 0, 6);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 1.45,
      scaleY: 1.45,
      duration: 75,
      onComplete: () => flash.destroy(),
    });

    for (let i = 0; i < 2; i++) {
      const spark = this.add.circle(
        x + Math.cos(angle) * Phaser.Math.Between(5, 18),
        y + Math.sin(angle) * Phaser.Math.Between(5, 18),
        Phaser.Math.Between(2, 4),
        0xffdf78,
        0.85,
      ).setDepth(49);
      this.tweens.add({
        targets: spark,
        x: spark.x + Math.cos(angle + Phaser.Math.FloatBetween(-0.45, 0.45)) * Phaser.Math.Between(20, 42),
        y: spark.y + Math.sin(angle + Phaser.Math.FloatBetween(-0.45, 0.45)) * Phaser.Math.Between(20, 42),
        alpha: 0,
        duration: Phaser.Math.Between(90, 150),
        onComplete: () => spark.destroy(),
      });
    }

    this.cameras.main.shake(38, 0.0011);
  }

  private playImpact(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const spark = this.add.circle(x, y, Phaser.Math.Between(2, 4), 0xe5d4ac, 0.8).setDepth(48);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(12, 38);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.3,
        duration: Phaser.Math.Between(100, 190),
        onComplete: () => spark.destroy(),
      });
    }
  }

  private playHit(x: number, y: number, damage: number, headshot: boolean) {
    if (headshot) audio.headshot();
    else audio.bodyHit();

    const color = headshot ? 0xffe36e : 0x8fd16f;
    const count = headshot ? 9 : 5;
    for (let i = 0; i < count; i++) {
      const drop = this.add.circle(x, y, Phaser.Math.Between(2, headshot ? 5 : 4), color, 0.75).setDepth(47);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(12, headshot ? 48 : 28);
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.25,
        duration: Phaser.Math.Between(150, 290),
        onComplete: () => drop.destroy(),
      });
    }

    const text = this.add.text(x, y - 14, headshot ? `HEADSHOT  ${damage}` : `${damage}`, {
      fontFamily: "Arial Black, Arial",
      fontSize: headshot ? "18px" : "13px",
      color: headshot ? "#ffe36e" : "#d8efc9",
      stroke: "#101710",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(55);

    this.tweens.add({
      targets: text,
      y: y - 55,
      alpha: 0,
      scale: headshot ? 1.12 : 0.9,
      duration: headshot ? 620 : 420,
      ease: "Cubic.Out",
      onComplete: () => text.destroy(),
    });
  }

  private playSnakeDeath(snakeId: number, x: number, y: number, exploded: boolean) {
    const visual = this.snakeVisuals.get(snakeId);
    if (visual) {
      this.snakeVisuals.delete(snakeId);
      visual.hpBg.destroy();
      visual.hpFill.destroy();
      this.tweens.add({
        targets: visual.container,
        alpha: 0,
        scaleX: 1.15,
        scaleY: 0.55,
        duration: exploded ? 90 : 250,
        onComplete: () => visual.container.destroy(true),
      });
    }

    if (exploded) return;
    for (let i = 0; i < 8; i++) {
      const splat = this.add.circle(x, y, Phaser.Math.Between(3, 7), 0x3b773b, 0.72).setDepth(13);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(18, 60);
      this.tweens.add({
        targets: splat,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.5,
        duration: Phaser.Math.Between(280, 520),
        onComplete: () => splat.destroy(),
      });
    }
  }

  private playExplosion(x: number, y: number, radius: number) {
    const core = this.add.circle(x, y, 18, 0xfff1aa, 0.95).setDepth(65);
    const fire = this.add.circle(x, y, 28, 0xff8c2d, 0.76).setDepth(64);
    const shock = this.add.circle(x, y, 24, 0xffc45d, 0).setStrokeStyle(6, 0xffc45d, 0.8).setDepth(63);

    this.tweens.add({ targets: core, scale: 2.7, alpha: 0, duration: 150, onComplete: () => core.destroy() });
    this.tweens.add({ targets: fire, scale: 3.8, alpha: 0, duration: 260, onComplete: () => fire.destroy() });
    this.tweens.add({
      targets: shock,
      scale: radius / 24,
      alpha: 0,
      duration: 320,
      ease: "Quad.Out",
      onComplete: () => shock.destroy(),
    });

    for (let i = 0; i < 18; i++) {
      const ember = this.add.circle(x, y, Phaser.Math.Between(2, 6), i % 3 === 0 ? 0xffe29a : 0xff7832, 0.9).setDepth(66);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(35, Math.round(radius));
      this.tweens.add({
        targets: ember,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.25,
        duration: Phaser.Math.Between(240, 520),
        ease: "Cubic.Out",
        onComplete: () => ember.destroy(),
      });
    }

    this.cameras.main.shake(150, 0.0065);
  }

  private playTankHit(amount: number, source: string) {
    const flash = this.add.rectangle(800, 450, 1600, 900, 0xa91616, source === "explosion" ? 0.2 : 0.12).setDepth(95);
    this.tweens.add({ targets: flash, alpha: 0, duration: 190, onComplete: () => flash.destroy() });
    this.cameras.main.shake(source === "explosion" ? 170 : 90, source === "explosion" ? 0.009 : 0.0045);

    const text = this.add.text(this.tank.x, this.tank.y - 65, `-${amount} HP`, {
      fontFamily: "Arial Black, Arial",
      fontSize: "17px",
      color: "#ff8a76",
      stroke: "#180b09",
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(70);
    this.tweens.add({ targets: text, y: text.y - 38, alpha: 0, duration: 650, onComplete: () => text.destroy() });
  }

  private playCashPickup(x: number, y: number, value: number) {
    const text = this.add.text(x, y - 15, `+$${value}`, {
      fontFamily: "Arial Black, Arial",
      fontSize: "22px",
      color: "#ffd969",
      stroke: "#30200b",
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(60);
    this.tweens.add({
      targets: text,
      y: y - 72,
      alpha: 0,
      scale: 1.18,
      duration: 720,
      ease: "Cubic.Out",
      onComplete: () => text.destroy(),
    });

    for (let i = 0; i < 7; i++) {
      const coin = this.add.circle(x, y, 4, 0xffd35f, 0.9).setStrokeStyle(1, 0xfff1ae, 0.8).setDepth(58);
      const angle = Phaser.Math.FloatBetween(-Math.PI, 0);
      const distance = Phaser.Math.Between(25, 65);
      this.tweens.add({
        targets: coin,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance + Phaser.Math.Between(-20, 10),
        alpha: 0,
        duration: Phaser.Math.Between(380, 650),
        onComplete: () => coin.destroy(),
      });
    }
  }

  private updateDust(delta: number) {
    if (this.localRole !== "driver" || this.currentSnapshot?.phase !== "combat") return;
    const moving = this.keys.W.isDown || this.keys.S.isDown || this.cursors.up.isDown || this.cursors.down.isDown;
    if (!moving) return;

    this.dustTimer -= delta;
    if (this.dustTimer > 0) return;
    this.dustTimer = 78;

    for (const trackOffset of [-21, 21]) {
      const rearX = this.tank.x - Math.cos(this.tank.rotation) * 46 - Math.sin(this.tank.rotation) * trackOffset;
      const rearY = this.tank.y - Math.sin(this.tank.rotation) * 46 + Math.cos(this.tank.rotation) * trackOffset;
      const dust = this.add.circle(
        rearX + Phaser.Math.Between(-5, 5),
        rearY + Phaser.Math.Between(-5, 5),
        Phaser.Math.Between(4, 9),
        0xc6b98f,
        0.18,
      ).setDepth(7);

      this.tweens.add({
        targets: dust,
        alpha: 0,
        scale: 2.5,
        x: dust.x - Math.cos(this.tank.rotation) * 22,
        y: dust.y - Math.sin(this.tank.rotation) * 22,
        duration: 440,
        onComplete: () => dust.destroy(),
      });
    }
  }
}
