import { Client, Room } from "colyseus";

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 900;
const BASE_TANK_SPEED = 285;
const BASE_TANK_REVERSE_SPEED = 185;
const BASE_TANK_TURN_SPEED = 2.45;
const TANK_RADIUS = 36;
const BASE_TANK_MAX_HEALTH = 100;
const BASE_BULLET_SPEED = 1040;
const BULLET_RADIUS = 5;
const BULLET_LIFETIME_MS = 1750;
const BASE_FIRE_INTERVAL_MS = 205;
const BASE_BODY_DAMAGE = 12;
const HEADSHOT_MULTIPLIER = 4;
const SHOP_SECONDS = 24;
const SNAPSHOT_INTERVAL_MS = 50;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const OBSTACLES = [
  { id: 1, x: 310, y: 235, radius: 52, type: "rock" },
  { id: 2, x: 1295, y: 220, radius: 48, type: "rock" },
  { id: 3, x: 520, y: 665, radius: 58, type: "wreck" },
  { id: 4, x: 1125, y: 665, radius: 55, type: "wreck" },
  { id: 5, x: 790, y: 185, radius: 42, type: "rock" },
  { id: 6, x: 835, y: 735, radius: 46, type: "rock" },
];

type Role = "driver" | "gunner";
type Phase = "waiting" | "combat" | "intermission" | "gameover";
type WaveType =
  | "NORMAL"
  | "BONUS_MONEY"
  | "VOLATILE_SNAKES"
  | "BLACKOUT"
  | "FRENZY"
  | "TITAN_NEST";

type UpgradeId =
  | "AP_AMMO"
  | "AUTOLOADER"
  | "ENGINE"
  | "ARMOR"
  | "HV_SHELLS"
  | "SCAVENGER";

interface UpgradeDefinition {
  id: UpgradeId;
  name: string;
  shortName: string;
  description: string;
  baseCost: number;
  costGrowth: number;
  maxLevel: number;
}

const UPGRADE_DEFINITIONS: UpgradeDefinition[] = [
  {
    id: "AP_AMMO",
    name: "AP Ammunition",
    shortName: "DAMAGE",
    description: "Higher shell damage while preserving the 4× headshot reward.",
    baseCost: 240,
    costGrowth: 1.5,
    maxLevel: 8,
  },
  {
    id: "AUTOLOADER",
    name: "Autoloader",
    shortName: "FIRE RATE",
    description: "Cycles the cannon faster for higher sustained damage.",
    baseCost: 280,
    costGrowth: 1.54,
    maxLevel: 7,
  },
  {
    id: "ENGINE",
    name: "Engine Tune",
    shortName: "MOBILITY",
    description: "Improves forward speed, reverse speed and steering response.",
    baseCost: 220,
    costGrowth: 1.5,
    maxLevel: 7,
  },
  {
    id: "ARMOR",
    name: "Reinforced Armour",
    shortName: "SURVIVABILITY",
    description: "Adds maximum integrity and immediately restores the added armour.",
    baseCost: 330,
    costGrowth: 1.58,
    maxLevel: 6,
  },
  {
    id: "HV_SHELLS",
    name: "High-Velocity Shells",
    shortName: "BALLISTICS",
    description: "Faster shells make distant headshots easier and more responsive.",
    baseCost: 180,
    costGrowth: 1.47,
    maxLevel: 6,
  },
  {
    id: "SCAVENGER",
    name: "Scavenger Rig",
    shortName: "ECONOMY",
    description: "Increases crate value and pickup radius, rewarding risky collections.",
    baseCost: 240,
    costGrowth: 1.52,
    maxLevel: 5,
  },
];

interface PlayerInfo {
  sessionId: string;
  name: string;
  role: Role;
}

interface DriveInput {
  throttle: number;
  turn: number;
}

interface GunInput {
  angle: number;
  firing: boolean;
}

interface Bullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
}

interface SnakeEnemy {
  id: number;
  x: number;
  y: number;
  rotation: number;
  speed: number;
  turnSpeed: number;
  hp: number;
  maxHp: number;
  headRadius: number;
  bodyRadius: number;
  length: number;
  volatile: boolean;
  contactCooldownMs: number;
  seed: number;
}

interface CashCrate {
  id: number;
  x: number;
  y: number;
  value: number;
  timeLeftMs: number;
}

export class TankRoom extends Room {
  maxClients = 2;

  private readonly lobbyChannel = "$snake-tank-room-codes";
  private players = new Map<string, PlayerInfo>();
  private driveInputs = new Map<string, DriveInput>();
  private gunInputs = new Map<string, GunInput>();

  private tank = {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    rotation: -Math.PI / 2,
    turretRotation: -Math.PI / 2,
    health: BASE_TANK_MAX_HEALTH,
    maxHealth: BASE_TANK_MAX_HEALTH,
  };

  private bullets: Bullet[] = [];
  private snakes = new Map<number, SnakeEnemy>();
  private cashCrates = new Map<number, CashCrate>();
  private nextBulletId = 1;
  private nextSnakeId = 1;
  private nextCashId = 1;
  private fireCooldownMs = 0;
  private snapshotAccumulatorMs = 0;
  private spawnAccumulatorMs = 0;
  private cashSpawnAccumulatorMs = 0;
  private spawnRemaining = 0;
  private spawnIntervalMs = 420;
  private waveSpawnedTotal = 0;

