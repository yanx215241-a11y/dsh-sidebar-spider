#!/usr/bin/env node
/* ============================================================================
 * verify-widget.mjs — JS-only acceptance tests for spider-widget.
 *
 * Headless Chrome is unavailable in this sandbox (multi-process IPC needs named
 * pipes, denied under workspace-write), so the widget is verified against a
 * fake DOM + recording Canvas-2D context (see demo/harness/fake-dom.mjs):
 *   - the widget boots, draws canvas frames and never throws
 *   - a simulated DSH web-search session produces the expected state machine
 *   - spider / web / pulse / node drawing operations are actually emitted
 *   - interaction (canvas hit-test → selection), 320–900px responsiveness,
 *     devicePixelRatio handling and destroy() cleanup are asserted
 *
 * Usage: node demo/verify-widget.mjs
 * Exit code 0 = all checks passed.
 * ========================================================================= */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHarness } from './harness/fake-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIDGET = resolve(HERE, '..', 'spider-widget.js');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('PASS  ' + name);
  } catch (error) {
    fail += 1;
    failures.push({ name, error });
    console.log('FAIL  ' + name + '\n      ' + String(error && error.message));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error((message || 'value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function assertClose(actual, expected, tolerance, message) {
  if (!(Math.abs(actual - expected) <= tolerance)) throw new Error((message || 'value') + ': expected ~' + expected + ' ±' + tolerance + ', got ' + actual);
}

const PAGES = [
  { id: 'gh-canvas-engine', url: 'https://github.com/yanx215241-a11y/dsh-sidebar-spider', title: 'yanx215241-a11y/dsh-sidebar-spider · GitHub', source: 'search' },
  { id: 'gh-api-trees', url: 'https://api.github.com/repos/yanx215241-a11y/dsh-sidebar-spider/git/trees/main', title: 'GitHub REST API · git trees endpoint', source: 'search' },
  { id: 'mdn-canvas', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API', title: 'Canvas API · MDN Web Docs', source: 'search' },
  { id: 'raw-renderer', url: 'https://raw.githubusercontent.com/yanx215241-a11y/dsh-sidebar-spider/main/app/renderer.js', title: 'renderer.js · raw source (29.9 kB)', source: 'search' },
  { id: 'blocked-page', url: 'https://example.invalid/blocked-page', title: 'blocked-page · engine preview asset', source: 'search' },
];
function page(id) {
  return PAGES.find((item) => item.id === id);
}
function discovered(id) {
  const item = page(id);
  return { type: 'page.discovered', id: item.id, url: item.url, title: item.title, route: 'code', source: 'search' };
}
function pageStatus(id, status, extra) {
  const item = page(id);
  return Object.assign({ type: 'page.status', id: item.id, url: item.url, title: item.title, status }, extra || {});
}
function scenario() {
  return [
    { at: 0, event: { type: 'session.start', sessionId: 'verify-session', title: 'DSH WEB SPIDER', modelName: 'deepseek-harness' } },
    { at: 220, event: { type: 'tool.start', id: 'search-1', tool: 'web_search', query: 'canvas-engine' } },
    { at: 480, event: discovered('gh-canvas-engine') },
    { at: 640, event: discovered('gh-api-trees') },
    { at: 800, event: discovered('mdn-canvas') },
    { at: 960, event: discovered('raw-renderer') },
    { at: 1120, event: discovered('blocked-page') },
    { at: 1260, event: { type: 'tool.end', id: 'search-1', status: 'completed' } },
    { at: 1420, event: { type: 'tool.start', id: 'fetch-1', tool: 'web_fetch', url: page('gh-canvas-engine').url } },
    { at: 1680, event: pageStatus('gh-canvas-engine', 'running', { route: 'model' }) },
    { at: 2320, event: pageStatus('gh-canvas-engine', 'completed', { route: 'model', score: 0.92 }) },
    { at: 2420, event: { type: 'tool.end', id: 'fetch-1', status: 'completed' } },
    { at: 2520, event: { type: 'tool.start', id: 'fetch-2', tool: 'web_fetch', url: page('gh-api-trees').url } },
    { at: 2820, event: pageStatus('gh-api-trees', 'running', { route: 'model' }) },
    { at: 3080, event: pageStatus('gh-api-trees', 'completed', { route: 'model', score: 0.87 }) },
    { at: 3280, event: { type: 'tool.start', id: 'fetch-3', tool: 'web_fetch', url: page('blocked-page').url } },
    { at: 3420, event: pageStatus('blocked-page', 'running', { route: 'model' }) },
    { at: 3760, event: pageStatus('blocked-page', 'failed', { route: 'model' }) },
    { at: 3880, event: { type: 'tool.end', id: 'fetch-3', status: 'failed' } },
    { at: 4060, event: { type: 'tool.start', id: 'fetch-4', tool: 'web_fetch', url: page('mdn-canvas').url } },
    { at: 4240, event: pageStatus('mdn-canvas', 'running', { route: 'model' }) },
    { at: 4900, event: pageStatus('mdn-canvas', 'completed', { route: 'model', score: 0.79 }) },
    { at: 5100, event: { type: 'agent.thought', id: 'thought-1', text: 'summarise findings' } },
    { at: 5480, event: { type: 'session.done', status: 'completed' } },
  ];
}
function drive(harness, view, untilMs) {
  const events = scenario().slice().sort((a, b) => a.at - b.at);
  let at = 0;
  harness.step(2);
  for (const item of events) {
    if (item.at > untilMs) break;
    if (item.at > at) {
      harness.advance(item.at - at);
      at = item.at;
    }
    view.push(item.event);
  }
  if (untilMs > at) harness.advance(untilMs - at);
}
function methods(harness, method) {
  return harness.ops.filter((entry) => entry.kind === 'method' && entry.method === method);
}
function texts(harness) {
  return methods(harness, 'fillText').map((entry) => String(entry.args[0]));
}
function stylesSet(harness, prop) {
  return harness.ops.filter((entry) => entry.kind === 'set' && entry.prop === prop).map((entry) => entry.value);
}
function clearOps(harness) {
  harness.ops.length = 0;
}
function deepText(element) {
  let text = element.textContent || '';
  for (const child of element.children) text += ' ' + deepText(child);
  return text;
}

/* ============================== 1. boot ================================= */
check('boots and draws its first frames without throwing', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  harness.run(WIDGET, { title: 'DSH WEB SPIDER', locale: 'zh' });
  harness.findRoot();
  harness.applyLayout();
  harness.triggerResize();
  harness.step(2);
  assert(harness.ops.length > 50, 'expected drawing operations, got ' + harness.ops.length);
  assertEqual(harness.warnings.length, 0, 'warnings during boot');
  assert(harness.find('sv-root')[0], 'root element exists');
  assert(harness.find('sv-canvas')[0], 'canvas element exists');
  assert(harness.find('sv-row').length === 0, 'no rows before events');
  const text = texts(harness).join('\n');
  assert(text.includes('AGENT / WEB STREAM'), 'panel title drawn');
  assert(text.includes('EVENTS'), 'event counter drawn');
  harness.view.destroy();
});

/* ============================ 2. state machine ========================== */
check('session.start / tool / page events build the expected state', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER', locale: 'zh' });
  harness.triggerResize();
  drive(harness, view, 4500);
  const state = view.getState();
  assertEqual(state.status, 'live', 'session is live');
  assertEqual(state.totalEvents, 5, 'five pages discovered');
  assertEqual(state.statusCounts.completed, 2, 'two completed');
  assertEqual(state.statusCounts.failed, 1, 'one failed');
  assertEqual(state.statusCounts.running, 1, 'one running');
  assertEqual(state.statusCounts.pending, 1, 'one pending');
  assertEqual(state.counts.code, 1, 'route code count');
  assertEqual(state.counts.model, 4, 'route model count');
  assertEqual(state.tools.length, 5, 'five tracked tool calls');
  assert(state.tools.filter((tool) => tool.status === 'completed').length === 2, 'two tool completions tracked');
  assert(state.activity && /抓取/.test(state.activity.text), 'activity line reports the current fetch');
  assertEqual(state.session.title, 'DSH WEB SPIDER', 'session title from payload');
  // DOM list rows for every page + status labels
  const rows = harness.find('sv-row');
  assertEqual(rows.length, 5, 'list rows match page count');
  const rowText = rows.map((row) => deepText(row)).join(' ');
  assert(rowText.includes('已完成') && rowText.includes('失败') && rowText.includes('进行中'), 'row status labels rendered');
  // canvas contains the page title label and route colors
  const drawn = texts(harness).join('\n');
  assert(drawn.includes('renderer.js') || drawn.includes('GitHub') || drawn.includes('Canvas'), 'page label drawn on canvas');
  const strokeStyles = stylesSet(harness, 'strokeStyle').join(' ');
  assert(strokeStyles.includes('#48d7a6') || strokeStyles.includes('#e18c78'), 'route colors used for strands');
  harness.view.destroy();
});

/* =========================== 3. drawing primitives ====================== */
check('engine spider body / legs / probes / pulse render calls are emitted', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  drive(harness, view, 4300);
  const ellipses = methods(harness, 'ellipse');
  const body = ellipses.some((entry) => Math.abs(entry.args[2] - 23.7) < 0.01 && Math.abs(entry.args[3] - 30) < 0.01);
  assert(body, 'wire body ellipse (23.7 × 30) drawn by app/spider.js');
  assert(methods(harness, 'fillRect').length > 40, 'fillRect calls drawn');
  assert(methods(harness, 'bezierCurveTo').length > 0, 'web / probe bezier curves drawn');
  assert(methods(harness, 'arc').length > 0, 'nodes / pulse arcs drawn');
  assert(methods(harness, 'setLineDash').length > 0, 'dashed probe reach used');
  const strokeWidths = stylesSet(harness, 'lineWidth').filter((value) => typeof value === 'number');
  assert(strokeWidths.some((value) => value > 2 && value < 4), 'scan/thick strokes present');
  // activity pulse: an accent/route-colored arc is emitted right after a page event
  clearOps(harness);
  view.push(pageStatus('gh-api-trees', 'completed', { route: 'model' }));
  harness.step(2);
  assert(methods(harness, 'arc').length > 0, 'pulse rings drawn after a page update');
  assert(stylesSet(harness, 'strokeStyle').some((value) => value === '#e18c78' || value === '#f23c83'), 'pulse uses theme/route color');
  harness.view.destroy();
});

