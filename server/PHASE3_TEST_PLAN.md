# Phase 3 focused test plan

## Armory opening
- Clear a wave.
- Armory should appear on both clients for 24 seconds.
- Roles should already be swapped and shown in the armory.

## Shared cash
- Both clients must show identical cash.
- Buy one upgrade on Client A.
- Client B must see the level/cash update without refreshing.

## Server validation
- A button should be disabled when unaffordable.
- Even if a client sends an invalid/unaffordable purchase manually, the server refuses it.
- Max-level upgrades cannot be purchased again.

## Stat effects
- AP Ammunition changes body/head damage values.
- Autoloader increases rounds per second.
- Engine Tune increases movement/turning values.
- Armour adds 25 maximum integrity and 25 current integrity when bought.
- High-Velocity Shells increases projectile velocity.
- Scavenger Rig increases crate value and pickup radius.
- Emergency Repair restores up to 35 integrity and cannot be bought at full health.

## Ready flow
- Client A Ready -> game remains in armory.
- Client B Ready -> next wave starts immediately.
- If either player purchases after readying, that player's ready state is cleared.
- If nobody readies, the timer starts the next wave automatically.

## Run reset
- Die and restart.
- All upgrade levels reset to zero.
- Maximum integrity returns to 100.
- Starting team cash returns to $200.