  private phase: Phase = "waiting";
  private wave = 0;
  private waveType: WaveType = "NORMAL";
  private previousWaveType: WaveType = "NORMAL";
  private phaseTimeLeftMs = 0;
  private score = 0;
  private cash = 0;
  private cashCollected = 0;
  private kills = 0;
  private headshots = 0;
  private readyPlayers = new Set<string>();
  private upgradeLevels: Record<UpgradeId, number> = {
    AP_AMMO: 0,
    AUTOLOADER: 0,
    ENGINE: 0,
    ARMOR: 0,
    HV_SHELLS: 0,
    SCAVENGER: 0,
  };

  messages = {
    drive: (client: Client, payload: any) => {
      if (!this.isRole(client, "driver")) return;
      this.driveInputs.set(client.sessionId, {
        throttle: this.clamp(Number(payload?.throttle ?? 0), -1, 1),
        turn: this.clamp(Number(payload?.turn ?? 0), -1, 1),
      });
    },

    aim: (client: Client, payload: any) => {
      if (!this.isRole(client, "gunner")) return;
      const current = this.gunInputs.get(client.sessionId) ?? {
        angle: this.tank.turretRotation,
        firing: false,
      };
      const angle = Number(payload?.angle);
      if (Number.isFinite(angle)) current.angle = angle;
      this.gunInputs.set(client.sessionId, current);
    },

    firing: (client: Client, payload: any) => {
      if (!this.isRole(client, "gunner")) return;
      const current = this.gunInputs.get(client.sessionId) ?? {
        angle: this.tank.turretRotation,
        firing: false,
      };
      current.firing = Boolean(payload?.firing);
      this.gunInputs.set(client.sessionId, current);
    },

    buy_upgrade: (client: Client, payload: any) => {
      if (this.phase !== "intermission" || !this.players.has(client.sessionId)) return;
      const id = String(payload?.id ?? "") as UpgradeId;
      this.purchaseUpgrade(client, id);
    },

    buy_repair: (client: Client) => {
      if (this.phase !== "intermission" || !this.players.has(client.sessionId)) return;
      this.purchaseRepair(client);
    },

    shop_ready: (client: Client, payload: any) => {
      if (this.phase !== "intermission" || !this.players.has(client.sessionId)) return;
      const ready = Boolean(payload?.ready);
      if (ready) this.readyPlayers.add(client.sessionId);
      else this.readyPlayers.delete(client.sessionId);
      this.broadcast("shop_ready_changed", {
        sessionId: client.sessionId,
        ready,
        readySessionIds: [...this.readyPlayers],
      });
      if (this.readyPlayers.size === this.players.size && this.players.size === 2) {
        this.startWave(this.wave + 1);
      }
    },

    restart: (_client: Client) => {
      if (this.phase !== "gameover" || this.players.size !== 2) return;
      this.resetRun();
      this.assignRandomStartingRoles();
      this.startWave(1);
    },
  };

  async onCreate() {
    this.roomId = await this.generateRoomId();
    this.setSimulationInterval((deltaMs) => this.updateGame(deltaMs), 1000 / 60);
  }

  onJoin(client: Client, options: any) {
    const name = this.cleanName(options?.name);

    this.players.set(client.sessionId, {
      sessionId: client.sessionId,
      name,
      role: "driver",
    });

    this.driveInputs.set(client.sessionId, { throttle: 0, turn: 0 });
    this.gunInputs.set(client.sessionId, {
      angle: this.tank.turretRotation,
      firing: false,
    });

    client.send("room_info", { roomId: this.roomId, sessionId: client.sessionId });

    if (this.players.size === 2) {
      this.lock();
      this.resetRun();
      this.assignRandomStartingRoles();
      this.startWave(1);
    }

    this.broadcastSnapshot();
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    this.driveInputs.delete(client.sessionId);
    this.gunInputs.delete(client.sessionId);
    this.readyPlayers.delete(client.sessionId);

    if (this.players.size < 2) {
      this.phase = "waiting";
      this.phaseTimeLeftMs = 0;
      this.bullets = [];
      this.snakes.clear();
      this.cashCrates.clear();
      this.spawnRemaining = 0;
      this.unlock();
    }

    this.broadcastSnapshot();
  }

  async onDispose() {
    await this.presence.srem(this.lobbyChannel, this.roomId);
  }

  private updateGame(deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;

    if (this.players.size === 2) {
      if (this.phase === "combat") {
        this.updateTank(dt);
        this.updateGun(deltaMs);
        this.updateSpawning(deltaMs);
        this.updateSnakes(deltaMs, dt);
        this.updateBullets(deltaMs, dt);
        this.updateCash(deltaMs);
        this.checkWaveComplete();
      } else if (this.phase === "intermission") {
        this.updateIntermission(deltaMs);
      }
    }

    this.snapshotAccumulatorMs += deltaMs;
    if (this.snapshotAccumulatorMs >= SNAPSHOT_INTERVAL_MS) {
      this.snapshotAccumulatorMs = 0;
      this.broadcastSnapshot();
    }
  }

