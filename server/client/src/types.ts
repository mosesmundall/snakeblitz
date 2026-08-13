export type Role = "driver" | "gunner";
export type Phase = "waiting" | "combat" | "intermission" | "gameover";
export type WaveType =
  | "NORMAL"
  | "BONUS_MONEY"
  | "VOLATILE_SNAKES"
  | "BLACKOUT"
  | "FRENZY"
  | "TITAN_NEST";

export type UpgradeId =
  | "AP_AMMO"
  | "AUTOLOADER"
  | "ENGINE"
  | "ARMOR"
  | "HV_SHELLS"
  | "SCAVENGER";

export interface PlayerSnapshot {
  sessionId: string;
  name: string;
  role: Role;
}

export interface SnakeSnapshot {
  id: number;
  x: number;
  y: number;
  rotation: number;
  hp: number;
  maxHp: number;
  headRadius: number;
  bodyRadius: number;
  length: number;
  volatile: boolean;
  seed: number;
}

export interface CashCrateSnapshot {
  id: number;
  x: number;
  y: number;
  value: number;
  timeLeftMs: number;
}

export interface ObstacleSnapshot {
  id: number;
  x: number;
  y: number;
  radius: number;
  type: string;
}

export interface UpgradeSnapshot {
  id: UpgradeId;
  name: string;
  shortName: string;
  description: string;
  level: number;
  maxLevel: number;
  maxed: boolean;
  cost: number | null;
  currentEffect: string;
  nextEffect: string;
}

export interface CombatStatsSnapshot {
  bodyDamage: number;
  headDamage: number;
  headshotMultiplier: number;
  fireIntervalMs: number;
  forwardSpeed: number;
  reverseSpeed: number;
  turnSpeed: number;
  maxHealth: number;
  bulletSpeed: number;
  pickupRadius: number;
  cashValueMultiplier: number;
}

export interface GameSnapshot {
  roomId: string;
  world: { width: number; height: number };
  players: PlayerSnapshot[];
  tank: {
    x: number;
    y: number;
    rotation: number;
    turretRotation: number;
    health: number;
    maxHealth: number;
  };
  bullets: Array<{ id: number; x: number; y: number; angle: number }>;
  snakes: SnakeSnapshot[];
  cashCrates: CashCrateSnapshot[];
  obstacles: ObstacleSnapshot[];
  phase: Phase;
  wave: number;
  waveType: WaveType;
  timeLeftMs: number;
  snakesRemaining: number;
  snakesAlive: number;
  score: number;
  cash: number;
  cashCollected: number;
  kills: number;
  headshots: number;
  readySessionIds: string[];
  upgrades: UpgradeSnapshot[];
  combatStats: CombatStatsSnapshot;
  repair: {
    cost: number;
    restore: number;
    canBuy: boolean;
  };
}
