/* ============================================================================
 * spider-embed composition — src/widget.js
 *
 * This file is concatenated inside the build wrapper together with the verbatim
 * engine modules (see build/build-widget.mjs). It provides:
 *   - the compact sidebar composition (header / canvas web / page list / footer)
 *   - the DSH web-research event adapter (push/setPages/... state machine)
 *   - self-injected, id-scoped CSS and full lifecycle cleanup
 *
 * Canvas drawing reuses engine primitives:
 *   SV.spider.drawSpider / legPose / heartbeatAt   (app/spider.js)   – the creature
 *   SV.probes.probePose                            (app/probes.js)   – reach arm
 *   SV.layout.livePose / alpha                     (app/live-layout.js) – closed orbit + rgba helper
 *   SV.orbit.drawOrbit                             (app/orbit.js)    – optional "星轨" view
 *   SV.motion.cubicPoint                           (app/motion.js)   – flight-arc particles
 * and adapts the drawing recipes of app/renderer.js#drawWeb (strand fan),
 * #drawRoutingParticles (flight particles) and app/live-renderer.js#web
 * (route targets, dashed probe arm) to a narrow, responsive sidebar.
 * Everything else here is new; the visual vocabulary (colors, mono panel
 * chrome, `▪ TITLE`, route colors, heartbeat) is kept from engine.
 * ========================================================================= */

const SV_MONO = 'Consolas, "Cascadia Code", "Microsoft YaHei UI", "PingFang SC", monospace';
const SV_ROUTES = ['code', 'model', 'you'];
const SV_TAU = Math.PI * 2;
const SV_DEFAULT_THEME = Object.freeze({
  background: '#080909', panel: '#101013', panelTop: '#19191c', border: '#29292e',
  text: '#e8e8e9', muted: '#9998a0', accent: '#f23c83', spider: '#48d7a6',
});
const SV_DEFAULT_ROUTES = Object.freeze({
  code: { label: 'code', color: '#48d7a6' },
  model: { label: 'model', color: '#e18c78' },
  you: { label: 'you', color: '#f4cf4d' },
});
const SV_STATUS_KEYS = ['pending', 'running', 'completed', 'failed'];
const SV_STRINGS = Object.freeze({
  zh: {
    idle: 'IDLE', live: 'LIVE', done: 'DONE', failed: 'FAILED',
    waitFirst: '等待 Agent 上报第一个事件',
    waitFirstHint: '每一次真实检索，都会在这里结成一张网。',
    emptyList: '尚未发现页面。等待 Agent 上报检索事件。',
    pages: '页', sessionStart: '会话开始', sessionEnd: '会话结束',
    searching: '检索', fetching: '抓取', thinking: '思考', doneWord: '完成', failWord: '失败',
    page: '页面', status: { pending: '等待', running: '进行中', completed: '已完成', failed: '失败' },
  },
  en: {
    idle: 'IDLE', live: 'LIVE', done: 'DONE', failed: 'FAILED',
    waitFirst: 'WAITING FOR THE FIRST EVENT',
    waitFirstHint: 'Every real web step becomes a thread in this web.',
    emptyList: 'No pages yet. Waiting for the agent to report a search.',
    pages: 'pages', sessionStart: 'session start', sessionEnd: 'session end',
    searching: 'search', fetching: 'fetch', thinking: 'thought', doneWord: 'done', failWord: 'failed',
    page: 'pages', status: { pending: 'wait', running: 'run', completed: 'done', failed: 'fail' },
  },
});

function svClamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}
function svFinite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
/** Same FNV-1a variant as engine app/model.js#hash (used for stable node placement). */
function svHash(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** Same helper as engine app/live-layout.js#alpha. */
function svAlpha(hex, value) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + value + ')';
}
/** deterministic 0..1 noise, same recipe as engine renderer.js#random. */
function svRand(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
function svHost(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch (error) {
    return '';
  }
}
function svPad2(value) {
  return value < 10 ? '0' + value : String(value);
}
function svIsColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}
function svFitText(ctx, value, maxWidth) {
  const text = String(value == null ? '' : value);
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut + '…';
}
function svNormalizeOptions(input) {
  const src = input && typeof input === 'object' ? input : {};
  const theme = Object.assign({}, SV_DEFAULT_THEME);
  const routes = {};
  for (const route of SV_ROUTES) routes[route] = Object.assign({}, SV_DEFAULT_ROUTES[route]);
  if (src.theme && typeof src.theme === 'object') {
    for (const key of Object.keys(SV_DEFAULT_THEME)) if (svIsColor(src.theme[key])) theme[key] = src.theme[key];
  }
  if (src.routes && typeof src.routes === 'object') {
    for (const route of SV_ROUTES) {
      const patch = src.routes[route];
      if (!patch || typeof patch !== 'object') continue;
      if (typeof patch.label === 'string' && patch.label.trim()) routes[route].label = patch.label.trim().slice(0, 24);
      if (svIsColor(patch.color)) routes[route].color = patch.color;
    }
  }
  return {
    title: typeof src.title === 'string' && src.title.trim() ? src.title.trim() : 'WEB SPIDER',
    subtitle: typeof src.subtitle === 'string' ? src.subtitle : '',
    modelName: typeof src.modelName === 'string' ? src.modelName : '',
    locale: typeof src.locale === 'string' && /^en/i.test(src.locale) ? 'en' : 'zh',
    theme: theme,
    routes: routes,
    maxPages: Math.round(svClamp(svFinite(src.maxPages, 64), 4, 200)),
    showViewToggle: src.showViewToggle !== false,
    reducedMotion: src.reducedMotion === true || src.reducedMotion === false ? src.reducedMotion : 'auto',
    minHeight: Math.round(svClamp(svFinite(src.minHeight, 180), 0, 2000)),
    onSelect: typeof src.onSelect === 'function' ? src.onSelect : null,
  };
}

