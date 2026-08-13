import fs from "fs";
import path from "path";

export interface LeaderboardEntry {
  id: string;
  players: [string, string];
  wave: number;
  score: number;
  kills: number;
  headshots: number;
  mode: "online" | "local";
  achievedAt: string;
}

interface LeaderboardFile { entries: LeaderboardEntry[]; }

class LeaderboardStore {
  private readonly filePath: string;
  private entries: LeaderboardEntry[] = [];

  constructor() {
    this.filePath = process.env.LEADERBOARD_PATH || path.resolve(process.cwd(), "data", "leaderboard.json");
    this.load();
  }

  private load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (!fs.existsSync(this.filePath)) {
        this.persist();
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as LeaderboardFile | LeaderboardEntry[];
      const raw = Array.isArray(parsed) ? parsed : parsed?.entries;
      if (Array.isArray(raw)) this.entries = this.sortAndTrim(raw.map(entry => this.normalize(entry)));
    } catch (error) {
      console.error("[Snake Blitz] leaderboard load failed; starting with an empty table", error);
      this.entries = [];
    }
  }

  getTop10() { return this.entries.map(entry => ({ ...entry, players: [...entry.players] as [string, string] })); }

  submit(run: Omit<LeaderboardEntry, "id" | "achievedAt">) {
    const entry: LeaderboardEntry = {
      ...run,
      players: [this.cleanName(run.players[0]), this.cleanName(run.players[1])],
      wave: Math.max(0, Math.floor(run.wave)),
      score: Math.max(0, Math.floor(run.score)),
      kills: Math.max(0, Math.floor(run.kills)),
      headshots: Math.max(0, Math.floor(run.headshots)),
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      achievedAt: new Date().toISOString(),
    };

    const ranked = this.sortAndTrim([...this.entries, entry]);
    const rankIndex = ranked.findIndex(item => item.id === entry.id);
    this.entries = ranked;
    this.persist();
    return { rank: rankIndex >= 0 ? rankIndex + 1 : null, entry, entries: this.getTop10() };
  }

  private sortAndTrim(entries: LeaderboardEntry[]) {
    return entries
      .sort((a, b) => b.wave - a.wave || b.score - a.score || a.achievedAt.localeCompare(b.achievedAt))
      .slice(0, 10);
  }

  private normalize(entry: LeaderboardEntry): LeaderboardEntry {
    const players = Array.isArray(entry.players) ? entry.players : ["Player 1", "Player 2"];
    return {
      id: String(entry.id || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`),
      players: [this.cleanName(players[0]), this.cleanName(players[1])],
      wave: Math.max(0, Math.floor(Number(entry.wave) || 0)),
      score: Math.max(0, Math.floor(Number(entry.score) || 0)),
      kills: Math.max(0, Math.floor(Number(entry.kills) || 0)),
      headshots: Math.max(0, Math.floor(Number(entry.headshots) || 0)),
      mode: entry.mode === "local" ? "local" : "online",
      achievedAt: entry.achievedAt || new Date().toISOString(),
    };
  }

  private persist() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ entries: this.entries }, null, 2), "utf8");
      try {
        fs.renameSync(tmp, this.filePath);
      } catch {
        // Windows can refuse an atomic rename over an existing file. Fall back
        // to a direct copy so local development still persists the leaderboard.
        fs.copyFileSync(tmp, this.filePath);
        fs.unlinkSync(tmp);
      }
    } catch (error) {
      console.error("[Snake Blitz] leaderboard save failed", error);
    }
  }

  private cleanName(value: unknown) {
    const cleaned = String(value ?? "Player").replace(/[<>]/g, "").trim().slice(0, 18);
    return cleaned || "Player";
  }
}

export const leaderboardStore = new LeaderboardStore();
