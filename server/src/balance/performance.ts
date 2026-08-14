// Snake Blitz backend performance layer.
// Pure memoization only: gameplay values and authoritative simulation stay unchanged.
export function applyPerformanceOptimizations(RoomClass: any) {
  const p = RoomClass.prototype as any;
  if (p.__performanceOptimizationsApplied) return;
  p.__performanceOptimizationsApplied = true;

  function upgradeKey(room:any){
    const l=room.upgradeLevels;
    return ((((((l.AP_AMMO??0)*16+(l.AUTOLOADER??0))*16+(l.ENGINE??0))*16+(l.ARMOR??0))*16+(l.HV_SHELLS??0))*16+(l.SCAVENGER??0))*16+(l.ORDNANCE??0);
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
    if(this.__perfWaveNo===this.wave&&this.__perfWaveType===this.waveType&&this.__perfWaveValue)return this.__perfWaveValue;
    const value=originalWaveStats.call(this);
    this.__perfWaveNo=this.wave;this.__perfWaveType=this.waveType;this.__perfWaveValue=value;
    return value;
  };

  const originalInventoryArray=p.inventoryArray;
  p.inventoryArray=function(){
    const inv=this.boostInventory;
    if(this.__perfInventoryValue&&
      this.__perfInvSpeed===inv.SPEED&&this.__perfInvMedkit===inv.MEDKIT&&
      this.__perfInvRevive===inv.REVIVE&&this.__perfInvBomb===inv.BOMB&&
      this.__perfInvNuke===inv.NUKE&&this.__perfInvCash===inv.CASH_BONUS){
      return this.__perfInventoryValue;
    }
    const value=originalInventoryArray.call(this);
    this.__perfInvSpeed=inv.SPEED;this.__perfInvMedkit=inv.MEDKIT;
    this.__perfInvRevive=inv.REVIVE;this.__perfInvBomb=inv.BOMB;
    this.__perfInvNuke=inv.NUKE;this.__perfInvCash=inv.CASH_BONUS;
    this.__perfInventoryValue=value;
    return value;
  };
}