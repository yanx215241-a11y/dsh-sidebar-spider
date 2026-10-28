# spider-widget · INTEGRATION

One self-contained, dependency-free Canvas-2D "spider" widget for the DSH Web GUI
right-sidebar (320–480 px wide, variable height; also usable full-width/floating).
It is a port of the MIT-licensed [prompt-spider-ui](https://github.com/Kirito14IT/prompt-spider-ui)
spider/web visualisation, re-composed for agent activity instead of a prompt stream,
and driven by the DSH host plugin through plain JSON events.

| | |
| --- | --- |
| Artifact | [`spider-widget.js`](spider-widget.js) — **96,166 bytes**, sha256 `e1dd34ad441272fbea661bb09335a86a96d0ce59d242f96fb43dab886c3e1f4d` |
| Public factory | `createSpiderView(container, options)` |
| Upstream | repo `Kirito14IT/prompt-spider-ui`, commit **`f6522df29739ccc4861c1227601980b88265923d`** (tree `dff0d4501af262c7b874f7e0a6f8129c96271328`, v1.2.0, 2026-10-23) |
| Upstream checkout | `vendor/prompt-spider-ui\` (see `.upstream.json`), local hashes in [`build/upstream-lock.json`](build/upstream-lock.json) |
| Licence | MIT — upstream Copyright (c) 2026 Kirito14IT; attribution text in §9 and [`THIRD_PARTY_LICENSES.txt`](THIRD_PARTY_LICENSES.txt) (must ship with the plugin) |
| Event contract | [`event-contract.md`](event-contract.md) |

---

## 1. Deliverables

```
spider-embed/
├── spider-widget.js             96,166 B   generated, self-contained artifact (the only file the plugin needs)
├── event-contract.md            13 KB      event/state-machine contract + examples (host hand-off)
├── INTEGRATION.md               this file
├── THIRD_PARTY_LICENSES.txt     MIT text + upstream attribution
├── src/
│   ├── widget.js                67 KB      hand-written compact composition + event adapter + CSS
│   └── (upstream modules are read from ../../../prompt-spider-ui at build time, not copied here)
├── build/
│   ├── download-repo.mjs         fetches the pinned upstream commit (GitHub tarball API over node:https)
│   ├── build-widget.mjs          assembles spider-widget.js from upstream modules + src/widget.js
│   ├── upstream-lock.json        pinned commit + sha256 of every upstream file used
│   ├── widget-manifest.json      generated artifact manifest (bytes, sha256, reuse list)
│   ├── fetch-canvas.mjs          dev-only: installs @napi-rs/canvas over npm registry without npm CLI
│   ├── render-canvas.mjs         dev-only: rasterises the real widget canvas to PNG (Skia)
│   └── tools/node_modules/       dev-only downloaded Skia canvas (~40 MB, not needed by the plugin)
└── demo/
    ├── index.html                offline demo page (open directly from file://, no server)
    ├── demo-driver.js            simulated DSH web-search session, 2 widget instances
    ├── verify-widget.mjs         headless JS test-suite (14 checks) — run `node demo/verify-widget.mjs`
    ├── harness/fake-dom.mjs      minimal DOM + recording Canvas-2D harness used by the tests/renders
    ├── canvas-380x340.png        real Skia render of the sidebar canvas (760×680 px @dpr2)
    ├── canvas-380x340-focus.png  ... after focusOn() → spider walks to a node, probe arm extends
    ├── canvas-380x340-orbit.png  ... orbit view (upstream app/orbit.js reused)
    ├── canvas-380x340-done.png   ... after session.done
    ├── canvas-600x553.png        real Skia render of the wide/floating panel canvas (1200×1106 @dpr2)
    └── canvas-renders.json       manifest of the renders above
```

`vendor/prompt-spider-ui\` holds the verbatim upstream checkout (56 files, 562 KB;
`docs/preview.gif` 9.1 MB skipped) used to build the artifact.

---

## 2. Embedding in the DSH client plugin

`spider-widget.js` is a classic script / IIFE (no imports, no bundler syntax, no
external assets). It exposes exactly one symbol:

```js
// browser: global
window.createSpiderView(container, options)
// CommonJS (if the host wraps it): module.exports = { createSpiderView, meta }
```

It injects its own `<style>` element (scoped by a generated `#sv-N` root id) and
removes it in `destroy()`. No fetch, no eval, no network, no global CSS leaks.
CSP note: style injection requires `style-src 'unsafe-inline'` (or a host
nonce/hash policy); everything else is self-contained.

Recommended plugin integration (React, lazy-CJS bundle):

```js
window.__ModuleLoader__.load({ id: 'dsh-spider-view', factory: (require) => {
  const React = require('react');
  const initSpiderView = (container, options) => {
    // spider-widget.js is embedded as a string by the lead (see §3), evaluated once:
    //   new Function(widgetSource)()   → defines globalThis.createSpiderView
    return globalThis.createSpiderView(container, options);
  };
  return {
    body: function Body(props) {
      const hostRef = React.useRef(null);
      const viewRef = React.useRef(null);
      React.useEffect(() => {
        const view = initSpiderView(hostRef.current, {
          title: 'WEB SPIDER',
          modelName: 'deepseek-harness',
          locale: 'zh',
          routes: { code: { label: '检索' }, model: { label: '抓取' }, you: { label: '人工' } },
          onSelect: (page) => props.onOpenPage?.(page),
        });
        viewRef.current = view;
        return () => view.destroy();          // stops RAF, observers, listeners, DOM
      }, []);
      // host feeds events from its session event bus:
      //   viewRef.current.push(event);        → event-contract.md
      return React.createElement('div', { ref: hostRef, style: { height: '100%', minHeight: 240 } });
    },
  };
}});
```

The container **must have a definite height** (flex/grid item or explicit px);
the widget fills `100%` width/height and falls back to `options.minHeight`
(default 180 px) when the container collapses. It is responsive via
`ResizeObserver` + `window.resize` (no viewport media queries), so floating,
fullscreen and resized sidebars all work without a remount.

---

## 3. Public API contract

### `createSpiderView(container, options?) → view`

Options (all optional; invalid colours/labels fall back to defaults):

| option | type | default | notes |
| --- | --- | --- | --- |
| `title` | string | `'WEB SPIDER'` | header title; follows `session.start.title` afterwards |
| `subtitle` | string | `''` | tooltip/subtitle only |
| `modelName` | string | `''` | shown as `LIVE · <modelName>` while live |
| `locale` | `'zh' \| 'en'` | `'zh'` | status strings / empty-state copy |
| `theme` | partial object | upstream dark palette | keys `background,panel,panelTop,border,text,muted,accent,spider` as `#RRGGBB` |
| `routes` | `{code,model,you}` | upstream routes | per-route `{label, color}`; labels map the three visual branches |
| `maxPages` | number | `64` | clamped 4–200; oldest page dropped beyond limit |
| `showViewToggle` | boolean | `true` | show 蛛网/星轨 (web/orbit) toggle |
| `reducedMotion` | `'auto' \| boolean` | `'auto'` | honours `prefers-reduced-motion` |
| `minHeight` | number | `180` | CSS min-height fallback in px (0 to disable) |
| `onSelect` | function | `null` | called with a plain page record on node/row selection |

Returned view:

| member | signature | notes |
| --- | --- | --- |
| `push(event \| event[])` | `void` | authoritative input; synchronous, idempotent, never throws. See `event-contract.md` |
| `setPages(pages)` | `void` | replace state with a snapshot (replay/first mount); no arrival animation |
| `focusOn(id)` | `boolean` | selects a page, scrolls its list row into view, spider walks to its node |
| `resize()` | `void` | force re-measure (also automatic via ResizeObserver); call after a CSS layout change if the observer is unavailable |
| `getState()` | object | `{status,session,totalEvents,counts,statusCounts,pages,tools,selectedId,view,revision,theme,routes,locale,reducedMotion}`; serialisable snapshot for restore |
| `setTheme(patch)` | `void` | live-update colours/route labels (`{background?,accent?,routes?}`) |
| `snapshot(mime?, quality?)` | `string \| null` | `canvas.toDataURL()` PNG data URL (JPEG supported); for in-app visual verification (§6) |
| `canvas` | `HTMLCanvasElement` | exposed for advanced host use / beacons; the widget owns its sizing |
| `destroy()` | `void` | cancels RAF, disconnects observers, removes listeners, DOM and injected CSS; subsequent calls are no-ops |
| `el` | `HTMLElement` | root element (already appended to the container) |

Internals the host should rely on: `DevicePixelRatio` is capped at 2 exactly
like upstream `Renderer.resize()` (`canvas.width = round(cssWidth × min(2,dpr))`);
`requestAnimationFrame` pauses when the widget is off-screen
(`IntersectionObserver`) or the document is hidden; no timers are left running.

---

## 4. Regenerating the artifact (reproducible port)

Prerequisites: Node ≥ 20 (tested v24.21.0), the local upstream checkout, no npm
for the widget itself.

```powershell
cd embed

# 1) fetch the pinned upstream commit (node:https against api.github.com; no git)
node build\download-repo.mjs

# 2) build the single-file widget (verifies upstream sha256 from upstream-lock.json,
#    strips ESM, wraps namespaces, concatenates src/widget.js, writes the manifest)
node build\build-widget.mjs

# 3) verify behaviour (fake DOM + recording canvas context, 14 checks)
node demo\verify-widget.mjs

# 4) optional: real Skia renders for a visual diff (downloads @napi-rs/canvas once)
node build\fetch-canvas.mjs
node build\render-canvas.mjs
```

The build **fails loudly** if the upstream checkout does not match
`build/upstream-lock.json` (commit + per-file sha256), so a port is always
traceable to a commit. To port a new upstream version: update the lock's commit,
re-run step 1–2, review the diff of the generated file, re-run step 3–4.

### Upstream reuse / deltas

The generated file embeds these upstream modules **verbatim** (ESM
`import`/`export` shell removed; each wrapped in a namespace IIFE):

| upstream file | reused as | what the widget uses |
| --- | --- | --- |
| `app/spider.js` | `SV.spider` | `drawSpider` (wire body, 16 legs, feelers, head, twin-beat heartbeat), `legPose`, `heartbeatAt` |
| `app/probes.js` | `SV.probes` | `probePose` — the reach/hold/retract arm used for the "reach the node" gesture |
| `app/live-layout.js` | `SV.layout` | `livePose` (upstream closed analytic spider orbit, 16 s period), `alpha` (hex→rgba) |
| `app/orbit.js` | `SV.orbit` | `drawOrbit` — the optional 星轨/oṟbit view, exactly upstream (one documented delta below) |
| `app/motion.js` | `SV.motion` | `cubicPoint` only — flight-arc particle geometry |

Documented deltas (all in `build/build-widget.mjs`):

1. `app/orbit.js`: added an optional `maxLabels` option (default 8 = upstream
   behaviour); the widget passes 1/2/8 depending on panel width so narrow
   sidebars do not render 8 overlapping labels.
2. `app/motion.js` is not shipped whole (it binds the reference video track), so
   only `cubicPoint()` is extracted. Extraction is verified by upstream sha256.
3. Upstream drawing vocabulary is adapted, not replaced: `renderer.js#drawWeb`'s
   440-strand fan → 22-strand fan; `#drawRoutingParticles` → flight particles;
   `live-renderer.js#web` route targets/dashed probe → compact composition;
   `live-renderer.js#panel` + route colours + mono labels kept.

Dropped upstream features (out of scope for a sidebar widget):
`renderer.js` 1080×1350 reference-demo layout (code editor panel, confidence /
coverage / stats panels), `main.js` playback UI + `reference-track.js` measured
video trajectory, word-mode prompt tokenisation, the whole MCP server
(`server.mjs`, `mcp/*`, `lib/session-store.js`, `lib/replay.js`) — the host
plugin owns transport/persistence; `explorer.js` search box + PNG download
button (replaced by `snapshot()` + host controls); `docs/brand` assets (not
embedded).

---

## 5. Host plugin checklist

1. Embed `spider-widget.js` (96.2 KB) as a string/IIFE; evaluate once; call
   `globalThis.createSpiderView(hostEl, options)`.
2. Give the host element a definite height (`height:100%`, flex/grid child) in
   a 320–480 px sidebar; the widget handles DPR, resize, hiding, reduced motion.
3. On mount: `view.setPages(savedPages)` or `view.push({type:'session.replay',…})`
   if re-opening a finished run; otherwise `session.start`.
4. Map DSH activity → events (`event-contract.md` §7) and `view.push()` them
   from the session event bus. Guard against duplicate mounts (one view per panel).
5. Call `view.destroy()` in the React effect cleanup / panel unmount.
6. Keep the MIT attribution (§9) in the plugin distribution; keep
   `THIRD_PARTY_LICENSES.txt` next to the bundle or alongside a notices file.
7. Visual sign-off in the real browser: call `view.snapshot()` (§6) and keep the
   PNG with the release evidence.

---

## 6. Verification status (no headless Chrome in this sandbox)

Headless Chrome **cannot run** in the DSH workspace-write sandbox: Chromium's
multi-process IPC needs named pipes, which are denied
(`mojo platform_channel.cc Check failed: 拒绝访问`, crashpad `OpenProcess` denied),
and both `--headless=new` and `--single-process` hang/fail. Browser screenshots
are therefore **not** part of this delivery. Verification instead:

1. **Behaviour tests (authoritative, runnable here):**
   `node demo/verify-widget.mjs` → **15/15 checks pass**: boot + drawing ops,
   full simulated DSH session state machine (5 pages, 2 completed / 1 running /
   1 failed / 1 pending), upstream spider/probe/pulse draw ops (`ellipse 23.7×30`
   wire body present), `focusOn()` walk-to-node movement, canvas hit-test
   selection, 320/380/480/900 px + breakpoint resize, devicePixelRatio 1/1.5/3
   with the upstream 2× cap,
   `destroy()` cleanup (RAF/listeners/DOM), `snapshot()`, `setPages` /
   `session.replay`, theme patching, maxPages/duplicate-idempotency,
   unknown-event warning, reduced motion, 12 s animation soak, instance isolation.
2. **Real renders of the same drawing code:** `demo/canvas-*.png` were produced
   by running the built widget against a real Skia Canvas-2D implementation
   (`@napi-rs/canvas`, dev-only, downloaded from the npm registry) with the same
   fake DOM harness — i.e. the actual pixels the widget emits, not a mock.
   `demo/canvas-renders.json` records dimensions/states. Only the DOM chrome
   around the canvas (title row, page list, footer) is not rasterised.
3. **In-app visual proof (host side, recommended):** in the user's real browser,
   call `snapshot()` after N ms and beacon the data URL to a local collector:

   ```js
   // host plugin debug hook (example)
   setTimeout(() => {
     const png = view.snapshot('image/png');
     if (png) fetch('http://127.0.0.1:4799/spider-snapshot', {
       method: 'POST', headers: { 'content-type': 'text/plain' }, body: png,
     }).catch(() => {});
   }, 4000);
   ```

   This works offline from the app (canvas is not tainted — no cross-origin
   images are ever drawn) and is the intended way to capture the real look,
   including DOM chrome, from the user's machine. Typical PNG ≈ 130–150 KB at
   760×680 @dpr2; `snapshot('image/jpeg', 0.85)` is cheaper.

Offline visual demo: open `demo/index.html` directly from disk (`file://`,
no server, no network). Add `?mode=sidebar` (380×700 sidebar simulation),
`?mode=panel` (900×600 floating panel) or leave empty for both. The driver
pushes a simulated DSH search session on a loop; `?once=1` stops after one
session. `window.__spiderDemo` exposes the views + `getState()` for poking.

---

## 7. Performance / bounds

- Canvas draw work is bounded per frame: 22 background strands + 3 rings +
  ≤ `maxPages` node strands (each O(1) path) + ≤ 3 labels + one spider (16 legs,
  ~22 feelers, wire-body grid) + one probe + ≤ 1 s of flight particles.
  This mirrors upstream's "long sessions never grow per-frame work" rule
  (`lib/replay.js` projects only a visible window; the widget projects only
  current statuses).
- DOM list is rebuilt incrementally per page change (no per-frame DOM work);
  chrome text updates are throttled to 4 Hz; the list is bounded by `maxPages`.
- RAF pauses when off-screen (`IntersectionObserver`) or `document.hidden`.
- No external fonts are loaded; canvas uses the host's Consolas/Cascadia/
  Microsoft YaHei UI/PingFang SC/monospace stack.
- `snapshot()` is synchronous and allocates a PNG; call it on demand only.

---

## 8. Known limitations

1. **Dark theme only in practice.** The panel/route colours are themeable
   (`theme`/`setTheme`), but the spider itself is drawn with upstream
   `app/spider.js` hard-coded teal/pink colours tuned for a near-black canvas
   (same limitation as upstream; it was designed dark-first). A host light theme
   will show a dark canvas inside the panel; default is dark, matching DSH.
2. **Fonts/emoji.** Canvas labels are monospace; CJK renders through the system
   fallback (Microsoft YaHei UI / PingFang SC). Widths differ slightly between
   platforms; long titles are truncated by measurement and never overflow the
   panel. No emoji are drawn by the widget. Upstream monospace label metrics are
   assumed for route labels (`8.5–10 px`).
3. **DevicePixelRatio capped at 2** (upstream behaviour): on 3× displays the
   canvas backing store is 2× CSS pixels, so it is CSS-upscaled on screen.
4. **Narrow limits.** Below ~300 px the list hides some metadata (by design);
   orbit-view labels are capped (1 at <420 px, 2 at <560 px, 8 otherwise) and
   drag-rotate is mouse-only (touch scroll is preserved).
5. **`session.done` does not hard-stop events.** Post-done page events are still
   accepted as idempotent upserts (documented), but the session state stays
   completed; hosts should stop pushing after done.
6. **Page list is not virtualised**; `maxPages` bounds it (default 64). Sessions
   with hundreds of pages should be summarised by the host or capped at
   `maxPages`.
7. **`snapshot()` returns `null`** if `canvas.toDataURL` is unavailable/tainted;
   the widget never draws cross-origin images, so in practice it works.
8. **Styling isolation is light-DOM with id-scoped CSS**, not Shadow DOM: host
   global CSS can in principle target `.sv-*` classes (all rules are
   `#sv-N`-scoped and the host should not style them). It also means host CSS
   variables do not leak in; use the `theme` option instead.
9. **Not affiliated with upstream.** The port is a derived work under MIT; do
   not imply endorsement. Preserve the copyright/permission notice (§9).
10. **Headless Chrome screenshots unavailable here** — see §6. The `demo/`
    PNGs are Skia canvas-layer renders, not browser screenshots.

---

## 9. Licence and attribution

Upstream prompt-spider-ui is MIT licensed: **Copyright (c) 2026 Kirito14IT**.
The generated `spider-widget.js` contains the upstream drawing code verbatim, so
the MIT notice must be carried with every distribution of the widget/plugin.
The artifact's banner already references it; also ship
[`THIRD_PARTY_LICENSES.txt`](THIRD_PARTY_LICENSES.txt) (full text).

```
MIT License

Copyright (c) 2026 Kirito14IT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Upstream source: <https://github.com/Kirito14IT/prompt-spider-ui> (commit
`f6522df29739ccc4861c1227601980b88265923d`). The compact composition, event
adapter, docs and demos in this directory are new work derived from that code
and are distributed under the same MIT terms so the combined artifact stays
MIT-compatible.
