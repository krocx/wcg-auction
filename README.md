# WCG Champions League — Mega Draft Auction

Live auction site for the Weekend Cricket Group: an auctioneer console, a live display for the TV / captains' phones, and squad pages. No build step, **zero npm dependencies** (Node 18+).

| Page | Who | What |
|---|---|---|
| `/` | everyone | Banner, rules, links |
| `/live` | TV, captains, spectators | Live player, bids, purses, SOLD / UNSOLD moments, "My team" highlight |
| `/squads` | everyone | Squads and prices as they fill; copy to WhatsApp, print/PDF, CSV |
| `/host` | auctioneer only | Draw players, take bids, sell. Protected by `HOST_PIN` |

## Run locally
```bash
HOST_PIN=mysecret node server.js     # http://localhost:3000
npm test                             # simulates full auctions against the rules
```

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** → select the repo (uses `render.yaml`). Enter a **HOST_PIN** when asked.
   (Or New → Web Service: build `npm install`, start `node server.js`, add env var `HOST_PIN`.)
3. Open `https://<your-app>.onrender.com/host`, enter the PIN. Put `/live` on the TV.

### Free tier caveat (read before auction night)
Render's free web services sleep after ~15 min idle and have no persistent disk, so a restart wipes the server's auction data. Protections built in:
- The host browser silently keeps a backup of the latest state. If the server comes back empty, `/host` shows **"Restore it now"**.
- Menu → **Backup JSON** / **Restore backup** for a manual copy.
- Safest: use a paid instance with a disk (see `render.yaml`) and set `DATA_DIR=/var/data`, or at least open `/host` ten minutes early so the instance is warm.

## Rules implemented (from `WCL_revised_auction.xlsx`)
- 5 teams / captains, **$70M** purse each, 32 players in 4 categories with the sheet's per-player base prices.
- **Squad 7–8 including the captain**, so each team buys 6–7 players (30 + 2 spare = 32; two teams get a 7th).
- **At least one player per category** per team.
- IPL-style open bidding: +$1M steps up to $20M, +$2M above (jump bids allowed in $0.5M steps).
- Players come in Category 1 → 4 sets, random within each set. "Going once / twice / SOLD".
- **Round 2:** unsold players return; the host can assign at base price to a team that still needs players (the app prompts when only one team needs a player).
- **Rule guard:** every bid is checked so no team can spend itself out of completing a valid squad, and so the remaining pool can always be placed — the auction cannot dead-end. Each team's exact **max bid** is shown on the host and live screens.

## Host shortcuts
`1`–`5` bid for a team · `Space` going once → twice → SOLD · `N` draw next · `U` unsold · `B` undo last bid. Menu has Undo last action, rename teams, results CSV, backup/restore, reset.

## Notes
- Team names/logos are from the banner; rename in Menu → Team names & settings (before or during).
- Sound on `/live` is off until a viewer taps "Sound".
