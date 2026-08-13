import { Client, Room } from "@colyseus/sdk";
import type { GameSnapshot } from "./types";

function defaultServerUrl() {
  const configured = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:2567`;
}

export class GameNetwork extends EventTarget {
  readonly client = new Client(defaultServerUrl());
  room?: Room;
  snapshot?: GameSnapshot;
  sessionId = "";

  async createGame(name: string) {
    const room = await this.client.create("tank_duo", { name });
    this.attach(room);
    return room.roomId;
  }

  async joinGame(roomCode: string, name: string) {
    const room = await this.client.joinById(roomCode.trim().toUpperCase(), { name });
    this.attach(room);
    return room.roomId;
  }

  sendDrive(throttle: number, turn: number) {
    this.room?.send("drive", { throttle, turn });
  }

  sendAim(angle: number) {
    this.room?.send("aim", { angle });
  }

  sendFiring(firing: boolean) {
    this.room?.send("firing", { firing });
  }

  buyUpgrade(id: string) {
    this.room?.send("buy_upgrade", { id });
  }

  buyRepair() {
    this.room?.send("buy_repair");
  }

  setShopReady(ready: boolean) {
    this.room?.send("shop_ready", { ready });
  }

  restart() {
    this.room?.send("restart");
  }

  private attach(room: Room) {
    this.room = room;
    this.sessionId = room.sessionId;

    room.onMessage("room_info", (payload: any) => {
      this.sessionId = payload.sessionId ?? room.sessionId;
      this.dispatchEvent(new CustomEvent("room_info", { detail: payload }));
    });

    room.onMessage("snapshot", (snapshot: GameSnapshot) => {
      this.snapshot = snapshot;
      this.dispatchEvent(new CustomEvent("snapshot", { detail: snapshot }));
    });

    const passthroughEvents = [
      "shot_fx",
      "impact_fx",
      "hit_fx",
      "snake_death",
      "explosion_fx",
      "tank_hit",
      "cash_pickup",
      "roles_assigned",
      "roles_swapped",
      "wave_complete",
      "wave_start",
      "game_over",
      "upgrade_purchased",
      "repair_purchased",
      "purchase_denied",
      "shop_ready_changed",
    ];

    for (const eventName of passthroughEvents) {
      room.onMessage(eventName, (payload: any) => {
        this.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
      });
    }

    room.onLeave(() => {
      this.dispatchEvent(new Event("left"));
    });
  }
}

export const network = new GameNetwork();