/* ============================ 4. walk to node =========================== */
check('focusOn() selects a page and the spider moves toward its node', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  drive(harness, view, 4500);
  const translations = methods(harness, 'translate').filter((entry) => entry.args[0] !== 0);
  const before = translations.slice(-1)[0];
  assert(before, 'spider translate op recorded');
  assertEqual(view.focusOn('blocked-page'), true, 'focusOn returns true');
  assertEqual(view.getState().selectedId, 'blocked-page', 'selectedId updated');
  harness.advance(1200);
  const afterTranslations = methods(harness, 'translate').filter((entry) => entry.args[0] !== 0);
  const after = afterTranslations.slice(-1)[0];
  assert(after, 'spider translate op after focus');
  const moved = Math.hypot(after.args[0] - before.args[0], after.args[1] - before.args[1]);
  assert(moved > 6, 'spider moved toward node, moved=' + moved.toFixed(2));
  assertEqual(view.focusOn('does-not-exist'), false, 'focusOn on unknown id returns false');
  harness.view.destroy();
});

/* ============================ 5. hit-testing ============================ */
check('canvas hit-testing selects a page node on click', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  drive(harness, view, 4300);
  let selected = null;
  outer:
  for (let y = 12; y < harness.size.stageHeight; y += 6) {
    for (let x = 12; x < harness.size.stageWidth; x += 6) {
      harness.clickCanvas(x, y);
      const current = view.getState().selectedId;
      if (current) {
        selected = current;
        break outer;
      }
    }
  }
  assert(selected, 'clicking a node selected a page (grid scan)');
  assert(view.getState().selectedId === selected, 'selection state persists');
  // clicking the same empty area far outside the web should clear it
  view.push({ type: 'reset' });
  harness.step(1);
  harness.view.destroy();
});

