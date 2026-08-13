import Phaser from "phaser";
import "./style.css";
import { GameScene } from "./game/GameScene";
import "./game/phase2Client";
import "./game/phase3Client";
import "./game/phase3PolishClient";
import { audio } from "./game/AudioManager";
import { network } from "./network";
import type { BoostType, GameSnapshot, LeaderboardEntry, UpgradeId, UpgradeSnapshot, WaveType } from "./types";

const $=<T extends HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const lobby=$("#lobby"), gameShell=$("#game-shell"), status=$("#lobby-status");
const nameInput=$<HTMLInputElement>("#player-name"), codeInput=$<HTMLInputElement>("#room-code");
const createButton=$<HTMLButtonElement>("#create-game"), joinButton=$<HTMLButtonElement>("#join-game");
const modeOnline=$<HTMLButtonElement>("#mode-online"), modeLocal=$<HTMLButtonElement>("#mode-local");
const onlineSetup=$("#online-setup"), localSetup=$("#local-setup"), localName1=$<HTMLInputElement>("#local-name-1"), localName2=$<HTMLInputElement>("#local-name-2"), startLocal=$<HTMLButtonElement>("#start-local");
const hudRoom=$("#hud-room"),hudWave=$("#hud-wave"),hudWaveType=$("#hud-wave-type"),hudTimer=$("#hud-timer"),hudEnemies=$("#hud-enemies"),hudRole=$("#hud-role"),hudScore=$("#hud-score"),hudCash=$("#hud-cash"),hudHealthText=$("#hud-health-text"),hudHealthFill=$("#hud-health-fill"),hudMultiplier=$("#hud-multiplier"),hudMultFill=$("#hud-mult-fill");
const controlsText=$("#controls-text"),waitingBanner=$("#waiting-banner"),eventBanner=$("#event-banner");
const boostHud=$("#boost-hud"),boostName=$("#boost-name"),boostCount=$("#boost-count");
const shopOverlay=$("#shop-overlay"),shopCash=$("#shop-cash"),shopTimer=$("#shop-timer"),shopClearMultiplier=$("#shop-clear-multiplier"),shopSubtitle=$("#shop-subtitle"),shopRoles=$("#shop-roles"),shopBuildSummary=$("#shop-build-summary"),upgradeGrid=$("#upgrade-grid"),buyRepairButton=$<HTMLButtonElement>("#buy-repair"),repairDescription=$("#repair-description"),readyPlayer1=$("#ready-player-1"),readyPlayer2=$("#ready-player-2"),shopMessage=$("#shop-message"),shopReadyButton=$<HTMLButtonElement>("#shop-ready");
const bossWheel=$("#boss-wheel-overlay"),wheel=$("#reward-wheel"),bossRewardResult=$("#boss-reward-result"),bossRewardDesc=$("#boss-reward-desc"),spinBoss=$<HTMLButtonElement>("#spin-boss-reward"),continueBoss=$<HTMLButtonElement>("#continue-after-boss");
const gameOver=$("#game-over"),restartButton=$<HTMLButtonElement>("#restart-game"),backHomeButton=$<HTMLButtonElement>("#back-home"),resultWave=$("#result-wave"),resultScore=$("#result-score"),resultKills=$("#result-kills"),resultHeadshots=$("#result-headshots"),resultCash=$("#result-cash"),resultLeaderboard=$("#result-leaderboard"),resultLeaderboardRank=$("#result-leaderboard-rank");
const openLeaderboardButton=$<HTMLButtonElement>("#open-leaderboard"),closeLeaderboardButton=$<HTMLButtonElement>("#close-leaderboard"),refreshLeaderboardButton=$<HTMLButtonElement>("#refresh-leaderboard"),leaderboardOverlay=$("#leaderboard-overlay"),leaderboardList=$("#leaderboard-list");
const musicButtons=[...document.querySelectorAll<HTMLButtonElement>(".music-toggle")];
const sfxButtons=[...document.querySelectorAll<HTMLButtonElement>(".sfx-toggle")];

