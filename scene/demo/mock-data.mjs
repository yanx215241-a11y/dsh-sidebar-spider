/**
 * mock-data.mjs — realistic DSH web-research session used by the demo renderer
 * and reported to the host plugin for integration tests.
 *
 * Shape matches SCENE-API.md#data-model:
 *   { status, sessionId, startedAt, now, metrics, calls[], pages[], activities[] }
 * Session: 24.6 s, 12 web_search queries, 8 web_fetch calls (2 failures),
 * 30 discovered pages (18 completed / 3 running / 2 failed / 7 pending).
 *
 * Deterministic: no Math.random / Date.now — pass a `now` to shift the clock.
 */

const BASE = Date.UTC(2026, 9, 28, 3, 40, 0); // 2026-10-28T03:40:00Z
const NOW = BASE + 24600;

const QUERIES = [
  'deepseek harness client plugin api',
  'dsh webresearch event contract',
  'npm @napi-rs canvas windows prebuilt',
  'canvas 2d dashboard high dpr performance',
  'chrome mv3 content script canvas snapshot',
  'dsh plugin sidebar hot reload',
  'webgpu vs canvas 2d line rendering',
  'resizeobserver devicepixelratio canvas crisp',
  'node canvas todataurl png buffer',
  'prompt spider ui github yanx215241-a11y',
  'dsh plugin manifest schema',
  'electrobun webview dsh runtime',
];

/** Up to 3 result titles per search call (new model field `calls[].resultTitles`). */
const RESULT_TITLES = [
  ['deepseek-harness/README.md at main', 'DSH client plugin API reference', 'Harness plugin lifecycle — docs'],
  ['webresearch event contract (schema)', 'DSH tool events: web_search / web_fetch', 'Streaming tool results in DSH'],
  ['@napi-rs/canvas - npm package page', 'canvas 0.3.x prebuilt binaries for win32-x64', 'Skia bindings for Node.js'],
  ['High-DPI canvas rendering guide', 'Device pixel ratio and crisp text', '60fps Canvas2D dashboard techniques'],
  ['Canvas snapshot in extension content scripts', 'chrome.tabs.captureVisibleTab fallback', 'OffscreenCanvas in MV3 service workers'],
  ['DSH plugin hot-reload dev loop', 'Vite HMR for client plugins', 'Reloading sidebar without restarting DSH'],
  ['WebGPU vs Canvas2D line drawing benchmarks', 'GPU line rendering performance', 'When Canvas2D is fast enough'],
  ['ResizeObserver + devicePixelRatio canvas setup', 'Crisp canvas on monitor DPI changes', 'Preventing blurry canvas on zoom'],
  ['node-canvas toDataURL returns base64 PNG', '@napi-rs/canvas encodePNG API', 'Write PNG buffer from canvas in Node'],
  ['canvas-engine — every word, one fork', 'yanx215241-a11y/dsh-sidebar-spider README', 'Prompt spider dashboard screenshots'],
  ['DSH plugin manifest reference', 'plugin.json schema and capabilities', 'Client plugin entry points'],
  ['electrobun webview runtime notes', 'DSH runtime: embedded Chromium version', 'Webview performance for canvas apps'],
];