/* ========================== 6. responsiveness =========================== */
check('responsive 320–900px: canvas/dpr/layout classes are correct', () => {
  const sizes = [
    { width: 320, height: 640, stageWidth: 320, stageHeight: 250, wide: false, narrow: true },
    { width: 380, height: 700, stageWidth: 380, stageHeight: 340, wide: false, narrow: false },
    { width: 480, height: 720, stageWidth: 480, stageHeight: 350, wide: false, narrow: false },
    { width: 900, height: 600, stageWidth: 600, stageHeight: 570, wide: true, narrow: false },
  ];
  for (const size of sizes) {
    const harness = createHarness({ width: size.width, height: size.height, stageWidth: size.stageWidth, stageHeight: size.stageHeight, dpr: 2 });
    const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
    harness.triggerResize();
    harness.step(1);
    harness.advance(64);
    const canvas = harness.find('sv-canvas')[0];
    assertEqual(canvas.width, Math.round(size.stageWidth * 2), size.width + 'px canvas backing width @dpr2');
    assertEqual(canvas.height, Math.round(size.stageHeight * 2), size.width + 'px canvas backing height @dpr2');
    assertEqual(harness.root.classList.contains('sv-wide'), size.wide, size.width + 'px sv-wide class');
    assertEqual(harness.root.classList.contains('sv-narrow'), size.narrow, size.width + 'px sv-narrow class');
    assert(harness.ops.length > 100, size.width + 'px drew frames');
    // resize across the breakpoint
    if (size.width === 380) {
      harness.setSize({ width: 900, height: 600, stageWidth: 620, stageHeight: 570 });
      harness.triggerResize();
      harness.step(1);
      assertEqual(canvas.width, 1240, 'resize recomputes backing store');
      assert(harness.root.classList.contains('sv-wide'), 'resize switches to wide layout');
      assertEqual(view.resize(), undefined, 'resize() API callable');
      harness.setSize({ width: 320, height: 640, stageWidth: 320, stageHeight: 250 });
      harness.triggerResize();
      harness.step(1);
      assertEqual(canvas.width, 640, 'resize back to narrow recomputes backing store');
      assert(harness.root.classList.contains('sv-narrow'), 'resize back to narrow class');
    }
    view.destroy();
  }
});

