# canvas-engine (vendored)

The Canvas 2D rendering modules used by the two generated components in this
repository (`embed/spider-widget.js` and `scene/scene.js`).

Vendored verbatim from [Kirito14IT/prompt-spider-ui](https://github.com/Kirito14IT/prompt-spider-ui)
(MIT, Copyright (c) 2026 Kirito14IT), commit `f6522df29739ccc4861c1227601980b88265923d`:

- `app/spider.js` — creature body, legs, feelers, heartbeat
- `app/probes.js` — probe/reach pose
- `app/live-layout.js` — orbit layout and alpha helpers
- `app/orbit.js` — orbit view projection
- `app/motion.js` — `cubicPoint()` flight geometry helper

The drawing implementations are reused as-is; the DSH plugin, the compact and
full-screen compositions, the data adapter and all subsequent optimisations are
new work by yanx215241-a11y (Copyright (c) 2026) and released under the same
MIT licence. The build scripts hash-pin each vendored file (see
`embed/build/engine-lock.json` and the hash table in `scene/build/build-scene.mjs`)
so an accidental drift fails loudly.

Full MIT texts: `LICENSE` (this directory, upstream) and the repository
root `LICENSE` (combined project). See also `/NOTICE.md`.
