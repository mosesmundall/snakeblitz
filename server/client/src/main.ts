import Phaser from "phaser";
import "./style.css";
import { GameScene } from "./game/GameScene";
import { audio } from "./game/AudioManager";
import { network } from "./network";
import type { GameSnapshot, UpgradeId, UpgradeSnapshot, WaveType } from "./types";

const lobby = document.querySelector<HTMLElement>("#lobby")!;
const gameShell = document.querySelector<HTMLElement>("#game-shell")!;
const nameInput = document.querySelector<HTMLInputElement>("#player-name")!;
const codeInput = document.querySelector<HTMLInputElement>("#room-code")!;
const createButton = document.querySelector<HTMLButtonElement>("#create-game")!;
const joinButton = document.querySelector<HTMLButtonElement>("#join-game")!;
const status = document.querySelector<HTMLElement>("#lobby-status")!;
const hudRoom = document.querySelector<HTMLElement>("#hud-room")!;
const hudWave = document.querySelector<HTMLElement>("#hud-wave")!;
const hudWaveType = document.querySelector<HTMLElement>("#hud-wave-type")!;
const hudTimer = document.querySelector<HTMLElement>("#hud-timer")!;
const hudEnemies = document.querySelector<HTMLElement>("#hud-enemies")!;
const hudRole = document.querySelector<HTMLElement>("#hud-role")!;
const hudScore = document.querySelector<HTMLElement>("#hud-score")!;
const hudCash = document.querySelector<HTMLElement>("#hud-cash")!;
const hudHealthText = document.querySelector<HTMLElement>("#hud-health-text")!;
const hudHealthFill = document.querySelector<HTMLElement>("#hud-health-fill")!;
const controlsText = document.querySelector<HTMLElement>("#controls-text")!;
const waitingBanner = document.querySelector<HTMLElement>("#waiting-banner")!;
const eventBanner = document.querySelector<HTMLElement>("#event-banner")!;
const gameOver = document.querySelector<HTMLElement>("#game-over")!;
const restartButton = document.querySelector<HTMLButtonElement>("#restart-game")!;
const resultWave = document.querySelector<HTMLElement>("#result-wave")!;
const resultScore = document.querySelector<HTMLElement>("#result-score")!;
const resultKills = document.querySelector<HTMLElement>("#result-kills")!;
const resultHeadshots = document.querySelector<HTMLElement>("#result-headshots")!;
const resultCash = document.querySelector<HTMLElement>("#result-cash")!;

const shopOverlay = document.querySelector<HTMLElement>("#shop-overlay")!;
const shopCash = document.querySelector<HTMLElement>("#shop-cash")!;
const shopTimer = document.querySelector<HTMLElement>("#shop-timer")!;
const shopSubtitle = document.querySelector<HTMLElement>("#shop-subtitle")!;
const shopRoles = document.querySelector<HTMLElement>("#shop-roles")!;
const shopBuildSummary = document.querySelector<HTMLElement>("#shop-build-summary")!;
const upgradeGrid = document.querySelector<HTMLElement>("#upgrade-grid")!;
const buyRepairButton = document.querySelector<HTMLButtonElement>("#buy-repair")!;
const repairDescription = document.querySelector<HTMLElement>("#repair-description")!;
const readyPlayer1 = document.querySelector<HTMLElement>("#ready-player-1")!;
const readyPlayer2 = document.querySelector<HTMLElement>("#ready-player-2")!;
const shopMessage = document.querySelector<HTMLElement>("#shop-message")!;
const shopReadyButton = document.querySelector<HTMLButtonElement>("#shop-ready")!;

interface UpgradeCardElements {
  root: HTMLElement;
  level: HTMLElement;
  current: HTMLElement;
  next: HTMLElement;
  button: HTMLButtonElement;
}

let game: Phaser.Game | undefined;
let bannerTimeout: number | undefined;
let shopMessageTimeout: number | undefined;
let latestSnapshot: GameSnapshot | undefined;
const upgradeCards = new Map<UpgradeId, UpgradeCardElements>();

nameInput.value = localStorage.getItem("snakeTankName") ?? "";
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 4);
});

