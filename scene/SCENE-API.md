# spider-scene — full-screen "检索大屏" Canvas-2D scene

Self-contained, canvas-only port of the canvas-engine full-screen dashboard
(`app/renderer.js` composition + drawing vocabulary) re-driven by **DSH web-research
data** (searches / results / fetched pages / failures) instead of prompt words.

- Engine: `vendor/canvas-engine` `@ f6522df29739ccc4861c1227601980b88265923d` (v1.2.0, MIT)
- Reference composition: user screenshot `PROMPT SPIDER // EVERY WORD, ONE FORK` dashboard
- Delivery model: **one classic-script IIFE file**, no imports, no assets, no injected
  CSS/DOM chrome — only a `<canvas>` element is created inside the host container.
  Same embedding pattern as `spider-embed/spider-widget.js`.

| File | Bytes | Notes |
|---|---:|---|
| `scene.js` | **118,011** | dist, generated (sha256 `0e96306568c3a040ac826700dcb0a10221062495146d9ec1807af51ba08a14f6`) |
| `src/scene-dashboard.js` | 93,109 | composition source incl. always-scrolling stream + crawling spider + per-token contact + infinite labels (edit this, then rebuild) |
| `build/build-scene.mjs` | 9,278 | embeds pinned engine modules verbatim + composition |
| `demo/mock-data.mjs` | 15,182 | deterministic realistic session generator (queries, result titles, excerpts) |
| `demo/mock-scene.json` | 27,906 | **exact mock model JSON** rendered in the demo PNGs |
| `demo/render-scene.mjs` | 11,109 | headless PNG renderer + short-content mock helper (stubbed DOM + @napi-rs/canvas) |
| `demo/verify-scene.mjs` | 9,080 | 11 API/lifecycle acceptance checks |
| `demo/scene-1280x800.png` | 564,346 | landscape 16:10 render (default frame t=10.0s) |
| `demo/scene-1280x800-t0.png` | 567,011 | early frame t=0.3s (labels on paths, counters 0) |
| `demo/scene-1280x800-t1.png` | 566,889 | early frame t=2.5s (counters starting to accumulate) |
| `demo/scene-1280x800-t2.png` | 568,332 | mid frame t=8.6s |
| `demo/scene-1280x800-flow-a.png` | 566,081 | loop movement proof t=2.40s |
| `demo/scene-1280x800-flow-b.png` | 566,553 | loop movement proof t=2.80s (labels moved) |
| `demo/scene-1280x800-flow-c.png` | 568,288 | loop movement proof t=3.20s (labels moved again) |
| `demo/scene-1280x800-loop-a.png` | 572,196 | accumulation proof t=6.0s |
| `demo/scene-1280x800-loop-b.png` | 574,340 | accumulation proof t=14.0s |
| `demo/scene-1280x800-loop-c.png` | 569,621 | accumulation proof t=26.0s |
| `demo/scene-1280x800-scroll-a.png` | 572,196 | upward-scroll proof t=6.0s |
| `demo/scene-1280x800-scroll-b.png` | 569,318 | upward-scroll proof t=6.3s |
| `demo/scene-1280x800-scroll-c.png` | 572,205 | upward-scroll proof t=6.6s |
| `demo/scene-1280x800-touch-a.png` | 569,056 | per-token contact proof t=6.1s (bold probe-tip box) |
| `demo/scene-1280x800-touch-b.png` | 572,137 | per-token contact proof t=6.5s (boxed token moved) |
| `demo/scene-touch-crop.png` | 136,286 | 2× close-up of the bold tentacle-contact box |
| `demo/scene-1280x800-crawl-a.png` | 572,000 | spider-crawl proof t=5.8s |
| `demo/scene-1280x800-crawl-b.png` | 570,336 | spider-crawl proof t=6.2s (body moved, legs re-posed) |
| `demo/scene-short-t0.png` | 437,891 | short-content (3 calls) scroll proof t=5.0s |
| `demo/scene-short-t1.png` | 435,788 | short-content scroll proof t=5.4s (rows higher) |
| `demo/scene-short-t2.png` | 436,356 | short-content scroll proof t=5.8s (rows higher again) |
| `demo/scene-900x1000.png` | 490,238 | portrait 9:10 render |
| `demo/scene-1148x962.png` | 634,396 | live DSH host-size render (bonus reference) |
| `demo/scene-1280x800@2x.png` | 1,680,214 | DPR-cap-2 sanity render (2560×1600) |
| `demo/scene-1280x800@2x.png` | 1,679,534 | DPR-cap-2 sanity render (2560×1600) |