/** Short fetched-page excerpts (new model field `calls[].excerpt`). */
const FETCH_EXCERPTS = {
  'https://github.com/deepseek-ai/deepseek-harness':
    'The harness exposes a typed plugin surface: client plugins register sidebar views over a transport that streams tool events. Each tool call carries a stable id, timestamps and a result payload; web tools emit search hits or fetched page text.',
  'https://www.npmjs.com/package/@napi-rs/canvas':
    'Prebuilt Skia bindings for Node.js. createCanvas(width, height) returns a Canvas with getContext("2d"), toBuffer("image/png") and toDataURL(); fonts are resolved from the host system or registered via GlobalFonts.registerFromPath.',
  'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API':
    'The Canvas API provides a means for drawing graphics via JavaScript and the HTML canvas element. Among other things, it can be used for animation, game graphics, data visualization, photo manipulation, and real-time video processing.',
  'https://github.com/yanx215241-a11y/dsh-sidebar-spider':
    'A deterministic, resolution-independent recreation of a reference terminal: numbered prompt statements, a wireframe spider, and a fan of strands that fork each word to code, model, or you.',
  'https://www.electronjs.org/docs/latest/api/web-contents':
    'webContents is an EventEmitter that renders and controls a web page. Use setWindowOpenHandler, capturePage() for snapshots and executeJavaScript to run code in the page context.',
  'https://raster.ink/blog/layered-canvas':
    'Layered canvas architecture: split static chrome, animated strands and overlay text into three canvases so the expensive layer only repaints when data changes. Avoids full-surface redraws at 60fps.',
  'https://github.com/dsh-plugin/registry':
    '404: Not Found — the requested repository dsh-plugin/registry does not exist or is private.',
  'https://inspect.dev/guides/debugging-electron-apps':
    'Connect devtools to an Electron app via the remote debugging port, inspect the renderer, and profile long frames. Canvas-heavy UIs benefit from the performance panel and layer borders overlay.',
  'https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver':
    'ResizeObserver reports changes to the size of an element content box. Observing a dashboard container lets the canvas backing store match the CSS box, keeping text crisp at any panel size.',
};

/** Per-page excerpt/snippet (`pages[].excerpt`), keyed by URL for the mock. */
const PAGE_EXCERPTS = {
  'https://github.com/deepseek-ai/deepseek-harness': 'Plugin surface, tool event transport and sidebar view registration.',
  'https://www.npmjs.com/package/@napi-rs/canvas': 'Skia canvas for Node: createCanvas, getContext, toBuffer, toDataURL.',
  'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API': 'Canvas 2D drawing surface: state, paths, text, images and animation.',
  'https://github.com/yanx215241-a11y/dsh-sidebar-spider': 'Reference dashboard: prompt statements, spider, forked strands and route cards.',
  'https://www.electronjs.org/docs/latest/api/web-contents': 'Render and control a web page from the main process; capturePage() snapshots.',
  'https://raster.ink/blog/layered-canvas': 'Layered canvas: static chrome, animated strands, overlay text.',
  'https://stackoverflow.com/questions/15661339/how-do-i-fix-blurry-text-in-my-html5-canvas': 'Scale the canvas backing store by devicePixelRatio and CSS-size it down.',
  'https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver': 'Observe container box changes to resize the canvas backing store.',
  'https://github.com/dsh-plugin/registry': 'Repository not found (HTTP 404).',
  'https://inspect.dev/guides/debugging-electron-apps': 'Remote debugging, renderer inspection and long-frame profiling.',
};

