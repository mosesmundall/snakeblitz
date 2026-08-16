import { defineRoom, defineServer, matchMaker } from "colyseus";
import cors from "cors";
import { TankRoom } from "./rooms/TankRoom";
import { leaderboardStore } from "./leaderboard";
import { applyPhase1Balance } from "./balance/phase1";
import { applyPhase2Balance } from "./balance/phase2";
import { applyPhase3Balance } from "./balance/phase3";
import { applyPhase3Polish } from "./balance/phase3Polish";
import { applyPerformanceOptimizations } from "./balance/performance";

applyPhase1Balance(TankRoom);
applyPhase2Balance(TankRoom);
applyPhase3Balance(TankRoom);
applyPhase3Polish(TankRoom);
applyPerformanceOptimizations(TankRoom);
let latestEventLoopLagMs=0;
let maxEventLoopLagMs=0;
let eventLoopProbeAt=Date.now();
const eventLoopProbe=setInterval(()=>{
  const now=Date.now();
  latestEventLoopLagMs=Math.max(0,now-eventLoopProbeAt-1000);
  maxEventLoopLagMs=Math.max(maxEventLoopLagMs,latestEventLoopLagMs);
  eventLoopProbeAt=now;
  if(latestEventLoopLagMs>=250)console.warn(`[Snake Blitz] event-loop stall ${latestEventLoopLagMs}ms`);
},1000);
eventLoopProbe.unref();

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
    app.get("/api/status", (_req: any, res: any) => {
      const mem=process.memoryUsage();
      res.json({ok:true,ccu:matchMaker.stats.local.ccu,roomCount:matchMaker.stats.local.roomCount,uptimeSec:Math.round(process.uptime()),rssMB:Math.round(mem.rss/1048576),heapUsedMB:Math.round(mem.heapUsed/1048576),eventLoopLagMs:latestEventLoopLagMs,maxEventLoopLagMs});
    });
  },
});