Byte counts are the final generated artifacts; `scene.js` is rebuilt from `src/` (see below).

## Quick start

```html
<!-- classic script: exposes globalThis.createSpiderScene -->
<script src="scene.js"></script>
<div id="sceneHost" style="position:absolute;inset:0"></div>
<script>
  const scene = createSpiderScene(document.getElementById('sceneHost'), { locale: 'zh' });
  scene.setData({
    status: 'live', sessionId: 'research-1', startedAt: Date.now() - 12_000, now: Date.now(),
    metrics: { queries: 2, results: 11, sources: 6, fetches: 7, failures: 3, events: 9 },
    calls: [ /* see data model */ ], pages: [ /* ... */ ], activities: [ /* ... */ ],
  });
  // later:
  scene.push({ kind: 'fetch', label: 'https://example.com/a', at: Date.now() });
  const pngDataUrl = scene.snapshot('image/png');   // canvas.toDataURL, host can save/verify
  scene.destroy();
</script>
```

Node/CommonJS: `const { createSpiderScene, meta } = require('./scene.js')`.
The dist is generated — **do not edit `scene.js` by hand**; edit `src/scene-dashboard.js` and run
`node build/build-scene.mjs` (Node ≥ 18; only reads the local engine checkout + local files).

## API

```ts
createSpiderScene(container: HTMLElement, options?): SpiderScene

interface SpiderScene {
  el: HTMLCanvasElement;          // === canvas; the only DOM node the scene creates
  canvas: HTMLCanvasElement;
  setData(model: SceneModel): boolean;
  push(event: PushEvent): boolean;
  resize(): void;                 // re-measure container (idempotent; safe after fullscreen toggle)
  destroy(): void;
  snapshot(mime?: string, quality?: number): string | null;   // PNG data URL by default
  getState(): SceneState;
  onFrame(fn: (info) => void): () => void;   // extra: per-paint callback, returns unsubscribe
  meta: { name, version, engine, license };
}
```

### options

| key | type / default | meaning |
|---|---|---|
| `locale` | `'zh'` \| `'en'`, default `'zh'` | all panel titles/labels/footnotes |
| `theme` | `{ background, panel, panelTop, border, white, text, muted, dim, code, model, you, pink }`, hex only | palette patch (invalid keys/values ignored) |
| `maxPages` | number 8…2000, default `240` | caps **rendered** strands/dots; `counts.pages` still reports the discovered total (coverage denominator) |
| `reducedMotion` | boolean, default auto | when absent, `prefers-reduced-motion` is honored; freezes walking/sway/scanner/particles |
| `width`, `height` | number | headless/offscreen fallback when the container reports 0×0 |
| `pixelRatio` | number | test override; still clamped to the **DPR cap of 2** |
| `animationTime` | seconds, default `0` | initial animation clock — makes snapshot frames deterministic |
| `onFrame` | fn | per-paint callback (testing/telemetry) |

### `getState()`

```js
{
  ready: true, destroyed: false,
  status: 'live'|'idle'|'done',
  elapsed: 24.6, animationTime: 8.6,
  metrics: { queries, results, sources, fetches, failures, events },   // normalized/derived real totals
  arrivals: {                                 // cumulative arrival counters (header/cards)
    counts: { queries, results, sources, fetches, failures },   // unbounded, monotonic
    real: { queries, results, sources, fetches, failures, events },  // true data totals
  },
  counts: { calls, pages, pagesRendered, activities },
  size: { width, height, dpr },
  layout: { portrait: boolean, gutter: number },
  reducedMotion: boolean,
}
```

`status:'live'` only affects the footer status dot/word; animation runs while the scene is
mounted and visible regardless (paused by `document.hidden` / IntersectionObserver).

## Data model (`setData(model)`)