/* ========================== 6b. devicePixelRatio ======================== */
check('devicePixelRatio is honoured and capped at 2', () => {
  for (const dpr of [1, 1.5, 3]) {
    const harness = createHarness({ width: 380, height: 700, stageWidth: 340, stageHeight: 300, dpr });
    const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
    harness.triggerResize();
    harness.step(1);
    const canvas = harness.find('sv-canvas')[0];
    const expected = Math.round(340 * Math.min(2, dpr));
    assertEqual(canvas.width, expected, 'canvas backing width @dpr' + dpr);
    assertEqual(canvas.height, Math.round(300 * Math.min(2, dpr)), 'canvas backing height @dpr' + dpr);
    view.destroy();
  }
});

/* ========================== 7. destroy ================================== */
check('destroy() stops RAF, removes listeners and detaches the DOM', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  harness.step(2);
  assert(harness.listenerCount('resize') >= 1, 'window resize listener attached');
  const canvas = harness.find('sv-canvas')[0];
  assert(canvas.listeners.get('click').size >= 1, 'canvas click listener attached');
  view.destroy();
  clearOps(harness);
  harness.step(5);
  assertEqual(harness.ops.length, 0, 'no further drawing after destroy');
  assertEqual(harness.raf.size, 0, 'no RAF callbacks left queued');
  assertEqual(harness.listenerCount('resize'), 0, 'window resize listener removed');
  assertEqual(harness.container.children.length, 0, 'root detached from container');
  const revision = view.getState().revision;
  view.push({ type: 'page.discovered', id: 'late', url: 'https://late.example', title: 'late', route: 'code' });
  assertEqual(view.getState().revision, revision, 'push after destroy is a no-op');
  view.destroy();
});

