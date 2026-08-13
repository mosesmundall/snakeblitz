SNAKE BLITZ — PHASE 4 PERFORMANCE + UI HOTFIX

This patch is designed to go over the current Phase 4 build, including the local co-op room-code hotfix.
No npm install is required.

CHANGES
- Shows the exact clear multiplier when a wave ends.
- Armory has a dedicated CLEAR MULTIPLIER readout.
- Lobby spacing/padding improved.
- Default name placeholders are Player 1 / Player 2 (no hard-coded Moses/Anna placeholders).
- Local name boxes start blank so the placeholders are visible.
- Tactical minimap is zoomed around the tank and fills its circular HUD instead of showing a small rectangular full-map insert.
- Boss marker stays visible: distant bosses clamp to the edge of the tactical map.
- Performance pass:
  * server simulation 60 -> 50 Hz (same dt-based gameplay)
  * network snapshots 20 -> ~15 Hz with interpolation retained
  * DOM HUD updates batched to ~10 Hz
  * minimap redraws ~10 Hz rather than every rendered frame
  * off-screen snakes and cash visuals are culled
  * snake body animation capped around 30 Hz while movement interpolation remains smooth
  * effect particle counts adapt only under heavy horde load
- Includes the prior local co-op room allocation fix.

INSTALL
1. Stop both server and client with Ctrl+C.
2. Copy everything INSIDE this hotfix folder into your existing Snake Blitz project root.
3. Choose Replace files in destination.
4. Do not delete node_modules and do not run npm install.
5. Start server: npm run dev
6. Start client: npm run dev
7. Open http://localhost:5173 and hard-refresh with Ctrl+Shift+R.

TEST FIRST
- Local co-op starts.
- Online room code still starts.
- Clear Wave 1 and check the clear multiplier banner + Armory readout.
- Drive around and check the circular tactical minimap.
- Play several increasingly busy waves and compare stutter/freezing with the previous build.