Timestamps are **epoch milliseconds**. `elapsed = (now - startedAt) / 1000`.

```jsonc
{
  "status": "live",                    // 'live' | 'idle' | 'done' (default 'idle')
  "sessionId": "research-2f8c1a",      // footer right
  "startedAt": 1795000000000,
  "now": 1795000024600,                // host updates this while live; used for elapsed
  "metrics": {                         // optional: any missing/invalid key is derived
    "queries": 12, "results": 96, "sources": 18,
    "fetches": 8, "failures": 2, "events": 41
  },
  "calls": [{
    "id": "call-01",
    "tool": "web_search",             // 'web_search' | 'web_fetch' (anything containing 'fetch' = web_fetch)
    "label": "deepseek harness client plugin api",   // query or URL, shown in stream/table
    "queries": ["deepseek harness client plugin api"],
    "url": "",                        // web_fetch target (web_search ignored)
    "status": "completed",           // 'pending' | 'running' | 'completed' | 'failed'
    "startedAt": 1795000000000,
    "endedAt": 1795000001180,        // -1/omitted while running
    "resultCount": 9,                 // web_search results
    "httpStatus": 200,               // web_fetch
    "bytes": 118400,                 // web_fetch payload size (size-ish column)
    "resultTitles": [                // NEW: web_search result titles (≤5, stream sub-line)
      "deepseek-harness/README.md at main", "DSH client plugin API reference"
    ],
    "excerpt": ""                    // NEW: web_fetch page text excerpt (1-3 lines in stream)
  }],
  "pages": [{
    "id": "page-01",
    "url": "https://github.com/deepseek-ai/deepseek-harness",
    "title": "deepseek-harness: agent runtime & plugin host",
    "route": "code",                 // 'code' (fetched directly) | 'model' (model-read) | 'you' (needs approval)
    "status": "completed",           // 'pending' | 'running' | 'completed' | 'failed'
    "detail": "extracted",
    "excerpt": "Plugin surface, tool event transport ...",   // NEW: per-page snippet
    "firstAt": 1795000000400,
    "updatedAt": 1795000015000
  }],
  "activities": [{
    "at": 1795000001180,
    "kind": "search",               // 'search' | 'fetch' | 'result' | 'fail' | 'start' | 'end'
    "label": "deepseek harness client plugin api",
    "route": "code"
  }]
}
```

**Derivation rules** (used when `metrics` key is absent/non-finite):
`queries` = Σ max(1, `queries.length`) over `web_search` calls · `results` = Σ `resultCount`
· `fetches` = count of `web_fetch` calls · `failures` = count of failed `web_fetch` calls
· `sources` = unique non-empty hostnames over `pages` · `events` = `activities.length`.

### `push(event)` — incremental updates

Returns `true` when accepted, `false` after `destroy()` / invalid input. Variants (discriminated by `type`,
default `'activity'`):

```jsonc
{ "kind": "search", "label": "query text", "queries": ["..."], "at": 1795000025000 }   // +1 query, +n results
{ "kind": "fetch",  "label": "https://...", "at": ... }                                // +1 fetch
{ "kind": "fail",   "label": "https://...", "at": ... }                                // +1 failure
{ "kind": "result", "label": "...", "resultCount": 3, "at": ... }                      // +3 results
{ "kind": "start" | "end", "label": "..." }                                            // activity only
{ "type": "call",   "call": { /* full call object, upsert by id */ } }
{ "type": "page",   "page": { /* full page object, upsert by id; may carry url/title/route/status */ } }
{ "type": "metrics", "metrics": { "queries": 3, "results": 17 } }                      // numeric patch
{ "type": "status", "status": "live" | "idle" | "done", "at": ... }
{ "type": "data",   "model": { /* full SceneModel */ } }                               // === setData(model)
```

`push` mutates the internal normalized model incrementally (no full `setData` needed between
tool calls); the next animation frame repaints. `setData` remains the full-reset path.

## Mapping: engine dashboard panel → this scene

