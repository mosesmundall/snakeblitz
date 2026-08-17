import { Client, Room } from "@colyseus/sdk";
import type { GameSnapshot, LeaderboardEntry } from "./types";

function defaultServerUrl() {
  const configured = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:2567`;
}

type ConnectionState = "idle" | "connected" | "reconnecting" | "left";

export interface TestLaunchOptions {
  secret: string;
  wave: number;
  maxUpgrades: boolean;
  fullHealth: boolean;
  testEquipment: boolean;
}

function testRoomPayload(test?:TestLaunchOptions){
  if(!test)return {};
  return {
    testMode:true,
    testSecret:test.secret,
    testWave:test.wave,
    testMaxUpgrades:test.maxUpgrades,
    testFullHealth:test.fullHealth,
    testEquipment:test.testEquipment,
  };
}

export class GameNetwork extends EventTarget {
  readonly serverUrl = defaultServerUrl();
  readonly client = new Client(this.serverUrl);
  room?: Room; snapshot?: GameSnapshot; sessionId = "";
  connectionState:ConnectionState="idle";
  lastSnapshotAt=0;
  private staleNotified=false;

  constructor(){
    super();
    window.setInterval(()=>{
      if(!this.room||this.connectionState!=="connected"||!this.lastSnapshotAt)return;
      const age=performance.now()-this.lastSnapshotAt;
      if(age>=1500&&!this.staleNotified){
        this.staleNotified=true;
        this.dispatchEvent(new CustomEvent("connection_stalled",{detail:{ageMs:Math.round(age)}}));
      }
    },500);
  }

  async createGame(name: string, test?:TestLaunchOptions) {
    const room = await this.client.create("snake_blitz", { mode: "online", name, ...testRoomPayload(test) });
    this.attach(room); return room.roomId;
  }
  async createLocalGame(name1: string, name2: string, test?:TestLaunchOptions) {
    const room = await this.client.create("snake_blitz", { mode: "local", name1, name2, ...testRoomPayload(test) });
    this.attach(room); return room.roomId;
  }
  async joinGame(roomCode: string, name: string) {
    const room = await this.client.joinById(roomCode.trim().toUpperCase(), { name });
    this.attach(room); return room.roomId;
  }
  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const response = await fetch(`${this.serverUrl}/api/leaderboard`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Leaderboard unavailable (${response.status})`);
    const data = await response.json() as { entries?: LeaderboardEntry[] };
    return Array.isArray(data.entries) ? data.entries : [];
  }
  async leaveGame() {
    const room = this.room;
    this.room = undefined; this.snapshot = undefined; this.sessionId = ""; this.connectionState="idle";this.lastSnapshotAt=0;this.staleNotified=false;
    if (room) {
      try { await room.leave(); } catch { /* room may already be closed */ }
    }
  }

  private canSend(){return Boolean(this.room)&&this.connectionState==="connected";}
  sendDrive(throttle: number, turn: number) { if(this.canSend())this.room!.send("drive", { throttle, turn }); }
  sendAim(angle: number) { if(this.canSend())this.room!.send("aim", { angle }); }
  sendFiring(firing: boolean) { if(this.canSend())this.room!.send("firing", { firing }); }
  buyUpgrade(id: string) { if(this.canSend())this.room!.send("buy_upgrade", { id }); }
  buyRepair() { if(this.canSend())this.room!.send("buy_repair"); }
  setShopReady(ready: boolean) { if(this.canSend())this.room!.send("shop_ready", { ready }); }
  cycleBoost(direction = 1) { if(this.canSend())this.room!.send("cycle_boost", { direction }); }
  useBoost() { if(this.canSend())this.room!.send("use_boost"); }
  spinBossReward() { if(this.canSend())this.room!.send("spin_boss_reward"); }
  continueAfterBoss() { if(this.canSend())this.room!.send("continue_after_boss"); }
  restart() { if(this.canSend())this.room!.send("restart"); }

  private attach(room: Room) {
    this.room = room; this.sessionId = room.sessionId;this.connectionState="connected";this.lastSnapshotAt=performance.now();this.staleNotified=false;
    room.onMessage("room_info", (payload: any) => { this.sessionId = payload.sessionId ?? room.sessionId; this.dispatchEvent(new CustomEvent("room_info", { detail: payload })); });
    room.onMessage("snapshot", (snapshot: GameSnapshot) => {
      this.snapshot = snapshot;this.lastSnapshotAt=performance.now();
      if(this.staleNotified){this.staleNotified=false;this.dispatchEvent(new Event("connection_recovered"));}
      this.dispatchEvent(new CustomEvent("snapshot", { detail: snapshot }));
    });
    const passthrough = ["shot_fx","impact_fx","hit_fx","snake_death","explosion_fx","tank_hit","cash_pickup","roles_assigned","roles_swapped","wave_complete","wave_start","game_over","upgrade_purchased","repair_purchased","purchase_denied","shop_ready_changed","boss_phase","boss_defeated","boss_reward","boost_used","boost_denied","venom_shot","connection_status","test_boss_hp_increase"];
    for (const name of passthrough) room.onMessage(name, (payload: any) => this.dispatchEvent(new CustomEvent(name, { detail: payload })));
    room.onDrop((code:number)=>{this.connectionState="reconnecting";this.dispatchEvent(new CustomEvent("connection_drop",{detail:{code}}));});
    room.onReconnect(()=>{this.connectionState="connected";this.sessionId=room.sessionId;this.lastSnapshotAt=performance.now();this.staleNotified=false;this.dispatchEvent(new Event("reconnected"));});
    room.onError((code:number,message?:string)=>this.dispatchEvent(new CustomEvent("connection_error",{detail:{code,message:message??"Connection error"}})));
    room.onLeave((code?:number)=>{this.connectionState="left";this.dispatchEvent(new CustomEvent("left",{detail:{code:code??0}}));});
  }
}
export const network = new GameNetwork();