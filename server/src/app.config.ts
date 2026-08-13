import { defineRoom, defineServer } from "colyseus";
import cors from "cors";
import { TankRoom } from "./rooms/TankRoom";
import { leaderboardStore } from "./leaderboard";

export const server = defineServer({
  rooms: { snake_blitz: defineRoom(TankRoom) },
  express: (app) => {
    const configuredOrigins = (process.env.CLIENT_ORIGIN || "")
      .split(",")
      .map(origin => origin.trim())
      .filter(Boolean);
    const localOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];
    const allowedOrigins = new Set([...configuredOrigins, ...localOrigins]);
    app.use(cors({
      origin(origin, callback) {
        if (!origin || configuredOrigins.length === 0 || allowedOrigins.has(origin)) return callback(null, true);
        callback(new Error("Origin not allowed"));
      },
    }));
    app.use((_req: any, res: any, next: any) => { res.setHeader("Cache-Control", "no-store"); next(); });
    app.get("/", (_req: any, res: any) => res.json({ ok: true, game: "Snake Blitz", version: "release-candidate" }));
    app.get("/health", (_req: any, res: any) => res.json({ ok: true }));
    app.get("/api/leaderboard", (_req: any, res: any) => res.json({ entries: leaderboardStore.getTop10() }));
  },
});
