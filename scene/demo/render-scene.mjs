#!/usr/bin/env node
/**
 * render-scene.mjs — headless acceptance render for spider-scene/scene.js.
 *
 * Uses @napi-rs/canvas (reused from spider-embed/build/tools) behind a tiny
 * stubbed DOM: scene.js must load in Node, create its own canvas, render the
 * dashboard and produce a PNG through snapshot() — i.e. exactly what the host
 * plugin will do with canvas.toDataURL().
 *
 * Outputs (scene/demo/):
 *   scene-1280x800.png     full-screen dashboard, 16:10
 *   scene-900x1000.png     portrait dashboard, 9:10
 *   scene-1280x800@2x.png  DPR-cap-2 sanity render (optional, --dpr)
 *   mock-scene.json        the exact mock model rendered here
 *
 * Usage: node demo/render-scene.mjs [--dpr]
 */
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = resolve(HERE, '..');
const { createCanvas } = require('embed/build/tools/node_modules/@napi-rs/canvas');
const { createSpiderScene, meta } = require(join(ROOT, 'scene.js'));
const { createMockModel } = await import('./mock-data.mjs');

/** Minimal DOM stub: only the surface createSpiderScene() actually touches. */
function stubDom() {
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
        clientWidth: 0,
        clientHeight: 0,
      };
      return node;
    },
  };
  const win = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
    // deliberately no requestAnimationFrame/ResizeObserver: scene.js must fall
    // back to synchronous draws (snapshot()/setData()/resize()).
  };
  doc.defaultView = win;
  return { doc, win };
}

function decodeDataUrl(url) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(String(url || ''));
  if (!match) return null;
  return match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
}

async function render({ width, height, name, pixelRatio = 1, locale = 'zh', animationTime = 8.6, dprNote = '' }) {
  const { doc } = stubDom();
  const container = doc.createElement('div');
  container.clientWidth = width;
  container.clientHeight = height;
  const scene = createSpiderScene(container, {
    locale,
    width,
    height,
    pixelRatio,
    animationTime,
  });
  const model = createMockModel();
  scene.setData(model);
  const started = Date.now();
  const dataUrl = scene.snapshot('image/png');
  const bytes = decodeDataUrl(dataUrl);
  if (!bytes) throw new Error('snapshot() did not return a PNG data URL');
  const state = scene.getState();
  const out = join(HERE, name);
  await writeFile(out, bytes);
  const elapsed = Date.now() - started;
  console.log(`wrote ${out} (${bytes.length} bytes, ${elapsed} ms)`);
  console.log(`  css ${state.size.width}x${state.size.height} dpr ${state.size.dpr} => canvas ${scene.canvas.width}x${scene.canvas.height}`);
  console.log(`  status=${state.status} elapsed=${state.elapsed}s pages=${state.counts.pages} calls=${state.counts.calls} metrics=${JSON.stringify(state.metrics)}`);
  const destroyed = scene.destroy();
  return { out, state, destroyed, scene };
}

const dpr = process.argv.includes('--dpr');
console.log(`spider-scene ${meta.version} · engine ${meta.engine} (v${meta.engine.version})`);

const model = createMockModel();
await writeFile(join(HERE, 'mock-scene.json'), JSON.stringify(model, null, 2) + '\n');
console.log(`wrote ${join(HERE, 'mock-scene.json')} (${model.pages.length} pages, ${model.calls.length} calls)`);

// Default frame: labels looping forever, counters already accumulated a few loops.
await render({ width: 1280, height: 800, name: 'scene-1280x800.png', animationTime: 10.0 });
// Early frames: labels always present; counters start at 0 and begin accumulating.
await render({ width: 1280, height: 800, name: 'scene-1280x800-t0.png', animationTime: 0.3 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-t1.png', animationTime: 2.5 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-t2.png', animationTime: 8.6 });
// Flow proof: same scene at 3 close animation times — labels move along their paths.
await render({ width: 1280, height: 800, name: 'scene-1280x800-flow-a.png', animationTime: 2.4 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-flow-b.png', animationTime: 2.8 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-flow-c.png', animationTime: 3.2 });
// Infinite-loop proof: numbers keep accumulating across passes while real totals
// stay frozen in the card footnotes / footer.
await render({ width: 1280, height: 800, name: 'scene-1280x800-loop-a.png', animationTime: 6.0 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-loop-b.png', animationTime: 14.0 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-loop-c.png', animationTime: 26.0 });
// Upward-scroll proof: the same left-stream rows are clearly higher at t+0.6s
// while the spider stays in its lower anchor zone and boxes track the flow.
await render({ width: 1280, height: 800, name: 'scene-1280x800-scroll-a.png', animationTime: 6.0 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-scroll-b.png', animationTime: 6.6 });
await render({ width: 1280, height: 800, name: 'scene-1280x800-scroll-c.png', animationTime: 7.2 });
await render({ width: 900, height: 1000, name: 'scene-900x1000.png', animationTime: 12.2 });
// The live DSH host renders the scene at this size (bonus reference render).
await render({ width: 1148, height: 962, name: 'scene-1148x962.png', animationTime: 10.4 });
if (dpr) {
  await render({ width: 1280, height: 800, name: 'scene-1280x800@2x.png', pixelRatio: 2, animationTime: 10.0 });
}
console.log('done.');
