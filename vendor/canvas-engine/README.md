# canvas-engine (vendored)

The Canvas 2D rendering modules used by the two generated components in this
repository (`embed/spider-widget.js` and `scene/scene.js`).

- `app/spider.js` — creature body, legs, feelers, heartbeat
- `app/probes.js` — probe/reach pose
- `app/live-layout.js` — orbit layout and alpha helpers
- `app/orbit.js` — orbit view projection
- `app/motion.js` — `cubicPoint()` flight geometry helper

MIT licensed, Copyright (c) 2026 yanx215241-a11y.
The build scripts hash-pin each file (see `embed/build/engine-lock.json` and the
hash table in `scene/build/build-scene.mjs`) so a drifted module fails loudly.
