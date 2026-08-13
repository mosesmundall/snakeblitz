# Snake Blitz — Release Candidate v0.5.0

This build includes the Phase 4 ultra-performance renderer plus the persistent server-authoritative top-10 leaderboard, homepage leaderboard modal, Game Over leaderboard, and Back to Home flow. Production deployment is documented in `DEPLOY_SNAKEBLITZ.md`.

# Snake Blitz — Phase 4

Two-player browser co-op survival game built with Phaser + Colyseus.

## Phase 4 headline features

- **Snake Blitz** branding throughout the user-facing game.
- **Online code mode** for two devices, plus **Local Co-op** for two people on one keyboard/mouse computer.
- **3600 × 2100 scrolling battlefield** (~5.25× the Phase 3 map area) with camera dead-zone, roads, rocks, wrecks, towers and three field bases.
- **Circular tactical minimap** shows the whole battlefield, camera footprint, major structures, tank heading and active boss location.
- Server-authoritative driver/gunner roles, with roles swapped every cleared wave and after boss waves.
- Progressive enemy roster: normal snakes, bomber snakes, ranged venom snakes and cash snakes.
- Real boss fights every 10 waves with state-machine mechanics and scaling boss tiers.
- Boss families: Coil Striker, Lace Monitor and Cobra Sentinel. Wave 50+ boss rounds add additional sequential boss encounters.
- Blitz economy curve: 10× at wave start, 5× at 10s, 3× at 20s, 1× at 30s, then late-wave tax pressure down to 0× at 90s.
- Seven upgrade paths with progress bars. Siege Ordnance adds projectile size/splash and evolves into heavy shells and rockets.
- Tank visuals evolve with armour, engine, loader, scavenger and ordnance upgrades.
- Boss reward wheel and persistent consumable inventory: Overdrive, Medkit, Phoenix auto-revive, Shock Bomb, rare Nuke, and Requisition Cache.
- **Three-track background music playlist** using the supplied Audiio tracks, loudness-normalised and compressed for web delivery. Music and SFX can be toggled independently from the lobby and game-over screen; preferences persist in the browser.
- **Tank audio pass:** heavier procedural cannon blast, continuous idling engine, acceleration/load/deceleration pitch behaviour, and engine-tone evolution with Engine upgrades.

## Start locally

Existing Phase 3 users do not need new npm dependencies.

Server:
```powershell
cd server
npm run dev
```

Client:
```powershell
cd client
npm run dev
```

Open `http://localhost:5173`.

## Controls

### Online
Driver: WASD / arrows. Gunner: mouse aim + left click or Space.

### Local co-op
One person uses WASD / arrows while the other uses the mouse. The names/roles still swap after every wave, so the two people physically trade controls.

### Boosts
Right mouse button cycles stored boosts. Middle mouse button uses the selected boost.

## Boss rules

Every 10th wave is a boss wave. Bosses have protected/attack phases and exposed windows. Accuracy during exposed windows is rewarded. From Wave 50 onward, boss waves contain additional boss encounters before the reward wheel opens.


## Audio

Included background tracks:
- Strategic Invasion — Liam Back
- Lost Signal — Lightning Traveler
- Trouble In Darkness — Brad Hill

The original supplied WAV files are converted to 160 kbps MP3 and loudness-normalised for a smaller, more consistent web build. The playlist cycles continuously during gameplay at a restrained background volume.

Audio settings are stored in `localStorage` as `snakeBlitzMusic` and `snakeBlitzSfx`.