  private resetRun() {
    this.tank.x = WORLD_WIDTH / 2;
    this.tank.y = WORLD_HEIGHT / 2;
    this.tank.rotation = -Math.PI / 2;
    this.tank.turretRotation = -Math.PI / 2;
    this.tank.maxHealth = BASE_TANK_MAX_HEALTH;
    this.tank.health = BASE_TANK_MAX_HEALTH;
    this.bullets = [];
    this.snakes.clear();
    this.cashCrates.clear();
    this.nextBulletId = 1;
    this.nextSnakeId = 1;
    this.nextCashId = 1;
    this.fireCooldownMs = 0;
    this.spawnAccumulatorMs = 0;
    this.cashSpawnAccumulatorMs = 0;
    this.spawnRemaining = 0;
    this.wave = 0;
    this.waveType = "NORMAL";
    this.previousWaveType = "NORMAL";
    this.score = 0;
    this.cash = 200;
    this.cashCollected = 0;
    this.kills = 0;
    this.headshots = 0;
    this.readyPlayers.clear();
    for (const definition of UPGRADE_DEFINITIONS) this.upgradeLevels[definition.id] = 0;
    this.phase = "waiting";
    this.phaseTimeLeftMs = 0;
    this.resetInputs();
  }

  private updateTank(dt: number) {
    const driver = [...this.players.values()].find((p) => p.role === "driver");
    if (!driver) return;

    const input = this.driveInputs.get(driver.sessionId) ?? { throttle: 0, turn: 0 };
    const stats = this.combatStats();
    const speed = input.throttle >= 0 ? stats.forwardSpeed : stats.reverseSpeed;

    this.tank.rotation += input.turn * stats.turnSpeed * dt * (Math.abs(input.throttle) > 0.05 ? 1 : 0.72);
    this.tank.x += Math.cos(this.tank.rotation) * input.throttle * speed * dt;
    this.tank.y += Math.sin(this.tank.rotation) * input.throttle * speed * dt;

    const margin = 54;
    this.tank.x = this.clamp(this.tank.x, margin, WORLD_WIDTH - margin);
    this.tank.y = this.clamp(this.tank.y, margin, WORLD_HEIGHT - margin);
    this.resolveTankObstacleCollisions();
  }

  private resolveTankObstacleCollisions() {
    for (const obstacle of OBSTACLES) {
      const dx = this.tank.x - obstacle.x;
      const dy = this.tank.y - obstacle.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minDistance = TANK_RADIUS + obstacle.radius;
      if (distance >= minDistance) continue;
      const push = minDistance - distance;
      this.tank.x += (dx / distance) * push;
      this.tank.y += (dy / distance) * push;
    }
  }

  private updateGun(deltaMs: number) {
    const gunner = [...this.players.values()].find((p) => p.role === "gunner");
    if (!gunner) return;

    const input = this.gunInputs.get(gunner.sessionId);
    if (!input) return;

    this.tank.turretRotation = input.angle;
    this.fireCooldownMs = Math.max(0, this.fireCooldownMs - deltaMs);

    if (input.firing && this.fireCooldownMs <= 0) {
      this.spawnBullet();
      this.fireCooldownMs = this.combatStats().fireIntervalMs;
    }
  }

  private spawnBullet() {
    const muzzleDistance = 72;
    const angle = this.tank.turretRotation;
    const x = this.tank.x + Math.cos(angle) * muzzleDistance;
    const y = this.tank.y + Math.sin(angle) * muzzleDistance;

    const bulletSpeed = this.combatStats().bulletSpeed;
    this.bullets.push({
      id: this.nextBulletId++,
      x,
      y,
      vx: Math.cos(angle) * bulletSpeed,
      vy: Math.sin(angle) * bulletSpeed,
      ageMs: 0,
    });

    this.broadcast("shot_fx", { x, y, angle });
  }

  private updateBullets(deltaMs: number, dt: number) {
    const survivors: Bullet[] = [];

    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      bullet.ageMs += deltaMs;

      if (bullet.ageMs >= BULLET_LIFETIME_MS || !this.isInsideWorld(bullet.x, bullet.y, 40)) continue;

      const obstacle = OBSTACLES.find(
        (o) => this.distanceSq(bullet.x, bullet.y, o.x, o.y) <= (o.radius + BULLET_RADIUS) ** 2,
      );
      if (obstacle) {
        this.broadcast("impact_fx", { x: bullet.x, y: bullet.y, kind: "obstacle" });
        continue;
      }

      const hit = this.findBulletHit(bullet);
      if (hit) {
        const stats = this.combatStats();
        this.damageSnake(
          hit.snake,
          hit.headshot ? stats.headDamage : stats.bodyDamage,
          hit.headshot,
          bullet.x,
          bullet.y,
        );
        continue;
      }

      survivors.push(bullet);
    }