| engine `app/renderer.js` | spider-scene panel | data source |
|---|---|---|
| header `PROMPT SPIDER // EVERY WORD, ONE FORK` + 5 stat columns | `WEB SPIDER // EVERY PAGE, ONE FORK` + `检索/结果/来源/抓取/失败` counters | `metrics` |
| left `studio.prompt` editor (traffic lights, numbered dense statement rows, colored word chips) | `calls.stream` — **slow upward auto-scrolling statement strip** (seamless loop) with **probe-gated boxed tokens**: rows are plain text by default; tokens gain the reference word-box (teal query / salmon URL / pink failed / dim teal titles / muted excerpt boxes) only while sliding through the tentacle band above the anchored spider, and fade plain again after passing. Right status tag (`9`, `200`, `504`, `run`), 1px chrome, live row pink-highlighted, body row framed | `calls[]` |
| center `#drawWeb` strand fan + arc + rotated labels + white scanner | web fan: one bold strand per page (route/status colored), + one dim strand per search result (density), rotated host labels along the arc, arc ticks, sweeping scanner; faint **connector strands** run from the anchored spider into the fan | `pages[]`, `metrics.results` |
| `#drawSpider` + `app/probes.js` arms (creature crawls the editor) | `drawSpider` sits in a stable **lower anchor zone** of the left stream while rows slide under it; `probePose` arms reach the rows in the tentacle band above. See “Anchored spider”. | `calls[]`, layout rows |
| right route cards (`code` / `sonnet 5.5` / `you`) | right rail cards `web_search` / `web_fetch` / `failed`: big number = cumulative label arrivals (with a tiny `累计抵达` caption), small footnote = the REAL totals (`真实：…`) | `metrics` + arrival counters |
| bottom `decision stream` table | `决策流` table: t · tool · query/URL · status | `calls[]` |
| `routed this session` big number + route bars | `覆盖率` big `%` (fetched ÷ discovered) + route breakdown bars | `pages[]` |
| `confidence · last 40` chart | `dottrace` activity sparkline (bucketed activities, dot color = dominant kind) | `activities[]` |
| `words read` dot grid | `覆盖率点阵` dot grid, one dot = one page | `pages[]` |
| `prompt coverage` 3D sphere | `页面读取` fetch table: host · HTTP · size | `web_fetch` calls |
| `who had to think` (3 routes + note) | `工具统计` web_search / web_fetch / failed counts + two-line note | `metrics` |
| status bar | footer: pages · sources · calls · events | right: `LIVE · 24.6s · sessionId` | `model` |

Colors/typography are engine (`app/style.css` + `renderer.js#PALETTE`): bg `#080909`,
panel `#101013`, panel top `#19191c`, border `#29292e`, code `#48d7a6`, model `#e18c78`,
you `#f4cf4d`, pink `#f23c83`; mono font everywhere, 1px hairline frames, `▪ TITLE` headers.
`route` semantics: `code` = directly fetched · `model` = model-read · `you` = needs the user.

## Anchored spider + scrolling stream (left stream)

The creature lives **on the flowing data**, like engine's spider crawling over the
`studio.prompt` statement list — not in the central web:

- **Slow upward auto-scroll (always)**: the left stream slides upward continuously at
  `scrollSpeed = clamp(innerH * 0.032, 9, 18)` px/s (≈14 px/s at 1280×800) with
  `offset = (animationTime * scrollSpeed) % contentHeight`. The newest contiguous slice is
  tiled/repeated until its loop distance is at least `innerH + 2*lineH`, then drawn twice
  (modulo offset), so rows leaving the top re-enter from the bottom seamlessly — **even when
  the session has only 2–3 calls** (rows repeat when very short; motion is always on, purity
  from `animationTime` is kept). Row order/content/styling is unchanged.
- **Crawling spider in the anchor band**: the body visibly crawls inside the lower band at
  `bodyX = cx + w*(0.5 + 0.09*sin(t*2π/2.5))` (±9 % panel width, 2.5 s cycle) and
  `bodyY = anchorY + innerH*0.03*sin(t*2π/2.2 + 0.8) + 1.6px bob`, clamped to the band; the
  real velocity feeds `drawSpider` so the legs cycle/gait and the heading changes. The
  **anchor row** is the row passing the body (live row preferred); only the token directly
  under the body is boxed (near-invisible 1 px frame, alpha 0.12) — no whole-row boxes. The 5
  rows above form the tentacle band (see “Per-token probe contact”). Rows below are plain.
