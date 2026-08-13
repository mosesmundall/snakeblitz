# Phase 2 test plan

Use two browser windows/devices in the same room.

## First five minutes

1. Confirm one player is Driver and one is Gunner.
2. Confirm snakes enter from the arena edges and chase the tank.
3. Shoot snake bodies and note the small green damage number (`12`).
4. Shoot snake heads and confirm `HEADSHOT 48` appears.
5. Drive around rocks/wrecks and confirm the tank cannot pass through them.
6. Let a snake reach the tank and confirm tank integrity drops.
7. Collect a gold cash crate before its countdown expires.
8. Kill every snake and confirm the wave does not end until the final enemy dies.
9. Confirm both roles swap during the five-second intermission.
10. Confirm 8 HP of field repair is applied where possible.

## Special wave testing

Special waves begin from Wave 3. They are deliberately random.

- BONUS CASH: three crates appear immediately; more crates continue spawning around 3x the normal frequency.
- VOLATILE: orange-glowing snakes can detonate when hit or killed. The blast can damage the tank and other snakes.
- BLACKOUT: most of the arena becomes dark; visibility follows the shared tank.
- FRENZY: more enemies, smaller bodies, lower individual HP and substantially more speed.
- TITAN NEST: fewer enemies, much larger bodies and substantially higher HP.

## Game over

Allow the tank to reach 0 HP. Both players should see the results overlay. Either player can press `Run it again`; the run resets and starting roles randomise again.