interface UpgradeCardElements{root:HTMLElement;level:HTMLElement;current:HTMLElement;next:HTMLElement;button:HTMLButtonElement;fill:HTMLElement;}
let game:Phaser.Game|undefined,bannerTimeout:number|undefined,shopMessageTimeout:number|undefined,latestSnapshot:GameSnapshot|undefined;
let lastUiUpdateAt=0,lastUiPhase:GameSnapshot["phase"]|undefined;
const upgradeCards=new Map<UpgradeId,UpgradeCardElements>();

nameInput.value=localStorage.getItem("snakeBlitzName")??localStorage.getItem("snakeTankName")??"";
localName1.value="";localName2.value="";
codeInput.addEventListener("input",()=>codeInput.value=codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g,"").slice(0,4));
musicButtons.forEach(button=>button.onclick=()=>{audio.unlock();audio.setMusicEnabled(!audio.isMusicEnabled());});
sfxButtons.forEach(button=>button.onclick=()=>{audio.unlock();audio.setSfxEnabled(!audio.isSfxEnabled());});
audio.addEventListener("settingschange",syncAudioButtons);
syncAudioButtons();
modeOnline.onclick=()=>setMode("online");modeLocal.onclick=()=>setMode("local");
function setMode(mode:"online"|"local"){modeOnline.classList.toggle("active",mode==="online");modeLocal.classList.toggle("active",mode==="local");onlineSetup.classList.toggle("hidden",mode!=="online");localSetup.classList.toggle("hidden",mode!=="local");status.textContent=mode==="online"?"Create a room or join with a four-character code.":"Both players use the same browser: keyboard drives, mouse aims and fires.";}

createButton.onclick=async()=>{audio.unlock();const name=getName();if(!name)return;setBusy(true,"Creating room…");try{const id=await network.createGame(name);enterGame();showBanner(`ROOM ${id} • SEND THIS CODE TO PLAYER 2`,3600);}catch(e){showError(e)}finally{setBusy(false)}};
joinButton.onclick=async()=>{audio.unlock();const name=getName();if(!name)return;const code=codeInput.value.trim().toUpperCase();if(code.length!==4){status.textContent="Enter the four-character room code.";status.classList.add("error");return;}setBusy(true,"Joining room…");try{await network.joinGame(code,name);enterGame();}catch(e){showError(e)}finally{setBusy(false)}};
startLocal.onclick=async()=>{audio.unlock();const n1=localName1.value.trim().slice(0,18),n2=localName2.value.trim().slice(0,18);if(!n1||!n2){status.textContent="Enter both player names.";status.classList.add("error");return;}localStorage.setItem("snakeBlitzLocal1",n1);localStorage.setItem("snakeBlitzLocal2",n2);setBusy(true,"Starting local co-op…");try{await network.createLocalGame(n1,n2);enterGame();}catch(e){showError(e)}finally{setBusy(false)}};
restartButton.onclick=()=>{gameOver.classList.add("hidden");bossWheel.classList.add("hidden");network.restart();};
backHomeButton.onclick=()=>void returnToHomepage();
openLeaderboardButton.onclick=()=>{leaderboardOverlay.classList.remove("hidden");void loadLeaderboard(leaderboardList);};
closeLeaderboardButton.onclick=()=>leaderboardOverlay.classList.add("hidden");
refreshLeaderboardButton.onclick=()=>void loadLeaderboard(leaderboardList);
leaderboardOverlay.addEventListener("click",event=>{if(event.target===leaderboardOverlay)leaderboardOverlay.classList.add("hidden");});
window.addEventListener("keydown",event=>{if(event.key==="Escape"&&!leaderboardOverlay.classList.contains("hidden"))leaderboardOverlay.classList.add("hidden");});
buyRepairButton.onclick=()=>network.buyRepair();shopReadyButton.onclick=()=>{const s=latestSnapshot;if(!s||s.phase!=="intermission")return;const meReady=s.mode==="local"?s.readySessionIds.length>=2:s.readySessionIds.includes(network.sessionId);network.setShopReady(!meReady);audio.readyPing();};
spinBoss.onclick=()=>{spinBoss.disabled=true;wheel.classList.add("spinning");network.spinBossReward();};continueBoss.onclick=()=>network.continueAfterBoss();