- `probePose` arms reach the rows in the tentacle band at their **current visual positions**
  (targets converted into the scaled body space; arms/carets drawn locally because engine
  `drawProbes` hardcodes a 1080-stage clamp). Everything is a pure function of
  `animationTime` + row position → headless snapshots are reproducible.
  `demo/scene-1280x800-crawl-a.png` (5.8 s) vs `-crawl-b.png` (6.2 s) show the body at
  different x/y with different leg poses.
- The spider is scaled by panel width (`0.62…0.92`) so it reads the same at 900×1000, 1148×962
  and 1280×800. Faint connector strands (`drawConnectors`) run from the body into the central
  web's strand starts; two slow pulses travel along them while live.
- Reduced motion: scroll offset freezes at 0, the wander/bob/pulses freeze; the body-contact
  token is still boxed statically.

### Per-token probe contact (box rule)

Boxes are **not** always on, and they are **not row-wide**: the left stream defaults to plain
monospace text, and only the token under an actual tentacle tip gains its rounded box — matching
the user's “有的触角没有粘到的单词都进行了框选” complaint. The reached token is drawn **bold**:
1.4 px route border at ~0.92 alpha, route fill at ~0.28 alpha, near-white text, radius 2.5,
3px pad/gap, integer-snapped, plus a 3 px same-colour glow — clearly visible at 1280×800 and
1148×962; every untouched token on the same row stays plain text in the same colours, with
chips / status tag / `│` gutter / failure styling always present.

- **Contact rule**: for each of the 5 rows above the body, the probe arm's actual tip is at
  `tipX = tokenX + scanExtension(rank, now) * (scanRight - tokenX)` on that row's first line
  (`scanExtension` = deterministic rise→hold→retract pulse, period 2.8 s, rank offset 0.37).
  A token is boxed only if its horizontal span contains `tipX` (smooth 14 px proximity falloff,
  so the immediately adjacent token can catch a faint edge); box alpha follows the arm
  extension (fade in as it reaches, fade out as it retracts). Tokens on the same row outside
  `tipX` — and every extra line of that row (titles, excerpts) — stay plain. Rows below the body
  or far from the tentacles: zero boxes.
- **Body row**: only the token directly under the body (`bodyX`) is boxed, plus a near-invisible
  1 px frame (alpha 0.12) for readability — no whole-row boxes.
- **As rows scroll under the anchored spider**, the arms' tips sweep token-by-token; boxes light
  up only where the tips pass, then fade back to plain; different arms sweep different rows/x
  ranges so only a handful of tokens are boxed at any moment
  (`demo/scene-1280x800-touch-a.png` @6.1 s vs `-touch-b.png` @6.5 s: the boxed token moves
  along the row while most tokens stay plain; `demo/scene-touch-crop.png` is a 2× close-up of
  the bold contact box).
- **Static-snapshot safe**: box visibility is a pure function of `animationTime` + row/token
  geometry (no animation history), so a single headless `snapshot()` is deterministic.
- **Row tokenisation** (content/layout): search queries split on whitespace + punctuation
  (`- : / | quotes`; separators unboxed) → teal; fetch URLs → salmon host + unboxed `/` + path
  words; result titles grouped 3–4 words (dimmer teal, plain `·` separators); excerpts 2–3
  words per neutral grey group (2 lines max, `│` gutter). Failed rows use pink styling/boxes.
- Token font scales with the panel (8.6–9.8px) so the stream stays legible at 900px wide;
  overflow is ellipsized per item (primary ≤3 lines, titles ≤2, excerpt ≤2).

### Infinite label loop + cumulative arrival counters

**Infinite loop rule** — every page label streams along its strand from the inner end (near the
creature) outward to the page/arc end and **loops forever**: per-strand period 2.4–3.6 s
(`2.4 + (i*0.37) % 1.2`) with a golden-ratio phase spread (`(i*0.618) % 1`), so dozens of labels
are always at different path positions (there is no quiet state). Position
`u = fract((animationTime-0.35)/period + phase + slot*0.5)`; alpha smoothstep fades in over the
first 12 % and out over the last 15 % of each traversal; long strands (>30 % of the web width)
carry a second trailing packet (same page, visual only — it does not count twice). Chips keep
the boxed vocabulary (1px route border, ~12 % tint, radius 2.5, mono dark text, host ≤20 chars
ellipsized, failed pages `fail <host>`), route colours teal `code` / salmon `model` / yellow
`you` / pink `failed`, a subtle comet trail, and are clipped to the web rect. Pure closed-form
function of `animationTime` + page index/period/phase → snapshot-safe.

