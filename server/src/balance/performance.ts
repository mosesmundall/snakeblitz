// Snake Blitz backend performance layer.
// Pure memoization only: no gameplay values are changed here.
export function applyPerformanceOptimizations(RoomClass: any) {
  const p = RoomClass.prototype as any;
  if (p.__performanceOptimizationsApplied) return;
  p.__performanceOptimizationsApplied = true;

  function upgradeKey(room:any){
    const l=room.upgradeLevels;
    return `${l.AP_AMMO}|${l.AUTOLOADER}|${l.ENGINE}|${l.ARMOR}|${l.HV_SHELLS}|${l.SCAVENGER}|${l.ORDNANCE}`;
  }

  const originalCombatStats=p.combatStats;
  p.combatStats=function(){
    const key=upgradeKey(this);
    if(this.__perfCombatKey===key&&this.__perfCombatValue)return this.__perfCombatValue;
    const value=originalCombatStats.call(this);
    this.__perfCombatKey=key;this.__perfCombatValue=value;
    return value;
  };

  const originalUpgradeSnapshot=p.upgradeSnapshot;
  p.upgradeSnapshot=function(){
    const key=upgradeKey(this);
    if(this.__perfUpgradeKey===key&&this.__perfUpgradeValue)return this.__perfUpgradeValue;
    const value=originalUpgradeSnapshot.call(this);
    this.__perfUpgradeKey=key;this.__perfUpgradeValue=value;
    return value;
  };

  const originalWaveStats=p.waveStats;
  p.waveStats=function(){
    const key=`${this.wave}:${this.waveType}`;
    if(this.__perfWaveKey===key&&this.__perfWaveValue)return this.__perfWaveValue;
    const value=originalWaveStats.call(this);
    this.__perfWaveKey=key;this.__perfWaveValue=value;
    return value;
  };
}
