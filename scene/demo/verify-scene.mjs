#!/usr/bin/env node
/**
 * verify-scene.mjs — headless API/lifecycle acceptance checks for scene.js.
 *
 * Runs the real dist file (scene/scene.js) against a minimal
 * stubbed DOM + @napi-rs/canvas Skia backend, so no browser is required:
 *   - loads via require() and exposes createSpiderScene
 *   - creates its own <canvas> inside the given container
 *   - setData / push / resize / getState / snapshot / destroy behave as documented
 *   - empty model, en locale, reducedMotion, theme patch, maxPages and DPR cap 2
 *   - destroy() detaches the canvas and makes the instance inert
 *
 * Usage: node demo/verify-scene.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = join(HERE, '..');
const { createCanvas } = require('embed/build/tools/node_modules/@napi-rs/canvas');
const { createSpiderScene, meta } = require(join(ROOT, 'scene.js'));
const { createMockModel } = await import('./mock-data.mjs');

let pass = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      pass += 1;
      console.log('  ok  ' + name);
    })
    .catch((error) => {
      console.error('  FAIL ' + name);
      throw error;
    });
}

function stubDom({ devicePixelRatio = 1 } = {}) {
  const doc = {
    hidden: false,
    defaultView: null,
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) {
      if (tag === 'canvas') {
        const canvas = createCanvas(1, 1);
        canvas.width = 1;
        canvas.height = 1;
        return canvas;
      }
      const node = {
        ownerDocument: doc,
        childNodes: [],
        appendChild(child) {
          child.parentNode = node;
          node.childNodes.push(child);
          return child;
        },
        removeChild(child) {
          const index = node.childNodes.indexOf(child);
          if (index >= 0) node.childNodes.splice(index, 1);
          child.parentNode = null;
          return child;
        },
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        clientWidth: 0,
        clientHeight: 0,
      };
      return node;
    },
  };
  const win = {
    devicePixelRatio,
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  doc.defaultView = win;
  return { doc, win };
}

function makeScene({ width = 720, height = 440, dpr = 1, options = {}, model = null } = {}) {
  const { doc, win } = stubDom({ devicePixelRatio: dpr });
  const container = doc.createElement('div');
  container.clientWidth = width;
  container.clientHeight = height;
  const scene = createSpiderScene(container, Object.assign({ width, height }, options));
  if (model !== null) scene.setData(model);
  return { scene, container, doc, win };
}

console.log(`spider-scene ${meta.version} · scene.js API checks`);
console.log('meta:', JSON.stringify(meta));

await check('loads via require() and exposes createSpiderScene + meta', () => {
  assert.equal(typeof createSpiderScene, 'function');
  assert.equal(meta.name, 'spider-scene');
  assert.equal(meta.upstream.commit, 'f6522df29739ccc4861c1227601980b88265923d');
});

await check('contract: el/canvas/setData/push/resize/destroy/snapshot/getState exposed', () => {
  const { scene } = makeScene();
  for (const key of ['el', 'canvas', 'setData', 'push', 'resize', 'destroy', 'snapshot', 'getState']) {
    assert.ok(scene[key], 'missing ' + key);
  }
  assert.equal(scene.el, scene.canvas, 'el should be the canvas element (canvas-only, no DOM chrome)');
  const parent = scene.canvas.parentNode;
  assert.ok(parent && parent.childNodes.includes(scene.canvas), 'canvas must be mounted in the container');
  scene.destroy();
});

await check('setData(mock model) drives all panels + getState metrics', () => {
  const { scene } = makeScene({ model: createMockModel() });
  const state = scene.getState();
  assert.equal(state.ready, true);
  assert.equal(state.status, 'live');
  assert.equal(state.metrics.queries, 12);
  assert.equal(state.metrics.results, 96);
  assert.equal(state.metrics.fetches, 8);
  assert.equal(state.metrics.failures, 2);
  assert.equal(state.counts.pages, 30);
  assert.equal(state.counts.calls, 20);
  assert.deepEqual(state.size, { width: 720, height: 440, dpr: 1 });
  scene.destroy();
});

await check('snapshot() returns a PNG data URL (canvas.toDataURL path)', () => {
  const { scene } = makeScene({ model: createMockModel() });
  const url = scene.snapshot('image/png');
  assert.equal(typeof url, 'string');
  assert.ok(url.startsWith('data:image/png;base64,'), 'expected PNG data URL');
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  scene.destroy();
});

await check('push(activity) increments metrics + appends activity', () => {
  const { scene } = makeScene({ model: createMockModel() });
  const before = scene.getState().metrics;
  assert.equal(scene.push({ kind: 'search', label: 'new query', at: Date.now() }), true);
  assert.equal(scene.push({ kind: 'fetch', label: 'https://x.test/p', at: Date.now() }), true);
  assert.equal(scene.push({ kind: 'fail', label: 'https://x.test/boom', at: Date.now() }), true);
  const after = scene.getState().metrics;
  assert.equal(after.queries, before.queries + 1);
  assert.equal(after.fetches, before.fetches + 1);
  assert.equal(after.failures, before.failures + 1);
  assert.equal(after.events, before.events + 3);
  scene.destroy();
});

await check('push(call/page/metrics/status) upserts without throwing', () => {
  const { scene } = makeScene({ model: createMockModel() });
  scene.push({ type: 'call', call: { id: 'call-live2', tool: 'web_fetch', url: 'https://example.test/a', status: 'completed', httpStatus: 200, bytes: 2048, startedAt: Date.now() - 900, endedAt: Date.now(), resultCount: 0 } });
  scene.push({ type: 'page', page: { id: 'page-extra', url: 'https://example.test/a', title: 'Example', route: 'code', status: 'completed', firstAt: Date.now(), updatedAt: Date.now() } });
  scene.push({ type: 'metrics', metrics: { events: 99 } });
  scene.push({ type: 'status', status: 'done', at: Date.now() });
  const state = scene.getState();
  assert.equal(state.counts.calls, 21);
  assert.equal(state.counts.pages, 31);
  assert.equal(state.metrics.events, 99);
  assert.equal(state.status, 'done');
  scene.destroy();
});

await check('resize() re-measures the container and re-allocates the backing store', () => {
  const { scene, container } = makeScene({ width: 720, height: 440 });
  assert.equal(scene.canvas.width, 720);
  container.clientWidth = 1000;
  container.clientHeight = 560;
  scene.resize();
  assert.deepEqual(scene.getState().size, { width: 1000, height: 560, dpr: 1 });
  assert.equal(scene.canvas.width, 1000);
  assert.equal(scene.canvas.height, 560);
  scene.destroy();
});

await check('DPR is capped at 2', () => {
  const { scene } = makeScene({ width: 640, height: 400, dpr: 3 });
  assert.equal(scene.getState().size.dpr, 2);
  assert.equal(scene.canvas.width, 1280);
  assert.equal(scene.canvas.height, 800);
  scene.destroy();
});

await check('empty model renders without exceptions (idle state)', () => {
  const { scene } = makeScene({ model: {} });
  const state = scene.getState();
  assert.equal(state.status, 'idle');
  assert.equal(state.counts.pages, 0);
  assert.equal(state.counts.calls, 0);
  assert.ok(scene.snapshot().length > 1000);
  scene.destroy();
});

await check('en locale + reducedMotion + theme patch + maxPages cap', () => {
  const model = createMockModel();
  const { scene } = makeScene({
    locale: 'en',
    model: Object.assign({}, model, { pages: model.pages.concat(model.pages.map((page, i) => Object.assign({}, page, { id: page.id + '-x' + i }))) }),
    options: {
      locale: 'en',
      reducedMotion: true,
      maxPages: 20,
      theme: { code: '#00ffcc', pink: '#ff00aa' },
    },
  });
  const state = scene.getState();
  assert.equal(state.reducedMotion, true);
  assert.equal(state.counts.pages, 60);
  assert.equal(state.counts.pagesRendered, 20, 'maxPages caps rendered pages, not the discovered total');
  assert.ok(scene.snapshot().length > 1000);
  scene.destroy();
});

await check('destroy() detaches canvas and makes calls inert', () => {
  const { scene, container } = makeScene({ model: createMockModel() });
  scene.destroy();
  assert.equal(container.childNodes.length, 0, 'canvas should be removed from the container');
  assert.equal(scene.getState().destroyed, true);
  assert.equal(scene.setData(createMockModel()), false);
  assert.equal(scene.push({ kind: 'search', label: 'x' }), false);
  assert.equal(scene.snapshot(), null);
});

console.log(`\nall ${pass} checks passed.`);