function svCss(uid) {
  return [
    '#' + uid + '{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;box-sizing:border-box;overflow:hidden;background:var(--sv-bg);color:var(--sv-text);font-family:var(--sv-mono);font-size:11px;line-height:1.35;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}',
    '#' + uid + ' *,#' + uid + ' *::before,#' + uid + ' *::after{box-sizing:border-box}',
    '#' + uid + ' .sv-head{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:7px 10px 6px;border-bottom:1px solid var(--sv-border);min-width:0}',
    '#' + uid + ' .sv-title{font-weight:700;font-size:11.5px;letter-spacing:.7px;color:var(--sv-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48%;flex:0 1 auto}',
    '#' + uid + ' .sv-status{display:inline-flex;align-items:center;gap:5px;min-width:0;flex:1 1 auto;font-size:9.5px;color:var(--sv-muted);white-space:nowrap;overflow:hidden}',
    '#' + uid + ' .sv-status-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}',
    '#' + uid + ' .sv-dot{display:inline-block;width:6px;height:6px;flex:0 0 auto;background:var(--sv-muted)}',
    '#' + uid + ' .sv-dot.is-live{background:var(--sv-accent);box-shadow:0 0 7px var(--sv-accent);animation:sv-pulse 1.6s ease-in-out infinite}',
    '#' + uid + ' .sv-dot.is-active{background:var(--sv-accent);box-shadow:0 0 10px var(--sv-accent);animation:sv-pulse .66s ease-in-out infinite}',
    '#' + uid + ' .sv-dot.is-done{background:var(--sv-code);box-shadow:0 0 6px var(--sv-code)}',
    '#' + uid + ' .sv-dot.is-fail{background:var(--sv-accent);box-shadow:0 0 8px var(--sv-accent)}',
    '#' + uid + ' .sv-views{margin-left:auto;display:flex;gap:2px;flex:0 0 auto}',
    '#' + uid + ' .sv-views button{font:inherit;font-size:9px;line-height:1;padding:4px 7px;background:var(--sv-panel-top);border:1px solid var(--sv-border);color:var(--sv-muted);cursor:pointer;border-radius:0}',
    '#' + uid + ' .sv-views button:hover{color:var(--sv-text);border-color:var(--sv-muted)}',
    '#' + uid + ' .sv-views button[aria-pressed="true"]{color:var(--sv-accent);border-color:var(--sv-accent);background:var(--sv-panel)}',
    '#' + uid + ' .sv-views button:focus-visible{outline:1px solid var(--sv-accent);outline-offset:1px}',
    '#' + uid + ' .sv-main{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0}',
    '#' + uid + ' .sv-stage{position:relative;flex:1 1 auto;min-height:96px;overflow:hidden;background:var(--sv-bg)}',
    '#' + uid + ' .sv-canvas{display:block;width:100%;height:100%;touch-action:pan-y}',
    '#' + uid + ' .sv-side{display:flex;flex-direction:column;min-height:0;flex:0 1 auto;border-top:1px solid var(--sv-border)}',
    '#' + uid + ' .sv-listhead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;padding:4px 10px;background:var(--sv-panel-top);border-bottom:1px solid var(--sv-border);font-size:8.5px;letter-spacing:.9px;color:var(--sv-muted);text-transform:uppercase}',
    '#' + uid + ' .sv-listmeta{margin-left:auto;color:var(--sv-model);letter-spacing:.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#' + uid + ' .sv-list{flex:0 1 auto;overflow-y:auto;overflow-x:hidden;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--sv-border) transparent}',
    '#' + uid + ' .sv-list::-webkit-scrollbar{width:6px}',
    '#' + uid + ' .sv-list::-webkit-scrollbar-thumb{background:var(--sv-border)}',
    '#' + uid + ' .sv-empty{margin:10px;padding:10px;border:1px dashed var(--sv-border);font-size:9.5px;line-height:1.6;color:var(--sv-muted)}',
    '#' + uid + ' .sv-row{display:grid;grid-template-columns:20px 6px minmax(0,1fr) auto;gap:6px;align-items:center;width:100%;min-height:34px;padding:4px 10px;margin:0;background:transparent;border:0;border-bottom:1px solid var(--sv-border);color:var(--sv-text);font:inherit;text-align:left;cursor:pointer}',
    '#' + uid + ' .sv-row:hover{background:var(--sv-panel-top)}',
    '#' + uid + ' .sv-row:focus-visible{outline:1px solid var(--sv-accent);outline-offset:-1px}',
    '#' + uid + ' .sv-row.is-selected{background:var(--sv-panel);box-shadow:inset 2px 0 0 var(--sv-accent)}',
    '#' + uid + ' .sv-seq{font-size:8.5px;color:var(--sv-muted);text-align:right}',
    '#' + uid + ' .sv-rdot{width:6px;height:6px;background:var(--sv-muted)}',
    '#' + uid + ' .sv-rdot.is-running{animation:sv-pulse .8s ease-in-out infinite;box-shadow:0 0 7px currentColor}',
    '#' + uid + ' .sv-rowmain{display:flex;flex-direction:column;min-width:0;line-height:1.3}',
    '#' + uid + ' .sv-rowtitle{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#' + uid + ' .sv-rowsub{font-size:8.5px;color:var(--sv-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#' + uid + ' .sv-rowstate{font-size:8.5px;white-space:nowrap;color:var(--sv-muted)}',
    '#' + uid + ' .sv-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:0 0 auto;padding:4px 10px;border-top:1px solid var(--sv-border);background:var(--sv-panel);font-size:8.5px;color:var(--sv-muted);letter-spacing:.3px;min-width:0;white-space:nowrap}',
    '#' + uid + ' .sv-foot span{overflow:hidden;text-overflow:ellipsis}',
    '#' + uid + ' .sv-routes{flex:0 0 auto}',
    '#' + uid + '.sv-wide .sv-main{display:grid;grid-template-columns:minmax(0,1fr) 300px;grid-template-rows:minmax(0,1fr)}',
    '#' + uid + '.sv-wide .sv-stage{grid-column:1;grid-row:1;min-height:0}',
    '#' + uid + '.sv-wide .sv-side{grid-column:2;grid-row:1;border-top:0;border-left:1px solid var(--sv-border);min-height:0}',
    '#' + uid + '.sv-wide .sv-list{flex:1 1 auto}',
    '#' + uid + '.sv-narrow .sv-listmeta{display:none}',
    '#' + uid + '.sv-tiny .sv-routes{display:none}',
    '@keyframes sv-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
  ].join('\n');
}

