# spider-widget (compact Canvas spider view)

Self-contained Canvas 2D spider view used by the DSH Sidebar Spider plugin for the
narrow right-sidebar presentation. It is generated into `../spider-widget.js` by
`build/build-widget.mjs`.

- **No imports, no assets, no network.** The build concatenates the vendored
  Canvas engine modules (`../vendor/canvas-engine/app/*.js`) plus the compact
  composition in `../src/widget.js` into one IIFE.
- Exposes `globalThis.createSpiderView(container, options)` (and CommonJS
  `module.exports`) in the generated dist file.
- Works at 320–480 px panel width; responsive; cleans up RAF/observers/DOM on
  `destroy()`; injects/removes its own id-scoped CSS.

## API

```js
const view = createSpiderView(container, {
  title: 'WEB SPIDER',        // header title
  subtitle: '',
  modelName: '',
  locale: 'zh' | 'en',
  theme: { background, panel, panelTop, border, text, muted, accent, spider },
  routes: { code: {label,color}, model: {…}, you: {…} },
  maxPages: 64,
  showViewToggle: true,       // web / orbit switch
  reducedMotion: 'auto' | true | false,
  minHeight: 180,
  onSelect: (page) => {}
});

view.push(event | event[]);   // session.start / tool.start / page.add / page.status / tool.end / session.done / reset
view.setPages(pages);         // replay a page list
view.focusOn(pageId);
view.resize();
view.setTheme(partialTheme);
view.getState();              // status, session, counts, tools, pages
view.snapshot(mime?, quality?); // canvas data URL (PNG by default)
view.destroy();
```

Event contract in detail (types, status transitions, idempotency, replay):
see the header comments in `../src/widget.js`.

## Build / verify

```bash
node build/build-widget.mjs          # regenerate ../spider-widget.js + widget-manifest.json
node build/build-widget.mjs --check  # verify engine module hashes and rebuild in memory only
node demo/verify-widget.mjs          # 15 offline checks with a fake DOM + recording Canvas2D
```

The build hash-pins every vendored engine module (`build/engine-lock.json`) and
fails loudly on drift; module bodies are kept verbatim (ESM import/export shell
stripped) and wrapped in namespaces.

## Demo

`demo/index.html` + `demo/demo-driver.js` run a fully offline simulated DSH
web-search session (`file://`, no network). Useful for eyeballing the compact
view without the host app.

## Licence

MIT — Copyright (c) 2026 yanx215241-a11y. See the repository `LICENSE`.