createButton.addEventListener("click", async () => {
  const name = getName();
  if (!name) return;
  setBusy(true, "Creating room…");
  try {
    const roomId = await network.createGame(name);
    enterGame();
    showBanner(`ROOM ${roomId}  •  SEND THIS CODE TO PLAYER 2`, 3600);
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});

joinButton.addEventListener("click", async () => {
  const name = getName();
  if (!name) return;
  const roomCode = codeInput.value.trim().toUpperCase();
  if (roomCode.length !== 4) {
    status.textContent = "Enter the four-character room code.";
    status.classList.add("error");
    return;
  }

  setBusy(true, "Joining room…");
  try {
    await network.joinGame(roomCode, name);
    enterGame();
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});

restartButton.addEventListener("click", () => {
  gameOver.classList.add("hidden");
  shopOverlay.classList.add("hidden");
  network.restart();
});

buyRepairButton.addEventListener("click", () => {
  audio.unlock();
  network.buyRepair();
});

shopReadyButton.addEventListener("click", () => {
  audio.unlock();
  const snapshot = latestSnapshot;
  if (!snapshot || snapshot.phase !== "intermission") return;
  const currentlyReady = snapshot.readySessionIds.includes(network.sessionId);
  network.setShopReady(!currentlyReady);
  audio.readyPing();
});

network.addEventListener("snapshot", (event) => {
  const snapshot = (event as CustomEvent<GameSnapshot>).detail;
  latestSnapshot = snapshot;
  updateHud(snapshot);
  updateShop(snapshot);
});

network.addEventListener("roles_swapped", () => { /* Shop shows the newly swapped roles live. */ });
network.addEventListener("roles_assigned", () => showBanner("STARTING ROLES RANDOMISED", 1900));
network.addEventListener("wave_start", (event) => {
  shopOverlay.classList.add("hidden");
  gameOver.classList.add("hidden");
  const detail = (event as CustomEvent<{ wave: number; waveType: WaveType }>).detail;
  showBanner(waveBanner(detail.wave, detail.waveType), detail.waveType === "NORMAL" ? 1800 : 3000);
});
network.addEventListener("wave_complete", (event) => {
  const detail = (event as CustomEvent<{ wave: number; repair: number }>).detail;
  const maintenance = detail.repair > 0 ? ` • FIELD MAINTENANCE +${detail.repair} HP` : "";
  showBanner(`WAVE ${detail.wave} CLEARED • ROLES SWAPPED${maintenance} • ARMORY OPEN`, 2300);
});
network.addEventListener("upgrade_purchased", (event) => {
  const detail = (event as CustomEvent<{ purchaser: string; name: string; level: number; cost: number }>).detail;
  showShopMessage(`${detail.purchaser} upgraded ${detail.name} to Lv.${detail.level}  •  -$${detail.cost.toLocaleString()}`);
  audio.purchase();
});
network.addEventListener("repair_purchased", (event) => {
  const detail = (event as CustomEvent<{ purchaser: string; restored: number; cost: number }>).detail;
  showShopMessage(`${detail.purchaser} repaired +${detail.restored} integrity  •  -$${detail.cost.toLocaleString()}`);
  audio.repair();
});
network.addEventListener("purchase_denied", (event) => {
  const detail = (event as CustomEvent<{ reason: string }>).detail;
  showShopMessage(detail.reason, true);
});
network.addEventListener("game_over", (event) => {
  shopOverlay.classList.add("hidden");
  const detail = (event as CustomEvent<{
    wave: number;
    score: number;
    cash: number;
    cashCollected: number;
    kills: number;
    headshots: number;
  }>).detail;
  resultWave.textContent = String(detail.wave);
  resultScore.textContent = detail.score.toLocaleString();
  resultCash.textContent = `$${(detail.cashCollected ?? detail.cash).toLocaleString()}`;
  resultKills.textContent = detail.kills.toLocaleString();
  resultHeadshots.textContent = detail.headshots.toLocaleString();
  window.setTimeout(() => gameOver.classList.remove("hidden"), 550);
});

function getName() {
  const name = nameInput.value.trim().slice(0, 18);
  if (!name) {
    status.textContent = "Enter your name first.";
    status.classList.add("error");
    return "";
  }
  localStorage.setItem("snakeTankName", name);
  return name;
}

function enterGame() {
  lobby.classList.add("hidden");
  gameShell.classList.remove("hidden");
  if (!game) {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-root",
      width: 1600,
      height: 900,
      backgroundColor: "#42573d",
      scene: [GameScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        roundPixels: false,
      },
    });
  }
}