network.addEventListener("snapshot",e=>{
  const s=(e as CustomEvent<GameSnapshot>).detail;latestSnapshot=s;
  // Network snapshots can arrive faster than the DOM needs to repaint. Batching
  // HUD/shop work to ~10 Hz cuts layout/style churn without changing gameplay.
  const now=performance.now(),phaseChanged=s.phase!==lastUiPhase;
  if(phaseChanged||now-lastUiUpdateAt>=95){lastUiUpdateAt=now;lastUiPhase=s.phase;updateHud(s);updateShop(s);updateBossReward(s);}
});
network.addEventListener("roles_assigned",()=>showBanner("STARTING ROLES RANDOMISED",1800));
network.addEventListener("wave_start",e=>{shopOverlay.classList.add("hidden");bossWheel.classList.add("hidden");gameOver.classList.add("hidden");const d=(e as CustomEvent<{wave:number;waveType:WaveType}>).detail;showBanner(waveBanner(d.wave,d.waveType),d.waveType==="BOSS"?4200:d.waveType==="NORMAL"?1800:3000);});
network.addEventListener("wave_complete",e=>{const d=(e as CustomEvent<{wave:number;repair:number;multiplier:number}>).detail;showBanner(`WAVE ${d.wave} CLEARED • ${d.multiplier.toFixed(2)}× CLEAR MULTIPLIER • ROLES SWAPPED${d.repair?` • +${d.repair} HP`:""}`,3000);});
network.addEventListener("upgrade_purchased",e=>{const d=(e as CustomEvent<any>).detail;showShopMessage(`${d.purchaser} upgraded ${d.name} to Lv.${d.level} • -$${d.cost.toLocaleString()}`);audio.purchase();});
network.addEventListener("repair_purchased",e=>{const d=(e as CustomEvent<any>).detail;showShopMessage(`${d.purchaser} repaired +${d.restored} integrity • -$${d.cost.toLocaleString()}`);audio.repair();});
network.addEventListener("purchase_denied",e=>showShopMessage((e as CustomEvent<any>).detail.reason,true));
network.addEventListener("boss_phase",e=>{const d=(e as CustomEvent<any>).detail;if(d.phase==="TELEGRAPH")showBanner("BOSS TELEGRAPH — GET OUT OF THE STRIKE LINE!",1200);else if(d.phase==="EXPOSED")showBanner("BOSS EXPOSED — ACCURATE FIRE NOW!",1500);else if(d.phase==="VENOM")showBanner("VENOM BARRAGE — KEEP MOVING!",1200);else if(d.phase==="REINFORCEMENT")showBanner(`BOSS REINFORCEMENT INCOMING • ${d.remaining} REMAIN`,2200);});
network.addEventListener("boss_defeated",e=>{const d=(e as CustomEvent<any>).detail;showBanner(`${prettyBoss(d.type)} DEFEATED • BOSS REWARD UNLOCKED`,3200);});
network.addEventListener("boss_reward",e=>{const d=(e as CustomEvent<{reward:BoostType;name:string;description:string}>).detail;const order:BoostType[]=["SPEED","MEDKIT","REVIVE","BOMB","NUKE","CASH_BONUS"];const idx=order.indexOf(d.reward);wheel.style.setProperty("--spin-angle",`${1440+(360-idx*60)+Math.round((Math.random()-.5)*24)}deg`);bossRewardResult.textContent="SPINNING…";bossRewardDesc.textContent="Reward locked by the server. Stand by…";spinBoss.classList.add("hidden");window.setTimeout(()=>{wheel.classList.remove("spinning");bossRewardResult.textContent=`${d.name.toUpperCase()} ACQUIRED`;bossRewardDesc.textContent=d.description;continueBoss.classList.remove("hidden");},2200);});
network.addEventListener("boost_used",e=>{const d=(e as CustomEvent<any>).detail;showBanner(`${d.automatic?"AUTO-":""}${d.name.toUpperCase()} ACTIVATED`,1800);});
network.addEventListener("game_over",e=>{
  shopOverlay.classList.add("hidden");bossWheel.classList.add("hidden");
  const d=(e as CustomEvent<any>).detail;
  resultWave.textContent=String(d.wave);resultScore.textContent=d.score.toLocaleString();resultCash.textContent=`$${(d.cashCollected??d.cash).toLocaleString()}`;resultKills.textContent=d.kills.toLocaleString();resultHeadshots.textContent=d.headshots.toLocaleString();
  resultLeaderboardRank.textContent=d.leaderboardRank?`NEW #${d.leaderboardRank} ALL-TIME`:"";
  if(Array.isArray(d.leaderboard))renderLeaderboard(resultLeaderboard,d.leaderboard,d.leaderboardRank??null);else void loadLeaderboard(resultLeaderboard);
  setTimeout(()=>gameOver.classList.remove("hidden"),450);
});


