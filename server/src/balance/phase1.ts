// Phase 1 balance layer.
// Kept separate from TankRoom so balancing remains easy to tune/revert while
// preserving the existing multiplayer architecture and hot simulation path.

export function applyPhase1Balance(RoomClass: any) {
  const p = RoomClass.prototype as any;
  if (p.__phase1BalanceApplied) return;
  p.__phase1BalanceApplied = true;

  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

  const hpScale = (wave: number) => {
    const w = Math.max(1, wave);
    if (w <= 10) return lerp(0.17, 1, (w - 1) / 9);
    if (w <= 20) return lerp(1, 2, (w - 10) / 10);
    if (w <= 30) return lerp(2, 3.5, (w - 20) / 10);
    if (w <= 40) return lerp(3.5, 6, (w - 30) / 10);
    if (w <= 50) return lerp(6, 10, (w - 40) / 10);
    return 10 * Math.pow(1.45, (w - 50) / 10);
  };

  const damageScale = (wave: number) => {
    const w = Math.max(1, wave);
    if (w <= 10) return lerp(0.5, 1, (w - 1) / 9);
    if (w <= 20) return lerp(1, 1.6, (w - 10) / 10);
    if (w <= 30) return lerp(1.6, 2.3, (w - 20) / 10);
    if (w <= 40) return lerp(2.3, 3, (w - 30) / 10);
    if (w <= 50) return lerp(3, 4, (w - 40) / 10);
    return 4 * Math.pow(1.22, (w - 50) / 10);
  };

  // Lower starting cash without changing room lifecycle behaviour.
  const originalResetRun = p.resetRun;
  p.resetRun = function () {
    originalResetRun.call(this);
    this.cash = 100;
    this.lastClearMultiplier = 10;
  };

  // Fewer, stronger enemies. Count/speed/size cap; HP continues forever.
  p.waveStats = function () {
    const l = Math.max(0, this.wave - 1);
    let count = Math.min(36, 7 + Math.floor(this.wave * 1.15));
    const fullHpScale = hpScale(this.wave), slowedHpScale = 0.17 + (fullHpScale - 0.17) * 0.5;
    let hp = Math.round(320 * slowedHpScale);
    let speed = Math.min(178, 88 + l * 2.15);
    let headRadius = Math.max(12, 27 - l * 0.45);
    let bodyRadius = Math.min(23, 11 + l * 0.38);
    let length = Math.min(155, 92 + l * 1.7);

    if (this.waveType === "FRENZY") {
      count = Math.min(42, Math.round(count * 1.35));
      hp = Math.round(hp * 0.72);
      speed = Math.min(205, speed * 1.22);
      headRadius *= 0.9;
      bodyRadius *= 0.86;
      length *= 0.88;
    }
    if (this.waveType === "TITAN_NEST") {
      count = Math.max(4, Math.round(count * 0.35));
      hp = Math.round(hp * 2.8);
      speed *= 0.78;
      headRadius *= 1.12;
      bodyRadius *= 1.5;
      length *= 1.26;
    }
    return { count, hp, speed, headRadius, bodyRadius, length };
  };

  // Roughly 2x opening upgrade prices, with extra late-level growth.
  p.upgradeCost = function (definition: any, level: number) {
    const base = definition.baseCost * 2;
    const growth = definition.costGrowth + 0.06;
    return Math.round(base * Math.pow(growth, level) / 5) * 5;
  };
  // Restore the original high-reward clear multiplier curve. Upgrade prices and
  // Phase 1's lower base crate values remain unchanged, so cash is more generous
  // without completely reverting the harder economy/progression balance.
  p.economyMultiplier = function () {
    const s = this.waveElapsedMs / 1000;
    if (s <= 10) return lerp(10, 5, s / 10);
    if (s <= 20) return lerp(5, 3, (s - 10) / 10);
    if (s <= 30) return lerp(3, 1, (s - 20) / 10);
    if (s <= 45) return 1;
    if (s <= 60) return lerp(1, 0.75, (s - 45) / 15);
    if (s <= 75) return lerp(0.75, 0.5, (s - 60) / 15);
    if (s <= 90) return lerp(0.5, 0, (s - 75) / 15);
    return 0;
  };

  p.spawnCashAt = function (x: number, y: number, mult = 1) {
    const base = 50 + this.wave * 9;
    const econ = this.combatStats().cashValueMultiplier;
    const value = Math.round(base * 1.35 * mult * econ / 5) * 5;
    const id = this.nextCashId++;
    this.cashCrates.set(id, {
      id, x, y, value,
      timeLeftMs: this.waveType === "BONUS_MONEY" ? 11500 : 9200,
    });
  };

  // Scale incoming enemy damage by source without adding entities/network load.
  const originalDamageTank = p.damageTank;
  p.damageTank = function (amount: number, source: string, x: number, y: number) {
    const scale = damageScale(this.wave);
    if (source === "bite") amount = Math.max(5, Math.round(10 * scale));
    else if (source === "venom") amount = Math.max(7, Math.round(11 * scale));
    else if (source === "explosion") amount = Math.max(10, Math.round(14 * scale));
    else if (source === "boss") amount = Math.max(28, Math.round(28 * Math.sqrt(scale)));
    return originalDamageTank.call(this, amount, source, x, y);
  };

  // Stronger boss base HP now; full attack/phase overhaul remains Phase 6.
  p.spawnBoss = function () {
    const tier = Math.floor(this.wave / 10);
    const types = ["COIL_STRIKER", "LACE_MONITOR", "COBRA_SENTINEL"];
    const type = types[(tier - 1 + this.bossSequenceIndex) % types.length];
    const radius = type === "LACE_MONITOR" ? 100 : 88;
    const maxHp = Math.round(2400 * hpScale(this.wave));
    const pos = this.spawnNearTankEdge(720);
    this.boss = {
      id: tier,
      type,
      x: pos.x,
      y: pos.y,
      rotation: Math.atan2(this.tank.y - pos.y, this.tank.x - pos.x),
      hp: maxHp,
      maxHp,
      radius,
      phase: "STALK",
      phaseTimeLeftMs: 3200,
      vulnerable: type === "LACE_MONITOR",
      telegraphAngle: 0,
      tier,
      contactCooldownMs: 0,
    };
    this.broadcast("boss_phase", { type, phase: "STALK", tier });
  };

  // Let fewer enemies arrive a little less aggressively; stronger stats carry
  // the difficulty while keeping simultaneous entity/network load controlled.
  const originalStartWave = p.startWave;
  p.startWave = function (wave: number) {
    originalStartWave.call(this, wave);
    if (this.waveType !== "BOSS") {
      this.spawnIntervalMs = Math.max(300, 500 - this.wave * 7);
      if (this.waveType !== "BONUS_MONEY") this.cashSpawnAccumulatorMs = 5000;
    }
  };
}
