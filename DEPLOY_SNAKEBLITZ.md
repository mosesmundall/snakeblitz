# Snake Blitz — Production Deployment Guide

This release is designed for this production layout:

- `snakeblitz.com` / `www.snakeblitz.com` — static Phaser/Vite game hosted on DreamHost
- `server.snakeblitz.com` — Colyseus multiplayer + leaderboard API hosted on a WebSocket-capable Node service
- Cloudflare — domain registrar and DNS provider

## Why the game server is separate from ordinary DreamHost shared hosting

The browser game itself is static HTML/CSS/JavaScript, so it is a good fit for DreamHost shared hosting. The Colyseus backend is different: it is a long-running Node.js process and uses WebSockets. DreamHost's ordinary shared hosting is not the right runtime for that server, and DreamHost's documented public Proxy Server does not support public WebSocket proxying. For the quickest reliable launch, keep the website on DreamHost and deploy the Colyseus server to a WebSocket-capable Node host such as Render.

The project is already configured so a production client build connects to:

`https://server.snakeblitz.com`

The backend persists the top-10 leaderboard to the file specified by `LEADERBOARD_PATH`.

---

## Part A — Final local playtest

1. Stop both current terminals with `Ctrl + C`.
2. Copy the final leaderboard hotfix over the current working Phase 4 project.
3. Start the server:

```powershell
cd C:\Users\fishi\Desktop\snake-tank-phase1\snake-tank-phase1\server
npm run dev
```

4. Start the client in a second terminal:

```powershell
cd C:\Users\fishi\Desktop\snake-tank-phase1\snake-tank-phase1\client
npm run dev
```

5. Open `http://localhost:5173`.
6. Play a run until Game Over and verify:
   - the leaderboard appears on the results screen;
   - both player names appear;
   - the wave and score are correct;
   - a qualifying run shows `NEW #N ALL-TIME`;
   - `RUN IT AGAIN` works;
   - `BACK TO HOME` returns to the lobby;
   - `VIEW LEADERBOARD` on the lobby loads the same top 10.
7. Restart the local server and open the leaderboard again. The entries should still exist in `server/data/leaderboard.json`.

---

## Part B — Put the project in GitHub for backend deployment

Git is already installed on the development PC.

From the project root:

```powershell
cd C:\Users\fishi\Desktop\snake-tank-phase1\snake-tank-phase1
git init
git add .
git commit -m "Snake Blitz release candidate"
```

Create a new private GitHub repository named something like `snake-blitz`, then add the repository URL GitHub gives you:

```powershell
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Do not upload `node_modules` or `dist`; the included `.gitignore` excludes them.

---

## Part C — Deploy the multiplayer/leaderboard server first

### Recommended production backend: Render Web Service

Create a new **Web Service** connected to the GitHub repository.

Use these settings:

- Root Directory: `server`
- Runtime: Node
- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`
- Health Check Path: `/health`
- Use a paid service tier that supports a persistent disk

Add these environment variables:

```text
CLIENT_ORIGIN=https://snakeblitz.com,https://www.snakeblitz.com
LEADERBOARD_PATH=/var/data/leaderboard.json
```

Do not manually set `PORT`; Render supplies it and Snake Blitz already reads `process.env.PORT`.

### Persistent leaderboard disk

Attach a persistent disk to the web service:

```text
Mount path: /var/data
```

The leaderboard file will therefore be:

```text
/var/data/leaderboard.json
```

Use the smallest disk size offered; the top-10 JSON file itself is tiny.

After deployment, Render gives the service an `onrender.com` hostname. Test:

```text
https://YOUR-RENDER-SERVICE.onrender.com/health
```

It should return:

```json
{"ok":true}
```