**Cumulative-counter rule** — every loop wrap is one arrival event and the numbers keep
accumulating, monotonically and without cap:
`wraps_i(now) = floor((now-0.35)/period_i + phase_i)`; then
`结果 += wraps_i` for every page, `检索 (+ web_search card) += wraps_i` for search-derived pages,
`抓取 (+ web_fetch card) += wraps_i` for pages matched to a `web_fetch` call (URL/host),
`失败 (+ failed card) += wraps_i` for failed pages, `来源 += wraps_i` for the first page of each
distinct host. They start at 0 and never stop (loop-a 6 s → 25/58/35/33/4, loop-b 14 s →
58/136/79/78/10, loop-c 26 s → 114/265/155/151/18). **The real data is kept readable**: each
card's small footnote shows the TRUE totals (`真实：12 次检索 · 96 结果`, `真实：6 成功 · 974ms
平均`, `真实：2 次失败 · 建议重试`), a tiny `累计抵达` caption sits above each big number, and
the footer keeps the real session totals (`web-spider · 30 pages · 18 sources · 20 calls · 41
events`). `reducedMotion` freezes at a fixed animation time. `getState().arrivals` exposes
`{counts: {queries,results,sources,fetches,failures}, real: metrics}`. Pages appended live join
the loop on the next frame and add arrivals from then on.
`demo/scene-1280x800-loop-a/b/c.png` (6/14/26 s) prove the strictly increasing numbers with the
real totals frozen in the footnotes; `-flow-a/b/c.png` prove the labels move.

## Layout

Responsive; recomputed on every resize (`ResizeObserver`, window resize, plus a 15-frame
safety re-measure for fullscreen toggles the RO can miss). No fixed 1080×1350 stage.

- gutter `clamp(min(W,H)*0.016, 8, 16)` · header `clamp(H*0.072, 40, 64)` · footer `clamp(H*0.026, 18, 26)`
- top strip = left stream · open center web (no panel chrome, like engine) · right card rail
- bottom = 2-panel row (`决策流` + `覆盖率`) then 4 panels (page reads · dottrace · page matrix · tools);
  portrait (`H > W*1.06`) turns the last 4 into a 2×2 grid.
- tested sizes: **1280×800** (landscape 16:10) and **900×1000** (portrait 9:10); the live DSH
  host renders **1148×962**. Minimum practical size ≈ 640×420.

## Lifecycle & host integration

- **Canvas-only**: creates exactly one `<canvas>` (sized `100% × 100%` inline), no DOM chrome,
  no `<style>` injection, no fonts/assets. Host owns the container box; it must have a non-zero
  size when mounted (use `position:absolute; inset:0` for the fullscreen sidebar).
- **DPR**: backing store `cssSize × min(2, devicePixelRatio)`; ctx scaled once per paint.
- **RAF**: continuous paint while mounted; paused when `document.hidden` or when an
  `IntersectionObserver` reports the container off-screen; destroyed cleanly.
- **Snapshot verification**: `scene.snapshot('image/png')` redraws synchronously then calls
  `canvas.toDataURL(...)`; the host can call `canvas.toDataURL` directly too. This is how the
  demo PNGs and the live plugin verify pixels (no browser needed for CI: `demo/render-scene.mjs`).
- **Fullscreen 1148×962**: just size the container; the scene recomputes the layout
  (portrait threshold `H > W*1.06` → 1148×962 is landscape layout).
- **Coexistence with the compact widget**: both are independent canvas instances;
  mounting both is fine (separate RAF loops, no globals besides `createSpiderScene`).
- Suggested feed mapping (plugin side):
  `web_search` tool call → `push({type:'call', call:{tool:'web_search', label:query, queries, resultCount, status, ...}})`
  + `push({kind:'search', ...})`; `web_fetch` → same with `url`, `httpStatus`, `bytes`;
  discovered links → `push({type:'page', page:{url, title, route, status}})`.

## Engine reuse (verbatim modules embedded by the build)

| namespace | engine file | exported / used |
|---|---|---|
| `SC.spider` | `app/spider.js` | `drawSpider`, `legPose`, `heartbeatAt` — the creature |
| `SC.probes` | `app/probes.js` | `probePose`, `drawProbes`, `PROBE_TIMING` — reach-arm geometry |
| `SC.layout` | `app/live-layout.js` | `livePose` (closed orbit pose), `alpha` (rgba helper) |
| `SC.motion` | `app/motion.js` | `cubicPoint` (extracted; flight-particle curves) |

Build verifies the pinned engine SHA-256 per file and fails on drift. License: engine MIT
(`Copyright (c) 2026 yanx215241-a11y`), kept in the `scene.js` banner. `app/renderer.js` itself is
**not** shipped — its drawing recipes were adapted into the new composition.

## Verification evidence

```
$ node demo/render-scene.mjs          # writes default/t0/t1/t2 + -flow-a/b/c + -loop-a/b/c + -scroll-a/b/c + -touch-a/b + -crawl-a/b + scene-short-t0/t1/t2 + scene-touch-crop frames, 900x1000, 1148x962 (+mock-scene.json)
$ node demo/verify-scene.mjs          # 11/11 checks pass
  ok loads via require() and exposes createSpiderScene + meta
  ok contract: el/canvas/setData/push/resize/destroy/snapshot/getState exposed
  ok setData(mock model) drives all panels + getState metrics
  ok snapshot() returns a PNG data URL (canvas.toDataURL path)
  ok push(activity) increments metrics + appends activity
  ok push(call/page/metrics/status) upserts without throwing
  ok resize() re-measures the container and re-allocates the backing store
  ok DPR is capped at 2
  ok empty model renders without exceptions (idle state)
  ok en locale + reducedMotion + theme patch + maxPages cap
  ok destroy() detaches canvas and makes calls inert