function createSpiderView(container, options) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('createSpiderView(container, options): container must be a DOM element.');
  }
  const opts = svNormalizeOptions(options);
  const locale = opts.locale;
  const strings = SV_STRINGS[locale];
  let theme = opts.theme;
  let routes = opts.routes;
  const uid = 'sv-' + ((globalThis.__spiderViewSeq = (globalThis.__spiderViewSeq || 0) + 1));
  const doc = container.ownerDocument || globalThis.document;
  const win = doc.defaultView || globalThis;

  function nowSec() {
    return performance.now() / 1000;
  }
  function pageList() {
    const list = [];
    for (const id of state.order) {
      const page = state.pages.get(id);
      if (page) list.push(page);
    }
    return list;
  }
  function routeColor(route) {
    return routes[route] ? routes[route].color : theme.muted;
  }
  function routeLabel(route) {
    return routes[route] ? routes[route].label : route;
  }
  function statusColor(status) {
    if (status === 'failed') return theme.accent;
    if (status === 'completed') return routeColor('code');
    if (status === 'running') return theme.accent;
    return theme.muted;
  }
  function svWarn(key, message) {
    if (state.warned[key]) return;
    state.warned[key] = true;
    if (typeof console !== 'undefined' && console.warn) console.warn('[spider-widget] ' + message);
  }
  function routeCounts() {
    const counts = { code: 0, model: 0, you: 0 };
    for (const page of state.pages.values()) counts[page.route] = (counts[page.route] || 0) + 1;
    return counts;
  }
  function statusCounts() {
    const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
    for (const page of state.pages.values()) counts[page.status] = (counts[page.status] || 0) + 1;
    return counts;
  }
  function normRoute(route, fallback, source) {
    const value = typeof route === 'string' ? route.trim().toLowerCase() : '';
    if (SV_ROUTES.indexOf(value) >= 0) return value;
    const src = typeof source === 'string' ? source.toLowerCase() : '';
    if (/search|query|serp|retriev/.test(src)) return 'code';
    if (/fetch|page|read|browse|crawl/.test(src)) return 'model';
    if (/human|approv|review|confirm/.test(src)) return 'you';
    return SV_ROUTES.indexOf(fallback) >= 0 ? fallback : 'model';
  }
  function normStatus(status, fallback) {
    const value = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (SV_STATUS_KEYS.indexOf(value) >= 0) return value;
    return fallback || 'pending';
  }
  function pageTitle(input, previous, id) {
    if (typeof input.title === 'string' && input.title.trim()) return input.title.trim().slice(0, 200);
    if (typeof input.label === 'string' && input.label.trim()) return input.label.trim().slice(0, 200);
    if (previous && previous.title) return previous.title;
    if (typeof input.url === 'string' && input.url.trim()) return input.url.trim().slice(0, 200);
    return String(id);
  }
  function freshActivity(now) {
    if (!state.activity) return null;
    return now - state.activity.at <= 2.4 ? state.activity : null;
  }

  /* ------------------------------------------------------------------ DOM */
  function make(tag, className, parent) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }
  const root = doc.createElement('div');
  root.className = 'sv-root';
  root.id = uid;
  root.setAttribute('data-spider-view', '');
  root.style.setProperty('--sv-mono', SV_MONO);
  const style = doc.createElement('style');
  style.setAttribute('data-spider-view-style', '');
  style.textContent = svCss(uid);
  root.appendChild(style);

  const head = make('div', 'sv-head', root);
  const titleEl = make('span', 'sv-title', head);
  const statusEl = make('span', 'sv-status', head);
  const dotEl = make('i', 'sv-dot', statusEl);
  const statusTextEl = make('span', 'sv-status-text', statusEl);
  let viewsEl = null;
  let webBtn = null;
  let orbitBtn = null;
  if (opts.showViewToggle) {
    viewsEl = make('div', 'sv-views', head);
    webBtn = make('button', '', viewsEl);
    webBtn.type = 'button';
    webBtn.textContent = locale === 'en' ? 'WEB' : '蛛网';
    webBtn.setAttribute('aria-pressed', 'true');
    orbitBtn = make('button', '', viewsEl);
    orbitBtn.type = 'button';
    orbitBtn.textContent = locale === 'en' ? 'ORBIT' : '星轨';
    orbitBtn.setAttribute('aria-pressed', 'false');
  }
  const main = make('div', 'sv-main', root);
  const stage = make('div', 'sv-stage', main);
  const canvas = make('canvas', 'sv-canvas', stage);
  canvas.setAttribute('role', 'img');
  const side = make('div', 'sv-side', main);
  const listHead = make('div', 'sv-listhead', side);
  const listHeadTitle = make('span', '', listHead);
  listHeadTitle.textContent = locale === 'en' ? 'PAGES' : '页面';
  const listMeta = make('span', 'sv-listmeta', listHead);
  const listCount = make('span', '', listHead);
  listCount.textContent = '0';
  const listEl = make('div', 'sv-list', side);
  listEl.setAttribute('role', 'group');
  listEl.setAttribute('aria-label', locale === 'en' ? 'Discovered pages' : '发现的页面');
  const emptyEl = make('div', 'sv-empty', listEl);
  const foot = make('div', 'sv-foot', root);
  const footLeft = make('span', '', foot);
  const footRoutes = make('span', 'sv-routes', foot);
  container.appendChild(root);

  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx && typeof ctx.roundRect !== 'function') {
    // Tiny fallback for older Chromium; engine app/spider.js uses roundRect.
    ctx.roundRect = function roundRect(x, y, w, h, r) {
      const radius = Math.min(svFinite(r, 0), Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
      return this;
    };
  }

  /* ---------------------------------------------------------------- state */
  const state = {
    destroyed: false,
    status: 'idle',
    session: {
      id: null,
      title: opts.title,
      subtitle: opts.subtitle,
      modelName: opts.modelName,
      startedAt: 0,
      endedAt: null,
    },
    pages: new Map(),
    order: [],
    tools: new Map(),
    toolSeq: 0,
    activity: null,
    warnings: {},
    selectedId: null,
    attention: { id: null, at: 0, until: 0 },
    view: 'web',
    orbitAngle: 0,
    revision: 0,
    clockStart: nowSec(),
    lastFrame: 0,
    lastChrome: 0,
    reducedMotion: false,
    visible: true,
    dpr: 0,
    cssW: 0,
    cssH: 0,
    measurePending: true,
    regions: [],
    spider: { x: 0, y: 0, vx: 0, vy: 0, init: false },
    warned: {},
    rows: new Map(),
    rowOrder: [],
  };

  const motionQuery = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function resolveReducedMotion() {
    if (opts.reducedMotion === true) return true;
    if (opts.reducedMotion === false) return false;
    return Boolean(motionQuery && motionQuery.matches);
  }
  state.reducedMotion = resolveReducedMotion();

  /* -------------------------------------------------------------- layout */
  function applyThemeVars() {
    const sets = {
      '--sv-bg': theme.background,
      '--sv-panel': theme.panel,
      '--sv-panel-top': theme.panelTop,
      '--sv-border': theme.border,
      '--sv-text': theme.text,
      '--sv-muted': theme.muted,
      '--sv-accent': theme.accent,
      '--sv-spider': theme.spider,
      '--sv-code': routes.code.color,
      '--sv-model': routes.model.color,
      '--sv-you': routes.you.color,
    };
    for (const key of Object.keys(sets)) root.style.setProperty(key, sets[key]);
    root.style.minHeight = opts.minHeight > 0 ? opts.minHeight + 'px' : '0';
  }
  applyThemeVars();

  function applyLayoutClasses() {
    const width = root.getBoundingClientRect().width || state.cssW;
    const height = root.getBoundingClientRect().height || state.cssH;
    const wide = width >= 560;
    root.classList.toggle('sv-wide', wide);
    root.classList.toggle('sv-narrow', width < 372);
    root.classList.toggle('sv-tiny', width < 330);
    if (!wide) {
      const reserve = height - 30 - 96 - 20 - 18 - 6;
      const cap = Math.max(64, Math.min(height * 0.42, reserve));
      listEl.style.maxHeight = Math.round(cap) + 'px';
    } else {
      listEl.style.maxHeight = 'none';
    }
  }

  function measure() {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(80, Math.round(rect.width || 0));
    const height = Math.max(80, Math.round(rect.height || 0));
    const dpr = Math.min(2, Math.max(1, svFinite(win.devicePixelRatio, 1)));
    if (width === state.cssW && height === state.cssH && dpr === state.dpr) return false;
    state.cssW = width;
    state.cssH = height;
    state.dpr = dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyLayoutClasses();
    return true;
  }

  /* ----------------------------------------------------------- DOM sync */
  function createRow(page) {
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'sv-row';
    const seq = make('span', 'sv-seq', row);
    const dot = make('i', 'sv-rdot', row);
    const mainBox = make('span', 'sv-rowmain', row);
    const title = make('span', 'sv-rowtitle', mainBox);
    const sub = make('span', 'sv-rowsub', mainBox);
    const stateEl = make('span', 'sv-rowstate', row);
    row.addEventListener('click', function onClick() {
      selectPage(page.id);
    });
    return { el: row, seq: seq, dot: dot, title: title, sub: sub, state: stateEl };
  }
  function updateRow(row, page, index) {
    row.seq.textContent = svPad2(index + 1);
    row.title.textContent = page.title;
    row.title.style.color = page.status === 'failed' ? theme.accent : routeColor(page.route);
    row.dot.style.background = statusColor(page.status);
    row.dot.style.color = statusColor(page.status);
    row.dot.className = 'sv-rdot' + (page.status === 'running' ? ' is-running' : '');
    const host = svHost(page.url);
    row.sub.textContent = [host, routeLabel(page.route)].filter(Boolean).join(' · ');
    row.state.textContent = strings.status[page.status];
    row.state.style.color = statusColor(page.status);
    row.el.title = [page.title, page.url, routeLabel(page.route) + ' · ' + strings.status[page.status]].filter(Boolean).join('\n');
    row.el.setAttribute('aria-current', page.id === state.selectedId ? 'true' : 'false');
    row.el.classList.toggle('is-selected', page.id === state.selectedId);
  }
  function clearRows() {
    for (const entry of state.rows.values()) entry.el.remove();
    state.rows.clear();
    state.rowOrder.length = 0;
  }
  function syncList() {
    const seen = new Set();
    let index = 0;
    for (const id of state.order) {
      const page = state.pages.get(id);
      if (!page) continue;
      seen.add(id);
      let row = state.rows.get(id);
      if (!row) {
        row = createRow(page);
        state.rows.set(id, row);
        listEl.appendChild(row.el);
      }
      updateRow(row, page, index);
      index += 1;
    }
    for (const id of Array.from(state.rows.keys())) {
      if (seen.has(id)) continue;
      const row = state.rows.get(id);
      row.el.remove();
      state.rows.delete(id);
    }
    listCount.textContent = String(index);
    emptyEl.hidden = index > 0;
    emptyEl.textContent = strings.emptyList;
    syncListMeta();
  }
  function syncListMeta() {
    const tools = Array.from(state.tools.values());
    if (!tools.length) {
      listMeta.textContent = '';
      return;
    }
    const searches = tools.filter((tool) => !/fetch/i.test(tool.tool)).length;
    const fetches = tools.length - searches;
    listMeta.textContent = 'SEARCH ' + searches + ' · FETCH ' + fetches;
  }
  function syncHead() {
    const sessionTitle = state.session.title || opts.title;
    if (titleEl.textContent !== sessionTitle) titleEl.textContent = sessionTitle;
    titleEl.title = [sessionTitle, state.session.subtitle].filter(Boolean).join('\n');
    const now = nowSec();
    const act = freshActivity(now);
    let text = '';
    let dotClass = 'is-idle';
    if (state.status === 'idle') {
      text = strings.idle;
      dotClass = 'is-idle';
    } else if (state.status === 'live') {
      text = 'LIVE';
      if (act && act.text) text = 'LIVE · ' + act.text;
      dotClass = act && now - act.at < 1.2 ? 'is-active' : 'is-live';
    } else if (state.status === 'failed') {
      text = strings.failed;
      dotClass = 'is-fail';
    } else {
      const duration = state.session.endedAt ? state.session.endedAt - state.session.startedAt : 0;
      text = strings.done + ' · ' + duration.toFixed(1) + 's';
      dotClass = 'is-done';
    }
    if (statusTextEl.textContent !== text) statusTextEl.textContent = text;
    dotEl.className = 'sv-dot ' + dotClass;
    if (webBtn) webBtn.setAttribute('aria-pressed', state.view === 'web' ? 'true' : 'false');
    if (orbitBtn) orbitBtn.setAttribute('aria-pressed', state.view === 'orbit' ? 'true' : 'false');
    const counts = statusCounts();
    canvas.setAttribute(
      'aria-label',
      locale === 'en'
        ? state.order.length + ' pages: ' + counts.completed + ' done, ' + counts.running + ' running, ' + counts.failed + ' failed.'
        : state.order.length + ' 个页面：' + counts.completed + ' 已完成，' + counts.running + ' 进行中，' + counts.failed + ' 失败。'
    );
  }
  function syncFoot() {
    const counts = statusCounts();
    const total = state.order.length;
    const parts = [];
    if (state.status === 'idle') {
      parts.push(strings.idle);
    } else if (state.status === 'failed') {
      parts.push(strings.failed);
    } else if (state.status === 'completed') {
      parts.push(strings.done);
    } else {
      parts.push(strings.live);
    }
    parts.push(total + ' ' + strings.pages);
    if (counts.completed) parts.push(counts.completed + ' ' + strings.status.completed);
    if (counts.running) parts.push(counts.running + ' ' + strings.status.running);
    if (counts.failed) parts.push(counts.failed + ' ' + strings.status.failed);
    if (counts.pending && total > 0) parts.push(counts.pending + ' ' + strings.status.pending);
    footLeft.textContent = parts.join(' · ');
    const routeCount = routeCounts();
    footRoutes.textContent = SV_ROUTES.map((route) => routeLabel(route) + ' ' + routeCount[route]).join(' · ');
  }
  function syncAll() {
    syncHead();
    syncList();
    syncFoot();
  }

  /* ------------------------------------------------------------- events */
  function resetState(keepSessionTitle) {
    state.pages.clear();
    state.order.length = 0;
    state.tools.clear();
    state.selectedId = null;
    state.attention = { id: null, at: 0, until: state.clockStart };
    state.activity = null;
    state.status = 'idle';
    state.session.id = null;
    state.session.startedAt = 0;
    state.session.endedAt = null;
    if (!keepSessionTitle) state.session.title = opts.title;
    clearRows();
  }
  function addActivity(kind, text, color, pageId) {
    state.activity = { at: nowSec(), kind: kind, text: text, color: color || theme.accent, pageId: pageId || null };
  }
  function setPulse(kind, color, pageId) {
    state.pulse = { at: nowSec(), kind: kind, color: color || theme.accent, pageId: pageId || null };
  }
  function upsertPage(input, mode) {
    const at = nowSec();
    const id = String(input.id != null ? input.id : input.pageId != null ? input.pageId : input.url != null ? input.url : '').trim();
    if (!id) {
      svWarn('page-id', 'page event without id/pageId/url ignored');
      return null;
    }
    const prev = state.pages.get(id) || null;
    const next = {
      id: id,
      title: pageTitle(input, prev, id),
      url: typeof input.url === 'string' ? input.url : prev ? prev.url : '',
      route: normRoute(input.route, prev ? prev.route : null, input.source),
      status: normStatus(input.status, prev ? prev.status : 'pending'),
      score: input.score === null || input.score === undefined
        ? prev ? prev.score : null
        : Number.isFinite(Number(input.score)) ? svClamp(Number(input.score), 0, 1) : null,
      detail: typeof input.detail === 'string' ? input.detail : prev ? prev.detail : '',
      source: typeof input.source === 'string' ? input.source : prev ? prev.source : '',
      order: prev ? prev.order : state.order.length,
      firstAt: prev ? prev.firstAt : svFinite(input.firstAt, at),
      updatedAt: at,
      appearedAt: prev ? prev.appearedAt : mode === 'replay' ? -1e9 : at,
      flight: prev ? prev.flight : null,
    };
    const changed = !prev ||
      prev.status !== next.status ||
      prev.route !== next.route ||
      prev.title !== next.title ||
      prev.url !== next.url ||
      prev.score !== next.score;
    state.pages.set(id, next);
    if (!prev) {
      state.order.push(id);
      if (state.order.length > opts.maxPages) {
        const dropped = state.order.shift();
        state.pages.delete(dropped);
        if (state.selectedId === dropped) state.selectedId = null;
        svWarn('max-pages', 'page limit (' + opts.maxPages + ') reached; oldest page dropped from the view');
      }
    }
    if (changed && mode !== 'replay') {
      if (prev) {
        if ((next.status === 'completed' || next.status === 'failed') && prev.status !== next.status) {
          next.flight = { at: at };
          state.attention = { id: id, at: at, until: at + 2.1 };
          setPulse(next.status === 'failed' ? 'fail' : 'done', next.status === 'failed' ? theme.accent : routeColor(next.route), id);
          addActivity(
            'page',
            (next.status === 'failed' ? strings.failWord : strings.doneWord) + ' · ' + next.title,
            next.status === 'failed' ? theme.accent : routeColor(next.route),
            id
          );
        } else if (next.status === 'running' && prev.status !== 'running') {
          state.attention = { id: id, at: at, until: at + 2.1 };
          setPulse('fetch', routeColor(next.route), id);
          addActivity('fetch', strings.fetching + ' ' + (svHost(next.url) || next.title), routeColor(next.route), id);
        }
      } else if (next.status !== 'pending') {
        state.attention = { id: id, at: at, until: at + 2.1 };
        setPulse('discover', routeColor(next.route), id);
      }
    }
    if (changed) state.listDirty = true;
    return next;
  }
  function removePage(id) {
    if (!state.pages.has(id)) return;
    state.pages.delete(id);
    state.order = state.order.filter((item) => item !== id);
    if (state.selectedId === id) state.selectedId = null;
    state.listDirty = true;
  }
  function handleEvent(input, isReplay) {
    const type = String(input.type || '');
    const at = nowSec();
    switch (type) {
      case 'session.start':
      case 'session.started': {
        resetState(true);
        state.status = 'live';
        state.session.id = input.sessionId != null ? String(input.sessionId) : input.id != null ? String(input.id) : null;
        if (typeof input.title === 'string' && input.title.trim()) state.session.title = input.title.trim();
        if (typeof input.subtitle === 'string') state.session.subtitle = input.subtitle;
        if (typeof input.modelName === 'string') state.session.modelName = input.modelName;
        if (input.config && typeof input.config === 'object') {
          if (typeof input.config.title === 'string' && input.config.title.trim()) state.session.title = input.config.title.trim();
          if (typeof input.config.subtitle === 'string') state.session.subtitle = input.config.subtitle;
          if (typeof input.config.modelName === 'string') state.session.modelName = input.config.modelName;
          applyConfigPatch(input.config);
        }
        state.session.startedAt = at;
        state.session.endedAt = null;
        addActivity('start', strings.sessionStart, theme.accent, null);
        setPulse('start', theme.accent, null);
        break;
      }
      case 'session.done':
      case 'session.complete': {
        if (state.status === 'idle') state.session.startedAt = at;
        state.status = input.status === 'failed' ? 'failed' : 'completed';
        state.session.endedAt = at;
        addActivity('end', strings.sessionEnd, theme.accent, null);
        break;
      }
      case 'session.reset':
      case 'reset': {
        resetState(false);
        break;
      }
      case 'session.replay':
      case 'replay': {
        applyReplay(input);
        break;
      }
      case 'tool.start': {
        const tool = String(input.tool || input.name || 'web_search');
        const id = String(input.id != null ? input.id : 'tool-' + ++state.toolSeq);
        const previous = state.tools.get(id);
        state.tools.set(id, {
          id: id,
          tool: tool,
          status: 'running',
          query: typeof input.query === 'string' ? input.query : previous ? previous.query : '',
          url: typeof input.url === 'string' ? input.url : previous ? previous.url : '',
          startedAt: previous ? previous.startedAt : at,
          endedAt: null,
        });
        const fetch = /fetch|read|browse|crawl/i.test(tool);
        const label = fetch
          ? strings.fetching + ' ' + ((typeof input.url === 'string' && svHost(input.url)) || String(input.label || ''))
          : strings.searching + ' ' + (typeof input.query === 'string' ? '“' + input.query.slice(0, 42) + '”' : '');
        addActivity(fetch ? 'fetch' : 'search', label, fetch ? routeColor('model') : theme.accent, null);
        setPulse(fetch ? 'fetch' : 'search', fetch ? routeColor('model') : theme.accent, null);
        break;
      }
      case 'tool.end': {
        const id = String(input.id != null ? input.id : 'tool-' + state.toolSeq);
        const previous = state.tools.get(id);
        const tool = previous || {
          id: id, tool: String(input.tool || 'web_search'), status: 'running',
          query: '', url: '', startedAt: at, endedAt: null,
        };
        tool.status = input.status === 'failed' ? 'failed' : 'completed';
        tool.endedAt = at;
        state.tools.set(id, tool);
        const failed = tool.status === 'failed';
        addActivity(
          failed ? 'fail' : 'tool',
          (failed ? strings.failWord : strings.doneWord) + ' · ' + (/fetch|read|browse/i.test(tool.tool) ? strings.fetching : strings.searching),
          failed ? theme.accent : routeColor('code'),
          null
        );
        if (failed) setPulse('fail', theme.accent, null);
        break;
      }
      case 'agent.thought':
      case 'agent.step': {
        const text = typeof input.text === 'string' ? input.text : typeof input.label === 'string' ? input.label : '';
        addActivity('think', strings.thinking + ' · ' + (text ? text.slice(0, 60) : ''), routeColor('you'), null);
        break;
      }
      case 'page.discovered':
      case 'page.add':
      case 'page': {
        upsertPage(input, isReplay ? 'replay' : 'live');
        break;
      }
      case 'page.status':
      case 'page.updated':
      case 'page.running':
      case 'page.completed':
      case 'page.fetched':
      case 'page.failed': {
        const status = type === 'page.running' ? 'running'
          : type === 'page.completed' || type === 'page.fetched' ? 'completed'
          : type === 'page.failed' ? 'failed'
          : input.status;
        upsertPage(Object.assign({}, input, { status: status }), isReplay ? 'replay' : 'live');
        break;
      }
      case 'page.removed': {
        removePage(String(input.id != null ? input.id : ''));
        break;
      }
      default: {
        svWarn('type-' + type, 'unknown event type "' + type + '" (ignored)');
        break;
      }
    }
  }
  function applyReplay(input) {
    resetState(true);
    const session = input.session && typeof input.session === 'object' ? input.session : input;
    if (typeof session.title === 'string' && session.title.trim()) state.session.title = session.title.trim();
    if (typeof session.subtitle === 'string') state.session.subtitle = session.subtitle;
    if (typeof session.modelName === 'string') state.session.modelName = session.modelName;
    if (session.config && typeof session.config === 'object') applyConfigPatch(session.config);
    const status = typeof session.status === 'string' ? session.status : 'completed';
    state.status = status === 'live' ? 'live' : status === 'failed' ? 'failed' : 'completed';
    const duration = svFinite(session.duration, 0);
    state.session.startedAt = nowSec() - Math.max(0, duration);
    state.session.endedAt = state.status === 'live' ? null : nowSec();
    const pages = Array.isArray(input.pages) ? input.pages : Array.isArray(session.pages) ? session.pages : [];
    for (const page of pages) {
      if (!page || typeof page !== 'object') continue;
      upsertPage(Object.assign({}, page, {
        firstAt: svFinite(page.firstAt, svFinite(page.at, 0)),
      }), 'replay');
    }
    addActivity('replay', locale === 'en' ? 'replay restored' : '回放已载入', theme.accent, null);
  }
  function applyConfigPatch(config) {
    if (!config || typeof config !== 'object') return;
    const patchTheme = config.theme;
    if (patchTheme && typeof patchTheme === 'object') for (const key of Object.keys(SV_DEFAULT_THEME)) if (svIsColor(patchTheme[key])) opts.theme[key] = patchTheme[key];
    const routePatch = config.routes;
    if (routePatch && typeof routePatch === 'object') {
      for (const route of SV_ROUTES) {
        const patch = routePatch[route];
        if (!patch || typeof patch !== 'object') continue;
        if (typeof patch.label === 'string' && patch.label.trim()) routes[route].label = patch.label.trim().slice(0, 24);
        if (svIsColor(patch.color)) routes[route].color = patch.color;
      }
    }
    theme = opts.theme;
    applyThemeVars();
  }

  function push(input) {
    if (state.destroyed || !input) return;
    if (Array.isArray(input)) {
      for (const item of input) push(item);
      return;
    }
    if (typeof input !== 'object') return;
    state.revision += 1;
    handleEvent(input, false);
    syncAll();
  }
  function setPages(pages) {
    if (state.destroyed || !Array.isArray(pages)) return;
    resetState(true);
    state.status = state.status === 'idle' ? 'idle' : state.status;
    for (const page of pages) {
      if (!page || typeof page !== 'object') continue;
      upsertPage(Object.assign({}, page, { status: page.status || 'pending' }), 'replay');
    }
    syncAll();
  }
  function selectPage(id) {
    if (state.destroyed || !state.pages.has(id)) return false;
    state.selectedId = id;
    const at = nowSec();
    state.attention = { id: id, at: at, until: at + 2.4 };
    const page = state.pages.get(id);
    syncList();
    syncHead();
    if (opts.onSelect) {
      try {
        opts.onSelect(publicPage(page));
      } catch (error) {
        svWarn('onSelect', 'onSelect callback threw: ' + (error && error.message));
      }
    }
    return true;
  }
  function focusOn(id) {
    if (state.destroyed) return false;
    if (!selectPage(String(id))) return false;
    const row = state.rows.get(String(id));
    if (row && typeof row.el.scrollIntoView === 'function') {
      try {
        row.el.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        /* older engines */
      }
    }
    return true;
  }
  function publicPage(page) {
    return {
      id: page.id,
      title: page.title,
      url: page.url,
      route: page.route,
      status: page.status,
      score: page.score,
      detail: page.detail,
      firstAt: page.firstAt,
      updatedAt: page.updatedAt,
      order: page.order,
    };
  }
  function getState() {
    const at = nowSec();
    return {
      status: state.status,
      session: {
        id: state.session.id,
        title: state.session.title,
        subtitle: state.session.subtitle,
        modelName: state.session.modelName,
        duration: state.status === 'idle' ? 0 : Math.max(0, (state.session.endedAt || at) - state.session.startedAt),
      },
      totalEvents: state.order.length,
      counts: routeCounts(),
      statusCounts: statusCounts(),
      tools: Array.from(state.tools.values()).map((tool) => Object.assign({}, tool)),
      pages: pageList().map(publicPage),
      selectedId: state.selectedId,
      view: state.view,
      activity: state.activity ? Object.assign({}, state.activity) : null,
      revision: state.revision,
      theme: Object.assign({}, theme),
      routes: { code: Object.assign({}, routes.code), model: Object.assign({}, routes.model), you: Object.assign({}, routes.you) },
      locale: locale,
      reducedMotion: state.reducedMotion,
    };
  }
  function setTheme(patch) {
    if (state.destroyed || !patch || typeof patch !== 'object') return;
    for (const key of Object.keys(SV_DEFAULT_THEME)) if (svIsColor(patch[key])) theme[key] = patch[key];
    if (patch.routes && typeof patch.routes === 'object') {
      for (const route of SV_ROUTES) {
        const routePatch = patch.routes[route];
        if (!routePatch || typeof routePatch !== 'object') continue;
        if (typeof routePatch.label === 'string' && routePatch.label.trim()) routes[route].label = routePatch.label.trim().slice(0, 24);
        if (svIsColor(routePatch.color)) routes[route].color = routePatch.color;
      }
    }
    applyThemeVars();
    syncAll();
  }

  /**
   * PNG snapshot of the current canvas (panel chrome included, DOM list excluded).
   * Intended for in-app visual verification: the host plugin can call this from
   * the real browser and beacon the data URL to a local collector, because
   * headless Chrome cannot run inside some sandboxes.
   * @param {string} [mime] defaults to image/png
   * @param {number} [quality] only meaningful for image/jpeg
   * @returns {string|null} data URL, or null when unsupported/tainted
   */
  function snapshot(mime, quality) {
    try {
      const type = typeof mime === 'string' && mime ? mime : 'image/png';
      if (typeof canvas.toDataURL !== 'function') return null;
      return quality === undefined ? canvas.toDataURL(type) : canvas.toDataURL(type, quality);
    } catch (error) {
      return null;
    }
  }

  /* ---------------------------------------------------------- rendering */
  function text(value, x, y, color, size, align, weight) {
    ctx.font = (weight || 400) + ' ' + (size || 10) + 'px ' + SV_MONO;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(value), x, y);
    ctx.textAlign = 'left';
  }
  function drawPanel(panel, title, right) {
    ctx.fillStyle = theme.panel;
    ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
    const headH = panel.w < 520 ? 20 : 24;
    ctx.fillStyle = theme.panelTop;
    ctx.fillRect(panel.x + 1, panel.y + 1, panel.w - 2, headH);
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);
    text('▪ ' + title, panel.x + 9, panel.y + headH - 7, theme.muted, 9);
    if (right) text(right, panel.x + panel.w - 9, panel.y + headH - 7, theme.muted, 9, 'right');
  }
  function panelHeadH(panel) {
    return panel.w < 520 ? 20 : 24;
  }
  function routePoints(inner) {
    const counts = routeCounts();
    return SV_ROUTES.map((route, index) => ({
      route: route,
      x: inner.x + inner.w - 18,
      y: inner.y + inner.h * (0.24 + index * 0.26),
      color: routeColor(route),
      label: routeLabel(route),
      count: counts[route] || 0,
    }));
  }
  function hubPoint(inner) {
    return { x: inner.x + inner.w * 0.34, y: inner.y + inner.h * 0.52 };
  }
  function pagePosition(page, index, inner, hub) {
    const seed = svHash(page.id + ':' + page.order);
    const angle = index * 2.399963229728653 + ((seed % 1024) / 1024) * 0.9 - Math.PI / 2;
    const radius = 0.62 + 0.34 * (((seed >>> 10) % 1024) / 1024);
    // Keep the ellipse inside the panel for both narrow sidebars and wide panels.
    const rx = Math.min(inner.w * 0.30, inner.h * 0.62);
    const ry = Math.min(inner.h * 0.36, inner.w * 0.50);
    const x = hub.x + Math.cos(angle) * rx * radius;
    const y = hub.y + Math.sin(angle) * ry * radius;
    return {
      x: svClamp(x, inner.x + 16, inner.x + inner.w - 86),
      y: svClamp(y, inner.y + 14, inner.y + inner.h - 20),
    };
  }
  function drawWeb(inner, time, wall) {
    const hub = hubPoint(inner);
    const targets = routePoints(inner);
    const pages = pageList();
    const nodeMap = new Map();
    // 1) faint background fan — recipe adapted from app/renderer.js#drawWeb (440 strands thinned to 22).
    for (let i = 0; i < 22; i++) {
      const sy = inner.y + 6 + svRand(i + 83) * (inner.h - 12);
      const target = targets[i % targets.length];
      const wave = state.reducedMotion ? 0 : Math.sin(time * (0.65 + svRand(i + 5) * 0.6) + svRand(i + 94) * 6.28) * (inner.h * 0.02);
      const ex = target.x - 14;
      const ey = target.y + (svRand(i + 11) - 0.5) * inner.h * 0.34;
      ctx.beginPath();
      ctx.moveTo(inner.x + 2, sy);
      ctx.bezierCurveTo(inner.x + inner.w * 0.16, sy + wave, inner.x + inner.w * 0.26, ey + wave * 0.6, ex, ey);
      ctx.strokeStyle = 'rgba(149,153,159,' + (0.032 + svRand(i + 8) * 0.045).toFixed(3) + ')';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    // 2) ring frame around the hub
    for (const factor of [0.55, 0.78, 1]) {
      ctx.beginPath();
      ctx.ellipse(hub.x, hub.y, Math.min(inner.w * 0.30, inner.h * 0.62) * factor, Math.min(inner.h * 0.36, inner.w * 0.50) * factor, 0, 0, SV_TAU);
      ctx.strokeStyle = 'rgba(149,153,159,' + (factor === 1 ? 0.10 : 0.058) + ')';
      ctx.lineWidth = factor === 1 ? 0.8 : 0.55;
      ctx.stroke();
    }
    if (!pages.length) {
      // decorative spokes so the idle canvas is still a web
      for (let i = 0; i < 11; i++) {
        const angle = (i / 11) * SV_TAU + 0.18;
        const reach = Math.min(inner.w * 0.32, inner.h * 0.42) * (0.7 + svRand(i + 3) * 0.3);
        const x = hub.x + Math.cos(angle) * reach;
        const y = hub.y + Math.sin(angle) * reach * 1.1;
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.quadraticCurveTo((hub.x + x) / 2 + Math.sin(angle) * 8, (hub.y + y) / 2, x, y);
        ctx.strokeStyle = 'rgba(149,153,159,0.09)';
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }
    pages.forEach((page, index) => {
      nodeMap.set(page.id, pagePosition(page, index, inner, hub));
    });
    // 3) hub→node spokes and node→route threads (route concept from app/live-renderer.js#web)
    for (const page of pages) {
      const node = nodeMap.get(page.id);
      if (!node) continue;
      const color = routeColor(page.route);
      const appeared = svClamp((wall - page.appearedAt) / 0.4, 0, 1);
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.quadraticCurveTo((hub.x + node.x) / 2 + (node.y - hub.y) * 0.09, (hub.y + node.y) / 2 - (node.x - hub.x) * 0.09, node.x, node.y);
      ctx.strokeStyle = svAlpha(color, 0.1 + 0.16 * appeared);
      ctx.lineWidth = 0.6;
      ctx.stroke();
      const target = targets[SV_ROUTES.indexOf(page.route)] || targets[1];
      ctx.beginPath();
      ctx.moveTo(node.x, node.y);
      ctx.bezierCurveTo(node.x + (target.x - node.x) * 0.32, node.y + (target.y - node.y) * 0.02, target.x - (target.x - node.x) * 0.3, target.y - 12, target.x - 6, target.y);
      const selected = page.id === state.selectedId;
      const failed = page.status === 'failed';
      ctx.strokeStyle = svAlpha(failed ? theme.accent : color, selected ? 0.38 : 0.12 + 0.1 * appeared);
      ctx.lineWidth = selected ? 1.1 : 0.6;
      ctx.stroke();
    }
    return { hub, targets, nodeMap };
  }
  function drawNodes(inner, time, wall, nodeMap, targets) {
    const pages = pageList();
    const recent = pages.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    const labelCandidates = [];
    const used = [];
    const attentionActive = state.attention.id && state.attention.until > wall;
    for (const page of pages) {
      const node = nodeMap.get(page.id);
      if (!node) continue;
      const selected = page.id === state.selectedId;
      const attention = attentionActive && state.attention.id === page.id;
      if (selected) labelCandidates.push({ x: node.x, y: node.y, text: page.title, color: theme.text });
      else if (attention) labelCandidates.push({ x: node.x, y: node.y, text: page.title, color: page.status === 'failed' ? theme.accent : routeColor(page.route) });
    }
    for (const page of recent) {
      if (labelCandidates.length >= 4) break;
      if (page.status !== 'running') continue;
      const node = nodeMap.get(page.id);
      if (!node) continue;
      labelCandidates.push({ x: node.x, y: node.y, text: page.title, color: routeColor(page.route) });
    }
    // Labels are drawn *before* the node markers so a label box can never hide a node.
    const seen = new Set();
    for (const candidate of labelCandidates) {
      if (used.length >= 3) break;
      if (seen.has(candidate.text + ':' + candidate.x)) continue;
      seen.add(candidate.text + ':' + candidate.x);
      ctx.font = '10px ' + SV_MONO;
      const labelText = svFitText(ctx, candidate.text, Math.min(inner.w * 0.56, 172));
      const width = ctx.measureText(labelText).width + 8;
      const height = 14;
      let x = candidate.x + 9;
      if (x + width > inner.x + inner.w - 4) x = candidate.x - width - 9;
      x = svClamp(x, inner.x + 4, inner.x + inner.w - width - 4);
      let y = candidate.y - height - 7;
      if (y < inner.y + 4) y = candidate.y + 11;
      y = svClamp(y, inner.y + 4, inner.y + inner.h - height - 4);
      const rect = { x: x, y: y, w: width, h: height };
      let overlaps = false;
      for (const other of used) if (!(rect.x + rect.w < other.x || rect.x > other.x + other.w || rect.y + rect.h < other.y || rect.y > other.y + other.h)) overlaps = true;
      if (overlaps) continue;
      used.push(rect);
      ctx.fillStyle = theme.panel;
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = svAlpha(candidate.color, 0.55);
      ctx.lineWidth = 0.7;
      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
      text(labelText, x + 4, y + 10.5, candidate.color, 10);
    }
    for (const page of pages) {
      const node = nodeMap.get(page.id);
      if (!node) continue;
      const appear = svClamp((wall - page.appearedAt) / 0.4, 0, 1);
      const selected = page.id === state.selectedId;
      const color = routeColor(page.route);
      const failed = page.status === 'failed';
      ctx.globalAlpha = appear;
      if (page.status === 'pending') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3.6, 0, SV_TAU);
        ctx.strokeStyle = svAlpha(color, 0.85);
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(node.x, node.y, failed ? 3.8 : 3.4, 0, SV_TAU);
        ctx.fillStyle = failed ? theme.accent : color;
        ctx.fill();
      }
      if (page.status === 'running') {
        const phase = state.reducedMotion ? 0.5 : (Math.sin(time * 4.4) + 1) / 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 5.5 + phase * 3.2, 0, SV_TAU);
        ctx.strokeStyle = svAlpha(theme.accent, 0.55 - phase * 0.35);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (page.status === 'completed' && !failed) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 6.4, 0, SV_TAU);
        ctx.strokeStyle = svAlpha(color, 0.32);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      if (failed) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(node.x - 4.2, node.y - 4.2);
        ctx.lineTo(node.x + 4.2, node.y + 4.2);
        ctx.moveTo(node.x + 4.2, node.y - 4.2);
        ctx.lineTo(node.x - 4.2, node.y + 4.2);
        ctx.stroke();
      }
      if (selected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8.5, 0, SV_TAU);
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    for (const target of targets) {
      ctx.fillStyle = svAlpha(target.color, 0.92);
      ctx.fillRect(target.x - 3, target.y - 3, 6, 6);
      ctx.strokeStyle = theme.background;
      ctx.lineWidth = 1;
      ctx.strokeRect(target.x - 3.5, target.y - 3.5, 7, 7);
      text(target.label + ' ' + target.count, target.x - 9, target.y + 3, target.color, 8.5, 'right');
    }
  }
  function drawFlights(time, wall, nodeMap, targets) {
    let drew = false;
    for (const page of state.pages.values()) {
      if (!page.flight) continue;
      const age = wall - page.flight.at;
      if (age < 0) continue;
      if (age > 1.05) {
        page.flight = null;
        continue;
      }
      const from = nodeMap.get(page.id);
      if (!from) continue;
      const target = targets[SV_ROUTES.indexOf(page.route)] || targets[1];
      const progress = svClamp(age / 1.05, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const bend = Math.sin(page.order * 2.399) * 14;
      const controlA = { x: from.x + (target.x - from.x) / 3, y: from.y + (target.y - from.y) * 0.2 + bend };
      const controlB = { x: from.x + (target.x - from.x) * (2 / 3), y: target.y - (target.y - from.y) * 0.2 + bend };
      const point = SV.motion.cubicPoint(eased, from, controlA, controlB, target);
      const color = page.status === 'failed' ? theme.accent : routeColor(page.route);
      ctx.globalAlpha = Math.min(1, progress * 12, (1 - progress) * 9);
      ctx.fillStyle = color;
      ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
      ctx.globalAlpha = Math.min(1, progress * 12, (1 - progress) * 9) * 0.28;
      ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
      const trail = SV.motion.cubicPoint(Math.max(0, eased - 0.09), from, controlA, controlB, target);
      ctx.globalAlpha = Math.min(1, progress * 12, (1 - progress) * 9) * 0.5;
      ctx.fillRect(trail.x - 1.5, trail.y - 1.5, 3, 3);
      drew = true;
    }
    ctx.globalAlpha = 1;
    return drew;
  }
  function drawPulse(inner, wall, nodeMap) {
    if (!state.pulse) return;
    const age = wall - state.pulse.at;
    if (age < 0 || age > 1.15) return;
    const node = state.pulse.pageId && nodeMap.get(state.pulse.pageId);
    const center = node || hubPoint(inner);
    const maxRadius = Math.min(inner.w, inner.h) * 0.34;
    const color = state.pulse.color || theme.accent;
    for (let i = 0; i < 2; i++) {
      const progress = ((age / 1.15) + i * 0.5) % 1;
      const radius = 8 + progress * maxRadius;
      ctx.globalAlpha = (1 - progress) * 0.32;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, SV_TAU);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawEmpty(inner) {
    ctx.font = '12px ' + SV_MONO;
    const first = strings.waitFirst;
    const width = ctx.measureText(first).width;
    const x = inner.x + (inner.w - width) / 2;
    const y = inner.y + inner.h * 0.72;
    text(first, x, y, theme.text, 12);
    ctx.font = '9.5px ' + SV_MONO;
    const hint = svFitText(ctx, strings.waitFirstHint, inner.w - 40);
    text(hint, inner.x + (inner.w - ctx.measureText(hint).width) / 2, y + 17, theme.muted, 9.5);
  }
  function drawSpiderAndProbes(inner, time, wall, dt, nodeMap) {
    const hub = hubPoint(inner);
    const focusId = state.selectedId && nodeMap.has(state.selectedId)
      ? state.selectedId
      : state.attention.id && state.attention.until > wall && nodeMap.has(state.attention.id)
        ? state.attention.id
        : null;
    const focusNode = focusId ? nodeMap.get(focusId) : null;
    let target;
    if (focusNode) {
      const dx = hub.x - focusNode.x;
      const dy = hub.y - focusNode.y;
      const distance = Math.hypot(dx, dy) || 1;
      const offset = Math.min(34, distance * 0.4);
      target = { x: focusNode.x + (dx / distance) * offset, y: focusNode.y + (dy / distance) * offset, vx: 0, vy: 0 };
    } else {
      target = SV.layout.livePose({ scene: inner }, time, state.reducedMotion);
    }
    const pos = state.spider;
    if (!pos.init) {
      pos.x = target.x;
      pos.y = target.y;
      pos.vx = target.vx || 0;
      pos.vy = target.vy || 0;
      pos.init = true;
    }
    const factor = state.reducedMotion ? 1 : svClamp(1 - Math.exp(-(dt || 0.016) * 3.4), 0.015, 0.6);
    const nextX = pos.x + (target.x - pos.x) * factor;
    const nextY = pos.y + (target.y - pos.y) * factor;
    const stepDt = Math.max(dt || 0.016, 1 / 240);
    pos.vx = (nextX - pos.x) / stepDt;
    pos.vy = (nextY - pos.y) / stepDt;
    pos.x = nextX;
    pos.y = nextY;
    const scale = svClamp(Math.min(inner.w, inner.h) / 470, 0.45, 1.12);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(scale, scale);
    SV.spider.drawSpider(ctx, {
      x: 0,
      y: 0,
      time: time,
      vx: pos.vx,
      vy: pos.vy,
      phase: 0,
      reducedMotion: state.reducedMotion,
      activeProbes: focusId ? 1 : 0,
    });
    ctx.restore();
    // Reuse engine probes.js arm geometry, drawn as a dotted reach (live-renderer.js#web recipe).
    if (focusNode && state.attention.until > wall) {
      const page = state.pages.get(state.selectedId === focusId ? state.selectedId : state.attention.id);
      if (page) {
        const pose = SV.probes.probePose(
          {
            index: page.order,
            word: page.title,
            target: { x: focusNode.x, y: focusNode.y },
            launchTime: state.attention.at + 0.05,
          },
          wall,
          { x: pos.x, y: pos.y },
          state.reducedMotion
        );
        if (pose.visible) {
          ctx.save();
          ctx.globalAlpha = pose.opacity;
          ctx.beginPath();
          ctx.moveTo(pose.root.x, pose.root.y);
          ctx.bezierCurveTo(pose.joints[0].x, pose.joints[0].y, pose.joints[1].x, pose.joints[1].y, pose.tip.x, pose.tip.y);
          ctx.setLineDash([1.8, 4]);
          ctx.strokeStyle = theme.spider;
          ctx.lineWidth = 1.1;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = pose.opacity * 0.9;
          ctx.fillStyle = theme.spider;
          ctx.fillRect(pose.tip.x - 1.3, pose.tip.y - 1.3, 2.6, 2.6);
          if (pose.contact) {
            ctx.beginPath();
            ctx.arc(pose.target.x, pose.target.y, 6, 0, SV_TAU);
            ctx.strokeStyle = svAlpha(theme.spider, 0.8);
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  }
  function draw(now, dt) {
    if (state.measurePending || state.cssW === 0) {
      measure();
      state.measurePending = false;
    }
    const width = state.cssW;
    const height = state.cssH;
    if (!ctx || width < 40 || height < 40) return;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
    const pad = width < 420 ? 6 : 10;
    const panel = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
    const count = state.order.length;
    drawPanel(panel, 'AGENT / WEB STREAM', count + ' EVENTS');
    const headH = panelHeadH(panel);
    const inner = { x: panel.x + 1, y: panel.y + headH + 1, w: panel.w - 2, h: panel.h - headH - 2 };
    if (inner.w < 40 || inner.h < 40) return;
    const time = now - state.clockStart;
    const wall = now;
    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.clip();
    state.regions = [];
    let nodeMap = new Map();
    if (state.view === 'orbit' && SV.orbit) {
      const events = pageList().map((page) => ({
        id: page.id,
        label: page.title,
        word: page.title,
        route: page.route,
        status: page.status,
        order: page.order,
      }));
      const nodes = SV.orbit.drawOrbit(ctx, events, inner, {
        time: time,
        angle: state.orbitAngle,
        reducedMotion: state.reducedMotion,
        filter: 'all',
        query: '',
        selected: state.selectedId,
        maxLabels: inner.w < 420 ? 1 : inner.w < 560 ? 2 : 8,
        theme: { background: theme.background, text: theme.text, muted: theme.muted },
        colors: { code: routes.code.color, model: routes.model.color, you: routes.you.color },
      });
      for (const node of nodes) {
        state.regions.push({ id: node.id, x: node.x, y: node.y, r: 14 });
      }
    } else {
      const web = drawWeb(inner, time, wall);
      nodeMap = web.nodeMap;
      drawPulse(inner, wall, nodeMap);
      drawFlights(time, wall, nodeMap, web.targets);
      drawNodes(inner, time, wall, nodeMap, web.targets);
      drawSpiderAndProbes(inner, time, wall, dt, nodeMap);
      if (!state.order.length) drawEmpty(inner);
      for (const [id, node] of nodeMap) {
        state.regions.push({ id: id, x: node.x, y: node.y, r: 13 });
      }
    }
    ctx.restore();
  }

  /* -------------------------------------------------------- interactions */
  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((clientX - rect.left) / rect.width) * state.cssW;
    const y = ((clientY - rect.top) / rect.height) * state.cssH;
    for (let i = state.regions.length - 1; i >= 0; i--) {
      const region = state.regions[i];
      const dx = x - region.x;
      const dy = y - region.y;
      if (dx * dx + dy * dy <= region.r * region.r) return region;
    }
    return null;
  }
  let suppressClick = false;
  let dragState = null;
  function onPointerDown(event) {
    if (state.destroyed || state.view !== 'orbit' || event.button !== 0) return;
    dragState = { id: event.pointerId, x: event.clientX, angle: state.orbitAngle, moved: false };
  }
  function onPointerMove(event) {
    if (!dragState || state.view !== 'orbit' || event.pointerId !== dragState.id) return;
    const dx = event.clientX - dragState.x;
    if (Math.abs(dx) > 4) {
      dragState.moved = true;
      suppressClick = true;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (error) {
          /* ignore */
        }
      }
    }
    state.orbitAngle = dragState.angle + (dx / Math.max(1, state.cssW)) * SV_TAU * 2;
  }
  function onPointerUp(event) {
    if (!dragState) return;
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(event.pointerId)) {
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (error) {
        /* ignore */
      }
    }
    dragState = null;
  }
  function onClick(event) {
    if (state.destroyed) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    if (hit) {
      selectPage(hit.id);
      return;
    }
    if (state.selectedId) {
      state.selectedId = null;
      state.attention = { id: null, at: 0, until: 0 };
      syncList();
      syncHead();
    }
  }
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  if (webBtn) {
    webBtn.addEventListener('click', function () {
      state.view = 'web';
      syncHead();
    });
  }
  if (orbitBtn) {
    orbitBtn.addEventListener('click', function () {
      state.view = 'orbit';
      syncHead();
    });
  }

  /* ------------------------------------------------------------ lifecycle */
  function onResize() {
    state.measurePending = true;
  }
  const ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(onResize) : null;
  if (ro) ro.observe(root);
  win.addEventListener('resize', onResize);
  let io = null;
  if (typeof win.IntersectionObserver === 'function') {
    io = new win.IntersectionObserver(function (entries) {
      state.visible = entries.some((entry) => entry.isIntersecting);
    });
    io.observe(root);
  }
  function onMotionQuery() {
    state.reducedMotion = resolveReducedMotion();
  }
  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotionQuery);
    else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotionQuery);
  }

  function frame(timestamp) {
    if (state.destroyed) return;
    state.raf = requestAnimationFrame(frame);
    const now = (typeof timestamp === 'number' ? timestamp : performance.now()) / 1000;
    const last = state.lastFrame || now;
    const dt = svClamp(now - last, 0, 0.1);
    state.lastFrame = now;
    if (!state.visible) return;
    if (doc.hidden) return;
    draw(now, dt || 1 / 60);
    if (now - state.lastChrome >= 0.25) {
      state.lastChrome = now;
      syncHead();
      syncFoot();
    }
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    cancelAnimationFrame(state.raf);
    if (ro) ro.disconnect();
    if (io) io.disconnect();
    win.removeEventListener('resize', onResize);
    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') motionQuery.removeEventListener('change', onMotionQuery);
      else if (typeof motionQuery.removeListener === 'function') motionQuery.removeListener(onMotionQuery);
    }
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    clearRows();
    state.pages.clear();
    state.order.length = 0;
    state.tools.clear();
    state.regions = [];
    root.remove();
  }

  // initial paint
  applyLayoutClasses();
  measure();
  state.measurePending = false;
  syncAll();
  state.raf = requestAnimationFrame(frame);

  return {
    el: root,
    canvas: canvas,
    push: push,
    setPages: setPages,
    destroy: destroy,
    resize: function resize() {
      state.measurePending = true;
    },
    focusOn: focusOn,
    getState: getState,
    setTheme: setTheme,
    snapshot: snapshot,
  };
}