function updateHud(snapshot: GameSnapshot) {
  hudRoom.textContent = snapshot.roomId;
  hudWave.textContent = snapshot.wave > 0 ? `WAVE ${snapshot.wave}` : "WAITING";
  hudWaveType.textContent = prettyWaveType(snapshot.waveType);
  hudWaveType.dataset.type = snapshot.waveType;
  hudEnemies.textContent = snapshot.phase === "combat" ? `${snapshot.snakesRemaining} LEFT` : phaseLabel(snapshot);
  hudTimer.textContent = snapshot.phase === "intermission"
    ? formatTime(snapshot.timeLeftMs)
    : snapshot.phase === "combat" ? "SURVIVE" : "";
  hudScore.textContent = snapshot.score.toLocaleString();
  hudCash.textContent = `$${snapshot.cash.toLocaleString()}`;

  const healthRatio = Math.max(0, Math.min(1, snapshot.tank.health / snapshot.tank.maxHealth));
  hudHealthText.textContent = `${Math.ceil(snapshot.tank.health)} / ${snapshot.tank.maxHealth}`;
  hudHealthFill.style.width = `${healthRatio * 100}%`;
  hudHealthFill.classList.toggle("warning", healthRatio <= 0.45 && healthRatio > 0.22);
  hudHealthFill.classList.toggle("critical", healthRatio <= 0.22);

  const me = snapshot.players.find((p) => p.sessionId === network.sessionId);
  hudRole.textContent = me?.role.toUpperCase() ?? "WAITING";
  hudRole.dataset.role = me?.role ?? "waiting";

  if (snapshot.players.length < 2) {
    waitingBanner.classList.remove("hidden");
    waitingBanner.textContent = `Waiting for player 2… Room ${snapshot.roomId}`;
    controlsText.textContent = "Share the room code with the second player.";
  } else {
    waitingBanner.classList.add("hidden");
    if (snapshot.phase === "gameover") controlsText.textContent = "RUN OVER — either player can restart";
    else if (snapshot.phase === "intermission") controlsText.textContent = "ARMORY OPEN — spend shared cash, then both players ready up";
    else {
      controlsText.textContent = me?.role === "driver"
        ? "DRIVER — WASD / ARROWS • kite the horde • collect cash crates"
        : `GUNNER — MOUSE to aim • HOLD CLICK / SPACE • HEADSHOTS deal ${snapshot.combatStats.headshotMultiplier}× damage`;
    }
  }
}

function updateShop(snapshot: GameSnapshot) {
  const open = snapshot.phase === "intermission" && snapshot.players.length === 2;
  shopOverlay.classList.toggle("hidden", !open);
  if (!open) return;

  if (upgradeCards.size === 0) buildUpgradeCards(snapshot.upgrades);

  shopCash.textContent = `$${snapshot.cash.toLocaleString()}`;
  shopTimer.textContent = formatTime(snapshot.timeLeftMs);
  shopSubtitle.textContent = `Wave ${snapshot.wave} cleared. Build for Wave ${snapshot.wave + 1} before the timer expires.`;
  shopRoles.textContent = snapshot.players
    .map((player) => `${player.name} → ${player.role.toUpperCase()}`)
    .join("   •   ");

  const stats = snapshot.combatStats;
  shopBuildSummary.textContent = `${stats.bodyDamage} body • ${stats.headDamage} head • ${(1000 / stats.fireIntervalMs).toFixed(1)} rps • ${stats.forwardSpeed} speed • ${stats.maxHealth} HP`;

  for (const upgrade of snapshot.upgrades) {
    const elements = upgradeCards.get(upgrade.id);
    if (!elements) continue;
    elements.level.textContent = `LV ${upgrade.level} / ${upgrade.maxLevel}`;
    elements.current.textContent = upgrade.currentEffect;
    elements.next.textContent = upgrade.maxed ? "Maximum upgrade reached" : `NEXT  ${upgrade.nextEffect}`;
    elements.root.classList.toggle("maxed", upgrade.maxed);
    const affordable = upgrade.cost !== null && snapshot.cash >= upgrade.cost;
    elements.button.disabled = upgrade.maxed || !affordable;
    elements.button.textContent = upgrade.maxed ? "MAXED" : `$${upgrade.cost?.toLocaleString()}`;
    elements.button.classList.toggle("affordable", affordable && !upgrade.maxed);
  }

  repairDescription.textContent = `Restore up to ${snapshot.repair.restore} integrity • ${Math.ceil(snapshot.tank.health)} / ${snapshot.tank.maxHealth} HP`;
  buyRepairButton.textContent = snapshot.tank.health >= snapshot.tank.maxHealth - 0.5
    ? "FULL INTEGRITY"
    : `REPAIR • $${snapshot.repair.cost.toLocaleString()}`;
  buyRepairButton.disabled = !snapshot.repair.canBuy;

  const readyIds = new Set(snapshot.readySessionIds);
  updateReadyPill(readyPlayer1, snapshot.players[0], readyIds);
  updateReadyPill(readyPlayer2, snapshot.players[1], readyIds);

  const meReady = readyIds.has(network.sessionId);
  shopReadyButton.classList.toggle("is-ready", meReady);
  shopReadyButton.textContent = meReady
    ? "READY ✓ — CLICK TO CANCEL"
    : `READY FOR WAVE ${snapshot.wave + 1}`;
}

