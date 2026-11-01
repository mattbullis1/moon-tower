# 🌙 Moon Tower — Lunar Module Stacker

An arcade tower-builder where you stack random **lunar modules** into a space tower on the Moon. Land them dead-center for a **PERFECT** bonus — your astronaut celebrates with a golf swing — and watch out: land too far off-center and **moon gravity** tips the module and drags the whole tower down.

**Play:** [https://mattbullis1.github.io/moon-tower/](https://mattbullis1.github.io/moon-tower/)

---

## How to play

| Action | Input |
|---|---|
| Drop the module | Tap / Click / `Space` / `Enter` |
| Restart | Tap / Click / `Space` after a collapse |
| Mute | "SOUND" button on the game-over screen |

- Each module sweeps left↔right above the tower. Tap to release it.
- **Dead center (±7px)** → `PERFECT`: bonus score, rising combo, and your astronaut tees off a golf ball across the lunar sky.
- **Close but off-center** → the module stays, leaning toward the overhang. Stability drops.
- **Too far off-center** → the module tips over and moon gravity pulls the entire tower down. That's the end of the run.

Score is height plus perfect-drop bonuses. Best height and best score are saved locally.

## Features

- **Real stacking physics** — center-of-mass support footprint, cumulative sway that grows with tower height, and toppling instead of block-trimming.
- **10 random lunar module silhouettes** — Lander, Hab, Lab, Dome, Rover Bay, Comms Mast, Fuel Tank, Solar Array, Crew Capsule, Airlock — each in 6 metallic palettes with lit windows, plating seams, struts, dishes, and solar panels.
- **Earth in the sky** — drifting continents, cloud swirls, atmospheric glow that flares on a perfect drop, terminator shading, rim light, and a tiny moon orbiting it.
- **Golfing astronaut** — a suited EVA figure who swings a club on every perfect landing.
- **Procedural Web Audio sound** — landing clunks, perfect chimes, golf whoosh, tipping groans, collapse rumble, ambient hum. **No audio files.**
- **Low-gravity effects** — regolith dust that floats upward, drifting starfield, screen shake, collapse flash.

## Tech

Pure HTML + CSS + Canvas 2D + Web Audio. **No build step, no dependencies, no assets** — three files served statically.

```
index.html   markup + overlays
style.css    layout, HUD, panels
game.js      engine: physics, rendering, audio, modules
```

## Run locally

```bash
# any static server works, e.g.
python -m http.server 8000
# then open http://localhost:8000/
```

Or drop the folder into `htdocs` of a XAMPP/Apache install and open `http://localhost/moon-tower/`.

## Tuning knobs

All near the top of `game.js`:

| Constant | Meaning |
|---|---|
| `PERFECT_PX` | dead-center tolerance for a PERFECT (default `7`) |
| `MOON_G` | gravity during a collapse, px/s² (default `620`) |
| `BASE_W` / `MIN_W` / `MAX_W` | module width bounds |
| `beginSweep()` `speed` | how fast modules sweep (scales with height) |

## License

MIT — do whatever you like with it.
