# Snake Blitz — Release Candidate Test Plan

## Leaderboard

- Complete a run and confirm the Game Over screen shows the top 10.
- Confirm both player names are correct.
- Confirm wave reached is correct.
- Confirm score is correct.
- Confirm a qualifying run says `NEW #N ALL-TIME`.
- Complete several runs and confirm the board sorts by wave first, then score.
- Restart the server and confirm scores persist.
- Confirm only the highest 10 stored runs are returned/displayed.
- Open the homepage leaderboard before joining a room and confirm it loads.
- Click Refresh and confirm it reloads.

## End screen navigation

- `RUN IT AGAIN` starts a new run in the existing room.
- `BACK TO HOME` leaves the room and returns to the lobby.
- After returning home, start another local game and ensure there are no duplicate input/event handlers.
- After returning home, create a new online room and ensure it works.

## Existing critical systems regression

- Local co-op Player 1/Player 2 controls and role swapping.
- Online create/join code.
- Smooth performance in dense waves.
- F3 performance overlay.
- Audio playlist and Music/SFX toggles.
- Engine audio.
- Circular minimap.
- Large scrolling map.
- Payout multiplier and end-of-wave clear multiplier.
- Upgrade shop.
- Boss rewards/boost inventory.
- Boss waves 10/20/30.
- Bomber, Venom and Cash snakes.

## Production smoke test

- `https://server.snakeblitz.com/health` returns `{"ok":true}`.
- `https://server.snakeblitz.com/api/leaderboard` returns JSON.
- `https://snakeblitz.com` loads with no mixed-content errors.
- Online room works between two separate devices/networks.
- A completed production run persists to the leaderboard after refresh/restart.
