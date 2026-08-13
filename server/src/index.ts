import { server } from "./app.config";
const port = Number(process.env.PORT ?? 2567);
server.listen(port);
console.log(`[Snake Blitz] multiplayer server listening on http://0.0.0.0:${port}`);