async function loadLeaderboard(target:HTMLElement){
  target.innerHTML='<div class="leaderboard-loading">Loading leaderboard…</div>';
  try{const entries=await network.getLeaderboard();renderLeaderboard(target,entries,null);}catch(error){console.error(error);target.innerHTML='<div class="leaderboard-error">Leaderboard is temporarily unavailable.</div>';}
}
function renderLeaderboard(target:HTMLElement,entries:LeaderboardEntry[],highlightRank:number|null){
  target.innerHTML="";
  if(!entries.length){target.innerHTML='<div class="leaderboard-empty">No completed runs yet. Be the first team on the board.</div>';return;}
  entries.slice(0,10).forEach((entry,index)=>{
    const row=document.createElement("div");row.className="leaderboard-row";if(highlightRank===index+1)row.classList.add("current-run");
    const rank=document.createElement("span");rank.className="leaderboard-rank";rank.textContent=`#${index+1}`;
    const team=document.createElement("div");team.className="leaderboard-team";const names=document.createElement("strong");names.textContent=`${entry.players[0]} + ${entry.players[1]}`;const meta=document.createElement("span");meta.textContent=`${entry.mode==="local"?"LOCAL CO-OP":"ONLINE"} • ${new Date(entry.achievedAt).toLocaleDateString()}`;team.append(names,meta);
    const wave=document.createElement("span");wave.className="leaderboard-wave";wave.textContent=`W${entry.wave}`;
    const score=document.createElement("span");score.className="leaderboard-score";score.textContent=entry.score.toLocaleString();
    row.append(rank,team,wave,score);target.append(row);
  });
}
async function returnToHomepage(){
  gameOver.classList.add("hidden");shopOverlay.classList.add("hidden");bossWheel.classList.add("hidden");leaderboardOverlay.classList.add("hidden");eventBanner.classList.add("hidden");waitingBanner.classList.add("hidden");
  audio.setEngineMotion(0,0,false);
  await network.leaveGame();
  if(game)game.scene.pause("GameScene");
  latestSnapshot=undefined;lastUiPhase=undefined;upgradeCards.clear();upgradeGrid.innerHTML="";
  gameShell.classList.add("hidden");lobby.classList.remove("hidden");
  status.textContent="Choose online code play or one-device local co-op.";status.classList.remove("error");
}

