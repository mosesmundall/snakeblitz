export type Role = "driver" | "gunner";
export type Phase = "waiting" | "combat" | "intermission" | "boss_reward" | "gameover";
export type WaveType = "NORMAL" | "BONUS_MONEY" | "VOLATILE_SNAKES" | "BLACKOUT" | "FRENZY" | "TITAN_NEST" | "BOSS";
export type EnemyVariant = "NORMAL" | "BOMBER" | "VENOM" | "CASH";
export type BossType = "COIL_STRIKER" | "LACE_MONITOR" | "COBRA_SENTINEL";
export type BossPhase = "STALK" | "TELEGRAPH" | "STRIKE" | "EXPOSED" | "VENOM" | "CHARGE";
export type BoostType = "SPEED" | "MEDKIT" | "REVIVE" | "BOMB" | "NUKE" | "CASH_BONUS";
export type UpgradeId = "AP_AMMO" | "AUTOLOADER" | "ENGINE" | "ARMOR" | "HV_SHELLS" | "SCAVENGER" | "ORDNANCE";


export interface LeaderboardEntry {
  id: string; players: [string, string]; wave: number; score: number; kills: number; headshots: number;
  mode: "online" | "local"; achievedAt: string;
}

export interface PlayerSnapshot { sessionId: string; name: string; role: Role; }
export interface SnakeSnapshot {
  id: number; x: number; y: number; rotation: number; hp: number; maxHp: number;
  headRadius: number; bodyRadius: number; length: number; volatile: boolean; seed: number;
  variant: EnemyVariant; attackCooldownMs: number;
}
export interface BossSnapshot {
  id: number; type: BossType; x: number; y: number; rotation: number; hp: number; maxHp: number;
  radius: number; phase: BossPhase; phaseTimeLeftMs: number; vulnerable: boolean;
  telegraphAngle: number; tier: number;
}
export interface EnemyProjectileSnapshot { id: number; x: number; y: number; vx: number; vy: number; kind: "VENOM"; }
export interface CashCrateSnapshot { id: number; x: number; y: number; value: number; timeLeftMs: number; }
export interface ObstacleSnapshot { id: number; x: number; y: number; radius: number; type: string; label?: string; }
export interface UpgradeSnapshot {
  id: UpgradeId; name: string; shortName: string; description: string; level: number; maxLevel: number;
  maxed: boolean; cost: number | null; currentEffect: string; nextEffect: string;
}
export interface CombatStatsSnapshot {
  bodyDamage: number; headDamage: number; headshotMultiplier: number; fireIntervalMs: number;
  forwardSpeed: number; reverseSpeed: number; turnSpeed: number; maxHealth: number; bulletSpeed: number;
  bulletRadius: number; splashRadius: number; weaponTier: "SHELL" | "HEAVY_SHELL" | "ROCKET";
  pickupRadius: number; cashValueMultiplier: number;
}
export interface BoostInventoryItem { type: BoostType; name: string; count: number; description: string; }
export interface GameSnapshot {
  roomId: string; mode: "online" | "local"; testMode?: boolean; testWave?: number; world: { width: number; height: number };
  players: PlayerSnapshot[];
  tank: { x: number; y: number; rotation: number; turretRotation: number; health: number; maxHealth: number };
  bullets: Array<{ id: number; x: number; y: number; angle: number; radius: number; weaponTier: string }>;
  enemyProjectiles: EnemyProjectileSnapshot[];
  snakes: SnakeSnapshot[]; boss?: BossSnapshot; cashCrates: CashCrateSnapshot[]; obstacles: ObstacleSnapshot[];
  phase: Phase; wave: number; waveType: WaveType; timeLeftMs: number; waveElapsedMs: number;
  economyMultiplier: number; lastClearMultiplier: number; snakesRemaining: number; snakesAlive: number; score: number; cash: number;
  cashCollected: number; kills: number; headshots: number; readySessionIds: string[];
  upgrades: UpgradeSnapshot[]; combatStats: CombatStatsSnapshot;
  repair: { cost: number; restore: number; canBuy: boolean };
  boosts: BoostInventoryItem[]; selectedBoostIndex: number; pendingBossReward?: BoostType;
}