const PAGES = [
  ['https://github.com/deepseek-ai/deepseek-harness', 'deepseek-harness: agent runtime & plugin host', 'code', 'completed'],
  ['https://www.npmjs.com/package/@napi-rs/canvas', '@napi-rs/canvas - npm', 'code', 'completed'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API', 'Canvas API - MDN', 'code', 'completed'],
  ['https://developer.chrome.com/docs/extensions/reference/api/tabs', 'chrome.tabs - Chrome Developers', 'model', 'completed'],
  ['https://github.com/yanx215241-a11y/dsh-sidebar-spider', 'canvas-engine: every word, one fork', 'code', 'completed'],
  ['https://nodejs.org/api/fs.html', 'File system | Node.js docs', 'code', 'completed'],
  ['https://www.electronjs.org/docs/latest/api/web-contents', 'webContents | Electron', 'model', 'completed'],
  ['https://web.dev/articles/device-pixel-ratio', 'Device pixel ratio - web.dev', 'code', 'completed'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver', 'ResizeObserver - MDN', 'model', 'completed'],
  ['https://stackoverflow.com/questions/15661339/how-do-i-fix-blurry-text-in-my-html5-canvas', 'How do I fix blurry text in my HTML5 canvas?', 'model', 'completed'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio', 'Window.devicePixelRatio - MDN', 'code', 'completed'],
  ['https://vitejs.dev/guide/features.html#hot-module-replacement', 'HMR - Vite guide', 'code', 'completed'],
  ['https://github.com/Automattic/node-canvas', 'node-canvas: Canvas for Node.js', 'model', 'completed'],
  ['https://skia.org/docs/user/api/', 'Skia Graphics Library', 'model', 'completed'],
  ['https://www.chromium.org/developers/design-documents/gpu-accelerated-canvas/', 'GPU accelerated canvas', 'model', 'completed'],
  ['https://inspect.dev/guides/debugging-electron-apps', 'Debugging Electron apps', 'you', 'running'],
  ['https://excalidraw.com/blog/performance', 'Excalidraw rendering performance', 'model', 'completed'],
  ['https://observablehq.com/@d3/force-directed-graph', 'Force-directed graph / D3', 'model', 'completed'],
  ['https://github.com/d3/d3-force', 'd3-force', 'code', 'completed'],
  ['https://www.w3.org/TR/html52/scripting-1.html', 'Scripting - HTML 5.2', 'code', 'pending'],
  ['https://github.com/pixijs/pixijs', 'PixiJS WebGL renderer', 'model', 'pending'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas', 'OffscreenCanvas - MDN', 'code', 'running'],
  ['https://github.com/GoogleChromeLabs/comlink', 'Comlink: web workers without pain', 'model', 'pending'],
  ['https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API', 'IndexedDB API - MDN', 'you', 'pending'],
  ['https://www.electronjs.org/docs/latest/tutorial/security', 'Electron security guidelines', 'you', 'failed'],
  ['https://raster.ink/blog/layered-canvas', 'Layered canvas architecture', 'model', 'running'],
  ['https://developer.chrome.com/docs/workbox', 'Workbox | Chrome Developers', 'code', 'pending'],
  ['https://github.com/dsh-plugin/registry', 'DSH plugin registry', 'you', 'failed'],
  ['https://www.zhihu.com/question/422271312', 'Canvas 大屏可视化性能优化', 'model', 'pending'],
  ['https://juejin.cn/post/7202636731871096890', '从零实现一个 Canvas 监控大屏', 'you', 'pending'],
];

/** [startOffsetMs, tool, queries/url, endOffsetMs, {resultCount|httpStatus,bytes}] */
const CALL_SCRIPT = [
  [0, 'web_search', QUERIES[0], 1180, { resultCount: 9 }],
  [700, 'web_search', QUERIES[1], 1900, { resultCount: 7 }],
  [1600, 'web_fetch', 'https://github.com/deepseek-ai/deepseek-harness', 2840, { httpStatus: 200, bytes: 118_400 }],
  [2500, 'web_search', QUERIES[2], 3690, { resultCount: 8 }],
  [3100, 'web_fetch', 'https://www.npmjs.com/package/@napi-rs/canvas', 4380, { httpStatus: 200, bytes: 84_200 }],
  [3900, 'web_search', QUERIES[3], 5100, { resultCount: 12 }],
  [4700, 'web_fetch', 'https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API', 5960, { httpStatus: 200, bytes: 62_800 }],
  [5400, 'web_search', QUERIES[4], 6520, { resultCount: 6 }],
  [6300, 'web_fetch', 'https://github.com/yanx215241-a11y/dsh-sidebar-spider', 7180, { httpStatus: 200, bytes: 41_300 }],
  [7000, 'web_search', QUERIES[5], 8220, { resultCount: 10 }],
  [8800, 'web_search', QUERIES[6], 9960, { resultCount: 5 }],
  [9500, 'web_fetch', 'https://www.electronjs.org/docs/latest/api/web-contents', 10_430, { httpStatus: 200, bytes: 58_100 }],
  [10_200, 'web_search', QUERIES[7], 11_280, { resultCount: 8 }],
  [11_000, 'web_fetch', 'https://raster.ink/blog/layered-canvas', 11_690, { httpStatus: 504, bytes: 0 }],
  [11_900, 'web_search', QUERIES[8], 12_940, { resultCount: 4 }],
  [12_600, 'web_fetch', 'https://github.com/dsh-plugin/registry', 13_140, { httpStatus: 404, bytes: 0 }],
  [13_100, 'web_search', QUERIES[9], 14_260, { resultCount: 11 }],
  [15_200, 'web_search', QUERIES[10], 16_380, { resultCount: 7 }],
  [16_100, 'web_search', QUERIES[11], 17_220, { resultCount: 9 }],
  [20_100, 'web_fetch', 'https://inspect.dev/guides/debugging-electron-apps', -1, { httpStatus: -1, bytes: -1 }],
];

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

export function createMockModel(now = NOW) {
  const shift = now - NOW;
  const startedAt = BASE + shift;
  let searchOrder = 0;
  const calls = CALL_SCRIPT.map((entry, index) => {
    const [start, tool, target, end, extra] = entry;
    const isSearch = tool === 'web_search';
    const running = end < 0;
    const failed = scHttpFailed(extra.httpStatus);
    const excerpt = isSearch
      ? ''
      : (FETCH_EXCERPTS[target] || (failed ? `HTTP ${extra.httpStatus} — engine did not return the document.` : ''));
    const resultTitles = isSearch ? (RESULT_TITLES[searchOrder++] || []).slice(0, 3) : [];
    return {
      id: 'call-' + pad2(index + 1),
      tool,
      label: target,
      queries: isSearch ? [target] : [],
      url: isSearch ? '' : target,
      status: running ? 'running' : failed ? 'failed' : 'completed',
      startedAt: startedAt + start,
      endedAt: running ? -1 : startedAt + end,
      resultCount: extra.resultCount || 0,
      httpStatus: extra.httpStatus === undefined ? -1 : extra.httpStatus,
      bytes: extra.bytes === undefined ? -1 : extra.bytes,
      excerpt,
      resultTitles,
    };
  });
  const pages = PAGES.map(([url, title, route, status], index) => {
    const firstAt = startedAt + 400 + index * 520;
    const updatedAt = startedAt + Math.min(24_300, 900 + index * 610 + (index % 4) * 240);
    const detail = status === 'failed'
      ? (index === 24 ? 'HTTP 504 gateway timeout' : 'HTTP 404 not found')
      : status === 'completed' ? 'extracted' : status === 'running' ? 'reading' : 'queued';
    return {
      id: 'page-' + pad2(index + 1),
      url,
      title,
      route,
      status,
      detail,
      excerpt: PAGE_EXCERPTS[url] || (status === 'failed' ? detail : ''),
      firstAt,
      updatedAt,
    };
  });
  const activities = [];
  for (const call of calls) {
    const isSearch = call.tool === 'web_search';
    activities.push({ at: call.startedAt, kind: isSearch ? 'search' : 'fetch', label: call.label, route: isSearch ? 'code' : 'model' });
    if (call.status === 'completed') {
      activities.push({ at: call.endedAt, kind: 'result', label: call.label, route: isSearch ? 'code' : 'model' });
    } else if (call.status === 'failed') {
      activities.push({ at: call.endedAt, kind: 'fail', label: call.label, route: 'you' });
    }
  }
  activities.push({ at: startedAt, kind: 'start', label: 'session start' });
  activities.push({ at: startedAt + 24_400, kind: 'end', label: 'fetch retry scheduled', route: 'you' });
  activities.sort((a, b) => a.at - b.at);

  // Derived metrics — exactly what the scene derives when metrics are absent.
  const hosts = new Set(pages.map((page) => scHost(page.url)).filter(Boolean));
  const queries = calls.filter((call) => call.tool === 'web_search').length;
  const fetches = calls.filter((call) => call.tool === 'web_fetch').length;
  const failures = calls.filter((call) => call.status === 'failed').length;
  const results = calls.reduce((sum, call) => sum + call.resultCount, 0);

  return {
    status: 'live',
    sessionId: 'research-2f8c1a',
    startedAt,
    now: startedAt + 24_600,
    metrics: { queries, results, sources: hosts.size, fetches, failures, events: activities.length },
    calls,
    pages,
    activities,
  };
}

function scHttpFailed(httpStatus) {
  return typeof httpStatus === 'number' && httpStatus >= 400;
}
function scHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (error) {
    return '';
  }
}

export const MOCK_NOW = NOW;
export default createMockModel;