function syncAudioButtons(){
 const musicOn=audio.isMusicEnabled(),sfxOn=audio.isSfxEnabled();
 for(const b of musicButtons){b.textContent=`MUSIC • ${musicOn?"ON":"OFF"}`;b.classList.toggle("disabled-audio",!musicOn);b.setAttribute("aria-pressed",String(musicOn));}
 for(const b of sfxButtons){b.textContent=`SFX • ${sfxOn?"ON":"OFF"}`;b.classList.toggle("disabled-audio",!sfxOn);b.setAttribute("aria-pressed",String(sfxOn));}
}

function getName(){const n=nameInput.value.trim().slice(0,18);if(!n){status.textContent="Enter your name first.";status.classList.add("error");return"";}localStorage.setItem("snakeBlitzName",n);return n;}
function enterGame(){audio.beginGameplayAudio();lobby.classList.add("hidden");gameShell.classList.remove("hidden");if(!game)game=new Phaser.Game({type:Phaser.AUTO,parent:"game-root",width:1600,height:900,backgroundColor:"#42573d",scene:[GameScene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,antialiasGL:false,roundPixels:false,powerPreference:"high-performance"}});else game.scene.resume("GameScene");}
function updateHud(s:GameSnapshot){hudRoom.textContent=s.mode==="local"?"LOCAL":s.roomId;hudWave.textContent=s.wave?`WAVE ${s.wave}`:"WAITING";hudWaveType.textContent=prettyWaveType(s.waveType);hudWaveType.dataset.type=s.waveType;hudEnemies.textContent=s.phase==="combat"?(s.boss?`${Math.ceil(s.boss.hp)} BOSS HP`:`${s.snakesRemaining} LEFT`):phaseLabel(s);hudTimer.textContent=s.phase==="intermission"?formatTime(s.timeLeftMs):s.phase==="combat"?`${Math.floor(s.waveElapsedMs/1000)}s`:"";hudScore.textContent=s.score.toLocaleString();hudCash.textContent=`$${s.cash.toLocaleString()}`;hudMultiplier.textContent=`${s.economyMultiplier.toFixed(2)}×`;hudMultFill.style.width=`${Math.min(100,s.economyMultiplier*10)}%`;hudMultiplier.classList.toggle("taxed",s.economyMultiplier<1);
 const hr=Math.max(0,Math.min(1,s.tank.health/s.tank.maxHealth));hudHealthText.textContent=`${Math.ceil(s.tank.health)} / ${s.tank.maxHealth}`;hudHealthFill.style.width=`${hr*100}%`;hudHealthFill.classList.toggle("warning",hr<=.45&&hr>.22);hudHealthFill.classList.toggle("critical",hr<=.22);
 const me=s.mode==="local"?undefined:s.players.find(p=>p.sessionId===network.sessionId);hudRole.textContent=s.mode==="local"?s.players.map(p=>`${p.name}: ${p.role.toUpperCase()}`).join(" • "):me?.role.toUpperCase()??"WAITING";
 waitingBanner.classList.toggle("hidden",s.players.length>=2);if(s.players.length<2)waitingBanner.textContent=`Waiting for player 2… Room ${s.roomId}`;
 if(s.mode==="local")controlsText.textContent=`${s.players.find(p=>p.role==="driver")?.name} DRIVES • ${s.players.find(p=>p.role==="gunner")?.name} GUNS • right-click cycles boosts • middle-click uses`;
 else controlsText.textContent=me?.role==="driver"?"DRIVER — WASD / ARROWS • kite enemies • grab cash":"GUNNER — MOUSE AIM • LEFT CLICK / SPACE FIRE • RIGHT CLICK CYCLE BOOST • MIDDLE CLICK USE";
 updateBoostHud(s);
}
function updateBoostHud(s:GameSnapshot){const available=s.boosts.filter(b=>b.count>0);if(!available.length){boostName.textContent="NONE";boostCount.textContent="";boostHud.classList.add("empty");return;}boostHud.classList.remove("empty");const item=available[s.selectedBoostIndex%available.length];boostName.textContent=item.name.toUpperCase();boostCount.textContent=`×${item.count}`;}
function updateShop(s:GameSnapshot){const open=s.phase==="intermission";shopOverlay.classList.toggle("hidden",!open);if(!open)return;if(upgradeCards.size===0)buildUpgradeCards(s.upgrades);shopCash.textContent=`$${s.cash.toLocaleString()}`;shopTimer.textContent=formatTime(s.timeLeftMs);shopClearMultiplier.textContent=`${s.lastClearMultiplier.toFixed(2)}×`;shopClearMultiplier.classList.toggle("taxed",s.lastClearMultiplier<1);shopSubtitle.textContent=`Wave ${s.wave} cleared at ${s.lastClearMultiplier.toFixed(2)}×. Build for Wave ${s.wave+1}. Major upgrades visibly change the vehicle.`;shopRoles.textContent=s.players.map(p=>`${p.name} → ${p.role.toUpperCase()}`).join(" • ");const st=s.combatStats;shopBuildSummary.textContent=`${st.bodyDamage} body • ${st.headDamage} head • ${(1000/st.fireIntervalMs).toFixed(1)} rps • ${st.weaponTier.replace("_"," ")} • ${st.maxHealth} HP`;
 for(const u of s.upgrades){const el=upgradeCards.get(u.id);if(!el)continue;el.level.textContent=`LV ${u.level} / ${u.maxLevel}`;el.current.textContent=u.currentEffect;el.next.textContent=u.maxed?"Maximum upgrade reached":`NEXT • ${u.nextEffect}`;el.fill.style.width=`${u.level/u.maxLevel*100}%`;el.root.classList.toggle("maxed",u.maxed);const afford=u.cost!==null&&s.cash>=u.cost;el.button.disabled=u.maxed||!afford;el.button.textContent=u.maxed?"MAXED":`$${u.cost?.toLocaleString()}`;el.button.classList.toggle("affordable",afford&&!u.maxed);}
 repairDescription.textContent=`Restore up to ${s.repair.restore} integrity • ${Math.ceil(s.tank.health)} / ${s.tank.maxHealth} HP`;buyRepairButton.textContent=s.tank.health>=s.tank.maxHealth-.5?"FULL INTEGRITY":`REPAIR • $${s.repair.cost.toLocaleString()}`;buyRepairButton.disabled=!s.repair.canBuy;
 const ready=new Set(s.readySessionIds);updateReadyPill(readyPlayer1,s.players[0],ready);updateReadyPill(readyPlayer2,s.players[1],ready);const meReady=s.mode==="local"?ready.size>=2:ready.has(network.sessionId);shopReadyButton.textContent=meReady?"READY ✓ — CLICK TO CANCEL":`READY FOR WAVE ${s.wave+1}`;shopReadyButton.classList.toggle("is-ready",meReady);
}
function buildUpgradeCards(upgrades:UpgradeSnapshot[]){upgradeGrid.innerHTML="";for(const u of upgrades){const root=document.createElement("article");root.className=`upgrade-card upgrade-${u.id.toLowerCase()}`;const header=document.createElement("div");header.className="upgrade-card-header";const wrap=document.createElement("div"),k=document.createElement("span"),t=document.createElement("strong"),level=document.createElement("span");k.className="upgrade-kicker";k.textContent=u.shortName;t.textContent=u.name;level.className="upgrade-level";wrap.append(k,t);header.append(wrap,level);const desc=document.createElement("p");desc.textContent=u.description;const progress=document.createElement("div");progress.className="upgrade-progress";const fill=document.createElement("div");progress.append(fill);const current=document.createElement("div");current.className="upgrade-current";const next=document.createElement("div");next.className="upgrade-next";const button=document.createElement("button");button.className="shop-buy";button.onclick=()=>network.buyUpgrade(u.id);root.append(header,desc,progress,current,next,button);upgradeGrid.append(root);upgradeCards.set(u.id,{root,level,current,next,button,fill});}}
function updateReadyPill(el:HTMLElement,p:GameSnapshot["players"][number]|undefined,r:Set<string>){if(!p){el.textContent="WAITING";return;}const ready=r.has(p.sessionId);el.textContent=`${p.name.toUpperCase()} • ${ready?"READY ✓":"CHOOSING"}`;el.classList.toggle("ready",ready);}
function updateBossReward(s:GameSnapshot){const open=s.phase==="boss_reward";bossWheel.classList.toggle("hidden",!open);if(!open)return;if(!s.pendingBossReward){wheel.style.transform="rotate(0deg)";void wheel.offsetWidth;wheel.style.transform="";spinBoss.classList.remove("hidden");spinBoss.disabled=false;continueBoss.classList.add("hidden");bossRewardResult.textContent="Spin for your boss reward";bossRewardDesc.textContent="Rare boosts persist into future waves until used.";wheel.classList.remove("spinning");}}
function phaseLabel(s:GameSnapshot){if(s.phase==="intermission")return"ARMORY";if(s.phase==="boss_reward")return"REWARD";if(s.phase==="gameover")return"DESTROYED";return"STANDBY";}
function formatTime(ms:number){const total=Math.ceil(ms/1000);return`00:${String(Math.max(0,total)).padStart(2,"0")}`;}
function prettyWaveType(t:WaveType){return t==="BONUS_MONEY"?"BONUS CASH":t==="VOLATILE_SNAKES"?"VOLATILE":t==="TITAN_NEST"?"TITAN NEST":t==="BOSS"?"BOSS FIGHT":t;}
function prettyBoss(t:string){return t==="COIL_STRIKER"?"COIL STRIKER":t==="LACE_MONITOR"?"LACE MONITOR":"COBRA SENTINEL";}
function waveBanner(w:number,t:WaveType){if(t==="BOSS")return`WAVE ${w} • BOSS FIGHT — WATCH THE TELEGRAPH, ATTACK THE EXPOSED WINDOW`;if(t==="BONUS_MONEY")return`WAVE ${w} • CASH SURGE — CRATES SPAWN ~3× FASTER`;if(t==="VOLATILE_SNAKES")return`WAVE ${w} • VOLATILE — CHAIN REACTIONS, KEEP DISTANCE`;if(t==="BLACKOUT")return`WAVE ${w} • BLACKOUT — LIMITED VISIBILITY`;if(t==="FRENZY")return`WAVE ${w} • FRENZY — FAST, DENSE HORDE`;if(t==="TITAN_NEST")return`WAVE ${w} • TITAN NEST — HEAVY TARGETS`;return`WAVE ${w} — BLITZ MULTIPLIER STARTS AT 10×`;}
function showBanner(text:string,duration=1800){if(bannerTimeout)clearTimeout(bannerTimeout);eventBanner.textContent=text;eventBanner.classList.remove("hidden");bannerTimeout=window.setTimeout(()=>eventBanner.classList.add("hidden"),duration);}
function showShopMessage(text:string,error=false){if(shopMessageTimeout)clearTimeout(shopMessageTimeout);shopMessage.textContent=text;shopMessage.classList.toggle("error",error);shopMessage.classList.add("active");shopMessageTimeout=window.setTimeout(()=>{shopMessage.textContent="Upgrades visibly evolve your tank as the run progresses.";shopMessage.classList.remove("active","error");},2600);}
function setBusy(b:boolean,msg?:string){createButton.disabled=b;joinButton.disabled=b;startLocal.disabled=b;if(msg){status.textContent=msg;status.classList.remove("error");}}
function showError(e:unknown){console.error(e);status.textContent=`Could not connect: ${e instanceof Error?e.message:String(e)}`;status.classList.add("error");}
