import { defineRoom, defineServer } from "colyseus";
import cors from "cors";
import { TankRoom } from "./rooms/TankRoom";

export const server = defineServer({
  rooms: {
    tank_duo: defineRoom(TankRoom),
  },
  express: (app) => {
    app.use(cors());
    app.get("/", (_req, res) => {
      res.json({ ok: true, game: "Snake Tank", version: "phase-2" });
    });
  },
});