    this.bullets = survivors;
  }

  private findBulletHit(bullet: Bullet) {
    for (const snake of this.snakes.values()) {
      if (this.distanceSq(bullet.x, bullet.y, snake.x, snake.y) <= (snake.headRadius + BULLET_RADIUS) ** 2) {
        return { snake, headshot: true };
      }

      const segments = 6;
      for (let i = 1; i <= segments; i++) {
        const along = (snake.length / segments) * i;
        const sx = snake.x - Math.cos(snake.rotation) * along;
        const sy = snake.y - Math.sin(snake.rotation) * along;
        if (this.distanceSq(bullet.x, bullet.y, sx, sy) <= (snake.bodyRadius + BULLET_RADIUS) ** 2) {
          return { snake, headshot: false };
        }
      }
    }
    return undefined;
  }

  private damageSnake(snake: SnakeEnemy, rawDamage: number, headshot: boolean, hitX: number, hitY: number) {
    if (!this.snakes.has(snake.id)) return;

    const damage = Math.min(rawDamage, snake.hp);
    snake.hp -= rawDamage;
    this.score += Math.round(damage * 2 + (headshot ? 22 : 0));
    if (headshot) this.headshots++;

    this.broadcast("hit_fx", {
      snakeId: snake.id,
      x: hitX,
      y: hitY,
      damage: rawDamage,
      headshot,
      hp: Math.max(0, snake.hp),
    });

    if (snake.volatile && this.waveType === "VOLATILE_SNAKES" && Math.random() < 0.12) {
      this.detonateSnake(snake, true);
      return;
    }

    if (snake.hp <= 0) this.killSnake(snake, "bullet");
  }

  private killSnake(snake: SnakeEnemy, cause: "bullet" | "blast") {
    if (!this.snakes.delete(snake.id)) return;

    this.kills++;
    this.score += 95 + this.wave * 14 + (cause === "blast" ? 35 : 0);

    const shouldExplode =
      snake.volatile && this.waveType === "VOLATILE_SNAKES" && cause !== "blast" && Math.random() < 0.48;

    this.broadcast("snake_death", {
      snakeId: snake.id,
      x: snake.x,
      y: snake.y,
      rotation: snake.rotation,
      volatile: snake.volatile,
      exploded: shouldExplode,
    });

    if (shouldExplode) this.explodeAt(snake.x, snake.y, snake.id);
  }

  private detonateSnake(snake: SnakeEnemy, fromHit: boolean) {
    if (!this.snakes.delete(snake.id)) return;
    this.kills++;
    this.score += 135 + this.wave * 16;
    this.broadcast("snake_death", {
      snakeId: snake.id,
      x: snake.x,
      y: snake.y,
      rotation: snake.rotation,
      volatile: true,
      exploded: true,
      fromHit,
    });
    this.explodeAt(snake.x, snake.y, snake.id);
  }

  private explodeAt(x: number, y: number, sourceSnakeId: number) {
    const radius = 125;
    const tankDistance = Math.hypot(this.tank.x - x, this.tank.y - y);
    let tankDamage = 0;

    if (tankDistance < radius + TANK_RADIUS) {
      const falloff = 1 - this.clamp(tankDistance / (radius + TANK_RADIUS), 0, 1);
      tankDamage = Math.max(5, Math.round((23 + this.wave * 0.7) * falloff));
      this.damageTank(tankDamage, "explosion", x, y);
    }

    this.broadcast("explosion_fx", { x, y, radius, tankDamage, sourceSnakeId });

    const nearby = [...this.snakes.values()].filter(
      (other) => this.distanceSq(x, y, other.x, other.y) < radius * radius,
    );

    for (const other of nearby) {
      if (!this.snakes.has(other.id)) continue;
      const distance = Math.hypot(other.x - x, other.y - y);
      const blastDamage = Math.round((115 + this.wave * 4) * (1 - distance / radius) + 20);
      other.hp -= blastDamage;
      if (other.hp <= 0) this.killSnake(other, "blast");
    }
  }

  private updateSpawning(deltaMs: number) {
    if (this.spawnRemaining <= 0) return;
    this.spawnAccumulatorMs -= deltaMs;
    if (this.spawnAccumulatorMs > 0) return;

    const burst = this.waveType === "FRENZY" && Math.random() < 0.28 ? 2 : 1;
    for (let i = 0; i < burst && this.spawnRemaining > 0; i++) {
      this.spawnSnake();
      this.spawnRemaining--;
      this.waveSpawnedTotal++;
    }
    this.spawnAccumulatorMs = this.spawnIntervalMs;
  }

  private spawnSnake() {
    const stats = this.waveStats();
    const spawn = this.randomEdgeSpawn();
    const angleToTank = Math.atan2(this.tank.y - spawn.y, this.tank.x - spawn.x);
    const id = this.nextSnakeId++;

    this.snakes.set(id, {
      id,
      x: spawn.x,
      y: spawn.y,
      rotation: angleToTank + this.randomRange(-0.25, 0.25),
      speed: stats.speed * this.randomRange(0.9, 1.1),
      turnSpeed: this.randomRange(2.3, 3.2),
      hp: stats.hp,
      maxHp: stats.hp,
      headRadius: stats.headRadius,
      bodyRadius: stats.bodyRadius,
      length: stats.length,
      volatile: this.waveType === "VOLATILE_SNAKES" && Math.random() < 0.72,
      contactCooldownMs: this.randomRange(0, 250),
      seed: Math.random() * Math.PI * 2,
    });
  }

  private waveStats() {
    const level = Math.max(0, this.wave - 1);
    let count = Math.min(44, 7 + Math.floor(this.wave * 1.75));
    let hp = Math.min(720, Math.round(54 * Math.pow(1.145, level)));
    let speed = Math.min(175, 88 + level * 4.4);
    let headRadius = Math.max(9.5, 27 - level * 1.12);
    let bodyRadius = Math.min(23, 11 + level * 0.72);
    let length = Math.min(155, 92 + level * 3.2);

    if (this.waveType === "FRENZY") {
      count = Math.min(54, Math.round(count * 1.55));
      hp = Math.round(hp * 0.62);
      speed *= 1.28;
      headRadius *= 0.88;
      bodyRadius *= 0.84;
      length *= 0.86;
    } else if (this.waveType === "TITAN_NEST") {
      count = Math.max(4, Math.round(count * 0.46));
      hp = Math.round(hp * 2.25);
      speed *= 0.8;
      headRadius *= 1.12;
      bodyRadius *= 1.5;
      length *= 1.26;
    }

    return {
      count,
      hp,
      speed,
      headRadius,
      bodyRadius,
      length,
    };
  }

  private updateSnakes(deltaMs: number, dt: number) {
    const snakes = [...this.snakes.values()];

    for (const snake of snakes) {
      if (!this.snakes.has(snake.id)) continue;
      snake.contactCooldownMs = Math.max(0, snake.contactCooldownMs - deltaMs);

      let desiredX = this.tank.x - snake.x;
      let desiredY = this.tank.y - snake.y;
      const targetLength = Math.hypot(desiredX, desiredY) || 1;
      desiredX /= targetLength;
      desiredY /= targetLength;

      // Horde separation keeps enemies readable and prevents one impossible blob.
      let sepX = 0;
      let sepY = 0;
      for (const other of snakes) {
        if (other.id === snake.id) continue;
        const dx = snake.x - other.x;
        const dy = snake.y - other.y;
        const d2 = dx * dx + dy * dy;
        const separationRange = Math.max(50, (snake.bodyRadius + other.bodyRadius) * 2.2);
        if (d2 <= 1 || d2 > separationRange * separationRange) continue;
        const d = Math.sqrt(d2);
        const strength = (separationRange - d) / separationRange;
        sepX += (dx / d) * strength;
        sepY += (dy / d) * strength;
      }

      let avoidX = 0;
      let avoidY = 0;
      for (const obstacle of OBSTACLES) {
        const dx = snake.x - obstacle.x;
        const dy = snake.y - obstacle.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const avoidRange = obstacle.radius + snake.bodyRadius + 75;
        if (d >= avoidRange) continue;
        const strength = (avoidRange - d) / avoidRange;
        avoidX += (dx / d) * strength * 2.25;
        avoidY += (dy / d) * strength * 2.25;
      }

      const steerX = desiredX + sepX * 0.78 + avoidX;
      const steerY = desiredY + sepY * 0.78 + avoidY;
      const desiredAngle = Math.atan2(steerY, steerX);
      snake.rotation = this.rotateTowards(snake.rotation, desiredAngle, snake.turnSpeed * dt);

      snake.x += Math.cos(snake.rotation) * snake.speed * dt;
      snake.y += Math.sin(snake.rotation) * snake.speed * dt;
      snake.x = this.clamp(snake.x, 24, WORLD_WIDTH - 24);
      snake.y = this.clamp(snake.y, 24, WORLD_HEIGHT - 24);
      this.resolveSnakeObstacleCollisions(snake);

      const tankDistance = Math.hypot(this.tank.x - snake.x, this.tank.y - snake.y);
      if (tankDistance < TANK_RADIUS + snake.headRadius + 5 && snake.contactCooldownMs <= 0) {
        const damage = Math.min(15, 5 + Math.floor(this.wave * 0.52));
        this.damageTank(damage, "bite", snake.x, snake.y);
        snake.contactCooldownMs = 720;

        const pushAngle = Math.atan2(snake.y - this.tank.y, snake.x - this.tank.x);
        snake.x += Math.cos(pushAngle) * 26;
        snake.y += Math.sin(pushAngle) * 26;
      }
    }
  }

  private resolveSnakeObstacleCollisions(snake: SnakeEnemy) {
    for (const obstacle of OBSTACLES) {
      const dx = snake.x - obstacle.x;
      const dy = snake.y - obstacle.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const minDistance = obstacle.radius + snake.bodyRadius + 4;
      if (distance >= minDistance) continue;
      const push = minDistance - distance;
      snake.x += (dx / distance) * push;
      snake.y += (dy / distance) * push;
      snake.rotation += this.randomRange(-0.25, 0.25);
    }
  }

  private damageTank(amount: number, source: "bite" | "explosion", x: number, y: number) {
    if (this.phase !== "combat" || this.tank.health <= 0) return;
    this.tank.health = Math.max(0, this.tank.health - amount);
    this.broadcast("tank_hit", { amount, source, x, y, health: this.tank.health });

    if (this.tank.health <= 0) this.endGame();
  }

  private updateCash(deltaMs: number) {
    const spawnEvery = this.waveType === "BONUS_MONEY" ? 4300 : 12800;
    this.cashSpawnAccumulatorMs += deltaMs;
    if (this.cashSpawnAccumulatorMs >= spawnEvery) {
      this.cashSpawnAccumulatorMs = 0;
      this.spawnCashCrate(this.waveType === "BONUS_MONEY" ? 1.4 : 1);
      if (this.waveType === "BONUS_MONEY" && Math.random() < 0.35) this.spawnCashCrate(1.15);
    }

    for (const crate of [...this.cashCrates.values()]) {
      crate.timeLeftMs -= deltaMs;
      if (crate.timeLeftMs <= 0) {
        this.cashCrates.delete(crate.id);
        continue;
      }

      const pickupRadius = this.combatStats().pickupRadius;
      if (this.distanceSq(crate.x, crate.y, this.tank.x, this.tank.y) <= pickupRadius * pickupRadius) {
        this.cashCrates.delete(crate.id);
        this.cash += crate.value;
        this.cashCollected += crate.value;
        this.score += crate.value;
        this.broadcast("cash_pickup", { x: crate.x, y: crate.y, value: crate.value, cash: this.cash });
      }
    }
  }

  private spawnCashCrate(multiplier = 1) {
    const position = this.randomSafePoint(175);
    const baseValue = 85 + this.wave * 15;
    const economyMultiplier = this.combatStats().cashValueMultiplier;
    const value = Math.round((baseValue * multiplier * economyMultiplier) / 5) * 5;
    const id = this.nextCashId++;
    this.cashCrates.set(id, {
      id,
      x: position.x,
      y: position.y,
      value,
      timeLeftMs: this.waveType === "BONUS_MONEY" ? 10500 : 9000,
    });
  }

  private checkWaveComplete() {
    if (this.phase !== "combat" || this.spawnRemaining > 0 || this.snakes.size > 0) return;

    this.score += this.wave * 450;
    const healthBeforeRepair = this.tank.health;
    this.tank.health = Math.min(this.tank.maxHealth, this.tank.health + 5);
    const repairAmount = Math.round(this.tank.health - healthBeforeRepair);
    this.phase = "intermission";
    this.phaseTimeLeftMs = SHOP_SECONDS * 1000;
    this.bullets = [];
    this.cashCrates.clear();
    this.readyPlayers.clear();
    this.swapRoles();
    this.resetInputs();
    this.broadcast("wave_complete", {
      wave: this.wave,
      score: this.score,
      cash: this.cash,
      repair: repairAmount,
      shopSeconds: SHOP_SECONDS,
    });
  }

  private updateIntermission(deltaMs: number) {
    this.phaseTimeLeftMs -= deltaMs;
    if (this.phaseTimeLeftMs <= 0) this.startWave(this.wave + 1);
  }

  private startWave(wave: number) {
    this.wave = wave;
    this.previousWaveType = this.waveType;
    this.waveType = this.pickWaveType(wave);
    this.phase = "combat";
    this.phaseTimeLeftMs = 0;
    this.bullets = [];
    this.snakes.clear();
    this.cashCrates.clear();
    this.fireCooldownMs = 0;
    this.spawnAccumulatorMs = 0;
    this.cashSpawnAccumulatorMs = this.waveType === "BONUS_MONEY" ? 0 : 6000;
    this.readyPlayers.clear();
    this.resetInputs();

    const stats = this.waveStats();
    this.spawnRemaining = stats.count;
    this.waveSpawnedTotal = 0;
    this.spawnIntervalMs = Math.max(245, 470 - this.wave * 12);

    if (this.waveType === "BONUS_MONEY") {
      this.spawnCashCrate(1.45);
      this.spawnCashCrate(1.25);
      this.spawnCashCrate(1.25);
    }

    this.broadcast("wave_start", {
      wave: this.wave,
      waveType: this.waveType,
      count: stats.count,
      hp: stats.hp,
      headRadius: Number(stats.headRadius.toFixed(1)),
    });
  }

  private endGame() {
    this.phase = "gameover";
    this.phaseTimeLeftMs = 0;
    this.bullets = [];
    this.resetInputs();
    this.broadcast("game_over", {
      wave: this.wave,
      score: this.score,
      cash: this.cash,
      cashCollected: this.cashCollected,
      kills: this.kills,
      headshots: this.headshots,
      upgrades: { ...this.upgradeLevels },
    });
  }

  private purchaseUpgrade(client: Client, id: UpgradeId) {
    const definition = UPGRADE_DEFINITIONS.find((item) => item.id === id);
    if (!definition) {
      client.send("purchase_denied", { reason: "Unknown upgrade." });
      return;
    }

    const level = this.upgradeLevels[id];
    if (level >= definition.maxLevel) {
      client.send("purchase_denied", { reason: `${definition.name} is already max level.` });
      return;
    }

    const cost = this.upgradeCost(definition, level);
    if (this.cash < cost) {
      client.send("purchase_denied", { reason: `Need $${cost.toLocaleString()} — team cash is $${this.cash.toLocaleString()}.` });
      return;
    }

    const oldMaxHealth = this.tank.maxHealth;
    this.cash -= cost;
    this.upgradeLevels[id] = level + 1;
    this.readyPlayers.delete(client.sessionId);

    if (id === "ARMOR") {
      const newMaxHealth = this.combatStats().maxHealth;
      this.tank.maxHealth = newMaxHealth;
      this.tank.health = Math.min(newMaxHealth, this.tank.health + (newMaxHealth - oldMaxHealth));
    }

    const player = this.players.get(client.sessionId);
    this.broadcast("upgrade_purchased", {
      id,
      name: definition.name,
      level: this.upgradeLevels[id],
      cost,
      cash: this.cash,
      purchaser: player?.name ?? "Player",
      effect: this.describeUpgrade(id, this.upgradeLevels[id]),
    });
  }

  private purchaseRepair(client: Client) {
    const repair = this.repairSnapshot();
    if (this.tank.health >= this.tank.maxHealth - 0.5) {
      client.send("purchase_denied", { reason: "Tank integrity is already full." });
      return;
    }
    if (this.cash < repair.cost) {
      client.send("purchase_denied", { reason: `Need $${repair.cost.toLocaleString()} for field repair.` });
      return;
    }

    const before = this.tank.health;
    this.cash -= repair.cost;
    this.tank.health = Math.min(this.tank.maxHealth, this.tank.health + repair.restore);
    const restored = Math.round(this.tank.health - before);
    this.readyPlayers.delete(client.sessionId);
    const player = this.players.get(client.sessionId);

    this.broadcast("repair_purchased", {
      restored,
      cost: repair.cost,
      cash: this.cash,
      purchaser: player?.name ?? "Player",
      health: this.tank.health,
      maxHealth: this.tank.maxHealth,
    });
  }

  private upgradeCost(definition: UpgradeDefinition, level: number) {
    return Math.round((definition.baseCost * Math.pow(definition.costGrowth, level)) / 5) * 5;
  }

  private repairSnapshot() {
    const cost = Math.round((165 + this.wave * 22) / 5) * 5;
    return {
      cost,
      restore: 35,
      canBuy: this.phase === "intermission" && this.cash >= cost && this.tank.health < this.tank.maxHealth - 0.5,
    };
  }

  private upgradeSnapshot() {
    return UPGRADE_DEFINITIONS.map((definition) => {
      const level = this.upgradeLevels[definition.id];
      const maxed = level >= definition.maxLevel;
      return {
        id: definition.id,
        name: definition.name,
        shortName: definition.shortName,
        description: definition.description,
        level,
        maxLevel: definition.maxLevel,
        maxed,
        cost: maxed ? null : this.upgradeCost(definition, level),
        currentEffect: this.describeUpgrade(definition.id, level),
        nextEffect: maxed ? "MAXIMUM" : this.describeUpgrade(definition.id, level + 1),
      };
    });
  }

  private combatStats() {
    const apLevel = this.upgradeLevels.AP_AMMO;
    const loaderLevel = this.upgradeLevels.AUTOLOADER;
    const engineLevel = this.upgradeLevels.ENGINE;
    const armorLevel = this.upgradeLevels.ARMOR;
    const shellLevel = this.upgradeLevels.HV_SHELLS;
    const scavengerLevel = this.upgradeLevels.SCAVENGER;

    const bodyDamage = Math.round(BASE_BODY_DAMAGE * (1 + apLevel * 0.18));
    return {
      bodyDamage,
      headDamage: bodyDamage * HEADSHOT_MULTIPLIER,
      headshotMultiplier: HEADSHOT_MULTIPLIER,
      fireIntervalMs: Math.round(Math.max(88, BASE_FIRE_INTERVAL_MS * Math.pow(0.9, loaderLevel))),
      forwardSpeed: Math.round(BASE_TANK_SPEED * (1 + engineLevel * 0.075)),
      reverseSpeed: Math.round(BASE_TANK_REVERSE_SPEED * (1 + engineLevel * 0.075)),
      turnSpeed: Number((BASE_TANK_TURN_SPEED * (1 + engineLevel * 0.045)).toFixed(3)),
      maxHealth: BASE_TANK_MAX_HEALTH + armorLevel * 25,
      bulletSpeed: Math.round(BASE_BULLET_SPEED * (1 + shellLevel * 0.11)),
      pickupRadius: Math.round(54 * (1 + scavengerLevel * 0.14)),
      cashValueMultiplier: Number((1 + scavengerLevel * 0.1).toFixed(2)),
    };
  }

  private describeUpgrade(id: UpgradeId, level: number) {
    if (id === "AP_AMMO") {
      const body = Math.round(BASE_BODY_DAMAGE * (1 + level * 0.18));
      return `${body} body / ${body * HEADSHOT_MULTIPLIER} head damage`;
    }
    if (id === "AUTOLOADER") {
      const interval = Math.round(Math.max(88, BASE_FIRE_INTERVAL_MS * Math.pow(0.9, level)));
      return `${(1000 / interval).toFixed(1)} rounds/sec`;
    }
    if (id === "ENGINE") {
      const speed = Math.round(BASE_TANK_SPEED * (1 + level * 0.075));
      const turn = BASE_TANK_TURN_SPEED * (1 + level * 0.045);
      return `${speed} speed / ${turn.toFixed(2)} steering`;
    }
    if (id === "ARMOR") return `${BASE_TANK_MAX_HEALTH + level * 25} max integrity`;
    if (id === "HV_SHELLS") return `${Math.round(BASE_BULLET_SPEED * (1 + level * 0.11))} shell velocity`;
    const cashBonus = level * 10;
    const radius = Math.round(54 * (1 + level * 0.14));
    return `+${cashBonus}% crate value / ${radius} pickup radius`;
  }

  private assignRandomStartingRoles() {
    const list = [...this.players.values()];
    const driverIndex = Math.random() < 0.5 ? 0 : 1;
    list[driverIndex].role = "driver";
    list[1 - driverIndex].role = "gunner";
    this.resetInputs();
    this.broadcast("roles_assigned", this.rolePayload());
  }

  private swapRoles() {
    for (const player of this.players.values()) {
      player.role = player.role === "driver" ? "gunner" : "driver";
    }
    this.broadcast("roles_swapped", this.rolePayload());
  }

  private pickWaveType(wave: number): WaveType {
    if (wave < 3) return "NORMAL";
    const specialChance = wave >= 8 ? 0.36 : 0.3;
    if (Math.random() > specialChance) return "NORMAL";

    const specials: WaveType[] = [
      "BONUS_MONEY",
      "VOLATILE_SNAKES",
      "BLACKOUT",
      "FRENZY",
      "TITAN_NEST",
    ];
    const filtered = specials.filter((type) => type !== this.previousWaveType);
    return filtered[Math.floor(Math.random() * filtered.length)];
  }

  private resetInputs() {
    for (const id of this.players.keys()) {
      this.driveInputs.set(id, { throttle: 0, turn: 0 });
      this.gunInputs.set(id, {
        angle: this.tank.turretRotation,
        firing: false,
      });
    }
  }

  private isRole(client: Client, role: Role) {
    return this.players.get(client.sessionId)?.role === role;
  }

  private rolePayload() {
    return [...this.players.values()].map((p) => ({
      sessionId: p.sessionId,
      name: p.name,
      role: p.role,
    }));
  }

  private broadcastSnapshot() {
    this.broadcast("snapshot", {
      roomId: this.roomId,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      players: this.rolePayload(),
      tank: { ...this.tank },
      bullets: this.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, angle: Math.atan2(b.vy, b.vx) })),
      snakes: [...this.snakes.values()].map((s) => ({
        id: s.id,
        x: s.x,
        y: s.y,
        rotation: s.rotation,
        hp: Math.max(0, s.hp),
        maxHp: s.maxHp,
        headRadius: s.headRadius,
        bodyRadius: s.bodyRadius,
        length: s.length,
        volatile: s.volatile,
        seed: s.seed,
      })),
      cashCrates: [...this.cashCrates.values()].map((c) => ({ ...c })),
      obstacles: OBSTACLES,
      phase: this.phase,
      wave: this.wave,
      waveType: this.waveType,
      timeLeftMs: Math.max(0, this.phaseTimeLeftMs),
      snakesRemaining: this.snakes.size + this.spawnRemaining,
      snakesAlive: this.snakes.size,
      score: this.score,
      cash: this.cash,
      cashCollected: this.cashCollected,
      kills: this.kills,
      headshots: this.headshots,
      readySessionIds: [...this.readyPlayers],
      upgrades: this.upgradeSnapshot(),
      combatStats: this.combatStats(),
      repair: this.repairSnapshot(),
    });
  }

  private randomEdgeSpawn() {
    const edge = Math.floor(Math.random() * 4);
    const inset = 28;
    if (edge === 0) return { x: this.randomRange(60, WORLD_WIDTH - 60), y: inset };
    if (edge === 1) return { x: WORLD_WIDTH - inset, y: this.randomRange(60, WORLD_HEIGHT - 60) };
    if (edge === 2) return { x: this.randomRange(60, WORLD_WIDTH - 60), y: WORLD_HEIGHT - inset };
    return { x: inset, y: this.randomRange(60, WORLD_HEIGHT - 60) };
  }

  private randomSafePoint(minTankDistance: number) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = this.randomRange(100, WORLD_WIDTH - 100);
      const y = this.randomRange(100, WORLD_HEIGHT - 100);
      if (Math.hypot(x - this.tank.x, y - this.tank.y) < minTankDistance) continue;
      if (OBSTACLES.some((o) => Math.hypot(x - o.x, y - o.y) < o.radius + 70)) continue;
      return { x, y };
    }
    return { x: 170, y: 170 };
  }

  private isInsideWorld(x: number, y: number, padding = 0) {
    return x >= -padding && y >= -padding && x <= WORLD_WIDTH + padding && y <= WORLD_HEIGHT + padding;
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  private rotateTowards(current: number, target: number, maxDelta: number) {
    let delta = this.normalizeAngle(target - current);
    delta = this.clamp(delta, -maxDelta, maxDelta);
    return this.normalizeAngle(current + delta);
  }

  private normalizeAngle(angle: number) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  private randomRange(min: number, max: number) {
    return min + Math.random() * (max - min);
  }

  private cleanName(value: unknown) {
    const name = String(value ?? "Player").trim().slice(0, 18);
    return name || "Player";
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0));
  }

  private generateRoomIdSingle() {
    let result = "";
    for (let i = 0; i < 4; i++) {
      result += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    return result;
  }

  private async generateRoomId() {
    const currentIds = await this.presence.smembers(this.lobbyChannel);
    let id = this.generateRoomIdSingle();
    while (currentIds.includes(id)) id = this.generateRoomIdSingle();
    await this.presence.sadd(this.lobbyChannel, id);
    return id;
  }
}