Then test:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/leaderboard
```

It should initially return an empty `entries` array unless the persistent disk already has scores.

---

## Part D — Give the backend the production hostname

In the Render service:

1. Open **Settings → Custom Domains**.
2. Add:

```text
server.snakeblitz.com
```

3. Render will show the exact target hostname for DNS.

In Cloudflare:

1. Open the `snakeblitz.com` zone.
2. Go to **DNS → Records**.
3. Add:

```text
Type: CNAME
Name: server
Target: YOUR-RENDER-SERVICE.onrender.com
Proxy status: DNS only
TTL: Auto
```

4. Remove any conflicting `server` A/AAAA/CNAME records.
5. Return to Render and click **Verify** for `server.snakeblitz.com`.
6. Wait until Render reports that its TLS certificate is issued and the domain is verified.
7. Test:

```text
https://server.snakeblitz.com/health
https://server.snakeblitz.com/api/leaderboard
```

Leave this Cloudflare record as **DNS only** for the initial launch. It can optionally be proxied through Cloudflare after everything is verified; Cloudflare supports proxied WebSockets, but changing fewer layers during first deployment makes troubleshooting easier.

---

## Part E — Add snakeblitz.com to DreamHost

In the DreamHost panel:

1. Go to **Manage Websites**.
2. Click **Add Website**.
3. Choose **Enter Domain Name**.
4. Enter:

```text
snakeblitz.com
```

5. Choose **Custom Setup** — do not install WordPress for this game.
6. Select the DreamHost hosting plan/server.
7. Choose/create the website user. A dedicated user for Snake Blitz is cleanest.
8. Complete setup.

DreamHost will create a website directory similar to:

```text
/home/YOUR_DREAMHOST_USER/snakeblitz.com
```

That directory is where the built game files must go.

---

## Part F — Point the Cloudflare domain at DreamHost

Because the domain is registered and DNS-hosted at Cloudflare, keep the Cloudflare nameservers and edit DNS there.

In DreamHost, find/copy the IPv4 address assigned to the hosted `snakeblitz.com` website.

In **Cloudflare → snakeblitz.com → DNS → Records**, set:

```text
A
Name: @
IPv4 address: YOUR_DREAMHOST_WEB_IP
Proxy status: DNS only
TTL: Auto
```

Then add:

```text
CNAME
Name: www
Target: snakeblitz.com
Proxy status: DNS only
TTL: Auto
```

Remove conflicting old `@`/`www` A, AAAA, or CNAME records that point somewhere else.

Keep the records **DNS only** until DreamHost SSL has been issued successfully.

---

## Part G — Add HTTPS to the DreamHost website

After Cloudflare DNS for `snakeblitz.com` resolves to DreamHost:

1. In DreamHost, open the website's **Secure Certificates** settings.
2. Add a free **Let's Encrypt** certificate for `snakeblitz.com`.
3. Wait until DreamHost reports the certificate as active.
4. Confirm `https://snakeblitz.com` loads over HTTPS.

If certificate issuance fails, first re-check that Cloudflare's root record is DNS-only and points directly at the DreamHost web IP.

---

## Part H — Build the production game on the PC

The client already contains:

```text
VITE_GAME_SERVER_URL=https://server.snakeblitz.com
```

Open PowerShell in the client folder:

```powershell
cd C:\Users\fishi\Desktop\snake-tank-phase1\snake-tank-phase1\client
npm run build
```

A production folder is created:

```text
client\dist
```

It should contain an `index.html`, an `assets` directory and the audio directory/files copied from `public`.

---

## Part I — Upload the game to DreamHost

Use either DreamHost's File Manager or SFTP.

For SFTP, use the credentials shown for the Snake Blitz website user in DreamHost. Use SFTP/port 22.

Navigate on the DreamHost server to:

```text
/home/YOUR_DREAMHOST_USER/snakeblitz.com
```

Delete the default placeholder/quickstart file if present.

Upload the **contents of `client/dist`**, not the `dist` folder itself.

Correct result:

```text
/home/YOUR_DREAMHOST_USER/snakeblitz.com/index.html
/home/YOUR_DREAMHOST_USER/snakeblitz.com/assets/...
/home/YOUR_DREAMHOST_USER/snakeblitz.com/audio/...
```

Not:

```text
/home/YOUR_DREAMHOST_USER/snakeblitz.com/dist/index.html
```

---

## Part J — Production test

Open a private/incognito browser and test:

```text
https://snakeblitz.com
```

Check in this order:

1. Lobby loads and music/SFX controls work.
2. `VIEW LEADERBOARD` opens and loads without an error.
3. One-device local co-op starts.
4. Online mode creates a four-character room code.
5. On a second device using a different internet connection if possible, open `https://snakeblitz.com` and join that code.
6. Driver movement and Gunner aim/fire synchronize.
7. Play until Game Over.
8. Verify the result appears in the top 10 if it qualifies.
9. Refresh both devices and confirm the leaderboard entry persists.
10. Test `RUN IT AGAIN` and `BACK TO HOME`.
11. Test audio toggles, minimap, special waves and a boss run if time permits.

Also directly check:

```text
https://server.snakeblitz.com/health
https://server.snakeblitz.com/api/leaderboard
```

---

## Part K — Optional Cloudflare proxy after launch

Once both DreamHost HTTPS and Render HTTPS are verified, you can optionally turn Cloudflare proxying (orange cloud) on for the web records. Cloudflare supports WebSockets on proxied hostnames.

For the first public test, keeping the records DNS-only is simpler and perfectly valid. The Cloudflare domain registration/DNS still remains in use.

---

## Updating Snake Blitz after launch

### Frontend-only update

```powershell
cd client
npm run build
```

Upload the new `dist` contents over the existing DreamHost website files.

### Server update

Commit and push the server changes to GitHub. If automatic deploys are enabled on Render, Render will rebuild/redeploy the server. The leaderboard survives because it is written to `/var/data`, which is on the persistent disk.

### Important

Do not overwrite or remove the Render persistent disk when deploying updates. The leaderboard is stored there.