```

Mock session: 24.6 s, 12 searches / 96 results / 8 fetches (2 failures) / 30 pages / 41 activities;
~10 of the rendered stream rows carry `resultTitles` and/or page `excerpt`s (search rows: up to 3
titles; fetch rows: a 1–3 line excerpt; failures: an error excerpt). Rendered at 1280×800,
900×1000 and the live host's 1148×962.
Exact JSON: [`demo/mock-scene.json`](demo/mock-scene.json) (deterministic — regenerate with
`createMockModel(now)` from `demo/mock-data.mjs`; the scene also derives metrics from it).

## Known gaps / deviations from engine

1. **Responsive, not a 1:1 pixel port**: engine is a fixed 1080×1350 stage; this scene recomputes
   panels for arbitrary aspect ratios. Recipes/colors/typography match, coordinates do not.
2. **Center fan density**: engine draws one strand per routed word (175). A real research session
   has ~30 pages, so the fan adds one dim strand per search result (`metrics.results`, capped 160)
   to keep the reference's density; page strands stay bold.
3. **Probes**: `probePose` geometry is engine, but arms/contact boxes are redrawn in local
   coordinates because engine `drawProbes` clamps its contact label to the 1080-wide stage
   (documented delta). They now reach the newest left-stream rows, not web strands.
4. **`app/orbit.js` not embedded** — no orbit view toggle in the dashboard (single scene). It can be
   added back from `spider-embed/spider-widget.js` if the host wants a second view.
5. **3D coverage sphere replaced** by the information-equivalent `页面读取` fetch table (no WebGL /
   sphere in a data dashboard).
6. **No click/hover interaction** (`onSelect`/page list is the compact widget's job); the scene is a
   display + snapshot surface. `regions` are not exposed.
7. **Typography depends on host fonts**: `Consolas, "Cascadia Code", "Microsoft YaHei", "PingFang SC",
   monospace`; no font files shipped.
8. **Metric `events`** is advisory: if the host counts events differently, pass it explicitly in
   `metrics`; otherwise it equals `activities.length`.
