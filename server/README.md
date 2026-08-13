# Snake Tank — Phase 3 Armory Build

A two-player browser co-op survival game built with Phaser + Colyseus.

## Phase 3 adds the upgrade economy

Everything from the Phase 2 combat build remains, plus a server-authoritative between-wave armory.

- Shared team cash pool.
- $200 starting requisition so the first shop already offers a meaningful choice.
- Cash crates remain the main source of upgrade money; ordinary waves bring the first crate in earlier so the economy starts moving quickly.
- 24-second armory between cleared waves.
- Driver/Gunner roles still swap after every wave; the armory shows both players their next role.
- Both players see the same live cash, levels, tank stats and ready state.
- Either player can buy upgrades from the shared pool.
- Purchases are validated and applied on the server.
- Both players can mark Ready; when both are ready, the next wave starts immediately instead of waiting for the timer.
- If the timer expires, the next wave begins automatically.
- Buying something automatically removes that player's Ready state so accidental early starts are avoided.
- A small +5 integrity field-maintenance bonus remains after a clear; larger repairs cost cash.

## Upgrade paths

| Upgrade | Effect | Starting cost | Max level |
|---|---|---:|---:|
| AP Ammunition | +18% base shell damage per level; headshots remain 4x | $240 | 8 |
| Autoloader | ~10% shorter reload interval per level | $280 | 7 |
| Engine Tune | +7.5% forward/reverse speed and stronger steering per level | $220 | 7 |
| Reinforced Armour | +25 maximum integrity per level and restores the added armour immediately | $330 | 6 |
| High-Velocity Shells | +11% projectile speed per level | $180 | 6 |
| Scavenger Rig | +10% crate value and +14% pickup radius per level | $240 | 5 |
| Emergency Repair | Restores up to 35 integrity; price scales gradually with wave | varies | repeatable |

Upgrade prices scale each time a level is purchased, forcing teams to decide between specialising heavily and spreading money across the build.

## Run locally

No new npm dependencies were added in Phase 3. If Phase 2 already runs on your computer, replace the Phase 2 files with the Phase 3 upgrade files and restart both terminals.

### Server

```powershell
cd server
npm run dev
```

### Client

```powershell
cd client
npm run dev
```

Open `http://localhost:5173`.

## Phase 3 pass checklist

1. Clear Wave 1.
2. Confirm Driver/Gunner roles swap and the Armory opens.
3. Confirm both screens show the same team cash and upgrade levels.
4. Purchase High-Velocity Shells or another affordable upgrade.
5. Confirm the purchase appears on both screens and cash falls on both screens.
6. Buy armour after collecting enough cash; max tank integrity should increase by 25.
7. Take damage, then buy Emergency Repair between waves.
8. Mark one player Ready and confirm the game waits.
9. Mark the second player Ready and confirm the next wave starts immediately.
10. Confirm upgrades persist into later waves and reset when the run is restarted after game over.

## Next phase

Phase 4 will focus on run progression and high-score structure: stronger scoring design, polished game-over/run summary, persistent leaderboard foundations, and additional progression/balance work before public deployment.