function buildUpgradeCards(upgrades: UpgradeSnapshot[]) {
  upgradeGrid.innerHTML = "";
  for (const upgrade of upgrades) {
    const root = document.createElement("article");
    root.className = `upgrade-card upgrade-${upgrade.id.toLowerCase()}`;

    const header = document.createElement("div");
    header.className = "upgrade-card-header";
    const titleWrap = document.createElement("div");
    const kicker = document.createElement("span");
    kicker.className = "upgrade-kicker";
    kicker.textContent = upgrade.shortName;
    const title = document.createElement("strong");
    title.textContent = upgrade.name;
    titleWrap.append(kicker, title);
    const level = document.createElement("span");
    level.className = "upgrade-level";
    header.append(titleWrap, level);

    const description = document.createElement("p");
    description.textContent = upgrade.description;
    const current = document.createElement("div");
    current.className = "upgrade-current";
    const next = document.createElement("div");
    next.className = "upgrade-next";
    const button = document.createElement("button");
    button.className = "shop-buy";
    button.addEventListener("click", () => {
      audio.unlock();
      network.buyUpgrade(upgrade.id);
    });

    root.append(header, description, current, next, button);
    upgradeGrid.append(root);
    upgradeCards.set(upgrade.id, { root, level, current, next, button });
  }
}

function updateReadyPill(element: HTMLElement, player: GameSnapshot["players"][number] | undefined, readyIds: Set<string>) {
  if (!player) {
    element.textContent = "WAITING";
    element.classList.remove("ready");
    return;
  }
  const ready = readyIds.has(player.sessionId);
  element.textContent = `${player.name.toUpperCase()} • ${ready ? "READY ✓" : "CHOOSING"}`;
  element.classList.toggle("ready", ready);
}

function phaseLabel(snapshot: GameSnapshot) {
  if (snapshot.phase === "intermission") return "ARMORY";
  if (snapshot.phase === "gameover") return "DESTROYED";
  return "STANDBY";
}

function formatTime(ms: number) {
  const total = Math.ceil(ms / 1000);
  return `00:${String(Math.max(0, total)).padStart(2, "0")}`;
}

function prettyWaveType(type: WaveType) {
  if (type === "BONUS_MONEY") return "BONUS CASH";
  if (type === "VOLATILE_SNAKES") return "VOLATILE";
  if (type === "BLACKOUT") return "BLACKOUT";
  if (type === "FRENZY") return "FRENZY";
  if (type === "TITAN_NEST") return "TITAN NEST";
  return "NORMAL";
}

function waveBanner(wave: number, type: WaveType) {
  if (type === "BONUS_MONEY") return `WAVE ${wave}  •  CASH SURGE — CRATES SPAWN ~3× FASTER`;
  if (type === "VOLATILE_SNAKES") return `WAVE ${wave}  •  VOLATILE — KEEP YOUR DISTANCE`;
  if (type === "BLACKOUT") return `WAVE ${wave}  •  BLACKOUT — LIMITED VISIBILITY`;
  if (type === "FRENZY") return `WAVE ${wave}  •  FRENZY — FAST, DENSE HORDE`;
  if (type === "TITAN_NEST") return `WAVE ${wave}  •  TITAN NEST — HEAVY TARGETS`;
  return `WAVE ${wave} — INCOMING`;
}

function showBanner(text: string, duration = 1800) {
  if (bannerTimeout) window.clearTimeout(bannerTimeout);
  eventBanner.textContent = text;
  eventBanner.classList.remove("hidden");
  bannerTimeout = window.setTimeout(() => eventBanner.classList.add("hidden"), duration);
}

function showShopMessage(text: string, error = false) {
  if (shopMessageTimeout) window.clearTimeout(shopMessageTimeout);
  shopMessage.textContent = text;
  shopMessage.classList.toggle("error", error);
  shopMessage.classList.add("active");
  shopMessageTimeout = window.setTimeout(() => {
    shopMessage.textContent = "Both players share one upgrade build and one cash pool.";
    shopMessage.classList.remove("active", "error");
  }, 2600);
}

function setBusy(busy: boolean, message?: string) {
  createButton.disabled = busy;
  joinButton.disabled = busy;
  if (message) {
    status.textContent = message;
    status.classList.remove("error");
  }
}

function showError(error: unknown) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  status.textContent = `Could not connect: ${message}`;
  status.classList.add("error");
}