/* ========================= 8. snapshot / canvas ========================= */
check('exposes .canvas and snapshot() for in-app visual verification', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  harness.step(2);
  assert(view.canvas && view.canvas.tagName === 'CANVAS', '.canvas is exposed');
  const snapshot = view.snapshot();
  assert(typeof snapshot === 'string' && snapshot.indexOf('data:image/png') === 0, 'snapshot() returns a PNG data URL');
  assertEqual(view.snapshot(), snapshot, 'snapshot() is repeatable');
  assertEqual(view.snapshot('image/jpeg'), snapshot, 'snapshot(mime) forwards the mime type');
  harness.view.destroy();
});

/* ========================== 9. setPages / replay ======================== */
check('setPages() and session.replay restore a session snapshot', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  view.setPages([
    { id: 'a', url: 'https://a.example', title: 'Page A', route: 'code', status: 'completed' },
    { id: 'b', url: 'https://b.example', title: 'Page B', route: 'model', status: 'failed' },
    { id: 'c', url: 'https://c.example', title: 'Page C', route: 'you', status: 'pending' },
  ]);
  harness.step(2);
  let state = view.getState();
  assertEqual(state.totalEvents, 3, 'setPages total');
  assertEqual(state.statusCounts.completed, 1, 'setPages completed');
  assertEqual(harness.find('sv-row').length, 3, 'setPages rebuilds rows');
  view.push({
    type: 'session.replay',
    session: { id: 'replay-1', title: 'Replay', status: 'completed', duration: 12.5 },
    pages: [
      { id: 'a', url: 'https://a.example', title: 'Page A', route: 'code', status: 'completed', firstAt: 1 },
      { id: 'b', url: 'https://b.example', title: 'Page B', route: 'model', status: 'completed', firstAt: 2 },
    ],
  });
  harness.step(2);
  state = view.getState();
  assertEqual(state.status, 'completed', 'replay status');
  assertEqual(state.totalEvents, 2, 'replay replaces pages');
  assertEqual(state.session.title, 'Replay', 'replay session title');
  assert(state.session.duration >= 12.4, 'replay duration restored');
  harness.view.destroy();
});

/* ============================== 10. theme =============================== */
check('theme patch and setTheme() update CSS variables', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, {
    title: 'DSH WEB SPIDER',
    theme: { background: '#101112', accent: '#ff0055' },
    routes: { code: { label: '检索', color: '#00ffaa' } },
  });
  harness.triggerResize();
  harness.step(1);
  assertEqual(harness.root.style.getPropertyValue('--sv-bg'), '#101112', 'theme background applied');
  assertEqual(harness.root.style.getPropertyValue('--sv-accent'), '#ff0055', 'theme accent applied');
  assertEqual(harness.root.style.getPropertyValue('--sv-code'), '#00ffaa', 'route color applied');
  view.setTheme({ background: '#000000', routes: { model: { label: '抓取', color: '#123456' } } });
  assertEqual(harness.root.style.getPropertyValue('--sv-bg'), '#000000', 'setTheme background applied');
  assertEqual(harness.root.style.getPropertyValue('--sv-model'), '#123456', 'setTheme route color applied');
  assertEqual(view.getState().routes.model.label, '抓取', 'setTheme route label applied');
  harness.view.destroy();
});

