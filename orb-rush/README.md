# Orb Rush

A small three.js game for [start.ng](https://start.ng). You play as your own start.ng character: grab golden orbs, dodge the red spikes, chain pickups into combos before the 45-second clock runs out.

- Your character is drawn from your start.ng style (body, colours, hair, hat, accessory) and the arena takes a hint of your colour.
- Signed-in players get their best run saved to the leaderboard (orbs collected, then best combo). Guests can play and see the board.
- Controls: WASD / arrow keys, or drag on a touch screen.

Static site: `index.html` + `game.js` + a local copy of three.js in `vendor/` (no build step, no CDN). Leaderboard columns are defined in `startng.json`.