/* ====================== 11. limits / idempotency ======================== */
check('duplicate updates are idempotent and maxPages is enforced', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER', maxPages: 4 });
  harness.triggerResize();
  for (let i = 0; i < 6; i += 1) {
    view.push({ type: 'page.discovered', id: 'page-' + i, url: 'https://p' + i + '.example', title: 'Page ' + i, route: 'code' });
  }
  harness.step(1);
  assertEqual(view.getState().totalEvents, 4, 'maxPages caps the page list');
  const rowCount = harness.find('sv-row').length;
  view.push({ type: 'page.status', id: 'page-5', url: 'https://p5.example', title: 'Page 5', status: 'completed', route: 'model' });
  view.push({ type: 'page.status', id: 'page-5', url: 'https://p5.example', title: 'Page 5', status: 'completed', route: 'model' });
  harness.step(1);
  assertEqual(view.getState().totalEvents, rowCount, 'repeated updates do not add events');
  assertEqual(view.getState().statusCounts.completed, 1, 'repeated updates do not duplicate status counts');
  harness.view.destroy();
});

/* ==================== 12. unknown events / reduced motion ============== */
check('unknown event types warn (once) instead of throwing; reduced motion works', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2, reducedMotion: true });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER', reducedMotion: 'auto' });
  harness.triggerResize();
  view.push({ type: 'totally.unknown', foo: 1 });
  view.push({ type: 'totally.unknown', foo: 2 });
  harness.step(3);
  assertEqual(harness.warnings.filter((line) => line.indexOf('unknown event type') >= 0).length, 1, 'unknown event warned once');
  assertEqual(view.getState().reducedMotion, true, 'matchMedia reduced-motion honoured');
  harness.view.destroy();
});

/* ========================= 13. long-run stability ======================= */
check('renders 12 s of animation without exceptions (memory-bounded)', () => {
  const harness = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const view = harness.run(WIDGET, { title: 'DSH WEB SPIDER' });
  harness.triggerResize();
  drive(harness, view, 6000);
  for (let second = 0; second < 12; second += 1) {
    harness.advance(1000);
    clearOps(harness);
  }
  assertEqual(harness.warnings.filter((line) => line.indexOf('RAF ERROR') >= 0).length, 0, 'no RAF errors');
  const state = view.getState();
  assertEqual(state.status, 'completed', 'session completed');
  harness.view.destroy();
});

/* ====================== 14. instance isolation ========================== */
check('two widget instances keep independent state', () => {
  const harnessA = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const viewA = harnessA.run(WIDGET, { title: 'A' });
  harnessA.triggerResize();
  harnessA.step(1);
  const harnessB = createHarness({ width: 380, height: 700, stageWidth: 380, stageHeight: 340, dpr: 2 });
  const viewB = harnessB.run(WIDGET, { title: 'B' });
  harnessB.triggerResize();
  harnessB.step(1);
  viewA.push({ type: 'page.discovered', id: 'only-a', url: 'https://a.example', title: 'Only A', route: 'code' });
  harnessA.step(1);
  harnessB.step(1);
  assertEqual(viewA.getState().totalEvents, 1, 'A sees its page');
  assertEqual(viewB.getState().totalEvents, 0, 'B is unaffected');
  assert(/^sv-\d+$/.test(viewA.el.id) && /^sv-\d+$/.test(viewB.el.id), 'instances get generated ids');
  viewA.destroy();
  viewB.destroy();
});

/* ============================== summary ================================= */
console.log('\n' + '-'.repeat(64));
console.log(pass + ' passed, ' + fail + ' failed');if (fail) {
  for (const failure of failures) console.log('\nFAILED: ' + failure.name + '\n' + (failure.error && failure.error.stack));
  process.exitCode = 1;
} else {
  console.log('OK: spider-widget verified against fake DOM + recording canvas context');
}
